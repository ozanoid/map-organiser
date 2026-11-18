import type { PlanDay } from "@/lib/types";

/**
 * What a day's route depends on, as a short string: the routing profile and
 * the day's stops that have a located place, in order. null when the day has
 * no route (fewer than two such stops).
 *
 * The client keys its route cache on it and sends it with the request; the
 * server answers only if the day it reads has the same signature. Without
 * that check a route computed from a newer state of the plan could be stored
 * under the older state's key.
 */
export function routeSignature(day: Pick<PlanDay, "routing_profile" | "stops">): string | null {
  const located = (day.stops ?? []).filter((s) => s.place?.location);
  if (located.length < 2) return null;
  return `${day.routing_profile}-${located.length}-${hash(located.map((s) => s.id).join(","))}`;
}

/** cyrb53 — a 53-bit string hash; enough to tell two arrangements of a day
 *  apart, and short enough for a query string whatever the number of stops. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
