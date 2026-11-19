import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eye, MapPin, PencilLine, ShieldAlert } from "lucide-react";
import { isAllowedOAuthRedirect } from "@/lib/assistant/oauth";
import { isAssistantOwner } from "@/lib/assistant/owner";
import { createClient } from "@/lib/supabase/server";
import { ConsentForm } from "./consent-form";

/**
 * Consent page for Supabase's OAuth 2.1 server (Authorization Path
 * /oauth/consent). An MCP client such as Claude sends the user here with an
 * authorization_id; approving issues the client a token for this user's
 * library. Public in the proxy: the page sends signed-out visitors to
 * /login with a `next` that brings them back.
 */

export const metadata: Metadata = { title: "Connect an app · Map Organiser" };

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function Brand() {
  return (
    <div className="flex items-center justify-center gap-2">
      <MapPin className="h-8 w-8 text-emerald-600" aria-hidden />
      <span className="text-2xl font-semibold tracking-tight">Map Organiser</span>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="space-y-6" aria-labelledby="consent-title">
      <Brand />
      <section className="space-y-4 rounded-xl border bg-background p-5">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-1">
            <h1 id="consent-title" className="text-base font-semibold">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; failed?: string }>;
}) {
  const { authorization_id: id, failed } = await searchParams;
  if (!id) {
    return <Notice title="Nothing to approve" body="Open this page from the app you're connecting, such as Claude." />;
  }

  const back = `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);

  if (!isAssistantOwner(user.email)) {
    return (
      <Notice
        title="This account can't connect apps"
        body={`${user.email ?? "This account"} isn't set up to connect assistants to Map Organiser.`}
      />
    );
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    return <Notice title="This request has expired" body="Start the connection again from the app you're connecting." />;
  }

  // Approved before: Supabase answers with the client's callback straight away.
  if (!("authorization_id" in data)) {
    if (isAllowedOAuthRedirect(data.redirect_url)) redirect(data.redirect_url);
    return <Notice title="Unknown app" body="Only Claude can connect to Map Organiser." />;
  }

  if (!isAllowedOAuthRedirect(data.redirect_uri)) {
    return (
      <Notice
        title="Unknown app"
        body={`An app that returns to ${hostOf(data.redirect_uri)} asked for access to your places. Only Claude can connect to Map Organiser, so this request can't be approved.`}
      >
        <ConsentForm authorizationId={id} denyOnly />
      </Notice>
    );
  }

  const appName = data.client.name?.trim() || "An app";
  return (
    <main className="space-y-6" aria-labelledby="consent-title">
      <Brand />
      <section className="space-y-5 rounded-xl border bg-background p-5">
        <div className="space-y-1">
          <h1 id="consent-title" className="text-lg font-semibold">
            {appName} wants to connect
          </h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-medium">It will be able to</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>Read your saved places — details, opening hours, reviews, tags and lists</span>
            </li>
            <li className="flex gap-3">
              <PencilLine className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>Update visit status, your ratings, notes and tags when you ask it to</span>
            </li>
          </ul>
        </div>

        {failed && (
          <p role="alert" className="text-sm text-red-600">
            The connection didn&apos;t go through. Try again.
          </p>
        )}

        <div className="space-y-3">
          <ConsentForm authorizationId={id} />
          <p className="text-center text-xs text-muted-foreground">
            You&apos;ll go back to {hostOf(data.redirect_uri)}. You can disconnect it any time in that app&apos;s
            connector settings.
          </p>
        </div>
      </section>
    </main>
  );
}
