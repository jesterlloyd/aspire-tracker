-- =============================================================================
-- ASPIRE Post-Rotation Evaluation and Certificate of Participation - foundation
-- Migration: 20260708000000_postrotation_cert_foundation
-- =============================================================================
--
-- Additive backend foundation for the third Review and Release workflow
-- (Post-Rotation Evaluation and Certificate). This migration:
--   (1) registers the post_rotation_evaluation instrument (reuses
--       evaluation_instruments, evaluation_assignments, and the token
--       infrastructure with NO change to those tables),
--   (2) creates certificate_sequences (per-year counter, service-role only),
--   (3) creates certificates (metadata only; generated PDFs are NOT stored),
--   (4) adds the atomic, idempotent issue_participation_certificate() RPC.
--
-- Certificate numbers (ASPIRE-YYYY-NNN) are assigned ONLY after the student
-- completes the post-rotation evaluation, never at release. Numbering resets
-- each calendar year; 2026 starts at ASPIRE-2026-052; 2027 auto-starts at
-- ASPIRE-2027-001. See the numbering notes on certificate_sequences below.
--
-- Privilege posture mirrors the evaluation_* family: RLS enabled; REVOKE ALL
-- from PUBLIC, anon, authenticated; Owner/Admin SELECT via
-- public.is_owner_or_admin(); all writes via service_role or the SECURITY
-- DEFINER RPC. Students have NO direct DB access; a student downloads only their
-- own unlocked certificate through a tokenized or authenticated service-role
-- endpoint built in a later implementation task.
--
-- HOW TO RUN: paste into the Supabase SQL Editor, execute, verify, THEN record
-- in the repo migration history. Do NOT apply automatically. Idempotent
-- (IF NOT EXISTS, ON CONFLICT DO NOTHING, CREATE OR REPLACE, DROP ... IF EXISTS);
-- safe to re-run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) Register the post_rotation_evaluation instrument.
--     Reuses evaluation_instruments as-is. evaluation_assignments.timepoint
--     already allows 'post_rotation' and uq_assignment already scopes one
--     assignment per student and cohort, so assignments and tokens are reused
--     with zero schema change. ASPIRE authors this instrument, so authorization
--     is internal; the chk_instrument_authorized_documented invariant still
--     requires permission_documented_at and a non-empty permission_reference
--     whenever permission_status = 'authorized', so both are supplied here.
-- ---------------------------------------------------------------------------
INSERT INTO public.evaluation_instruments
  (slug, display_name, version, copyright_holder, copyright_year,
   permission_status, permission_documented_at, permission_reference)
VALUES
  ('post_rotation_evaluation',
   'Post-Rotation Evaluation & Certificate',
   '2026.1',
   'Cedars-Sinai ASPIRE',
   2026,
   'authorized',
   now(),
   'ASPIRE-authored instrument. Internal authorization on file; not a licensed third-party survey.')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (2) certificate_sequences: per-calendar-year counter.
--     SEMANTICS: next_seq stores the NEXT number to assign (not the last
--     issued). Seed 2026 -> 52 so the first 2026 certificate is
--     ASPIRE-2026-052, after which the function advances next_seq to 53. New
--     years auto-start at next_seq = 1 (ASPIRE-YYYY-001). Service-role only;
--     never client-readable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificate_sequences (
  year        integer     PRIMARY KEY,
  next_seq    integer     NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.certificate_sequences IS
  'Per-calendar-year Certificate of Participation counter. next_seq is the NEXT sequence to assign. Seed 2026 at 52 (first = ASPIRE-2026-052). New years auto-start at 1 (ASPIRE-YYYY-001). Written only by issue_participation_certificate() under a row lock; service-role only.';

INSERT INTO public.certificate_sequences (year, next_seq)
VALUES (2026, 52)
ON CONFLICT (year) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (3) certificates: metadata only. Generated PDF bytes are NOT stored; the
--     student PDF is rendered on demand from the blank template plus this
--     metadata.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificates (
  id                                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                            uuid        NOT NULL REFERENCES public.students(id),
  evaluation_assignment_id              uuid        NOT NULL REFERENCES public.evaluation_assignments(id),
  certificate_number                    text        NOT NULL,
  certificate_year                      integer     NOT NULL,
  certificate_sequence                  integer     NOT NULL,
  post_rotation_evaluation_completed_at timestamptz NOT NULL,
  certificate_unlocked_at               timestamptz NOT NULL DEFAULT now(),
  released_by                           uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at                            timestamptz NOT NULL DEFAULT now(),
  updated_at                            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_certificate_number      UNIQUE (certificate_number),
  CONSTRAINT uq_certificate_year_seq    UNIQUE (certificate_year, certificate_sequence),
  CONSTRAINT uq_certificate_assignment  UNIQUE (evaluation_assignment_id),
  CONSTRAINT uq_certificate_student     UNIQUE (student_id),
  CONSTRAINT chk_certificate_sequence_range CHECK (certificate_sequence BETWEEN 1 AND 999)
);

COMMENT ON TABLE public.certificates IS
  'Certificate of Participation metadata (one per student post-rotation completion). Identity and number only; generated PDFs are NEVER persisted. Rows are created only by issue_participation_certificate() after the evaluation is completed. released_by = the Owner/Admin who released the evaluation (evaluation_assignments.assigned_by), not an unlock actor; the student triggers unlock by submitting.';
COMMENT ON COLUMN public.certificates.released_by IS
  'user_profiles.id of the Owner/Admin who manually released the post-rotation evaluation (copied from evaluation_assignments.assigned_by at unlock). ON DELETE SET NULL preserves the certificate if that profile is later removed.';
COMMENT ON CONSTRAINT uq_certificate_student ON public.certificates IS
  'One Certificate of Participation per student for the ASPIRE post-rotation workflow.';

-- student_id, evaluation_assignment_id, certificate_number, and
-- (certificate_year, certificate_sequence) are ALREADY indexed by their UNIQUE
-- constraints; only the lookup-by-unlock index is added here.
CREATE INDEX IF NOT EXISTS idx_certificates_unlocked_at
  ON public.certificates (certificate_unlocked_at);

-- Shared updated_at trigger convention: public.update_updated_at_column().
DROP TRIGGER IF EXISTS set_updated_at_certificates ON public.certificates;
CREATE TRIGGER set_updated_at_certificates
  BEFORE UPDATE ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_certificate_sequences ON public.certificate_sequences;
CREATE TRIGGER set_updated_at_certificate_sequences
  BEFORE UPDATE ON public.certificate_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- (4) Privilege posture and RLS.
-- ---------------------------------------------------------------------------

-- certificates: Owner/Admin SELECT only; all writes via service_role or RPC.
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.certificates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.certificates TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.certificates TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_certificates" ON public.certificates;
CREATE POLICY "owner_admin_select_certificates"
  ON public.certificates FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

-- certificate_sequences: service_role ONLY. Never client-readable. No policy.
ALTER TABLE public.certificate_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.certificate_sequences FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.certificate_sequences TO service_role;

-- ---------------------------------------------------------------------------
-- (5) issue_participation_certificate(): atomic, idempotent number assignment.
--     Verifies the assignment is a COMPLETED post_rotation_evaluation before
--     issuing. Serializes concurrent unlocks on the per-year counter row via
--     SELECT ... FOR UPDATE, so no two certificates share a number. Re-invoking
--     for an already-certified student returns the existing certificate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_participation_certificate(
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
  v_existing   public.certificates%ROWTYPE;
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

  -- Never issue before completion.
  IF v_assignment.completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_completed');
  END IF;

  -- Verify the instrument is the authorized post-rotation evaluation.
  SELECT slug, permission_status INTO v_inst_slug, v_inst_perm
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;
  IF NOT FOUND
     OR v_inst_slug IS DISTINCT FROM 'post_rotation_evaluation'
     OR v_inst_perm IS DISTINCT FROM 'authorized' THEN
    RETURN jsonb_build_object('status', 'wrong_instrument');
  END IF;

  -- Idempotency: one certificate per student for this workflow.
  SELECT * INTO v_existing
  FROM public.certificates
  WHERE student_id = v_assignment.student_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_issued',
      'certificate_number', v_existing.certificate_number,
      'certificate_year', v_existing.certificate_year,
      'certificate_sequence', v_existing.certificate_sequence,
      'certificate_unlocked_at', v_existing.certificate_unlocked_at
    );
  END IF;

  -- Certificate year = the year the student completed the evaluation.
  v_year := EXTRACT(YEAR FROM v_assignment.completed_at)::INTEGER;

  -- Atomic per-year sequence assignment. Ensure the year row exists (new years
  -- start at 1 -> NNN 001), lock it, check the bound BEFORE advancing, then
  -- advance.
  INSERT INTO public.certificate_sequences (year, next_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO NOTHING;

  SELECT next_seq INTO v_seq
  FROM public.certificate_sequences
  WHERE year = v_year
  FOR UPDATE;

  IF v_seq > 999 THEN
    RETURN jsonb_build_object('status', 'sequence_exhausted', 'year', v_year);
  END IF;

  UPDATE public.certificate_sequences
  SET next_seq = v_seq + 1, updated_at = v_now
  WHERE year = v_year;

  v_number := 'ASPIRE-' || v_year::TEXT || '-' || lpad(v_seq::TEXT, 3, '0');

  INSERT INTO public.certificates (
    student_id, evaluation_assignment_id, certificate_number,
    certificate_year, certificate_sequence,
    post_rotation_evaluation_completed_at, certificate_unlocked_at, released_by
  ) VALUES (
    v_assignment.student_id, p_assignment_id, v_number,
    v_year, v_seq,
    v_assignment.completed_at, v_now, v_assignment.assigned_by
  )
  RETURNING id INTO v_cert_id;

  RETURN jsonb_build_object(
    'status', 'issued',
    'certificate_id', v_cert_id,
    'certificate_number', v_number,
    'certificate_year', v_year,
    'certificate_sequence', v_seq,
    'certificate_unlocked_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.issue_participation_certificate(UUID) IS
  'Atomically and idempotently issues an ASPIRE Certificate of Participation for a COMPLETED post_rotation_evaluation assignment. Verifies completed_at and instrument slug/authorization; assigns the next per-year sequence under a row lock (ASPIRE-YYYY-NNN); re-invocation for the same student returns the existing certificate. Service-role execution only. Statuses: issued, already_issued, not_completed, wrong_instrument, assignment_not_found, sequence_exhausted.';

REVOKE ALL ON FUNCTION public.issue_participation_certificate(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_participation_certificate(UUID)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
