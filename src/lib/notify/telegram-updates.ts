/**
 * What the bot does with an update Telegram posts to the webhook. Phase 3
 * keeps the bot to notifications (decision 2): it links a chat with
 * `/start <token>`, notices being blocked or unblocked, and answers anything
 * else with a line saying what it is for. Groups are ignored.
 *
 * Pure apart from its three effects, so the offline checks can run it.
 */
export interface UpdateEffects {
  link(token: string, chat: { id: number; username: string | null }): Promise<"linked" | "invalid" | "taken">;
  setBlocked(chatId: number, blocked: boolean): Promise<void>;
  reply(chatId: number, text: string): Promise<void>;
}

interface TgChat {
  id: number;
  type: string;
  username?: string;
}

interface TgUpdate {
  update_id?: number;
  message?: { chat?: TgChat; text?: string; from?: { username?: string } };
  my_chat_member?: { chat?: TgChat; new_chat_member?: { status?: string } };
}

export const REPLIES = {
  linked:
    "Bağlandı ✓ Map Organiser bildirimleri (plan özetleri, hatırlatmalar) artık buraya gelecek. Bağlantıyı uygulamada Settings → Notifications'tan kaldırabilirsin.",
  invalid:
    "Bu bağlantı linki geçersiz ya da süresi dolmuş. Uygulamada Settings → Notifications → Connect Telegram'a basıp yeni bir link aç.",
  taken: "Bu Telegram hesabı başka bir Map Organiser hesabına bağlı.",
  hello:
    "Merhaba! Bu bot Map Organiser bildirimlerini gönderir. Bağlamak için uygulamada Settings → Notifications → Connect Telegram'a bas.",
  notifyOnly:
    "Bu bot şimdilik yalnız bildirim gönderiyor. Bir şey sormak için uygulamadaki asistanı kullanabilirsin.",
} as const;

/** The `/start` payload, if this is one ("/start abc", "/start@Bot abc"). */
export function startPayload(text: string | undefined): string | null | undefined {
  if (!text) return undefined;
  const m = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text.trim());
  if (!m) return undefined;
  return m[1] ?? null;
}

export async function handleUpdate(update: unknown, fx: UpdateEffects): Promise<void> {
  if (!update || typeof update !== "object") return;
  const u = update as TgUpdate;

  // Blocked or unblocked, in a private chat.
  const member = u.my_chat_member;
  if (member?.chat?.type === "private" && typeof member.chat.id === "number") {
    const status = member.new_chat_member?.status;
    if (status === "kicked") await fx.setBlocked(member.chat.id, true);
    else if (status === "member") await fx.setBlocked(member.chat.id, false);
    return;
  }

  const msg = u.message;
  if (!msg?.chat || msg.chat.type !== "private" || typeof msg.chat.id !== "number") return;
  const chatId = msg.chat.id;
  const payload = startPayload(msg.text);
  if (payload === undefined) {
    await fx.reply(chatId, REPLIES.notifyOnly);
    return;
  }
  if (payload === null) {
    await fx.reply(chatId, REPLIES.hello);
    return;
  }
  const result = await fx.link(payload, { id: chatId, username: msg.chat.username ?? msg.from?.username ?? null });
  await fx.reply(chatId, REPLIES[result]);
}
