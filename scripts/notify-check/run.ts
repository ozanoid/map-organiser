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
import { fromHeader } from "@/lib/notify/email";
import { NotifyError, TelegramChatGone } from "@/lib/notify/errors";
import { deliver, setSenders, type Delivery } from "@/lib/notify/outbox";
import {
  channelTestMessage,
  clip,
  emailVerifyMessage,
  escapeHtml,
  planSummaryMessage,
  trDay,
  trRange,
} from "@/lib/notify/render";
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
  process.env.TELEGRAM_BOT_TOKEN = "offline:check";
  process.env.TELEGRAM_BOT_USERNAME = "@MapOrganiserTestBot";

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

  say("## pointing the bot at the webhook (registerWebhook)");
  {
    // A stand-in for Telegram: records each call's method and body, answers
    // as told. Nothing leaves the machine.
    const realFetch = globalThis.fetch;
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    let botUsername = "MapOrganiserTestBot";
    let refuse: string | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = String(input).split("/").pop() ?? "";
      calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
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
      refuse = "setWebhook";
      const refused = await outcome("https://app.test");
      expect("Telegram refuses: its words come back, not the token", refused === "NotifyError: Telegram: Unauthorized" && !refused.includes("offline:check"), refused);
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
    process.env.TELEGRAM_BOT_TOKEN = "offline:check";
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

  setSenders(null);
  say();
  say(failures === 0 ? "All notification checks passed." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  say(`crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
