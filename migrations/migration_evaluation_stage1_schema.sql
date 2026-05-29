-- migration_evaluation_stage1_schema.sql
-- Stage 1: Evaluation MVP schema migration (Revision 4).
-- Creates evaluation_instruments, evaluation_assignments, evaluation_assignment_tokens,
-- evaluation_responses, evaluation_reminders, supporting indexes, RLS policies, and the
-- Casey-Fink instrument registry row.
--
-- Privilege posture is fully explicit. Each table receives REVOKE ALL FROM PUBLIC, anon,
-- authenticated, then narrow GRANT to authenticated where appropriate, then GRANT ALL
-- PRIVILEGES to service_role. authenticated Owner/Admin receives SELECT only on the read
-- surfaces, each gated by RLS. authenticated has zero direct privileges on
-- evaluation_assignment_tokens. State-changing actions are added in later stages through
-- narrowly scoped server-side endpoints or SECURITY DEFINER RPCs.
--
-- Database-level invariants:
--   chk_instrument_authorized_documented enforces that permission_status = 'authorized'
--     requires permission_documented_at IS NOT NULL and a non-empty permission_reference.
--   chk_assignment_send_state enforces that any non-draft assignment status requires
--     invited_at, sent_at, expires_at, and approved_hours_at_invitation to all be NOT
--     NULL.
--   chk_approved_hours_at_invitation_nonnegative and
--     chk_approved_hours_at_completion_nonnegative reject negative approved-hour values
--     in either snapshot column.
--   uq_assignment_identity is a composite UNIQUE on (id, instrument_id, student_id,
--     cohort_id, timepoint) on evaluation_assignments. Its sole purpose is to enable the
--     composite foreign key on evaluation_responses below.
--   fk_response_assignment_identity is a composite FOREIGN KEY on evaluation_responses
--     mapping (assignment_id, instrument_id, student_id, cohort_id, timepoint) to the
--     corresponding columns on evaluation_assignments. The denormalized identity columns
--     on responses are retained for reporting efficiency; the composite FK ensures they
--     cannot diverge from the parent assignment.
--   chk_responses_is_object enforces that the responses jsonb column holds a JSON
--     object, not an array, scalar, or JSON null.
--   uq_assignment_reminder_day prevents duplicate day-7, day-14, or day-21 reminders for
--     the same assignment.
--   CHECK constraints on evaluation_responses.score_s1_* bound each cached Section I
--     subscale mean to NULL or 1.000-4.000.
--
-- MVP send workflow: the server-side send endpoint inserts the assignment row directly
-- at status = 'sent' with invited_at = now(), sent_at = now(), expires_at = sent_at +
-- interval '28 days', approved_hours_at_invitation captured from students.approved_hours
-- at send time, and the derived timepoint label (baseline if approved_hours_at_invitation
-- = 0, else early_rotation_baseline). The token row is inserted in the same atomic
-- operation. The draft state is reserved for potential future UI workflows; the MVP
-- does not exercise it.
--
-- Section I subscale means are cached as explicit numeric columns on evaluation_responses
-- (Clinical Problem-Solving 6 items, Learning Activities 5 items, Practice Readiness
-- 4 items). Section II (confidence by patient-assignment size, scale 1-5) and Section III
-- (learning needs by skill, scale 1-3) responses live in responses jsonb and are
-- aggregated at read time in a later reporting stage so item-level reporting is
-- preserved per Casey-Fink scoring guidance.
--
-- Token records do not store any portion of the raw token. token_hash_prefix stores the
-- first eight characters of the HMAC-SHA256 hash for audit and support correlation.
--
-- The aggregate score view evaluation_cohort_score_summary is deferred. The sanitized
-- token RPC is deferred until a UI surface requires it.
--
-- Stage 1 stores structural item codes, score-range metadata, and subscale mapping
-- references only. Stage 1 does not store exact instrument item prose, response-anchor
-- wording, section instructions, or formatted student-facing survey content. Live
-- administration and any future scoring implementation remain governed by the documented
-- permission/authorization for instrument use referenced via permission_reference.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- (1) evaluation_instruments
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.evaluation_instruments (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     TEXT        NOT NULL UNIQUE,
  display_name             TEXT        NOT NULL,
  version                  TEXT        NOT NULL,
  copyright_holder         TEXT        NOT NULL,
  copyright_year           INTEGER     NOT NULL,
  permission_status        TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (permission_status IN ('pending', 'authorized', 'expired')),
  permission_documented_at TIMESTAMPTZ,
  permission_reference     TEXT,
  scoring_config_ref       TEXT,
  items_content_ref        TEXT,
  last_reviewed_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_instrument_authorized_documented
    CHECK (
      permission_status <> 'authorized'
      OR (
        permission_documented_at IS NOT NULL
        AND permission_reference IS NOT NULL
        AND trim(permission_reference) <> ''
      )
    )
);

COMMENT ON COLUMN public.evaluation_instruments.permission_reference IS
  'Documentation of authorization to administer this instrument (e.g., SharePoint URL, signed PDF reference, vendor portal record). Populated when permission_status is promoted to authorized. Distinct from items_content_ref.';
COMMENT ON COLUMN public.evaluation_instruments.items_content_ref IS
  'Runtime source pointer for authorized survey item text and response anchors. The storage mechanism (private Supabase Storage object, Vercel Blob, dedicated table row, or other) is selected when the runtime content loader is implemented in a later stage. Stage 1 leaves this NULL. Distinct from permission_reference.';
COMMENT ON COLUMN public.evaluation_instruments.scoring_config_ref IS
  'Reference to the structural scoring configuration: item codes, score-range metadata, and subscale mapping references. Stage 1 does not store exact instrument item prose, response-anchor wording, section instructions, or formatted student-facing survey content. Live administration and any future scoring implementation remain governed by the documented permission/authorization for instrument use referenced via permission_reference.';
COMMENT ON CONSTRAINT chk_instrument_authorized_documented ON public.evaluation_instruments IS
  'Database-level invariant: an instrument cannot have permission_status = authorized without a non-NULL permission_documented_at and a non-empty permission_reference. Defense-in-depth complement to the API/UI permission gate.';

INSERT INTO public.evaluation_instruments
  (slug, display_name, version, copyright_holder, copyright_year, permission_status)
VALUES
  ('casey_fink_readiness_2024',
   'Casey-Fink Readiness for Practice Survey',
   '2024-revised',
   'Casey & Fink',
   2024,
   'pending');

-- ────────────────────────────────────────────────────────────────
-- (2) evaluation_assignments
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.evaluation_assignments (
  id                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id                 UUID         NOT NULL REFERENCES public.evaluation_instruments(id),
  student_id                    UUID         NOT NULL REFERENCES public.students(id),
  cohort_id                     UUID         NOT NULL REFERENCES public.cohorts(id),
  timepoint                     TEXT         NOT NULL
                                CHECK (timepoint IN (
                                  'baseline', 'early_rotation_baseline',
                                  'midpoint', 'post_rotation', 'custom'
                                )),
  assigned_by                   UUID         NOT NULL REFERENCES public.user_profiles(id),
  invited_at                    TIMESTAMPTZ,
  sent_at                       TIMESTAMPTZ,
  opened_at                     TIMESTAMPTZ,
  completed_at                  TIMESTAMPTZ,
  reopened_at                   TIMESTAMPTZ,
  status                        TEXT         NOT NULL DEFAULT 'draft'
                                CHECK (status IN (
                                  'draft', 'sent', 'opened', 'completed',
                                  'reminder_due', 'non_responder', 'expired', 'revoked'
                                )),
  expires_at                    TIMESTAMPTZ,
  revoked_at                    TIMESTAMPTZ,
  approved_hours_at_invitation  NUMERIC(6,2),
  approved_hours_at_completion  NUMERIC(6,2),
  notes                         TEXT,
  created_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_assignment
    UNIQUE (instrument_id, student_id, cohort_id, timepoint),
  CONSTRAINT uq_assignment_identity
    UNIQUE (id, instrument_id, student_id, cohort_id, timepoint),
  CONSTRAINT chk_assignment_send_state
    CHECK (
      status = 'draft'
      OR (
        invited_at IS NOT NULL
        AND sent_at IS NOT NULL
        AND expires_at IS NOT NULL
        AND approved_hours_at_invitation IS NOT NULL
      )
    ),
  CONSTRAINT chk_approved_hours_at_invitation_nonnegative
    CHECK (
      approved_hours_at_invitation IS NULL
      OR approved_hours_at_invitation >= 0
    ),
  CONSTRAINT chk_approved_hours_at_completion_nonnegative
    CHECK (
      approved_hours_at_completion IS NULL
      OR approved_hours_at_completion >= 0
    )
);

COMMENT ON COLUMN public.evaluation_assignments.assigned_by IS
  'user_profiles.id of the Owner/Admin who created the assignment. The server-side send endpoint MUST resolve auth.users.id to user_profiles.id and fail before insert if no profile is found. Do not store auth.users.id here.';
COMMENT ON COLUMN public.evaluation_assignments.status IS
  'Lifecycle state. draft: assignment row exists with no send metadata; not exercised by the MVP send workflow, reserved for future UI work. sent: live invitation delivered, response window active. opened: student loaded the validate endpoint. completed: submission accepted and locked. reminder_due: cron flag. non_responder: no submission within the response window (recorded at day 28). expired: administrative or token-related expiration. revoked: explicit Owner action. The chk_assignment_send_state constraint enforces that all non-draft rows have complete send metadata and an approved-hours snapshot.';
COMMENT ON COLUMN public.evaluation_assignments.expires_at IS
  'Authoritative response-window cutoff. NULL while status = draft. The server-side send action atomically inserts the row with status = sent, populates invited_at and sent_at, and sets expires_at = sent_at + interval ''28 days''. The atomic submit operation enforces this column as the policy cutoff independently of token expiry. The chk_assignment_send_state constraint enforces non-NULL for all non-draft statuses.';
COMMENT ON COLUMN public.evaluation_assignments.approved_hours_at_invitation IS
  'students.approved_hours snapshot captured at successful invitation send time. NULL while status = draft. Required (enforced by chk_assignment_send_state) for all sent-or-later states. Used by the send endpoint to derive the final stored timepoint label (baseline vs early_rotation_baseline) before activating the invitation. In the MVP send workflow, the assignment row is inserted at status = sent with this column populated atomically. chk_approved_hours_at_invitation_nonnegative rejects negative values.';
COMMENT ON COLUMN public.evaluation_assignments.approved_hours_at_completion IS
  'students.approved_hours snapshot captured at successful submission time. NULL until submission. chk_approved_hours_at_completion_nonnegative rejects negative values.';
COMMENT ON CONSTRAINT uq_assignment ON public.evaluation_assignments IS
  'MVP supports a single response per (instrument, student, cohort, timepoint). cohort_id is included so a student record reused or associated across cohorts does not have legitimate future assignments blocked. A reopen workflow added in a later stage will require addressing this constraint together with the UNIQUE on evaluation_responses.assignment_id.';
COMMENT ON CONSTRAINT uq_assignment_identity ON public.evaluation_assignments IS
  'Composite UNIQUE on the assignment identity columns. Exists solely to enable the composite foreign key fk_response_assignment_identity on evaluation_responses; PostgreSQL requires a UNIQUE or PRIMARY KEY on the referenced column set, and the primary key on id alone is too narrow.';
COMMENT ON CONSTRAINT chk_assignment_send_state ON public.evaluation_assignments IS
  'Database-level invariant: any non-draft assignment must have invited_at, sent_at, expires_at, and approved_hours_at_invitation populated. The MVP send endpoint inserts rows directly at status = sent with all four fields set atomically; the draft state is reserved for future UI workflows.';

CREATE INDEX idx_assignments_student ON public.evaluation_assignments(student_id);
CREATE INDEX idx_assignments_cohort  ON public.evaluation_assignments(cohort_id);
CREATE INDEX idx_assignments_status  ON public.evaluation_assignments(status);

-- ────────────────────────────────────────────────────────────────
-- (3) evaluation_assignment_tokens
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.evaluation_assignment_tokens (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         UUID        NOT NULL REFERENCES public.evaluation_assignments(id),
  token_hash            TEXT        NOT NULL UNIQUE,
  token_hash_prefix     TEXT,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  used_at               TIMESTAMPTZ,
  ip_used_first         TEXT,
  user_agent_used_first TEXT
);

COMMENT ON COLUMN public.evaluation_assignment_tokens.token_hash IS
  'HMAC-SHA256 hex digest of the raw token computed with the EVALUATION_TOKEN_PEPPER server-side secret. The raw token is never stored. Token lookup is by token_hash only.';
COMMENT ON COLUMN public.evaluation_assignment_tokens.token_hash_prefix IS
  'First eight characters of token_hash (a derivative of the HMAC digest, NOT the raw token). Used for audit and support correlation. The raw token never appears in any table, audit row, log metadata, or persisted communication record.';
COMMENT ON COLUMN public.evaluation_assignment_tokens.expires_at IS
  'Token security expiry. Live workflow: tokens are generated as part of the send action only, with expires_at set to assignment.expires_at + interval ''2 days''. QA workflow: tokens against non-production data use a QA-specific expiry (e.g., a short test window) and do not establish the live assignment response window. The atomic submit operation independently enforces assignment.expires_at as the policy cutoff.';
COMMENT ON TABLE public.evaluation_assignment_tokens IS
  'Token metadata. Direct client access is disallowed: authenticated and anon have zero privileges on this table. Only service_role accesses it via the /api/evaluation-* endpoints. Owner/Admin UI visibility into sanitized token state (omitting token_hash) is provided through assignment lifecycle fields on evaluation_assignments; a sanitized RPC or view may be added in a later stage if a specific UI surface requires it.';

CREATE INDEX idx_tokens_hash       ON public.evaluation_assignment_tokens(token_hash);
CREATE INDEX idx_tokens_assignment ON public.evaluation_assignment_tokens(assignment_id);

-- ────────────────────────────────────────────────────────────────
-- (4) evaluation_responses
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.evaluation_responses (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id                     UUID        NOT NULL UNIQUE,
  instrument_id                     UUID        NOT NULL REFERENCES public.evaluation_instruments(id),
  student_id                        UUID        NOT NULL REFERENCES public.students(id),
  cohort_id                         UUID        NOT NULL REFERENCES public.cohorts(id),
  timepoint                         TEXT        NOT NULL,
  form_type                         TEXT        NOT NULL,
  responses                         JSONB       NOT NULL,
  score_s1_clinical_problem_solving NUMERIC(5,3)
    CHECK (score_s1_clinical_problem_solving IS NULL
           OR score_s1_clinical_problem_solving BETWEEN 1.000 AND 4.000),
  score_s1_learning_activities      NUMERIC(5,3)
    CHECK (score_s1_learning_activities IS NULL
           OR score_s1_learning_activities BETWEEN 1.000 AND 4.000),
  score_s1_practice_readiness       NUMERIC(5,3)
    CHECK (score_s1_practice_readiness IS NULL
           OR score_s1_practice_readiness BETWEEN 1.000 AND 4.000),
  submitted_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_submitted                      TEXT,
  user_agent                        TEXT,
  locked_at                         TIMESTAMPTZ,
  CONSTRAINT fk_response_assignment_identity
    FOREIGN KEY (assignment_id, instrument_id, student_id, cohort_id, timepoint)
    REFERENCES public.evaluation_assignments
      (id, instrument_id, student_id, cohort_id, timepoint),
  CONSTRAINT chk_responses_is_object
    CHECK (jsonb_typeof(responses) = 'object')
);

COMMENT ON COLUMN public.evaluation_responses.responses IS
  'Full raw item response object keyed by item_code, including all Section I, II, III, and IV items. Preserves per-item traceability and revision resilience. Section II (confidence by patient-assignment size, scale 1-5) and Section III (learning needs by skill, scale 1-3) item-level aggregations are computed from this column at read time in a later reporting stage. Section III items with mean < 2 indicate lower confidence per Casey-Fink scoring guidance. chk_responses_is_object enforces JSON object shape.';
COMMENT ON COLUMN public.evaluation_responses.score_s1_clinical_problem_solving IS
  'Cached mean of Section I Clinical Problem-Solving subscale (6 items). Scale 1-4. CHECK constraint bounds value to NULL or 1.000 through 4.000.';
COMMENT ON COLUMN public.evaluation_responses.score_s1_learning_activities IS
  'Cached mean of Section I Learning Activities subscale (5 items). Scale 1-4. CHECK constraint bounds value to NULL or 1.000 through 4.000.';
COMMENT ON COLUMN public.evaluation_responses.score_s1_practice_readiness IS
  'Cached mean of Section I Practice Readiness subscale (4 items). Scale 1-4. CHECK constraint bounds value to NULL or 1.000 through 4.000.';
COMMENT ON COLUMN public.evaluation_responses.locked_at IS
  'Set by the atomic submission operation on successful submission. Future aggregate views will filter on locked_at IS NOT NULL to exclude partial or incomplete rows.';
COMMENT ON CONSTRAINT fk_response_assignment_identity ON public.evaluation_responses IS
  'Composite foreign key ensuring that a response row''s denormalized identity columns (instrument_id, student_id, cohort_id, timepoint) match the assignment row it claims to belong to. The denormalized columns are retained on responses for reporting efficiency; this composite FK guarantees they cannot diverge from the parent assignment. Column-level FKs from evaluation_responses to evaluation_instruments(id), students(id), and cohorts(id) are retained alongside this composite FK for entity-level integrity.';
COMMENT ON CONSTRAINT chk_responses_is_object ON public.evaluation_responses IS
  'Requires the responses jsonb column to hold a JSON object, not an array, scalar, or JSON null. Per Option A storage design, the column is a keyed map from item_code to response value.';

CREATE INDEX idx_responses_cohort_timepoint ON public.evaluation_responses(cohort_id, timepoint);
CREATE INDEX idx_responses_instrument       ON public.evaluation_responses(instrument_id);
CREATE INDEX idx_responses_submitted_at     ON public.evaluation_responses(submitted_at);

-- ────────────────────────────────────────────────────────────────
-- (5) evaluation_reminders (schema only; automation deferred)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.evaluation_reminders (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID         NOT NULL REFERENCES public.evaluation_assignments(id),
  reminder_day    INTEGER      NOT NULL CHECK (reminder_day IN (7, 14, 21)),
  scheduled_at    TIMESTAMPTZ  NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          TEXT         NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'skipped', 'cancelled')),
  resend_email_id TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_assignment_reminder_day UNIQUE (assignment_id, reminder_day)
);

COMMENT ON CONSTRAINT uq_assignment_reminder_day ON public.evaluation_reminders IS
  'Prevents duplicate day-7, day-14, or day-21 reminder rows for the same assignment. Automation that creates and processes reminder rows is deferred to a later stage; the constraint protects the future schedule from accidental duplicates regardless of how those rows are created.';

CREATE INDEX idx_reminders_assignment ON public.evaluation_reminders(assignment_id);
CREATE INDEX idx_reminders_status     ON public.evaluation_reminders(status, scheduled_at);

-- ────────────────────────────────────────────────────────────────
-- Privilege posture: explicit REVOKE and explicit GRANT per table.
-- service_role is granted explicitly on every evaluation_* table.
-- ────────────────────────────────────────────────────────────────

-- evaluation_instruments
ALTER TABLE public.evaluation_instruments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_instruments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_instruments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_instruments TO service_role;
CREATE POLICY "owner_admin_select_instruments"
  ON public.evaluation_instruments FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

-- evaluation_assignments (Stage 1: SELECT only; writes via service_role)
ALTER TABLE public.evaluation_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_assignments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_assignments TO service_role;
CREATE POLICY "owner_admin_select_assignments"
  ON public.evaluation_assignments FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

-- evaluation_assignment_tokens: service_role only. No client privileges. No RLS policies.
ALTER TABLE public.evaluation_assignment_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_assignment_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_assignment_tokens TO service_role;

-- evaluation_responses
ALTER TABLE public.evaluation_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_responses TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_responses TO service_role;
CREATE POLICY "owner_admin_select_responses"
  ON public.evaluation_responses FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

-- evaluation_reminders
ALTER TABLE public.evaluation_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_reminders TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_reminders TO service_role;
CREATE POLICY "owner_admin_select_reminders"
  ON public.evaluation_reminders FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

-- ────────────────────────────────────────────────────────────────
-- Aggregate scoring view: NOT created in Stage 1. Sanitized token RPC:
-- NOT created in Stage 1. Both deferred until later stages.
-- ────────────────────────────────────────────────────────────────

COMMIT;
