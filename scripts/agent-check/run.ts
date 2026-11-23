/* eslint-disable @typescript-eslint/no-explicit-any -- builds loosely typed fake API objects */
/**
 * Offline checks of the agent loop (src/lib/agent/run-turn.ts): every stop
 * reason, the approval card's paths, retries, limits and crash recovery —
 * with a scripted stand-in for the Claude API, the in-memory store and a
 * stand-in tool runner. No network, no database, no cost.
 *
 *   npm run check:agent
 *
 * Progress goes to stderr; stdout carries the loop's JSON log lines.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "@/lib/agent/errors";
import { CONTEXT_TAG, echoable, type StoredMessage } from "@/lib/agent/history";
import { MAX_STEPS } from "@/lib/agent/models";
import { costOfMessage } from "@/lib/agent/pricing";
import { runTurn, startConversation, type AgentDeps, type TurnEvents, type TurnResult } from "@/lib/agent/run-turn";
import type { SpendEntry, SpendLedger } from "@/lib/agent/spend";
import { memoryConversationStore, type ConversationStore } from "@/lib/agent/store";

const say = (line = "") => process.stderr.write(`${line}\n`);
let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  say(`   ${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

// ── Stand-ins ─────────────────────────────────────────────────────────

type Script =
  | { kind: "message"; stop: string; content: any[]; usage?: Record<string, unknown>; model?: string }
  | { kind: "break"; partial?: boolean }
  | { kind: "api_error"; status: number; type: string; errorCode?: string };

const text = (t: string) => ({ type: "text", text: t, citations: null });
const thinking = (sig: string) => ({ type: "thinking", thinking: "", signature: sig });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

const VALID_VISIT = { place_id: "5f4d1459-4a21-4db2-91ee-319ec76bc27b", visited_on: "2026-11-22", rating: 4 };
const VALID_STATUS = { place_ids: ["5f8dc4aa-0e24-4b86-a419-bf433cac8fd4"], visit_status: "visited" };

class FakeClient {
  queue: Script[] = [];
  requests: any[] = [];
  aborted = 0;
  private n = 0;
  beta = { messages: { stream: (params: any) => this.stream(params) } };

  private stream(params: any) {
    this.requests.push(JSON.parse(JSON.stringify(params)));
    const script = this.queue.shift();
    if (!script) throw new Error("no scripted response left");
    const listeners: ((delta: string) => void)[] = [];
    let current: any;
    const id = `msg_${++this.n}`;
    const handle = {
      on(event: string, cb: (delta: string) => void) {
        if (event === "text") listeners.push(cb);
        return handle;
      },
      get currentMessage() {
        return current;
      },
      get request_id() {
        return `req_${id}`;
      },
      abort: () => {
        this.aborted++;
      },
      async finalMessage() {
        if (script.kind === "break") {
          if (script.partial) current = message(id, params.model, "end_turn", [], { input_tokens: 1000, output_tokens: 0 });
          throw new Error("stream broke");
        }
        if (script.kind === "api_error") {
          throw Anthropic.APIError.generate(
            script.status,
            { type: "error", error: { type: script.type, message: "x", ...(script.errorCode ? { details: { error_code: script.errorCode } } : {}) } },
            "x",
            new Headers()
          );
        }
        for (const block of script.content) if (block.type === "text") listeners.forEach((cb) => cb(block.text));
        current = message(id, script.model ?? params.model, script.stop, script.content, script.usage);
        return current;
      },
    };
    return handle;
  }
}

function message(id: string, model: string, stop: string, content: any[], usage: Record<string, unknown> = {}) {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      iterations: null,
      ...usage,
    },
  };
}

class FakeLedger implements SpendLedger {
  rows: SpendEntry[] = [];
  spent = 0;
  async record(e: SpendEntry) {
    this.rows.push(e);
  }
  async monthToDate() {
    return this.spent;
  }
}

/** The in-memory store with failures to inject. */
function faultyStore() {
  const inner = memoryConversationStore();
  const faults = { appendAt: -1, finishOnce: false };
  const store: ConversationStore = {
    ...inner,
    persistent: false,
    append: async (id, m) => {
      if (m.seq === faults.appendAt) {
        faults.appendAt = -1;
        throw new Error("injected: append failed");
      }
      return inner.append(id, m);
    },
    finishToolRun: async (id, toolUseId, outcome) => {
      if (faults.finishOnce) {
        faults.finishOnce = false;
        throw new Error("injected: finishToolRun failed");
      }
      return inner.finishToolRun(id, toolUseId, outcome);
    },
  };
  return { store, inner, faults };
}

async function setup() {
  const client = new FakeClient();
  const ledger = new FakeLedger();
  const { store, faults } = faultyStore();
  const ran: { name: string; input: unknown }[] = [];
  let gate: Promise<void> | null = null;
  const deps: AgentDeps = {
    client: client as unknown as Anthropic,
    store,
    ledger,
    toolCtx: { supabase: null as never, userId: "user-1", appUrl: "http://localhost" },
    purpose: "eval",
    now: () => new Date("2026-11-23T13:00:00Z"),
    executeTool: async (_ctx, name, input) => {
      if (gate) await gate;
      ran.push({ name, input });
      return { text: JSON.stringify({ ran: name }), isError: false };
    },
  };
  const conversation = await startConversation(store, { userId: "user-1", door: "app", model: "claude-sonnet-5-5" });
  const history = async (): Promise<StoredMessage[]> => (await store.load(conversation.id)).messages;
  const turn = (input: Parameters<typeof runTurn>[2], events?: TurnEvents) => runTurn(deps, conversation.id, input, events);
  const say_ = (t: string) => ({ kind: "message" as const, text: t, timeZone: "Europe/London" });
  return {
    client,
    ledger,
    store,
    faults,
    ran,
    deps,
    conversation,
    history,
    turn,
    msg: say_,
    setGate: (g: Promise<void> | null) => (gate = g),
  };
}

const roles = (h: StoredMessage[]) => h.map((m) => m.role[0]).join("");
const results = (m: StoredMessage | undefined) =>
  (m?.content ?? []).flatMap((b: any) => (b.type === "tool_result" ? [{ id: b.tool_use_id, text: b.content, err: !!b.is_error }] : []));
async function throws(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof AgentError ? e.code : (e as Error).message;
  }
}

// ── Checks ────────────────────────────────────────────────────────────

async function main() {
  say("## a plain answer");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [thinking("s1"), text("Merhaba!")] });
    const streamed: string[] = [];
    const r = await t.turn(t.msg("Selam"), { text: (d) => streamed.push(d) });
    const h = await t.history();
    expect("status done, 1 step", r.status === "done" && r.steps === 1, r);
    expect("history user → assistant", roles(h) === "ua", roles(h));
    expect("user message: context block, then the text", (h[0].content[0] as any).text.startsWith(`<${CONTEXT_TAG}>`) && (h[0].content[1] as any).text === "Selam");
    expect("assistant content stored as received (thinking kept)", JSON.stringify(h[1].content) === JSON.stringify([thinking("s1"), text("Merhaba!")]));
    expect("text streamed", streamed.join("") === "Merhaba!");
    expect("one spend row, with the request id", t.ledger.rows.length === 1 && t.ledger.rows[0].requestId === "req_msg_1");
    const req = t.client.requests[0];
    expect("request: cached system block, top-level cache, fallbacks, effort", req.system[0].cache_control?.type === "ephemeral" && req.cache_control?.type === "ephemeral" && req.fallbacks === "default" && req.output_config.effort === "high");
  }

  say("## a read tool round");
  {
    const t = await setup();
    t.client.queue.push(
      { kind: "message", stop: "tool_use", content: [text("Bakıyorum."), toolUse("t1", "get_library_overview", {}), toolUse("t2", "search_places", { query: "Ramiro" })] },
      { kind: "message", stop: "end_turn", content: [text("İşte.")] }
    );
    const seen: string[] = [];
    const r = await t.turn(t.msg("Kütüphanem?"), { toolResult: (x) => seen.push(x.id) });
    const h = await t.history();
    expect("done after 2 steps", r.status === "done" && r.steps === 2, r);
    expect("history u a u a", roles(h) === "uaua", roles(h));
    expect("both reads ran", t.ran.map((x) => x.name).join(",") === "get_library_overview,search_places");
    expect("results in call order", results(h[2]).map((x) => x.id).join(",") === "t1,t2");
    expect("tool runs recorded as auto/done", (await t.store.toolRuns(t.conversation.id, ["t1", "t2"])).every((x) => x.decision === "auto" && x.status === "done"));
    expect("toolResult events", seen.join(",") === "t1,t2");
  }

  say("## a write: card, approve, run once");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [text("Kaydediyorum."), toolUse("w1", "log_visit", VALID_VISIT), toolUse("r1", "search_places", { query: "x" })] });
    const r1 = await t.turn(t.msg("Dün gittim"));
    expect("awaiting approval", r1.status === "awaiting_approval", r1);
    expect("pending: the write needs approval, the read doesn't", r1.pending.map((p) => `${p.name}:${p.needsApproval}`).join(",") === "log_visit:true,search_places:false");
    expect("nothing ran yet", t.ran.length === 0);
    expect("history ends with the assistant's calls", roles(await t.history()) === "ua");

    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Kaydettim.")] });
    const r2 = await t.turn({ kind: "approval", decisions: { w1: true } });
    const h = await t.history();
    expect("done", r2.status === "done", r2);
    expect("write and read ran once, in order", t.ran.map((x) => x.name).join(",") === "log_visit,search_places");
    expect("history u a u a", roles(h) === "uaua", roles(h));
    expect("runs recorded approved + auto", (await t.store.toolRuns(t.conversation.id, ["w1", "r1"])).map((x) => `${x.toolUseId}:${x.decision}`).sort().join(",") === "r1:auto,w1:approved");

    const again = await throws(t.turn({ kind: "approval", decisions: { w1: true } }));
    expect("the same answer again → nothing_pending, no second run", again === "nothing_pending" && t.ran.length === 2, again);
  }

  say("## decline");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "update_places", VALID_STATUS)] });
    await t.turn(t.msg("İşaretle"));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Tamam, kaydetmedim.")] });
    const r = await t.turn({ kind: "approval", decisions: {} });
    const h = await t.history();
    expect("done, the write never ran", r.status === "done" && t.ran.length === 0);
    expect("result: declined, as an error", results(h[2])[0]?.text.includes("declined") && results(h[2])[0]?.err);
  }

  say("## a new message instead of an answer");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT)] });
    await t.turn(t.msg("Dün gittim"));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Peki.")] });
    await t.turn(t.msg("Boşver"));
    const h = await t.history();
    expect("the write never ran", t.ran.length === 0);
    expect("user message: not-run result first, then context and text", results(h[2])[0]?.text.startsWith("Not run: the user sent a new message") && (h[2].content.at(-1) as any).text === "Boşver");
    expect("recorded not_run", (await t.store.toolRuns(t.conversation.id, ["w1"]))[0]?.decision === "not_run");
  }

  say("## one turn at a time");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT)] });
    await t.turn(t.msg("Dün gittim"));
    let open!: () => void;
    t.setGate(new Promise<void>((resolve) => (open = resolve)));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Kaydettim.")] });
    const first = t.turn({ kind: "approval", decisions: { w1: true } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await throws(t.turn({ kind: "approval", decisions: { w1: true } }));
    open();
    await first;
    expect("a second answer while the first runs → turn_in_progress", second === "turn_in_progress", second);
    expect("the write ran once", t.ran.length === 1, t.ran.length);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("ok")] });
    expect("the lease is free after the turn", (await t.turn(t.msg("devam"))).status === "done");
  }

  say("## the result survives a failed append");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT)] });
    await t.turn(t.msg("Dün gittim"));
    t.faults.appendAt = 2; // the user message carrying the result
    const err = await throws(t.turn({ kind: "approval", decisions: { w1: true } }));
    expect("the approval turn fails at the append", err === "injected: append failed", err);
    expect("the write ran", t.ran.length === 1);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Kaydedilmiş.")] });
    await t.turn(t.msg("Oldu mu?"));
    const h = await t.history();
    expect("not run again", t.ran.length === 1, t.ran.length);
    expect("the next message carries the real result, not 'not run'", results(h[2])[0]?.text === JSON.stringify({ ran: "log_visit" }), results(h[2]));
  }

  say("## an interrupted run");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT)] });
    await t.turn(t.msg("Dün gittim"));
    t.faults.finishOnce = true; // the run's result isn't recorded
    const err = await throws(t.turn({ kind: "approval", decisions: { w1: true } }));
    expect("the approval turn fails recording the result", err === "injected: finishToolRun failed", err);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Kontrol edeyim.")] });
    await t.turn({ kind: "approval", decisions: { w1: true } });
    const h = await t.history();
    expect("not run a second time", t.ran.length === 1, t.ran.length);
    expect("the model is told it was interrupted", results(h[2])[0]?.text.startsWith("This call was interrupted"), results(h[2]));
  }

  say("## an invalid write gets no card");
  {
    const t = await setup();
    t.client.queue.push(
      { kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", { date: "2026-11-22" })] },
      { kind: "message", stop: "end_turn", content: [text("Düzelttim.")] }
    );
    const r = await t.turn(t.msg("Dün gittim"));
    const h = await t.history();
    expect("no card: the turn went on", r.status === "done" && r.steps === 2, r);
    expect("the validation error went back", results(h[2])[0]?.text.includes('Unrecognized key: "date"') && results(h[2])[0]?.err, results(h[2]));
    expect("recorded invalid", (await t.store.toolRuns(t.conversation.id, ["w1"]))[0]?.decision === "invalid");
  }

  say("## a valid and an invalid write together");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT), toolUse("w2", "update_places", { nope: 1 })] });
    const r1 = await t.turn(t.msg("İkisi"));
    expect("card for the valid one only", r1.status === "awaiting_approval" && r1.pending.map((p) => `${p.id}:${p.needsApproval}`).join(",") === "w1:true,w2:false", r1.pending);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("ok")] });
    await t.turn({ kind: "approval", decisions: { w1: true, w2: true } });
    const h = await t.history();
    expect("only the valid write ran", t.ran.map((x) => x.name).join(",") === "log_visit");
    expect("the invalid one's error is its result", results(h[2]).find((x) => x.id === "w2")?.err === true);
  }

  say("## cut off at max_tokens");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "max_tokens", content: [text("Uzun…"), toolUse("r1", "search_places", { query: "x" })] });
    const r = await t.turn(t.msg("Uzun anlat"));
    const h = await t.history();
    expect("status max_tokens, nothing ran", r.status === "max_tokens" && t.ran.length === 0, r);
    expect("history u a u (the cut-off call answered)", roles(h) === "uau" && results(h[2])[0]?.text.startsWith("Not run: your message was cut off"));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("ok")] });
    expect("the next message goes through", (await t.turn(t.msg("devam"))).status === "done");
  }

  say("## refusal");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "refusal", content: [text("partial")] });
    const r = await t.turn(t.msg("?"));
    const h = await t.history();
    expect("status refused, nothing stored for it", r.status === "refused" && roles(h) === "u", roles(h));
    expect("its spend recorded", t.ledger.rows.length === 1);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("ok")] });
    expect("the next message goes through (two user messages in a row)", (await t.turn(t.msg("başka"))).status === "done" && roles(await t.history()) === "uua");
  }

  say("## pause_turn");
  {
    const t = await setup();
    t.client.queue.push(
      { kind: "message", stop: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } }] },
      { kind: "message", stop: "end_turn", content: [text("Buldum.")] }
    );
    const r = await t.turn(t.msg("Ara"));
    expect("continued after the pause", r.status === "done" && r.steps === 2 && roles(await t.history()) === "uaa");
    expect("the second request ends with the paused message", t.client.requests[1].messages.at(-1).role === "assistant");
  }

  say("## a broken stream is aborted and re-run once");
  {
    const t = await setup();
    t.client.queue.push({ kind: "break", partial: true }, { kind: "message", stop: "end_turn", content: [text("Tamam.")] });
    const retried: number[] = [];
    const r = await t.turn(t.msg("Selam"), { stepRetried: (s) => retried.push(s) });
    expect("done after the retry", r.status === "done");
    expect("the broken stream was aborted", t.client.aborted === 1);
    expect("stepRetried(1) emitted", retried.join(",") === "1");
    expect("the partial attempt's input was recorded too", t.ledger.rows.length === 2 && t.ledger.rows[0].inputTokens === 1000);
    expect("the turn's cost counts both", r.costUsd > 0.002, r.costUsd);
  }

  say("## two broken streams fail the turn, the lease is freed");
  {
    const t = await setup();
    t.client.queue.push({ kind: "break" }, { kind: "break" });
    const err = await throws(t.turn(t.msg("Selam")));
    expect("connection error after the retry", err === "connection", err);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("ok")] });
    expect("the next turn can start", (await t.turn(t.msg("tekrar"))).status === "done");
  }

  say("## API errors");
  {
    const t = await setup();
    t.client.queue.push({ kind: "api_error", status: 429, type: "rate_limit_error", errorCode: "enforced_spend_limit_reached" });
    expect("the Console's spend limit → spend_limit", (await throws(t.turn(t.msg("a")))) === "spend_limit");
    t.client.queue.push({ kind: "api_error", status: 529, type: "overloaded_error" });
    expect("overloaded → busy", (await throws(t.turn(t.msg("b")))) === "busy");
    t.client.queue.push({ kind: "api_error", status: 400, type: "invalid_request_error" });
    expect("invalid request → rejected", (await throws(t.turn(t.msg("c")))) === "rejected");
  }

  say("## the step limit");
  {
    const t = await setup();
    for (let i = 1; i <= MAX_STEPS; i++) {
      t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse(`r${i}`, "search_places", { query: `q${i}` })] });
    }
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Şimdiye kadar bulduklarım…")] });
    const r = await t.turn(t.msg("Her şeye bak"));
    const h = await t.history();
    expect(`step_limit after ${MAX_STEPS} rounds and one last call`, r.status === "step_limit" && r.steps === MAX_STEPS + 1, r);
    expect(`${MAX_STEPS - 1} reads ran; the last round answered not run`, t.ran.length === MAX_STEPS - 1 && results(h.at(-2)).every((x) => x.text.startsWith("Not run: this turn reached its limit")));
    expect("the last call's answer is stored", (h.at(-1)?.content[0] as any)?.text === "Şimdiye kadar bulduklarım…");
  }

  say("## the budget");
  {
    const t = await setup();
    t.ledger.spent = 100;
    const err = await throws(t.turn(t.msg("Selam")));
    expect("budget_exhausted before anything is written", err === "budget_exhausted" && (await t.history()).length === 0 && t.client.requests.length === 0, err);
  }

  say("## a door handler that throws");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Merhaba")] });
    const r = await t.turn(t.msg("Selam"), {
      text: () => {
        throw new Error("render failed");
      },
      step: () => {
        throw new Error("render failed");
      },
    });
    expect("the turn finishes, one model call, one spend row", r.status === "done" && t.client.requests.length === 1 && t.ledger.rows.length === 1);
  }

  say("## after a refusal fallback, only the allowed blocks are kept");
  {
    const kept = echoable([
      thinking("declined"),
      text("Partial "),
      toolUse("x", "search_places", {}),
      { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
      { type: "server_tool_use", id: "s2", name: "web_search", input: {} },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" }, trigger: {} },
      thinking("fallback"),
      text("Rest"),
    ] as any).map((b: any) => b.type + (b.id ? `:${b.id}` : b.signature ? `:${b.signature}` : ""));
    expect(
      "text, the paired search and the boundary kept; thinking, the call and the unpaired search dropped",
      kept.join(",") === "text,server_tool_use:s1,web_search_tool_result,fallback,thinking:fallback,text",
      kept
    );
  }

  say("## cost");
  {
    const plain = costOfMessage({
      model: "claude-opus-5-5",
      usage: { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 27_000, cache_creation_input_tokens: 0, cache_creation: null, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 }, iterations: null } as any,
    });
    expect("Opus 5.5: 27k cached read + 1k output + 2 searches = $0.04544", Math.abs(plain.costUsd - (10 * 4 + 1000 * 20 + 27_000 * 0.2) / 1e6 - 0.02) < 1e-9, plain.costUsd);
    const fallback = costOfMessage(
      {
        model: "claude-opus-5",
        usage: {
          input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, server_tool_use: null,
          iterations: [
            { type: "message", model: null, input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
            { type: "fallback_message", model: "claude-opus-5", input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          ],
        } as any,
      },
      "claude-opus-5-5"
    );
    expect("a refusal fallback: the declined attempt at Opus 5.5, the rescue at Opus 5", Math.abs(fallback.costUsd - ((1000 * 4 + 100 * 20) + (1000 * 5 + 200 * 25)) / 1e6) < 1e-9, fallback.costUsd);
    const unknown = costOfMessage({ model: "claude-mystery-9", usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, server_tool_use: null, iterations: null } as any });
    expect("an unlisted model costs the highest listed price, and is reported", unknown.costUsd === 5 && unknown.unpricedModels[0] === "claude-mystery-9", unknown);
  }

  say();
  say(failures ? `${failures} FAILED` : "all passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  say(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});

export type { TurnResult };
