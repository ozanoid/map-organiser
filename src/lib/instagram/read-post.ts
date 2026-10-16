import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";

/**
 * One Gemini call reads an Instagram post: which accounts are venues, whether
 * the post features them, the branch or street address the post gives, venue
 * names written only in the caption, and the area the post is about.
 *
 * The model never picks a Google place — it only classifies and quotes. Every
 * quote it returns is checked against the post text before it is used
 * (see analyze.ts).
 */

const ROLES = ["venue", "venue_brand_multi", "person", "media_or_creator", "brand_or_product", "other"] as const;

export const PostReadingSchema = z.object({
  accounts: z.array(
    z.object({
      username: z.string(),
      role: z.enum(ROLES),
      featured: z.boolean(),
      branch_hint: z.string().nullable(),
      address_in_post: z.string().nullable(),
      venue_name: z.string().nullable(),
      evidence: z.string(),
    })
  ),
  location_tag_is_specific_venue: z.boolean(),
  text_venues: z.array(
    z.object({
      name: z.string(),
      featured: z.boolean(),
      area: z.string().nullable(),
      address: z.string().nullable(),
      quote: z.string(),
    })
  ),
  area: z.object({
    neighbourhood: z.string().nullable(),
    district: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
  }),
});

export type PostReading = z.infer<typeof PostReadingSchema>;
export type AccountRole = (typeof ROLES)[number];

export interface PostReadingInput {
  caption: string;
  locationTag: { name: string; address: string | null; city: string | null } | null;
  owner: { username: string; fullName: string | null };
  accounts: {
    username: string;
    fullName: string | null;
    sources: string[];
    isBusiness: boolean | null;
    category: string | null;
    city: string | null;
    address: string | null;
    bio: string;
  }[];
}

const SYSTEM = `You analyse ONE Instagram post to find the physical venues it features — places a person can visit (restaurants, cafés, bars, bakeries, shops, bookstores, hotels, museums, galleries, parks, landmarks...) — so they can be saved to a map automatically. Precision matters more than recall.

A place is FEATURED when the post showcases or recommends it to the reader as a place to go (a review, a visit, a list or guide of places). NOT featured: places that are only stops of an advertised tour/package, sub-spaces inside another featured venue (a lounge, terrace or restaurant inside a hotel/museum), places used only as context or orientation ("near X", "view of X"), and accounts that are only credited (photographer, outfit, collab partner, "follow @x").

You get the caption, the location tag, the owner, and every account that is tagged in the media, credited as coauthor, @mentioned in the caption, or that posted it (source "owner"), with profile data (bio included).

For EACH account return:
- role:
  "venue" = the account of one specific physical venue (or a business with a single visitable location)
  "venue_brand_multi" = a brand/chain/group account that runs several physical locations
  "person" = an individual (blogger, chef, friend, photographer, influencer, artist)
  "media_or_creator" = a media page, magazine, city guide, food/travel page
  "brand_or_product" = a product or brand without a visitable venue (fashion, cosmetics, drinks brand, app, agency)
  "other"
- featured: per the definition above. The owner is featured only when the post is about the owner's own venue.
- branch_hint: the specific branch, street or neighbourhood of THIS venue as written in the caption, the location tag, the account's bio or its username (e.g. "Moda", "Narmanlı Han", "Via dei Giubbonari"); null if none is written. Copy the words exactly.
- address_in_post: the street address of THIS venue if the caption or the account's own bio writes it (copy it exactly, e.g. "Moda Caddesi No:161/A"); else null.
- venue_name: the venue's own name as written in its full name, the caption or the bio; if only the username is available, split the username into words (e.g. "karakoymarinobalikdurum" → "Karaköy Marino Balık Dürüm"); null for non-venues.
- evidence: short verbatim quote (max 12 words) supporting the role.

Also return:
- location_tag_is_specific_venue: true only if the location tag names one specific visitable venue; false for a city, district, neighbourhood, country, region, street, or a vague/fan label (e.g. "Istanbul, Turkey", "Kadıköy Moda - I Love Kadıköy").
- text_venues: venues the caption names in plain text WITHOUT an @mention, tag or location tag. Each: name exactly as written in the caption, featured (per the definition), area (neighbourhood/district/city exactly as written, else null), address (street address exactly as written, else null), quote (verbatim, max 12 words, containing the name). Do not include venues represented by an account or by the location tag. Never invent; [] if none.
- area: the main area of the post {neighbourhood, district, city, country}, only from explicit evidence (location tag, caption, hashtags, profiles); null when unknown.`;

export async function readPost(input: PostReadingInput, meta: { userId: string; shortcode: string }): Promise<PostReading> {
  const ai = getAiClient();
  if (!ai) throw new Error("ai_not_configured");
  const result = await generateText({
    model: ai(FLASH_MODEL),
    output: Output.object({ schema: PostReadingSchema }),
    system: SYSTEM,
    prompt: `POST DATA (JSON):\n${JSON.stringify(
      {
        caption: input.caption.slice(0, 3000),
        location_tag: input.locationTag,
        owner: { username: input.owner.username, full_name: input.owner.fullName },
        accounts: input.accounts.map((a) => ({
          username: a.username,
          full_name: a.fullName,
          sources: a.sources,
          is_business: a.isBusiness,
          category: a.category,
          city: a.city,
          address: a.address,
          bio: a.bio.slice(0, 200),
        })),
      },
      null,
      1
    )}`,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "ai.instagram-read-post",
      metadata: { userId: meta.userId, shortcode: meta.shortcode },
    },
  });
  return result.output;
}
