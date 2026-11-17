"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { approveConsent, denyConsent } from "./actions";

function Choices({ denyOnly }: { denyOnly: boolean }) {
  const { pending } = useFormStatus();
  if (denyOnly) {
    return (
      <Button type="submit" formAction={denyConsent} variant="outline" disabled={pending} className="h-11 w-full cursor-pointer">
        {pending ? "Cancelling…" : "Cancel request"}
      </Button>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Button type="submit" formAction={denyConsent} variant="outline" disabled={pending} className="h-11 cursor-pointer">
        Deny
      </Button>
      <Button
        type="submit"
        formAction={approveConsent}
        disabled={pending}
        className="h-11 cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700"
      >
        {pending ? "Connecting…" : "Allow"}
      </Button>
    </div>
  );
}

/** One form, two server actions: pending disables both buttons. */
export function ConsentForm({ authorizationId, denyOnly = false }: { authorizationId: string; denyOnly?: boolean }) {
  return (
    <form>
      <input type="hidden" name="authorization_id" value={authorizationId} />
      <Choices denyOnly={denyOnly} />
    </form>
  );
}
