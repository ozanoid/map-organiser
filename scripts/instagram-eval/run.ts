/**
 * Instagram import regression run — `npm run eval:instagram [-- --set=dev|holdout|all] [--only=<code>]
 * [--model=claude-haiku-5-5|claude-sonnet-5-5] [--effort=low|medium|high]`
 *
 * The post is read by the import's own reader (INSTAGRAM_READER) unless
 * `--model` / `--effort` name another (the Phase 2 6.2 measurement; Gemini,
 * the reader until v1.51.0, was its third arm). Every read is written to
 * assistant_spend with purpose 'eval' under the owner's account, and its
 * cost is printed.
 *
 * Runs the production analyzer (src/lib/instagram/analyze.ts) on labelled
 * posts and compares every place it would add with the ground truth in
 * labels.json. Writes nothing to the library; it does make paid calls
 * (HikerAPI, Google Maps search through DataForSEO, Mapbox geocoding, Claude)
 * — see README.md for the cost.
 *
 * Exit code 1 when any post gets a wrong or spurious place: precision is the
 * contract, recall is reported.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { INSTAGRAM_READER, type Effort } from "@/lib/agent/models";
import { supabaseSpendLedger, type SpendLedger } from "@/lib/agent/spend";
import type { ClaudeChoice } from "@/lib/agent/structured";
import { analyzeInstagramPost } from "@/lib/instagram/analyze";
import type { PostReader } from "@/lib/instagram/read-post";

interface LabelVenue {
  key: string;
  status: "include" | "optional" | "ambiguous" | "not_on_google" | "closed";
  name: string;
  place_id: string | null;
  alt_place_ids: string[] | null;
}
interface LabelPost {
  code: string;
  url: string;
  set: "dev" | "holdout";
  venues: LabelVenue[];
}

const args = process.argv.slice(2);
const setArg = args.find((a) => a.startsWith("--set="))?.split("=")[1] ?? "all";
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1] ?? INSTAGRAM_READER.model;
const effortArg = (args.find((a) => a.startsWith("--effort="))?.split("=")[1] ?? INSTAGRAM_READER.effort) as Effort;
const CLAUDE_MODELS: ClaudeChoice["model"][] = ["claude-haiku-5-5", "claude-sonnet-5-5"];
const claudeModel = CLAUDE_MODELS.find((m) => m === modelArg);
if (!claudeModel) {
  console.error(`--model must be one of ${CLAUDE_MODELS.join(", ")}`);
  process.exit(2);
}

const labels = JSON.parse(readFileSync(join(__dirname, "labels.json"), "utf8")) as LabelPost[];
const posts = labels.filter((p) => (only ? p.code === only : setArg === "all" || p.set === setArg));

if (
  !process.env.DATAFORSEO_LOGIN ||
  !process.env.DATAFORSEO_PASSWORD ||
  !process.env.HIKERAPI_KEY ||
  !process.env.ANTHROPIC_API_KEY
) {
  console.error("Needs DATAFORSEO_LOGIN/PASSWORD, HIKERAPI_KEY and ANTHROPIC_API_KEY (.env.local).");
  process.exit(2);
}

/** The model that reads the posts; a read's cost is counted here as it is
 *  written to the ledger. */
let claudeUsd = 0;
async function postReader(model: ClaudeChoice["model"]): Promise<PostReader> {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const owner = data.users.find((u) => u.email === "ozan@maporganiser.com");
  if (!owner) throw new Error("no owner account");
  const base = supabaseSpendLedger(admin);
  const ledger: SpendLedger = {
    record: async (e) => {
      claudeUsd += e.costUsd;
      await base.record(e);
    },
    monthToDate: (now) => base.monthToDate(now),
  };
  return { choice: { model, effort: effortArg }, spend: { ledger, userId: owner.id, purpose: "eval" } };
}

const ids = (v: LabelVenue) => [v.place_id, ...(v.alt_place_ids ?? [])].filter(Boolean) as string[];

async function main(model: ClaudeChoice["model"]) {
  const reader = await postReader(model);
  const totals = { include: 0, correct: 0, optional: 0, wrong: 0, spurious: 0, unverifiable: 0, errors: 0 };
  const billed: Record<string, number> = {};
  let aiCalls = 0;
  const lines: string[] = [];
  const times: number[] = [];

  for (const post of posts) {
    let analysis;
    const started = Date.now();
    const searchesBefore = Object.entries(billed)
      .filter(([sku]) => sku !== "hikerapi_request")
      .reduce((n, [, c]) => n + c, 0);
    try {
      analysis = await analyzeInstagramPost(post.url, {
        onBilled: (sku) => {
          billed[sku] = (billed[sku] ?? 0) + 1;
        },
        onAiCall: () => {
          aiCalls++;
        },
        reader,
      });
    } catch (e) {
      totals.errors++;
      lines.push(`${post.code}  ERROR ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const ms = Date.now() - started;
    times.push(ms);
    const searches =
      Object.entries(billed)
        .filter(([sku]) => sku !== "hikerapi_request")
        .reduce((n, [, c]) => n + c, 0) - searchesBefore;
    const adds = analysis.decisions.filter((d) => d.outcome === "add" && d.place);
    const include = post.venues.filter((v) => v.status === "include");
    totals.include += include.length;
    const hit = new Set<LabelVenue>();
    const notes: string[] = [];
    for (const d of adds) {
      const placeId = d.place!.id;
      const inc = include.find((v) => ids(v).includes(placeId));
      if (inc) {
        if (!hit.has(inc)) totals.correct++;
        hit.add(inc);
        continue;
      }
      if (post.venues.some((v) => v.status === "optional" && ids(v).includes(placeId))) {
        totals.optional++;
        notes.push(`optional ${d.label}`);
        continue;
      }
      const sameKey = post.venues.find((v) => v.key.replace(/^(owner:)?@/, "") === d.key);
      if (sameKey && (sameKey.status === "include" || sameKey.status === "optional")) {
        totals.wrong++;
        notes.push(`WRONG ${d.label} → ${d.place!.name} (expected ${sameKey.name})`);
      } else if (sameKey) {
        totals.unverifiable++;
        notes.push(`UNVERIFIABLE ${d.label} → ${d.place!.name} (${sameKey.status})`);
      } else {
        totals.spurious++;
        notes.push(`SPURIOUS ${d.label} → ${d.place!.name}`);
      }
    }
    for (const v of include) {
      if (hit.has(v)) continue;
      // Say why: the LLM's role for the account, or the resolver's skip reason.
      const handle = v.key.replace(/^(owner:)?@/, "");
      const d = analysis.decisions.find((x) => x.key === handle || (v.key.startsWith("text:") && x.kind === "text"));
      const read = analysis.reading.accounts.find((a) => a.username.toLowerCase() === handle);
      const why = d
        ? `${d.outcome} ${d.reason ?? ""} role=${d.role ?? "-"}`
        : read
          ? `role=${read.role} featured=${read.featured}`
          : "no candidate";
      notes.push(`miss ${v.key} (${why.trim()})`);
    }
    lines.push(
      `${post.code}  ${hit.size}/${include.length}  ${(ms / 1000).toFixed(1)}s ${searches} searches  ${notes.join("; ") || "ok"}`
    );
  }

  console.log(lines.join("\n"));
  const added = totals.correct + totals.wrong + totals.spurious + totals.unverifiable;
  console.log(
    `\nposts ${posts.length} (${setArg}${only ? ` only=${only}` : ""}) · errors ${totals.errors}\n` +
      `places to add ${totals.include} · added ${added + totals.optional} = correct ${totals.correct} + optional ${totals.optional} + WRONG ${totals.wrong} + SPURIOUS ${totals.spurious} + UNVERIFIABLE ${totals.unverifiable}\n` +
      `precision ${added ? ((100 * totals.correct) / added).toFixed(1) : "-"}% · recall ${totals.include ? ((100 * totals.correct) / totals.include).toFixed(1) : "-"}%\n` +
      `billed: ${Object.entries(billed)
        .map(([sku, n]) => `${sku} ${n}`)
        .join(" · ")} · ${model} (${effortArg}) ${aiCalls} calls, $${claudeUsd.toFixed(4)}\n` +
      `time per post: mean ${(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length) / 1000).toFixed(1)}s · ` +
      `median ${((times.sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0) / 1000).toFixed(1)}s · ` +
      `max ${(Math.max(0, ...times) / 1000).toFixed(1)}s`
  );
  if (totals.wrong + totals.spurious + totals.unverifiable > 0) process.exit(1);
}

main(claudeModel).catch((e) => {
  console.error(e);
  process.exit(2);
});
