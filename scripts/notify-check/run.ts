/* eslint-disable @typescript-eslint/no-explicit-any -- hands the in-memory stand-in to code typed for supabase-js */
/**
 * Offline checks of Phase 3's notifications (src/lib/notify): the Turkish
 * messages and their escaping, Telegram's length limit, the bot's update
 * handling, one-time tokens, the outbox's record → claim → send → record
 * path, connecting e-mail and Telegram, and sending to the owner — with an
 * in-memory stand-in for the three tables (fake-db.ts) and stand-in
 * providers. No network, no database, no cost.
 *
 *   npm run check:notify
 *
 * Progress goes to stderr; stdout carries the modules' JSON log lines.
 */
import { FakeDb } from "./fake-db";
import { bearerMatches } from "@/lib/api/bearer";
import { uiToolOutput } from "@/lib/agent/ui";
import { ToolInputError } from "@/lib/assistant/library";
import { planSendOutcome } from "@/lib/assistant/tools/send-plan";
import {
  confirmEmail,
  emailAddress,
  emailLinkState,
  linkTelegram,
  readChannels,
  removeEmail,
  setEmail,
  setTelegramBlocked,
  settingsView,
  telegramStartLink,
  unlinkTelegram,
} from "@/lib/notify/channels";
import { resendApiKey, telegramSettingsProblem, telegramToken } from "@/lib/notify/config";
import { fromHeader } from "@/lib/notify/email";
import { NotifyError, TelegramChatGone } from "@/lib/notify/errors";
import { deliver, setSenders, type Delivery } from "@/lib/notify/outbox";
import {
  channelTestMessage,
  clip,
  reminderMessage,
  weeklyMessage,
  emailVerifyMessage,
  escapeHtml,
  planSummaryMessage,
  trDay,
  trRange,
} from "@/lib/notify/render";
import {
  atLocal,
  candidates,
  candidateWindow,
  DEFAULT_SCHEDULE,
  dueNow,
  isoWeekday,
  localDate,
  planZone,
  reminderKey,
  verdict,
  weekOf,
  weeklyKey,
  type CandidatePlan,
  type Existing,
  type ScheduleUser,
} from "@/lib/notify/schedule";
import { readSchedule, saveSchedule, scheduleFromRow, scheduleInput } from "@/lib/notify/schedule-store";
import { runScheduler, type SchedulerStore } from "@/lib/notify/scheduler";
import { sendToOwner } from "@/lib/notify/send";
import { registerWebhook } from "@/lib/notify/telegram";
import { handleUpdate, REPLIES, startPayload, type UpdateEffects } from "@/lib/notify/telegram-updates";
import { TELEGRAM_MAX_CHARS } from "@/lib/notify/telegram-limits";
import { hashToken, looksLikeToken, newToken } from "@/lib/notify/tokens";
import type { Message } from "@/lib/notify/types";
import type { Plan, PlanDay, PlanPlace, PlanStop } from "@/lib/types";

const say = (line = "") => process.stderr.write(`${line}\n`);
let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  say(`   ${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

const APP = "https://app.test";
/** A made-up token in BotFather's shape. */
const FAKE_TOKEN = "123456789:AAHofflineCheckOfflineCheckOfflineCk";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// ── Fixtures ──────────────────────────────────────────────────────────

function place(name: string, googleId: string | null, address: string | null = "Moda Cd. 1, Kadıköy"): PlanPlace {
  return {
    id: `place-${name}`,
    name,
    address,
    city: "İstanbul",
    country: "TR",
    location: null,
    rating: null,
    visit_status: null,
    google_place_id: googleId,
    category: null,
    google_data: { url: null, rating: null, user_ratings_total: null, price_level: null },
  };
}

let stopN = 0;
function stop(over: Partial<PlanStop>): PlanStop {
  stopN++;
  return {
    id: `stop-${stopN}`,
    day_id: "day",
    sort_order: stopN,
    place_id: null,
    title: null,
    start_time: null,
    day_part: null,
    notes: null,
    cost_estimate: null,
    currency: null,
    status: "planned",
    status_at: null,
    created_at: "",
    ...over,
  };
}

function day(n: number, date: string | null, stops: PlanStop[], notes: string | null = null): PlanDay {
  return { id: `day-${n}`, plan_id: "plan", day_number: n, date, notes, routing_profile: "walking" as PlanDay["routing_profile"], created_at: "", stops };
}

function plan(over: Partial<Plan>): Plan {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: USER,
    list_id: null,
    name: "Cumartesi <Moda> & Kadıköy",
    start_date: "2026-11-28",
    end_date: "2026-11-28",
    status: "planned",
    color: "#10b981",
    notes: null,
    party_size: 2,
    created_via: "app",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

/** Telegram's HTML subset: only b, i and a. */
const foreignTags = (html: string) => html.match(/<(?!\/?(?:b|i|a)(?:\s|>))[^>]*>/g) ?? [];

// ── Stand-in providers ────────────────────────────────────────────────

interface Sent {
  channel: "email" | "telegram";
  to: string;
  text: string;
  key?: string;
}
function stubSenders() {
  const sent: Sent[] = [];
  let next: Error | null = null;
  setSenders({
    email: async (m, key) => {
      if (next) {
        const e = next;
        next = null;
        throw e;
      }
      sent.push({ channel: "email", to: m.to, text: m.text, key });
      return `email-${sent.length}`;
    },
    telegram: async (chatId, html) => {
      if (next) {
        const e = next;
        next = null;
        throw e;
      }
      sent.push({ channel: "telegram", to: String(chatId), text: html });
      return String(sent.length);
    },
  });
  return { sent, failNext: (e: Error) => void (next = e) };
}

const msg = (s: string): Message => ({ subject: s, text: s, html: `<p>${s}</p>`, telegram: s });

// ── Checks ────────────────────────────────────────────────────────────

async function main() {
  // Configured as far as the modules can tell; the providers are stand-ins.
  process.env.RESEND_API_KEY = "re_offline_check";
  process.env.EMAIL_FROM = "Map Organiser <plans@mail.example.test>";
  process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
  process.env.TELEGRAM_BOT_USERNAME = "@MapOrganiserTestBot";
  process.env.TELEGRAM_WEBHOOK_SECRET = "offline_check_secret";

  say("## dates in Turkish");
  expect("trDay: 28 Kasım Cumartesi", trDay("2026-11-28") === "28 Kasım Cumartesi", trDay("2026-11-28"));
  const now = new Date("2026-11-25T10:00:00Z");
  expect(
    "trRange: a range within this year",
    trRange("2026-11-28", "2026-11-30", now) === "28 Kasım Cumartesi – 30 Kasım Pazartesi",
    trRange("2026-11-28", "2026-11-30", now)
  );
  expect("trRange: one day", trRange("2026-11-28", "2026-11-28", now) === "28 Kasım Cumartesi");
  expect(
    "trRange: next year's day carries the year before the weekday",
    trRange("2027-01-02", null, now) === "2 Ocak 2027 Cumartesi",
    trRange("2027-01-02", null, now)
  );
  expect(
    "trRange: across the new year, both ends carry the year",
    trRange("2026-12-31", "2027-01-01", now) === "31 Aralık 2026 Perşembe – 1 Ocak 2027 Cuma",
    trRange("2026-12-31", "2027-01-01", now)
  );

  say("## clip and escape");
  expect("clip: short text unchanged", clip("Moda", 10) === "Moda");
  expect("clip: cut with an ellipsis", clip("abcdef", 4) === "abc…", clip("abcdef", 4));
  expect("clip: an emoji isn't split", clip("😀😀😀", 2) === "😀…", clip("😀😀😀", 2));
  expect("escapeHtml: < > & \"", escapeHtml(`<a href="x">&`) === "&lt;a href=&quot;x&quot;&gt;&amp;");

  say("## a plan's summary");
  const evening = plan({
    notes: "Yağmur yağarsa <içeride> kal",
    days: [
      day(1, "2026-11-28", [
        stop({ place_id: "a", place: place("Kahve & Co", "ChIJabc"), start_time: "10:00:00" }),
        stop({ place_id: "b", place: place("Çiya", "ChIJxyz"), day_part: "evening", notes: "Kebap <dene>" }),
        stop({ title: "Sahilde yürüyüş", day_part: "afternoon", status: "skipped" }),
      ]),
    ],
  });
  const m = planSummaryMessage(evening, APP);
  expect("subject: name and date", m.subject === "Plan: Cumartesi <Moda> & Kadıköy — 28 Kasım Cumartesi", m.subject);
  expect("text: raw name", m.text.startsWith("Cumartesi <Moda> & Kadıköy\n28 Kasım Cumartesi"), m.text.slice(0, 60));
  expect("text: time and day part in Turkish", m.text.includes("• 10:00 — Kahve & Co") && m.text.includes("• Akşam — Çiya"));
  expect("text: a skipped stop is marked", m.text.includes("• Öğleden sonra — Sahilde yürüyüş (atlandı)"));
  expect(
    "text: the map link carries the place id",
    m.text.includes("https://www.google.com/maps/search/?api=1&query=Kahve%20%26%20Co&query_place_id=ChIJabc")
  );
  expect("text: the plan's link", m.text.endsWith(`Planı aç: ${APP}/plans/${evening.id}`));
  expect("html: the name escaped", m.html.includes("Cumartesi &lt;Moda&gt; &amp; Kadıköy") && !m.html.includes("<Moda>"));
  expect("html: notes escaped", m.html.includes("Kebap &lt;dene&gt;") && m.html.includes("&lt;içeride&gt;"));
  expect("html: the map link's & escaped in href", m.html.includes("query=Kahve%20%26%20Co&amp;query_place_id=ChIJabc"));
  expect("html: lang tr and the settings link", m.html.includes('<html lang="tr">') && m.html.includes(`${APP}/settings?tab=notifications`));
  expect("telegram: name escaped, bold", m.telegram.startsWith("<b>Cumartesi &lt;Moda&gt; &amp; Kadıköy</b>"), m.telegram.slice(0, 60));
  expect("telegram: only b, i, a tags", foreignTags(m.telegram).length === 0, foreignTags(m.telegram));
  expect("telegram: the plan's link", m.telegram.endsWith(`<a href="${APP}/plans/${evening.id}">Planı aç</a>`));

  const trip = plan({
    name: "Kapadokya",
    start_date: "2026-12-05",
    end_date: "2026-12-06",
    status: "cancelled",
    days: [day(1, "2026-12-05", [stop({ title: "Balon" })]), day(2, "2026-12-06", [], "Serbest gün")],
  });
  const t = planSummaryMessage(trip, APP);
  expect("several days: numbered headings with dates", t.text.includes("1. gün — 5 Aralık Cumartesi") && t.text.includes("2. gün — 6 Aralık Pazar"));
  expect("an empty day says so", t.text.includes("Serbest gün\n• Henüz durak yok"));
  expect("cancelled: said in every channel", t.text.includes("İptal edildi") && t.html.includes("İptal edildi") && t.telegram.includes("İptal edildi"));
  const undated = planSummaryMessage(plan({ start_date: null, end_date: null, days: [day(1, null, [])] }), APP);
  expect("no dates: 'Tarihi yok', subject without a date", undated.text.includes("Tarihi yok") && undated.subject === "Plan: Cumartesi <Moda> & Kadıköy");

  say("## Telegram's 4,096 characters");
  const many = plan({
    name: "Uzun gezi",
    days: [1, 2, 3].map((n) =>
      day(
        n,
        `2026-12-0${n}`,
        Array.from({ length: 30 }, (_, i) =>
          stop({ place_id: `p${n}-${i}`, place: place(`Mekan ${n}-${i}`, `ChIJ${n}${i}`), start_time: "12:00:00", notes: "n".repeat(400) })
        )
      )
    ),
  });
  const long = planSummaryMessage(many, APP).telegram;
  const shown = long.split("\n").filter((l) => l.startsWith("• ")).length;
  const rest = /… ve (\d+) durak daha/.exec(long);
  expect("90 stops: within the limit", long.length <= TELEGRAM_MAX_CHARS, long.length);
  expect("90 stops: the rest counted", rest !== null && shown + Number(rest[1]) === 90, { shown, rest: rest?.[1] });
  expect("90 stops: stop notes clipped to 200", !long.includes("n".repeat(200)) && long.includes(`${"n".repeat(199)}…`));
  expect("90 stops: the plan's link survives", long.endsWith("Planı aç</a>"));
  const essay = planSummaryMessage(plan({ notes: "ç".repeat(5000), days: [day(1, "2026-11-28", [stop({ title: "Tek durak" })])] }), APP).telegram;
  expect("5,000-character plan notes: within the limit", essay.length <= TELEGRAM_MAX_CHARS, essay.length);
  expect("5,000-character plan notes: clipped, the stop still shown", essay.includes("…</i>") && essay.includes("• Tek durak"));

  say("## the other messages");
  const verify = emailVerifyMessage(`${APP}/confirm-email?token=abc`, APP);
  expect("confirmation: subject in Turkish, under Mappy", verify.subject === "E-posta adresini onayla — Mappy");
  expect("confirmation: the text names Mappy", verify.text.startsWith("Mappy bildirimlerini") && verify.html.includes("Mappy · <a"));
  expect("confirmation: the link in text and html", verify.text.includes(`${APP}/confirm-email?token=abc`) && verify.html.includes(`href="${APP}/confirm-email?token=abc"`));
  const test = channelTestMessage(APP);
  expect("test message: every channel has text", Boolean(test.text && test.html && test.telegram));

  say("## the bot's updates");
  type Call = [string, ...unknown[]];
  function recorder(linkAnswer: "linked" | "invalid" | "taken" = "linked") {
    const calls: Call[] = [];
    const fx: UpdateEffects = {
      link: async (token, chat) => {
        calls.push(["link", token, chat]);
        return linkAnswer;
      },
      setBlocked: async (chatId, blocked) => void calls.push(["blocked", chatId, blocked]),
      reply: async (chatId, text) => void calls.push(["reply", chatId, text]),
    };
    return { calls, fx };
  }
  const priv = (text: string, username?: string) => ({
    update_id: 1,
    message: { chat: { id: 42, type: "private", username }, from: { username: "from_user" }, text },
  });

  expect("startPayload: '/start abc'", startPayload("/start abc") === "abc");
  expect("startPayload: '/start@Bot abc'", startPayload("/start@MapOrganiserBot abc") === "abc");
  expect("startPayload: bare '/start'", startPayload("/start") === null);
  expect("startPayload: other text", startPayload("merhaba") === undefined && startPayload(undefined) === undefined);
  expect("startPayload: two words aren't a payload", startPayload("/start a b") === undefined);

  let r = recorder();
  await handleUpdate(priv("/start TOKEN123", "ozan"), r.fx);
  expect(
    "/start <token>: links the chat, says so",
    JSON.stringify(r.calls) === JSON.stringify([["link", "TOKEN123", { id: 42, username: "ozan" }], ["reply", 42, REPLIES.linked]]),
    r.calls
  );
  r = recorder();
  await handleUpdate(priv("/start TOKEN123"), r.fx);
  expect("no chat username: the sender's", (r.calls[0]?.[2] as { username: string }).username === "from_user", r.calls);
  for (const answer of ["invalid", "taken"] as const) {
    r = recorder(answer);
    await handleUpdate(priv("/start TOKEN123"), r.fx);
    expect(`link → ${answer}: the matching reply`, r.calls[1]?.[2] === REPLIES[answer], r.calls);
  }
  r = recorder();
  await handleUpdate(priv("/start"), r.fx);
  expect("bare /start: hello", JSON.stringify(r.calls) === JSON.stringify([["reply", 42, REPLIES.hello]]), r.calls);
  r = recorder();
  await handleUpdate(priv("bu akşam nereye gidelim?"), r.fx);
  expect("anything else: notifications only", JSON.stringify(r.calls) === JSON.stringify([["reply", 42, REPLIES.notifyOnly]]), r.calls);
  r = recorder();
  await handleUpdate({ message: { chat: { id: -100, type: "group" }, text: "/start TOKEN123" } }, r.fx);
  expect("a group: ignored", r.calls.length === 0, r.calls);
  r = recorder();
  await handleUpdate({ my_chat_member: { chat: { id: 42, type: "private" }, new_chat_member: { status: "kicked" } } }, r.fx);
  await handleUpdate({ my_chat_member: { chat: { id: 42, type: "private" }, new_chat_member: { status: "member" } } }, r.fx);
  expect(
    "blocked, then unblocked",
    JSON.stringify(r.calls) === JSON.stringify([["blocked", 42, true], ["blocked", 42, false]]),
    r.calls
  );
  r = recorder();
  await handleUpdate(null, r.fx);
  await handleUpdate("garbage", r.fx);
  await handleUpdate({ edited_message: {} }, r.fx);
  expect("nothing usable: nothing done", r.calls.length === 0, r.calls);

  say("## one-time tokens");
  const tok = newToken();
  expect("43 characters of base64url", tok.length === 43 && /^[A-Za-z0-9_-]+$/.test(tok), tok.length);
  expect("fits Telegram's start payload (64)", tok.length <= 64);
  expect("each one new", newToken() !== tok);
  expect("SHA-256 hex, the same every time", /^[0-9a-f]{64}$/.test(hashToken(tok)) && hashToken(tok) === hashToken(tok));
  expect("looksLikeToken: a token", looksLikeToken(tok));
  expect(
    "looksLikeToken: not too short, long, odd or a non-string",
    !looksLikeToken("abc") && !looksLikeToken("x".repeat(65)) && !looksLikeToken(`${tok.slice(0, 40)}+/=`) && !looksLikeToken(42)
  );

  say("## the sender");
  expect("a bare address goes out as Mappy", fromHeader(" hello@mappy.site ") === "Mappy <hello@mappy.site>", fromHeader(" hello@mappy.site "));
  expect("a named sender stays as set", fromHeader("Another Name <hello@mappy.site>") === "Another Name <hello@mappy.site>");
  expect("the bot's replies speak as Mappy", REPLIES.linked.includes("Mappy bildirimleri") && REPLIES.hello.startsWith("Merhaba! Ben Mappy"));

  say("## e-mail addresses");
  expect("trimmed and lower-cased", emailAddress.safeParse("  Ozan@Example.COM ").data === "ozan@example.com");
  expect("not an address", !emailAddress.safeParse("ozan@").success && !emailAddress.safeParse("x".repeat(250) + "@a.co").success);

  say("## the outbox: record → claim → send → record");
  {
    const db = new FakeDb();
    const admin = db as any;
    const { sent, failNext } = stubSenders();
    const email: Delivery = {
      userId: USER,
      kind: "channel_test",
      dedupeKey: "k1:email",
      message: msg("Test"),
      target: { channel: "email", email: "ozan@example.com" },
    };
    const first = await deliver(admin, email);
    const row = db.tables.notifications[0];
    expect("sent", first.status === "sent", first);
    expect(
      "the record: sent, one attempt, no hold, provider id, a copy",
      row?.status === "sent" && row.attempts === 1 && row.claimed_until === null && row.provider_message_id === "email-1" && row.content?.to === "ozan@example.com",
      row
    );
    expect("Resend's idempotency key is the record's id", sent[0]?.key === `notification-${row?.id}`, sent[0]);
    const again = await deliver(admin, email);
    expect("the same key again: not sent twice", again.status === "busy" && sent.length === 1, { again, sent: sent.length });

    const tg: Delivery = { ...email, dedupeKey: "k1:telegram", target: { channel: "telegram", chatId: 42, username: "ozan" } };
    failNext(new NotifyError("Telegram: Too Many Requests", true, 3));
    const failed = await deliver(admin, tg);
    const tgRow = db.tables.notifications.find((n) => n.dedupe_key === "k1:telegram");
    expect("a provider error: failed, recorded", failed.status === "failed" && tgRow?.status === "failed" && tgRow.last_error === "Telegram: Too Many Requests" && tgRow.claimed_until === null, tgRow);
    const retried = await deliver(admin, tg);
    expect("a failed record is tried again: sent, second attempt", retried.status === "sent" && tgRow?.attempts === 2, tgRow);

    failNext(new TelegramChatGone("Telegram: Forbidden: bot was blocked by the user"));
    const gone = await deliver(admin, { ...tg, dedupeKey: "k2:telegram" });
    expect("blocked bot: failed with chatGone", gone.status === "failed" && gone.chatGone === true, gone);

    // A sender that died mid-send: the row stays 'sending' until its hold lapses.
    const stuck = { ...email, dedupeKey: "k3:email" };
    await db.from("notifications").insert({ user_id: USER, kind: "channel_test", channel: "email", dedupe_key: "k3:email" });
    const stuckRow = db.tables.notifications.find((n) => n.dedupe_key === "k3:email")!;
    Object.assign(stuckRow, { status: "sending", attempts: 1, claimed_until: new Date(Date.now() + 60_000).toISOString() });
    const held = await deliver(admin, stuck);
    expect("held by another sender: left alone", held.status === "busy" && stuckRow.status === "sending", held);
    stuckRow.claimed_until = new Date(Date.now() - 1_000).toISOString();
    const takenOver = await deliver(admin, stuck);
    expect("its hold lapsed: taken over and sent", takenOver.status === "sent" && stuckRow.status === "sent" && stuckRow.attempts === 2, stuckRow);
  }

  say("## connecting e-mail");
  {
    const db = new FakeDb();
    const admin = db as any;
    const { sent } = stubSenders();
    const set = await setEmail(admin, USER, "ozan@example.com", APP);
    const link = /https:\/\/app\.test\/confirm-email\?token=([A-Za-z0-9_-]{43})/.exec(sent[0]?.text ?? "");
    const token = link?.[1] ?? "";
    expect("set: a confirmation link to the page", set.status === "sent" && sent[0]?.to === "ozan@example.com" && Boolean(link), sent[0]);
    expect("set: the address waits for confirmation", (await readChannels(admin, USER)).email?.verified_at === null);
    expect("set: only the token's hash is kept", db.tables.channel_link_tokens[0]?.token_hash === hashToken(token));
    const kept = db.tables.notifications[0]?.content?.text ?? "";
    expect(
      "set: the record's copy of the e-mail masks the token",
      kept.includes("/confirm-email?token=•••") && !kept.includes(token),
      kept.slice(0, 200)
    );
    const view1 = await settingsView(admin, USER);
    expect("settings: open, address, not confirmed", view1.open && view1.email.address === "ozan@example.com" && !view1.email.confirmed, view1);

    const ready = await emailLinkState(admin, token);
    expect("opening the page changes nothing", ready.state === "ready" && db.tables.channel_link_tokens[0].used_at === null, ready);
    expect("Confirm: confirmed", (await confirmEmail(admin, token)) === "confirmed");
    expect("the address is confirmed", Boolean((await readChannels(admin, USER)).email?.verified_at));
    expect("Confirm pressed twice: still 'confirmed'", (await confirmEmail(admin, token)) === "confirmed");
    expect("the page afterwards: confirmed", (await emailLinkState(admin, token)).state === "confirmed");

    const same = await setEmail(admin, USER, "ozan@example.com", APP);
    expect("the same confirmed address again: nothing sent", same.status === "already_confirmed" && sent.length === 1, { same, sent: sent.length });

    await setEmail(admin, USER, "yeni@example.com", APP);
    const newer = /token=([A-Za-z0-9_-]{43})/.exec(sent[1]?.text ?? "")?.[1] ?? "";
    expect("a new address waits for its own confirmation", (await readChannels(admin, USER)).email?.verified_at === null);
    expect("the old address's link confirms nothing now", (await emailLinkState(admin, token)).state === "invalid" && (await confirmEmail(admin, token)) === "invalid");
    const row = db.tables.channel_link_tokens.find((r) => r.token_hash === hashToken(newer))!;
    row.expires_at = new Date(Date.now() - 1_000).toISOString();
    expect("an expired link: invalid, confirms nothing", (await emailLinkState(admin, newer)).state === "invalid" && (await confirmEmail(admin, newer)) === "invalid");
    expect("a made-up token: invalid", (await confirmEmail(admin, "x".repeat(43))) === "invalid" && (await confirmEmail(admin, "")) === "invalid");
    expect("still unconfirmed", (await readChannels(admin, USER)).email?.verified_at === null);
    await removeEmail(admin, USER);
    expect("removed", (await readChannels(admin, USER)).email === undefined);
  }

  say("## connecting Telegram");
  {
    const db = new FakeDb();
    const admin = db as any;
    const url = await telegramStartLink(admin, USER, APP);
    const token = /^https:\/\/t\.me\/MapOrganiserTestBot\?start=([A-Za-z0-9_-]{43})$/.exec(url)?.[1] ?? "";
    expect("the start link: the bot's username without @, a 43-character token", Boolean(token), url);
    expect("Start: linked", (await linkTelegram(admin, token, { id: 42, username: "ozan" })) === "linked");
    const ch = (await readChannels(admin, USER)).telegram;
    expect("the chat is the user's, confirmed", ch?.telegram_chat_id === 42 && Boolean(ch.verified_at), ch);
    expect("Start again from the same chat: still linked", (await linkTelegram(admin, token, { id: 42, username: "ozan" })) === "linked");
    expect("the used link from another chat: invalid", (await linkTelegram(admin, token, { id: 77, username: "baska" })) === "invalid");
    expect("…and the chat stays the first one", (await readChannels(admin, USER)).telegram?.telegram_chat_id === 42);

    const other = await telegramStartLink(admin, OTHER, APP);
    const otherToken = /start=(.+)$/.exec(other)?.[1] ?? "";
    expect("the same chat for another account: taken", (await linkTelegram(admin, otherToken, { id: 42, username: "ozan" })) === "taken");

    const late = /start=(.+)$/.exec(await telegramStartLink(admin, USER, APP))?.[1] ?? "";
    db.tables.channel_link_tokens.find((r) => r.token_hash === hashToken(late))!.expires_at = new Date(Date.now() - 1_000).toISOString();
    expect("an expired start link: invalid", (await linkTelegram(admin, late, { id: 43, username: null })) === "invalid");

    await setTelegramBlocked(admin, 42, true);
    const blocked = await settingsView(admin, USER);
    expect("blocked: shown as blocked", blocked.telegram.linked && blocked.telegram.blocked, blocked.telegram);
    await setTelegramBlocked(admin, 42, false);
    expect("unblocked: usable again", !(await settingsView(admin, USER)).telegram.blocked);
    await unlinkTelegram(admin, USER);
    expect("unlinked", (await readChannels(admin, USER)).telegram === undefined);
  }

  say("## the settings: trimmed, and their shape named");
  {
    const saved = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET, key: process.env.RESEND_API_KEY };
    const withToken = (value: string) => {
      process.env.TELEGRAM_BOT_TOKEN = value;
      return telegramSettingsProblem() ?? "ok";
    };
    process.env.TELEGRAM_WEBHOOK_SECRET = "offline_check_secret";
    expect("a BotFather token: no problem", withToken(FAKE_TOKEN) === "ok");
    expect("a space or a line break around it: trimmed, no problem", withToken(`  ${FAKE_TOKEN} \n`) === "ok" && telegramToken() === FAKE_TOKEN);
    expect("the username in its place: said so", withToken("@MapOrganiserTestBot").includes("it holds the bot's username"));
    expect("the webhook secret in its place: said so", withToken("a".repeat(64)).includes("it looks like the webhook secret"));
    expect("quotes around it: said so", withToken(`"${FAKE_TOKEN}"`).includes("it has quotes around it"));
    expect('"bot" before it: said so', withToken(`bot${FAKE_TOKEN}`).includes('it starts with "bot"'));
    expect("a space inside: said so", withToken("123456789: AAHofflineCheckOfflineCheckOfflineCk").includes("it has a space inside"));
    const shown = withToken("not-a-token-at-all");
    expect("the problem names the variable, never the value", shown.startsWith("TELEGRAM_BOT_TOKEN isn't a BotFather token") && !shown.includes("not-a-token-at-all"), shown);
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_WEBHOOK_SECRET = "has+plus/slash";
    expect("a secret Telegram won't take: said so", (telegramSettingsProblem() ?? "").startsWith("TELEGRAM_WEBHOOK_SECRET may hold only"));
    process.env.RESEND_API_KEY = " re_offline_check\n";
    expect("Resend's key: trimmed too", resendApiKey() === "re_offline_check");
    process.env.TELEGRAM_BOT_TOKEN = saved.token;
    process.env.TELEGRAM_WEBHOOK_SECRET = saved.secret;
    process.env.RESEND_API_KEY = saved.key;
  }

  say("## pointing the bot at the webhook (registerWebhook)");
  {
    // A stand-in for Telegram: records each call's method and body, answers
    // as told. Nothing leaves the machine.
    const realFetch = globalThis.fetch;
    const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
    let botUsername = "MapOrganiserTestBot";
    let refuse: string | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = String(input).split("/").pop() ?? "";
      calls.push({ method, url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      if (refuse === method) {
        return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
      }
      const result = method === "getMe" ? { id: 1, is_bot: true, username: botUsername } : true;
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }) as typeof fetch;
    const outcome = async (origin: string) => {
      try {
        return await registerWebhook(origin);
      } catch (e) {
        return e instanceof NotifyError ? `NotifyError: ${e.message}` : `other: ${String(e)}`;
      }
    };
    const env = { VERCEL_ENV: process.env.VERCEL_ENV, TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET };
    try {
      delete process.env.VERCEL_ENV;
      process.env.TELEGRAM_WEBHOOK_SECRET = "offline_check_secret";
      expect("outside Vercel: skipped, Telegram not called", (await outcome("https://app.test")) === "skipped" && calls.length === 0, calls);
      process.env.VERCEL_ENV = "preview";
      expect("on a preview: skipped (the bot keeps production's webhook)", (await outcome("https://preview.app.test")) === "skipped" && calls.length === 0, calls);

      process.env.VERCEL_ENV = "production";
      const done = await outcome("https://app.test");
      const set = calls.find((c) => c.method === "setWebhook");
      expect("production: the bot is asked who it is, then pointed at the webhook", done === "registered" && calls.map((c) => c.method).join() === "getMe,setWebhook", { done, calls: calls.map((c) => c.method) });
      expect(
        "setWebhook: this deployment's address, the secret, the two update kinds",
        set?.body.url === "https://app.test/api/telegram/webhook" &&
          set.body.secret_token === "offline_check_secret" &&
          JSON.stringify(set.body.allowed_updates) === JSON.stringify(["message", "my_chat_member"]),
        set?.body
      );

      calls.length = 0;
      const link = await telegramStartLink(new FakeDb() as any, USER, "https://app.test");
      expect("Connect in production: registered, then the start link", calls.map((c) => c.method).join() === "getMe,setWebhook" && /^https:\/\/t\.me\/MapOrganiserTestBot\?start=[A-Za-z0-9_-]{43}$/.test(link), { calls: calls.map((c) => c.method), link });

      calls.length = 0;
      botUsername = "SomeOtherBot";
      const wrong = await outcome("https://app.test");
      expect(
        "a token of another bot: refused, the webhook untouched",
        wrong.includes("TELEGRAM_BOT_USERNAME") && wrong.includes("@SomeOtherBot") && !calls.some((c) => c.method === "setWebhook"),
        { wrong, calls: calls.map((c) => c.method) }
      );
      botUsername = "mapORGANISERtestbot";
      calls.length = 0;
      expect("the username's case doesn't matter", (await outcome("https://app.test")) === "registered");
      botUsername = "MapOrganiserTestBot";

      calls.length = 0;
      process.env.TELEGRAM_BOT_TOKEN = `${FAKE_TOKEN} `;
      expect(
        "a token pasted with a trailing space: Telegram gets it trimmed",
        (await outcome("https://app.test")) === "registered" && calls[0]?.url === `https://api.telegram.org/bot${FAKE_TOKEN}/getMe`,
        calls[0]?.url.replace(FAKE_TOKEN, "<token>")
      );
      process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;

      calls.length = 0;
      process.env.TELEGRAM_BOT_TOKEN = "mappysitebot";
      const swapped = await outcome("https://app.test");
      expect("the username as the token: named, Telegram not called", swapped.includes("TELEGRAM_BOT_TOKEN isn't a BotFather token") && calls.length === 0, swapped);
      process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;

      calls.length = 0;
      refuse = "setWebhook";
      const refused = await outcome("https://app.test");
      expect("Telegram refuses: its words come back, not the token", refused === "NotifyError: Telegram: Unauthorized" && !refused.includes(FAKE_TOKEN), refused);
      refuse = null;

      calls.length = 0;
      expect("an http address: refused before calling Telegram", (await outcome("http://app.test")).startsWith("NotifyError: Telegram needs an https address") && calls.length === 0);
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      expect("no webhook secret: refused before calling Telegram", (await outcome("https://app.test")).includes("TELEGRAM_WEBHOOK_SECRET") && calls.length === 0);
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  say("## sending to the owner");
  {
    const db = new FakeDb();
    const admin = db as any;
    const { sent, failNext } = stubSenders();
    const none = await sendToOwner(admin, { userId: USER, kind: "channel_test", key: "t0", message: msg("x") });
    expect("nothing connected: nothing sent, nothing recorded", none.length === 0 && db.tables.notifications.length === 0, none);
    const asked = await sendToOwner(admin, { userId: USER, kind: "channel_test", key: "t1", message: msg("x"), channels: ["email"] });
    expect("asked for an unconnected channel: not_connected", asked.length === 1 && asked[0].status === "not_connected", asked);

    await db.from("notification_channels").insert({ user_id: USER, kind: "email", email: "ozan@example.com", verified_at: new Date().toISOString() });
    await db.from("notification_channels").insert({ user_id: USER, kind: "telegram", telegram_chat_id: 42, telegram_username: "ozan", verified_at: new Date().toISOString() });
    const both = await sendToOwner(admin, { userId: USER, kind: "plan_summary", key: "plan:1", message: msg("Plan") });
    expect(
      "both connected: both sent, each its own record",
      both.every((r) => r.status === "sent") && both.length === 2 && db.tables.notifications.map((n) => n.dedupe_key).sort().join() === "plan:1:email,plan:1:telegram",
      both
    );
    expect("where it went: the address and @username", both.find((r) => r.channel === "email")?.to === "ozan@example.com" && both.find((r) => r.channel === "telegram")?.to === "@ozan");

    failNext(new TelegramChatGone("Telegram: Forbidden: bot was blocked by the user"));
    const goneRun = await sendToOwner(admin, { userId: USER, kind: "plan_summary", key: "plan:2", message: msg("Plan"), channels: ["telegram"] });
    expect("the bot blocked: failed, and the channel switched off", goneRun[0]?.status === "failed" && Boolean((await readChannels(admin, USER)).telegram?.disabled_at), goneRun);
    const afterBlock = await sendToOwner(admin, { userId: USER, kind: "plan_summary", key: "plan:3", message: msg("Plan") });
    expect("then: only e-mail goes", afterBlock.length === 1 && afterBlock[0].channel === "email" && afterBlock[0].status === "sent", afterBlock);

    await setTelegramBlocked(admin, 42, false);
    delete process.env.TELEGRAM_BOT_TOKEN;
    const noBot = await sendToOwner(admin, { userId: USER, kind: "plan_summary", key: "plan:4", message: msg("Plan"), channels: ["telegram"] });
    expect("a server without the bot: not_connected, nothing sent", noBot[0]?.status === "not_connected" && sent.filter((s) => s.channel === "telegram").length === 1, noBot);
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
  }

  say("## the assistant's send_plan: its answer and its card");
  {
    const plan = { id: "p", name: "Kadıköy akşamı", url: `${APP}/plans/p` };
    const both = planSendOutcome({
      plan,
      results: [
        { channel: "email", status: "sent", to: "ozan@example.com" },
        { channel: "telegram", status: "sent", to: "@ozan" },
      ],
    });
    expect("both sent: where it went, nothing else", both.sent.length === 2 && !both.not_connected && !both.failed, both);
    const card = uiToolOutput("send_plan", JSON.stringify(both));
    expect("the card: 'Sent to e-mail and Telegram', the plan's link", card.summary === "Sent to e-mail and Telegram" && card.link?.url === plan.url && card.link.label === plan.name, card);

    const partial = planSendOutcome({
      plan,
      results: [
        { channel: "email", status: "sent", to: "ozan@example.com" },
        { channel: "telegram", status: "not_connected" },
      ],
    });
    const partialCard = uiToolOutput("send_plan", JSON.stringify(partial));
    expect("one sent, one not connected: says both", partialCard.summary === "Sent to e-mail · Telegram isn't connected", partialCard);
    const halfFailed = uiToolOutput(
      "send_plan",
      JSON.stringify(planSendOutcome({ plan, results: [{ channel: "telegram", status: "sent", to: "@ozan" }, { channel: "email", status: "failed", error: "E-mail: rate limited" }] }))
    );
    expect("one sent, one failed: says both", halfFailed.summary === "Sent to Telegram · e-mail failed", halfFailed);

    const refused = (results: Parameters<typeof planSendOutcome>[0]["results"]) => {
      try {
        planSendOutcome({ plan, results });
        return null;
      } catch (e) {
        return e instanceof ToolInputError ? e.message : `other: ${String(e)}`;
      }
    };
    const none = refused([]);
    expect("nothing connected: an error result naming Settings", none?.startsWith("Nothing was sent: the user has no channel connected") === true && none.includes("Settings → Notifications"), none);
    const notConn = refused([{ channel: "telegram", status: "not_connected" }]);
    expect("the asked channel not connected: an error result", notConn === "Nothing was sent: Telegram isn't connected. A channel is connected in the app under Settings → Notifications.", notConn);
    const allFailed = refused([{ channel: "email", status: "failed", error: "E-mail: invalid from" }]);
    expect("every send failed: an error result with the reason", allFailed === "Nothing was sent: e-mail failed (E-mail: invalid from).", allFailed);
  }

  say("## the schedule: time zones and weeks");
  {
    const iso = (d: string, t: string, z: string) => atLocal(d, t, z).toISOString();
    expect("08:00 London the day the clocks go forward = 07:00 UTC", iso("2026-03-29", "08:00", "Europe/London") === "2026-03-29T07:00:00.000Z");
    expect("08:00 London the day they go back = 08:00 UTC", iso("2026-10-25", "08:00", "Europe/London") === "2026-10-25T08:00:00.000Z");
    expect("18:00 Tokyo = 09:00 UTC", iso("2026-11-27", "18:00", "Asia/Tokyo") === "2026-11-27T09:00:00.000Z");
    expect("23:30 UTC is already tomorrow in Istanbul", localDate(new Date("2026-11-26T23:30:00Z"), "Europe/Istanbul") === "2026-11-27");
    expect("30.11.2026 is a Monday, 6.12 a Sunday", isoWeekday("2026-11-30") === 1 && isoWeekday("2026-12-06") === 7);
    const w = weekOf("2026-12-02");
    expect("a week: Monday to Sunday, its ISO number", w.start === "2026-11-30" && w.end === "2026-12-06" && w.key === "2026-W49", w);
    expect("1 January 2027 is in 2026-W53", weekOf("2027-01-01").key === "2026-W53", weekOf("2027-01-01"));
    expect("4 January 2027 starts 2027-W01", weekOf("2027-01-04").key === "2027-W01");
    expect(
      "a plan's zone: its own, else the user's, else UTC",
      planZone("Asia/Tokyo", "Europe/London") === "Asia/Tokyo" && planZone(null, "Europe/London") === "Europe/London" && planZone("Not/AZone", null) === "UTC"
    );
    const win = candidateWindow(new Date("2026-11-27T12:00:00Z"));
    expect("plans read: starting yesterday to two days on (every zone, the grace)", win.from === "2026-11-26" && win.to === "2026-11-29", win);
  }

  say("## the schedule: what is due");
  {
    const T = new Date("2026-11-27T18:00:00Z");
    const at = (minutes: number) => new Date(T.getTime() + minutes * 60_000);
    expect("before its time: wait", verdict(T, at(-1), null, undefined) === "wait");
    expect("at its time: send", verdict(T, at(5), null, undefined) === "send");
    expect("the plan changed after its time: skipped as changed (decision 15)", verdict(T, at(30), at(10), undefined) === "changed");
    expect("the plan changed before its time: send", verdict(T, at(30), at(-10), undefined) === "send");
    expect("three hours and a minute late, nothing on record: skipped late", verdict(T, at(181), null, undefined) === "late");
    expect(
      "sent or skipped: done",
      verdict(T, at(5), null, { status: "sent", attempts: 1 }) === "done" && verdict(T, at(5), null, { status: "skipped", attempts: 0 }) === "done"
    );
    expect("failed twice: tried again", verdict(T, at(30), null, { status: "failed", attempts: 2 }) === "send");
    expect("failed three times: left", verdict(T, at(30), null, { status: "failed", attempts: 3 }) === "done");
    expect("a try on record, now late: left as it is", verdict(T, at(200), null, { status: "failed", attempts: 1 }) === "done");

    const user: ScheduleUser = {
      userId: USER,
      timeZone: "Europe/London",
      settings: DEFAULT_SCHEDULE,
      targets: { email: { channel: "email", email: "ozan@example.com" }, telegram: { channel: "telegram", chatId: 42, username: "ozan" } },
    };
    const plan1: CandidatePlan = { id: "p1", userId: USER, startDate: "2026-11-28", zone: "Europe/London", changedAt: new Date("2026-11-20T10:00:00Z") };
    const now1 = new Date("2026-11-27T18:05:00Z");
    const c1 = candidates(now1, [user], [plan1]);
    expect(
      "candidates: evening and morning on two channels, and this week's summary (last week's is past saving)",
      c1.filter((c) => c.kind === "plan_reminder").length === 4 && c1.filter((c) => c.kind === "weekly_summary").length === 2,
      c1.map((c) => c.key)
    );
    const ev = c1.find((c) => c.key === reminderKey("p1", "2026-11-28", "evening", "email"));
    expect("the evening reminder: 18:00 London, the day before", ev?.at.toISOString() === "2026-11-27T18:00:00.000Z", ev?.at);
    const d1 = dueNow(now1, c1, new Map());
    expect(
      "18:05: the evening reminder goes on both channels, the morning one waits",
      d1.send.filter((m) => m.slot === "evening").length === 2 && !d1.send.some((m) => m.slot === "morning"),
      d1.send.map((m) => m.key)
    );
    expect(
      "Friday: this week's Monday summary was missed — skipped late, once per channel; last week's not looked at",
      d1.skip.filter((x) => x.key.includes(":2026-W48:") && x.reason === "late").length === 2 && !d1.skip.some((x) => x.key.includes(":2026-W47:")),
      d1.skip
    );
    const now2 = new Date("2026-11-27T21:30:00Z");
    const d2 = dueNow(now2, candidates(now2, [user], [plan1]), new Map());
    expect("21:30 with nothing on record: the evening reminder skipped late", d2.skip.filter((x) => x.kind === "plan_reminder" && x.reason === "late").length === 2);
    const now3 = new Date("2026-11-27T18:45:00Z");
    const d3 = dueNow(now3, candidates(now3, [user], [{ ...plan1, changedAt: new Date("2026-11-27T18:30:00Z") }]), new Map());
    expect(
      "a plan changed at 18:30: tonight's reminder skipped as changed",
      d3.skip.filter((x) => x.reason === "changed").length === 2 && !d3.send.some((m) => m.kind === "plan_reminder")
    );
    const sentRows: Existing = new Map(c1.filter((c) => c.slot === "evening").map((c) => [c.key, { status: "sent", attempts: 1 }]));
    expect("already sent: not again", !dueNow(now1, c1, sentRows).send.some((m) => m.slot === "evening"));
    expect(
      "a channel that isn't connected gets nothing",
      candidates(now1, [{ ...user, targets: { email: user.targets.email } }], [plan1]).every((c) => c.channel === "email")
    );
    const c4 = candidates(now1, [{ ...user, settings: { ...DEFAULT_SCHEDULE, eveningTime: null, weeklyTime: null } }], [plan1]);
    expect("the evening and the weekly summary off: only the morning reminders", c4.length === 2 && c4.every((c) => c.slot === "morning"), c4.map((c) => c.key));
    const tk = candidates(now1, [user], [{ ...plan1, id: "p2", zone: "Asia/Tokyo" }]).find((c) => c.slot === "evening" && c.channel === "email");
    expect("a Tokyo plan's evening reminder: 18:00 Tokyo, 09:00 UTC (decision 18)", tk?.at.toISOString() === "2026-11-27T09:00:00.000Z", tk?.at);
    const monday = new Date("2026-11-30T08:05:00Z");
    const wk = dueNow(monday, candidates(monday, [user], []), new Map());
    expect(
      "Monday 08:05 London: the weekly summary of 30.11–6.12 goes",
      wk.send.length === 2 && wk.send[0].kind === "weekly_summary" && wk.send[0].week?.start === "2026-11-30" && wk.send[0].week?.end === "2026-12-06" && wk.send[0].key === weeklyKey(USER, "2026-W49", "email"),
      wk.send
    );
    const thursday = new Date("2026-12-03T08:05:00Z");
    const th = dueNow(thursday, candidates(thursday, [{ ...user, settings: { ...DEFAULT_SCHEDULE, weeklyDay: 4 } }], []), new Map());
    expect(
      "Thursday's summary covers Thursday to Wednesday, once in that ISO week",
      th.send.length === 2 && th.send[0].week?.start === "2026-12-03" && th.send[0].week?.end === "2026-12-09" && th.send[0].key === weeklyKey(USER, "2026-W49", "email"),
      th.send
    );
    const afterMidnight = new Date("2026-11-30T00:10:00Z");
    const sun = dueNow(afterMidnight, candidates(afterMidnight, [{ ...user, settings: { ...DEFAULT_SCHEDULE, weeklyDay: 7, weeklyTime: "23:45" } }], []), new Map());
    expect(
      "Sunday 23:45 missed: still sent at 00:10 on Monday, for the week ahead",
      sun.send.length === 2 && sun.send[0].key === weeklyKey(USER, "2026-W48", "email") && sun.send[0].week?.start === "2026-11-29" && sun.send[0].week?.end === "2026-12-05",
      sun.send
    );
  }

  say("## reminders and the weekly summary, in Turkish");
  {
    const trip = plan({
      name: "Kapadokya",
      start_date: "2026-12-05",
      end_date: "2026-12-07",
      days: [day(1, "2026-12-05", [stop({ title: "Balon", start_time: "05:30:00" })], "Erken kalk"), day(2, "2026-12-06", [stop({ title: "Vadi" })]), day(3, "2026-12-07", [])],
    });
    const ev = reminderMessage(trip, "evening", APP);
    expect("evening: 'Yarın:' and how many days", ev.subject === "Yarın: Kapadokya (3 gün)", ev.subject);
    expect("evening: the first day only, with its date", ev.text.startsWith("Yarın: Kapadokya\n5 Aralık Cumartesi · 3 günlük planın ilk günü") && ev.text.includes("05:30 — Balon") && ev.text.includes("Erken kalk") && !ev.text.includes("Vadi"), ev.text.slice(0, 160));
    const mo = reminderMessage(plan({ name: "Kadıköy", days: [day(1, "2026-11-28", [stop({ title: "Çiya", day_part: "evening" })])] }), "morning", APP);
    expect("morning: 'Bugün:', no count for one day", mo.subject === "Bugün: Kadıköy" && mo.telegram.startsWith("<b>Bugün: Kadıköy</b>"), mo.subject);
    expect("reminders in Telegram: only b, i, a", foreignTags(ev.telegram).length === 0 && foreignTags(mo.telegram).length === 0);
    const wm = weeklyMessage(
      [
        { id: "a", name: "Kadıköy <akşam>", startDate: "2026-12-01", endDate: "2026-12-01", dayCount: 1, stopCount: 3 },
        { id: "b", name: "Kapadokya", startDate: "2026-12-05", endDate: "2026-12-07", dayCount: 3, stopCount: 5 },
      ],
      { start: "2026-11-30", end: "2026-12-06" },
      APP
    );
    expect("weekly: the count and the week in the subject", wm.subject === "Bu hafta: 2 plan · 30 Kasım Pazartesi – 6 Aralık Pazar", wm.subject);
    expect("weekly: each plan's dates, days and stops", wm.text.includes("• Kadıköy <akşam> — 1 Aralık Salı · 3 durak") && wm.text.includes("5 Aralık Cumartesi – 7 Aralık Pazartesi · 3 gün · 5 durak"), wm.text);
    expect("weekly: names escaped, Telegram's tags only", wm.html.includes("Kadıköy &lt;akşam&gt;") && wm.telegram.includes("Kadıköy &lt;akşam&gt;") && foreignTags(wm.telegram).length === 0);
    const ahead = weeklyMessage([{ id: "c", name: "Brighton", startDate: "2026-12-05", endDate: "2026-12-05", dayCount: 1, stopCount: 4 }], { start: "2026-12-03", end: "2026-12-09" }, APP);
    expect(
      "weekly on a Thursday: 'Önümüzdeki 7 gün', not 'Bu hafta'",
      ahead.subject === "Önümüzdeki 7 gün: 1 plan · 3 Aralık Perşembe – 9 Aralık Çarşamba" && ahead.telegram.startsWith("<b>Önümüzdeki 7 gün: 1 plan</b>"),
      ahead.subject
    );
  }

  say("## a scheduler run (stand-in store and outbox)");
  {
    const user: ScheduleUser = {
      userId: USER,
      timeZone: "Europe/London",
      settings: DEFAULT_SCHEDULE,
      targets: { email: { channel: "email", email: "ozan@example.com" }, telegram: { channel: "telegram", chatId: 42, username: "ozan" } },
    };
    const kadikoy = plan({ id: "p1", name: "Kadıköy", start_date: "2026-11-28", end_date: "2026-11-28", days: [day(1, "2026-11-28", [stop({ title: "Çiya", start_time: "19:00:00" })])] });
    const made = new Date("2026-11-20T00:00:00Z");
    const skips: { reason: string; kind: string }[] = [];
    const delivered: Delivery[] = [];
    const gone: number[] = [];
    let weekPlans: { id: string; name: string; startDate: string; endDate: string; dayCount: number; stopCount: number }[] = [];
    const store: SchedulerStore = {
      users: async () => [user],
      plans: async () => [
        { id: "p1", userId: USER, startDate: "2026-11-28", zone: "Europe/London", changedAt: made },
        { id: "deleted", userId: USER, startDate: "2026-11-28", zone: null, changedAt: made },
      ],
      existing: async () => new Map(),
      plan: async (_u, id) => (id === "p1" ? kadikoy : null),
      weekPlans: async () => weekPlans,
      skip: async (x) => void skips.push({ reason: x.reason, kind: x.kind }),
      telegramGone: async (chatId) => void gone.push(chatId),
    };
    const outbox = async (d: Delivery) => {
      delivered.push(d);
      return d.target.channel === "telegram"
        ? ({ status: "failed", error: "Telegram: Forbidden", chatGone: true } as const)
        : ({ status: "sent" } as const);
    };
    const friday = await runScheduler(store, outbox, new Date("2026-11-27T18:05:00Z"), APP);
    expect(
      "18:05: the evening reminder rendered and handed to the outbox, with its time",
      delivered.length === 2 && delivered.every((d) => d.kind === "plan_reminder" && d.message.subject === "Yarın: Kadıköy" && d.dueAt?.toISOString() === "2026-11-27T18:00:00.000Z"),
      delivered.map((d) => [d.kind, d.dedupeKey])
    );
    expect("a plan gone meanwhile: nothing for it", !delivered.some((d) => d.planId === "deleted"));
    expect("the bot blocked: the chat switched off", gone.length === 1 && gone[0] === 42, gone);
    expect("the run's summary (late: this week's Monday summary)", friday.sent === 1 && friday.failed === 1 && friday.skipped.late === 2, friday);

    delivered.length = 0;
    skips.length = 0;
    const emptyMonday = await runScheduler({ ...store, plans: async () => [] }, outbox, new Date("2026-11-30T08:05:00Z"), APP);
    expect("Monday, no plan that week: nothing sent, skipped as empty (decision 16)", delivered.length === 0 && skips.filter((x) => x.reason === "empty").length === 2 && emptyMonday.skipped.empty === 2, { skips, emptyMonday });
    weekPlans = [{ id: "p9", name: "Brighton", startDate: "2026-12-05", endDate: "2026-12-05", dayCount: 1, stopCount: 4 }];
    delivered.length = 0;
    await runScheduler({ ...store, plans: async () => [] }, outbox, new Date("2026-11-30T08:05:00Z"), APP);
    expect("Monday with a plan: the weekly summary goes", delivered.length === 2 && delivered.every((d) => d.kind === "weekly_summary" && d.message.subject.startsWith("Bu hafta: 1 plan")), delivered.map((d) => d.message.subject));
  }

  say("## the settings: stored, read, checked");
  {
    expect("no row: the defaults", scheduleFromRow(null) === DEFAULT_SCHEDULE);
    const fromDb = scheduleFromRow({ reminder_channels: ["telegram", "sms"], reminder_evening_time: "18:30:00", reminder_morning_time: null, weekly_channels: [], weekly_day: 5, weekly_time: "09:15:00" });
    expect(
      "a row: Postgres times as HH:MM, unknown channels dropped",
      fromDb.eveningTime === "18:30" && fromDb.morningTime === null && fromDb.weeklyTime === "09:15" && JSON.stringify(fromDb.reminderChannels) === '["telegram"]' && fromDb.weeklyDay === 5,
      fromDb
    );
    expect("the screen's settings pass", scheduleInput.safeParse(DEFAULT_SCHEDULE).success);
    expect("a time that isn't one: refused", !scheduleInput.safeParse({ ...DEFAULT_SCHEDULE, eveningTime: "25:00" }).success);
    expect("a channel that isn't one: refused", !scheduleInput.safeParse({ ...DEFAULT_SCHEDULE, weeklyChannels: ["sms"] }).success);
    expect("an extra field: refused", !scheduleInput.safeParse({ ...DEFAULT_SCHEDULE, extra: 1 }).success);
    const db = new FakeDb();
    const admin = db as any;
    expect("read for someone without a row: the defaults", JSON.stringify(await readSchedule(admin, USER)) === JSON.stringify(DEFAULT_SCHEDULE));
    const saved = await saveSchedule(admin, USER, { ...DEFAULT_SCHEDULE, morningTime: null, weeklyDay: 7 });
    expect("saved, and read back as saved", saved.morningTime === null && saved.weeklyDay === 7 && JSON.stringify(await readSchedule(admin, USER)) === JSON.stringify(saved), saved);
    const view = await settingsView(admin, USER);
    expect("Settings shows the schedule and the zone", view.schedule.weeklyDay === 7 && view.timeZone === null, { schedule: view.schedule, timeZone: view.timeZone });
  }

  say("## the crons' bearer (constant time; all three crons)");
  {
    const SECRET = "s3cret-value-for-the-check";
    const call = (auth?: string) => new Request("https://example.invalid/api/cron/notify", { headers: auth === undefined ? {} : { authorization: auth } });
    expect("the right bearer: let in", bearerMatches(call(`Bearer ${SECRET}`), SECRET));
    expect("a wrong one of the same length: refused", !bearerMatches(call(`Bearer ${SECRET.replace("s", "x")}`), SECRET));
    expect("shorter or longer: refused", !bearerMatches(call(`Bearer ${SECRET.slice(1)}`), SECRET) && !bearerMatches(call(`Bearer ${SECRET}x`), SECRET));
    expect("no header: refused", !bearerMatches(call(), SECRET));
    expect("the secret without 'Bearer ': refused", !bearerMatches(call(SECRET), SECRET));
    expect("no secret on the server: nothing matches", !bearerMatches(call("Bearer "), "") && !bearerMatches(call("Bearer undefined"), undefined));
  }

  setSenders(null);
  say();
  say(failures === 0 ? "All notification checks passed." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  say(`crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
