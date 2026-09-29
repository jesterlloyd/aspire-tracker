-- KEITH-FOUNDATION-1, 2026-09-28. OWNER-GATED: do not apply from a session.
--
-- The plumbing every Keith feature uses: one Skill runner (lib/server/keith/runKeithSkill.js),
-- one provenance record per Keith output, shadow mode, and the Keith mark that reads its state
-- from that record. Reference: docs/mockups/keith-workflow.html.
--
--   1. keith_skills.run_mode       'shadow' | 'on' (default 'on', so every skill behaves exactly as
--                                  it does today). A skill's OFF is the existing switch: not
--                                  active, or enabled = false. The runner refuses to run it.
--   2. keith_provenance            one row per Keith output: which skill and version, what it is
--                                  attached to, the IDs (never the contents) of what Keith read,
--                                  the structured output, and what a person did with it. The
--                                  output, its inputs and its skill never change after insert (a
--                                  trigger refuses it); only the outcome columns move, through
--                                  recordKeithOutcome. No DELETE, no TRUNCATE.
--   3. keith_skill_mode_changes    append-only: every Shadow/On switch, by whom, with the shadow
--                                  agreement figure at that moment.
--   4. Backfill                    one provenance row per receipt Keith has already read (the
--                                  Program Budget retrofit), skill_version 'legacy'.
--
-- Posture is the Keith chassis's (20260805000001): RLS ON with ZERO policies and every privilege
-- revoked from anon and authenticated. The app reads and writes through service-role endpoints
-- (/api/keith-provenance, /api/budget-staff, /api/keith-skills-admin), which decide who sees what.
--
-- The app runs on both sides of this migration: without run_mode every skill reads as 'on', and
-- without keith_provenance the runner still runs and returns no provenance id, so no mark shows.
-- Requires 20260805000001 (keith_skills), 20261006000000 (append_only_refuse) and, for the
-- backfill only, 20261013000000 (budget_receipts; skipped if absent). All applied.
-- Checks: db/audit/keith_foundation_checks.sql. Rollback: end of file.

BEGIN;

-- ── 1. A skill's mode ────────────────────────────────────────────────────────────

ALTER TABLE public.keith_skills ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'on';
DO $m$ BEGIN
  ALTER TABLE public.keith_skills ADD CONSTRAINT chk_keith_skills_run_mode CHECK (run_mode IN ('shadow', 'on'));
EXCEPTION WHEN duplicate_object THEN NULL; END $m$;

-- ── 2. Provenance ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.keith_provenance (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  skill_key         text        NOT NULL,                 -- keith_skills.slug
  skill_version     text        NOT NULL,                 -- the skill's version, or 'legacy' for a backfilled row
  entity_type       text        NOT NULL,                 -- what the output is attached to: budget_receipt, checkin_reply, ...
  entity_id         uuid        NOT NULL,
  field             text,                                 -- which part of the entity, when it has several
  input_refs        jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{type, id}] of what Keith read, never contents
  output            jsonb       NOT NULL,                 -- the structured output, as validated
  confidence        text,
  reason            text,
  mode              text        NOT NULL,                 -- the skill's mode when it ran
  state             text        NOT NULL DEFAULT 'drafted',
  human_action_by   uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  human_action_at   timestamptz,
  human_diff        jsonb,                                -- what the person changed, or the label they chose in shadow mode
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_keith_provenance_mode  CHECK (mode IN ('shadow', 'on')),
  CONSTRAINT chk_keith_provenance_state CHECK (state IN ('drafted', 'edited', 'accepted', 'rejected', 'reverted')),
  CONSTRAINT chk_keith_provenance_conf  CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  CONSTRAINT chk_keith_provenance_json  CHECK (jsonb_typeof(input_refs) = 'array' AND jsonb_typeof(output) IN ('object', 'array')),
  CONSTRAINT chk_keith_provenance_reason CHECK (reason IS NULL OR length(reason) <= 4000)
);
CREATE INDEX IF NOT EXISTS idx_keith_provenance_entity ON public.keith_provenance (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keith_provenance_skill  ON public.keith_provenance (skill_key, mode, created_at DESC);

-- What Keith produced is fixed once written: only the outcome may change, and nothing is deleted.
CREATE OR REPLACE FUNCTION public.keith_provenance_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'keith_provenance is append-only: DELETE refused' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.skill_key IS DISTINCT FROM OLD.skill_key OR NEW.skill_version IS DISTINCT FROM OLD.skill_version
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.field IS DISTINCT FROM OLD.field OR NEW.input_refs IS DISTINCT FROM OLD.input_refs
     OR NEW.output IS DISTINCT FROM OLD.output OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'keith_provenance: only the outcome may change' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.keith_provenance_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_keith_provenance_guard ON public.keith_provenance;
CREATE TRIGGER trg_keith_provenance_guard BEFORE UPDATE OR DELETE ON public.keith_provenance
  FOR EACH ROW EXECUTE FUNCTION public.keith_provenance_guard();
DROP TRIGGER IF EXISTS trg_keith_provenance_no_truncate ON public.keith_provenance;
CREATE TRIGGER trg_keith_provenance_no_truncate BEFORE TRUNCATE ON public.keith_provenance
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_refuse();

COMMENT ON TABLE public.keith_provenance IS
  'One row per Keith output. input_refs holds IDs, never contents. Output and inputs are immutable; state changes only through recordKeithOutcome. Internal only: never rendered to a student, school or outside party.';

-- ── 3. Mode changes ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.keith_skill_mode_changes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  skill_id      uuid        REFERENCES public.keith_skills(id) ON DELETE SET NULL,
  skill_key     text        NOT NULL,
  from_mode     text        NOT NULL,
  to_mode       text        NOT NULL,
  agreement     jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {total, agreed, byLabel} at the moment of the switch
  changed_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_keith_mode_changes_modes CHECK (from_mode IN ('shadow', 'on') AND to_mode IN ('shadow', 'on') AND from_mode <> to_mode)
);
CREATE INDEX IF NOT EXISTS idx_keith_mode_changes_skill ON public.keith_skill_mode_changes (skill_key, created_at DESC);

DROP TRIGGER IF EXISTS trg_keith_skill_mode_changes_append_only ON public.keith_skill_mode_changes;
CREATE TRIGGER trg_keith_skill_mode_changes_append_only BEFORE UPDATE OR DELETE ON public.keith_skill_mode_changes
  FOR EACH ROW EXECUTE FUNCTION public.append_only_refuse();
DROP TRIGGER IF EXISTS trg_keith_skill_mode_changes_no_truncate ON public.keith_skill_mode_changes;
CREATE TRIGGER trg_keith_skill_mode_changes_no_truncate BEFORE TRUNCATE ON public.keith_skill_mode_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_refuse();

-- ── RLS and grants: deny-all to the browser, as every Keith table ────────────────

ALTER TABLE public.keith_provenance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keith_skill_mode_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.keith_provenance         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.keith_skill_mode_changes FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.keith_provenance FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.keith_skill_mode_changes FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.keith_provenance TO service_role;
GRANT SELECT, INSERT ON public.keith_skill_mode_changes TO service_role;

-- ── 4. Backfill: receipts Keith has already read ─────────────────────────────────
-- One row per receipt with a reading that has none yet (safe to re-run). created_at is the
-- original upload time.
--   accepted  -> 'edited' when the receipt's latest accept/attach log entry lists an edit to a
--               line, the vendor, the date, the order number, the payment method or the cohort
--               (the fields recordKeithOutcome counts); otherwise 'accepted'. A receipt with no
--               accept log entry cannot be told apart and is 'accepted' (POST 3 counts them).
--   review / snoozed -> 'edited' when the draft differs from the reading on those fields (the
--               payment method excepted: its default comes from the P-card, not the reading);
--               otherwise 'drafted'.
--   rejected  -> 'rejected'. failed / reading / uploading have no reading and get no row.

DO $bf$
BEGIN
  IF to_regclass('public.budget_receipts') IS NULL OR to_regclass('public.budget_changes') IS NULL THEN
    RAISE NOTICE 'KEITH-FOUNDATION-1: budget_receipts absent, backfill skipped';
    RETURN;
  END IF;

  WITH r AS (
    SELECT br.*,
      (SELECT bc.new_value FROM public.budget_changes bc
        WHERE bc.entity = 'receipt' AND bc.entity_id = br.id AND bc.action IN ('accept', 'attach')
        ORDER BY bc.created_at DESC LIMIT 1) AS accept_log
    FROM public.budget_receipts br
    WHERE br.proposal IS NOT NULL
      AND br.status IN ('accepted', 'review', 'snoozed', 'rejected')
      AND NOT EXISTS (SELECT 1 FROM public.keith_provenance kp WHERE kp.entity_type = 'budget_receipt' AND kp.entity_id = br.id)
  ),
  classified AS (
    SELECT r.*,
      CASE
        WHEN r.status = 'rejected' THEN 'rejected'
        WHEN r.status = 'accepted' THEN
          CASE WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(r.accept_log -> 'edits', '[]'::jsonb)) e
            WHERE e ->> 'field' IN ('vendor', 'order_number', 'date', 'payment_method', 'cohort_id', 'line')
               OR e ->> 'field' LIKE 'line.%'
          ) THEN 'edited' ELSE 'accepted' END
        ELSE
          CASE WHEN
            COALESCE(r.draft ->> 'vendor', '') IS DISTINCT FROM COALESCE(r.proposal ->> 'vendor', '')
            OR COALESCE(r.draft ->> 'order_number', '') IS DISTINCT FROM COALESCE(r.proposal ->> 'order_number', '')
            OR COALESCE(r.draft ->> 'date', '') IS DISTINCT FROM COALESCE(r.proposal ->> 'date', '')
            OR COALESCE(r.draft ->> 'cohort_id', '') <> ''
            OR jsonb_array_length(COALESCE(r.draft -> 'lines', '[]'::jsonb)) <> jsonb_array_length(COALESCE(r.proposal -> 'lines', '[]'::jsonb))
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(r.draft -> 'lines', '[]'::jsonb)) WITH ORDINALITY d(line, n)
              LEFT JOIN jsonb_array_elements(COALESCE(r.proposal -> 'lines', '[]'::jsonb)) WITH ORDINALITY p(line, n) ON p.n = d.n
              WHERE (d.line ->> 'set_by_owner') = 'true'
                 OR COALESCE(d.line ->> 'item', '') IS DISTINCT FROM COALESCE(p.line ->> 'item', '')
                 OR COALESCE(d.line ->> 'category', '') IS DISTINCT FROM COALESCE(p.line ->> 'category', '')
                 OR (d.line ->> 'quantity')::numeric IS DISTINCT FROM (p.line ->> 'quantity')::numeric
                 OR (d.line ->> 'base')::numeric IS DISTINCT FROM (p.line ->> 'amount')::numeric
            )
          THEN 'edited' ELSE 'drafted' END
      END AS kstate
    FROM r
  )
  INSERT INTO public.keith_provenance
    (skill_key, skill_version, entity_type, entity_id, field, input_refs, output, confidence, reason, mode, state,
     human_action_by, human_action_at, human_diff, created_at, updated_at)
  SELECT
    'read-receipt', 'legacy', 'budget_receipt', c.id, 'reading',
    jsonb_build_array(jsonb_build_object('type', 'budget_receipt_file', 'id', c.id)),
    c.proposal,
    (SELECT CASE WHEN bool_or(l ->> 'confidence' = 'low') THEN 'low'
                 WHEN bool_or(l ->> 'confidence' = 'medium') THEN 'medium'
                 WHEN count(*) > 0 THEN 'high' END
       FROM jsonb_array_elements(COALESCE(c.proposal -> 'lines', '[]'::jsonb)) l),
    (SELECT left(string_agg((l ->> 'item') || ': ' || (l ->> 'reason'), E'\n'), 4000)
       FROM jsonb_array_elements(COALESCE(c.proposal -> 'lines', '[]'::jsonb)) l
      WHERE COALESCE(l ->> 'reason', '') <> ''),
    'on', c.kstate,
    CASE WHEN c.status IN ('accepted', 'rejected') THEN c.decided_by END,
    CASE WHEN c.status IN ('accepted', 'rejected') THEN c.decided_at END,
    CASE WHEN c.status = 'accepted' THEN jsonb_build_object('legacy', true, 'edits', COALESCE(c.accept_log -> 'edits', '[]'::jsonb)) END,
    c.created_at, now()
  FROM classified c;
END
$bf$;

COMMIT;

-- ── Rollback (run by hand, only if needed) ───────────────────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS public.keith_skill_mode_changes;
--   DROP TABLE IF EXISTS public.keith_provenance;           -- the triggers go with it
--   DROP FUNCTION IF EXISTS public.keith_provenance_guard();
--   ALTER TABLE public.keith_skills DROP CONSTRAINT IF EXISTS chk_keith_skills_run_mode;
--   ALTER TABLE public.keith_skills DROP COLUMN IF EXISTS run_mode;
-- COMMIT;
