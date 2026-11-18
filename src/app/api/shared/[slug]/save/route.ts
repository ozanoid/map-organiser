import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parsePostgisPoint } from "@/lib/geo";
import { getPlan } from "@/lib/plans/read";
import type { StopInput } from "@/lib/plans/schema";
import { createPlan, PlanInputError } from "@/lib/plans/write";

// POST /api/shared/[slug]/save — save shared content to own account (auth required)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;

  // Link lookup works on the cookie client via the public-read policy
  // (is_active = true). The ORIGINAL content does not: lists/plans/places
  // only have owner-scoped RLS, so cross-user reads must go through the
  // service client (`admin`). Inserts stay on the cookie client so RLS
  // WITH CHECK enforces user_id ownership.
  const { data: link } = await supabase
    .from("shared_links")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const admin = createServiceClient();

  if (link.resource_type === "list") {
    return await saveList(supabase, admin, link, user.id);
  } else if (link.resource_type === "plan" || link.resource_type === "trip") {
    // "trip": a link created before trips became plans (same ids).
    return await savePlan(supabase, admin, link, user.id);
  } else if (link.resource_type === "place") {
    return await savePlace(supabase, admin, link, user.id);
  }

  return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
}

// NF-18 (v1.20.0): copy ONE shared place into the visitor's account —
// the same per-place copy/dedupe block the list saver uses. Copies omit
// rating/visit_status/category (categories are per-user), matching the
// existing savers. Requires places_source_check to include 'shared'
// (widened in the same release — the check had never included it and
// the copy path was latently broken since April).
async function savePlace(supabase: any, admin: any, link: any, userId: string) {
  const { data: op } = await admin
    .from("places")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!op) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  // Dedupe by google_place_id when present. Check-then-insert without a
  // unique constraint (idx_places_google_id is non-unique) — a concurrent
  // double-tap can produce a duplicate copy; accepted, matches the
  // list/plan savers' posture.
  if (op.google_place_id) {
    const { data: existing } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", userId)
      .eq("google_place_id", op.google_place_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ type: "place", id: existing.id, deduped: true });
    }
  }

  const loc = parsePostgisPoint(op.location);
  const { data: newPlace, error } = await supabase
    .from("places")
    .insert({
      user_id: userId,
      name: op.name,
      address: op.address,
      country: op.country,
      city: op.city,
      location: `POINT(${loc.lng} ${loc.lat})`,
      notes: op.notes,
      google_place_id: op.google_place_id,
      google_data: op.google_data,
      source: "shared",
    })
    .select("id")
    .single();

  if (error || !newPlace) {
    return NextResponse.json(
      { error: error?.message || "Failed to save place" },
      { status: 500 }
    );
  }

  return NextResponse.json({ type: "place", id: newPlace.id });
}

async function saveList(supabase: any, admin: any, link: any, userId: string) {
  // Fetch original list (service client — owner-scoped RLS blocks the
  // visitor's session; this cross-user read had 404'd since April)
  const { data: originalList } = await admin
    .from("lists")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!originalList) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Create new list for this user
  const { data: newList, error: listError } = await supabase
    .from("lists")
    .insert({
      user_id: userId,
      name: originalList.name,
      description: originalList.description,
      color: originalList.color,
    })
    .select()
    .single();

  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  // Fetch original places (service client — cross-user rows)
  const { data: listPlaces } = await admin
    .from("list_places")
    .select("place_id, sort_order")
    .eq("list_id", link.resource_id)
    .order("sort_order", { ascending: true });

  if (listPlaces && listPlaces.length > 0) {
    const placeIds = listPlaces.map((lp: any) => lp.place_id);
    const { data: originalPlaces } = await admin
      .from("places")
      .select("*")
      .in("id", placeIds);

    if (originalPlaces) {
      // Copy each place (skip if user already has it by google_place_id)
      for (const op of originalPlaces) {
        let targetPlaceId = op.id;

        // Check if user already has this place
        if (op.google_place_id) {
          const { data: existing } = await supabase
            .from("places")
            .select("id")
            .eq("user_id", userId)
            .eq("google_place_id", op.google_place_id)
            .maybeSingle();

          if (existing) {
            targetPlaceId = existing.id;
          } else {
            // Create copy
            const loc = parsePostgisPoint(op.location);
            const { data: newPlace } = await supabase
              .from("places")
              .insert({
                user_id: userId,
                name: op.name,
                address: op.address,
                country: op.country,
                city: op.city,
                location: `POINT(${loc.lng} ${loc.lat})`,
                notes: op.notes,
                google_place_id: op.google_place_id,
                google_data: op.google_data,
                source: "shared",
              })
              .select("id")
              .single();

            if (newPlace) targetPlaceId = newPlace.id;
          }
        } else {
          // No google_place_id — always copy
          const loc = parsePostgisPoint(op.location);
          const { data: newPlace } = await supabase
            .from("places")
            .insert({
              user_id: userId,
              name: op.name,
              address: op.address,
              country: op.country,
              city: op.city,
              location: `POINT(${loc.lng} ${loc.lat})`,
              notes: op.notes,
              google_data: op.google_data,
              source: "shared",
            })
            .select("id")
            .single();

          if (newPlace) targetPlaceId = newPlace.id;
        }

        // Add to new list
        const sortOrder = listPlaces.find((lp: any) => lp.place_id === op.id)?.sort_order ?? 0;
        await supabase.from("list_places").insert({
          list_id: newList.id,
          place_id: targetPlaceId,
          sort_order: sortOrder,
        });
      }
    }
  }

  return NextResponse.json({ type: "list", id: newList.id });
}

/**
 * Copies a shared plan into the visitor's account: its places first (an
 * existing place with the same Google id is reused), then the plan with its
 * days and stops in one transaction (create_plan). What is copied is what
 * the public view shows — name, dates, the order of the stops and their
 * times; the owner's budget and notes are not.
 */
async function savePlan(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  link: { user_id: string; resource_id: string },
  userId: string
) {
  // The service client reads the owner's plan; getPlan scopes by their id.
  const original = await getPlan({ supabase: admin, userId: link.user_id }, link.resource_id);
  if (!original) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // The owner's places, full rows — a copy keeps the Google data.
  const placeIds = [
    ...new Set(
      (original.days ?? []).flatMap((d) => (d.stops ?? []).flatMap((s) => (s.place_id ? [s.place_id] : [])))
    ),
  ];
  const copies = new Map<string, string>();
  if (placeIds.length > 0) {
    const { data: originals } = await admin
      .from("places")
      .select("*")
      .eq("user_id", link.user_id)
      .in("id", placeIds);
    for (const op of (originals ?? []) as SharedPlaceRow[]) {
      const copyId = await copyPlaceFor(supabase, userId, op);
      if (copyId) copies.set(op.id, copyId);
    }
  }

  try {
    const id = await createPlan(
      { supabase, userId },
      {
        name: original.name,
        start_date: original.start_date,
        color: original.color,
        days: (original.days ?? []).map((day) => ({
          routing_profile: day.routing_profile,
          stops: (day.stops ?? []).flatMap((stop): StopInput[] => {
            const when = {
              ...(stop.start_time ? { start_time: stop.start_time } : {}),
              ...(stop.day_part ? { day_part: stop.day_part } : {}),
            };
            if (!stop.place_id) return stop.title ? [{ title: stop.title, ...when }] : [];
            const copy = copies.get(stop.place_id);
            // A place that could not be copied is left out, not half-linked.
            return copy ? [{ place_id: copy, ...when }] : [];
          }),
        })),
      },
      { createdVia: "app" }
    );
    return NextResponse.json({ type: "plan", id });
  } catch (e) {
    const message = e instanceof PlanInputError ? e.message : "Failed to save the plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** The columns of a `places` row a copy carries over. */
interface SharedPlaceRow {
  id: string;
  name: string;
  address: string | null;
  country: string | null;
  city: string | null;
  location: unknown;
  google_place_id: string | null;
  google_data: unknown;
}

/** The visitor's own copy of a shared place: the one they already have with
 *  the same Google id, or a new row. Returns its id, or null if the copy
 *  failed. */
async function copyPlaceFor(
  supabase: SupabaseClient,
  userId: string,
  op: SharedPlaceRow
): Promise<string | null> {
  if (op.google_place_id) {
    const { data: existing } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", userId)
      .eq("google_place_id", op.google_place_id)
      .maybeSingle();
    if (existing) return existing.id;
  }
  const loc = parsePostgisPoint(op.location);
  const { data: created } = await supabase
    .from("places")
    .insert({
      user_id: userId,
      name: op.name,
      address: op.address,
      country: op.country,
      city: op.city,
      location: `POINT(${loc.lng} ${loc.lat})`,
      google_place_id: op.google_place_id,
      google_data: op.google_data,
      source: "shared",
    })
    .select("id")
    .single();
  return created?.id ?? null;
}
