import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, MailCheck, MapPin, ShieldAlert } from "lucide-react";
import { emailLinkState } from "@/lib/notify/channels";
import { createServiceClient } from "@/lib/supabase/server";
import { ConfirmForm } from "./confirm-form";

/**
 * The page the confirmation e-mail links to (Phase 3, slice 1). Opening it
 * changes nothing — mail scanners follow links, and an address must be
 * confirmed by someone who read the message — so it shows the address and a
 * Confirm button (confirmEmailAction). Public in the proxy: the token is the
 * proof, not a session.
 */

export const metadata: Metadata = {
  title: "Confirm your e-mail · Map Organiser",
  robots: { index: false, follow: false },
};

const SETTINGS = "/settings?tab=notifications";

function Brand() {
  return (
    <div className="flex items-center justify-center gap-2">
      <MapPin className="h-8 w-8 text-emerald-600" aria-hidden />
      <span className="text-2xl font-semibold tracking-tight">Map Organiser</span>
    </div>
  );
}

function Card({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof MailCheck;
  tone: "ok" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="space-y-6" aria-labelledby="confirm-title">
      <Brand />
      <section className="space-y-4 rounded-xl border bg-background p-5">
        <div className="flex gap-3">
          <Icon
            className={`mt-0.5 h-5 w-5 shrink-0 ${tone === "ok" ? "text-emerald-600" : "text-amber-600"}`}
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <h1 id="confirm-title" className="text-base font-semibold">
              {title}
            </h1>
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

function SettingsLink({ label }: { label: string }) {
  return (
    <Link
      href={SETTINGS}
      className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
    >
      {label}
    </Link>
  );
}

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const link = await emailLinkState(createServiceClient(), token);

  if (link.state === "confirmed") {
    return (
      <Card icon={CircleCheck} tone="ok" title="Address confirmed">
        <p className="text-sm text-muted-foreground">
          <span className="break-all font-medium text-foreground">{link.email}</span> gets your plans.
        </p>
        <SettingsLink label="Open notification settings" />
      </Card>
    );
  }

  if (link.state === "invalid") {
    return (
      <Card icon={ShieldAlert} tone="warn" title="This link doesn't work any more">
        <p className="text-sm text-muted-foreground">
          It has expired, a newer link replaced it, or the address was changed. Save the address again in Settings →
          Notifications for a new link.
        </p>
        <SettingsLink label="Open notification settings" />
      </Card>
    );
  }

  return (
    <Card icon={MailCheck} tone="ok" title="Confirm your e-mail address">
      <p className="text-sm text-muted-foreground">
        Map Organiser will send your plans to{" "}
        <span className="break-all font-medium text-foreground">{link.email}</span>.
      </p>
      <div className="pt-3">
        <ConfirmForm token={token} />
      </div>
      <p className="pt-2 text-xs text-muted-foreground">
        Didn&apos;t ask for this? Close this page — nothing is sent to the address until it is confirmed.
      </p>
    </Card>
  );
}
