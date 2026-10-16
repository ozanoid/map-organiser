/**
 * Nudge the import drain so queued work starts now instead of at the next
 * cron minute.
 *
 * Deliberately not awaited: under Fluid Compute the call outlives the
 * response that fired it, and the minute cron is the safety net if it never
 * lands. Shared by the Takeout import and the Instagram import.
 */
export function kickDrain(origin: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  void fetch(`${origin}/api/cron/drain-imports`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {});
}
