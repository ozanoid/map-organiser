/**
 * Instagram import regression run — `npm run eval:instagram [-- --set=dev|holdout|all] [--only=<code>]`
 *
 * Runs the production analyzer (src/lib/instagram/analyze.ts) on labelled
 * posts and compares every place it would add with the ground truth in
 * labels.json. Writes nothing to the database; it does make paid calls
 * (HikerAPI, Google Text Search, Gemini) — see README.md for the cost.
 *
 * Exit code 1 when any post gets a wrong or spurious place: precision is the
 * contract, recall is reported.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeInstagramPost } from "@/lib/instagram/analyze";

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

const labels = JSON.parse(readFileSync(join(__dirname, "labels.json"), "utf8")) as LabelPost[];
const posts = labels.filter((p) => (only ? p.code === only : setArg === "all" || p.set === setArg));

const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!googleApiKey || !process.env.HIKERAPI_KEY || !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error("Needs GOOGLE_PLACES_API_KEY, HIKERAPI_KEY and GOOGLE_GENERATIVE_AI_API_KEY (.env.local).");
  process.exit(2);
}

const ids = (v: LabelVenue) => [v.place_id, ...(v.alt_place_ids ?? [])].filter(Boolean) as string[];

async function main() {
  const totals = { include: 0, correct: 0, optional: 0, wrong: 0, spurious: 0, unverifiable: 0, errors: 0 };
  const billed = { hikerapi_request: 0, text_search_enterprise: 0 };
  const lines: string[] = [];

  for (const post of posts) {
    let analysis;
    try {
      analysis = await analyzeInstagramPost(post.url, {
        googleApiKey: googleApiKey!,
        userId: "eval",
        onBilled: (sku) => {
          billed[sku]++;
        },
      });
    } catch (e) {
      totals.errors++;
      lines.push(`${post.code}  ERROR ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
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
    lines.push(`${post.code}  ${hit.size}/${include.length}  ${notes.join("; ") || "ok"}`);
  }

  console.log(lines.join("\n"));
  const added = totals.correct + totals.wrong + totals.spurious + totals.unverifiable;
  console.log(
    `\nposts ${posts.length} (${setArg}${only ? ` only=${only}` : ""}) · errors ${totals.errors}\n` +
      `places to add ${totals.include} · added ${added + totals.optional} = correct ${totals.correct} + optional ${totals.optional} + WRONG ${totals.wrong} + SPURIOUS ${totals.spurious} + UNVERIFIABLE ${totals.unverifiable}\n` +
      `precision ${added ? ((100 * totals.correct) / added).toFixed(1) : "-"}% · recall ${totals.include ? ((100 * totals.correct) / totals.include).toFixed(1) : "-"}%\n` +
      `billed: HikerAPI ${billed.hikerapi_request} · Google Text Search ${billed.text_search_enterprise} · Gemini ${posts.length - totals.errors}`
  );
  if (totals.wrong + totals.spurious + totals.unverifiable > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
