import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="text-center space-y-4 max-w-xs">
        <WifiOff className="h-12 w-12 text-muted-foreground/40 mx-auto" />
        <h1 className="text-lg font-semibold text-foreground">
          You&apos;re offline
        </h1>
        <p className="text-sm text-muted-foreground">
          Check your internet connection and try again.
        </p>
      </div>
    </div>
  );
}
