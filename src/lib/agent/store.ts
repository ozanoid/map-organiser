import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { isUniqueViolation } from "@/lib/db/errors";
import { AgentError } from "@/lib/agent/errors";
import type { StoredMessage } from "@/lib/agent/history";

/**
 * Where conversations live. The app keeps them in Supabase
 * (assistant_conversations / assistant_messages, through the user's own
 * session — RLS makes them the user's); the eval keeps them in memory.
 */

export type Door = "app";

export interface Conversation {
  id: string;
  userId: string;
  door: Door;
  model: string;
  /** Fixed when the conversation starts, sent unchanged every request. */
  systemPrompt: string;
  /** The tools array as JSON text, fixed likewise. */
  tools: string;
}

export interface ConversationStore {
  /** Whether conversations are rows in the database (spend rows can then
   *  point at them). */
  readonly persistent: boolean;
  create(conversation: Omit<Conversation, "id">): Promise<Conversation>;
  /** The conversation and its messages in order. AgentError("not_found")
   *  when it doesn't exist or isn't the user's. */
  load(id: string): Promise<{ conversation: Conversation; messages: StoredMessage[] }>;
  /** Adds the message at `seq`. AgentError("conflict") when that position
   *  is taken — another request appended first. */
  append(conversationId: string, message: StoredMessage): Promise<void>;
}

/** Content is stored as the JSON text of the blocks — `text`, not `jsonb`,
 *  which would reorder keys. */
const encode = (content: BetaContentBlockParam[]) => JSON.stringify(content);
const decode = (text: string) => JSON.parse(text) as BetaContentBlockParam[];

const PAGE = 1000;

export function supabaseConversationStore(supabase: SupabaseClient): ConversationStore {
  return {
    persistent: true,
    async create(c) {
      const { data, error } = await supabase
        .from("assistant_conversations")
        .insert({ user_id: c.userId, door: c.door, model: c.model, system_prompt: c.systemPrompt, tools: c.tools })
        .select("id")
        .single();
      if (error) throw error;
      return { ...c, id: data.id as string };
    },

    async load(id) {
      const { data: row, error } = await supabase
        .from("assistant_conversations")
        .select("id, user_id, door, model, system_prompt, tools")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new AgentError("not_found");

      // Every message, however long the conversation: a missing turn would
      // break the history the model's thinking is bound to.
      const messages: StoredMessage[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: msgError } = await supabase
          .from("assistant_messages")
          .select("seq, role, content")
          .eq("conversation_id", id)
          .order("seq", { ascending: true })
          .range(from, from + PAGE - 1);
        if (msgError) throw msgError;
        for (const m of data) messages.push({ seq: m.seq, role: m.role, content: decode(m.content) });
        if (data.length < PAGE) break;
      }
      messages.forEach((m, i) => {
        if (m.seq !== i) throw new Error(`assistant_messages: conversation ${id} has a gap at seq ${i}`);
      });

      return {
        conversation: {
          id: row.id,
          userId: row.user_id,
          door: row.door,
          model: row.model,
          systemPrompt: row.system_prompt,
          tools: row.tools,
        },
        messages,
      };
    },

    async append(conversationId, message) {
      const { error } = await supabase.from("assistant_messages").insert({
        conversation_id: conversationId,
        seq: message.seq,
        role: message.role,
        content: encode(message.content),
      });
      if (isUniqueViolation(error)) throw new AgentError("conflict");
      if (error) throw error;
    },
  };
}

/** For the eval: the same contract, nothing written anywhere. Content goes
 *  through JSON like the database does, so the eval sends back exactly what
 *  the app would. */
export function memoryConversationStore(): ConversationStore {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, { seq: number; role: StoredMessage["role"]; content: string }[]>();
  return {
    persistent: false,
    async create(c) {
      const conversation = { ...c, id: crypto.randomUUID() };
      conversations.set(conversation.id, conversation);
      messages.set(conversation.id, []);
      return conversation;
    },
    async load(id) {
      const conversation = conversations.get(id);
      if (!conversation) throw new AgentError("not_found");
      return {
        conversation,
        messages: messages.get(id)!.map((m) => ({ seq: m.seq, role: m.role, content: decode(m.content) })),
      };
    },
    async append(conversationId, message) {
      const list = messages.get(conversationId);
      if (!list) throw new AgentError("not_found");
      if (message.seq !== list.length) throw new AgentError("conflict");
      list.push({ seq: message.seq, role: message.role, content: encode(message.content) });
    },
  };
}
