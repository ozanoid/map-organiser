import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ToolOutcome } from "@/lib/assistant/run-tool";
import { isUniqueViolation } from "@/lib/db/errors";
import { AgentError } from "@/lib/agent/errors";
import type { StoredMessage } from "@/lib/agent/history";

/**
 * Where conversations live. The app keeps them in Supabase — written by the
 * server alone (service role), scoped to the signed-in user in code; users
 * can only read theirs and delete a conversation (RLS). The eval keeps them
 * in memory with the same rules.
 *
 * Three records besides the messages make a turn safe to retry and to race:
 *   - the turn lease: one turn at a time per conversation;
 *   - tool runs: each tool call's decision and result, written before the
 *     call runs, so a call is never run twice and a result that didn't make
 *     it into the conversation isn't lost;
 *   - the message's position (seq): two writers can't both append it.
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

/** What became of a tool call: run without asking (a read), approved or
 *  declined on the card, answered "not run" (the user moved on, the turn hit
 *  a limit, the call was cut off) or refused for an invalid input. */
export type ToolRunDecision = "auto" | "approved" | "declined" | "not_run" | "invalid";

export interface ToolRun {
  toolUseId: string;
  name: string;
  decision: ToolRunDecision;
  /** "running" after a crash mid-run means: interrupted, outcome unknown. */
  status: "running" | "done";
  outcome: ToolOutcome | null;
}

export interface NewToolRun {
  toolUseId: string;
  name: string;
  decision: ToolRunDecision;
  /** Given: recorded as done (declined, not run, invalid). Left out: the
   *  call is about to run. */
  outcome?: ToolOutcome;
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
  /** Takes the conversation's turn lease: true, or false while another turn
   *  holds it. AgentError("not_found") for someone else's conversation. A
   *  lease left by a crashed turn runs out after `leaseMs`. */
  takeTurn(conversationId: string, leaseMs: number): Promise<boolean>;
  releaseTurn(conversationId: string): Promise<void>;
  /** The runs recorded for these calls, in no particular order. */
  toolRuns(conversationId: string, toolUseIds: string[]): Promise<ToolRun[]>;
  /** Records runs in one write — AgentError("conflict") if any of them is
   *  recorded already, which is how a second answer to the same card stops. */
  startToolRuns(conversationId: string, runs: NewToolRun[]): Promise<void>;
  finishToolRun(conversationId: string, toolUseId: string, outcome: ToolOutcome): Promise<void>;
}

/** Content is stored as the JSON text of the blocks — `text`, not `jsonb`,
 *  which would reorder keys. */
const encode = (content: BetaContentBlockParam[]) => JSON.stringify(content);
const decode = (text: string) => JSON.parse(text) as BetaContentBlockParam[];

const PAGE = 1000;

/**
 * The app's store: the service-role client, bound to the signed-in user.
 * RLS doesn't apply to the service role, so every read here filters by that
 * user, and writes happen only after `load` or `takeTurn` has checked the
 * conversation is theirs.
 */
export function supabaseConversationStore(admin: SupabaseClient, userId: string): ConversationStore {
  return {
    persistent: true,

    async create(c) {
      if (c.userId !== userId) throw new AgentError("not_found");
      const { data, error } = await admin
        .from("assistant_conversations")
        .insert({ user_id: userId, door: c.door, model: c.model, system_prompt: c.systemPrompt, tools: c.tools })
        .select("id")
        .single();
      if (error) throw error;
      return { ...c, id: data.id as string };
    },

    async load(id) {
      const { data: row, error } = await admin
        .from("assistant_conversations")
        .select("id, user_id, door, model, system_prompt, tools")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new AgentError("not_found");

      // Every message, however long the conversation: a missing turn would
      // break the history the model's thinking is bound to.
      const messages: StoredMessage[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: msgError } = await admin
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
      const { error } = await admin.from("assistant_messages").insert({
        conversation_id: conversationId,
        seq: message.seq,
        role: message.role,
        content: encode(message.content),
      });
      if (isUniqueViolation(error)) throw new AgentError("conflict");
      if (error) throw error;
    },

    async takeTurn(conversationId, leaseMs) {
      const now = new Date();
      const { data, error } = await admin
        .from("assistant_conversations")
        .update({ turn_lease_until: new Date(now.getTime() + leaseMs).toISOString() })
        .eq("id", conversationId)
        .eq("user_id", userId)
        .or(`turn_lease_until.is.null,turn_lease_until.lt.${now.toISOString()}`)
        .select("id");
      if (error) throw error;
      if (data.length) return true;
      const { data: exists, error: existsError } = await admin
        .from("assistant_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (existsError) throw existsError;
      if (!exists) throw new AgentError("not_found");
      return false;
    },

    async releaseTurn(conversationId) {
      const { error } = await admin
        .from("assistant_conversations")
        .update({ turn_lease_until: null })
        .eq("id", conversationId)
        .eq("user_id", userId);
      if (error) throw error;
    },

    async toolRuns(conversationId, toolUseIds) {
      if (!toolUseIds.length) return [];
      const { data, error } = await admin
        .from("assistant_tool_runs")
        .select("tool_use_id, name, decision, status, result, is_error")
        .eq("conversation_id", conversationId)
        .in("tool_use_id", toolUseIds);
      if (error) throw error;
      return data.map((r) => ({
        toolUseId: r.tool_use_id,
        name: r.name,
        decision: r.decision,
        status: r.status,
        outcome: r.status === "done" ? { text: r.result as string, isError: r.is_error as boolean } : null,
      }));
    },

    async startToolRuns(conversationId, runs) {
      if (!runs.length) return;
      const finishedAt = new Date().toISOString();
      const { error } = await admin.from("assistant_tool_runs").insert(
        runs.map((r) => ({
          conversation_id: conversationId,
          tool_use_id: r.toolUseId,
          name: r.name,
          decision: r.decision,
          ...(r.outcome
            ? { status: "done", result: r.outcome.text, is_error: r.outcome.isError, finished_at: finishedAt }
            : { status: "running" }),
        }))
      );
      if (isUniqueViolation(error)) throw new AgentError("conflict");
      if (error) throw error;
    },

    async finishToolRun(conversationId, toolUseId, outcome) {
      const { error } = await admin
        .from("assistant_tool_runs")
        .update({ status: "done", result: outcome.text, is_error: outcome.isError, finished_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("tool_use_id", toolUseId);
      if (error) throw error;
    },
  };
}

/** For the eval: the same contract, nothing written anywhere. Content goes
 *  through JSON like the database does, so the eval sends back exactly what
 *  the app would. */
export function memoryConversationStore(): ConversationStore {
  const conversations = new Map<string, Conversation & { leaseUntil: number }>();
  const messages = new Map<string, { seq: number; role: StoredMessage["role"]; content: string }[]>();
  const runs = new Map<string, Map<string, ToolRun>>();
  const get = (id: string) => {
    const conversation = conversations.get(id);
    if (!conversation) throw new AgentError("not_found");
    return conversation;
  };
  return {
    persistent: false,
    async create(c) {
      const conversation = { ...c, id: crypto.randomUUID() };
      conversations.set(conversation.id, { ...conversation, leaseUntil: 0 });
      messages.set(conversation.id, []);
      runs.set(conversation.id, new Map());
      return conversation;
    },
    async load(id) {
      const { id: cid, userId, door, model, systemPrompt, tools } = get(id);
      return {
        conversation: { id: cid, userId, door, model, systemPrompt, tools },
        messages: messages.get(id)!.map((m) => ({ seq: m.seq, role: m.role, content: decode(m.content) })),
      };
    },
    async append(conversationId, message) {
      get(conversationId);
      const list = messages.get(conversationId)!;
      if (message.seq !== list.length) throw new AgentError("conflict");
      list.push({ seq: message.seq, role: message.role, content: encode(message.content) });
    },
    async takeTurn(conversationId, leaseMs) {
      const conversation = get(conversationId);
      if (conversation.leaseUntil > Date.now()) return false;
      conversation.leaseUntil = Date.now() + leaseMs;
      return true;
    },
    async releaseTurn(conversationId) {
      get(conversationId).leaseUntil = 0;
    },
    async toolRuns(conversationId, toolUseIds) {
      get(conversationId);
      const map = runs.get(conversationId)!;
      return toolUseIds.flatMap((id) => (map.has(id) ? [{ ...map.get(id)! }] : []));
    },
    async startToolRuns(conversationId, newRuns) {
      get(conversationId);
      const map = runs.get(conversationId)!;
      if (newRuns.some((r) => map.has(r.toolUseId))) throw new AgentError("conflict");
      for (const r of newRuns) {
        map.set(r.toolUseId, {
          toolUseId: r.toolUseId,
          name: r.name,
          decision: r.decision,
          status: r.outcome ? "done" : "running",
          outcome: r.outcome ?? null,
        });
      }
    },
    async finishToolRun(conversationId, toolUseId, outcome) {
      const run = runs.get(conversationId)?.get(toolUseId);
      if (run) Object.assign(run, { status: "done", outcome });
    },
  };
}
