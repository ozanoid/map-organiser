import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePostgisPoint } from "@/lib/geo";
import type {
  InstagramImportItemView,
  InstagramImportView,
  InstagramItemInfo,
  InstagramItemStatus,
  InstagramJobMeta,
} from "@/lib/instagram/types";

/**
 * GET /api/instagram/import/[id] — progress and result of one Instagram import,
 * shaped for the dialog. Read with the session client: RLS limits both the
 * job and its items to their owner.
 */

/** A job still "reading" after this long lost its background run. */
const STALL_MS = 3 * 60 * 1000;

const ENRICHING = new Set(["photo", "reviews", "profile", "done"]);

interface ItemRow {
  id: string;
  stage: string;
  reason: string | null;
  place_id: string | null;
  payload: { name?: string; instagram?: InstagramItemInfo } | null;
}

interface PlaceRow {
  id: string;
  name: string;
  address: string | null;
  location: unknown;
  photo: string | null;
}

function statusOf(item: ItemRow): InstagramItemStatus {
  if (item.stage === "import") return "pending";
  if (ENRICHING.has(item.stage)) return item.place_id ? "added" : "removed";
  if (item.stage === "skipped" && item.reason === "Already exists") {
    return item.place_id ? "already_saved" : "removed";
  }
  if (item.stage === "failed") return "failed";
  return "skipped";
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job } = await supabase
    .from("import_jobs")
    .select("id, file_name, created_at, meta, tag_ids")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "instagram")
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: itemRows } = await supabase
    .from("import_job_items")
    .select("id, stage, reason, place_id, payload")
    .eq("job_id", id)
    .order("created_at", { ascending: true });
  const items = (itemRows ?? []) as ItemRow[];

  const placeIds = items.map((i) => i.place_id).filter((v): v is string => !!v);
  const places = new Map<string, PlaceRow>();
  if (placeIds.length > 0) {
    const { data } = await supabase
      .from("places")
      .select("id, name, address, location, photo:google_data->>photo_storage_url")
      .in("id", placeIds)
      .eq("user_id", user.id);
    for (const p of (data ?? []) as PlaceRow[]) places.set(p.id, p);
  }

  const views: InstagramImportItemView[] = items.map((item) => {
    const info = item.payload?.instagram;
    const place = item.place_id ? places.get(item.place_id) : undefined;
    const point = place?.location ? parsePostgisPoint(place.location) : null;
    return {
      id: item.id,
      status: statusOf(item),
      name: place?.name ?? item.payload?.name ?? info?.label ?? "Unknown place",
      reason: item.stage === "skipped" || item.stage === "failed" ? item.reason : null,
      evidence: info?.evidence ?? [],
      sameNameCount: info?.sameNameCount ?? 0,
      searchName: info?.searchName ?? item.payload?.name ?? "",
      place:
        place && point
          ? { id: place.id, name: place.name, address: place.address, lat: point.lat, lng: point.lng, photoUrl: place.photo }
          : null,
    };
  });

  const meta = (job.meta ?? { phase: "reading", shortcode: "" }) as InstagramJobMeta;
  let phase = meta.phase;
  let error = meta.error ?? null;
  if (phase === "reading" && Date.now() - new Date(job.created_at as string).getTime() > STALL_MS) {
    phase = "failed";
    error = "stalled";
  } else if (phase === "adding" || phase === "done") {
    phase = views.some((v) => v.status === "pending") ? "adding" : "done";
  }

  const view: InstagramImportView = {
    id: job.id as string,
    phase,
    error,
    postUrl: (job.file_name as string | null) ?? "",
    tagId: ((job.tag_ids as string[] | null) ?? [])[0] ?? null,
    post: meta.post ?? null,
    createdAt: job.created_at as string,
    items: views,
  };
  return NextResponse.json(view);
}
