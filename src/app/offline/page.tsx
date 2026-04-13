import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="text-center space-y-4 max-w-xs">
        <WifiOff className="h-12 w-12 text-gray-300 mx-auto" />
        <h1 className="text-lg font-semibold text-gray-700">
          You&apos;re offline
        </h1>
        <p className="text-sm text-gray-500">
          Check your internet connection and try again.
        </p>
      </div>
    </div>
  );
}
