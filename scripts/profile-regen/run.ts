/**
 * Phase 2, 6.3: rewrite the existing place profiles with the chosen writer
 * (PROFILE_WRITER — Claude Sonnet 5.5 at medium; Ozan, 24.11.2026). Plain
 * calls, no Batch API (cost isn't the concern at this size).
 *
 *   npm run regen:profiles -- --dry-run               how many, no calls
 *   npm run regen:profiles                            rewrite the profiles only
 *   npm run regen:profiles -- --apply-suggestions     also re-run the auto-apply (tags,
 *                                                     sub-category; category moves queued)
 *   npm run regen:profiles -- --limit=20 --concurrency=4
 *
 * Every place with stored reviews whose profile PROFILE_WRITER didn't write,
 * across every account — so a run that stops can simply be run again. Goes
 * through generatePlaceProfile: each owner's AI switch, the monthly cap (the
 * run stops there), the ledger (purpose 'profile'). Progress on stdout.
 *
 * Before the first write the profiles it is about to replace are saved to
 * scripts/profile-regen/out/backup-<time>.json (git-ignored): a rewrite
 * can't be undone from the database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PROFILE_WRITER } from "@/lib/agent/models";
import { generatePlaceProfile } from "@/lib/ai/generate-profile";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const applySuggestions = args.includes("--apply-suggestions");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 4));
const PAGE = 1000;

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  type Row = { id: string; user_id: string; name: string; mv: string | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("places")
      .select("id, user_id, name, mv:google_data->place_profile->>model_version")
      .not("google_data->reviews", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  const todo = rows.filter((r) => r.mv !== PROFILE_WRITER.model).slice(0, limit);
  console.log(
    `# ${todo.length} profiles to write with ${PROFILE_WRITER.model} (${PROFILE_WRITER.effort})` +
      ` — ${rows.length} places with reviews, ${rows.length - rows.filter((r) => r.mv !== PROFILE_WRITER.model).length} done already;` +
      ` suggestions ${applySuggestions ? "applied" : "not applied"}; ${concurrency} at a time`
  );
  if (dryRun) return;

  const started = new Date().toISOString();
  const backup: { id: string; user_id: string; name: string; place_profile: unknown }[] = [];
  for (let i = 0; i < todo.length; i += 200) {
    const { data, error } = await admin
      .from("places")
      .select("id, user_id, name, place_profile:google_data->place_profile")
      .in("id", todo.slice(i, i + 200).map((r) => r.id));
    if (error) throw error;
    backup.push(...(data as typeof backup));
  }
  const outDir = join(process.cwd(), "scripts/profile-regen/out");
  mkdirSync(outDir, { recursive: true });
  const backupFile = join(outDir, `backup-${started.replace(/[:.]/g, "-")}.json`);
  writeFileSync(backupFile, JSON.stringify(backup, null, 1));
  console.log(`# ${backup.length} current profiles saved to ${backupFile}`);
  const counts: Record<string, number> = {};
  let next = 0;
  let stop: string | null = null;
  const work = async () => {
    while (!stop && next < todo.length) {
      const i = next++;
      const r = todo[i];
      const t0 = Date.now();
      try {
        const out = await generatePlaceProfile(admin, r.user_id, r.id, { applySuggestions });
        const key = out.ok ? "written" : out.reason;
        counts[key] = (counts[key] ?? 0) + 1;
        console.log(`${String(i + 1).padStart(4)}/${todo.length}  ${key.padEnd(13)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${r.name}`);
        if (!out.ok && (out.reason === "cap_exceeded" || out.reason === "not_configured")) stop = out.reason;
      } catch (e) {
        counts.error = (counts.error ?? 0) + 1;
        console.log(`${String(i + 1).padStart(4)}/${todo.length}  ERROR         ${r.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));

  const { data: spend } = await admin.from("assistant_spend").select("cost_usd").eq("purpose", "profile").gte("created_at", started);
  const usd = (spend ?? []).reduce((a, s) => a + Number(s.cost_usd), 0);
  console.log(`\n${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(" · ")} · spent $${usd.toFixed(2)}${stop ? ` · stopped: ${stop}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
