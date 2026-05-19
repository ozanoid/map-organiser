import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalize } from "./normalize";

/**
 * UserContext is the bundle of the user's existing entities injected into
 * every LLM system prompt. It enforces the "LLM must always see what the user
 * already has" rule — the first line of defense against tag/category
 * duplication (see src/lib/ai/dedup.ts for the second line).
 *
 * Built once per request, passed down to prompt builders.
 */
export interface UserContext {
  tags: Array<{ id: string; name: string; normalized: string }>;
  categories: Array<{ id: string; name: string; slug: string }>;
  /**
   * Subcategories: only approved ones (is_pending = false) are injected.
   * Pending proposals would create echo chambers if the LLM kept proposing
   * the same not-yet-approved names.
   */
  subcategories: Array<{
    id: string;
    parent_category_id: string;
    parent_name: string;
    name: string;
    slug: string;
  }>;
  lists: Array<{ id: string; name: string; normalized: string }>;
  /** Distinct cities the user has places in — used by parse-query for "Istanbul" disambiguation. */
  cities: string[];
  /** Distinct countries the user has places in. */
  countries: string[];
  /**
   * Map of city → list of countries it appears under in the user's data.
   * Drives the "Cities by country" prompt block AND the server-side
   * country-from-city safety net in /api/ai/parse-query/route.ts.
   *
   * Multi-country case: the same city name in two countries (e.g. "London"
   * in UK and Ontario) produces an array of length 2. The LLM picks one;
   * server-side fallback picks the most common (sorted by occurrence in
   * places — see `countriesForCity` in this module).
   */
  cityToCountries: Map<string, string[]>;
}

/**
 * Build the user-scoped context for an AI prompt.
 *
 * NOTE: Subcategories table is created in Phase 2. Until then this query
 * silently returns an empty array (table-doesn't-exist swallowed).
 */
export async function buildUserContext(
  supabase: SupabaseClient,
  userId: string
): Promise<UserContext> {
  const [tagsRes, categoriesRes, subcategoriesRes, listsRes, citiesRes] =
    await Promise.all([
      supabase
        .from("tags")
        .select("id, name")
        .eq("user_id", userId)
        .order("name", { ascending: true }),
      supabase
        .from("categories")
        .select("id, name")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true }),
      // Phase 2 dependency — best-effort, returns empty if table missing.
      supabase
        .from("subcategories")
        .select("id, parent_category_id, name, slug, categories(name)")
        .eq("user_id", userId)
        .eq("is_pending", false)
        .then(
          (r) => r,
          () => ({ data: [] as unknown[], error: null } as unknown as Awaited<ReturnType<typeof supabase.from>>)
        ),
      supabase
        .from("lists")
        .select("id, name")
        .eq("user_id", userId)
        .order("name", { ascending: true }),
      supabase
        .from("places")
        .select("country, city")
        .eq("user_id", userId)
        .not("city", "is", null),
    ]);

  const tags = (tagsRes.data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    normalized: normalize(t.name as string),
  }));

  const categories = (categoriesRes.data ?? []).map((c) => {
    const name = c.name as string;
    return {
      id: c.id as string,
      name,
      slug: normalize(name),
    };
  });

  const subcategoriesRaw =
    (subcategoriesRes as { data?: Array<Record<string, unknown>> }).data ?? [];
  const subcategories = subcategoriesRaw.map((s) => {
    const parent =
      (s.categories as { name?: string } | null | undefined)?.name ?? "";
    return {
      id: s.id as string,
      parent_category_id: s.parent_category_id as string,
      parent_name: parent,
      name: s.name as string,
      slug: s.slug as string,
    };
  });

  const lists = (listsRes.data ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    normalized: normalize(l.name as string),
  }));

  const citySet = new Set<string>();
  const countrySet = new Set<string>();
  // City → country occurrence map. Used both to expose the city→country
  // pair to the LLM context AND to backfill hard.country at sanitization
  // time when the LLM sets city alone.
  const cityCountryOccurrences = new Map<string, Map<string, number>>();
  for (const row of citiesRes.data ?? []) {
    const city = row.city as string | null;
    const country = row.country as string | null;
    if (city) citySet.add(city);
    if (country) countrySet.add(country);
    if (city && country) {
      let inner = cityCountryOccurrences.get(city);
      if (!inner) {
        inner = new Map<string, number>();
        cityCountryOccurrences.set(city, inner);
      }
      inner.set(country, (inner.get(country) ?? 0) + 1);
    }
  }
  // Collapse to ordered arrays (most-frequent country first).
  const cityToCountries = new Map<string, string[]>();
  for (const [city, inner] of cityCountryOccurrences) {
    const sorted = [...inner.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([country]) => country);
    cityToCountries.set(city, sorted);
  }

  return {
    tags,
    categories,
    subcategories,
    lists,
    cities: [...citySet].sort(),
    countries: [...countrySet].sort(),
    cityToCountries,
  };
}

/**
 * Pick the canonical country for a city given the user's data. Returns
 * the most-common country, or undefined if the city isn't in the user's
 * collection. Used by the parse-query sanitizer to fill in hard.country
 * when the LLM set hard.city alone.
 */
export function countriesForCity(
  ctx: UserContext,
  city: string
): string | undefined {
  // Try exact match first.
  const arr = ctx.cityToCountries.get(city);
  if (arr && arr.length > 0) return arr[0];
  // Case-insensitive fallback. LLM may emit different casing than what's
  // in the user's data (e.g. "london" vs stored "London").
  const lower = city.toLowerCase();
  for (const [stored, countries] of ctx.cityToCountries) {
    if (stored.toLowerCase() === lower && countries.length > 0) {
      return countries[0];
    }
  }
  return undefined;
}

/**
 * Compact a UserContext into a token-efficient string suitable for inclusion
 * in a system prompt. Each line is structured for easy LLM parsing.
 */
export function serializeUserContext(ctx: UserContext): string {
  const tagsStr = ctx.tags.length
    ? ctx.tags.map((t) => `[${t.id}] ${t.name}`).join(", ")
    : "(none)";
  const categoriesStr = ctx.categories
    .map((c) => `[${c.id}] ${c.name}`)
    .join(", ");
  const subcategoriesStr = ctx.subcategories.length
    ? ctx.subcategories
        .map((s) => `[${s.id}] ${s.slug} (parent: ${s.parent_name})`)
        .join(", ")
    : "(none)";
  const listsStr = ctx.lists.length
    ? ctx.lists.map((l) => `[${l.id}] ${l.name}`).join(", ")
    : "(none)";

  // Cities grouped by country, sorted alphabetically per country. Country
  // → list of its cities. Inverted from ctx.cityToCountries which is
  // city → countries (a Map, but we re-aggregate to country → cities for
  // display since users think country-first).
  const countryToCities = new Map<string, Set<string>>();
  for (const [city, countries] of ctx.cityToCountries) {
    for (const country of countries) {
      let cities = countryToCities.get(country);
      if (!cities) {
        cities = new Set<string>();
        countryToCities.set(country, cities);
      }
      cities.add(city);
    }
  }
  const citiesByCountryStr =
    countryToCities.size === 0
      ? "(none)"
      : [...countryToCities.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(
            ([country, cities]) =>
              `  ${country}: ${[...cities].sort().join(", ")}`
          )
          .join("\n");

  return [
    `User's existing tags: ${tagsStr}`,
    `User's categories: ${categoriesStr}`,
    `User's subcategories: ${subcategoriesStr}`,
    `User's lists: ${listsStr}`,
    `Cities by country (use this mapping when setting hard.city — country MUST be paired):`,
    citiesByCountryStr,
    `(Flat cities list for reference: ${ctx.cities.join(", ") || "(none)"})`,
    `(Flat countries list for reference: ${ctx.countries.join(", ") || "(none)"})`,
  ].join("\n");
}
