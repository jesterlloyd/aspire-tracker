-- =====================================================================
-- KNOWLEDGE VAULT PRECHECK  (for 20260807000001_knowledge_vault_markdown.sql)
-- =====================================================================
--
-- READ-ONLY. Every statement in this file is a SELECT. It creates nothing,
-- alters nothing, and writes nothing. Run it in production BEFORE the
-- migration and read the verdicts.
--
-- WHY THIS FILE EXISTS RATHER THAN THE DO-BLOCK INSIDE THE MIGRATION:
-- the migration's own precheck uses RAISE NOTICE, and the Supabase SQL editor
-- does not reliably surface NOTICE output. Everything here returns a RESULT
-- SET instead, so nothing depends on where the output happens to be shown.
--
-- HOW TO RUN: Q0 first. If Q0 shows no BLOCK row, the migration is safe to
-- apply. Q1-Q6 are the supporting detail behind each Q0 line; run them when
-- Q0 flags something, or run them all for a full record.
--
-- Verdict vocabulary:
--   OK      expected state, proceed
--   INFO    informational, never a reason to stop
--   REVIEW  unexpected, understand it before proceeding
--   BLOCK   do NOT run the migration until resolved

-- =====================================================================
-- Q0. GO / NO-GO GATE  -- run this first; one row per check
-- =====================================================================
WITH
tbl AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
),
-- Columns the migration intends to ADD. Any that already exist are a
-- collision: ADD COLUMN IF NOT EXISTS would silently skip them, leaving a
-- column whose type may not match what the application writes.
want_cols AS (
  SELECT 'knowledge_entries' AS tbl_name, 'body_format' AS col_name, 'text' AS want_type
  UNION ALL SELECT 'knowledge_entries', 'aliases', 'ARRAY'
  UNION ALL SELECT 'knowledge_entries', 'tags', 'ARRAY'
  UNION ALL SELECT 'knowledge_entries', 'review_date', 'date'
  UNION ALL SELECT 'knowledge_entries', 'confidence', 'text'
  UNION ALL SELECT 'knowledge_entries', 'superseded_by', 'uuid'
  UNION ALL SELECT 'knowledge_entry_versions', 'body_format', 'text'
  UNION ALL SELECT 'knowledge_entry_versions', 'aliases', 'ARRAY'
  UNION ALL SELECT 'knowledge_entry_versions', 'tags', 'ARRAY'
  UNION ALL SELECT 'knowledge_entry_versions', 'review_date', 'date'
  UNION ALL SELECT 'knowledge_entry_versions', 'confidence', 'text'
  UNION ALL SELECT 'knowledge_revisions', 'body_format', 'text'
  UNION ALL SELECT 'knowledge_revisions', 'aliases', 'ARRAY'
  UNION ALL SELECT 'knowledge_revisions', 'tags', 'ARRAY'
  UNION ALL SELECT 'knowledge_revisions', 'review_date', 'date'
  UNION ALL SELECT 'knowledge_revisions', 'confidence', 'text'
),
col_collisions AS (
  SELECT w.tbl_name, w.col_name, c.data_type,
         (c.data_type IS DISTINCT FROM w.want_type) AS type_mismatch
  FROM want_cols w
  JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = w.tbl_name AND c.column_name = w.col_name
),
-- The three functions the migration REPLACES, plus the one it leaves alone.
-- CREATE OR REPLACE only replaces a function whose argument TYPES match
-- exactly; a different type list creates an overload and leaves the old
-- function live, which is the single most dangerous outcome here.
--
-- SIGNATURES ARE RESOLVED BY OID, NOT BY STRING.
-- An earlier version of this file compared pg_get_function_identity_arguments()
-- against bare type lists such as 'uuid, uuid, text'. That function INCLUDES
-- PARAMETER NAMES, so production's 'p_entry_id uuid, p_actor_profile_id uuid,
-- p_change_note text' never matched, and all four checks reported a false BLOCK
-- against a perfectly healthy database (verified 2026-08-07: identity match
-- false, canonical type match true, for all four).
--
-- to_regprocedure() resolves a signature by TYPE, ignores parameter names
-- entirely, and returns NULL instead of erroring when nothing matches - which
-- is exactly the semantics a signature check needs.
want_fns AS (
  SELECT 'governance_activate_knowledge_entry' AS fn_name,
         'public.governance_activate_knowledge_entry(uuid,uuid,text)' AS sig,
         true AS will_replace
  UNION ALL SELECT 'governance_apply_knowledge_revision',
         'public.governance_apply_knowledge_revision(uuid,uuid)', true
  UNION ALL SELECT 'governance_restore_knowledge_version',
         'public.governance_restore_knowledge_version(uuid,integer,uuid,text)', true
  UNION ALL SELECT 'governance_change_knowledge_state',
         'public.governance_change_knowledge_state(uuid,text,uuid)', false
),
resolved AS (
  SELECT w.fn_name, w.sig, w.will_replace,
         (to_regprocedure(w.sig))::oid AS fn_oid
  FROM want_fns w
),
-- Posture read from pg_proc via the RESOLVED oid, so it can never be blank
-- just because a name comparison failed. Unresolved functions stay in the set
-- as a NULL oid rather than vanishing.
fn_posture AS (
  SELECT r.fn_name, r.will_replace, r.fn_oid,
         p.prosecdef AS is_definer,
         array_to_string(p.proconfig, ', ') AS cfg
  FROM resolved r
  LEFT JOIN pg_proc p ON p.oid = r.fn_oid
),
-- A GENUINE overload: a function carrying one of these four names whose oid is
-- NOT one of the four we resolved. NOT EXISTS rather than NOT IN, because a
-- NULL in a NOT IN subquery would make the whole predicate NULL and silently
-- report zero overloads.
fn_overloads AS (
  SELECT count(*) AS n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (SELECT fn_name FROM want_fns)
    AND NOT EXISTS (SELECT 1 FROM resolved r WHERE r.fn_oid = p.oid)
)
SELECT * FROM (
  -- ── Row counts (informational baseline) ────────────────────────────
  SELECT 1 AS q, 'Row counts' AS check_name,
         'entries=' || (SELECT count(*) FROM public.knowledge_entries)
      || '  versions=' || (SELECT count(*) FROM public.knowledge_entry_versions)
      || '  pending_revisions=' || (SELECT count(*) FROM public.knowledge_revisions)
      || '  active=' || (SELECT count(*) FROM public.knowledge_entries WHERE state='active') AS observed,
         'no expected value; this is the baseline' AS expected,
         'INFO' AS verdict

  -- ── RLS posture ────────────────────────────────────────────────────
  UNION ALL
  SELECT 2, 'RLS enabled on all three tables',
         string_agg(relname || '=' || relrowsecurity::text, ', ' ORDER BY relname),
         'all three true',
         CASE WHEN bool_and(relrowsecurity) AND count(*) = 3 THEN 'OK' ELSE 'BLOCK' END
  FROM tbl

  UNION ALL
  SELECT 3, 'Policy count (expect ZERO: deny-all)',
         COALESCE((SELECT count(*)::text FROM pg_policies
                    WHERE schemaname='public'
                      AND tablename IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')), '0'),
         '0',
         CASE WHEN (SELECT count(*) FROM pg_policies
                     WHERE schemaname='public'
                       AND tablename IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')) = 0
              THEN 'OK' ELSE 'REVIEW' END

  -- ── Grants (NOT changed by this release; reported for the record) ───
  UNION ALL
  SELECT 4, 'anon / authenticated privileges on the 3 knowledge tables',
         COALESCE((SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ', ')
                     FROM information_schema.role_table_grants
                    WHERE table_schema='public'
                      AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
                      AND grantee IN ('anon','authenticated','PUBLIC')), '(none)'),
         'unchanged by this migration either way',
         'INFO'

  -- ── Governance RPC posture ─────────────────────────────────────────
  UNION ALL
  -- Resolves by TYPE, so parameter names are irrelevant. A NULL oid means the
  -- migration's CREATE OR REPLACE would CREATE a function rather than replace
  -- one, leaving any old body live beside it - hence BLOCK.
  SELECT 5, 'The 3 RPCs to be replaced resolve to a real OID',
         string_agg(fn_name || '=' || COALESCE(fn_oid::text, 'UNRESOLVED'), ', ' ORDER BY fn_name),
         'all three resolve to an OID',
         CASE WHEN count(*) = 3 AND bool_and(fn_oid IS NOT NULL) THEN 'OK' ELSE 'BLOCK' END
  FROM resolved WHERE will_replace

  UNION ALL
  SELECT 6, 'governance_change_knowledge_state resolves and is NOT replaced',
         COALESCE((SELECT fn_oid::text FROM resolved WHERE fn_name='governance_change_knowledge_state'), 'UNRESOLVED'),
         'resolves to an OID',
         CASE WHEN (SELECT fn_oid FROM resolved WHERE fn_name='governance_change_knowledge_state') IS NOT NULL
              THEN 'OK' ELSE 'REVIEW' END

  UNION ALL
  -- Counts ONLY functions carrying one of the four names whose oid is not one
  -- of the four we resolved, so an expected function can no longer be counted
  -- as an overload against itself - which is exactly what the string version did.
  SELECT 7, 'Genuine overloads (one of the 4 names, unexpected signature)',
         (SELECT n::text FROM fn_overloads),
         '0',
         CASE WHEN (SELECT n FROM fn_overloads) = 0 THEN 'OK' ELSE 'BLOCK' END

  UNION ALL
  -- Read from pg_proc via the RESOLVED oid, so this reports real posture rather
  -- than "(none found)" whenever a name comparison happens to match nothing.
  SELECT 8, 'All 4 resolved RPCs are SECURITY INVOKER with a pinned search_path',
         COALESCE(string_agg(fn_name || '=' ||
                CASE WHEN fn_oid IS NULL THEN 'UNRESOLVED'
                     ELSE (CASE WHEN is_definer THEN 'DEFINER' ELSE 'INVOKER' END)
                          || '/' || COALESCE(NULLIF(cfg, ''), '(no search_path)')
                END, ', ' ORDER BY fn_name), '(none resolved)'),
         'all four INVOKER with search_path=pg_catalog, public',
         -- fn_posture always has 4 rows, so count(*) alone proves nothing;
         -- count only the RESOLVED ones, and never let a NULL aggregate fall
         -- through to OK.
         CASE
           WHEN count(*) FILTER (WHERE fn_oid IS NOT NULL) = 0 THEN 'BLOCK'
           WHEN bool_or(is_definer) THEN 'BLOCK'
           WHEN bool_or(fn_oid IS NOT NULL AND NULLIF(cfg, '') IS NULL) THEN 'BLOCK'
           WHEN count(*) FILTER (WHERE fn_oid IS NOT NULL) < 4 THEN 'REVIEW'
           ELSE 'OK'
         END
  FROM fn_posture

  -- ── Collisions ─────────────────────────────────────────────────────
  UNION ALL
  SELECT 9, 'Columns the migration adds that ALREADY exist',
         COALESCE((SELECT string_agg(tbl_name || '.' || col_name || ' (' || data_type || ')', ', ')
                     FROM col_collisions), '(none)'),
         '(none)',
         CASE
           WHEN (SELECT count(*) FROM col_collisions) = 0 THEN 'OK'
           WHEN (SELECT bool_or(type_mismatch) FROM col_collisions) THEN 'BLOCK'
           ELSE 'REVIEW'
         END

  UNION ALL
  SELECT 10, 'knowledge_links table already exists',
         (SELECT EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_schema='public' AND table_name='knowledge_links')::text),
         'false',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                            WHERE table_schema='public' AND table_name='knowledge_links')
              THEN 'REVIEW' ELSE 'OK' END

  UNION ALL
  SELECT 11, 'Constraints/indexes the migration creates that already exist',
         COALESCE((SELECT string_agg(conname, ', ') FROM pg_constraint
                    WHERE conname IN ('knowledge_entries_body_format_check',
                                      'knowledge_entries_confidence_check',
                                      'knowledge_entries_superseded_by_fkey',
                                      'knowledge_entries_superseded_by_not_self',
                                      'knowledge_entry_versions_body_format_check',
                                      'knowledge_entry_versions_confidence_check',
                                      'knowledge_revisions_body_format_check',
                                      'knowledge_revisions_confidence_check',
                                      'knowledge_links_status_check',
                                      'knowledge_links_matched_on_check',
                                      'knowledge_links_unique')), '(none)')
      || ' | idx: ' ||
         COALESCE((SELECT string_agg(indexname, ', ') FROM pg_indexes
                    WHERE schemaname='public'
                      AND indexname IN ('idx_knowledge_entries_tags','idx_knowledge_entries_review',
                                        'idx_knowledge_links_source','idx_knowledge_links_target',
                                        'idx_knowledge_links_status')), '(none)'),
         '(none) | idx: (none)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conname IN ('knowledge_entries_body_format_check',
                                              'knowledge_entries_superseded_by_fkey'))
              THEN 'REVIEW' ELSE 'OK' END

  -- ── Governance vocabulary unchanged ────────────────────────────────
  UNION ALL
  SELECT 12, 'Category and state CHECK constraints are the originals',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conname IN ('knowledge_entries_category_check','knowledge_entries_state_check',
                             'knowledge_entry_versions_category_check','knowledge_revisions_category_check')),
         '4',
         CASE WHEN (SELECT count(*) FROM pg_constraint
                     WHERE conname IN ('knowledge_entries_category_check','knowledge_entries_state_check',
                                       'knowledge_entry_versions_category_check','knowledge_revisions_category_check')) = 4
              THEN 'OK' ELSE 'REVIEW' END

  -- ── Expiry (ADVISORY ONLY - never a blocker for this migration) ────
  UNION ALL
  SELECT 13, 'ACTIVE entries already past expires_at',
         (SELECT count(*)::text FROM public.knowledge_entries
           WHERE state='active' AND expires_at IS NOT NULL AND expires_at < CURRENT_DATE),
         'any number is acceptable; expiry stays advisory in this release',
         'INFO'

  UNION ALL
  -- review_date is a column this migration ADDS, so a pre-migration database
  -- does not have it. It is read here through to_jsonb(e)->>'review_date'
  -- rather than as a column reference.
  --
  -- A CASE guard would NOT be enough: PostgreSQL resolves column references
  -- when it parses the statement, not when it runs it, so a branch that is
  -- never taken still has to name a column that exists. Going through jsonb
  -- makes the name a string KEY instead of an identifier, which the parser
  -- never resolves against the table - so this is safe before AND after the
  -- migration, and reports 0 rather than erroring.
  SELECT 14, 'ACTIVE entries past review_date',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='knowledge_entries'
                              AND column_name='review_date')
              THEN (SELECT count(*)::text FROM public.knowledge_entries e
                     WHERE e.state='active'
                       AND NULLIF(to_jsonb(e)->>'review_date','')::date <= CURRENT_DATE)
              ELSE 'n/a - review_date not present yet (expected before this migration)'
         END,
         'informational',
         'INFO'
) g
ORDER BY q;


-- =====================================================================
-- Q1. Row counts, in detail
-- =====================================================================
SELECT 'knowledge_entries' AS table_name, count(*) AS rows,
       count(*) FILTER (WHERE state='draft')      AS draft,
       count(*) FILTER (WHERE state='active')     AS active,
       count(*) FILTER (WHERE state='deprecated') AS deprecated,
       count(*) FILTER (WHERE state='archived')   AS archived
  FROM public.knowledge_entries
UNION ALL
SELECT 'knowledge_entry_versions', count(*), NULL, NULL, NULL, NULL FROM public.knowledge_entry_versions
UNION ALL
SELECT 'knowledge_revisions (pending)', count(*), NULL, NULL, NULL, NULL FROM public.knowledge_revisions;


-- =====================================================================
-- Q2. RLS and policy posture
-- =====================================================================
SELECT c.relname AS table_name,
       c.relrowsecurity      AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname='public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions','knowledge_links')
 ORDER BY c.relname;

-- Any policy that exists (expected: zero rows)
SELECT schemaname, tablename, policyname, roles, cmd
  FROM pg_policies
 WHERE schemaname='public'
   AND tablename IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
 ORDER BY tablename, policyname;


-- =====================================================================
-- Q3. Current table grants
-- =====================================================================
-- Reported for the record. This release does NOT change them; explicit
-- anon/authenticated REVOKEs are queued as a separate Owner-gated item.
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema='public'
   AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions','knowledge_links')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;


-- =====================================================================
-- Q4. Governance RPC signatures, security posture, and EXECUTE grants
-- =====================================================================
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS signature,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
       p.proconfig AS config,
       pg_get_userbyid(p.proowner) AS owner,
       md5(pg_get_functiondef(p.oid)) AS body_md5   -- record it; compare after
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('governance_activate_knowledge_entry',
                     'governance_apply_knowledge_revision',
                     'governance_restore_knowledge_version',
                     'governance_change_knowledge_state')
 ORDER BY p.proname, signature;

-- EXECUTE grants (expected: service_role only, on each of the four)
SELECT r.routine_name, g.grantee, g.privilege_type
  FROM information_schema.routine_privileges g
  JOIN information_schema.routines r ON r.specific_name = g.specific_name
 WHERE r.routine_schema='public'
   AND r.routine_name IN ('governance_activate_knowledge_entry',
                          'governance_apply_knowledge_revision',
                          'governance_restore_knowledge_version',
                          'governance_change_knowledge_state')
 ORDER BY r.routine_name, g.grantee;


-- =====================================================================
-- Q5. Active entries already past expires_at  -- COUNT AND FULL LIST
-- =====================================================================
-- ADVISORY ONLY. This release does not enforce expiry: every one of these
-- entries keeps answering in Keith exactly as it does today. The list exists
-- so the LATER decision to start excluding them is made against real names
-- rather than a guess.
SELECT slug, title, category, expires_at,
       (CURRENT_DATE - expires_at) AS days_expired,
       current_version
  FROM public.knowledge_entries
 WHERE state='active' AND expires_at IS NOT NULL AND expires_at < CURRENT_DATE
 ORDER BY expires_at;

-- Same for review_date, which the new "Needs review" card also counts.
--
-- BEFORE the migration this returns zero rows (the column does not exist yet);
-- AFTER it, it lists the overdue pages. Same jsonb-key technique as check 14,
-- and for the same reason: naming review_date as a column would make this
-- statement unparsable against the pre-migration schema.
SELECT e.slug,
       e.title,
       NULLIF(to_jsonb(e)->>'review_date','')::date AS review_date,
       (CURRENT_DATE - NULLIF(to_jsonb(e)->>'review_date','')::date) AS days_overdue
  FROM public.knowledge_entries e
 WHERE e.state='active'
   AND NULLIF(to_jsonb(e)->>'review_date','')::date <= CURRENT_DATE
 ORDER BY 3;


-- =====================================================================
-- Q6. Collision inventory
-- =====================================================================
-- Columns (expected: zero rows -- none of these should exist yet)
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public'
   AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
   AND column_name IN ('body_format','aliases','tags','review_date','confidence','superseded_by')
 ORDER BY table_name, column_name;

-- Objects (expected: zero rows)
SELECT 'table' AS kind, table_name AS name FROM information_schema.tables
 WHERE table_schema='public' AND table_name='knowledge_links'
UNION ALL
SELECT 'constraint', conname FROM pg_constraint
 WHERE conname IN ('knowledge_entries_body_format_check','knowledge_entries_confidence_check',
                   'knowledge_entries_superseded_by_fkey','knowledge_entries_superseded_by_not_self',
                   'knowledge_entry_versions_body_format_check','knowledge_entry_versions_confidence_check',
                   'knowledge_revisions_body_format_check','knowledge_revisions_confidence_check')
UNION ALL
SELECT 'index', indexname FROM pg_indexes
 WHERE schemaname='public'
   AND indexname IN ('idx_knowledge_entries_tags','idx_knowledge_entries_review',
                     'idx_knowledge_links_source','idx_knowledge_links_target','idx_knowledge_links_status');

-- Existing full column list, for the record / rollback reference.
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public'
   AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
 ORDER BY table_name, ordinal_position;
