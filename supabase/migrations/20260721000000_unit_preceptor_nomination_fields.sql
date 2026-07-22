-- ============================================================================
-- UNIT LEADER PORTAL: preceptor nomination, optional student + structured fields
-- ============================================================================
-- *** GATED. APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, ONLY      ***
-- *** AFTER running every preflight query in                                     ***
-- *** db/audit/unit_preceptor_nomination_fields_preflight_and_verification.sql   ***
-- *** separately and reviewing the results. Run the ENTIRE file once             ***
-- *** (transactional). Nothing in the app depends on these columns until the     ***
-- *** six-field nomination form and its endpoint ship in a follow-up, so this    ***
-- *** migration is safe to apply ahead of that UI.                               ***
--
-- WHY THIS MIGRATION EXISTS
--   The approved nomination form captures six fields:
--     Student (OPTIONAL), Preceptor Full Name (required), Email (required),
--     Phone (optional), Unit (required), Shift (required).
--   The current table cannot support it as data-only, for two independent reasons:
--     1. student_id is NOT NULL, so a nomination made BEFORE a preceptor is linked
--        to a specific student is impossible. cohort_id is also NOT NULL and is
--        derived FROM the student server side, so with no student there is no cohort
--        to derive either.
--     2. There are no structured columns for the preceptor's email, phone, or shift.
--        The only person field is proposed_name. Stashing email/phone/shift in the
--        free-text note would be overloading a notes field with structured data,
--        which the task explicitly forbids.
--
-- WHAT IT DOES (all additive and reversible; NO existing row is rewritten)
--   - student_id  -> DROP NOT NULL   (Student becomes genuinely optional; the FK and
--                                     ON DELETE CASCADE are preserved for linked rows.)
--   - cohort_id   -> DROP NOT NULL   (Sourced from the student today; a student-less
--                                     nomination has no cohort to derive. FK preserved.)
--   - unit_key    -> STAYS NOT NULL  (Unit is required in the form; the endpoint must
--                                     supply it directly when there is no student.)
--   - proposed_name STAYS            (This is the required Preceptor Full Name.)
--   - ADD proposed_email  text       (Required in the form; enforced in the endpoint.
--                                     Nullable here so existing three-field rows are
--                                     preserved, i.e. grandfathered, not backfilled.)
--   - ADD proposed_phone  text       (Optional.)
--   - ADD proposed_shift  text       (Required in the form; enforced in the endpoint.
--                                     Constrained to the CANONICAL Preceptor Directory
--                                     shift set so it can never drift from
--                                     preceptors.shift_type.)
--
-- CANONICAL REUSE
--   Shift values are pinned to the exact set used by public.preceptors.shift_type
--   ('Day','Night','Mid','Variable', added by migration_preceptor_schema_v2.sql), so
--   a nomination's shift is directly comparable to a directory record's shift. Email
--   is normalized and de-duplicated against the directory in the endpoint using the
--   existing case-insensitive index preceptors_email_lower_unique_idx and the shared
--   normalizeEmailForLookup helper; this migration adds no email index of its own
--   because a nomination is a proposal, not a directory identity.
--
-- AUDIT BEHAVIOR IS UNCHANGED
--   The nomination row remains the audit of record for a nomination. Attribution
--   (nominated_by_profile_id, nominated_at, the decision columns, and
--   chk_upn_decision_attribution) is untouched. No RPC is involved: the endpoint
--   inserts directly, so there is no function ACL to re-grant.
--
-- ROLLBACK (only if no row yet uses a student-less nomination or a new column;
-- re-adding NOT NULL FAILS if any row now has a NULL student_id or cohort_id):
-- /*
--   BEGIN;
--   ALTER TABLE public.unit_preceptor_nominations DROP CONSTRAINT IF EXISTS chk_upn_proposed_shift;
--   ALTER TABLE public.unit_preceptor_nominations DROP COLUMN IF EXISTS proposed_shift;
--   ALTER TABLE public.unit_preceptor_nominations DROP COLUMN IF EXISTS proposed_phone;
--   ALTER TABLE public.unit_preceptor_nominations DROP COLUMN IF EXISTS proposed_email;
--   ALTER TABLE public.unit_preceptor_nominations ALTER COLUMN cohort_id SET NOT NULL;
--   ALTER TABLE public.unit_preceptor_nominations ALTER COLUMN student_id SET NOT NULL;
--   COMMIT;
-- */
-- ============================================================================

BEGIN;

-- Student and its derived cohort become optional. The foreign keys, the ON DELETE
-- behavior, and every other constraint are left exactly as they were.
ALTER TABLE public.unit_preceptor_nominations ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE public.unit_preceptor_nominations ALTER COLUMN cohort_id  DROP NOT NULL;

-- Structured contact + shift for the proposed preceptor. Nullable so the existing
-- three-field nominations remain valid; the endpoint enforces email and shift as
-- required for NEW nominations.
ALTER TABLE public.unit_preceptor_nominations ADD COLUMN IF NOT EXISTS proposed_email text;
ALTER TABLE public.unit_preceptor_nominations ADD COLUMN IF NOT EXISTS proposed_phone text;
ALTER TABLE public.unit_preceptor_nominations ADD COLUMN IF NOT EXISTS proposed_shift text;

-- Shift is pinned to the canonical Preceptor Directory set. NULL is allowed only so
-- pre-existing rows (which have no shift) stay valid; the endpoint requires it going
-- forward. This CHECK guarantees a nomination's shift can never drift from
-- preceptors.shift_type.
ALTER TABLE public.unit_preceptor_nominations
  ADD CONSTRAINT chk_upn_proposed_shift
  CHECK (proposed_shift IS NULL OR proposed_shift IN ('Day', 'Night', 'Mid', 'Variable'));

COMMIT;

-- ============================================================================
-- NOTE ON THE ONE-OPEN-PER-STUDENT INDEX
--   uq_upn_one_open_per_student_unit is a partial UNIQUE on (student_id, unit_key)
--   WHERE status = 'nominated'. Postgres treats NULLs as distinct, so a student-less
--   nomination is never blocked by it and never blocks another. That is intended: a
--   preceptor nominated with no student is a directory-style heads-up, and duplicate
--   prevention for that case is the endpoint's normalized-email lookup against the
--   Preceptor Directory, not this index. No index change is needed.
-- ============================================================================
