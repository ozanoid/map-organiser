/* eslint-disable @typescript-eslint/no-explicit-any -- reads loosely typed tool output */
/**
 * Runs the assistant tools against the live database, the way the MCP
 * server would, and prints what the model would see. Read-only checks use
 * the owner's library; the write check and the paid calls (geocoding, AI
 * ranking) use the admin test account and undo the write afterwards.
 *
 *   npm run check:assistant                 everything
 *   npm run check:assistant -- plans        only the plan checks (no paid calls)
 *   npm run check:assistant -- visits       only the visit checks (no paid calls)
 *   npm run check:assistant -- plan-tools   only the plan tool checks (no paid calls)
 *
 * Uses the service-role key: RLS is bypassed, so this relies on every tool
 * query also filtering by user_id (which they do).
 */
import { createClient } from "@supabase/supabase-js";
import { isAllowedOAuthRedirect } from "@/lib/assistant/oauth";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";
import { safeNextPath } from "@/lib/auth/safe-next";
import { CHECK_APP_URL } from "./context";
import { checkPlanTools } from "./plan-tools";
import { checkPlans } from "./plans";
import { checkVisits } from "./visits";

const OWNER = "ozan@maporganiser.com";
const TESTER = "admin@maporganiser.com";
const THURSDAY_8PM = "2026-11-19T20:00";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function userIdOf(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const u = data.users.find((x) => x.email === email);
  if (!u) throw new Error(`no user ${email}`);
  return u.id;
}

const tool = (name: string) => {
  const t = ASSISTANT_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

let failures = 0;
async function call(label: string, userId: string, name: string, input: unknown, show = 900): Promise<any> {
  const t = tool(name);
  const started = Date.now();
  try {
    const parsed = t.inputSchema.parse(input);
    const out = await t.run({ supabase: admin, userId, appUrl: CHECK_APP_URL }, parsed as never);
    const text = JSON.stringify(out);
    console.log(`\n## ${label} — ${Date.now() - started} ms, ${Math.round(text.length / 1024)} KB\n${text.slice(0, show)}`);
    return out;
  } catch (e) {
    console.log(`\n## ${label} — threw ${(e as Error).constructor.name}: ${(e as Error).message}`);
    return null;
  }
}

function expect(label: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`   ${ok ? "PASS" : "FAIL"} ${label}`);
}

async function main() {
  const owner = await userIdOf(OWNER);
  const tester = await userIdOf(TESTER);

  const only = { plans: checkPlans, visits: checkVisits, "plan-tools": checkPlanTools }[process.argv[2] ?? ""];
  if (only) {
    await only(admin, expect, tester, owner);
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // ── Owner library, read-only ──────────────────────────────────────
  const overview = await call("overview", owner, "get_library_overview", {}, 700);
  expect("overview counts every place", overview?.total_places > 0);
  expect(
    "Türkiye and Turkey merged",
    overview?.countries?.some((c: any) => c.country === "Türkiye" && c.places >= 50)
  );

  const ascii = await call("city=Istanbul", owner, "search_places", { city: "Istanbul", limit: 3 }, 300);
  const dotted = await call("city=İstanbul", owner, "search_places", { city: "İstanbul", limit: 3 }, 300);
  expect("Istanbul finds places", ascii?.total_matches > 0);
  expect("Istanbul == İstanbul", ascii?.total_matches === dotted?.total_matches);
  const kadikoy = await call("city=Kadikoy (no Turkish letters)", owner, "search_places", { city: "Kadikoy", limit: 2 }, 200);
  expect("Kadikoy finds Kadıköy", kadikoy?.total_matches > 0);

  const thursday = await call(
    "London restaurants open Thu 20:00, by popularity",
    owner,
    "search_places",
    { city: "London", category: "Restaurant", open_at: THURSDAY_8PM, sort: "popularity", limit: 5 }
  );
  expect("open_at returns places", thursday?.total_matches > 0);

  const roast = await call("query=sunday roast, London", owner, "search_places", { query: "sunday roast", city: "London", limit: 3 }, 500);
  expect("keyword search finds something", roast?.total_matches > 0);

  const tags = await call("tags Terrace + Good Value, London", owner, "search_places", { city: "London", tags: ["Terrace", "Good Value"], limit: 3 }, 400);
  expect("tag AND filter works", tags?.total_matches >= 0);

  const plural = await call("tag 'Rooftops' → Rooftop", owner, "search_places", { tags: ["Rooftops"], limit: 1 }, 200);
  expect("near-miss tag name resolves", plural?.total_matches > 0);
  const badTag = await call("unknown tag → error", owner, "search_places", { tags: ["Underwater Disco"] }, 300);
  expect("unknown tag is an input error", badTag === null);

  const unknown = await call("visit_status=unknown", owner, "search_places", { visit_status: "unknown", limit: 1 }, 200);
  expect("unknown visit status counted", unknown?.total_matches > 200);

  const first = thursday?.places?.[0];
  if (first) {
    const near = await call(`near ${first.name}, 800 m`, owner, "search_places", { near: { place_id: first.id, radius_m: 800 }, limit: 4 }, 600);
    expect("near sorts by distance", near?.sort === "distance" && near?.places?.[0]?.distance_m === 0);

    const ids = thursday.places.slice(0, 2).map((p: any) => p.id);
    const details = await call("get_places ×2 at Thu 20:00", owner, "get_places", { place_ids: ids, at: THURSDAY_8PM }, 3500);
    expect("details carry open-at and busyness", details?.places?.[0]?.at?.open === true);
    const similar = (details?.places ?? []).flatMap((p: any) => p.similar_not_saved ?? []);
    expect(
      "similar places are real listings (≥ 4.0, ≥ 20 reviews)",
      similar.every((s: any) => s.google_rating >= 4 && s.google_reviews >= 20)
    );

    const reviews = await call(`read_reviews ${first.name} about lamb, dessert`, owner, "read_reviews", { place_id: first.id, about: "lamb, dessert", limit: 3 }, 900);
    expect("reviews returned", typeof reviews?.stored_reviews === "number");
  }

  // ── Test account: paid calls and the write ─────────────────────────
  await call("near area Shoreditch (Mapbox geocoding)", tester, "search_places", { near: { area: "Shoreditch, London", radius_m: 1500 }, limit: 3 }, 600);
  // Google Maps search (DataForSEO, $0.002 each): a known place by name,
  // then a place the tester has saved — it must come back marked as saved.
  const dandan = await call(
    "search_google_maps DanDan Aldgate",
    tester,
    "search_google_maps",
    { query: "DanDan Aldgate", near: { lat: 51.5145, lng: -0.072, radius_m: 2000 }, limit: 5 },
    700
  );
  expect("maps search finds the place with Google's cid", dandan?.results?.[0]?.google_cid === "9577570098796810468");
  const own = await call("tester: one saved London place", tester, "search_places", { city: "London", limit: 1 }, 200);
  const ownPlace = own?.places?.[0];
  if (ownPlace) {
    const again = await call(
      `search_google_maps "${ownPlace.name}" near itself`,
      tester,
      "search_google_maps",
      { query: ownPlace.name, near: { place_id: ownPlace.id, radius_m: 800 }, limit: 5 },
      600
    );
    expect(
      "a saved place comes back marked as saved",
      again?.results?.some((r: any) => r.saved_place_id === ownPlace.id) === true
    );
  }

  await call("rank_places romantic dinner (Gemini)", tester, "rank_places", { intent: "romantic, intimate dinner spot, not loud", city: "London", limit: 3 }, 900);

  const { data: target } = await admin
    .from("places")
    .select("id,name,visit_status,rating,notes,visited_at,booked_at,updated_at")
    .eq("user_id", tester)
    .limit(1)
    .single();
  if (target) {
    const before = { ...target };
    const { data: tagBefore } = await admin.from("tags").select("id").eq("user_id", tester).eq("name", "mcp-test").maybeSingle();
    const written = await call(`update_places ${target.name}`, tester, "update_places", {
      place_ids: [target.id],
      visit_status: "visited",
      rating: 4,
      note: "MCP check — please ignore",
      add_tags: ["mcp-test"],
    });
    const { data: after } = await admin.from("places").select("visit_status,rating,notes,visited_at").eq("id", target.id).single();
    expect("write landed", after?.visit_status === "visited" && after?.rating === 4 && /MCP check/.test(after?.notes ?? ""));

    // Undo: restore the row exactly, drop the tag link and the tag if this run created it.
    await admin
      .from("places")
      .update({
        visit_status: before.visit_status,
        rating: before.rating,
        notes: before.notes,
        visited_at: before.visited_at,
        booked_at: before.booked_at,
        updated_at: before.updated_at,
      })
      .eq("id", target.id);
    const { data: tagRow } = await admin.from("tags").select("id").eq("user_id", tester).eq("name", "mcp-test").maybeSingle();
    if (tagRow) {
      await admin.from("place_tags").delete().eq("place_id", target.id).eq("tag_id", tagRow.id);
      if (!tagBefore) await admin.from("tags").delete().eq("id", tagRow.id);
    }
    const { data: restored } = await admin.from("places").select("visit_status,rating,notes").eq("id", target.id).single();
    expect(
      "write undone",
      restored?.visit_status === before.visit_status && restored?.rating === before.rating && restored?.notes === before.notes
    );
    void written;
  }

  // ── Plans (src/lib/plans) and visits (src/lib/visits) ─────────────
  await checkPlans(admin, expect, tester, owner);
  await checkVisits(admin, expect, tester, owner);
  await checkPlanTools(admin, expect, tester, owner);

  // ── Pure helpers ──────────────────────────────────────────────────
  for (const [raw, want] of [
    ["/oauth/consent?authorization_id=abc", "/oauth/consent?authorization_id=abc"],
    ["/map", "/map"],
    ["/map?add=https%3A%2F%2Fwww.instagram.com%2Fp%2Fabc%2F", "/map?add=https%3A%2F%2Fwww.instagram.com%2Fp%2Fabc%2F"],
    ["/plans/7f1c2e8a-0000-4000-8000-000000000000", "/plans/7f1c2e8a-0000-4000-8000-000000000000"],
    ["//evil.com", null],
    ["@evil.com", null],
    ["https://evil.com", null],
    ["/\\evil.com", null],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
  ] as const) {
    expect(`safeNextPath(${raw}) = ${want}`, safeNextPath(raw) === want);
  }
  for (const [uri, want] of [
    ["https://claude.ai/api/mcp/auth_callback", true],
    ["https://claude.com/api/mcp/auth_callback?code=x&state=y", true],
    ["http://localhost:54123/callback", true],
    ["https://claude.ai.evil.com/api/mcp/auth_callback", false],
    ["https://evil.com/api/mcp/auth_callback", false],
    ["http://claude.ai/api/mcp/auth_callback", false],
  ] as const) {
    expect(`redirect ${uri} → ${want}`, isAllowedOAuthRedirect(uri) === want);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
