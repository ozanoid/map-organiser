/**
 * Who writes place profiles — Gemini (today), Claude Haiku 5.5 or Claude
 * Sonnet 5.5 (Phase 2, 6.2: docs/_plans/phase-2-assistant.md). Every writer
 * gets the same prompts (profileInputs); nothing is saved and no suggestion
 * is applied.
 *
 *   npm run eval:profiles                                       the three writers, places.json
 *   npm run eval:profiles -- --writers=claude-haiku-5-5:high    one or more writers, comma-separated
 *
 * Paid. A Claude call is written to assistant_spend (purpose 'eval', the
 * owner's account); a Gemini call isn't recorded here (its SKU price is
 * $0.0095 a profile). The writers run one after another, each over every
 * place, so a Claude writer reads the shared instructions from the cache.
 *
 * Out: scripts/profile-eval/out/<time>.json — every profile and its
 * measures (git-ignored: it holds library content). Progress on stderr.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Effort } from "@/lib/agent/models";
import { supabaseSpendLedger, type SpendLedger } from "@/lib/agent/spend";
import type { ClaudeChoice } from "@/lib/agent/structured";
import { profileInputs, writeProfile, type ProfileWriter, type WriteInfo } from "@/lib/ai/generate-profile";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";

const OWNER = "ozan@maporganiser.com";
const DEFAULT_WRITERS = "gemini,claude-haiku-5-5:high,claude-sonnet-5-5:medium";
const say = (line = "") => process.stderr.write(`${line}\n`);

const places = JSON.parse(readFileSync(join(__dirname, "places.json"), "utf8")) as { id: string; name: string; why: string }[];
const writerKeys = (process.argv.find((a) => a.startsWith("--writers="))?.split("=")[1] ?? DEFAULT_WRITERS).split(",");

/** For matching a quote against the reviews: case, spacing, quote marks and
 *  edge punctuation don't count. */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’“”"'`´]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:!?…-]+|[\s.,;:!?…-]+$/g, "")
    .trim();
}

interface Measures {
  quotes: number;
  quotesFound: number;
  /** Quotes not found in any review — for reading. */
  quotesMissing: string[];
  conceptEvidence: number;
  conceptEvidenceFound: number;
  pros: number;
  cons: number;
  themes: number;
  tldrChars: number;
  summaryChars: number;
  category: string;
  subCategory: string | null;
  tags: string[];
}

function measure(profile: PlaceProfile, reviews: string, tagName: (id: string) => string): Measures {
  const quotes = (profile.theme_insights ?? []).flatMap((t) => t.evidence_quotes);
  const missing = quotes.filter((q) => !reviews.includes(norm(q)));
  const evidence = (profile.matched_concepts ?? []).map((c) => c.evidence).filter(Boolean);
  return {
    quotes: quotes.length,
    quotesFound: quotes.length - missing.length,
    quotesMissing: missing,
    conceptEvidence: evidence.length,
    conceptEvidenceFound: evidence.filter((e) => reviews.includes(norm(e))).length,
    pros: profile.pros?.length ?? 0,
    cons: profile.cons?.length ?? 0,
    themes: profile.theme_insights?.length ?? 0,
    tldrChars: profile.tldr?.length ?? 0,
    summaryChars: profile.searchable_summary?.length ?? 0,
    category: profile.category_signals.primary,
    subCategory: profile.category_signals.sub_category,
    tags: profile.suggested_tags.matched_existing.map(tagName),
  };
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const owner = data.users.find((u) => u.email === OWNER)?.id;
  if (!owner) throw new Error(`no user ${OWNER}`);

  let claudeUsd = 0;
  const base = supabaseSpendLedger(admin);
  const ledger: SpendLedger = {
    record: async (e) => {
      claudeUsd += e.costUsd;
      await base.record(e);
    },
    monthToDate: (now) => base.monthToDate(now),
  };
  const writerOf = (key: string): ProfileWriter => {
    if (key === "gemini") return { kind: "gemini" };
    const [model, effort] = key.split(":") as [ClaudeChoice["model"], Effort | undefined];
    if (model !== "claude-haiku-5-5" && model !== "claude-sonnet-5-5") throw new Error(`unknown writer ${key}`);
    return { kind: "claude", choice: { model, effort: effort ?? "high" }, spend: { ledger, userId: owner, purpose: "eval" } };
  };

  say(`# profiles: ${places.length} places × ${writerKeys.join(", ")}`);
  const inputs = new Map<string, Awaited<ReturnType<typeof profileInputs>>>();
  for (const p of places) inputs.set(p.id, await profileInputs(admin, owner, p.id));

  type Row = { ok: true; info: WriteInfo; measures: Measures; profile: PlaceProfile } | { ok: false; error: string; ms: number };
  const results: Record<string, Record<string, Row>> = {};
  for (const key of writerKeys) {
    const writer = writerOf(key);
    results[key] = {};
    const usdBefore = claudeUsd;
    for (const p of places) {
      const input = inputs.get(p.id)!;
      if ("reason" in input) {
        results[key][p.id] = { ok: false, error: input.reason, ms: 0 };
        say(`${key.padEnd(26)} ${p.name.padEnd(36)} SKIP ${input.reason}`);
        continue;
      }
      const started = Date.now();
      try {
        const { profile, info } = await writeProfile(input, writer, { userId: owner, placeId: p.id });
        const reviews = norm(input.reviewTexts.join(" \n "));
        const tagName = (id: string) => input.userContext.tags.find((t) => t.id === id)?.name ?? id;
        const m = measure(profile, reviews, tagName);
        results[key][p.id] = { ok: true, info, measures: m, profile };
        say(
          `${key.padEnd(26)} ${p.name.padEnd(36)} ${(info.ms / 1000).toFixed(1)}s  quotes ${m.quotesFound}/${m.quotes}  ` +
            `pros ${m.pros} cons ${m.cons} themes ${m.themes}  ${m.category}/${m.subCategory ?? "-"}  ` +
            `in ${info.inputTokens} out ${info.outputTokens} (thinking ${info.thinkingTokens})` +
            (info.costUsd !== null ? `  $${info.costUsd.toFixed(4)}` : "")
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results[key][p.id] = { ok: false, error: message, ms: Date.now() - started };
        say(`${key.padEnd(26)} ${p.name.padEnd(36)} FAILED ${message}`);
      }
    }
    const rows = Object.values(results[key]);
    const ok = rows.filter((r): r is Extract<Row, { ok: true }> => r.ok);
    const quotes = ok.reduce((n, r) => n + r.measures.quotes, 0);
    const found = ok.reduce((n, r) => n + r.measures.quotesFound, 0);
    say(
      `= ${key}: ${ok.length}/${rows.length} profiles · quotes found in the reviews ${found}/${quotes}` +
        ` · mean ${(ok.reduce((n, r) => n + r.info.ms, 0) / Math.max(1, ok.length) / 1000).toFixed(1)}s` +
        (key === "gemini" ? ` · ~$${(ok.length * 0.0095).toFixed(3)} (SKU price)` : ` · $${(claudeUsd - usdBefore).toFixed(4)}`) +
        "\n"
    );
  }

  const outDir = join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ writers: writerKeys, places, results }, null, 2));
  say(`claude spend $${claudeUsd.toFixed(4)}`);
  say(`out: ${file}`);
}

main().catch((e) => {
  say(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
