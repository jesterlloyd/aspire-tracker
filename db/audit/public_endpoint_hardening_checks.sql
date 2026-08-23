-- ============================================================================
-- S-08 through S-11: read-only checks, and the deferred password-hashing plan
-- ============================================================================
-- READ ONLY. Nothing here writes, and nothing exposes a secret.
--
-- NOTHING IN THIS PASS REQUIRES SQL TO BE APPLIED. The rate limiter reuses
-- consume_evaluation_rate_limit, which is already live. Sections 1 and 2 exist
-- so that can be CONFIRMED rather than assumed before the deploy, because the
-- limiter fails closed: if that function were missing, every public submission
-- would be refused. Section 3 answers an open question about S-08. Section 4 is
-- a PLAN, not a migration, and is deliberately not written as runnable DDL.
--
-- RUN EACH NUMBERED SECTION SEPARATELY. The Supabase SQL Editor returns only one
-- result set when several SELECT statements are submitted together.
-- ============================================================================


-- ############################################################################
-- BEFORE DEPLOYING
-- ############################################################################

-- ── 1: the rate-limit function exists and is callable ───────────────────────
-- THIS IS THE ONE THAT MATTERS. api/lib/publicRateLimit.js fails CLOSED: an RPC
-- error is treated exactly like an exceeded limit. If this function were absent,
-- every student intake, unit form, school form, and shift log would be refused.
--
-- It is not defined in any repository migration; it was created out-of-band in
-- the dashboard, like get_my_profile and verify_school_form_password. It is
-- nonetheless in live use by ten deployed endpoints (evaluation submit and token
-- validate, certificate download, interview-book), so it is expected to be here.
--
-- PASS: exactly one row. Run alone.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef                               AS security_definer
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'consume_evaluation_rate_limit';

-- ── 2: who may execute it ───────────────────────────────────────────────────
-- These endpoints call it with the SERVICE ROLE client, which bypasses grants,
-- so this is informational rather than a gate. Recorded so a later change to the
-- grants is a visible change rather than a surprise. Run alone.
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'consume_evaluation_rate_limit'
ORDER BY grantee, privilege_type;


-- ############################################################################
-- S-08: THE OPEN QUESTION
-- ############################################################################

-- ── 3: which cohorts actually have a form password set ──────────────────────
-- Answers the question the task asked and I could not answer from code alone.
-- The server-side check added in this pass asks for a password ONLY when
-- school_form_requires_password() says the cohort has one, so a cohort with a
-- NULL or empty password keeps behaving exactly as it does today.
--
-- THE PASSWORD ITSELF IS NEVER SELECTED HERE, only whether one is present and how
-- long it is. Do not rewrite this to select the column.
--
-- Expect most or all cohorts to have one: NewCohortModal.jsx refuses to create a
-- cohort without it. Any row with has_password = false is a cohort whose public
-- form is open to anyone with the link, before and after this change alike.
-- Run alone.
SELECT
  c.id,
  c.name,
  c.accepting_submissions,
  (c.school_form_password IS NOT NULL
     AND btrim(c.school_form_password) <> '') AS has_password,
  length(btrim(coalesce(c.school_form_password, ''))) AS password_length
FROM public.cohorts c
ORDER BY c.accepting_submissions DESC, c.name;


-- ############################################################################
-- S-08 CONTINUED: HASHING. A PLAN, NOT A MIGRATION.
-- ############################################################################
--
-- DO NOT RUN ANYTHING IN THIS SECTION. It is written as prose on purpose: the
-- work below cannot be authored blind, and shipping it alongside the server-side
-- check would have put a schema change and a staff-UI change into a pass whose
-- job was closing a public-endpoint bypass.
--
-- WHAT IS STILL WRONG
-- cohorts.school_form_password holds the password in plaintext. Anyone with read
-- access to that table, any backup of it, and any log line that ever captured a
-- row read it directly. verify_school_form_password compares with TRIM equality,
-- so it is also not constant-time.
--
-- WHY IT COULD NOT SHIP HERE
--   1. verify_school_form_password and school_form_requires_password are
--      DASHBOARD-CREATED. Their bodies are not in this repository (migration
--      20260712000006 only ALTERs them). Rewriting them requires reading the live
--      definitions first, which needs a query run against production:
--
--        SELECT p.proname, pg_get_functiondef(p.oid)
--        FROM pg_proc p
--        WHERE p.pronamespace = 'public'::regnamespace
--          AND p.proname IN ('verify_school_form_password',
--                            'school_form_requires_password');
--
--      Run that first and paste the result back, and the migration can be
--      written against what is actually there rather than against a guess.
--
--   2. TWO STAFF SURFACES WRITE THE COLUMN DIRECTLY:
--      src/components/NewCohortModal.jsx and src/components/ManageCohortModal.jsx
--      both set school_form_password from a text input. Hashing the column
--      without changing those would mean the next cohort anyone creates stores a
--      plaintext value in a column the verifier now expects to be a hash, and
--      that cohort's form would refuse every correct password.
--
-- THE SEQUENCE, WHEN IT IS TAKEN ON
--   a. Read the two live function definitions (query above).
--   b. Add school_form_password_hash, nullable. Do not drop the plaintext column
--      in the same step.
--   c. Backfill the hash from the plaintext column using pgcrypto's crypt() with
--      a gen_salt('bf') work factor, in one transaction.
--   d. Rewrite verify_school_form_password to compare against the hash, falling
--      back to the plaintext column ONLY while any row still has one, so the
--      migration and the staff-UI change can land in either order.
--   e. Change both cohort modals to write through a server endpoint that hashes,
--      never the column directly. This is the step that makes (f) safe.
--   f. Once no row has a plaintext value (verify with the has_password query in
--      section 3 pointed at the old column), drop it.
--
-- Until (f), the server-side check added in this pass is what actually protects
-- the endpoint, and it protects it whether the column is hashed or not.
