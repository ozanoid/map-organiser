import "server-only";
import type { BetaContentBlockParam, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { loadNames, type AssistantContext } from "@/lib/assistant/library";
import type { AssistantSubject, ResolvedSubject } from "@/lib/agent/ui-types";

/**
 * A request's subject (Phase 2, 6.1): what the user was looking at when
 * they asked from a screen of the app — a plan, the places they compare,
 * the map or their places with the filters on. The screen names it by id;
 * here it is checked against the user's library and named, then kept in the
 * user's message as a <subject> block after the <context> line. The model
 * takes the ids from it; the panel shows the names as a chip (ui.ts).
 */

export const SUBJECT_TAG = "subject";

/** Places one request can be about — get_places reads five at a time. */
export const MAX_SUBJECT_PLACES = 5;

/** Why a subject can't be used; the message is for the user. */
export class SubjectError extends Error {}

const uuid = z.string().uuid();
const ids = z.array(uuid).max(50);

export const SubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), planId: uuid }).strict(),
  z.object({ kind: z.literal("places"), placeIds: z.array(uuid).min(1).max(MAX_SUBJECT_PLACES) }).strict(),
  z
    .object({
      kind: z.literal("view"),
      page: z.enum(["map", "places"]),
      filters: z
        .object({
          city: z.string().max(80).optional(),
          country: z.string().max(60).optional(),
          category_ids: ids.optional(),
          subcategory_ids: ids.optional(),
          tag_ids: ids.optional(),
          list_id: uuid.optional(),
          rating_min: z.number().min(0).max(5).optional(),
          google_rating_min: z.number().min(0).max(5).optional(),
          visit_status: z.string().max(20).optional(),
          open_now: z.boolean().optional(),
        })
        .strict(),
      area: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          radiusM: z.number().min(50).max(500_000),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

/** The subject checked against the user's library and named. */
export async function resolveSubject(ctx: AssistantContext, subject: AssistantSubject): Promise<ResolvedSubject> {
  switch (subject.kind) {
    case "plan": {
      const { data, error } = await ctx.supabase
        .from("plans")
        .select("id, name")
        .eq("id", subject.planId)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new SubjectError("That plan isn't in your library any more.");
      return { kind: "plan", plan: { id: data.id as string, name: data.name as string } };
    }
    case "places": {
      const wanted = [...new Set(subject.placeIds)];
      const { data, error } = await ctx.supabase
        .from("places")
        .select("id, name")
        .in("id", wanted)
        .eq("user_id", ctx.userId);
      if (error) throw new Error(error.message);
      const byId = new Map((data ?? []).map((p) => [p.id as string, p.name as string]));
      if (wanted.some((id) => !byId.has(id))) {
        throw new SubjectError("Some of those places aren't in your library any more.");
      }
      return { kind: "places", places: wanted.map((id) => ({ id, name: byId.get(id)! })) };
    }
    case "view": {
      const f = subject.filters;
      const names = async (kind: "category" | "subcategory" | "tag" | "list", wanted: string[] | undefined) => {
        if (!wanted?.length) return undefined;
        const rows = new Map((await loadNames(ctx, kind)).map((r) => [r.id, r.name]));
        // A filter the user no longer has (deleted since) just drops out.
        const found = wanted.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []));
        return found.length ? found : undefined;
      };
      const [categories, subcategories, tags, list] = await Promise.all([
        names("category", f.category_ids),
        names("subcategory", f.subcategory_ids),
        names("tag", f.tag_ids),
        names("list", f.list_id ? [f.list_id] : undefined),
      ]);
      const filters: Extract<ResolvedSubject, { kind: "view" }>["filters"] = {
        ...(f.city ? { city: f.city } : {}),
        ...(f.country ? { country: f.country } : {}),
        ...(categories ? { categories } : {}),
        ...(subcategories ? { subcategories } : {}),
        ...(tags ? { tags } : {}),
        ...(list ? { list: list[0] } : {}),
        ...(f.visit_status ? { visit_status: f.visit_status } : {}),
        ...(f.rating_min !== undefined ? { min_my_rating: f.rating_min } : {}),
        ...(f.google_rating_min !== undefined ? { min_google_rating: f.google_rating_min } : {}),
        ...(f.open_now ? { open_now: true } : {}),
      };
      return {
        kind: "view",
        page: subject.page,
        filters,
        ...(subject.area
          ? {
              area: {
                lat: Math.round(subject.area.lat * 1e5) / 1e5,
                lng: Math.round(subject.area.lng * 1e5) / 1e5,
                radius_m: Math.round(subject.area.radiusM),
              },
            }
          : {}),
      };
    }
  }
}

const ABOUT =
  "What the user was looking at in the app when they wrote this message. The ids are for your tools; the user sees only the names.";

/** The block the user's message carries — self-describing, so it reads
 *  right in a conversation whose system prompt predates subjects. */
export function subjectBlock(subject: ResolvedSubject): BetaTextBlockParam {
  return { type: "text", text: `<${SUBJECT_TAG}>${JSON.stringify({ about: ABOUT, ...subject })}</${SUBJECT_TAG}>` };
}

const OPEN = `<${SUBJECT_TAG}>`;
const CLOSE = `</${SUBJECT_TAG}>`;

/** The subject a stored user message carries, if any. */
export function subjectIn(content: BetaContentBlockParam[]): ResolvedSubject | null {
  for (const b of content) {
    if (b.type !== "text" || !b.text.startsWith(OPEN) || !b.text.endsWith(CLOSE)) continue;
    try {
      const { about: _about, ...rest } = JSON.parse(b.text.slice(OPEN.length, -CLOSE.length)) as { about?: string } & ResolvedSubject;
      void _about;
      if (rest.kind === "plan" || rest.kind === "places" || rest.kind === "view") return rest as ResolvedSubject;
    } catch {
      // Not ours to show.
    }
  }
  return null;
}
