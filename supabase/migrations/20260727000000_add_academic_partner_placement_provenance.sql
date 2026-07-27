-- 20260727000000_add_academic_partner_placement_provenance.sql
-- ============================================================================
-- Academic Partner placement request: latest-submission provenance columns
-- ============================================================================
--
-- AUTHORED, NOT APPLIED. Jester applies this manually through the Owner SQL gate
-- (docs/security/OWNER_SQL_GATE.md) after review.
--
-- WHY: enabling authenticated Academic Partner placement submission requires
-- recording WHICH authenticated profile submitted a request, alongside the
-- source and a server-generated timestamp, WITHOUT omitting provenance. The
-- existing students.submitted_via records the ORIGINAL source and is deliberately
-- NOT changed by this migration. These three columns record the LATEST placement
-- submission (public or authenticated) and are refreshed on every successful
-- insert and every duplicate-safe update.
--
-- NO BACKFILL: existing rows keep NULL in all three columns until their next
-- successful placement submission refreshes them. A full append-only
-- submission-history model remains deferred.

BEGIN;

-- Additive, idempotent. The FK ON DELETE SET NULL keeps a request row if the
-- submitting portal profile is later removed (the request itself is not deleted).
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS placement_request_last_source text,
  ADD COLUMN IF NOT EXISTS placement_request_last_submitted_by_profile_id uuid
    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placement_request_last_submitted_at timestamptz;

-- Constrain the source to the two known origins; NULL stays valid for historical
-- rows and any row not yet re-submitted. Idempotent via drop-then-add, matching
-- the repository's established constraint pattern.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS chk_students_placement_request_last_source;
ALTER TABLE public.students
  ADD CONSTRAINT chk_students_placement_request_last_source CHECK (
    placement_request_last_source IS NULL
    OR placement_request_last_source IN ('school_form', 'academic_partner_portal')
  );

COMMIT;

-- ── Verification (run after applying) ────────────────────────────────────────
-- 1. The three columns exist with the right types, all nullable:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'students'
--     AND column_name LIKE 'placement_request_last_%'
--   ORDER BY column_name;
--   -- expect: placement_request_last_source                 | text        | YES
--   --         placement_request_last_submitted_at           | timestamp with time zone | YES
--   --         placement_request_last_submitted_by_profile_id | uuid       | YES
--
-- 2. The CHECK constraint is present:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.students'::regclass
--     AND conname = 'chk_students_placement_request_last_source';
--
-- 3. No backfill happened (all existing rows null until their next submission):
--   SELECT count(*) AS total, count(placement_request_last_source) AS with_source
--   FROM public.students;
--   -- expect with_source = 0 immediately after applying
--
-- ── Rollback (reverses this migration; no data loss beyond latest-submission
--    provenance, since submitted_via is untouched) ───────────────────────────
--   ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_placement_request_last_source;
--   ALTER TABLE public.students
--     DROP COLUMN IF EXISTS placement_request_last_source,
--     DROP COLUMN IF EXISTS placement_request_last_submitted_by_profile_id,
--     DROP COLUMN IF EXISTS placement_request_last_submitted_at;
