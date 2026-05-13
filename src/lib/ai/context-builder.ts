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
  for (const row of citiesRes.data ?? []) {
    if (row.city) citySet.add(row.city as string);
    if (row.country) countrySet.add(row.country as string);
  }

  return {
    tags,
    categories,
    subcategories,
    lists,
    cities: [...citySet].sort(),
    countries: [...countrySet].sort(),
  };
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

  return [
    `User's existing tags: ${tagsStr}`,
    `User's categories: ${categoriesStr}`,
    `User's subcategories: ${subcategoriesStr}`,
    `User's lists: ${listsStr}`,
    `Cities user has places in: ${ctx.cities.join(", ") || "(none)"}`,
    `Countries user has places in: ${ctx.countries.join(", ") || "(none)"}`,
  ].join("\n");
}
