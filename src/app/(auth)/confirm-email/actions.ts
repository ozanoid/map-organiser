"use server";

import { redirect } from "next/navigation";
import { confirmEmail } from "@/lib/notify/channels";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Confirm pressed on /confirm-email. No session needed — the page may be
 * open in a browser that isn't signed in; the one-time token in the form is
 * the proof, and it confirms only the address it was made for. Lands on
 * Settings → Notifications, which says how it went (signed-out visitors
 * pass through the login page first).
 */
export async function confirmEmailAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const result = await confirmEmail(createServiceClient(), token);
  redirect(`/settings?tab=notifications&email=${result === "confirmed" ? "confirmed" : "link-invalid"}`);
}
