import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One-time tokens for the two links that connect a channel: the e-mail
 * confirmation link and the Telegram start link. 32 random bytes, base64url —
 * 43 characters of `A-Z a-z 0-9 _ -`, which fits Telegram's start payload
 * (64 characters of that set). Only the SHA-256 is stored.
 */
export type TokenPurpose = "email_verify" | "telegram_link";

const TTL_MS: Record<TokenPurpose, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  telegram_link: 15 * 60 * 1000,
};

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A token's shape, before any lookup: what a link can carry. */
export function looksLikeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

export async function createLinkToken(
  admin: SupabaseClient,
  userId: string,
  purpose: TokenPurpose,
  email?: string
): Promise<string> {
  const token = newToken();
  const { error } = await admin.from("channel_link_tokens").insert({
    token_hash: hashToken(token),
    user_id: userId,
    purpose,
    email: purpose === "email_verify" ? email : null,
    expires_at: new Date(Date.now() + TTL_MS[purpose]).toISOString(),
  });
  if (error) throw new Error(error.message);
  return token;
}

/** Uses a token once, in one statement: who it was for (and the address it
 *  confirms), or null when it is unknown, used or expired. */
export async function consumeLinkToken(
  admin: SupabaseClient,
  token: string,
  purpose: TokenPurpose
): Promise<{ user_id: string; email: string | null } | null> {
  if (!looksLikeToken(token)) return null;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("channel_link_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashToken(token))
    .eq("purpose", purpose)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id, email")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { user_id: string; email: string | null } | null) ?? null;
}

/** A token's row without using it — what the confirmation page shows
 *  before the user presses Confirm. Null when unknown. */
export async function readLinkToken(
  admin: SupabaseClient,
  token: string,
  purpose: TokenPurpose
): Promise<{ user_id: string; email: string | null; used_at: string | null; expires_at: string } | null> {
  if (!looksLikeToken(token)) return null;
  const { data, error } = await admin
    .from("channel_link_tokens")
    .select("user_id, email, used_at, expires_at")
    .eq("token_hash", hashToken(token))
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { user_id: string; email: string | null; used_at: string | null; expires_at: string } | null) ?? null;
}
