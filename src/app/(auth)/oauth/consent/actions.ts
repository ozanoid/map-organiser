"use server";

import { redirect } from "next/navigation";
import { isAllowedOAuthRedirect } from "@/lib/assistant/oauth";
import { isAssistantOwner } from "@/lib/assistant/owner";
import { createClient } from "@/lib/supabase/server";

/**
 * Consent decisions for Supabase's OAuth 2.1 server. Everything the page
 * checked is checked again here — the form posts only an id.
 */

async function signedInOwner(formData: FormData) {
  const id = String(formData.get("authorization_id") ?? "");
  if (!id) redirect("/map");
  const back = `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);
  if (!isAssistantOwner(user.email)) redirect(back);
  return { supabase, id, back };
}

export async function approveConsent(formData: FormData) {
  const { supabase, id, back } = await signedInOwner(formData);
  const { data: details } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (!details || !("authorization_id" in details) || !isAllowedOAuthRedirect(details.redirect_uri)) redirect(back);

  const { data, error } = await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url || !isAllowedOAuthRedirect(data.redirect_url)) redirect(`${back}&failed=1`);
  redirect(data.redirect_url);
}

export async function denyConsent(formData: FormData) {
  const { supabase, id } = await signedInOwner(formData);
  const { data, error } = await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  // An unknown app's callback is never followed, even with an error code.
  if (error || !data?.redirect_url || !isAllowedOAuthRedirect(data.redirect_url)) redirect("/map");
  redirect(data.redirect_url);
}
