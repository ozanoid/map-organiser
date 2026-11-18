import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who a data call runs for. Every shared data module (src/lib/plans,
 * src/lib/visits, src/lib/assistant) takes this.
 *
 * `supabase` is either the caller's own client (a user token — RLS applies)
 * or the service role (no RLS: scripts, the public share view). That is why
 * every query also filters by `userId` explicitly: for the service role that
 * filter is the access control.
 */
export interface UserContext {
  supabase: SupabaseClient;
  userId: string;
}
