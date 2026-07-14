-- ============================================================================
-- PHASE 2, PART 2: student portal read surface (scoped, column-limited views)
-- ============================================================================
-- *** PREREQUISITES (hard): Phase 0B Waves A through E, then                ***
-- *** 20260712000007_phase2_authz_foundation.sql.                           ***
--
-- Owner instructions: run this ENTIRE file as one block. Additive only.
--
-- Data-access pattern choice (binding amendment 4, per resource):
--   - Shift logs, evaluation statuses, certificates: scoped DEFINER views.
--     The row scope is the WHERE predicate (my_linked_student_ids(), which is
--     empty unless the caller holds an ACTIVE student role grant), and the
--     column allowlist is the view itself. Staff-only columns (admin_notes,
--     exception_flags, reviewed_by, tokens, scores) are excluded by
--     construction. Views run with owner rights on purpose: base-table RLS
--     stays deny-by-default for portal users, and these views are their ONLY
--     read path.
--   - The cross-table student summary (profile, placement, hours, next
--     steps): JWT-verified serverless endpoint api/portal/student-summary.js
--     with a server-side column allowlist (joins and derivations are easier
--     and safer to audit in one place).
--   - Anything write-shaped for students continues to flow through the
--     existing public tokenized or email-identity endpoints (shift-log
--     check-in and check-out, evaluations), NOT through the portal.
-- ============================================================================

-- ── 1. Own shift logs ────────────────────────────────────────────────────────
-- Excluded on purpose: school_email (redundant), attestation, exception_flags,
-- admin_notes, reviewed_by (staff-internal). reviewed_at is kept so students
-- can see when an entry was processed.

CREATE OR REPLACE VIEW public.portal_my_shift_logs
WITH (security_barrier = true) AS
  SELECT
    l.id,
    l.student_id,
    l.cohort_id,
    l.shift_date,
    l.total_hours,
    l.unit_name,
    l.is_assigned_unit,
    l.preceptor_name,
    l.is_assigned_preceptor,
    l.shift_type,
    l.learning_highlight,
    l.support_needed,
    l.status,
    l.submitted_at,
    l.reviewed_at
  FROM public.student_shift_logs l
  WHERE l.student_id IN (SELECT public.my_linked_student_ids());

-- ── 2. Own evaluation assignment statuses ────────────────────────────────────
-- Status only: never response content, never scores, never tokens. Only the
-- student's own assignments (respondent_type = 'student').

CREATE OR REPLACE VIEW public.portal_my_evaluation_assignments
WITH (security_barrier = true) AS
  SELECT
    a.id,
    a.student_id,
    a.cohort_id,
    a.timepoint,
    a.status,
    a.sent_at,
    a.opened_at,
    a.completed_at,
    a.expires_at,
    i.slug  AS instrument_slug,
    i.title AS instrument_title
  FROM public.evaluation_assignments a
  JOIN public.evaluation_instruments i ON i.id = a.instrument_id
  WHERE a.respondent_type = 'student'
    AND a.student_id IN (SELECT public.my_linked_student_ids());

-- ── 3. Own certificate status ────────────────────────────────────────────────
-- Metadata only; the PDF itself stays behind the existing token-authorized
-- download endpoint.

CREATE OR REPLACE VIEW public.portal_my_certificates
WITH (security_barrier = true) AS
  SELECT
    c.id,
    c.student_id,
    c.certificate_number,
    c.certificate_year,
    c.post_rotation_evaluation_completed_at,
    c.certificate_unlocked_at
  FROM public.certificates c
  WHERE c.student_id IN (SELECT public.my_linked_student_ids());

-- ── 4. Privileges ────────────────────────────────────────────────────────────
-- The predicate makes every view empty for anyone without an active student
-- grant, so a broad SELECT grant to authenticated is safe (staff see nothing
-- through these views either, unless they also hold a student link).

REVOKE ALL ON public.portal_my_shift_logs,
              public.portal_my_evaluation_assignments,
              public.portal_my_certificates
  FROM PUBLIC, anon;
GRANT SELECT ON public.portal_my_shift_logs,
                public.portal_my_evaluation_assignments,
                public.portal_my_certificates
  TO authenticated;
GRANT SELECT ON public.portal_my_shift_logs,
                public.portal_my_evaluation_assignments,
                public.portal_my_certificates
  TO service_role;

-- Verification (as any staff user with no student link, all three must
-- return zero rows):
--   SELECT count(*) FROM portal_my_shift_logs;
--   SELECT count(*) FROM portal_my_evaluation_assignments;
--   SELECT count(*) FROM portal_my_certificates;
