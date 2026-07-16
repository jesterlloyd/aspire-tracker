# ASPIRE Messages, Phase 1: Schema and Authorization Foundation

This document describes the database and authorization foundation for ASPIRE
Messages. It covers only Phase 1. There is no UI, API endpoint, Resend
notification, delivery worker, rate limiter, polling behavior, cron job, portal
navigation, or ASPIRE Connect Messages tab in this phase.

## Scope

Phase 1 delivers one migration, one read-only verification file, static tests,
and this document:

- Migration: `supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql`
- Verification: `db/audit/messages_phase1_verification.sql` (run after applying)
- Tests: `test/messagesPhase1SchemaFoundation.test.mjs`

The migration is additive only. It creates two functions and six tables with
their indexes, RLS, least-privilege grants, and staff read policies. It creates
no data and modifies no existing table, policy, function, or grant. It builds on
the Phase 2 portal authorization foundation (`user_role_grants`,
`user_student_links`, `user_unit_scopes`, `user_school_scopes`,
`portal_profile_id()`, `has_active_role_grant()`, `my_linked_student_ids()`,
`is_owner_or_admin()`, and the portal access lifecycle functions), which it does
not recreate.

## The seven new schema objects

1. `public.is_active_owner_or_admin()`: staff authorization helper. Returns true
   only when the current `auth.uid()` maps to an active `owner` or `admin`
   `user_profiles` row. SECURITY DEFINER, STABLE, fixed
   `search_path = public, pg_catalog`, EXECUTE granted to `authenticated` and
   `service_role` only. It never calls `is_staff()`.
2. `public.conversations`: one row per one-to-one conversation between a portal
   participant and the ASPIRE Team. Holds subject, category, status, assignment,
   follow-up flag, creator identity, related context metadata, and lifecycle
   timestamps.
3. `public.conversation_participants`: the portal side of a conversation, with
   explicit typed scope columns (no polymorphic scope reference). The row is
   historical and is not removed when a grant ends.
4. `public.messages`: append-only, immutable message rows. No edit, delete, or
   system columns.
5. `public.staff_conversation_reads`: per-staff last-read pointer.
6. `public.participant_conversation_reads`: per-participant last-read pointer.
7. `public.conversation_events`: append-only lifecycle log (created,
   status_change, assignment_change, resolved, reopened, flagged,
   participant_access_changed).

The participant authorization helper `public.my_message_conversation_ids()` is
also created (SECURITY DEFINER, same hardened conventions) as the authorization
foundation. It is not used to expose any base table in Phase 1.

## Staff authorization

Messages staff access is limited to an active Owner or active Admin, enforced by
`is_active_owner_or_admin()`. `is_staff()` is intentionally not used anywhere in
Messages SQL because it also returns true for interviewer and viewer. The
existing `is_owner_or_admin()` helper is left unmodified; the new helper adds the
active-profile requirement.

Active Owner/Admin staff receive SELECT policies on `conversations`,
`conversation_participants`, `messages`, and `conversation_events`, and a SELECT
policy on their own `staff_conversation_reads` row only. Assignment to a
conversation does not expand authorization.

## Student-only participant authorization in Phase 1

`my_message_conversation_ids()` authorizes a caller as a student participant
only. It requires an active participant row (`removed_at IS NULL`) with
`participant_role = 'student'` and `scope_kind = 'student'`, a live active
student role grant (canonical active predicate: `revoked_at IS NULL`,
`starts_at <= now()`, `expires_at IS NULL OR expires_at > now()`), and an active
`user_student_links` row matching the participant's `scope_student_id`. It
returns nothing for unit_leader, academic_partner, or preceptor participants.

It never authorizes using a conversation id alone, assigned staff, or a
conversation's related student, unit, school, or cohort context.

## Shared future-role schema reservation

The schema reserves a shared shape for student, unit_leader, academic_partner,
preceptor, and staff authors. Participant roles and scope columns for
unit_leader (unit scope), academic_partner (school scope), and preceptor
(student scope) are reservations only. Their authorization branches will be
added in later portal-specific migrations after those portal experiences are
ready. Phase 1 authorizes the student role and an active student link only.

## Three-identity handling

The identity model is preserved exactly: `auth.users.id`,
`user_profiles.auth_user_id`, and `user_profiles.id` are distinct and are not
required to be equal. Every Messages actor, participant, assignee, reader, and
event reference uses `user_profiles.id`. The current profile is resolved from
`auth.uid()` through `portal_profile_id()` or the
`(SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid())`
subquery. No policy compares a profile id directly to `auth.uid()`.

## Related context is metadata only

`related_student_id`, `related_unit_key`, `related_school_key`, and
`related_cohort_id` on a conversation are staff context metadata. They are never
referenced in any policy or helper and never grant access.

## Append-only message and event guarantees

`messages` and `conversation_events` are append-only. No application role may
UPDATE, DELETE, or TRUNCATE them: `authenticated` holds no mutation privilege and
`service_role` holds SELECT and INSERT only. `conversations` and
`conversation_participants` may not be deleted or truncated by any application
role, and foreign keys into them use `ON DELETE RESTRICT` so history cannot be
erased through a cascade. There is no user-facing delete path. The database owner
retains emergency administrative authority.

## No direct portal table access yet

Phase 1 does not enable direct portal messaging access. There is no portal
base-table SELECT policy and no portal-safe view. `participant_conversation_reads`
has RLS enabled with no policy, so it is service-role only. The portal read
surface and its exact response shape belong to a later backend or portal-read
phase.

## Out of scope for this phase

No UI, API, notifications, delivery worker, rate limiting, polling, realtime,
cron configuration, portal navigation, ASPIRE Connect Messages tab, Unit Leader
Portal, Academic Partner Portal, Preceptor Portal, public metrics, or Wave F-2
work is included.

## Manual Owner SQL application

The migration is committed and pushed before it is applied. It is not applied by
the repository tooling. The Owner runs the migration file whole, as one block,
in the Supabase SQL editor, then runs the read-only verification file to confirm
tables, RLS, constraints, helper security, grants, and the append-only posture.
The committed migration is not modified after it has been successfully applied.
