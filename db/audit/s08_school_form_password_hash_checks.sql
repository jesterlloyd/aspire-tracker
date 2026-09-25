-- Checks for the two S-08 migrations:
--   A  supabase/migrations/20261002000000_s08_school_form_password_hash.sql
--   B  supabase/migrations/20261003000000_s08_school_form_password_plaintext_drop.sql
--
-- READ ONLY. Nothing here creates, alters, writes or deletes anything. NO PASSWORD VALUE
-- IS EVER SELECTED OR PRINTED: the checks pass a stored value from column to function
-- inside the database and return only true or false, counts, and catalog facts.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE-A 1 to 4, then migration A as ONE block, then POST-A 1 to 5.
--   Then deploy the application (S08-1) and confirm it is live.
--   Then PRE-B 1 to 2, then migration B as ONE block, then POST-B 1 to 4.
-- Keep every PRE result: several POST sections compare against them.

-- ═════════════════════════════════════════════════════════════════════════════
-- BEFORE MIGRATION A
-- ═════════════════════════════════════════════════════════════════════════════

-- ── PRE-A 1: the two live RPC definitions, re-read today ─────────────────────
-- Expect 2 rows. The recorded semantics (2026-08-27): school_form_requires_password
-- returns whether cohorts.school_form_password is non-empty; verify_school_form_password
-- returns TRIM(stored) = TRIM(entered). Read both bodies. STOP if either does something
-- else (a different column, a different comparison, a side effect): migration A
-- replaces them with bodies written to those semantics, and a difference here means the
-- replacement would change behaviour. Send me the bodies and wait.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig AS search_path,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('school_form_requires_password', 'verify_school_form_password')
ORDER BY p.proname;

-- ── PRE-A 2: who may execute them, and nothing depends on them ───────────────
-- Expect 2 rows, anon true, authenticated true, service_role true, dependents 0.
-- STOP if dependents > 0: migration A drops and recreates the functions, and a view or
-- policy built on them would go with them.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       (SELECT count(*) FROM pg_depend d WHERE d.refobjid = p.oid AND d.deptype IN ('n', 'a')) AS dependents
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('school_form_requires_password', 'verify_school_form_password')
ORDER BY p.proname;

-- ── PRE-A 3: pgcrypto, and where it lives ────────────────────────────────────
-- Expect either one row (installed; the schema is usually `extensions` on Supabase) or
-- zero rows (migration A installs it). Either is fine. Keep the result.
SELECT e.extname, n.nspname AS schema, e.extversion
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pgcrypto';

-- ── PRE-A 4: which cohorts have a password, and the secrets table is not there yet ─
-- Expect one row per cohort. The recorded state (2026-08-27) is three with a password:
-- Fall 2026 (accepting), Summer 2026, Winter 2027. secrets_table_present must be
-- false on every row (migration A creates it). Keep the result: POST-A 3 and POST-B 3
-- compare against has_password.
SELECT c.id, c.name, c.accepting_submissions,
       btrim(coalesce(c.school_form_password, '')) <> '' AS has_password,
       to_regclass('public.cohort_form_secrets') IS NOT NULL AS secrets_table_present
FROM public.cohorts c
ORDER BY c.accepting_submissions DESC, c.name;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY MIGRATION A as ONE block. Expected: "Success. No rows returned." and a NOTICE
-- "S-08: 3 cohort password(s) hashed and re-verified through the hash" (3 if PRE-A 4
-- showed three). If it raises, nothing was applied; send me the message.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST-A 1: the three functions are repository definitions with the right shape ─
-- Expect 3 rows: security_definer true, search_path {search_path=public, pg_catalog},
-- anon true and authenticated true for requires and verify, BOTH false for set;
-- service_role true on all three; body_reads_secrets true on all three.
SELECT p.proname,
       p.prosecdef AS security_definer,
       p.proconfig AS search_path,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       (p.prosrc ~ 'cohort_form_secrets') AS body_reads_secrets
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('school_form_requires_password', 'verify_school_form_password', 'set_school_form_password')
ORDER BY p.proname;

-- ── POST-A 2: the secrets table is closed to every browser role ──────────────
-- Expect one row: rls_enabled true, policies 0, anon_select false, authenticated_select
-- false, service_role_select true.
SELECT c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       has_table_privilege('anon',          'public.cohort_form_secrets', 'SELECT') AS anon_select,
       has_table_privilege('authenticated', 'public.cohort_form_secrets', 'SELECT') AS authenticated_select,
       has_table_privilege('service_role',  'public.cohort_form_secrets', 'SELECT') AS service_role_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'cohort_form_secrets';

-- ── POST-A 3: every password still verifies, through the hash, and a wrong one does not ─
-- Expect one row per cohort. For every row PRE-A 4 showed has_password true:
-- hashed true, hash_is_bcrypt true, own_password_verifies true, wrong_password_refused
-- true, with_spaces_verifies true (TRIM preserved). For a row with no password: hashed
-- false, requires_password false, own_password_verifies NULL.
-- STOP if any own_password_verifies is false: a coordinator would be refused.
-- The stored value is passed from column to function inside the database; nothing
-- here returns it.
SELECT c.name,
       EXISTS (SELECT 1 FROM public.cohort_form_secrets s WHERE s.cohort_id = c.id) AS hashed,
       (SELECT s.password_hash LIKE '$2a$10$%' OR s.password_hash LIKE '$2b$10$%'
          FROM public.cohort_form_secrets s WHERE s.cohort_id = c.id) AS hash_is_bcrypt,
       public.school_form_requires_password(c.id) AS requires_password,
       CASE WHEN btrim(coalesce(c.school_form_password, '')) <> ''
            THEN public.verify_school_form_password(c.id, c.school_form_password) END AS own_password_verifies,
       CASE WHEN btrim(coalesce(c.school_form_password, '')) <> ''
            THEN public.verify_school_form_password(c.id, '  ' || btrim(c.school_form_password) || '  ') END AS with_spaces_verifies,
       NOT public.verify_school_form_password(c.id, coalesce(c.school_form_password, '') || '-not-the-password') AS wrong_password_refused,
       NOT public.verify_school_form_password(c.id, '') AS empty_refused
FROM public.cohorts c
ORDER BY c.accepting_submissions DESC, c.name;

-- ── POST-A 4: the plaintext is still there (by design, until step B) ─────────
-- Expect: plaintext_rows equal to the count of has_password true in PRE-A 4, and
-- hashed_rows the same number. Step B removes the plaintext.
SELECT count(*) FILTER (WHERE btrim(coalesce(school_form_password, '')) <> '') AS plaintext_rows,
       (SELECT count(*) FROM public.cohort_form_secrets) AS hashed_rows
FROM public.cohorts;

-- ── POST-A 5: the set function clears plaintext when it is used (no-op check) ─
-- Expect: set_function_present true. This does not call it. The first real use is
-- Manage Cohort after S08-1 is live.
SELECT to_regprocedure('public.set_school_form_password(uuid, text)') IS NOT NULL AS set_function_present;

-- ═════════════════════════════════════════════════════════════════════════════
-- DEPLOY S08-1 AND CONFIRM IT IS LIVE BEFORE GOING ON. After migration B the column is
-- gone, and the old modal code, which writes it, would fail every cohort save.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── PRE-B 1: no plaintext password is without a hash, and every one verifies ─
-- Expect one row: plaintext_rows = hashed_plaintext_rows = verifying_rows. STOP on any
-- inequality: a cohort would lose its password.
SELECT count(*) AS plaintext_rows,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.cohort_form_secrets s WHERE s.cohort_id = c.id)) AS hashed_plaintext_rows,
       count(*) FILTER (WHERE public.verify_school_form_password(c.id, c.school_form_password)) AS verifying_rows
FROM public.cohorts c
WHERE btrim(coalesce(c.school_form_password, '')) <> '';

-- ── PRE-B 2: nothing else depends on the column ──────────────────────────────
-- Expect: no rows. A row names a view, rule, trigger, index or constraint that uses
-- cohorts.school_form_password; migration B's DROP COLUMN would fail or take it along.
SELECT d.classid::regclass AS kind, d.objid, d.deptype
FROM pg_depend d
JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
WHERE d.refobjid = 'public.cohorts'::regclass
  AND a.attname = 'school_form_password'
  AND d.deptype IN ('n', 'a');

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY MIGRATION B as ONE block. Expected: "Success. No rows returned."
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST-B 1: the plaintext column is gone ───────────────────────────────────
-- Expect: column_present false, secrets_table_present true.
SELECT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'cohorts' AND column_name = 'school_form_password') AS column_present,
       to_regclass('public.cohort_form_secrets') IS NOT NULL AS secrets_table_present;

-- ── POST-B 2: no function mentions the plaintext column any more; grants unchanged ─
-- Expect 3 rows: mentions_plaintext false on all; anon and authenticated true for
-- requires and verify, false for set; service_role true on all; security_definer true.
SELECT p.proname,
       (p.prosrc ~ 'school_form_password') AS mentions_plaintext,
       p.prosecdef AS security_definer,
       p.proconfig AS search_path,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('school_form_requires_password', 'verify_school_form_password', 'set_school_form_password')
ORDER BY p.proname;

-- ── POST-B 3: every cohort that had a password still requires one ────────────
-- Expect: for every row PRE-A 4 showed has_password true, requires_password true and
-- hashed true; for the rest, both false. wrong_password_refused true everywhere.
SELECT c.name,
       public.school_form_requires_password(c.id) AS requires_password,
       EXISTS (SELECT 1 FROM public.cohort_form_secrets s WHERE s.cohort_id = c.id) AS hashed,
       NOT public.verify_school_form_password(c.id, 'definitely-not-the-password') AS wrong_password_refused,
       NOT public.verify_school_form_password(c.id, '') AS empty_refused
FROM public.cohorts c
ORDER BY c.accepting_submissions DESC, c.name;

-- ── POST-B 4: the live proof that a correct password still works ─────────────
-- The plaintext is gone, so only you can supply it. On the public school form for the
-- accepting cohort (Fall 2026), enter its password and confirm the form opens; enter a
-- wrong one and confirm it is refused. Record the outcome in the ledger row. No SQL.
SELECT 'Open the school form for the accepting cohort and try the real password, then a wrong one.' AS do_this_by_hand;
