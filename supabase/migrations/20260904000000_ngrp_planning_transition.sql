-- ============================================================================
-- NGRP release 2: Planning units + Transition Form lifecycle + audit
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK (single transaction). Run the PREFLIGHT section first, one statement
-- at a time; every check must come back as stated before applying.
--
-- Product source of truth: docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md
-- (sections 5-7, 10, 14, 15). Builds ON TOP of the applied foundation
-- (20260903000000) and its delete-privilege repair (20260903010000); neither
-- is edited or re-run, and none of the four existing NGRP tables is altered.
--
-- WHAT THIS ADDS (all additive; nothing existing is modified):
--   ngrp_cycle_units           - participating units per residency cohort:
--                                the ONLY source of Transition Form ranked
--                                preferences. Unit identity is unit_name
--                                text, matching how the app names units
--                                everywhere (students.unit_preference_*,
--                                preceptors.unit_name); no second unit
--                                directory is created.
--   ngrp_transition_assignments- ONE form assignment per candidate attempt
--                                (UNIQUE candidate_id): lifecycle status +
--                                timestamps + revision count + optional
--                                per-assignment deadline. Created only by an
--                                actual successful send.
--   ngrp_transition_tokens     - keyed HASHES of the secure links. A raw
--                                token is generated server-side, mailed, and
--                                never stored; only token_hash (HMAC) plus a
--                                nonsecret support prefix persist. At most
--                                one active (unrevoked) token per assignment;
--                                resend revokes before it issues.
--   ngrp_transition_drafts     - the single mutable autosave draft per
--                                assignment (ephemeral by design).
--   ngrp_transition_revisions  - IMMUTABLE submitted revisions, numbered per
--                                assignment. The latest revision is the
--                                submission of record; nothing updates or
--                                deletes a revision (no such privilege is
--                                granted at all).
--   ngrp_candidate_requirements- the explainable eligibility engine's
--                                per-rule rows (code, status, detail,
--                                deadline) - derived data, recalculated from
--                                the latest revision + cycle configuration.
--   ngrp_audit_events          - allowlisted NGRP workflow audit trail with
--                                safe, minimal metadata. Deliberately NO
--                                foreign keys: an audit row must survive any
--                                future deletion of what it describes.
--
-- SECURITY MODEL (same server-only posture as the foundation):
-- RLS enabled on all seven tables with NO policies; every client-role
-- privilege revoked; explicit MINIMAL service_role grants per table - and no
-- DELETE (or UPDATE, for immutable tables) where a durable record must
-- survive: assignments/tokens keep no DELETE, revisions and audit events
-- keep neither UPDATE nor DELETE. All staff traffic flows through
-- authenticated endpoints enforcing ngrp_access / ngrp_manage; the public
-- token endpoint can reach exactly one assignment via its token hash.
--
-- WHAT THIS DOES NOT DO:
--   - No existing table, row, policy, trigger, or function is modified.
--   - No data is backfilled or seeded; legacy ngrp_outcomes and
--     students.ngrp_* stay untouched and untrusted.
--   - No cron, no reminders, no HR access, no support/interview/retention
--     tables (later phases).
-- ============================================================================

-- ── PREFLIGHT (read-only; run BEFORE the transaction below) ─────────────────
-- P1. The foundation is applied (expect 4):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('ngrp_cycles','ngrp_cycle_source_cohorts',
--                         'ngrp_candidates','ngrp_residency_outcomes');
-- P2. The shared touch function exists (expect 1):
--   SELECT count(*) FROM pg_proc WHERE proname = 'ngrp_touch_updated_at';
-- P3. None of the seven new tables exists yet (expect 0):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                         'ngrp_transition_tokens','ngrp_transition_drafts',
--                         'ngrp_transition_revisions','ngrp_candidate_requirements',
--                         'ngrp_audit_events');
-- P4. The outcomes delete-revoke still holds (expect f):
--   SELECT has_table_privilege('service_role','public.ngrp_residency_outcomes','DELETE');

BEGIN;

-- ── Participating units per residency cohort ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ngrp_cycle_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE CASCADE,
  unit_name     text NOT NULL CHECK (btrim(unit_name) <> ''),
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  capacity      integer CHECK (capacity IS NULL OR capacity > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_cycle_units_unique UNIQUE (cycle_id, unit_name)
);
CREATE INDEX IF NOT EXISTS ngrp_cycle_units_cycle_idx ON public.ngrp_cycle_units (cycle_id);

-- ── Transition Form assignments (one per candidate attempt) ─────────────────
-- RESTRICT on candidate_id: once a form has been sent, the attempt (and
-- through the candidate chain, the student row) cannot be silently deleted
-- out from under the form history.
CREATE TABLE IF NOT EXISTS public.ngrp_transition_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'sent'
                          CHECK (status IN ('sent','opened','in_progress','submitted','revised')),
  sent_at               timestamptz NOT NULL DEFAULT now(),
  sent_by_profile_id    uuid REFERENCES public.user_profiles(id),
  opened_at             timestamptz,
  last_saved_at         timestamptz,
  submitted_at          timestamptz,
  revised_at            timestamptz,
  revision_count        integer NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
  -- Optional per-assignment close; the effective close falls back to the
  -- cycle's application_deadline (enforced by the endpoints server-side).
  deadline_at           timestamptz,
  -- Revocation is the honest rollback for a FAILED delivery (the evaluation
  -- pattern: no DELETE privilege exists, so a send whose email never went out
  -- revokes the assignment instead - the roster then correctly shows Not
  -- Sent again, and a fresh send may create a new live assignment).
  revoked_at            timestamptz,
  revoked_by_profile_id uuid REFERENCES public.user_profiles(id),
  revoked_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Lifecycle/timestamp coherence: a status can never claim progress its
  -- timestamps do not carry.
  CONSTRAINT ngrp_assignment_state_times CHECK (
    (status = 'sent')
    OR (status = 'opened'      AND opened_at IS NOT NULL)
    OR (status = 'in_progress' AND opened_at IS NOT NULL)
    OR (status = 'submitted'   AND submitted_at IS NOT NULL AND revision_count >= 1)
    OR (status = 'revised'     AND submitted_at IS NOT NULL AND revised_at IS NOT NULL AND revision_count >= 2)
  )
);
-- One LIVE assignment per candidate attempt: idempotent sends find it, and a
-- revoked (failed) one no longer blocks a fresh send.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_assignments_one_live
  ON public.ngrp_transition_assignments (candidate_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ngrp_assignments_candidate_idx
  ON public.ngrp_transition_assignments (candidate_id);

-- ── Secure link tokens (hashes only; raw tokens are never stored) ───────────
CREATE TABLE IF NOT EXISTS public.ngrp_transition_tokens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         uuid NOT NULL REFERENCES public.ngrp_transition_assignments(id) ON DELETE RESTRICT,
  token_hash            text NOT NULL UNIQUE CHECK (btrim(token_hash) <> ''),
  -- Nonsecret support handle: the first eight characters of token_hash (a
  -- derivative of the HMAC digest, NOT the raw token - the evaluation-token
  -- rule), so support can identify WHICH link without ever seeing one.
  token_hash_prefix     text NOT NULL CHECK (length(token_hash_prefix) BETWEEN 4 AND 16),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id uuid REFERENCES public.user_profiles(id),
  first_used_at         timestamptz,
  revoked_at            timestamptz,
  revoked_by_profile_id uuid REFERENCES public.user_profiles(id),
  CONSTRAINT ngrp_token_revocation_actor
    CHECK (revoked_at IS NULL OR revoked_by_profile_id IS NOT NULL)
);
-- At most ONE live token per assignment: resend must revoke first, in the
-- same server action, and the database makes the overlap impossible.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_tokens_one_active
  ON public.ngrp_transition_tokens (assignment_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ngrp_tokens_assignment_idx ON public.ngrp_transition_tokens (assignment_id);

-- ── Autosave draft (single mutable row per assignment; ephemeral) ───────────
CREATE TABLE IF NOT EXISTS public.ngrp_transition_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES public.ngrp_transition_assignments(id) ON DELETE CASCADE,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  saved_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Immutable submitted revisions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ngrp_transition_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   uuid NOT NULL REFERENCES public.ngrp_transition_assignments(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_revisions_numbered UNIQUE (assignment_id, revision_number)
);
CREATE INDEX IF NOT EXISTS ngrp_revisions_assignment_idx ON public.ngrp_transition_revisions (assignment_id);

-- ── Explainable per-rule eligibility results (derived; recalculable) ────────
CREATE TABLE IF NOT EXISTS public.ngrp_candidate_requirements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id              uuid NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  code                      text NOT NULL
                              CHECK (code IN ('license','experience','gpa','completion_window','bls','acls','accreditation')),
  status                    text NOT NULL CHECK (status IN ('met','not_met','conditional','unknown')),
  label                     text NOT NULL CHECK (btrim(label) <> ''),
  detail                    text,
  deadline                  date,
  computed_from_revision_id uuid REFERENCES public.ngrp_transition_revisions(id),
  computed_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_candidate_requirements_unique UNIQUE (candidate_id, code)
);
CREATE INDEX IF NOT EXISTS ngrp_candidate_requirements_candidate_idx
  ON public.ngrp_candidate_requirements (candidate_id);

-- ── Allowlisted audit trail (no FKs by design: audit outlives its subject) ──
CREATE TABLE IF NOT EXISTS public.ngrp_audit_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type       text NOT NULL CHECK (event_type IN (
                     'cycle_created','cycle_updated','cycle_activated',
                     'source_cohorts_changed','units_changed',
                     'form_sent','form_opened','form_submitted','form_revised',
                     'token_revoked','token_resent',
                     'eligibility_calculated','eligibility_overridden',
                     'application_confirmed','application_withdrawn')),
  cycle_id         uuid,
  candidate_id     uuid,
  assignment_id    uuid,
  student_id       uuid,
  actor_profile_id uuid,
  actor_kind       text NOT NULL DEFAULT 'staff' CHECK (actor_kind IN ('staff','alumnus','system')),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ngrp_audit_events_cycle_idx     ON public.ngrp_audit_events (cycle_id);
CREATE INDEX IF NOT EXISTS ngrp_audit_events_candidate_idx ON public.ngrp_audit_events (candidate_id);

-- ── updated_at maintenance (reuses the applied foundation function) ─────────
DROP TRIGGER IF EXISTS ngrp_cycle_units_touch ON public.ngrp_cycle_units;
CREATE TRIGGER ngrp_cycle_units_touch
  BEFORE UPDATE ON public.ngrp_cycle_units
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_transition_assignments_touch ON public.ngrp_transition_assignments;
CREATE TRIGGER ngrp_transition_assignments_touch
  BEFORE UPDATE ON public.ngrp_transition_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_transition_drafts_touch ON public.ngrp_transition_drafts;
CREATE TRIGGER ngrp_transition_drafts_touch
  BEFORE UPDATE ON public.ngrp_transition_drafts
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

-- ── Server-only privileges: RLS on, NO policies, explicit minimal grants ────
ALTER TABLE public.ngrp_cycle_units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_drafts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_revisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_candidate_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_audit_events           ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ngrp_cycle_units            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_tokens      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_drafts      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_revisions   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_candidate_requirements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_audit_events           FROM PUBLIC, anon, authenticated;

-- Minimal, per-table, and durable-record-safe: no DELETE on assignments or
-- tokens, and revisions/audit rows can only ever be SELECTed and INSERTed.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_cycle_units            TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.ngrp_transition_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.ngrp_transition_tokens      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_transition_drafts      TO service_role;
GRANT SELECT, INSERT                 ON public.ngrp_transition_revisions   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_candidate_requirements TO service_role;
GRANT SELECT, INSERT                 ON public.ngrp_audit_events           TO service_role;

COMMENT ON TABLE public.ngrp_cycle_units IS
  'Participating units per residency cohort - the only source of Transition '
  'Form ranked preferences. unit_name text mirrors app-wide unit naming; no '
  'second unit directory. Server-only.';
COMMENT ON TABLE public.ngrp_transition_assignments IS
  'One Transition Form assignment per candidate attempt, created only by a '
  'successful send. Lifecycle: sent → opened → in_progress → submitted → '
  'revised, with DB-enforced timestamp coherence. Server-only; no DELETE.';
COMMENT ON TABLE public.ngrp_transition_tokens IS
  'Keyed hashes of secure form links plus a nonsecret support prefix. Raw '
  'tokens are never stored. At most one unrevoked token per assignment; '
  'resend revokes first. Server-only; no DELETE.';
COMMENT ON TABLE public.ngrp_transition_drafts IS
  'The single mutable autosave draft per assignment. Ephemeral by design.';
COMMENT ON TABLE public.ngrp_transition_revisions IS
  'Immutable submitted Transition Form revisions, numbered per assignment. '
  'The highest number is the submission of record. No UPDATE or DELETE '
  'privilege exists for any role.';
COMMENT ON TABLE public.ngrp_candidate_requirements IS
  'Explainable per-rule eligibility results (code/status/detail/deadline), '
  'derived from the latest revision + cycle configuration; recalculated, '
  'never authored by hand.';
COMMENT ON TABLE public.ngrp_audit_events IS
  'Allowlisted NGRP workflow audit trail with minimal safe metadata. No '
  'foreign keys on purpose: audit rows outlive whatever they describe. '
  'Insert-only.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── VERIFICATION (run after COMMIT; expect the stated values) ───────────────
-- V1. Structure (one row):
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                          'ngrp_transition_tokens','ngrp_transition_drafts',
--                          'ngrp_transition_revisions','ngrp_candidate_requirements',
--                          'ngrp_audit_events'))                                        AS tables_created,  -- 7
--   (SELECT bool_and(relrowsecurity) FROM pg_class
--     WHERE relname IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                       'ngrp_transition_tokens','ngrp_transition_drafts',
--                       'ngrp_transition_revisions','ngrp_candidate_requirements',
--                       'ngrp_audit_events'))                                           AS rls_enabled,     -- t
--   (SELECT count(*) FROM pg_policies WHERE tablename LIKE 'ngrp_%')                    AS policy_count,    -- 0
--   (SELECT count(*) FROM pg_trigger
--     WHERE tgname IN ('ngrp_cycle_units_touch','ngrp_transition_assignments_touch',
--                      'ngrp_transition_drafts_touch'))                                 AS trigger_count,   -- 3
--   (SELECT count(*) FROM public.ngrp_cycle_units)
--   + (SELECT count(*) FROM public.ngrp_transition_assignments)
--   + (SELECT count(*) FROM public.ngrp_transition_tokens)
--   + (SELECT count(*) FROM public.ngrp_transition_drafts)
--   + (SELECT count(*) FROM public.ngrp_transition_revisions)
--   + (SELECT count(*) FROM public.ngrp_candidate_requirements)
--   + (SELECT count(*) FROM public.ngrp_audit_events)                                   AS total_rows;      -- 0
--
-- V2. ACTUAL privileges (seven rows; anon/auth all f; service_role columns
--     exactly as commented):
-- SELECT t.table_name,
--   has_table_privilege('anon',          format('public.%I', t.table_name), 'SELECT') AS anon_select,   -- f
--   has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT') AS auth_select,   -- f
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'SELECT') AS svc_select,    -- t
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'INSERT') AS svc_insert,    -- t
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'UPDATE') AS svc_update,    -- t except revisions/audit (f)
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'DELETE') AS svc_delete     -- t only for cycle_units/drafts/requirements
-- FROM (VALUES ('ngrp_cycle_units'),('ngrp_transition_assignments'),
--              ('ngrp_transition_tokens'),('ngrp_transition_drafts'),
--              ('ngrp_transition_revisions'),('ngrp_candidate_requirements'),
--              ('ngrp_audit_events')) AS t(table_name);
--
-- VERIFICATION MUST RETURN ROWS: if either SELECT returns no row or errors,
-- the migration did not apply as intended - stop and report.

-- ── ROLLBACK (last resort; NEVER destroys submitted form or audit data) ─────
-- Once ANY row exists in ngrp_transition_revisions or ngrp_audit_events,
-- prefer disabling the endpoints over dropping tables. If a structural
-- rollback is unavoidable, EXPORT ngrp_transition_revisions and
-- ngrp_audit_events (CSV from the SQL editor) FIRST, then:
-- BEGIN;
-- DROP TABLE IF EXISTS public.ngrp_candidate_requirements;
-- DROP TABLE IF EXISTS public.ngrp_transition_drafts;
-- DROP TABLE IF EXISTS public.ngrp_transition_revisions;   -- only after export
-- DROP TABLE IF EXISTS public.ngrp_transition_tokens;
-- DROP TABLE IF EXISTS public.ngrp_transition_assignments;
-- DROP TABLE IF EXISTS public.ngrp_cycle_units;
-- DROP TABLE IF EXISTS public.ngrp_audit_events;           -- only after export
-- COMMIT;
-- (The foundation tables, the shared touch function, and every legacy object
-- are untouched by both apply and rollback.)
