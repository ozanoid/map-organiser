/**
 * The agent's Supabase store and spend ledger against the live database —
 * without writing anything. Every call names a conversation that doesn't
 * exist: reads come back empty, updates touch no row, inserts are refused by
 * the foreign key. What it proves is that each query the store sends is one
 * the database accepts (table and column names, the lease's filter, value
 * types) and that the refusals come back as the store expects.
 *
 *   npm run check:agent:db
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AgentError } from "@/lib/agent/errors";
import { monthSpendByPurpose, SPEND_PURPOSES, supabaseSpendLedger } from "@/lib/agent/spend";
import { supabaseConversationStore } from "@/lib/agent/store";

const OWNER = "ozan@maporganiser.com";
const say = (line = "") => process.stderr.write(`${line}\n`);
let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  say(`   ${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    const value = await p;
    return `ok:${JSON.stringify(value ?? null)}`;
  } catch (e) {
    if (e instanceof AgentError) return `agent:${e.code}`;
    const code = (e as { code?: string }).code;
    return code ? `pg:${code}` : `error:${(e as Error).message}`;
  }
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const userId = data.users.find((u) => u.email === OWNER)?.id;
  if (!userId) throw new Error(`no user ${OWNER}`);

  const store = supabaseConversationStore(admin, userId);
  const ghost = randomUUID();
  const done = { text: "x", isError: false };

  say("## the store, on a conversation that doesn't exist");
  expect("load → not_found", (await outcome(store.load(ghost))) === "agent:not_found");
  expect("takeTurn (the lease's filter runs) → not_found", (await outcome(store.takeTurn(ghost, 60_000))) === "agent:not_found");
  expect("releaseTurn → touches nothing", (await outcome(store.releaseTurn(ghost))) === "ok:null");
  expect(
    "recordTurn (an error with its code) → touches nothing",
    (await outcome(store.recordTurn(ghost, { status: "error", code: "busy", seq: 0 }))) === "ok:null"
  );
  expect("toolRuns → []", (await outcome(store.toolRuns(ghost, ["toolu_x"]))) === "ok:[]");
  expect("toolRuns with no ids → [] without a query", (await outcome(store.toolRuns(ghost, []))) === "ok:[]");
  const claim = await outcome(
    store.startToolRuns(ghost, [
      { toolUseId: "toolu_a", name: "log_visit", decision: "approved" },
      { toolUseId: "toolu_b", name: "search_places", decision: "not_run", outcome: { text: "Not run", isError: true } },
    ])
  );
  expect("startToolRuns (running + done rows) → refused by the foreign key only", claim === "pg:23503", claim);
  expect("finishToolRun → touches nothing", (await outcome(store.finishToolRun(ghost, "toolu_a", done))) === "ok:null");
  const append = await outcome(store.append(ghost, { seq: 0, role: "user", content: [{ type: "text", text: "x" }] }));
  expect("append → refused by the foreign key only", append === "pg:23503", append);

  say("## the store, read-only on the user's own rows");
  const latest = await outcome(store.latest("app"));
  expect("latest (ordered by when it was opened) → a conversation or none", /^ok:(null|\{)/.test(latest), latest);

  say("## the ledger");
  const spent = await outcome(supabaseSpendLedger(admin).monthToDate());
  expect("monthToDate → a number", /^ok:\d+(\.\d+)?$/.test(spent), spent);
  say(`   (this month so far: $${spent.replace("ok:", "")})`);
  // Settings → usage: the month split by purpose adds up to the cap's figure.
  const byPurpose = await monthSpendByPurpose(admin);
  const keys = Object.keys(byPurpose).sort().join(",");
  expect("monthSpendByPurpose → every purpose", keys === [...SPEND_PURPOSES].sort().join(","), keys);
  const parts = Object.values(byPurpose).reduce((a, b) => a + b, 0);
  const total = Number(spent.replace("ok:", ""));
  expect("…and its parts add up to monthToDate", Math.abs(parts - total) < 1e-6, { parts, total });
  say(`   (${SPEND_PURPOSES.map((p) => `${p} $${byPurpose[p].toFixed(2)}`).join(" · ")})`);

  say();
  say(failures ? `${failures} FAILED` : "all passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  say(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
