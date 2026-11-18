import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Errors the shared data modules raise, by who has to act:
 *
 *   InputError     the caller's request can't be applied — the message says
 *                  why (400 in a route, a correctable error for a tool)
 *   NotFoundError  the thing doesn't exist, or isn't the caller's (404)
 *
 * Anything else is a server error. Each module subclasses these with its
 * own names (PlanInputError, VisitNotFoundError…).
 */
export class InputError extends Error {}
export class NotFoundError extends Error {}

/** Postgres error codes that mean "this value isn't acceptable": a CHECK,
 *  a bad date / time / number / uuid, a missing reference, a missing value. */
const INVALID_VALUE_CODES = new Set(["23514", "22007", "22008", "22P02", "23503", "23502"]);

/**
 * What a Postgres error from one of our write functions means.
 *
 *   P0002  raised by the function: the row isn't there or isn't the caller's
 *   22023  raised by the function: the input breaks a rule; message is for
 *          the caller
 *   others a value the tables refuse
 */
export function classifyPostgrestError(
  error: PostgrestError
): { kind: "not_found" } | { kind: "input"; message: string } | { kind: "other" } {
  if (error.code === "P0002") return { kind: "not_found" };
  if (error.code === "22023") return { kind: "input", message: error.message };
  if (INVALID_VALUE_CODES.has(error.code ?? "")) {
    return { kind: "input", message: `That change isn't valid: ${error.message}` };
  }
  return { kind: "other" };
}
