-- =============================================================================
-- PRECEPTOR-CERT-1: Certificate of Appreciation foundation for ASPIRE preceptors
-- Migration: 20260811000000_preceptor_certificate_foundation
--
-- *** STATUS: APPLIED MANUALLY by the Owner in the Supabase SQL editor on   ***
-- *** 2026-08-10, one transaction. VERIFICATION V1-V6 PASSED, including      ***
-- *** preceptor_certificate_sequences seeded at (2026, 1) and the student    ***
-- *** certificate_sequences counter confirmed untouched.                     ***
--
-- WHAT THIS CREATES (and the reasoning it froze):
--   (1) preceptor_certificates - metadata only, one row per (preceptor, cohort).
--       Generated PDFs are NEVER persisted (house rule shared with the student
--       Certificate of Participation): the PDF is rendered on demand from the
--       blank template plus this metadata.
--   (2) preceptor_certificate_sequences - the preceptor series' own per-year
--       counter (next_seq = NEXT number to assign; new years start at 1).
--   (3) issue_preceptor_certificate(p_assignment_id) - the ONLY writer.
--       Atomic, idempotent, SECURITY DEFINER, service-role execution only.
--
-- CANONICAL UNLOCK RULE (Owner decision 2026-08-10): the preceptor who is the
-- SNAPSHOTTED respondent (evaluation_assignments.respondent_preceptor_id) on a
-- COMPLETED End-of-Rotation Preceptor Student Readiness Assessment earns the
-- certificate. That may be the Primary or an Owner-redirected active assigned
-- preceptor (PRECEPTOR-ROUTE-1) - the snapshot, not the current assignment, is
-- authoritative, so later reassignment never changes who earned it.
--
-- IDENTITY / IDEMPOTENCY: UNIQUE (preceptor_id, cohort_id) - one Certificate of
-- Appreciation per preceptor per cohort. Under the canonical program structure
-- (one preceptor serves at most one student per cohort) this is equivalent to
-- one-per-completed-assessment; if data ever carries a second completed
-- assessment for the same preceptor+cohort (e.g. via redirects), the second
-- completion attaches to the existing certificate (status 'already_issued')
-- rather than minting a duplicate. UNIQUE (qualifying_assignment_id) also
-- holds, so one assessment can never justify two certificates.
--
-- NUMBERING (Owner correction 2026-08-10): preceptor certificates carry their
-- OWN annual series, independent of the student certificate_sequences counter.
-- The first-ever preceptor certificate is ASPIRE-2026-01, then -02, resetting
-- each January (first 2027 -> ASPIRE-2027-01). Two-digit padding that grows
-- naturally at 100. Because the student series uses the same displayed format,
-- a displayed Certificate ID is NOT globally unique across certificate types -
-- uniqueness is guaranteed WITHIN the preceptor series (uq_prec_cert_number)
-- and within the student series, never across them.
--
-- SECURITY: RLS enabled with NO policies (service-role only), matching the
-- certificates table. anon/authenticated/PUBLIC hold zero privileges on the
-- table and cannot execute the RPC.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) preceptor_certificates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preceptor_certificates (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who earned it. ON DELETE RESTRICT mirrors student_preceptor_assignments:
  -- a preceptor with recognition history cannot be hard-deleted out of it.
  preceptor_id              uuid        NOT NULL REFERENCES public.preceptors(id) ON DELETE RESTRICT,
  cohort_id                 uuid        NOT NULL REFERENCES public.cohorts(id),

  -- The completed End-of-Rotation assessment that unlocked it. Display fields
  -- (rotation dates, subject student's rotation window) resolve through this
  -- assignment at render time; the database stays the single source of truth.
  qualifying_assignment_id  uuid        NOT NULL REFERENCES public.evaluation_assignments(id),

  certificate_number        text        NOT NULL,
  certificate_year          integer     NOT NULL,
  certificate_sequence      integer     NOT NULL,

  -- When the qualifying assessment was completed / when the certificate
  -- unlocked. issue_date on the PDF renders from certificate_unlocked_at.
  assessment_completed_at   timestamptz NOT NULL,
  certificate_unlocked_at   timestamptz NOT NULL DEFAULT now(),

  -- Set ONLY after the certificate-ready email actually sent (claim-first:
  -- the sender claims the row with a conditional update before sending, so
  -- the notification can never be delivered twice). NULL = owed; the
  -- reconciliation pass finds and retries these.
  notified_at               timestamptz,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_prec_cert_identity    UNIQUE (preceptor_id, cohort_id),
  CONSTRAINT uq_prec_cert_assignment  UNIQUE (qualifying_assignment_id),
  CONSTRAINT uq_prec_cert_number     UNIQUE (certificate_number),
  CONSTRAINT uq_prec_cert_year_seq    UNIQUE (certificate_year, certificate_sequence),
  CONSTRAINT chk_prec_cert_sequence_range CHECK (certificate_sequence BETWEEN 1 AND 999)
);

COMMENT ON TABLE public.preceptor_certificates IS
  'Certificate of Appreciation metadata (one per preceptor per cohort). Identity and number only; generated PDFs are NEVER persisted. Rows are created only by issue_preceptor_certificate() after a completed End-of-Rotation preceptor_progress assessment. The earning preceptor is the assignment''s SNAPSHOTTED respondent_preceptor_id (primary or Owner-redirected), never the student''s current assignment.';
COMMENT ON COLUMN public.preceptor_certificates.notified_at IS
  'Timestamp the certificate-ready email was claimed for sending (conditional update WHERE notified_at IS NULL before the send; reset on send failure). NULL means the notification is owed and reconciliation will retry. Guarantees at-most-one certificate-ready email.';
COMMENT ON CONSTRAINT uq_prec_cert_identity ON public.preceptor_certificates IS
  'One Certificate of Appreciation per preceptor per cohort. A second completed assessment for the same pair returns the existing certificate (already_issued) instead of a duplicate.';

CREATE INDEX IF NOT EXISTS idx_prec_cert_unlocked_at
  ON public.preceptor_certificates (certificate_unlocked_at);
-- Reconciliation scan: unlocked-but-unnotified rows.
CREATE INDEX IF NOT EXISTS idx_prec_cert_unnotified
  ON public.preceptor_certificates (notified_at) WHERE notified_at IS NULL;

ALTER TABLE public.preceptor_certificates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.preceptor_certificates FROM PUBLIC;
REVOKE ALL ON public.preceptor_certificates FROM anon;
REVOKE ALL ON public.preceptor_certificates FROM authenticated;

-- Shared updated_at trigger convention: public.update_updated_at_column().
DROP TRIGGER IF EXISTS set_updated_at_preceptor_certificates ON public.preceptor_certificates;
CREATE TRIGGER set_updated_at_preceptor_certificates
  BEFORE UPDATE ON public.preceptor_certificates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- (2) preceptor_certificate_sequences: the preceptor series' own per-year
--     counter. SEMANTICS mirror certificate_sequences: next_seq stores the
--     NEXT number to assign. No preceptor certificate has ever been issued,
--     so 2026 seeds at 1 -> the first is ASPIRE-2026-01. New years auto-start
--     at 1. Service-role only; never client-readable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preceptor_certificate_sequences (
  year        integer     PRIMARY KEY,
  next_seq    integer     NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.preceptor_certificate_sequences IS
  'Per-calendar-year Certificate of Appreciation counter for PRECEPTOR certificates - independent of the student certificate_sequences counter by Owner decision (2026-08-10). next_seq is the NEXT sequence to assign; 2026 seeds at 1 (first = ASPIRE-2026-01) and new years auto-start at 1. Written only by issue_preceptor_certificate() under a row lock; service-role only.';

INSERT INTO public.preceptor_certificate_sequences (year, next_seq)
VALUES (2026, 1)
ON CONFLICT (year) DO NOTHING;

ALTER TABLE public.preceptor_certificate_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preceptor_certificate_sequences FROM PUBLIC;
REVOKE ALL ON public.preceptor_certificate_sequences FROM anon;
REVOKE ALL ON public.preceptor_certificate_sequences FROM authenticated;

DROP TRIGGER IF EXISTS set_updated_at_preceptor_certificate_sequences ON public.preceptor_certificate_sequences;
CREATE TRIGGER set_updated_at_preceptor_certificate_sequences
  BEFORE UPDATE ON public.preceptor_certificate_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- (3) issue_preceptor_certificate(p_assignment_id): atomic, idempotent issuer.
--     Mirrors issue_participation_certificate()'s lock discipline against the
--     preceptor series' OWN counter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_preceptor_certificate(
  p_assignment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_assignment public.evaluation_assignments%ROWTYPE;
  v_inst_slug  TEXT;
  v_inst_perm  TEXT;
  v_existing   public.preceptor_certificates%ROWTYPE;
  v_year       INTEGER;
  v_seq        INTEGER;
  v_number     TEXT;
  v_cert_id    UUID;
  v_now        TIMESTAMPTZ := now();
BEGIN
  -- Lock the assignment.
  SELECT * INTO v_assignment
  FROM public.evaluation_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'assignment_not_found');
  END IF;

  -- Never issue before verified completion.
  IF v_assignment.completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_completed');
  END IF;

  -- End-of-Rotation only; the preceptor must be the respondent.
  IF v_assignment.timepoint IS DISTINCT FROM 'post_rotation'
     OR v_assignment.respondent_type IS DISTINCT FROM 'preceptor' THEN
    RETURN jsonb_build_object('status', 'wrong_timepoint_or_respondent');
  END IF;

  -- The snapshotted respondent identity is the earner. A NULL snapshot (legacy
  -- free-text send) has no canonical identity to certify - a recoverable
  -- exception for the Owner, never a guessed certificate.
  IF v_assignment.respondent_preceptor_id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_canonical_respondent');
  END IF;

  -- Verify the instrument is the authorized readiness assessment.
  SELECT slug, permission_status INTO v_inst_slug, v_inst_perm
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;
  IF NOT FOUND
     OR v_inst_slug IS DISTINCT FROM 'preceptor_progress'
     OR v_inst_perm IS DISTINCT FROM 'authorized' THEN
    RETURN jsonb_build_object('status', 'wrong_instrument');
  END IF;

  -- Idempotency 1: this assessment already unlocked a certificate.
  SELECT * INTO v_existing
  FROM public.preceptor_certificates
  WHERE qualifying_assignment_id = p_assignment_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_issued',
      'certificate_id', v_existing.id,
      'certificate_number', v_existing.certificate_number,
      'certificate_unlocked_at', v_existing.certificate_unlocked_at,
      'notified_at', v_existing.notified_at
    );
  END IF;

  -- Idempotency 2: one certificate per (preceptor, cohort) - a second
  -- completed assessment for the same pair attaches to the existing one.
  SELECT * INTO v_existing
  FROM public.preceptor_certificates
  WHERE preceptor_id = v_assignment.respondent_preceptor_id
    AND cohort_id    = v_assignment.cohort_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_issued',
      'certificate_id', v_existing.id,
      'certificate_number', v_existing.certificate_number,
      'certificate_unlocked_at', v_existing.certificate_unlocked_at,
      'notified_at', v_existing.notified_at
    );
  END IF;

  -- Certificate year = the year the assessment was completed.
  v_year := EXTRACT(YEAR FROM v_assignment.completed_at)::INTEGER;

  -- The preceptor series' OWN per-year counter, same lock discipline as the
  -- student RPC: ensure the year row exists, lock it, bound-check BEFORE
  -- advancing, then advance. Independent of certificate_sequences.
  INSERT INTO public.preceptor_certificate_sequences (year, next_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO NOTHING;

  SELECT next_seq INTO v_seq
  FROM public.preceptor_certificate_sequences
  WHERE year = v_year
  FOR UPDATE;

  IF v_seq > 999 THEN
    RETURN jsonb_build_object('status', 'sequence_exhausted', 'year', v_year);
  END IF;

  UPDATE public.preceptor_certificate_sequences
  SET next_seq = v_seq + 1, updated_at = v_now
  WHERE year = v_year;

  -- Two-digit padding (ASPIRE-2026-01), growing naturally at 100. NOTE:
  -- Postgres lpad TRUNCATES beyond its length argument, so the width is
  -- computed - lpad(v_seq, 2) would corrupt 100 into '10'.
  v_number := 'ASPIRE-' || v_year::TEXT || '-'
    || lpad(v_seq::TEXT, GREATEST(2, length(v_seq::TEXT)), '0');

  INSERT INTO public.preceptor_certificates (
    preceptor_id, cohort_id, qualifying_assignment_id,
    certificate_number, certificate_year, certificate_sequence,
    assessment_completed_at, certificate_unlocked_at
  ) VALUES (
    v_assignment.respondent_preceptor_id, v_assignment.cohort_id, p_assignment_id,
    v_number, v_year, v_seq,
    v_assignment.completed_at, v_now
  ) RETURNING id INTO v_cert_id;

  RETURN jsonb_build_object(
    'status', 'issued',
    'certificate_id', v_cert_id,
    'certificate_number', v_number,
    'certificate_unlocked_at', v_now,
    'notified_at', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.issue_preceptor_certificate(UUID) IS
  'Atomic, idempotent issuance of the Certificate of Appreciation from a completed End-of-Rotation preceptor_progress assessment. Earner = the assignment''s snapshotted respondent_preceptor_id. Draws numbers from the preceptor series'' OWN annual counter (preceptor_certificate_sequences) under FOR UPDATE: first 2026 certificate = ASPIRE-2026-01, resetting each January. Displayed IDs are unique within the preceptor series, not across certificate types. Re-invocation, a replayed submission, or a second qualifying assessment for the same (preceptor, cohort) returns the existing certificate. Service-role execution only.';

REVOKE ALL ON FUNCTION public.issue_preceptor_certificate(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_preceptor_certificate(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.issue_preceptor_certificate(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.issue_preceptor_certificate(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
-- V1. Table exists with RLS enabled and no policies:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.preceptor_certificates'::regclass;  -- t
--   SELECT count(*) FROM pg_policies WHERE tablename = 'preceptor_certificates';                -- 0
--
-- V2. No client privileges:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'preceptor_certificates'
--     AND grantee IN ('anon', 'authenticated', 'PUBLIC');                                       -- 0 rows
--
-- V3. Constraints present:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.preceptor_certificates'::regclass
--   ORDER BY conname;
--   -- expect: chk_prec_cert_sequence_range, uq_prec_cert_assignment,
--   --         uq_prec_cert_identity, uq_prec_cert_number, uq_prec_cert_year_seq (+ PK/FKs)
--
-- V4. RPC executable by service_role only:
--   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--   WHERE routine_name = 'issue_preceptor_certificate';
--   -- expect: service_role EXECUTE only (postgres/definer aside)
--
-- V5. Counters: the preceptor series seeds 2026 at 1; the STUDENT counter is
--     untouched by this migration:
--   SELECT year, next_seq FROM public.preceptor_certificate_sequences ORDER BY year;
--   -- expect: (2026, 1)
--   SELECT year, next_seq FROM public.certificate_sequences ORDER BY year;
--   -- expect: unchanged from before this migration
--
-- V6. Dry idempotency probe (safe: uses a nonexistent id, writes nothing):
--   SELECT public.issue_preceptor_certificate('00000000-0000-0000-0000-000000000000');
--   -- expect: {"status": "assignment_not_found"}
-- =============================================================================
