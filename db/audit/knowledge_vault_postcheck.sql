-- =====================================================================
-- KNOWLEDGE VAULT POST-MIGRATION VERIFICATION
-- for 20260807000001_knowledge_vault_markdown.sql
-- =====================================================================
--
-- READ-ONLY. Every statement is a SELECT.
--
-- WHY THIS FILE EXISTS: the V1-V8 block inside the migration is written
-- entirely as SQL COMMENTS. Pasting it into the SQL editor executes nothing
-- and reports "Success. No rows returned", which is indistinguishable from a
-- passing run. It is not a verification; it is documentation of one.
--
-- This file fixes that class of mistake by DESIGN: it returns ONE ROW PER
-- CHECK with an explicit verdict. A correct run returns 14 rows. "No rows
-- returned" here can only mean the script did not execute.
--
-- It also corrects a real error in the V1 comment, which said "expect 15
-- rows". The DDL adds SIXTEEN columns: six on knowledge_entries (including
-- superseded_by) and five on each snapshot table.
--
-- Content checks read through to_jsonb(e)->>'col' rather than naming the new
-- columns directly, so this script still runs - and still reports the truth -
-- if the migration only partially applied. That is exactly the situation in
-- which a verification must not itself crash.
--
-- Verdicts: PASS / FAIL / INFO / REVIEW. Any FAIL means do not deploy.

WITH
counts AS (
  SELECT (SELECT count(*) FROM public.knowledge_entries)        AS entries,
         (SELECT count(*) FROM public.knowledge_entry_versions) AS versions,
         (SELECT count(*) FROM public.knowledge_revisions)      AS revisions
),
content AS (
  SELECT count(*)                                                                        AS total,
         count(*) FILTER (WHERE to_jsonb(e)->>'body_format' = 'plain')                   AS plain,
         count(*) FILTER (WHERE to_jsonb(e)->>'body_format' = 'markdown')                AS markdown,
         count(*) FILTER (WHERE to_jsonb(e)->>'body_format' IS NULL)                     AS no_format,
         count(*) FILTER (WHERE COALESCE(to_jsonb(e)->>'aliases', '[]') <> '[]')          AS with_aliases,
         count(*) FILTER (WHERE COALESCE(to_jsonb(e)->>'tags', '[]')    <> '[]')          AS with_tags,
         count(*) FILTER (WHERE to_jsonb(e)->>'superseded_by' IS NOT NULL)                AS superseded
  FROM public.knowledge_entries e
),
cols AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
     AND column_name IN ('body_format','aliases','tags','review_date','confidence','superseded_by')
),
want_fns AS (
  SELECT 'governance_activate_knowledge_entry' AS fn_name,
         'public.governance_activate_knowledge_entry(uuid,uuid,text)' AS sig, true AS replaced
  UNION ALL SELECT 'governance_apply_knowledge_revision',
         'public.governance_apply_knowledge_revision(uuid,uuid)', true
  UNION ALL SELECT 'governance_restore_knowledge_version',
         'public.governance_restore_knowledge_version(uuid,integer,uuid,text)', true
  UNION ALL SELECT 'governance_change_knowledge_state',
         'public.governance_change_knowledge_state(uuid,text,uuid)', false
),
-- Resolved by TYPE via to_regprocedure, never by identity-argument string:
-- pg_get_function_identity_arguments() includes PARAMETER NAMES and produced a
-- false BLOCK in an earlier version of the precheck.
fns AS (
  SELECT w.fn_name, w.replaced, (to_regprocedure(w.sig))::oid AS fn_oid,
         p.prosecdef AS is_definer,
         array_to_string(p.proconfig, ', ') AS cfg,
         -- The real proof the replacement took effect: the new bodies carry the
         -- vault columns through the version snapshot. An unreplaced function
         -- would not mention body_format anywhere.
         (pg_get_functiondef(p.oid) LIKE '%body_format%') AS carries_vault_cols
  FROM want_fns w
  LEFT JOIN pg_proc p ON p.oid = (to_regprocedure(w.sig))::oid
),
overloads AS (
  SELECT count(*) AS n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN (SELECT fn_name FROM want_fns)
    AND NOT EXISTS (SELECT 1 FROM fns f WHERE f.fn_oid = p.oid)
)
SELECT * FROM (

  SELECT 1 AS v, 'Row counts preserved' AS check_name,
         'entries=' || (SELECT entries FROM counts)
      || '  versions=' || (SELECT versions FROM counts)
      || '  pending_revisions=' || (SELECT revisions FROM counts) AS observed,
         'compare against the PRECHECK Q0 check 1 baseline' AS expected,
         'INFO' AS verdict

  UNION ALL
  SELECT 2, 'NO legacy body was rewritten or reformatted',
         'total=' || (SELECT total FROM content)
      || '  plain=' || (SELECT plain FROM content)
      || '  markdown=' || (SELECT markdown FROM content)
      || '  no_format=' || (SELECT no_format FROM content),
         'plain = total, markdown = 0, no_format = 0',
         CASE WHEN (SELECT markdown FROM content) = 0
               AND (SELECT no_format FROM content) = 0
               AND (SELECT plain FROM content) = (SELECT total FROM content)
              THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 3, 'No aliases/tags/supersession invented by the migration',
         'with_aliases=' || (SELECT with_aliases FROM content)
      || '  with_tags=' || (SELECT with_tags FROM content)
      || '  superseded=' || (SELECT superseded FROM content),
         'all zero',
         CASE WHEN (SELECT with_aliases FROM content) = 0
               AND (SELECT with_tags FROM content) = 0
               AND (SELECT superseded FROM content) = 0
              THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 4, 'All 16 vault columns present across the three tables',
         (SELECT n::text FROM cols),
         '16  (entries 6 incl. superseded_by, versions 5, revisions 5)',
         CASE WHEN (SELECT n FROM cols) = 16 THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 5, 'knowledge_links exists, RLS enabled, ZERO policies',
         COALESCE((SELECT 'exists=true  rls=' || c.relrowsecurity::text
                     || '  policies=' || (SELECT count(*) FROM pg_policies
                                           WHERE schemaname='public' AND tablename='knowledge_links')::text
                     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname='knowledge_links'), 'exists=false'),
         'exists=true  rls=true  policies=0',
         CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                            WHERE n.nspname='public' AND c.relname='knowledge_links' AND c.relrowsecurity)
               AND NOT EXISTS (SELECT 1 FROM pg_policies
                                WHERE schemaname='public' AND tablename='knowledge_links')
              THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  -- SPLIT INTO 6a AND 6b (2026-08-07). The single combined check claimed an
  -- exact service_role privilege set in its `expected` text but only tested
  -- that anon/authenticated/PUBLIC held nothing, so it returned PASS while
  -- service_role in fact held all seven privileges. A check must test what its
  -- expected column claims.
  --
  -- 6a is the SECURITY boundary and is a hard FAIL.
  SELECT 6, 'knowledge_links: no client role holds ANY privilege',
         COALESCE((SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ', ' ORDER BY grantee || ':' || privilege_type)
                     FROM information_schema.role_table_grants
                    WHERE table_schema='public' AND table_name='knowledge_links'
                      AND grantee IN ('anon','authenticated','PUBLIC')), '(none)'),
         '(none) - anon, authenticated and PUBLIC must hold nothing',
         CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                                WHERE table_schema='public' AND table_name='knowledge_links'
                                  AND grantee IN ('anon','authenticated','PUBLIC'))
              THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  -- 6b is LEAST PRIVILEGE, and is REVIEW rather than FAIL: a broader
  -- service_role grant is a hygiene gap, not an exposure. postgres is excluded
  -- throughout - it is the trusted table owner and the role that applies
  -- migrations, and its full privileges are expected and correct.
  SELECT 7, 'knowledge_links: service_role holds EXACTLY select/insert/delete',
         COALESCE((SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type)
                     FROM information_schema.role_table_grants
                    WHERE table_schema='public' AND table_name='knowledge_links'
                      AND grantee = 'service_role'), '(no grant)'),
         'DELETE, INSERT, SELECT  (runtime uses exactly these three)',
         CASE WHEN (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
                      FROM information_schema.role_table_grants
                     WHERE table_schema='public' AND table_name='knowledge_links'
                       AND grantee = 'service_role') = 'DELETE,INSERT,SELECT'
              THEN 'PASS' ELSE 'REVIEW' END

  UNION ALL
  SELECT 8, 'The 3 replaced RPCs resolve and carry the vault columns',
         string_agg(fn_name || '=' || COALESCE(fn_oid::text,'UNRESOLVED')
                    || CASE WHEN carries_vault_cols THEN '/updated' ELSE '/OLD-BODY' END,
                    ', ' ORDER BY fn_name),
         'all three resolve AND report /updated',
         CASE WHEN count(*) = 3 AND bool_and(fn_oid IS NOT NULL) AND bool_and(carries_vault_cols)
              THEN 'PASS' ELSE 'FAIL' END
  FROM fns WHERE replaced

  UNION ALL
  SELECT 9, 'All 4 RPCs still SECURITY INVOKER with pinned search_path',
         COALESCE(string_agg(fn_name || '=' ||
                CASE WHEN fn_oid IS NULL THEN 'UNRESOLVED'
                     ELSE (CASE WHEN is_definer THEN 'DEFINER' ELSE 'INVOKER' END)
                          || '/' || COALESCE(NULLIF(cfg,''), '(no search_path)') END,
                ', ' ORDER BY fn_name), '(none resolved)'),
         'all four INVOKER with search_path=pg_catalog, public',
         CASE
           WHEN count(*) FILTER (WHERE fn_oid IS NOT NULL) < 4 THEN 'FAIL'
           WHEN bool_or(is_definer) THEN 'FAIL'
           WHEN bool_or(fn_oid IS NOT NULL AND NULLIF(cfg,'') IS NULL) THEN 'FAIL'
           ELSE 'PASS'
         END
  FROM fns

  UNION ALL
  SELECT 10, 'governance_change_knowledge_state was NOT replaced',
         COALESCE((SELECT CASE WHEN carries_vault_cols THEN 'MODIFIED' ELSE 'untouched' END
                     FROM fns WHERE fn_name='governance_change_knowledge_state'), 'UNRESOLVED'),
         'untouched  (it touches no content column)',
         CASE WHEN (SELECT carries_vault_cols FROM fns WHERE fn_name='governance_change_knowledge_state') = false
              THEN 'PASS' ELSE 'REVIEW' END

  UNION ALL
  SELECT 11, 'No unexpected overloads of the 4 governance names',
         (SELECT n::text FROM overloads), '0',
         CASE WHEN (SELECT n FROM overloads) = 0 THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  -- Same defect class as the old check 6: this said "service_role only" while
  -- testing only that clients held nothing. postgres ALWAYS appears here as the
  -- function owner, so the old wording described a state that can never exist
  -- and the check would have passed regardless.
  --
  -- Now stated correctly and tested in two parts: NO client role may hold
  -- EXECUTE (hard FAIL), and service_role MUST hold it on all three or the
  -- endpoint cannot call them (hard FAIL). postgres is excluded as the trusted
  -- owner.
  SELECT 12, 'EXECUTE: no client role, and service_role on all 3 (postgres owner excluded)',
         'clients=' ||
         COALESCE((SELECT string_agg(DISTINCT g.grantee, ', ')
                     FROM information_schema.routine_privileges g
                     JOIN information_schema.routines r ON r.specific_name = g.specific_name
                    WHERE r.routine_schema='public'
                      AND r.routine_name IN ('governance_activate_knowledge_entry',
                                             'governance_apply_knowledge_revision',
                                             'governance_restore_knowledge_version')
                      AND g.grantee IN ('anon','authenticated','PUBLIC')), '(none)')
      || '  service_role_on=' ||
         (SELECT count(DISTINCT r.routine_name)::text
            FROM information_schema.routine_privileges g
            JOIN information_schema.routines r ON r.specific_name = g.specific_name
           WHERE r.routine_schema='public' AND g.grantee='service_role'
             AND g.privilege_type='EXECUTE'
             AND r.routine_name IN ('governance_activate_knowledge_entry',
                                    'governance_apply_knowledge_revision',
                                    'governance_restore_knowledge_version')) || '/3',
         'clients=(none)  service_role_on=3/3',
         CASE
           WHEN EXISTS (SELECT 1 FROM information_schema.routine_privileges g
                         JOIN information_schema.routines r ON r.specific_name = g.specific_name
                        WHERE r.routine_schema='public'
                          AND r.routine_name IN ('governance_activate_knowledge_entry',
                                                 'governance_apply_knowledge_revision',
                                                 'governance_restore_knowledge_version')
                          AND g.grantee IN ('anon','authenticated','PUBLIC'))
             THEN 'FAIL'
           WHEN (SELECT count(DISTINCT r.routine_name)
                   FROM information_schema.routine_privileges g
                   JOIN information_schema.routines r ON r.specific_name = g.specific_name
                  WHERE r.routine_schema='public' AND g.grantee='service_role'
                    AND g.privilege_type='EXECUTE'
                    AND r.routine_name IN ('governance_activate_knowledge_entry',
                                           'governance_apply_knowledge_revision',
                                           'governance_restore_knowledge_version')) < 3
             THEN 'FAIL'
           ELSE 'PASS'
         END

  UNION ALL
  SELECT 13, 'Existing RLS + governance vocabulary preserved',
         'kc_rls=' || (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                        WHERE n.nspname='public' AND c.relrowsecurity
                          AND c.relname IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions'))::text
      || '/3  policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname='public'
                              AND tablename IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions'))::text
      || '  orig_checks=' || (SELECT count(*) FROM pg_constraint
                               WHERE conname IN ('knowledge_entries_category_check','knowledge_entries_state_check',
                                                 'knowledge_entry_versions_category_check','knowledge_revisions_category_check'))::text || '/4',
         'kc_rls=3/3  policies=0  orig_checks=4/4',
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relrowsecurity
                       AND c.relname IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')) = 3
               AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                                AND tablename IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions'))
               AND (SELECT count(*) FROM pg_constraint
                     WHERE conname IN ('knowledge_entries_category_check','knowledge_entries_state_check',
                                       'knowledge_entry_versions_category_check','knowledge_revisions_category_check')) = 4
              THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 14, 'anon/authenticated grants on the 3 knowledge tables (UNCHANGED by design)',
         COALESCE((SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ', ')
                     FROM information_schema.role_table_grants
                    WHERE table_schema='public'
                      AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
                      AND grantee IN ('anon','authenticated','PUBLIC')), '(none)'),
         'identical to PRECHECK check 4; hardening is a separate Owner-gated item',
         'INFO'
) v
ORDER BY v;
