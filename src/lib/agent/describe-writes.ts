import "server-only";
import { createHash } from "node:crypto";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AssistantContext } from "@/lib/assistant/library";
import { updatePlanChanges, updatePlanInput } from "@/lib/assistant/tools/update-plan";
import type { StoredMessage, ToolCall } from "@/lib/agent/history";
import type { PreviewLine, WritePreview } from "@/lib/agent/ui-types";
import { emailConfigured, telegramConfigured } from "@/lib/notify/config";
import { addDays, formatDayDate } from "@/lib/plans/dates";
import { PlanInputError, PlanNotFoundError, previewPlanChanges, type PlanSnapshot } from "@/lib/plans/write";
import { log } from "@/lib/telemetry/logger";

/**
 * What an approval card shows: the proposal itself, in words. The model
 * goes to the card without describing a plan or a list (eval, 23.11.2026),
 * so the card is the description — every id resolved to a name.
 *
 * Names come from the user's own rows (RLS) and, for places proposed from a
 * Google Maps search, from that search's result earlier in the conversation.
 * Nothing here calls a paid service.
 *
 * A plan change still waiting for its answer is shown as the plan will be —
 * the days it changes, stop by stop, and what it removes — worked out by the
 * save itself in a transaction that is rolled back (previewPlanChanges). Its
 * fingerprint goes to the panel; the answer brings it back, and the change
 * is saved only if the plan would still come out the same (verifyProposal).
 */

const MAX_LINES = 14;
/** A plan as it will be is the proposal itself: room for a few full days. */
const PLAN_PREVIEW_MAX_LINES = 60;

type Input = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): Input[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Input[]) : []);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const CURRENCY: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", TRY: "₺" };
function cost(amount: unknown, currency: unknown): string | undefined {
  const n = num(amount);
  if (n === undefined) return undefined;
  const code = str(currency)?.toUpperCase() ?? "USD";
  return `~${CURRENCY[code] ?? `${code} `}${Math.round(n)} pp`;
}

function day(iso: unknown): string | undefined {
  const d = str(iso);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDayDate(d) : undefined;
}

const DAY_PART: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
const STATUS: Record<string, string> = {
  want_to_go: "Want to go",
  booked: "Booked",
  visited: "Visited",
  favorite: "Favourite",
};

function joinNote(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(" · ") : undefined;
}

/** The place a Google Maps link names, from its path (/maps/place/<name>/…). */
function nameFromMapsUrl(url: string): string | undefined {
  try {
    const match = /\/maps\/place\/([^/@]+)/.exec(new URL(url).pathname);
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")).trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** google_cid → name and area, from the Google Maps searches already in the
 *  conversation (search_google_maps results carry both). */
function placesFromSearches(history: readonly StoredMessage[]): Map<string, { name: string; area?: string }> {
  const found = new Map<string, { name: string; area?: string }>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Input;
    const cid = str(o.google_cid);
    const name = str(o.name);
    if (cid && name && !found.has(cid)) found.set(cid, { name, area: str(o.area) ?? str(o.address) });
    Object.values(o).forEach(visit);
  };
  for (const message of history) {
    if (message.role !== "user") continue;
    for (const block of message.content as BetaContentBlockParam[]) {
      if (block.type !== "tool_result" || typeof block.content !== "string") continue;
      try {
        visit(JSON.parse(block.content));
      } catch {
        // an error message, not JSON
      }
    }
  }
  return found;
}

// ── A plan as it will be ─────────────────────────────────────────────

type PlanPreview =
  | { kind: "ok"; before: PlanSnapshot; after: PlanSnapshot; fingerprint: string }
  /** The database can't preview (the migration isn't applied), or the input isn't one. */
  | { kind: "unavailable" }
  /** The change can't be applied to the plan as it is now. */
  | { kind: "refused"; message: string };

const PLAN_CHANGED =
  "The plan changed after this proposal was shown, so nothing was saved. A fresh proposal is needed.";

/** Stable for the same plan: the snapshot's JSON comes in the database's order. */
function fingerprintOf(after: PlanSnapshot): string {
  return createHash("sha256").update(JSON.stringify(after)).digest("hex").slice(0, 16);
}

async function planPreviewOf(ctx: AssistantContext, call: ToolCall): Promise<PlanPreview> {
  const parsed = updatePlanInput.safeParse(call.input);
  const changes = parsed.success ? updatePlanChanges(parsed.data) : null;
  if (!parsed.success || !changes) return { kind: "unavailable" };
  try {
    const result = await previewPlanChanges(ctx, parsed.data.plan_id, changes);
    if (!result) return { kind: "unavailable" };
    return { kind: "ok", ...result, fingerprint: fingerprintOf(result.after) };
  } catch (e) {
    if (e instanceof PlanInputError || e instanceof PlanNotFoundError) return { kind: "refused", message: e.message };
    throw e;
  }
}

/**
 * At the user's yes: is the plan change still what the card showed? null
 * when it is (or can't be told — the save decides); else why nothing should
 * be saved, for the model and the card alike.
 */
export async function verifyProposal(ctx: AssistantContext, call: ToolCall, seen: string): Promise<string | null> {
  if (call.name !== "update_plan") return null;
  try {
    const preview = await planPreviewOf(ctx, call);
    if (preview.kind === "unavailable") return null;
    if (preview.kind === "refused" || preview.fingerprint !== seen) return PLAN_CHANGED;
    return null;
  } catch (e) {
    log.warn("agent.verify_failed", { tool: call.name, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

const sameStops = (a: PlanSnapshot["days"][number], b: PlanSnapshot["days"][number]) =>
  a.day_number === b.day_number && (a.notes ?? "") === (b.notes ?? "") && JSON.stringify(a.stops) === JSON.stringify(b.stops);

/**
 * What changes, as the plan will be: the plan's own fields, then every day
 * that changes (new, renumbered, its notes, its stops or their order), stop
 * by stop, then the days and stops it removes. Days left as they are don't
 * show.
 */
export function planChangeLines(before: PlanSnapshot, after: PlanSnapshot): PreviewLine[] {
  const lines: PreviewLine[] = [];
  if (after.name !== before.name) lines.push({ label: "Rename", text: after.name });
  if (after.start_date !== before.start_date) lines.push({ label: "Date", text: day(after.start_date) ?? "No date" });
  if (after.party_size !== before.party_size) lines.push({ label: "People", text: String(after.party_size) });
  if ((after.notes ?? "") !== (before.notes ?? "")) lines.push({ label: "Notes", text: str(after.notes) ?? "Cleared" });
  if (after.status !== before.status) {
    lines.push({ label: "Status", text: after.status === "cancelled" ? "Cancel the plan" : "Restore the plan" });
  }

  const was = new Map(before.days.map((d) => [d.id, d]));
  for (const d of after.days) {
    const old = was.get(d.id);
    if (old && sameStops(old, d)) continue;
    const date = after.start_date ? day(addDays(after.start_date, d.day_number - 1)) : undefined;
    lines.push({ heading: true, label: `Day ${d.day_number}`, text: date ?? "" });
    if (str(d.notes)) lines.push({ label: "Notes", text: d.notes as string });
    if (d.stops.length === 0) lines.push({ text: "No stops" });
    for (const s of d.stops) {
      lines.push({
        label: str(s.start_time)?.slice(0, 5) ?? DAY_PART[str(s.day_part) ?? ""],
        text: str(s.name) ?? "A stop",
        note: joinNote(str(s.notes), cost(s.cost_estimate, s.currency)),
      });
    }
  }

  const keptDays = new Set(after.days.map((d) => d.id));
  const keptStops = new Set(after.days.flatMap((d) => d.stops.map((s) => s.id)));
  for (const d of before.days) if (!keptDays.has(d.id)) lines.push({ label: "Remove", text: `Day ${d.day_number}` });
  for (const s of before.days.flatMap((d) => d.stops)) {
    if (!keptStops.has(s.id)) lines.push({ label: "Remove", text: str(s.name) ?? "A stop" });
  }
  return lines;
}

/** Previews for the calls that need a card, keyed by tool-use id. `waiting`:
 *  the calls still waiting for an answer — a plan change among them is shown
 *  as the plan will be. A decided one keeps the words of its call: the plan
 *  has moved on since. */
export async function describeWrites(
  ctx: AssistantContext,
  calls: ToolCall[],
  history: readonly StoredMessage[],
  opts: { waiting?: ReadonlySet<string> } = {}
): Promise<Record<string, WritePreview>> {
  if (calls.length === 0) return {};
  const planPreviews = new Map<string, PlanPreview>();
  await Promise.all(
    calls
      .filter((c) => c.name === "update_plan" && opts.waiting?.has(c.id))
      .map(async (c) => planPreviews.set(c.id, await planPreviewOf(ctx, c)))
  );
  const placeIds = new Set<string>();
  const planIds = new Set<string>();
  const listIds = new Set<string>();
  const visitIds = new Set<string>();
  const stopIds = new Set<string>();
  let wantsChannels = false;

  for (const { name, input } of calls) {
    const i = (input ?? {}) as Input;
    switch (name) {
      case "create_plan":
        for (const d of arr(i.days)) for (const s of arr(d.stops)) if (str(s.place_id)) placeIds.add(s.place_id as string);
        break;
      case "update_plan":
        if (str(i.plan_id)) planIds.add(i.plan_id as string);
        for (const op of arr(i.ops)) {
          if (str(op.place_id)) placeIds.add(op.place_id as string);
          if (str(op.stop_id)) stopIds.add(op.stop_id as string);
        }
        break;
      case "save_list":
        if (str(i.list_id)) listIds.add(i.list_id as string);
        for (const op of arr(i.ops)) {
          if (str(op.place_id)) placeIds.add(op.place_id as string);
          ids(op.place_ids).forEach((id) => placeIds.add(id));
        }
        break;
      case "add_places":
        if (str(i.list_id)) listIds.add(i.list_id as string);
        break;
      case "log_visit":
        if (str(i.place_id)) placeIds.add(i.place_id as string);
        if (str(i.plan_stop_id)) stopIds.add(i.plan_stop_id as string);
        if (str(i.visit_id)) visitIds.add(i.visit_id as string);
        break;
      case "delete_visit":
        if (str(i.visit_id)) visitIds.add(i.visit_id as string);
        break;
      case "update_places":
        ids(i.place_ids).forEach((id) => placeIds.add(id));
        break;
      case "send_plan":
        if (str(i.plan_id)) planIds.add(i.plan_id as string);
        wantsChannels = true;
        break;
    }
  }

  const sb = ctx.supabase;
  const [places, plans, lists, visits, stops, channels] = await Promise.all([
    placeIds.size
      ? sb.from("places").select("id, name, city").eq("user_id", ctx.userId).in("id", [...placeIds])
      : Promise.resolve({ data: [] }),
    planIds.size
      ? sb.from("plans").select("id, name").eq("user_id", ctx.userId).in("id", [...planIds])
      : Promise.resolve({ data: [] }),
    listIds.size
      ? sb.from("lists").select("id, name").eq("user_id", ctx.userId).in("id", [...listIds])
      : Promise.resolve({ data: [] }),
    visitIds.size
      ? sb.from("visits").select("id, visited_on, places(name)").eq("user_id", ctx.userId).in("id", [...visitIds])
      : Promise.resolve({ data: [] }),
    stopIds.size
      ? sb.from("plan_stops").select("id, title, start_time, places(name)").in("id", [...stopIds])
      : Promise.resolve({ data: [] }),
    wantsChannels
      ? sb
          .from("notification_channels")
          .select("kind, email, telegram_username, verified_at, disabled_at")
          .eq("user_id", ctx.userId)
      : Promise.resolve({ data: [] }),
  ]);
  // The send only uses a channel this server can send through: the same
  // channels in the database, but a preview deployment has no Telegram bot.
  const serverHas = (kind: unknown) => (kind === "email" ? emailConfigured() : telegramConfigured());
  const channelRow = new Map(
    (channels.data ?? []).map((c) => [
      c.kind as string,
      {
        to: c.kind === "email" ? str(c.email) : str(c.telegram_username) ? `@${c.telegram_username}` : "Telegram",
        ready: Boolean(c.verified_at) && !c.disabled_at && serverHas(c.kind),
        why: !c.verified_at
          ? "not confirmed yet"
          : c.disabled_at
            ? "the bot is blocked"
            : !serverHas(c.kind)
              ? "not set up on this server"
              : undefined,
      },
    ])
  );
  const placeName = new Map((places.data ?? []).map((p) => [p.id as string, p.name as string]));
  const planName = new Map((plans.data ?? []).map((p) => [p.id as string, p.name as string]));
  const listName = new Map((lists.data ?? []).map((l) => [l.id as string, l.name as string]));
  const relName = (rel: unknown) => {
    const r = Array.isArray(rel) ? rel[0] : rel;
    return r && typeof r === "object" ? str((r as Input).name) : undefined;
  };
  const visitInfo = new Map(
    (visits.data ?? []).map((v) => [v.id as string, { place: relName(v.places), on: day(v.visited_on) }])
  );
  const stopName = new Map((stops.data ?? []).map((s) => [s.id as string, relName(s.places) ?? str(s.title) ?? "a stop"]));
  const searched = placesFromSearches(history);
  const place = (id: unknown) => (str(id) ? (placeName.get(id as string) ?? "a saved place") : undefined);

  const out: Record<string, WritePreview> = {};
  for (const call of calls) {
    const planned = planPreviews.get(call.id);
    const preview: WritePreview | null =
      planned?.kind === "ok"
        ? {
            title: `Change plan: ${planned.before.name}`,
            lines: planChangeLines(planned.before, planned.after),
            danger: planned.after.status === "cancelled" && planned.before.status !== "cancelled",
            fingerprint: planned.fingerprint,
          }
        : describeOne(call.name, (call.input ?? {}) as Input);
    if (!preview) continue;
    if (planned?.kind === "refused") preview.subtitle = `Can't be applied as it is: ${planned.message}`;
    if (preview.lines.length === 0) preview.lines = [{ text: "No changes" }];
    const max = planned?.kind === "ok" ? PLAN_PREVIEW_MAX_LINES : MAX_LINES;
    if (preview.lines.length > max) {
      preview.more = preview.lines.length - max;
      preview.lines = preview.lines.slice(0, max);
    }
    out[call.id] = preview;
  }
  return out;

  function stopLine(s: Input): PreviewLine {
    return {
      label: str(s.start_time)?.slice(0, 5) ?? DAY_PART[str(s.day_part) ?? ""],
      text: place(s.place_id) ?? str(s.title) ?? "A stop",
      note: joinNote(str(s.notes), cost(s.cost_estimate, s.currency)),
    };
  }

  function describeOne(name: string, i: Input): WritePreview | null {
    switch (name) {
      case "create_plan": {
        const days = arr(i.days);
        const party = num(i.party_size);
        const lines: PreviewLine[] = [];
        days.forEach((d, k) => {
          if (days.length > 1) lines.push({ heading: true, label: `Day ${k + 1}`, text: str(d.notes) ?? "" });
          arr(d.stops).forEach((s) => lines.push(stopLine(s)));
        });
        return {
          title: `Save plan: ${str(i.name) ?? "New plan"}`,
          subtitle: joinNote(
            day(i.start_date) ?? "No date yet",
            party ? `${party} ${party === 1 ? "person" : "people"}` : undefined,
            days.length > 1 ? `${days.length} days` : undefined
          ),
          lines: lines.length ? lines : [{ text: "No stops yet" }],
        };
      }
      case "update_plan": {
        const set = (i.set ?? {}) as Input;
        const lines: PreviewLine[] = [];
        if (str(set.name)) lines.push({ label: "Rename", text: set.name as string });
        if ("start_date" in set) lines.push({ label: "Date", text: day(set.start_date) ?? "No date" });
        if (num(set.party_size)) lines.push({ label: "People", text: String(set.party_size) });
        if ("notes" in set) lines.push({ label: "Notes", text: str(set.notes) ?? "Cleared" });
        if (set.status === "cancelled") lines.push({ label: "Status", text: "Cancel the plan" });
        if (set.status === "planned") lines.push({ label: "Status", text: "Restore the plan" });
        for (const op of arr(i.ops)) {
          const where = num(op.day) ? `day ${op.day}` : "a day";
          switch (op.op) {
            case "add_stop":
              lines.push({ label: "Add", ...stopLine(op), note: joinNote(where, str(op.notes), cost(op.cost_estimate, op.currency)) });
              break;
            case "update_stop":
              lines.push({
                label: "Change",
                text: stopName.get(op.stop_id as string) ?? "A stop",
                note: joinNote(
                  str(op.start_time) && `at ${(op.start_time as string).slice(0, 5)}`,
                  str(op.day_part) && DAY_PART[op.day_part as string],
                  str(op.status) && `mark ${op.status}`,
                  str(op.notes)
                ),
              });
              break;
            case "move_stop":
              lines.push({ label: "Move", text: stopName.get(op.stop_id as string) ?? "A stop", note: `to ${where}` });
              break;
            case "remove_stop":
              lines.push({ label: "Remove", text: stopName.get(op.stop_id as string) ?? "A stop" });
              break;
            case "reorder_stops":
              lines.push({ label: "Reorder", text: `Stops on ${where}` });
              break;
            case "add_day":
              lines.push({ label: "Add", text: "A day", note: str(op.notes) });
              break;
            case "remove_day":
              lines.push({ label: "Remove", text: num(op.day) ? `Day ${op.day}` : "A day" });
              break;
            case "swap_days":
              lines.push({ label: "Swap", text: num(op.a) && num(op.b) ? `Days ${op.a} and ${op.b}` : "Two days" });
              break;
            case "set_day":
              lines.push({ label: "Change", text: num(op.day) ? `Day ${op.day}` : "A day", note: str(op.notes) });
              break;
          }
        }
        return {
          title: `Change plan: ${planName.get(i.plan_id as string) ?? "your plan"}`,
          lines: lines.length ? lines : [{ text: "No changes" }],
          danger: set.status === "cancelled",
        };
      }
      case "save_list": {
        const set = (i.set ?? {}) as Input;
        const existing = str(i.list_id) ? listName.get(i.list_id as string) : undefined;
        const lines: PreviewLine[] = [];
        if (existing && str(set.name)) lines.push({ label: "Rename", text: set.name as string });
        for (const op of arr(i.ops)) {
          switch (op.op) {
            case "add_place":
              lines.push({ text: place(op.place_id) ?? "A place", note: str(op.note) });
              break;
            case "remove_place":
              lines.push({ label: "Remove", text: place(op.place_id) ?? "A place" });
              break;
            case "set_note":
              lines.push({ label: "Note", text: place(op.place_id) ?? "A place", note: str(op.note) ?? "Note cleared" });
              break;
            case "move_place":
              lines.push({ label: "Move", text: place(op.place_id) ?? "A place", note: `to position ${op.position}` });
              break;
            case "reorder":
              lines.push({ label: "Reorder", text: `${ids(op.place_ids).length} places` });
              break;
          }
        }
        return {
          title: existing ? `Change list: ${existing}` : `Create list: ${str(set.name) ?? "New list"}`,
          subtitle: str(set.description),
          lines: lines.length ? lines : [{ text: "No changes" }],
        };
      }
      case "add_places": {
        const list = str(i.list_id) ? listName.get(i.list_id as string) : undefined;
        const status = STATUS[str(i.visit_status) ?? ""];
        const subtitle = joinNote(status && `as ${status}`, list && `onto ${list}`);
        if (str(i.instagram_url)) {
          return { title: "Add the places in an Instagram post", subtitle, lines: [{ text: i.instagram_url as string }] };
        }
        if (i.instagram_pick) {
          return { title: "Add the venue you picked", subtitle, lines: [{ text: "From the Instagram import" }] };
        }
        const targets = arr(i.places);
        return {
          title: `Add ${targets.length === 1 ? "a place" : `${targets.length} places`}`,
          subtitle,
          lines: targets.map((t) => {
            const fromSearch = str(t.google_cid) ? searched.get(t.google_cid as string) : undefined;
            return {
              text: fromSearch?.name ?? (str(t.maps_url) && nameFromMapsUrl(t.maps_url as string)) ?? "A place on Google Maps",
              note: joinNote(fromSearch?.area, str(t.note)),
            };
          }),
        };
      }
      case "log_visit": {
        const visit = str(i.visit_id) ? visitInfo.get(i.visit_id as string) : undefined;
        const where = place(i.place_id) ?? (str(i.plan_stop_id) ? stopName.get(i.plan_stop_id as string) : undefined) ?? visit?.place;
        const rating = num(i.rating);
        return {
          title: visit ? "Change a visit" : "Log a visit",
          lines: [
            {
              text: where ?? "A place",
              note: joinNote(
                day(i.visited_on) ?? visit?.on ?? "Today",
                rating ? `${rating}/5` : i.rating === null ? "No rating" : undefined
              ),
            },
            ...(str(i.notes) ? [{ label: "Notes", text: i.notes as string }] : []),
          ],
        };
      }
      case "delete_visit": {
        const visit = visitInfo.get(i.visit_id as string);
        return {
          title: "Delete a visit",
          lines: [
            { text: visit?.place ?? "A visit", note: visit?.on },
            { text: "A plan stop it ticked off becomes planned again." },
          ],
          danger: true,
        };
      }
      case "send_plan": {
        const name = str(i.plan_id) ? planName.get(i.plan_id as string) : undefined;
        const asked = ids(i.channels).filter((c) => c === "email" || c === "telegram");
        // Left out, every channel that is ready gets it.
        const targets = asked.length ? asked : (["email", "telegram"] as const).filter((c) => channelRow.get(c)?.ready);
        const LABEL: Record<string, string> = { email: "E-mail", telegram: "Telegram" };
        return {
          title: `Send to you: ${name ?? "a plan"}`,
          subtitle: "A summary with its days, stops, times and map links, in Turkish",
          lines: targets.length
            ? targets.map((c) => {
                const row = channelRow.get(c);
                return row?.ready
                  ? { label: LABEL[c], text: row.to ?? LABEL[c] }
                  : { label: LABEL[c], text: "Not connected", note: row?.why ?? "Settings → Notifications" };
              })
            : [{ text: "No channel connected", note: "Settings → Notifications" }],
        };
      }
      case "update_places": {
        const names = ids(i.place_ids).map((id) => place(id) ?? "A place");
        const changes: PreviewLine[] = [];
        if ("visit_status" in i) changes.push({ label: "Status", text: STATUS[str(i.visit_status) ?? ""] ?? "Cleared" });
        if ("rating" in i) changes.push({ label: "Rating", text: num(i.rating) ? `${i.rating}/5` : "Cleared" });
        if (str(i.note)) changes.push({ label: "Note", text: i.note as string });
        if (ids(i.add_tags).length) changes.push({ label: "Add tags", text: ids(i.add_tags).join(", ") });
        if (ids(i.remove_tags).length) changes.push({ label: "Remove tags", text: ids(i.remove_tags).join(", ") });
        return {
          title: names.length === 1 ? `Update ${names[0]}` : `Update ${names.length} places`,
          subtitle: names.length > 1 ? names.slice(0, 6).join(", ") + (names.length > 6 ? ` +${names.length - 6}` : "") : undefined,
          lines: changes.length ? changes : [{ text: "No changes" }],
        };
      }
      default:
        return null;
    }
  }
}
