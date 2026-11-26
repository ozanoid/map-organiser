import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * `Authorization: Bearer <secret>` checked in constant time — how Vercel's
 * cron calls a route (CRON_SECRET). An unset secret matches nothing.
 */
export function bearerMatches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
