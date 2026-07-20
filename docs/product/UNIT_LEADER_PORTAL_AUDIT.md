# Unit Leader Portal: schema and authorization audit (Phase 1)

Baseline: `origin/main` `c60d80f`, production `VITE_BUILD_SHA` `c60d80f`, suite 1506/1506.
Branch: `unit-leader-portal`. Read-only audit. No SQL was run.

## Headline

A Unit Leader Portal **already exists and is deployed**. This workstream is an
extension, not a greenfield build. The identity-backed assignment model the brief
asks for **already exists and satisfies every stated requirement**, so no migration
is needed for authorization.

Four of the MVP domains have **no backing schema at all**, and one deployed endpoint
carries a **production defect that makes the existing portal show zero students**.

## What already exists

| Layer | Artifact | Location |
| --- | --- | --- |
| Grant role | `user_role_grants.role` CHECK includes `unit_leader` | `20260712000007:52` |
| Assignment | `user_unit_scopes` | `20260712000007:95-115` |
| SQL scope helper | `my_unit_scope_keys()` | `20260712000007:221-232` |
| Router payload | `get_my_portal_access().unit_keys` | `20260712000007:264-266` |
| Scoped views | `portal_my_unit_responses`, `_preceptors`, `_reports` | `20260712000011:64-124` |
| JS helpers | `hasActiveRoleGrant`, `getActiveUnitScopes` | `api/lib/portalAuth.js:68,90` |
| Read API | `api/portal/unit-roster.js` | 160 lines |
| Write API | `api/portal/unit-participation-submit.js` | 119 lines |
| UI | `src/portal/UnitLeaderPortal.jsx` | 373 lines |
| Provisioning | invite / list / revoke all handle `unit_leader` | `api/invite-portal-user.js:45` |

## Authorization model: no migration required

`public.user_unit_scopes` already satisfies every requirement in the brief:

```sql
CREATE TABLE IF NOT EXISTS public.user_unit_scopes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  unit_key         text        NOT NULL,
  cohort_id        uuid        REFERENCES public.cohorts(id) ON DELETE CASCADE,
  granted_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes            text,
  CONSTRAINT chk_unit_scope_window CHECK (expires_at IS NULL OR expires_at > starts_at)
);
```

| Requirement | Satisfied by |
| --- | --- |
| identity-backed to `user_profiles.id` | `user_profile_id` FK |
| one Unit Leader to many units | many rows per profile |
| one unit to many Unit Leaders | many rows per `unit_key` |
| effective start and end dates | `starts_at`, `expires_at` |
| granted by active Owner/Admin | `granted_by`, via `provision_portal_access` RPC |
| revoked by active Owner/Admin | `revoked_at`, `revoked_by`, soft only |
| historical audit | rows are never deleted |
| no access after deactivation | `verifyPortalCaller` rejects `is_active === false` |
| no access after revocation | `nowActive` predicate, `portalAuth.js:62-65` |
| no role inference from text | `unit_key` validated against `UNIT_CATALOG` at write time |

Writes are structurally impossible from a client: the table has no INSERT/UPDATE/DELETE
RLS policy, and both writers are SECURITY DEFINER RPCs granted only to `service_role`.

**Unit identity is the canonical unit NAME string**, not `units.id`. This is deliberate
and documented at `20260712000007:21-22`: the `units` table is per-cohort, so `unit_name`
is the stable identity. `src/lib/unitCatalog.js` is the code-level source of truth.

## Audit ledger

| # | Existing table or endpoint | Current purpose | Reusable | Missing capability | Proposed minimal change | Authorization rule | Migration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `user_unit_scopes` | UL to unit assignment | Yes, fully | none | none | active grant + active scope | No |
| 2 | `user_role_grants` | portal role grants | Yes | none | none | `hasActiveRoleGrant('unit_leader')` | No |
| 3 | `portalAuth.js` helpers | portal caller verify | Yes | no shared UL helper (open-coded twice) | extract `verifyPortalUnitLeaderCaller` | active profile + grant + scopes | No |
| 4 | `api/portal/unit-roster.js` | UL student roster | Yes, after fix | **filters on `students.unit`, which is always empty** | join `matched_unit_id -> units.unit_name` | unit scope | No |
| 5 | `students.matched_unit_id` | canonical placement | Yes | none | none | server-side only | No |
| 6 | `students.status` | lifecycle | Partly | no CHECK; no completion timestamp | see conflict C1 | n/a | **Yes** |
| 7 | `cohort_school_rotations` | rotation dates | Partly | per (cohort, school), `1900-01-01` sentinel | see conflict C1 | n/a | **Yes** |
| 8 | `matches` | staff placement record | No | no status, no response, hard-deleted | new placement-request table | UL scope + ASPIRE final | **Yes** |
| 9 | `unit_cohort_responses` | unit participation | Partly | `UNIQUE(cohort_id, unit_id)`, no review state, no history | see conflict C3 | UL scope | **Yes** |
| 10 | `units.total_slots` | legacy capacity | No | superseded | leave alone | staff only | No |
| 11 | (none) | milestones | n/a | **no table** | new milestones table | UL scope, ASPIRE correctable | **Yes** |
| 12 | `program_events` | generic events | Partly | unconstrained `event_type`, `created_by` is TEXT | not sufficient for milestones | n/a | **Yes** |
| 13 | onboarding columns on `students` | readiness | Partly | no orientation per student, no "needs attention" signal | see conflict C4 | derived booleans only | **Yes** |
| 14 | `student_shift_logs` | shifts and hours | Yes | none | reuse count-not-text pattern | UL scope; `support_needed` text stays staff-only | No |
| 15 | `student_preceptor_assignments` | preceptor assignment | Yes for read | no nomination state | add nomination status | UL nominates, ASPIRE confirms | **Yes** |
| 16 | `preceptors` | preceptor directory | Yes | none | none | via `portal_my_unit_preceptors` | No |
| 17 | (none) | attendance concerns | n/a | derived from shift logs only; no expected-schedule | out of MVP scope | n/a | No |
| 18 | messages tables | student to staff threads | Partly | see conflict C2 | see conflict C2 | participant + active scope | **Yes** |
| 19 | `activity_logs` | staff audit | Yes server-side | no portal endpoint writes to it | emit from UL endpoints via service role | service role bypasses RLS | No |
| 20 | `sendNotification()` + `notification_log` | email | Yes | no `unit_leader` audience, no opt-out table | add audience + templates | recipient resolved server-side | **Yes** for prefs |
| 21 | `api/student-file-access.js` | staff file access | No, wrong model | authorizes by `user_profiles.role`; UL is a grant | new `api/portal/unit-student-file-access.js` | UL scope, photo + resume, read only | No |

## Production defect found

`api/portal/unit-roster.js:60` scopes students with:

```js
.in('unit', unitKeys)
```

`students.unit` is only ever written as the empty string (`AddStudentModal.jsx:8`,
`seedData.js:14`) and is **not** in the `api/student-update.js` field allowlist, so no
code path can ever populate it. The canonical placement is `students.matched_unit_id`
(FK to `units.id`), written by the matching workflow at `src/App.jsx:673`.

Consequence: every scoped unit returns an empty student list, and
`UnitLeaderPortal.jsx` renders "No current or upcoming ASPIRE students" for every unit.
This is fail-closed (no data leak) but the feature does not work. There is no test file
covering `unit-roster.js`.

The correct scope is a join `students.matched_unit_id -> units.id -> units.unit_name`,
matched against the active `unit_key` set and restricted by `units.cohort_id`.

## Conflicts between locked decisions and the real schema

### C1. "Completed students remain visible for 90 days" is not computable

There is no per-student completion timestamp and no per-student rotation end date.

- `students.term_dates` is **free text** (`setup.sql:15`), never converted.
- `students.updated_at` is a generic trigger column bumped by any edit.
- `cohorts.start_date` / `end_date` are **TEXT**, not `date`.
- `cohort_school_rotations.rotation_end_date` is a real `date` but is granular per
  **(cohort, school)**, not per student, and carries a `'1900-01-01'` sentinel meaning
  "pending admin review". Any date math silently misclassifies unfilled schools.

A 90-day window cannot be derived reliably from what exists.

### C2. Unit Leader to student messaging conflicts with the reserved schema shape

The messages tables already allow `unit_leader` in every role CHECK. Two structures block it:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_participants_active
  ON public.conversation_participants (conversation_id)
  WHERE removed_at IS NULL;
```

Exactly one active participant per conversation. A UL-to-student thread needs two.

```sql
  (participant_role = 'unit_leader'
    AND scope_kind = 'unit'
    AND scope_unit_key IS NOT NULL
    AND scope_student_id IS NULL          -- blocks naming the student
    AND scope_school_key IS NULL)
```

The reserved shape models a Unit Leader in a **unit-scoped thread with the ASPIRE
Team**, not a peer-to-peer thread with a student. Both are real DDL changes.

Two further application-level blockers:
- `messages_portal_get_thread_v2` labels authorship as a binary `staff` vs `You`. A
  student would see a Unit Leader's message attributed to themselves.
- Portal unread counts filter `author_role = 'staff'`, so a UL message would never
  raise a student's badge; the staff inbox filter (`author_role <> 'staff'`) would
  silently count UL messages into the ASPIRE inbox.

### C3. Capacity per date, rotation period, and shift is structurally impossible today

`unit_cohort_responses` carries `UNIQUE(cohort_id, unit_id)`: strictly one row per unit
per cohort. `shift_preference` is a single free-text field, not a per-shift quantity.
`submission_count` increments while prior values are **overwritten in place**, so there
is no history. There is no ASPIRE review state.

### C4. Onboarding "Needs attention" has no signal

Badge, access, and acknowledgment are booleans and derive cleanly. But nothing
distinguishes "stalled" from "in progress" (the `cs_*_date` columns are TEXT and there
are no due dates), and **orientation has no per-student field at all**, only
`cohorts.orientation_sent_at`.

Separately, `gpa_verified`, `bls_current`, `health_cleared`, and `background_check` are
compliance and health attributes. Even as booleans they reveal *why* a student is not
ready and should not be exposed to a Unit Leader.

## Pre-existing exposures found during the audit (out of scope, not introduced here)

These are legacy from the pre-portal public forms. Flagged for separate triage; this
workstream does not change them.

1. `unit_cohort_responses`, `units`, `preceptors`, and `matches` carry `anon` policies
   with `USING (true) WITH CHECK (true)`: anonymous read and write on capacity and
   preceptor data.
2. `api/unit-form-lookup.js` is unauthenticated and returns `submitted_by_name` and
   `submitted_by_email` to any caller who guesses a unit name.
3. `api/unit-form-submit.js` is unauthenticated and overwrites a unit's participation
   response plus `units.contact_person` / `contact_email`.
4. `api/unit-form-notification.js` is unauthenticated with a fully caller-supplied body.
5. `api/invite-portal-user.js`, `revoke-portal-access.js`, and `list-portal-access.js`
   select only `id, role, is_owner` and **omit `is_active`**, so a deactivated Owner or
   Admin can still grant and revoke portal access.
6. `api/invite-portal-user.js:301` hardcodes `p_cohort_id: null`, so no cohort-restricted
   unit grant can be issued despite full schema support.

## Phase 2 decision

**A migration is required.** Per the workstream rules, the branch and migration are
committed and nothing is merged or deployed until the database gate passes.

Scope requiring new schema: placement requests, capacity with review state and history,
milestones, per-student rotation completion, preceptor nomination state, notification
preferences, and the messages changes in C2.

Conflicts C1 through C4 are product decisions that change the shape of that schema, so
they are resolved with Jester before the migration is written.
