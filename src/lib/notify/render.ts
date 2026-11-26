import { googleMapsPlaceUrl } from "@/lib/google/maps-url";
import type { DayPart, Plan, PlanDay, PlanStop } from "@/lib/types";
import type { Message } from "@/lib/notify/types";
import { TELEGRAM_MAX_CHARS } from "@/lib/notify/telegram-limits";

/**
 * The messages the app sends, in Turkish (Phase 3, decision 14 — the app's
 * own screens stay English). Built from the data at send time, the same for
 * every channel: e-mail HTML + plain text, and Telegram's HTML subset.
 * Deterministic templates, not a model: no cost, the same every time.
 */

/** The name the app's messages go out under: the e-mail sender, the
 *  subjects, the Telegram bot (Mappy, @mappysitebot). Ozan, 26.11.2026 —
 *  the app's own screens keep "Map Organiser". */
export const SENDER_NAME = "Mappy";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** At most `max` characters, cut between code points (an emoji isn't
 *  split); "…" marks the cut. */
export function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

const DAY_PART_TR: Record<DayPart, string> = {
  morning: "Sabah",
  afternoon: "Öğleden sonra",
  evening: "Akşam",
  night: "Gece",
};

/** "28 Kasım Cumartesi", or "2 Ocak 2027 Cumartesi" with the year — a
 *  plan's dates are calendar dates, read as UTC. */
export function trDay(iso: string, withYear = false): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
    weekday: "long",
    timeZone: "UTC",
  });
}

/** "28 Kasım Cumartesi" or "28 Kasım Cumartesi – 30 Kasım Pazartesi"; with
 *  the year on both ends when either isn't in this year. */
export function trRange(start: string, end: string | null, now = new Date()): string {
  const thisYear = String(now.getUTCFullYear());
  const withYear = start.slice(0, 4) !== thisYear || (end !== null && end.slice(0, 4) !== thisYear);
  if (!end || end === start) return trDay(start, withYear);
  return `${trDay(start, withYear)} – ${trDay(end, withYear)}`;
}

// ── One plan, as lines every channel draws its own way ─────────────────

interface StopLine {
  /** "19:00", "Akşam" or "" */
  when: string;
  name: string;
  url: string | null;
  address: string | null;
  notes: string | null;
  /** "atlandı", "✓" or null */
  mark: string | null;
}

interface DayBlock {
  heading: string;
  notes: string | null;
  stops: StopLine[];
}

function stopLine(s: PlanStop): StopLine {
  const place = s.place ?? null;
  return {
    when: s.start_time ? s.start_time.slice(0, 5) : s.day_part ? DAY_PART_TR[s.day_part] : "",
    name: place?.name ?? s.title ?? "Durak",
    url: place ? googleMapsPlaceUrl(place.name, place.google_place_id, place.google_data?.url) : null,
    address: place?.address ?? null,
    notes: s.notes?.trim() || null,
    mark: s.status === "skipped" ? "atlandı" : s.status === "done" ? "✓" : null,
  };
}

function dayBlocks(plan: Plan): DayBlock[] {
  const days = [...(plan.days ?? [])].sort((a, b) => a.day_number - b.day_number);
  const many = days.length > 1;
  return days.map((d: PlanDay) => ({
    heading: many ? `${d.day_number}. gün${d.date ? ` — ${trDay(d.date)}` : ""}` : d.date ? trDay(d.date) : "",
    notes: d.notes?.trim() || null,
    stops: [...(d.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(stopLine),
  }));
}

function planDates(plan: Plan): string {
  return plan.start_date ? trRange(plan.start_date, plan.end_date) : "Tarihi yok";
}

const planUrl = (plan: Plan, appUrl: string) => `${appUrl}/plans/${plan.id}`;
const settingsUrl = (appUrl: string) => `${appUrl}/settings?tab=notifications`;

// ── E-mail layout ──────────────────────────────────────────────────────

const ACCENT = "#047857"; // emerald-700, the app's accent

function emailLayout(title: string, body: string, appUrl: string): string {
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
${body}
</div>
<p style="max-width:560px;margin:12px auto 0;color:#6b7280;font-size:12px">${SENDER_NAME} · <a href="${escapeHtml(settingsUrl(appUrl))}" style="color:#6b7280">Bildirim ayarları</a></p>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
}

// ── Messages ───────────────────────────────────────────────────────────

/** A plan's summary: its dates, days and stops with times, notes and map links. */
export function planSummaryMessage(plan: Plan, appUrl: string): Message {
  const dates = planDates(plan);
  const days = dayBlocks(plan);
  const cancelled = plan.status === "cancelled";
  const notes = plan.notes?.trim() || null;
  const url = planUrl(plan, appUrl);

  // Plain text
  const text: string[] = [plan.name, cancelled ? `${dates} · İptal edildi` : dates];
  if (notes) text.push("", notes);
  for (const d of days) {
    text.push("");
    if (d.heading) text.push(d.heading);
    if (d.notes) text.push(d.notes);
    if (d.stops.length === 0) text.push("• Henüz durak yok");
    for (const s of d.stops) {
      text.push(`• ${[s.when, s.name].filter(Boolean).join(" — ")}${s.mark ? ` (${s.mark})` : ""}`);
      if (s.notes) text.push(`  ${s.notes}`);
      if (s.url) text.push(`  ${s.url}`);
    }
  }
  text.push("", `Planı aç: ${url}`);

  // E-mail
  const parts: string[] = [
    `<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(plan.name)}</h1>`,
    `<p style="margin:0;color:#4b5563">${escapeHtml(dates)}${cancelled ? ` · <strong style="color:#b91c1c">İptal edildi</strong>` : ""}</p>`,
  ];
  if (notes) parts.push(`<p style="margin:12px 0 0">${escapeHtml(notes)}</p>`);
  for (const d of days) {
    if (d.heading) parts.push(`<h2 style="font-size:15px;margin:20px 0 4px">${escapeHtml(d.heading)}</h2>`);
    if (d.notes) parts.push(`<p style="margin:0 0 4px;color:#4b5563;font-size:14px">${escapeHtml(d.notes)}</p>`);
    if (d.stops.length === 0) {
      parts.push(`<p style="margin:4px 0;color:#6b7280;font-size:14px">Henüz durak yok</p>`);
      continue;
    }
    parts.push(
      `<ul style="padding-left:18px;margin:8px 0 0">${d.stops
        .map((s) => {
          const name = s.url
            ? `<a href="${escapeHtml(s.url)}" style="color:${ACCENT}">${escapeHtml(s.name)}</a>`
            : escapeHtml(s.name);
          const lines = [
            `${s.when ? `<strong>${escapeHtml(s.when)}</strong> · ` : ""}${name}${s.mark ? ` <span style="color:#6b7280">(${escapeHtml(s.mark)})</span>` : ""}`,
            s.address ? `<span style="color:#6b7280;font-size:13px">${escapeHtml(s.address)}</span>` : null,
            s.notes ? `<span style="font-size:13px">${escapeHtml(s.notes)}</span>` : null,
          ].filter(Boolean);
          return `<li style="margin:0 0 10px">${lines.join("<br>")}</li>`;
        })
        .join("")}</ul>`
    );
  }
  parts.push(button(url, "Planı aç"));

  return {
    subject: `Plan: ${plan.name}${plan.start_date ? ` — ${dates}` : ""}`,
    text: text.join("\n"),
    html: emailLayout(plan.name, parts.join("\n"), appUrl),
    telegram: planTelegram(plan, dates, days, notes, cancelled, url),
  };
}

/** Telegram's notes stay short — a plan's notes may run to 5,000
 *  characters, a message to 4,096; the whole text is in the app. */
const TG_NOTES = { plan: 500, day: 300, stop: 200 } as const;

/** The Telegram text, within its 4,096 characters: notes are clipped, and
 *  stops that don't fit are counted and left to the app. */
function planTelegram(
  plan: Plan,
  dates: string,
  days: DayBlock[],
  notes: string | null,
  cancelled: boolean,
  url: string
): string {
  const head = [`<b>${escapeHtml(plan.name)}</b>`, `${escapeHtml(dates)}${cancelled ? " · <b>İptal edildi</b>" : ""}`];
  if (notes) head.push("", `<i>${escapeHtml(clip(notes, TG_NOTES.plan))}</i>`);
  const tail = ["", `<a href="${escapeHtml(url)}">Planı aç</a>`];

  // Each stop's lines are one unit: a stop is shown whole or not at all.
  const units: { lines: string[]; stop: boolean }[] = [];
  for (const d of days) {
    const dayHead = [""];
    if (d.heading) dayHead.push(`<b>${escapeHtml(d.heading)}</b>`);
    if (d.notes) dayHead.push(`<i>${escapeHtml(clip(d.notes, TG_NOTES.day))}</i>`);
    if (d.stops.length === 0) dayHead.push("• Henüz durak yok");
    units.push({ lines: dayHead, stop: false });
    for (const s of d.stops) {
      const name = s.url ? `<a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);
      const lines = [`• ${s.when ? `${escapeHtml(s.when)} ` : ""}${name}${s.mark ? ` (${escapeHtml(s.mark)})` : ""}`];
      if (s.notes) lines.push(`   <i>${escapeHtml(clip(s.notes, TG_NOTES.stop))}</i>`);
      units.push({ lines, stop: true });
    }
  }

  const total = units.filter((u) => u.stop).length;
  const out = [...head];
  let shown = 0;
  const budget = TELEGRAM_MAX_CHARS - 200; // the tail and the "more" line
  for (const u of units) {
    const next = [...out, ...u.lines].join("\n");
    if (next.length > budget) break;
    out.push(...u.lines);
    if (u.stop) shown++;
  }
  if (shown < total) out.push("", `… ve ${total - shown} durak daha — planın tamamı uygulamada.`);
  return [...out, ...tail].join("\n");
}

/** The confirmation an address gets before anything else is sent to it. */
export function emailVerifyMessage(link: string, appUrl: string): Message {
  const intro = `${SENDER_NAME} bildirimlerini (plan özetleri, hatırlatmalar) bu adrese göndermek için adresini onayla.`;
  const after = "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin. Link 24 saat geçerli.";
  return {
    subject: `E-posta adresini onayla — ${SENDER_NAME}`,
    text: [intro, "", link, "", after].join("\n"),
    html: emailLayout(
      "E-posta adresini onayla",
      [
        `<h1 style="font-size:20px;margin:0 0 12px">E-posta adresini onayla</h1>`,
        `<p style="margin:0">${escapeHtml(intro)}</p>`,
        button(link, "Adresimi onayla"),
        `<p style="margin:16px 0 0;color:#6b7280;font-size:13px">${escapeHtml(after)}</p>`,
      ].join("\n"),
      appUrl
    ),
    telegram: "",
  };
}

/** "Send test" in Settings. */
export function channelTestMessage(appUrl: string): Message {
  const line = `Bu bir test mesajı: ${SENDER_NAME} bildirimleri buraya ulaşıyor ✓`;
  return {
    subject: `Test — ${SENDER_NAME}`,
    text: line,
    html: emailLayout("Test", `<p style="margin:0">${escapeHtml(line)}</p>`, appUrl),
    telegram: escapeHtml(line),
  };
}
