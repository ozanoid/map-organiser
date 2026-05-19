import { Suspense } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { OfflineBanner } from "@/components/layout/offline-banner";

/**
 * Both AppSidebar and MobileNav use `useSearchParams()` to preserve the
 * current URL query string when navigating between routes that share
 * filter context (Map ↔ Places). In Next.js 16 App Router, any client
 * component that reads useSearchParams must be wrapped in a Suspense
 * boundary, otherwise prerender of any (app) page (e.g. /import, which
 * has no dynamic data of its own) fails with a prerender-error.
 *
 * The fallbacks below are sized placeholders so layout dimensions stay
 * stable during the prerender → hydrate transition.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Suspense
        fallback={
          <aside className="hidden lg:flex w-56 border-r bg-white dark:bg-gray-950" />
        }
      >
        <AppSidebar />
      </Suspense>
      <div className="flex flex-1 flex-col min-w-0">
        <AppHeader />
        <OfflineBanner />
        <main className="flex-1 overflow-auto pb-14 lg:pb-0">{children}</main>
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      </div>
    </div>
  );
}
