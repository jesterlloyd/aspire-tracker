-- user_ui_preferences_checks.sql
-- Read-only checks for supabase/migrations/20260924000000_user_ui_preferences.sql
-- (USER-PREFERENCES-1 / CONTACTS-BOOK-1). Run ONE section at a time in the Supabase SQL
-- editor. PRE before applying, POST after. POST 5 is the only section that attempts a
-- write, inside a transaction that always rolls back.

-- ── PRE 1: the column is absent, and the self-update policy it relies on is present ──
-- Expect: column_exists false, self_update_policy true, table_update_granted false.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'ui_preferences'
  ) AS column_exists,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_update_self'
  ) AS self_update_policy,
  has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') AS table_update_granted,
  (SELECT count(*) FROM public.user_profiles) AS profiles;

-- ── PRE 2: any trigger on user_profiles (informational) ─────────────────────────────
-- None is tracked in this repository. A dashboard-created trigger that refuses unknown
-- columns on a self UPDATE would block the preference write; read the definitions.
SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.user_profiles'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- ── POST 1: the column ──────────────────────────────────────────────────────────────
-- Expect one row: ui_preferences | jsonb | NO | '{}'::jsonb
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'ui_preferences';

-- ── POST 2: the shape check ─────────────────────────────────────────────────────────
-- Expect one row naming jsonb_typeof(ui_preferences) = 'object' and the 4096 limit.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.user_profiles'::regclass AND conname = 'user_profiles_ui_preferences_shape';

-- ── POST 3: exactly which columns a client may update ───────────────────────────────
-- Expect seven rows: avatar_url, last_login_at, onboarding_tour_completed,
-- onboarding_tour_completed_at, onboarding_tour_dismissed, onboarding_tour_version,
-- ui_preferences. role, is_owner, is_active, can_conduct_interviews and login_enabled
-- must NOT appear, and table_update_granted must still be false.
SELECT column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'user_profiles'
  AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
ORDER BY column_name;
SELECT has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') AS table_update_granted;

-- ── POST 4: every existing row reads the empty object, or a registered key ───────────
-- Run right after applying, expect empty_rows = profiles. A row that differs belongs to a
-- person who opened the app since: their browser's earlier choice is adopted into the
-- account on first load, which is intended. The second query must list ONLY the key
-- appearance.contactsLayout with the values classic or book.
SELECT
  count(*) FILTER (WHERE ui_preferences = '{}'::jsonb) AS empty_rows,
  count(*) AS profiles
FROM public.user_profiles;
SELECT kv.key, kv.value, count(*) AS people
FROM public.user_profiles, jsonb_each(ui_preferences) AS kv
GROUP BY kv.key, kv.value
ORDER BY kv.key, kv.value;

-- ── POST 5: the check refuses a value that is not an object ─────────────────────────
-- PASS is an ERROR: 23514 ... violates check constraint "user_profiles_ui_preferences_shape".
-- The DETAIL line shows the REJECTED candidate row, not stored data; the ROLLBACK means
-- nothing is written either way.
BEGIN;
UPDATE public.user_profiles
SET ui_preferences = '["not", "an", "object"]'::jsonb
WHERE id = (SELECT id FROM public.user_profiles LIMIT 1);
ROLLBACK;
