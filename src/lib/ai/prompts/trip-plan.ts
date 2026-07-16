/**
 * v1.22.0 (S4 AI-09) — prompt builder for the AI trip planner.
 *
 * Candidates go in as a COMPACT projection (~350 tokens/place), never
 * full profiles or raw popular_times (the latter alone is ~1.8k
 * tokens/place — prohibitive at 40 candidates). Open/closed per trip day
 * is precomputed server-side with the pure openStatus helpers, so the
 * LLM sees ready flags instead of raw timetables.
 */

export interface TripPlanDayFrame {
  day_number: number;
  /** ISO date. */
  date: string;
  /** e.g. "Saturday". */
  weekday: string;
}

export interface TripPlanCandidate {
  name: string;
  category: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  ratings_count: number | null;
  /** 1-4 or null. */
  price_level: number | null;
  tldr: string | null;
  /** From place_profile.features — short tag lists. */
  occasions: string[];
  atmosphere: string[];
  /** Aligned with the days array: open (true), closed (false), unknown (null). */
  open_by_day: (boolean | null)[];
  /** True when the place is already placed in the trip by the user. */
  in_trip: boolean;
}

export function buildTripPlanSystemPrompt(): string {
  return `You are a trip-day planner. You distribute a traveller's SAVED places across the days of their trip.

Rules:
- Reference places ONLY by their [idx] number. Use each idx AT MOST once across all days. Never invent an idx.
- Group by GEOGRAPHY first (use the coordinates — keep each day's stops close together, avoid criss-crossing the city), then by theme.
- Respect the open/closed flags: never schedule a place on a day it is marked closed (✗). Unknown (?) is acceptable.
- Order stops within a day by a sensible daily rhythm: cafés/breakfast → sights/museums/parks → restaurants → bars/nightlife. Assign each stop a time_slot (morning/afternoon/evening/night).
- 3-6 stops per day is ideal. It is FINE to leave places out — quality over cramming. Do not pad.
- day_number must be one of the provided trip days.
- theme: a short label. rationale: 1-2 sentences on why the grouping works. Optional per-stop note only when genuinely useful.
- Write themes/rationales/notes in English.`;
}

export function buildTripPlanPrompt(
  tripName: string,
  days: TripPlanDayFrame[],
  candidates: TripPlanCandidate[]
): string {
  const dayLines = days
    .map((d) => `Day ${d.day_number}: ${d.date} (${d.weekday})`)
    .join("\n");

  const candidateLines = candidates
    .map((c, i) => {
      const open = c.open_by_day
        .map((o, di) => `D${days[di]?.day_number ?? di + 1}${o === true ? "✓" : o === false ? "✗" : "?"}`)
        .join(" ");
      const bits = [
        c.category ?? "Other",
        `(${c.lat.toFixed(3)},${c.lng.toFixed(3)})`,
        c.rating != null ? `★${c.rating}${c.ratings_count ? ` (${c.ratings_count})` : ""}` : null,
        c.price_level != null ? "$".repeat(c.price_level) : null,
        `open: ${open}`,
        c.in_trip ? "IN-TRIP" : null,
      ]
        .filter(Boolean)
        .join(" | ");
      const tags = [...c.occasions.slice(0, 4), ...c.atmosphere.slice(0, 4)].join(", ");
      return [
        `[${i}] ${c.name} | ${bits}`,
        c.tldr ? `    ${c.tldr}` : null,
        tags ? `    tags: ${tags}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `Trip: ${tripName}

Days:
${dayLines}

Candidate places (idx-referenced):
${candidateLines}

Plan the days.`;
}
