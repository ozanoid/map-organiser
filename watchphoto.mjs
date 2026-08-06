import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEADLINE = Date.now() + 5 * 60 * 1000;

while (Date.now() < DEADLINE) {
  const { data: job } = await db.from("import_jobs").select("id").eq("file_name", "photo-repair").single();
  const { data: items } = await db
    .from("import_job_items")
    .select("stage, attempts, reason, place_id")
    .eq("job_id", job.id);

  const it = items[0];
  const { data: place } = await db.from("places").select("google_data").eq("id", it.place_id).single();
  const gd = place?.google_data ?? {};

  const t = new Date().toISOString().slice(11, 19);
  console.log(
    `${t}  stage=${it.stage.padEnd(8)} attempts=${it.attempts}  foto=${gd.photo_storage_url ? "VAR" : "yok"}  main_image=${gd.main_image ? "var" : "yok"}  reason=${it.reason ?? "-"}`
  );

  if (it.stage !== "photo") {
    console.log(gd.photo_storage_url ? "\n✅ deploy canlı, fotoğraf indi" : "\n⚠️  aşama ilerledi ama fotoğraf gelmedi");
    process.exit(0);
  }
  await sleep(20000);
}
console.log("\n⏳ 5 dakikada hareket yok — deploy henüz inmemiş olabilir");
