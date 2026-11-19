---
title: Signup Flow
type: flow
domain: auth
version: 1.1.1
last_updated: 19.11.2026
status: stable
sources:
  - src/app/auth/callback/route.ts
  - public DB triggers (Supabase)
related:
  - "[[auth-flow]]"
  - "[[../01-domain/users-and-profiles]]"
  - "[[../02-backend/schema/profiles]]"
  - "[[../02-backend/schema/categories]]"
---

# Signup Flow

What happens when a new account is created: the cascade of DB triggers that fires as `auth.users` gets the account's row.

## Trigger

**Since 17.11.2026 public sign-up is closed** (single-owner app; [[../02-backend/auth#Sign-ups closed]]). The `/signup` page is gone and Supabase Auth's "Allow new users to sign up" setting, which must stay off, is the gate. A row now reaches `auth.users` only when the owner adds an account in the Supabase dashboard (Authentication → Users).

Before that date, a user not previously in `auth.users` reached this flow by completing either:

- Google OAuth handshake (most common), OR
- Email signup with confirmation (if enabled).

## Steps

```
1. Supabase Auth INSERT into auth.users
       │
       ▼  trigger: on_auth_user_created  (AFTER INSERT)
2. handle_new_user() runs (SECURITY DEFINER)
       INSERT INTO public.profiles {
         id:            new.id,
         full_name:     raw_user_meta_data.full_name || raw_user_meta_data.name || '',
         avatar_url:    raw_user_meta_data.avatar_url || ''
       }
       │
       ▼  trigger: on_profile_created_default_categories  (AFTER INSERT on profiles)
3. create_default_categories() runs (SECURITY DEFINER)
       INSERT 12 rows into public.categories — Restaurant, Cafe, Bar &
       Nightlife, Hotel & Accommodation, Shopping, Museum & Culture, Park
       & Nature, Beach, Gym & Sports, Health & Medical, Entertainment, Other
       │
       ▼  trigger from migration create_subcategories_signup_trigger
3b. seed_default_subcategories_for_user() seeds the default sub-categories
       (~62 rows; see [[../02-backend/schema/subcategories]])
       │
       ▼
4. Session is set; user is redirected to /map by proxy
   (a dashboard-created account gets its session at its first sign-in)
```

The whole cascade runs inside Supabase Auth's INSERT — at creation time for a dashboard-created account; inside the OAuth callback for the old self sign-up. The app's code doesn't run any signup-specific logic.

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 1 | Provider OAuth claims (or email+password) | `auth.users` row with email + `raw_user_meta_data` |
| 2 | NEW (auth.users row) | `profiles` row with id = auth user id, full_name, avatar_url |
| 3 | NEW (profiles row) | 12 `categories` rows, each `is_default: true` |
| 4 | session cookies | redirect to `/map` |

## The 12 default categories

Exact values from `create_default_categories()`:

| `sort_order` | `name` | `color` | `icon` (lucide) |
|---|---|---|---|
| 0 | Restaurant | `#EF4444` | `utensils` |
| 1 | Cafe | `#F97316` | `coffee` |
| 2 | Bar & Nightlife | `#8B5CF6` | `wine` |
| 3 | Hotel & Accommodation | `#3B82F6` | `bed-double` |
| 4 | Shopping | `#EC4899` | `shopping-bag` |
| 5 | Museum & Culture | `#6366F1` | `landmark` |
| 6 | Park & Nature | `#22C55E` | `trees` |
| 7 | Beach | `#06B6D4` | `umbrella` |
| 8 | Gym & Sports | `#F59E0B` | `dumbbell` |
| 9 | Health & Medical | `#14B8A6` | `heart-pulse` |
| 10 | Entertainment | `#A855F7` | `ticket` |
| 11 | Other | `#6B7280` | `map-pin` |

The user can rename/recolor/delete any of these — no protection on `is_default`.

## Failure modes

- **Trigger function fails:** Supabase Auth will roll back the `auth.users` INSERT. User stays signed out and sees an error.
- **Categories partial insert:** unlikely because it's a single `INSERT ... VALUES (...), (...), ...`. If it fails, the trigger raises and the profile insert rolls back too.
- **`SECURITY DEFINER` privilege issues:** addressed by `SET search_path TO 'public'` in the function body. Don't change this.

## Notes

- Both triggers run AFTER INSERT and are SECURITY DEFINER — they execute with the function owner's privileges, so they can write across schemas (auth → public). This is the "right" way to wire up Supabase signup hooks.
- The signup cascade is **idempotent**: a user can't re-trigger it. The next time they sign in, `auth.users.id` already exists and no INSERT fires.

## Related code

- `src/app/auth/callback/route.ts` — the entry point, but doesn't directly create the profile or categories.

## DB function definitions

See [[../02-backend/schema/profiles#triggers--functions]] and [[../02-backend/schema/categories#triggers--functions]] for the exact SQL.

## Open questions

- **Account deletion.** No corresponding `handle_deleted_user` exists. If we ever delete `auth.users` rows, the cascade will clean up via FK CASCADE — but it's worth a runbook.
- **Reset-to-defaults categories.** If a user deletes a default, there's no path back. Worth a `POST /api/categories/reset-defaults` button in Settings.
