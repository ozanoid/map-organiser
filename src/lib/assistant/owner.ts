import "server-only";

/**
 * Accounts allowed to use an assistant on their library — to connect
 * claude.ai or Claude Code, and (since v1.56.0) the in-app assistant
 * (`assistantOpenTo`, agent/door.ts): comma-separated emails in
 * ASSISTANT_OWNER_EMAILS. Unset means nobody — both fail closed until the
 * owner is configured.
 */
export function isAssistantOwner(email: string | null | undefined): boolean {
  const wanted = (email ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return (process.env.ASSISTANT_OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(wanted);
}
