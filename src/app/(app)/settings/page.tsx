"use client";

import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile, categories, and tags
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Settings className="h-12 w-12 text-gray-300 mb-4" />
        <p className="text-gray-500 text-sm">
          Settings will be available once the database is connected.
        </p>
      </div>
    </div>
  );
}
