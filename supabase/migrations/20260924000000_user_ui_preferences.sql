-- 20260924000000_user_ui_preferences.sql
-- USER-PREFERENCES-1 (CONTACTS-BOOK-1, 2026-09-20): per-user interface preferences.
--
-- WHY. ASPIRE Connect > Contacts gains an optional Address book layout. Each person
-- chooses it in Settings > Appearance (or with the link beside Refresh), and the choice
-- must follow them to every device they sign in on. No per-user preference storage
-- existed: theme, the masthead city and the last-selected contact all live in the
-- browser. This adds the smallest store that does the job, using the pattern
-- user_profiles already has for self-service fields (avatar_url, onboarding_tour_*).
--
-- WHAT.
--   1. user_profiles.ui_preferences jsonb NOT NULL DEFAULT '{}'. On Postgres 11+ a
--      constant default is metadata-only: no table rewrite, and every existing row
--      reads '{}'. Keys are namespaced (the first is 'appearance.contactsLayout',
--      'classic' | 'book'); the app registers every key and value it may write in
--      src/lib/userPreferences.js and reads anything else as the default.
--   2. CHECK user_profiles_ui_preferences_shape: a JSON object, at most 4 KB.
--   3. GRANT UPDATE (ui_preferences) ON user_profiles TO authenticated.
--      The existing Wave E policy user_profiles_update_self already restricts a client
--      UPDATE to the caller's OWN row, and authenticated holds no table-level UPDATE,
--      so this column joins the six already granted and nothing else becomes
--      writable: role, is_owner, is_active, can_conduct_interviews and login_enabled
--      stay ungranted.
--
-- NOT CHANGED. No new table, no new policy, no function, no data rewrite, no anon grant.
--
-- EITHER DEPLOY ORDER. Before this runs, the app's read answers 42703 (undefined column)
-- and the choice is kept in that browser only; Settings says "Saved in this browser for
-- now." After it runs, the first load writes that browser's choice into the account for
-- any key the account does not hold yet, and from then on the account wins.
--
-- CHECKS: db/audit/user_ui_preferences_checks.sql (PRE 1-2, POST 1-5).
-- ROLLBACK: at the end of this file.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ui_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass
      AND conname = 'user_profiles_ui_preferences_shape'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_ui_preferences_shape
      CHECK (jsonb_typeof(ui_preferences) = 'object' AND octet_length(ui_preferences::text) <= 4096);
  END IF;
END $$;

GRANT UPDATE (ui_preferences) ON public.user_profiles TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (only if the Address book is withdrawn; the app then falls back to the
-- browser, so nothing breaks):
--   BEGIN;
--   REVOKE UPDATE (ui_preferences) ON public.user_profiles FROM authenticated;
--   ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_ui_preferences_shape;
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS ui_preferences;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
