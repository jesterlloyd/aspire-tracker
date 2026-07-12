-- ============================================================
-- ASPIRE-SUPPORT-REQUEST-ACTION-CENTER-1 / -2
-- Per-user read receipts for student_shift_logs support-needed requests.
-- ============================================================
--
-- STATUS: this migration has ALREADY been applied and verified in Supabase (initial row count 0).
-- This file is documentation / source control ONLY - do NOT execute or re-run it. It is written to
-- match the live schema exactly.
--
-- WHAT: one additive table, public.support_request_reads, recording that a specific staff user has
-- read a specific VERSION of a shift's support-needed note. Read state is per user and per support
-- text version, so one Owner/Admin reading a request does not clear it for other staff; a meaningful
-- edit to support_needed (new fingerprint) re-arms the alert; clearing support_needed removes it.
--
-- IDENTITY: user_id references public.user_profiles(id) (the app's profile identity, userProfile.id),
-- NOT auth.users(id).
--
-- FINGERPRINT: support_fingerprint = lowercase SHA-256 hex (exactly 64 chars) of the normalized
-- support_needed text, where normalize() collapses whitespace runs to single spaces and trims. This
-- mirrors src/lib/support/supportRequests.js so the client-computed value matches stored receipts.
-- Whitespace-only edits keep the same fingerprint (no false re-arm); blank notes have no fingerprint.
--
-- GUARDRAILS: additive only. Does NOT alter student_shift_logs, support_needed text, shift submission
-- / approval / auto-acceptance, hours, certificates, evaluations, cohorts, or student_reads.
--
-- REQUIRES: helper public.is_owner_or_admin() (already present; used by the Rotation shift-log RLS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.support_request_reads (
  user_id             uuid        NOT NULL REFERENCES public.user_profiles (id)     ON DELETE CASCADE,
  shift_log_id        uuid        NOT NULL REFERENCES public.student_shift_logs (id) ON DELETE CASCADE,
  support_fingerprint text        NOT NULL CHECK (support_fingerprint ~ '^[0-9a-f]{64}$'),
  read_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_request_reads_pkey PRIMARY KEY (user_id, shift_log_id, support_fingerprint)
);

-- The composite PK already indexes (user_id, ...); add a shift-log index for per-shift joins.
CREATE INDEX IF NOT EXISTS idx_support_request_reads_shift_log ON public.support_request_reads (shift_log_id);

ALTER TABLE public.support_request_reads ENABLE ROW LEVEL SECURITY;

-- A signed-in Owner/Admin may SELECT only their OWN receipts.
DROP POLICY IF EXISTS support_request_reads_select_own ON public.support_request_reads;
CREATE POLICY support_request_reads_select_own ON public.support_request_reads
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND public.is_owner_or_admin());

-- A signed-in Owner/Admin may INSERT a receipt only for THEMSELVES (cannot mark-read for another user).
DROP POLICY IF EXISTS support_request_reads_insert_own ON public.support_request_reads;
CREATE POLICY support_request_reads_insert_own ON public.support_request_reads
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_owner_or_admin());

-- No UPDATE / DELETE policy: receipts are immutable, append-only. Re-reads use ON CONFLICT DO NOTHING.

-- Grants: authenticated may SELECT/INSERT (RLS still restricts to own rows); anon has no access;
-- service_role retains full access for maintenance.
REVOKE ALL ON public.support_request_reads FROM anon;
GRANT SELECT, INSERT ON public.support_request_reads TO authenticated;
GRANT ALL    ON public.support_request_reads TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Verification (read-only) ──────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='support_request_reads' ORDER BY ordinal_position;
--   expect: user_id, shift_log_id, support_fingerprint, read_at, created_at
-- SELECT relrowsecurity FROM pg_class WHERE relname='support_request_reads';   -- expect t
-- SELECT policyname, cmd FROM pg_policies WHERE tablename='support_request_reads';
--   expect: support_request_reads_select_own (SELECT), support_request_reads_insert_own (INSERT)
