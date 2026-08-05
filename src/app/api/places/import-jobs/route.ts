import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  parseTakeoutGeoJson,
  parseTakeoutCsv,
} from "@/lib/google/takeout-parser";

/**
 * Import jobs — the durable replacement for the browser-driven import loop.
 *
 * POST parses the file and writes one `import_job_items` row per place, then
 * kicks the drain. Nothing else happens in the request: the client is free to
 * close the tab the moment this returns.
 *
 * GET reports the newest job's progress. It takes no id on purpose — the store
 * is transient, so a user who reopens the page has no job id to offer, and
 * "your latest import" is what they mean anyway.
 */

const OptionsSchema = z.object({
  visit_status: z.string().nullable().optional(),
  list_ids: z.array(z.string().uuid()).default([]),
  tag_ids: z.array(z.string().uuid()).default([]),
});

/** Rows per insert. Postgres handles far more, but a 5k-place file in one
 *  statement risks the request body limit on the way in. */
const INSERT_CHUNK = 500;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let places: unknown[];
  let fileName: string;
  let options: z.infer<typeof OptionsSchema>;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const parsedOptions = OptionsSchema.safeParse(
      JSON.parse((formData.get("options") as string | null) ?? "{}")
    );
    if (!parsedOptions.success) {
      return NextResponse.json({ error: "Invalid options" }, { status: 400 });
    }
    options = parsedOptions.data;

    fileName = file.name;
    const text = await file.text();
    places = fileName.toLowerCase().endsWith(".csv")
      ? parseTakeoutCsv(text)
      : parseTakeoutGeoJson(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { error: "Failed to parse file. Upload a GeoJSON or CSV from Google Takeout." },
      { status: 400 }
    );
  }

  if (places.length === 0) {
    return NextResponse.json({ error: "No valid places found in file" }, { status: 400 });
  }

  const { data: job, error: jobErr } = await supabase
    .from("import_jobs")
    .insert({
      user_id: user.id,
      file_name: fileName,
      total: places.length,
      status: "running",
      visit_status: options.visit_status || null,
      list_ids: options.list_ids,
      tag_ids: options.tag_ids,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json(
      { error: jobErr?.message ?? "Failed to create job" },
      { status: 500 }
    );
  }

  // Items are inserted on the service client, not the caller's. `import_job_items`
  // carries a SELECT policy and nothing else — stage transitions belong to the
  // drain, and leaving the table unwritable from a session keeps it that way.
  // `user_id` comes from the verified session above, never from the request.
  const admin = createServiceClient();

  for (let i = 0; i < places.length; i += INSERT_CHUNK) {
    const { error } = await admin.from("import_job_items").insert(
      places.slice(i, i + INSERT_CHUNK).map((payload) => ({
        job_id: job.id,
        user_id: user.id,
        payload,
      }))
    );
    if (error) {
      // Leave the partial job in place rather than orphaning what landed; the
      // drain will work through the rows that made it.
      console.error("[import-jobs] item insert failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  kickDrain(request.nextUrl.origin);

  return NextResponse.json({ jobId: job.id, total: places.length });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job } = await supabase
    .from("import_jobs")
    .select("id, file_name, total, status, created_at, finished_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) return NextResponse.json({ job: null });

  const { data: items } = await supabase
    .from("import_job_items")
    .select("stage, reason, name:payload->>name")
    .eq("job_id", job.id);

  const rows = (items ?? []) as Array<{
    stage: string;
    reason: string | null;
    name: string | null;
  }>;

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.stage] = (acc[r.stage] ?? 0) + 1;
    return acc;
  }, {});

  // "Settled" is what the progress bar tracks: a place is off the queue once it
  // reaches a terminal stage, whatever the outcome.
  const settled =
    (counts.done ?? 0) + (counts.skipped ?? 0) + (counts.failed ?? 0);

  return NextResponse.json({
    job: {
      ...job,
      counts,
      settled,
      // Places exist and are on the map from here on; reviews and profile only
      // add to them, so the UI can say "importing" vs "enriching".
      pending_import: counts.import ?? 0,
      enriching: (counts.reviews ?? 0) + (counts.profile ?? 0),
      problems: rows
        .filter((r) => r.stage === "skipped" || r.stage === "failed")
        .map((r) => ({ name: r.name ?? "Unknown", reason: r.reason ?? "Skipped" })),
    },
  });
}

/**
 * Nudge the drain so an import starts now instead of at the next cron minute.
 *
 * Deliberately not awaited: under Fluid Compute the call outlives this
 * response, and the minute cron is the safety net if it never lands.
 */
function kickDrain(origin: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  void fetch(`${origin}/api/cron/drain-imports`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {});
}
