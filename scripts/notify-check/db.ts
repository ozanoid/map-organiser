/**
 * Phase 3's notification queries against the live database — without
 * writing anything. Every call names a user, token, chat or record that
 * doesn't exist: reads come back empty, updates and deletes touch no row,
 * an insert is refused by the foreign key. What it proves is that each query
 * src/lib/notify sends is one the database accepts (table and column names,
 * the claim function and its grant, value types) — the offline checks'
 * stand-in accepts any column.
 *
 * Needs the migration 20261125203540_notifications.sql applied.
 *
 *   npm run check:notify:db
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  confirmEmail,
  emailLinkState,
  linkTelegram,
  readChannels,
  removeEmail,
  setTelegramBlocked,
  settingsView,
  unlinkTelegram,
} from "@/lib/notify/channels";
import { DEFAULT_SCHEDULE } from "@/lib/notify/schedule";
import { readSchedule, readTimeZone } from "@/lib/notify/schedule-store";
import { supabaseSchedulerStore } from "@/lib/notify/scheduler-store";
import { consumeLinkToken, newToken, readLinkToken } from "@/lib/notify/tokens";

const say = (line = "") => process.stderr.write(`${line}\n`);
let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  say(`   ${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    return `ok:${JSON.stringify((await p) ?? null)}`;
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code ? `pg:${code}` : `error:${(e as Error).message}`;
  }
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ghost = randomUUID();
  const token = newToken();
  // A chat id no Telegram user has (they are positive for private chats).
  const noChat = -1;

  say("## channels and tokens, for nobody");
  expect("readChannels → {}", (await outcome(readChannels(admin, ghost))) === "ok:{}");
  const view = await outcome(settingsView(admin, ghost));
  expect("settingsView → open, nothing connected", view.includes('"open":true') && view.includes('"address":null') && view.includes('"linked":false'), view);
  expect("readLinkToken → null", (await outcome(readLinkToken(admin, token, "email_verify"))) === "ok:null");
  expect("consumeLinkToken → null (updates nothing)", (await outcome(consumeLinkToken(admin, token, "telegram_link"))) === "ok:null");
  expect("emailLinkState → invalid", (await outcome(emailLinkState(admin, token))) === 'ok:{"state":"invalid"}');
  expect("confirmEmail → invalid", (await outcome(confirmEmail(admin, token))) === 'ok:"invalid"');
  expect("linkTelegram with an unknown token → invalid", (await outcome(linkTelegram(admin, token, { id: noChat, username: null }))) === 'ok:"invalid"');
  expect("setTelegramBlocked → touches nothing", (await outcome(setTelegramBlocked(admin, noChat, true))) === "ok:null");
  expect("removeEmail → touches nothing", (await outcome(removeEmail(admin, ghost))) === "ok:null");
  expect("unlinkTelegram → touches nothing", (await outcome(unlinkTelegram(admin, ghost))) === "ok:null");

  say("## the outbox's queries");
  const claim = await admin.rpc("notification_claim", { p_id: randomUUID(), p_lease_seconds: 60 });
  expect("notification_claim on no record → []", !claim.error && Array.isArray(claim.data) && claim.data.length === 0, claim.error ?? claim.data);
  const lookup = await admin.from("notifications").select("id, status").eq("dedupe_key", `check:${randomUUID()}`).maybeSingle();
  expect("the dedupe lookup → null", !lookup.error && lookup.data === null, lookup.error);
  const record = await admin
    .from("notifications")
    .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: "x", claimed_until: null, last_error: null, content: { to: "x", subject: "x", text: "x" } })
    .eq("id", randomUUID());
  expect("recording a send → touches nothing", !record.error, record.error);
  const insert = await admin
    .from("notifications")
    .insert({ user_id: ghost, kind: "channel_test", channel: "email", plan_id: null, dedupe_key: `check:${randomUUID()}` })
    .select("id")
    .maybeSingle();
  expect("a record for nobody → refused by the foreign key", insert.error?.code === "23503", insert.error ?? insert.data);
  const tokenInsert = await admin.from("channel_link_tokens").insert({
    token_hash: "check",
    user_id: ghost,
    purpose: "telegram_link",
    email: null,
    expires_at: new Date().toISOString(),
  });
  expect("a token for nobody → refused by the foreign key", tokenInsert.error?.code === "23503", tokenInsert.error);

  say("## the scheduler's queries (slice 2)");
  const store = supabaseSchedulerStore(admin);
  const owners = await store.users();
  expect(
    "users: owners with a usable channel, their settings and zone (counted, not shown)",
    owners.every((u) => Object.keys(u.targets).length > 0 && Array.isArray(u.settings.reminderChannels)),
    { owners: owners.length }
  );
  say(`      ${owners.length} owner(s) with a usable channel; ${owners.filter((u) => u.timeZone).length} with a time zone`);
  expect("plans for nobody → []", (await outcome(store.plans([ghost], "2026-01-01", "2027-12-31"))) === "ok:[]");
  expect("existing for an unknown key → none", (await store.existing([`check:${randomUUID()}`])).size === 0);
  expect("a plan that doesn't exist → null", (await outcome(store.plan(ghost, randomUUID()))) === "ok:null");
  expect("week plans for nobody → []", (await outcome(store.weekPlans(ghost, "2026-11-30", "2026-12-06"))) === "ok:[]");
  expect("settings for nobody → the defaults", JSON.stringify(await readSchedule(admin, ghost)) === JSON.stringify(DEFAULT_SCHEDULE));
  expect("the time zone of nobody → null", (await readTimeZone(admin, ghost)) === null);
  const skipped = await outcome(
    store.skip({ kind: "plan_reminder", key: `check:${randomUUID()}`, userId: ghost, channel: "email", at: new Date(), reason: "late" })
  );
  expect("a skipped record for nobody → refused by the foreign key", skipped.includes("foreign key"), skipped);

  say();
  say(failures === 0 ? "All notification database checks passed." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  say(`crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
