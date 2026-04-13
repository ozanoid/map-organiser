import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <AppHeader />
        <main className="flex-1 overflow-auto pb-14 lg:pb-0">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}
