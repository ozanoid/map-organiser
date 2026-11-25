"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { confirmEmailAction } from "./actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-11 w-full cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700"
    >
      {pending ? "Confirming…" : "Confirm address"}
    </Button>
  );
}

export function ConfirmForm({ token }: { token: string }) {
  return (
    <form action={confirmEmailAction}>
      <input type="hidden" name="token" value={token} />
      <ConfirmButton />
    </form>
  );
}
