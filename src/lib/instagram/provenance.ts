import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every place that comes from an Instagram post carries the "instagram" tag
 * and the post URL in its notes — new places get both through the import
 * job's defaults and payload, places that were already saved get them here.
 */

export const INSTAGRAM_TAG_NAME = "instagram";
const INSTAGRAM_TAG_COLOR = "#E4405F";

/** The user's "instagram" tag (any letter case), created on first use. */
export async function ensureInstagramTag(supabase: SupabaseClient, userId: string): Promise<string> {
  const find = async () => {
    const { data } = await supabase
      .from("tags")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", INSTAGRAM_TAG_NAME)
      .limit(1)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("tags")
    .insert({ user_id: userId, name: INSTAGRAM_TAG_NAME, color: INSTAGRAM_TAG_COLOR })
    .select("id")
    .single();
  if (data?.id) return data.id as string;
  // Lost a race with a parallel import: the unique (user_id, name) index fired.
  const again = await find();
  if (again) return again;
  throw new Error(error?.message ?? "Could not create the instagram tag");
}

/** Tag an already-saved place and append the post URL to its notes (once). */
export async function attachInstagramSource(
  supabase: SupabaseClient,
  userId: string,
  placeId: string,
  postUrl: string | null | undefined,
  tagIds: string[]
): Promise<void> {
  if (tagIds.length > 0) {
    await supabase
      .from("place_tags")
      .upsert(
        tagIds.map((tagId) => ({ place_id: placeId, tag_id: tagId })),
        { onConflict: "place_id,tag_id", ignoreDuplicates: true }
      );
  }
  if (!postUrl) return;
  const { data } = await supabase
    .from("places")
    .select("notes")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();
  const notes = (data?.notes as string | null) ?? "";
  if (notes.includes(postUrl)) return;
  await supabase
    .from("places")
    .update({ notes: notes ? `${notes}\n${postUrl}` : postUrl })
    .eq("id", placeId)
    .eq("user_id", userId);
}
