# Unit Leader Evaluations: Safety Diagnostic and Migration Contract

Status: **BLOCKED before activation. SQL and policy work required.**
Branch: `unit-leader-calendar-evaluations-convergence`
Scope of this document: Commit 4 of the convergence work. It records the read-only
inspection of the evaluations subsystem, the authorization contract a Unit Leader
Evaluations workspace must satisfy, the exact schema and policy gaps that block it,
and the migration contract that would unblock it. No SQL, migration, endpoint, or
client data path was created in this commit.

## Verdict

**SQL is definitely needed.** The Unit Leader Evaluations dashboard cannot be built
safely against the current schema, and the missing safeguards must be enforced in the
database and server, not simulated in the browser. Commit 5 does not proceed on this
branch. The Evaluations tab keeps its honest placeholder
(`src/portal/unit/UnitEvaluationsPlaceholder.jsx`).

## Why the dashboard is not safely implementable today

A Unit Leader Evaluations workspace visually reuses the staff Evaluation Dashboard
(`src/components/EvaluationTab.jsx`) but must expose only released, moderated,
threshold-safe, role-shaped data within the caller's active unit scope. Every one of
the safeguards that makes that safe is currently absent.

### 1. Unit Leaders cannot read any evaluation table

The staff dashboard reads `evaluation_assignments` (with embedded
`evaluation_responses`) directly from the browser via the authenticated Supabase
client (`EvaluationTab.jsx:346`), relying on row-level security. Every `evaluation_*`
table is `REVOKE ALL FROM anon, authenticated` with a `SELECT` policy gated by
`public.is_owner_or_admin()` (`migrations/migration_evaluation_stage1_schema.sql`,
policies section). A Unit Leader is neither owner nor admin, so:

- No client query a Unit Leader could run returns any evaluation row.
- There is no portal-scoped view for unit-released evaluation data. The only
  portal evaluation view that exists, `public.portal_my_evaluation_assignments`
  (`supabase/migrations/20260712000008_phase2_student_portal_views.sql`), is a
  *student self* view, not a unit-leader view.
- There is no `api/portal/unit-evaluation*` endpoint. (Confirmed: `api/portal/`
  contains no evaluation file.)

Any Unit Leader read therefore requires a **new service-role endpoint** on the
`verifyPortalUnitLeaderCaller` + `resolveUnitScopedStudents` pattern
(`api/lib/unitLeaderScope.js`). That endpoint can only be written safely once the
data it would return is itself safe, which it is not yet.

### 2. There is no concept of "released to a unit"

"Release" in the current system means staff *sending* a survey to a respondent
(`api/evaluation-release-*.js`), not releasing a *result* to a unit. There is no
`released_to_unit_at`, `is_released`, or equivalent column on `evaluation_responses`
or `evaluation_assignments`. Independently verified: a search for
`released_at | is_released | release_status` across all evaluation migrations returns
nothing. Without a release flag, a Unit Leader read would expose responses the ASPIRE
team has never reviewed or approved for unit visibility.

### 3. There is no moderation state

There is no `moderation_status`, moderation queue, or reviewer-approval column that
gates unit visibility. `exception_flags` on `student_shift_logs` is unrelated (shift
review), and evaluation responses carry no moderation gate. A Unit Leader read would
therefore surface unmoderated free text and ratings.

### 4. There is no delayed-release timing for unit visibility

`evaluation_assignments.expires_at` is the *response window* cutoff (sent_at + 28
days), not a unit-visibility delay. The product requirement, "nothing appears while a
student is still on your unit," has no column to enforce it. Nothing records when a
student's rotation on a given unit ends for the purpose of holding feedback until
after departure.

### 5. There is no stable historical unit/preceptor attribution for feedback

Unit and preceptor attribution for a response is currently derived **live**:
`students.matched_unit_id -> units.unit_name`, and `students.preceptor_id` (or
`evaluation_assignments.respondent_preceptor_id` for preceptor-authored responses).
`preceptor_id` changes are guarded by a trigger
(`supabase/migrations/20260723000000_preceptor_assignment_authorization.sql`), and
hour snapshots exist (`approved_hours_at_invitation/completion`), but there is **no
snapshot of the unit and preceptor a response was about, captured at submission**.
If a student moves units or changes preceptor after submitting, live derivation
re-attributes past feedback to the wrong unit or preceptor. A Unit Leader must never
see feedback re-attributed into or out of their unit by a later roster change.

### 6. There is no small-cohort threshold

There is no `min_cohort_for_aggregate` policy or enforcement anywhere. At the cohort
sizes a single unit sees (often one or two students), an average or a count is
identifying. Returning any aggregate without a server-enforced threshold discloses
individual responses by arithmetic.

### 7. There is no unit-visibility consent flag, and free text is unredacted

The only consent-shaped field is `responses.may_use_anonymized_comments`, a *student's*
Post-Rotation consent about anonymized comment reuse. There is no representation of
"this response may be shown to the unit leader," and no free-text redaction or
identity-anonymization contract. `responses` is a raw JSONB map that includes every
free-text answer; the staff response viewers render it in full and are Owner/Admin
gated with defense-in-depth internal guards
(`PreceptorResponseDetail.jsx`, `StudentEvalResponseDetail.jsx`,
`EvaluationResponseDetail.jsx`). Written comments identify their author by content.

## Why a client-only implementation would be unsafe

Every safeguard above is an **authorization and disclosure** control. Enforcing them
in the browser (filtering unreleased rows client-side, computing thresholds in React,
redacting free text in the component) is unsafe by construction:

- The data cannot even reach a Unit Leader's browser without a service-role endpoint,
  and a service-role endpoint bypasses RLS. It must therefore do the *entire* job of
  authorization and shaping server-side. A client filter over service-role data is a
  disclosure waiting for one query-shape or one bug.
- Thresholds, release, moderation, delayed release, and stable attribution are facts
  about *state and policy* that only the database can hold consistently. Simulating
  them in client code means the guarantee lasts exactly until the next endpoint,
  export path, or refactor forgets to reapply it.
- The locked product principles for this branch forbid exactly this: "do not simulate
  safeguards in client code," "never trust browser-supplied authority," "do not expose
  unreleased responses," "do not expose a response when delayed-release, consent,
  moderation, stable attribution, or small-cohort safeguards are not satisfied."

## The Unit Leader authorization contract (target)

When the schema supports it, every Unit Leader Evaluations read must require, server
side, all of:

1. Authenticated caller (`verifyPortalCaller`).
2. Active `unit_leader` role grant (`hasActiveRoleGrant`).
3. At least one active explicit unit scope (`getActiveUnitScopes`); empty scope sees
   nothing, never everything.
4. Server-derived authorized students/preceptors (`resolveUnitScopedStudents`); a
   browser-supplied `unit_key` may only narrow, never widen.
5. A response that is **released to units** (new state).
6. A response that has **passed moderation** (new state).
7. The **delayed-release** rule satisfied (student no longer on the unit / release
   time reached).
8. The **unit-visibility consent/policy** rule satisfied where represented.
9. **Stable historical attribution**: the response is attributed to this unit and
   preceptor by a submission-time snapshot, not by live roster state.
10. The **small-cohort threshold** satisfied before any aggregate is returned.
11. **Role-safe field shaping**: an explicit `SAFE_COLUMNS`-style allowlist, free text
    excluded unless an approved release contract permits it, identity anonymized where
    required. Follow the allowlist pattern in `api/portal/unit-shift-activity.js:39`.

## Proposed migration contract (for a future Owner-gated SQL pass)

This is a contract, not a migration. It must go through the Owner SQL gate
(`docs/security/OWNER_SQL_GATE.md`). Column names are proposals.

### A. Release, moderation, and delayed release
On `evaluation_responses` (or a dedicated `evaluation_response_unit_release` table):
- `unit_release_status text` check in (`pending`,`approved`,`withheld`), default
  `pending`.
- `unit_released_at timestamptz null` — set only by a staff release action.
- `moderation_status text` check in (`pending`,`cleared`,`blocked`), default
  `pending`.
- `unit_visibility_after timestamptz null` — the delayed-release timestamp; a Unit
  Leader read filters `now() >= unit_visibility_after`. Populated from the student's
  rotation end on the attributed unit.

### B. Stable historical attribution
Snapshot at submission (denormalized, immutable after write), either on
`evaluation_responses` or a companion table:
- `attributed_unit_id uuid`, `attributed_unit_name text`.
- `attributed_preceptor_id uuid null`, `attributed_preceptor_name text null`.
Written by the submit RPCs at completion, never recomputed. This mirrors the existing
`approved_hours_at_completion` snapshot pattern.

### C. Small-cohort threshold
- A policy value (config table or documented constant enforced in SQL/endpoint), e.g.
  `min_unit_aggregate_n = 5`. Aggregates return a threshold state, never a count,
  when `n < min`.

### D. Consent for unit visibility
- Represent, per instrument, whether a response may be shown to a unit leader and at
  what granularity (aggregate only vs. individual, identified vs. anonymized). Where a
  student consent governs this, bind it to a concrete boolean the endpoint can read.

### E. Access path
- New RLS policy or, preferably, a **service-role portal endpoint**
  `api/portal/unit-evaluations*.js` that enforces contract items 1-11 and returns only
  shaped, threshold-safe, released, moderated, stably-attributed, role-safe data.

## Per-instrument release rules (to be finalized with the SQL pass)

Do not assume all three instruments are appropriate for Unit Leaders. Each needs an
explicit contract before it surfaces.

| Instrument | Slug | Respondent | Plausible unit-leader surface | Notes / open policy questions |
|---|---|---|---|---|
| Preceptor Student Readiness Assessment | `preceptor_progress` | Preceptor about student | Likely **not** unit-leader facing by default: it is about a student's readiness and carries confidential ASPIRE-only comments (`PreceptorResponseDetail.jsx:186`). | Confidential comments must never surface. Probably excluded entirely, or aggregate-only. |
| Student Feedback: Preceptor and Unit | `student_preceptor_eval` | Student about preceptor/unit | The **primary** candidate: this is feedback about precepting and the unit. | Requires release, moderation, delayed release, stable attribution, threshold, and free-text handling before any surface. Identity anonymized. |
| Casey-Fink Readiness | `casey_fink_readiness_2024` | Student self-assessment | Likely **aggregate-only** at most, if at all: it is a self-assessment, and the instrument is copyrighted (`permission_status` pending). | Copyright/permission gate (`chk_instrument_authorized_documented`) must be satisfied. Item prose is not even in the repo (private Storage). |
| ASPIRE Post-Rotation Evaluation | `post_rotation_evaluation` | Student about program | Program feedback, not unit-specific; probably **not** a unit-leader surface. | `may_use_anonymized_comments` consent governs comment reuse. |

## Threshold behavior contract

- Below threshold: show an aggregate-unavailable state that does **not** reveal the
  hidden count (no "1 response"). The existing placeholder already models this honesty
  (`UnitEvaluationsPlaceholder.jsx:6`).
- Partial availability: a unit may meet threshold on one instrument/timepoint and not
  another; each surface is gated independently.

## Response-viewer field contract (target, once released data exists)

- Released response only; server-shaped allowlisted fields only.
- Instrument and timepoint labels; no staff-only lifecycle metadata
  (invited/sent/opened/reopened/revoked timestamps, `assigned_by`, tokens).
- No internal or confidential comments; no raw free text unless an approved release
  contract explicitly permits it; identity anonymized where required.
- Reuse the main-app modal foundation for accessibility (focus trap, Escape,
  focus restoration, internal scroll, 200% zoom), with a role-safe adapter.

## What Commit 4 did and did not do

- Did: read-only inspection; this diagnostic and migration contract; a guard test that
  locks the gate (`test/unitLeaderEvaluationsGate.test.mjs`) so the placeholder stays
  and no unit-leader evaluation read or client-side safeguard simulation is introduced
  by accident.
- Did not: run SQL, add or alter a migration, create an endpoint, add a client
  evaluation data path, or change the staff Evaluation Dashboard.

## Required product/engineering decisions before Commit 5

1. Which instruments surface to Unit Leaders, and at what granularity
   (aggregate-only vs. individual, identified vs. anonymized).
2. The delayed-release rule's exact trigger (rotation end date source and offset).
3. The small-cohort threshold value and whether it differs by instrument.
4. The unit-visibility consent representation per instrument.
5. Owner approval of the migration contract through the SQL gate.

Until these are resolved and the migration is applied and verified, the Unit Leader
Evaluations workspace stays a placeholder.
