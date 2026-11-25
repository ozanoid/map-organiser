/**
 * Paid eval of the platform's Claude agent (docs/_plans/phase-2-assistant.md):
 * real requests against Ozan's library (or the test account's, where a case
 * says so), through the same loop the app uses (src/lib/agent/run-turn.ts),
 * on a model and effort.
 *
 *   npm run eval:assistant -- --count-tokens                     free: the fixed prompt size
 *   npm run eval:assistant -- --config opus-medium               all cases
 *   npm run eval:assistant -- --config sonnet-high --cases visit-log,laptop-cafe
 *   npm run eval:assistant -- --config opus-low --max-usd 2      stop before a case once the run has spent $2
 *   npm run eval:assistant -- --config sonnet-high --cases spread-plan-keeps-dates --repeat 3
 *                                                                each case three times — for a behaviour that varies
 *
 * Nothing is written to the library: a call that saves something stops at
 * the approval card (recorded, never run), or is declined (the case says
 * which). Conversations stay in memory. Every Claude call is written to
 * assistant_spend with purpose 'eval', so the eval counts toward the
 * monthly cap. Read tools run for real; search_google_maps makes its own
 * (small) paid call, counted in api_usage as usual.
 *
 * The full transcript of each run goes to scripts/assistant-eval/out/
 * (git-ignored: it holds library content). Progress and the summary are
 * printed on stderr — stdout carries the app's JSON log lines.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { textOf, toolCallsIn } from "@/lib/agent/history";
import type { Effort } from "@/lib/agent/models";
import { FALLBACK_BETA } from "@/lib/agent/models";
import { systemPromptFor } from "@/lib/agent/prompt";
import { runTurn, startConversation, type TurnInput, type TurnResult } from "@/lib/agent/run-turn";
import { supabaseSpendLedger } from "@/lib/agent/spend";
import { memoryConversationStore } from "@/lib/agent/store";
import { resolveSubject } from "@/lib/agent/subject";
import { agentToolDefinitions } from "@/lib/agent/tools";
import type { ResolvedSubject } from "@/lib/agent/ui-types";
import type { AssistantContext } from "@/lib/assistant/library";
import { CHECK_APP_URL } from "../assistant-check/context";
import { CASES, type EvalCase, type TurnSubject } from "./cases";

const ACCOUNTS: Record<NonNullable<EvalCase["user"]>, string> = {
  owner: "ozan@maporganiser.com",
  test: "admin@maporganiser.com",
};
const TIME_ZONE = "Europe/London";

const CONFIGS: Record<string, { model: string; effort: Effort }> = {
  "opus-medium": { model: "claude-opus-5-5", effort: "medium" },
  "opus-low": { model: "claude-opus-5-5", effort: "low" },
  "sonnet-high": { model: "claude-sonnet-5-5", effort: "high" },
  "sonnet-medium": { model: "claude-sonnet-5-5", effort: "medium" },
};

const say = (line = "") => process.stderr.write(`${line}\n`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function userIdOf(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`no user ${email}`);
  return user.id;
}

/** A case's subject as the chat route sends it on: found by name in the
 *  case's library, then checked and named like a screen's (resolveSubject). */
async function subjectOf(ctx: AssistantContext, subject: TurnSubject | undefined): Promise<ResolvedSubject | undefined> {
  if (!subject) return undefined;
  const { data, error } = await ctx.supabase.from("plans").select("id").eq("user_id", ctx.userId).eq("name", subject.name).limit(2);
  if (error) throw error;
  if (data.length !== 1) throw new Error(`plan "${subject.name}": ${data.length} in the library, want exactly one`);
  return resolveSubject(ctx, { kind: "plan", planId: data[0].id as string });
}

interface TurnRecord {
  input: string;
  status: TurnResult["status"] | "error";
  error?: string;
  steps: number;
  costUsd: number;
  ms: number;
  firstTextMs: number | null;
  tools: { id: string; name: string; input: unknown; isError?: boolean; result?: string }[];
  webSearches: string[];
  pending: { name: string; input: unknown; needsApproval: boolean }[];
  reply: string;
  stepLog: {
    model: string;
    stopReason: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    webSearches: number;
    /** Block types of the stored content; server tools with their caller. */
    blocks: string[];
    /** The text this step wrote — where in the turn a sentence appeared. */
    text: string;
    ms: number;
  }[];
}

interface CaseRecord {
  id: string;
  /** Which run of the case (--repeat), from 1. */
  run: number;
  lang: EvalCase["lang"];
  turns: TurnRecord[];
  costUsd: number;
  /** custom: why the case's own check failed, or null. */
  checks: { tools: boolean; write: boolean | null; lang: boolean | null; custom: string | null; ok: boolean };
}

/** Rough language check on the final reply: Turkish vs English function
 *  words, counted as whole words ("you've" is one word, not "ve"). Place
 *  names with Turkish or Portuguese letters don't sway it. */
const TR_WORDS = new Set(["ve", "bir", "için", "ama", "bu", "çok", "daha", "ile", "gibi", "olarak", "var", "yok", "değil", "mi", "mı", "da", "de", "en", "sen", "senin"]);
const EN_WORDS = new Set(["the", "and", "you", "your", "to", "of", "is", "for", "in", "it", "with", "on", "are", "a", "at"]);
function looksTurkish(text: string): boolean {
  const words = text.toLocaleLowerCase("tr").split(/[^\p{L}']+/u);
  const tr = words.filter((w) => TR_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  return tr > en;
}

function grade(c: EvalCase, turns: TurnRecord[]): CaseRecord["checks"] {
  const called = new Set(turns.flatMap((t) => [...t.tools.map((x) => x.name), ...t.webSearches.map(() => "web_search")]));
  for (const t of turns) for (const p of t.pending) called.add(p.name);
  const tools = c.expectTools.every((group) => group.some((name) => called.has(name)));
  const write = c.expectWrite ? turns.some((t) => t.pending.some((p) => p.name === c.expectWrite)) : null;
  // A turn that ends at an approval card may have no text (the card speaks);
  // the language is judged on the last turn that said something.
  const last = [...turns].reverse().find((t) => t.reply);
  const lang = last ? looksTurkish(last.reply) === (c.lang === "tr") : null;
  const errors = turns.some((t) => t.status === "error");
  const custom = c.check?.(turns.flatMap((t) => t.pending.map((p) => ({ name: p.name, input: p.input })))) ?? null;
  return { tools, write, lang, custom, ok: tools && write !== false && lang !== false && !custom && !errors };
}

/** Why a case failed, for the summary line. */
function failures(checks: CaseRecord["checks"], turns: TurnRecord[]): string {
  return [
    !checks.tools && "tools",
    checks.write === false && "write",
    checks.lang === false && "lang",
    checks.custom && `check: ${checks.custom}`,
    turns.some((t) => t.status === "error") && "error",
  ]
    .filter(Boolean)
    .join("; ");
}

async function countTokens(client: Anthropic) {
  const tools = agentToolDefinitions();
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
    const res = await client.beta.messages.countTokens({
      model,
      system: systemPromptFor("app"),
      tools,
      messages: [{ role: "user", content: "hi" }],
      betas: [FALLBACK_BETA],
    });
    say(`${model}: system + ${tools.length} tools + "hi" = ${res.input_tokens} input tokens`);
  }
}

async function runCase(
  c: EvalCase,
  run: number,
  config: { model: string; effort: Effort },
  deps: Omit<Parameters<typeof runTurn>[0], "store" | "effort">
): Promise<CaseRecord> {
  const store = memoryConversationStore();
  const conversation = await startConversation(store, { userId: deps.toolCtx.userId, door: "app", model: config.model });
  const turns: TurnRecord[] = [];

  for (const turn of c.turns) {
    const prev = turns.at(-1);
    if (turn.kind === "message" && prev?.status === "awaiting_approval") {
      // The case moves on only with a decline; a new message would answer
      // the card with "not run", which is not what we test here.
      break;
    }
    if (turn.kind === "decline" && prev?.status !== "awaiting_approval") break;

    const input: TurnInput =
      turn.kind === "message"
        ? { kind: "message", text: turn.text, timeZone: TIME_ZONE, subject: await subjectOf(deps.toolCtx, turn.subject) }
        : { kind: "approval", decisions: {} };
    const record: TurnRecord = {
      input: turn.kind === "message" ? turn.text : "(declines the card)",
      status: "error",
      steps: 0,
      costUsd: 0,
      ms: 0,
      firstTextMs: null,
      tools: [],
      webSearches: [],
      pending: [],
      reply: "",
      stepLog: [],
    };
    const started = Date.now();
    const replies: string[] = [];
    try {
      const result = await runTurn({ ...deps, store, effort: config.effort }, conversation.id, input, {
        text: () => {
          record.firstTextMs ??= Date.now() - started;
        },
        step: (info) => {
          record.stepLog.push({
            model: info.model,
            stopReason: info.stopReason,
            inputTokens: info.cost.inputTokens,
            outputTokens: info.cost.outputTokens,
            cacheReadTokens: info.cost.cacheReadTokens,
            cacheWriteTokens: info.cost.cacheWriteTokens,
            costUsd: info.cost.costUsd,
            webSearches: info.cost.webSearches,
            blocks: info.content.map((block) =>
              block.type === "server_tool_use"
                ? `server_tool_use(${block.name}${block.caller ? `, from ${block.caller.type}` : ""})`
                : block.type
            ),
            text: textOf(info.content),
            ms: info.ms,
          });
          for (const block of info.content) {
            if (block.type === "server_tool_use" && block.name === "web_search") {
              record.webSearches.push(String((block.input as { query?: unknown })?.query ?? ""));
            }
          }
          for (const call of toolCallsIn(info.content)) record.tools.push({ id: call.id, name: call.name, input: call.input });
          const text = textOf(info.content);
          if (text) replies.push(text);
        },
        toolResult: (r) => {
          // Calls answered on a card were made in the previous turn.
          let call = record.tools.find((t) => t.id === r.id);
          if (!call) record.tools.push((call = { id: r.id, name: r.name, input: "(from the previous turn)" }));
          call.isError = r.isError;
          call.result = r.text.slice(0, 600);
        },
      });
      record.status = result.status;
      record.steps = result.steps;
      record.costUsd = result.costUsd;
      record.pending = result.pending.map((p) => ({ name: p.name, input: p.input, needsApproval: p.needsApproval }));
      // A pending call is listed under pending only.
      const pendingIds = new Set(result.pending.map((p) => p.id));
      record.tools = record.tools.filter((t) => !pendingIds.has(t.id));
    } catch (e) {
      record.error = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
      record.costUsd = record.stepLog.reduce((sum, s) => sum + s.costUsd, 0);
    }
    record.ms = Date.now() - started;
    record.reply = replies.join("\n\n");
    turns.push(record);
  }

  const costUsd = turns.reduce((sum, t) => sum + t.costUsd, 0);
  return { id: c.id, run, lang: c.lang, turns, costUsd, checks: grade(c, turns) };
}

async function main() {
  const client = new Anthropic();
  if (process.argv.includes("--count-tokens")) return countTokens(client);

  const configName = arg("config") ?? "opus-medium";
  const config = CONFIGS[configName];
  if (!config) throw new Error(`unknown config ${configName}; one of ${Object.keys(CONFIGS).join(", ")}`);
  const only = arg("cases")?.split(",");
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  if (only && cases.length !== only.length) throw new Error(`unknown case in ${only.join(",")}`);
  const maxUsd = Number(arg("max-usd") ?? "Infinity");
  const repeat = Math.max(1, Math.floor(Number(arg("repeat") ?? "1")) || 1);

  // Only the accounts the cases run on are looked up.
  const userIds = new Map<NonNullable<EvalCase["user"]>, string>();
  for (const who of new Set(cases.map((c) => c.user ?? "owner"))) userIds.set(who, await userIdOf(ACCOUNTS[who]));
  const depsFor = (c: EvalCase) => ({
    client,
    ledger: supabaseSpendLedger(admin),
    toolCtx: { supabase: admin, userId: userIds.get(c.user ?? "owner")!, appUrl: CHECK_APP_URL },
    purpose: "eval" as const,
  });

  say(`# ${configName} (${config.model}, effort ${config.effort}) — ${cases.length} cases${repeat > 1 ? ` × ${repeat}` : ""}`);
  const results: CaseRecord[] = [];
  let spent = 0;
  runs: for (const c of cases) {
    for (let run = 1; run <= repeat; run++) {
      if (spent >= maxUsd) {
        say(`stopping: $${spent.toFixed(3)} spent, limit $${maxUsd}`);
        break runs;
      }
      const r = await runCase(c, run, config, depsFor(c));
      spent += r.costUsd;
      results.push(r);
      const t = r.turns;
      const label = repeat > 1 ? `${c.id} #${run}` : c.id;
      say(
        `${r.checks.ok ? "PASS" : "FAIL"} ${label.padEnd(22)} $${r.costUsd.toFixed(3)}  ${t
          .map((x) => `${x.status}/${x.steps} steps/${(x.ms / 1000).toFixed(1)}s`)
          .join(" → ")}  tools: ${[...new Set(t.flatMap((x) => [...x.tools.map((y) => y.name), ...x.webSearches.map(() => "web_search")]))].join(",") || "—"}${
          t.some((x) => x.pending.length)
            ? `  proposes: ${t.flatMap((x) => x.pending.map((p) => p.name)).join(",")}${t.some((x) => x.pending.length && !x.reply) ? " (no text)" : ""}`
            : ""
        }${r.checks.ok ? "" : `  FAILED: ${failures(r.checks, t)}`}${t.some((x) => x.error) ? `  ERROR ${t.find((x) => x.error)!.error}` : ""}`
      );
    }
  }

  const outDir = join(process.cwd(), "scripts/assistant-eval/out");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${configName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ config: configName, ...config, results }, null, 2));

  const turns = results.flatMap((r) => r.turns);
  const passed = results.filter((r) => r.checks.ok).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  say();
  say(`passed ${passed}/${results.length}; spent $${spent.toFixed(3)} (${(spent / Math.max(results.length, 1)).toFixed(3)}/case)`);
  say(`turn time avg ${(avg(turns.map((t) => t.ms)) / 1000).toFixed(1)}s; first text avg ${(avg(turns.flatMap((t) => (t.firstTextMs ? [t.firstTextMs] : []))) / 1000).toFixed(1)}s`);
  say(`transcript: ${file}`);
}

main().catch((e) => {
  say(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
