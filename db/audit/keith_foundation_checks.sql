-- db/audit/keith_foundation_checks.sql
-- KEITH-FOUNDATION-1, 2026-09-28. Read-only. PRE sections BEFORE
-- supabase/migrations/20261016000000_keith_foundation.sql, POST sections AFTER, one section at a time.

-- ── PRE 1. What the migration needs is there, and what it adds is not ────────────
SELECT
  to_regclass('public.keith_skills') IS NOT NULL                                AS keith_skills,
  to_regprocedure('public.append_only_refuse()') IS NOT NULL                    AS append_only_refuse,
  to_regclass('public.budget_receipts') IS NOT NULL                              AS budget_receipts,
  to_regclass('public.keith_provenance') IS NULL                                 AS provenance_absent,
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keith_skills' AND column_name = 'run_mode') AS run_mode_absent;
-- EXPECT: one row, all five true.

-- ── PRE 2. What the backfill will write, by the rule it will use ─────────────────
-- (the same classification as the migration's section 4, read-only)
WITH r AS (
  SELECT br.id, br.status, br.proposal, br.draft,
    (SELECT bc.new_value FROM public.budget_changes bc
      WHERE bc.entity = 'receipt' AND bc.entity_id = br.id AND bc.action IN ('accept', 'attach')
      ORDER BY bc.created_at DESC LIMIT 1) AS accept_log
  FROM public.budget_receipts br
  WHERE br.proposal IS NOT NULL AND br.status IN ('accepted', 'review', 'snoozed', 'rejected')
)
SELECT status,
  count(*) AS receipts,
  count(*) FILTER (WHERE status = 'accepted' AND accept_log IS NULL) AS accepted_without_log,
  count(*) FILTER (WHERE status = 'accepted' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(accept_log -> 'edits', '[]'::jsonb)) e
    WHERE e ->> 'field' IN ('vendor', 'order_number', 'date', 'payment_method', 'cohort_id', 'line') OR e ->> 'field' LIKE 'line.%')) AS accepted_edited
FROM r GROUP BY status ORDER BY status;
-- EXPECT: one row per status present. accepted_without_log is the number of accepted receipts whose
--         edits cannot be known: they backfill as 'accepted'. Report it with the apply.

-- ── POST 1. The tables, RLS on, no browser grants, no DELETE for anyone ──────────
SELECT c.relname, c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
  has_table_privilege('service_role', c.oid, 'INSERT') AS svc_insert,
  has_table_privilege('service_role', c.oid, 'DELETE') AS svc_delete
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('keith_provenance', 'keith_skill_mode_changes')
ORDER BY 1;
-- EXPECT: 2 rows, rls true, policies 0, anon_select false, auth_select false, svc_insert true, svc_delete false.

-- ── POST 2. The triggers ─────────────────────────────────────────────────────────
SELECT event_object_table AS tbl, trigger_name, string_agg(event_manipulation, ',' ORDER BY event_manipulation) AS events
FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table IN ('keith_provenance', 'keith_skill_mode_changes')
GROUP BY 1, 2 ORDER BY 1, 2;
-- EXPECT: keith_provenance: trg_keith_provenance_guard DELETE,UPDATE (and trg_keith_provenance_no_truncate,
--         which information_schema does not list: TRUNCATE triggers appear in pg_trigger only);
--         keith_skill_mode_changes: trg_keith_skill_mode_changes_append_only DELETE,UPDATE.
SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE 'trg_keith_%truncate' ORDER BY 1;
-- EXPECT: 2 rows, one per table.

-- ── POST 3. run_mode, every skill still 'on' ─────────────────────────────────────
SELECT slug, status, enabled, run_mode FROM public.keith_skills ORDER BY slug;
-- EXPECT: every row run_mode = 'on'. Nothing changed how any skill behaves.

-- ── POST 4. The backfill ─────────────────────────────────────────────────────────
SELECT br.status AS receipt_status, kp.state, kp.skill_version, count(*) AS n
FROM public.keith_provenance kp JOIN public.budget_receipts br ON br.id = kp.entity_id
WHERE kp.entity_type = 'budget_receipt'
GROUP BY 1, 2, 3 ORDER BY 1, 2;
-- EXPECT: skill_version 'legacy' on every row; accepted receipts split into accepted and edited as
--         PRE 2 predicted; review/snoozed drafted or edited; rejected rejected.
SELECT count(*) AS receipts_read_without_provenance
FROM public.budget_receipts br
WHERE br.proposal IS NOT NULL AND br.status IN ('accepted', 'review', 'snoozed', 'rejected')
  AND NOT EXISTS (SELECT 1 FROM public.keith_provenance kp WHERE kp.entity_type = 'budget_receipt' AND kp.entity_id = br.id);
-- EXPECT: 0.

-- ── POST 5. The guard refuses (rolled back on purpose) ───────────────────────────
DO $post5$
DECLARE r text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.keith_provenance) THEN
    RAISE EXCEPTION 'KEITH-FOUNDATION POST 5: no rows to test against (no receipt has been read yet). Nothing was changed.';
  END IF;
  BEGIN
    UPDATE public.keith_provenance SET output = '{}'::jsonb WHERE id = (SELECT id FROM public.keith_provenance LIMIT 1);
    r := r || 'output_update=ALLOWED ';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'output_update=refused ';
  END;
  BEGIN
    DELETE FROM public.keith_provenance WHERE id = (SELECT id FROM public.keith_provenance LIMIT 1);
    r := r || 'delete=ALLOWED ';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'delete=refused ';
  END;
  RAISE EXCEPTION 'KEITH-FOUNDATION POST 5 (rolled back on purpose): %', r;
END
$post5$;
-- EXPECT: an error whose message reads "output_update=refused delete=refused". With an empty table it
--         says so instead ("no rows to test against"): run it again once a receipt has been read.
