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
import { replyMessageId, toUIMessages, uiToolOutput } from "@/lib/agent/ui";
import { systemPromptFor } from "@/lib/agent/prompt";
import { capWithGuaranteedSeats } from "@/lib/assistant/place-filters";
import { turnStream } from "@/lib/agent/ui-stream";
import { approvalsAnswered, placeIdsIn, subjectLabel, type AssistantUIMessage, type ResolvedSubject } from "@/lib/agent/ui-types";
import { SUBJECT_TAG, subjectBlock, subjectIn } from "@/lib/agent/subject";
import { planChangeLines } from "@/lib/agent/describe-writes";
import type { PlanSnapshot } from "@/lib/plans/write";
import type { ToolRun } from "@/lib/agent/store";
import { openTurn, runTurn, startConversation, type AgentDeps, type TurnEvents, type TurnResult } from "@/lib/agent/run-turn";
import { capFor, MONTHLY_CAP_USD, type SpendEntry, type SpendLedger } from "@/lib/agent/spend";
import { isAssistantOwner } from "@/lib/assistant/owner";
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
    const listeners: ((event: any) => void)[] = [];
    let current: any;
    const id = `msg_${++this.n}`;
    const handle = {
      on(event: string, cb: (event: any) => void) {
        if (event === "streamEvent") listeners.push(cb);
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
        script.content.forEach((block, index) => {
          if (block.type !== "text") return;
          const event = { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } };
          listeners.forEach((cb) => cb(event));
        });
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

  say("## a plan change shown as its outcome: saved only if it still comes out the same");
  {
    const PLAN_CALL = { plan_id: "9a0b8c7d-1e2f-4a3b-9c4d-5e6f7a8b9c0d", ops: [{ op: "move_stop", stop_id: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9", day: 2 }] };
    const verified: string[] = [];
    const run = async (verdict: string | null) => {
      const t = await setup();
      t.deps.verifyProposal = async (_ctx, call, seen) => {
        verified.push(`${call.name}:${seen}`);
        return verdict;
      };
      t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "update_plan", PLAN_CALL)] });
      await t.turn(t.msg("Bu planı günlere dağıt"));
      t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Tamam.")] });
      await t.turn({ kind: "approval", decisions: { w1: true }, seen: { w1: "fp-shown" } });
      const h = await t.history();
      return { t, result: results(h[2])[0] };
    };
    const unchanged = await run(null);
    expect("unchanged since the card → the change is saved", unchanged.t.ran.map((x) => x.name).join() === "update_plan" && !unchanged.result.err, unchanged.result);
    expect("…checked against the fingerprint the card showed", verified[0] === "update_plan:fp-shown", verified);
    const changed = await run("The plan changed after this proposal was shown, so nothing was saved. A fresh proposal is needed.");
    expect("changed since → nothing saved, the reason as the call's result", changed.t.ran.length === 0 && changed.result.err && String(changed.result.text).startsWith("The plan changed"), changed.result);
    const runs = await changed.t.store.toolRuns(changed.t.conversation.id, ["w1"]);
    expect("…recorded as the user's yes that couldn't be saved", runs[0]?.decision === "approved" && runs[0]?.outcome?.isError === true, runs);
    const t = await setup();
    let asked = 0;
    t.deps.verifyProposal = async () => {
      asked++;
      return "changed";
    };
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "update_plan", PLAN_CALL)] });
    await t.turn(t.msg("x"));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Tamam.")] });
    await t.turn({ kind: "approval", decisions: { w1: true } });
    expect("a card without a fingerprint isn't checked (the save decides)", asked === 0 && t.ran.length === 1, { asked, ran: t.ran.length });

    const stop = (id: string, name: string, extra: Partial<PlanSnapshot["days"][number]["stops"][number]> = {}) => ({
      id, place_id: null, name, start_time: null, day_part: null, notes: null, status: "planned", cost_estimate: null, currency: null, ...extra,
    });
    const before: PlanSnapshot = {
      id: "p", name: "Lizbon hafta sonu", start_date: "2026-11-28", party_size: 2, notes: null, status: "planned",
      days: [
        { id: "d1", day_number: 1, notes: null, stops: [stop("s1", "Pastéis de Belém"), stop("s2", "LX Factory"), stop("s3", "Café A Brasileira")] },
        { id: "d2", day_number: 2, notes: null, stops: [stop("s4", "MAAT")] },
        { id: "d3", day_number: 3, notes: "Free day", stops: [stop("s5", "Oceanário")] },
      ],
    };
    const after: PlanSnapshot = {
      ...before,
      days: [
        { id: "d1", day_number: 1, notes: "Belém", stops: [stop("s1", "Pastéis de Belém", { day_part: "morning" }), stop("s6", "Taberna da Rua", { start_time: "19:30:00", notes: "Book ahead", cost_estimate: 35, currency: "EUR" })] },
        { id: "d2", day_number: 2, notes: null, stops: [stop("s2", "LX Factory"), stop("s4", "MAAT")] },
        before.days[2],
      ],
    };
    const lines = planChangeLines(before, after);
    const texts = lines.map((l) => `${l.heading ? "#" : ""}${l.label ?? ""}|${l.text}${l.note ? `|${l.note}` : ""}`);
    expect(
      "the card: each changed day as it will be, the stop removed, the unchanged day left out",
      JSON.stringify(texts) ===
        JSON.stringify([
          "#Day 1|Sat 28 Nov",
          "Notes|Belém",
          "Morning|Pastéis de Belém",
          "19:30|Taberna da Rua|Book ahead · ~€35 pp",
          "#Day 2|Sun 29 Nov",
          "|LX Factory",
          "|MAAT",
          "Remove|Café A Brasileira",
        ]),
      texts
    );
    const renamed = planChangeLines(before, { ...before, name: "Lisbon", status: "cancelled" });
    expect("the plan's own changes come first", renamed.map((l) => `${l.label}|${l.text}`).join() === "Rename|Lisbon,Status|Cancel the plan", renamed);
    expect("nothing changes → no lines", planChangeLines(before, before).length === 0);
  }

  say("## decline");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "update_places", VALID_STATUS)] });
    await t.turn(t.msg("İşaretle"));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Tamam, kaydetmedim.")] });
    const r = await t.turn({ kind: "approval", decisions: { w1: false } });
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
    expect("the card is decided: answering it again → nothing_pending", (await throws(t.turn({ kind: "approval", decisions: { w1: true } }))) === "nothing_pending");
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Kontrol edeyim.")] });
    const r = await t.turn({ kind: "retry" });
    const h = await t.history();
    expect("Try again carries the turn on", r.status === "done" && roles(h) === "uaua", roles(h));
    expect("not run a second time", t.ran.length === 1, t.ran.length);
    expect("the model is told it was interrupted", results(h[2])[0]?.text.startsWith("This call was interrupted"), results(h[2]));
  }

  say("## Try again after the result's append failed");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT), toolUse("r1", "get_visits", {})] });
    await t.turn(t.msg("Dün gittim"));
    t.faults.appendAt = 2;
    await throws(t.turn({ kind: "approval", decisions: { w1: true } }));
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Kaydedildi.")] });
    const r = await t.turn({ kind: "retry" });
    const h = await t.history();
    expect("done, nothing run twice", r.status === "done" && t.ran.length === 2, t.ran);
    expect("the recorded results go to the model", results(h[2]).map((x) => x.text).join("|") === `${JSON.stringify({ ran: "log_visit" })}|${JSON.stringify({ ran: "get_visits" })}`, results(h[2]));
  }

  say("## the checks before a turn");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "tool_use", content: [toolUse("w1", "log_visit", VALID_VISIT), toolUse("w2", "update_places", VALID_STATUS)] });
    await t.turn(t.msg("İkisi"));
    expect("answers for some of the cards → conflict", (await throws(t.turn({ kind: "approval", decisions: { w1: true } }))) === "conflict");
    expect("answers for other calls → conflict", (await throws(t.turn({ kind: "approval", decisions: { w1: true, w9: true } }))) === "conflict");
    expect("Try again while cards wait → conflict", (await throws(t.turn({ kind: "retry" }))) === "conflict");
    expect("nothing written, nothing run, no model call", roles(await t.history()) === "ua" && t.ran.length === 0 && t.client.requests.length === 1);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Tamam.")] });
    expect("the lease was given back each time", (await t.turn({ kind: "approval", decisions: { w1: true, w2: false } })).status === "done");
    expect("Try again after an answer → conflict", (await throws(t.turn({ kind: "retry" }))) === "conflict");
    const open = await openTurn(t.deps, t.conversation.id, t.msg("Selam"));
    expect("an open turn holds the lease", (await throws(t.turn(t.msg("aynı anda")))) === "turn_in_progress");
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Merhaba.")] });
    expect("and runs when asked", (await open.run()).status === "done" && open.history.length === 6, open.history.length);
  }

  say("## Try again after Claude was busy");
  {
    const t = await setup();
    t.client.queue.push({ kind: "api_error", status: 529, type: "overloaded_error" });
    expect("busy", (await throws(t.turn(t.msg("Selam")))) === "busy");
    let rec = (await t.store.load(t.conversation.id)).lastTurn;
    expect("recorded: an error, busy, at the end of the conversation", rec?.status === "error" && rec.code === "busy" && rec.seq === 1, rec);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Merhaba!")] });
    const r = await t.turn({ kind: "retry" });
    const h = await t.history();
    expect("the same message answered, not sent twice", r.status === "done" && roles(h) === "ua" && t.client.requests[1].messages.length === 1, roles(h));
    rec = (await t.store.load(t.conversation.id)).lastTurn;
    expect("recorded: done, at the new end", rec?.status === "done" && rec.code === undefined && rec.seq === 2, rec);
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
    expect("an answer for the call without a card → conflict", (await throws(t.turn({ kind: "approval", decisions: { w1: true, w2: true } }))) === "conflict" && t.ran.length === 0);
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("ok")] });
    await t.turn({ kind: "approval", decisions: { w1: true } });
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

  say("## background work stops at its share; the assistant goes on");
  {
    expect("the assistant and the evals get the whole cap", capFor("chat") === MONTHLY_CAP_USD && capFor("eval") === MONTHLY_CAP_USD);
    expect(
      "profiles and Instagram reads stop at 80% of it",
      capFor("profile") === MONTHLY_CAP_USD * 0.8 && capFor("instagram") === MONTHLY_CAP_USD * 0.8,
      { profile: capFor("profile"), instagram: capFor("instagram") }
    );
    const t = await setup();
    t.ledger.spent = 85;
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Buradayım")] });
    const r = await t.turn(t.msg("Selam"));
    expect("a turn runs past the background share", r.status === "done", r);
  }

  say("## the assistant's owners");
  {
    const before = process.env.ASSISTANT_OWNER_EMAILS;
    process.env.ASSISTANT_OWNER_EMAILS = " Owner@Example.com , second@example.com,";
    expect("an owner, whatever the case and spacing", isAssistantOwner("owner@example.com") && isAssistantOwner(" SECOND@example.com "));
    expect("anyone else isn't", !isAssistantOwner("other@example.com") && !isAssistantOwner(null) && !isAssistantOwner(""));
    delete process.env.ASSISTANT_OWNER_EMAILS;
    expect("no list, no owner (fails closed)", !isAssistantOwner("owner@example.com"));
    if (before === undefined) delete process.env.ASSISTANT_OWNER_EMAILS;
    else process.env.ASSISTANT_OWNER_EMAILS = before;
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

  say("## the panel's view of a stored conversation");
  {
    const history: StoredMessage[] = [
      { seq: 0, role: "user", content: [{ type: "text", text: "<context>Now…</context>" }, { type: "text", text: "Kadıköy brunch?" }] as any },
      { seq: 1, role: "assistant", content: [thinking("s"), toolUse("r1", "search_places", { query: "brunch" })] as any },
      { seq: 2, role: "user", content: [{ type: "tool_result", tool_use_id: "r1", content: JSON.stringify({ total_matches: 2, places: [{ id: "p1", name: "Joie" }, { id: "p2", name: "Neni" }] }) }] as any },
      { seq: 3, role: "assistant", content: [text("İki yer var."), toolUse("w1", "log_visit", VALID_VISIT), toolUse("r3", "get_plans", {})] as any },
      { seq: 4, role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "x", is_error: true }, { type: "tool_result", tool_use_id: "r3", content: "x", is_error: true }, { type: "text", text: "<context>Now…</context>" }, { type: "text", text: "Boşver" }] as any },
      { seq: 5, role: "assistant", content: [text("Peki."), toolUse("w2", "update_places", VALID_STATUS), toolUse("r2", "get_visits", {})] as any },
    ];
    const runs = new Map<string, ToolRun>([
      ["w1", { toolUseId: "w1", name: "log_visit", decision: "not_run", status: "done", outcome: { text: "x", isError: true } }],
      ["r3", { toolUseId: "r3", name: "get_plans", decision: "not_run", status: "done", outcome: { text: "x", isError: true } }],
    ]);
    const quiet = { turnInProgress: false, lastTurn: null };
    const ui = toUIMessages(history, runs, { w2: { title: "Update Cervejaria Ramiro", lines: [{ label: "Status", text: "Visited" }] } }, quiet);
    const parts = (i: number) => ui[i].parts.filter((p: any) => p.type !== "step-start") as any[];
    expect("4 messages: user, assistant (2 steps), user, assistant", ui.map((m) => m.role[0]).join("") === "uaua", ui.map((m) => m.role));
    expect("ids from the stored positions", ui.map((m) => m.id).join(",") === "u0,a1,u4,a5", ui.map((m) => m.id));
    expect("the context block is hidden; the text shows", (parts(0)[0] as any).text === "Kadıköy brunch?");
    expect("one assistant message per turn, a step per model call", ui[1].parts.filter((p) => p.type === "step-start").length === 2);
    const search = parts(1).find((p) => p.toolCallId === "r1");
    expect("a read: done, with places to put on the map, not marked a write", search?.state === "output-available" && search.output.places.length === 2 && search.output.summary === "2 places" && !search.toolMetadata, search);
    const answered = parts(1).find((p) => p.toolCallId === "w1");
    expect("a write answered 'not run' by a new message: not saved, marked a write", answered?.state === "output-denied" && answered.toolMetadata?.write === true, answered);
    expect("a read answered 'not run': skipped, not failed", parts(1).find((p) => p.toolCallId === "r3")?.state === "output-denied");
    const card = parts(3).find((p) => p.toolCallId === "w2");
    expect("the last message's write: a card, with its preview", card?.state === "approval-requested" && card.toolMetadata?.preview?.title === "Update Cervejaria Ramiro", card?.state);
    const waitingRead = parts(3).find((p) => p.toolCallId === "r2");
    expect("a read made with it waits", waitingRead?.state === "input-available");
    expect("no note while a card waits", !ui[3].parts.some((p) => p.type === "data-turn"));
    const answeredCard = { ...ui[3], parts: ui[3].parts.map((p: any) => (p.toolCallId === "w2" ? { ...p, state: "approval-responded", approval: { id: "w2", approved: true } } : p)) };
    expect("the answers go out once every card has one (the waiting read doesn't block it)", approvalsAnswered({ messages: [...ui.slice(0, 3), answeredCard] as AssistantUIMessage[] }) && !approvalsAnswered({ messages: ui }));

    const savingRuns = new Map([...runs, ["w2", { toolUseId: "w2", name: "update_places", decision: "approved", status: "running", outcome: null } as ToolRun]]);
    const saving = toUIMessages(history, savingRuns, {}, { turnInProgress: true, lastTurn: null });
    expect("a card answered and saving (a reload mid-turn): no buttons", (saving[3].parts.find((p: any) => p.toolCallId === "w2") as any)?.state === "approval-responded");
    const crashed = toUIMessages(history, savingRuns, {}, quiet);
    const crashedCard = crashed[3].parts.find((p: any) => p.toolCallId === "w2") as any;
    expect("…and the turn gone (a crash): not 'saving' for ever — interrupted, Try again below", crashedCard?.state === "output-error" && /may or may not/.test(crashedCard.errorText) && (crashed[3].parts.at(-1) as any)?.data?.code === "interrupted", crashedCard);
    const saved = toUIMessages(history, new Map([...runs, ["w2", { toolUseId: "w2", name: "update_places", decision: "approved", status: "done", outcome: { text: JSON.stringify({ updated: 1 }), isError: false } }]]), {}, quiet);
    expect("saved, but the turn broke off before the result was stored: shown saved", (saved[3].parts.find((p: any) => p.toolCallId === "w2") as any)?.state === "output-available");

    expect("a new message's reply id: after the user's message", replyMessageId(history, "message") === "a7");
    expect("an answer's reply: the message with the cards", replyMessageId(history, "approval") === "a5");
    const afterTools: StoredMessage[] = [...history.slice(0, 3)];
    expect("Try again after tool results: the turn's message", replyMessageId(afterTools, "retry") === "a1");
    expect("Try again after the user's message: a new one where the reply goes", replyMessageId(history.slice(0, 1), "retry") === "a1");

    const userOnly = history.slice(0, 1);
    const busyNote = toUIMessages(userOnly, new Map(), {}, { turnInProgress: false, lastTurn: { status: "error", code: "busy", seq: 1 } });
    const note = busyNote.at(-1)?.parts.find((p: any) => p.type === "data-turn") as any;
    expect("a failed turn after a reload: its note, Try again offered, in the reply's message", busyNote.at(-1)?.id === "a1" && note?.data?.code === "busy" && note.data.retry === true && /busy/.test(note.data.message), busyNote);
    const spent = toUIMessages(userOnly, new Map(), {}, { turnInProgress: false, lastTurn: { status: "error", code: "budget_exhausted", seq: 1 } });
    expect("a failure trying again won't fix: no Try again", (spent.at(-1)?.parts[0] as any)?.data?.retry === false);
    const refused = toUIMessages(userOnly, new Map(), {}, { turnInProgress: false, lastTurn: { status: "refused", seq: 1 } });
    expect("a refusal after a reload: its note", (refused.at(-1)?.parts[0] as any)?.data?.status === "refused");
    const broke = toUIMessages(userOnly, new Map(), {}, { turnInProgress: false, lastTurn: { status: "done", seq: 0 } });
    expect("no record of how it ended: 'interrupted', with Try again", (broke.at(-1)?.parts[0] as any)?.data?.code === "interrupted" && (broke.at(-1)?.parts[0] as any)?.data?.retry === true);
    const running = toUIMessages(userOnly, new Map(), {}, { turnInProgress: true, lastTurn: null });
    expect("no note while a turn runs", running.length === 1);
    const stale = toUIMessages(history.slice(0, 4).concat([{ seq: 4, role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "x" }, { type: "tool_result", tool_use_id: "r3", content: "x" }] as any }]), runs, {}, { turnInProgress: false, lastTurn: { status: "error", code: "busy", seq: 2 } });
    expect("a record from earlier in the conversation doesn't describe its end", ((stale.at(-1)?.parts.at(-1) as any)?.data?.code ?? "") === "interrupted", stale.at(-1)?.parts.at(-1));
  }

  say("## ranking: candidates for the model, and the places a reply links to");
  {
    const ranked = uiToolOutput("rank_places", JSON.stringify({ intent: "quiet", total_matches: 42, candidates: 30, places: [{ id: "p1", name: "A" }] }));
    expect("a rank_places row: the candidate count, nothing to put on the map", ranked.summary === "30 candidates" && ranked.places === undefined, ranked);
    const origin = "https://app.example";
    const a = "5f4d1459-4a21-4db2-91ee-319ec76bc27b";
    const b = "11d9588c-0c33-464e-9a29-24f8bbbdd529";
    const reply = [
      `Try [Seaborn](/places/${b}) first, then [Camia](${origin}/places/${a}).`,
      `Also [Seaborn again](/places/${b}) and [on Maps](https://www.google.com/maps/place/?q=place_id:X).`,
      `Elsewhere: [x](https://evil.example/places/${a}), [list](/lists/${a}), see ${origin}/places/${a.toUpperCase()}.`,
    ].join("\n");
    expect("reply links: app place pages only, in order, once each", JSON.stringify(placeIdsIn(reply, origin)) === JSON.stringify([b, a]), placeIdsIn(reply, origin));
    expect("a bare app URL at the end of a sentence counts", JSON.stringify(placeIdsIn(`Here: ${origin}/places/${b}.`, origin)) === JSON.stringify([b]));
    const many = Array.from({ length: 30 }, (_, i) => `[p${i}](/places/${String(i).padStart(8, "0")}-0000-4000-8000-000000000000)`).join(" ");
    expect("at most 25 (what the map takes)", placeIdsIn(many, origin).length === 25);
    expect("the app tells the model to link saved places to their page", /\(\/places\/<id>\)/.test(systemPromptFor("app")));

    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}` }));
    const pool = capWithGuaranteedSeats(rows, new Set(["r35", "r39"]), 30);
    expect("the pool: the best-rated 30, a tagged place below the cut swapped in for the lowest", pool.length === 30 && pool.some((r) => r.id === "r35") && pool.some((r) => r.id === "r39") && !pool.some((r) => r.id === "r29") && !pool.some((r) => r.id === "r28"), pool.map((r) => r.id));
    const flood = capWithGuaranteedSeats(rows, new Set(rows.slice(4).map((r) => r.id)), 10);
    expect("guaranteed seats take at most half the pool", flood.filter((r) => Number(r.id.slice(1)) >= 10).length <= 5, flood.map((r) => r.id));
  }

  say("## a request from a screen: its subject");
  {
    const t = await setup();
    t.client.queue.push({ kind: "message", stop: "end_turn", content: [text("Joie for brunch, Neni for dinner.")] });
    const places: ResolvedSubject = {
      kind: "places",
      places: [
        { id: "11111111-1111-4111-8111-111111111111", name: "Joie" },
        { id: "22222222-2222-4222-8222-222222222222", name: "Neni" },
      ],
    };
    await t.turn({ ...t.msg("Bu yerleri karşılaştır"), subject: places });
    const h = await t.history();
    const blocks = h[0].content as any[];
    expect(
      "the user's message: context, then the subject, then the text",
      blocks.length === 3 && blocks[0].text.startsWith(`<${CONTEXT_TAG}>`) && blocks[1].text.startsWith(`<${SUBJECT_TAG}>`) && blocks[2].text === "Bu yerleri karşılaştır",
      blocks.map((b) => String(b.text).slice(0, 20))
    );
    const json = JSON.parse(blocks[1].text.slice(`<${SUBJECT_TAG}>`.length, -`</${SUBJECT_TAG}>`.length));
    expect("the block names the places with their ids and says what it is", json.kind === "places" && json.places[1].id.startsWith("2222") && typeof json.about === "string", json);
    expect("read back as it was written", JSON.stringify(subjectIn(blocks as any)) === JSON.stringify(places), subjectIn(blocks as any));
    expect("a message without one has none", subjectIn([{ type: "text", text: "Selam" }]) === null);
    expect("a malformed block is ignored, not shown", subjectIn([{ type: "text", text: `<${SUBJECT_TAG}>{oops</${SUBJECT_TAG}>` }]) === null);

    const ui = toUIMessages(h, new Map(), {}, { turnInProgress: false, lastTurn: null });
    const userParts = ui[0].parts as any[];
    expect(
      "the panel: a chip with the names, then the text — no block text, no ids",
      userParts.length === 2 && userParts[0].type === "data-subject" && userParts[0].data.label === "2 places · Joie, Neni" && userParts[0].data.kind === "places" && userParts[1].text === "Bu yerleri karşılaştır",
      userParts
    );
    expect("its reply's id is unchanged by the subject", ui[1].id === "a1" && replyMessageId(h, "retry") === "a1", ui.map((m) => m.id));
    expect("a stored chip carries no request subject", userParts[0].data.subject === undefined);
    const sent = subjectBlock({ kind: "plan", plan: { id: "33333333-3333-4333-8333-333333333333", name: "Lizbon hafta sonu" } });
    expect("a plan's block", sent.text.includes('"kind":"plan"') && sent.text.includes("Lizbon hafta sonu"));

    expect("label: a plan", subjectLabel({ kind: "plan", plan: { id: "x", name: "Lizbon hafta sonu" } }) === "Plan · Lizbon hafta sonu");
    expect("label: one place", subjectLabel({ kind: "places", places: [{ id: "x", name: "Joie" }] }) === "1 place · Joie");
    const long = subjectLabel({ kind: "places", places: ["Bolland & Crust Bakery", "Monmouth Coffee Company", "Prufrock Coffee", "Kiln Soho"].map((name, i) => ({ id: String(i), name })) });
    expect("label: a long list is cut", long.startsWith("4 places · Bolland") && long.endsWith("…") && long.length <= 72, long);
    expect("label: the map with no filters", subjectLabel({ kind: "view", page: "map", filters: {}, area: { lat: 51.5, lng: -0.1, radius_m: 2000 } }) === "Map · this area");
    expect(
      "label: the map's filters",
      subjectLabel({ kind: "view", page: "map", filters: { categories: ["Cafe"], tags: ["laptop"], city: "London" } }) === "Map · Cafe, #laptop, London"
    );
    expect("label: your places", subjectLabel({ kind: "view", page: "places", filters: {} }) === "Your places");
    expect("the app door explains the block (new conversations)", systemPromptFor("app").includes("<subject>"));
  }

  say("## a live turn, as the panel receives it");
  {
    const chunks: any[] = [];
    const writer = { write: (c: unknown) => chunks.push(c), merge: () => undefined, onError: undefined } as any;
    const ui = turnStream(writer, {
      continuing: [],
      // No database here: building the card's preview fails.
      toolCtx: { supabase: null as never, userId: "u", appUrl: "http://localhost" },
      history: [],
    });
    ui.events.text!("Bakıyorum.", 0);
    ui.events.step!({ step: 1, model: "m", stopReason: "tool_use", cost: {} as any, ms: 1, content: [text("Bakıyorum."), toolUse("r1", "search_places", { query: "x" })] as any });
    ui.events.toolResult!({ id: "r1", name: "search_places", text: JSON.stringify({ places: [{ id: "p", name: "P" }] }), isError: false, decision: "auto" });
    ui.events.text!("Önce", 0);
    ui.events.text!(" bir.", 0);
    ui.events.text!("Sonra iki.", 2);
    ui.events.step!({ step: 2, model: "m", stopReason: "tool_use", cost: {} as any, ms: 1, content: [text("Önce bir."), toolUse("w1", "log_visit", VALID_VISIT)] as any });
    ui.events.toolResult!({ id: "old", name: "log_visit", text: "Not run", isError: true, decision: "not_run" });
    await ui.finish({ status: "awaiting_approval", steps: 2, costUsd: 0, pending: [{ id: "w1", name: "log_visit", input: VALID_VISIT, needsApproval: true }], messageCount: 4 });
    const types = chunks.map((c) => c.type + (c.toolCallId ? `:${c.toolCallId}` : ""));
    expect(
      "step, text, the read and its result, a new step with two text blocks, the card after the turn, the outcome",
      types.join(",") ===
        "start-step,text-start,text-delta,text-end,tool-input-available:r1,tool-output-available:r1,finish-step,start-step,text-start,text-delta,text-delta,text-end,text-start,text-delta,text-end,tool-input-available:w1,tool-approval-request:w1,finish-step,data-turn",
      types
    );
    expect("a result for an earlier message's call isn't sent", !types.includes("tool-output-error:old"));
    expect("the card goes out even when its preview can't be built", chunks.some((c) => c.type === "tool-approval-request" && c.approvalId === "w1"));
    expect("the write is marked one; the read isn't", chunks.find((c) => c.type === "tool-input-available" && c.toolCallId === "w1")?.toolMetadata?.write === true && !chunks.find((c) => c.type === "tool-input-available" && c.toolCallId === "r1")?.toolMetadata);
    expect("the outcome carries the conversation's length", chunks.at(-1)?.data?.version === 4, chunks.at(-1));

    const skipped: any[] = [];
    const k = turnStream({ write: (c: unknown) => skipped.push(c) } as any, { continuing: ["r9"], toolCtx: null as never, history: [] });
    k.events.toolResult!({ id: "r9", name: "get_visits", text: "Not run", isError: true, decision: "not_run" });
    expect("a read answered 'not run': skipped, not an error", skipped.some((c) => c.type === "tool-output-denied" && c.toolCallId === "r9"));

    const failed: any[] = [];
    const f = turnStream({ write: (c: unknown) => failed.push(c) } as any, { continuing: [], toolCtx: null as never, history: [] });
    f.fail(new AgentError("budget_exhausted"), 3);
    const turn = failed.find((c) => c.type === "data-turn");
    expect("a failed turn reaches the panel with its code, message and length", turn?.data?.code === "budget_exhausted" && /budget/.test(turn?.data?.message ?? "") && turn.data.version === 3, turn);
    expect("…and no Try again for it", turn?.data?.retry === false);
    const busy: any[] = [];
    turnStream({ write: (c: unknown) => busy.push(c) } as any, { continuing: [], toolCtx: null as never, history: [] }).fail(new AgentError("busy"), 1);
    expect("Claude busy: Try again", busy.find((c) => c.type === "data-turn")?.data?.retry === true);
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
