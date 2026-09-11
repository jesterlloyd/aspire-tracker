-- ============================================================================
-- RESIDENCY-PORTAL-1: talent_acquisition portal role, preflight + verification
-- Pairs with supabase/migrations/20260911000000_residency_portal_talent_acquisition.sql
-- Every query here is read-only. Run each numbered query on its own.
-- ============================================================================

-- PRE 1. The live role CHECK. Expect ONE row named user_role_grants_role_check
--        listing exactly student, unit_leader, academic_partner, nursing_academic.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.user_role_grants'::regclass AND contype = 'c';

-- PRE 2. Both lifecycle functions exist with the expected signatures (expect 2 rows).
SELECT p.oid::regprocedure AS signature
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('provision_portal_access', 'revoke_portal_access');

-- PRE 3. Grant counts per role before applying. Keep the result: POST 3 must match.
SELECT role, count(*) AS grants FROM public.user_role_grants GROUP BY role ORDER BY role;

-- PRE 4. The live event-audience CHECK (expect the four-role array ending in 'nursing_academic').
SELECT pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.aspire_events'::regclass AND conname = 'aspire_events_audiences_check';

-- POST 1. The CHECK now includes talent_acquisition (expect widened = true).
SELECT pg_get_constraintdef(oid) LIKE '%talent_acquisition%' AS widened,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.user_role_grants'::regclass
  AND conname = 'user_role_grants_role_check';

-- POST 2. Each lifecycle function names talent_acquisition exactly once, in its
--         allowlist (expect provision_portal_access 1, revoke_portal_access 1).
SELECT proname,
       (length(prosrc) - length(replace(prosrc, 'talent_acquisition', ''))) / length('talent_acquisition') AS mentions
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('provision_portal_access', 'revoke_portal_access')
ORDER BY proname;

-- POST 3. Existing grants untouched: must equal PRE 3, with no talent_acquisition row yet.
SELECT role, count(*) AS grants FROM public.user_role_grants GROUP BY role ORDER BY role;

-- POST 4. Only service_role may call the lifecycle functions
--         (expect anon_exec false, authenticated_exec false, service_exec true on both rows).
SELECT f AS function,
       has_function_privilege('anon', f, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', f, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', f, 'EXECUTE')  AS service_exec
FROM (VALUES
  ('public.provision_portal_access(uuid, text, text, text, uuid, timestamptz, uuid, text[], text[], uuid)'),
  ('public.revoke_portal_access(uuid, text, uuid, uuid, text[], text[], uuid, boolean)')
) AS t(f);

-- POST 5. Events can now be ticked for Talent Acquisition (expect widened = true),
--         and no stored event falls outside the widened set (expect 0).
SELECT pg_get_constraintdef(oid) LIKE '%talent_acquisition%' AS widened
FROM pg_constraint
WHERE conrelid = 'public.aspire_events'::regclass AND conname = 'aspire_events_audiences_check';
SELECT count(*) AS outside_set_should_be_0
FROM public.aspire_events
WHERE NOT (audiences <@ array['student','unit_leader','academic_partner','nursing_academic','talent_acquisition']::text[]);
