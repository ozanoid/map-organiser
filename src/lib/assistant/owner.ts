import "server-only";

/**
 * Accounts allowed to connect an assistant (claude.ai, Claude Code) to their
 * library: comma-separated emails in ASSISTANT_OWNER_EMAILS. Unset means
 * nobody — the connector fails closed until the owner is configured.
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
