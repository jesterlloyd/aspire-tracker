# NGRP-WORKSPACE-1: Phase-1 build handoff (correction pass)

Status: built on branch `ngrp-workspace-1` - foundation commit `1f7a648` plus
correction commits (see `git log`; the second correction pass covers the
chronology-based prior-hire rule, the bundle regression, truthful mapping
states, legacy-field removal, selector ordering, and the Experience/Cohort
header presentation). Migration
`20260903000000_ngrp_foundation.sql` is corrected in place and **NOT
applied** (Owner SQL gate). No SQL was applied, nothing was merged or pushed,
and no production data was touched.

**Product source of truth: `docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md`**
(updated in this pass for the cycle→source-cohort mapping). Where this file
and the plan differ, the plan wins.

## Authorization model (exact)

One definition, used by every layer: the `ngrp_access` / `ngrp_manage`
capabilities in the canonical ROLE-MODEL-1 table (`lib/server/access.js`).

- Allowed: **active** Owner capability (`is_owner === true`, never the role
  string alone), **active** Admin, **active** Co-Lead (both persisted
  spellings via `normalizeRole`).
- Refused: Interviewer, Viewer, portal roles, inactive staff, anonymous.
- Client: `src/lib/ngrp/ngrpAccess.js` (`canAccessNgrp` / `canManageNgrp`,
  which add the `is_active !== false` requirement). The broad `canEdit` is
  deliberately not used (it omits Co-Lead).
- Applied at every layer: the Experience picker (and with it the Residency
  option) renders only for authorized profiles; direct `/ngrp/*` navigation
  redirects to `/aggregate`
  once the profile resolves (and renders nothing before that); the endpoint
  verifies the same capability server-side (`api/lib/ngrpAuth.js` →
  `verifyNgrpCaller`, built on `verifyPortalCaller` which enforces S-05
  inactive refusal); the database fails closed (below).

## Roster query contract (exact)

The browser NEVER queries students for NGRP. `POST /api/ngrp-workspace`
(actions `cycles`, `applicants { cycle_id }`) is the only read path; its
logic lives in `lib/server/ngrpApplicants.js` (pure, unit-tested):

1. Validate `cycle_id` (UUID, 422 otherwise; 404 for an unknown cycle).
2. Resolve the cycle's source ASPIRE cohorts from `ngrp_cycle_source_cohorts`
   (explicit many-to-many; one cycle may combine e.g. Summer 2026 + Fall
   2026 + Winter 2027).
3. Read students from ALL mapped cohorts with canonical status exactly
   `Completed`.
4. Identity comes only from the students row; the payload carries the
   minimal fields Applicants and its drawer need. Raw emails never leave the
   server - rows carry `has_email` for the bulk-send validator; GPA, phone,
   and licensure fields are never selected.
5. Join the selected cycle's `ngrp_candidates` rows; a completed alumnus with
   no row renders neutral defaults (Not Sent / No Response / Pending / Not
   Confirmed - never failures).
6. **Prior-hire exclusion**: exclude a student with a durable hire
   (`ngrp_residency_outcomes.hired_at IS NOT NULL`) recorded on an attempt in
   a chronologically EARLIER cycle - "earlier" decided by `cycleChronoKey`
   (application_open_date, then residency_start_date, then created_at, then
   id; NULL dates sort last so an undated cycle can never retroactively
   exclude anyone), never by uuid inequality. A hire in a later cycle does
   not erase the person from an earlier cycle's historical roster; a hire in
   the selected cycle stays visible there; a later separation keeps an
   earlier hire excluded; a prior attempt without a hire never excludes. The
   excluded count is reported (`excludedPriorHires`) and shown as a quiet
   informational banner. The cycles action resolves every listed cycle's
   source cohorts in ONE batched read with truthful states: missing mapping
   table → `provisioned:false`, ordinary failure → server error, and only a
   successful query may report an empty mapping. The legacy
   `students.ngrp_cohort_target` / `ngrp_outcome` fields are no longer
   selected and never reach the browser payload.
7. Missing ngrp_* tables surface as `{ provisioned: false }` - a distinct
   state, never conflated with "no cycles" or an error.

Client: `src/lib/ngrp/useNgrpData.js` maps every response to one of
`loading | unauthorized | unprovisioned | error | stale | ready` - nothing is
optimistic, and a failed background refresh shows a quiet stale banner over
cached data (no toasts).

## Experiences and scopes (exact)

- Header: an **Experience** picker (Internship | Residency,
  `src/components/Header/ExperiencePicker.jsx`) sits beside the Cohort
  picker in the right-side control cluster, before search, in the same
  translucent pill + dropdown treatment. It renders only for profiles with
  `ngrp_access`, so the Residency option does not exist for anyone else.
- Internship = the unchanged ASPIRE workspace with its cohort picker.
- Residency = the NGRP workspace; the adjacent picker becomes the residency
  **COHORT** picker (`ResidencyCohortPicker.jsx`) listing `ngrp_cycles` rows
  presented to users as cohorts (eyebrow COHORT, e.g. "COHORT · January
  2027" once such a cohort is configured - never seeded). No user-facing
  header text says "NGRP Residency Cycle" or "Awaiting provisioning";
  unconfigured shows "No cohorts configured", table/query failures show
  "Cohorts unavailable" with the full explanation on the NGRP page. The
  duplicate below-nav selector was removed; the strip shows compact cohort
  metadata only. Internally the entity remains `ngrp_cycles` / `cycle_id` -
  presentation language only.
- Selector order (plan §3.2, `orderCyclesForSelector`): active cohort first,
  then planned/open chronologically, then Completed/Archived; a still-valid
  saved selection is preserved (`resolveSelectedCycle`).
- Separate state: the residency-cohort preference is per authenticated user
  (`aspire:ngrpCycle:<userId>`); each experience restores its own last
  operational tab (`aspire:lastActiveTab:<userId>` /
  `aspire:lastNgrpTab:<userId>`); switching experiences never changes the
  other side's selection. Applicants filters live in the URL and survive the
  Connect round trip.
- `NgrpWorkspace` is imported STATICALLY: a lazy() chunk made the bundler
  hoist the shared dependency graph into the main entry (~585 KB → ~3 MB
  gzip 828 KB); static import restores the 584.60 KB / 169.80 KB gzip
  baseline.

## Migration (corrected in place; UNAPPLIED)

`supabase/migrations/20260903000000_ngrp_foundation.sql` creates four
server-only tables:

- `ngrp_cycles` - plan §10.1 status vocabulary; CHECKs: nonblank unique
  name, `application_deadline >= application_open_date`,
  `interview_window_end >= interview_window_start`, jsonb shape checks
  (`qualification_rules`/`retention_benchmarks` objects,
  `application_checklist` array); one-active partial unique index.
- `ngrp_cycle_source_cohorts` - unique `(cycle_id, cohort_id)`, created_at +
  `created_by_profile_id`; cycle CASCADE, cohort RESTRICT.
- `ngrp_candidates` - no denormalized `cohort_id` (the student row and the
  mapping table are the truth); override requires nonblank reason + stable
  `eligibility_overridden_by_profile_id` + timestamp (typed name is display
  only); application state/timestamp coherence CHECK; unique
  `(cycle_id, student_id)` plus a composite identity index for the outcomes
  FK; cycle RESTRICT (a cycle with attempts cannot be deleted).
- `ngrp_residency_outcomes` - minimal durable employment facts (offer,
  acceptance, hire, unit, start, separation as distinct timestamps;
  acceptance requires offer, separation requires hire); ALL FKs RESTRICT so
  deleting a student/candidate/cycle can never silently erase employment
  history; composite FK to `(candidate id, student, cycle)` makes a
  candidate/outcome mismatch unrepresentable; no service-role DELETE grant.

Security: RLS enabled on all four with NO policies; `REVOKE ALL ... FROM
PUBLIC, anon, authenticated`; explicit service_role grants. No browser
read/write path exists, so the S-22 class of inactive-role policy bypass has
no surface. Verification SQL checks ACTUAL privileges with
`has_table_privilege`, plus structure and zero-row (nothing seeded - no
demonstration cycles). Preflight includes the read-only legacy snapshot
(`db/audit/ngrp_legacy_reconciliation_checks.sql`); legacy `ngrp_outcomes`
and `students.ngrp_*` are untouched and never trusted until Jester reviews
that snapshot and approves an explicit mapping.

## Verification

- `node --test test/ngrpWorkspace.test.mjs` - 36 tests: scope, cycle
  chronology + prior-outcome matrix, truthful mapping states, selector
  ordering, authorization, database-security (static), header presentation,
  and reliability suites.
- `npx eslint <all NGRP modules>` - clean.
- `npx vite build` - client production bundle builds.
- SSR/public prerender (`npm run build` tail) requires production env vars
  that are absent locally (`.env.local` values are empty; the known
  Vercel-pull gotcha) - reported separately, not an NGRP defect; no
  credentials were retrieved.

## Release 2 (NGRP-RELEASE-2): Planning + Transition Form

Built on branch `ngrp-planning-transition-1`. Migration
`20260904000000_ngrp_planning_transition.sql` is **NOT applied** (Owner SQL
gate); until it is, everything from Release 1 keeps working, Planning can
manage cycle basics/sources, and every persisted form action disables itself
with the reason (`transitionProvisioned:false`).

**Planning** (`src/components/ngrp/PlanningTab.jsx` + `api/ngrp-manage.js`):
first-time "Create residency cohort" flow (Planning is never blocked by the
no-cohorts guard; other tabs explain the requirement), then six card
sections - basics (approved status vocabulary; status is always an explicit
staff action, gated by open-readiness), source ASPIRE cohorts (chronological
chips; an open cohort can never drop to zero sources), participating units
(unit_name reuse with canonical suggestions; active/order/capacity; the ONLY
source of form ranked preferences), eligibility rules (GPA/experience/
completion-window/NCLEX-exception/accreditation + conditional licensure
deadline; changing engine inputs recalculates the cycle), the structured
application checklist, and retention benchmarks (config only). Per-section
unsaved-changes chips with confirm-to-discard; consequential actions go
through review/confirm dialogs; every change is audited.

**Transition Form** (`lib/server/ngrpTransition.js`, `api/ngrp-transition-send.js`,
`api/ngrp-transition.js`, `src/pages/NgrpTransitionFormPage.jsx`):
- Send: NGRP → Applicants selection hands off via
  `LAUNCH_KINDS.NGRP_TRANSITION_FORM` to Connect → Outreach → Send to Many,
  where the registered `ngrp_transition_form_invitation` template renders a
  dedicated server-minted panel (`NgrpTransitionSendPanel`) - never the
  manual composer. Server preview classifies first-sends / re-sends / skips;
  typed `SEND MESSAGES` confirmation; sequential provider loop with DURABLE
  batch idempotency: `ngrp_transition_deliveries` (UNIQUE batch+candidate)
  is the fail-closed idempotency authority, a Resend `Idempotency-Key`
  (batch+candidate) backstops process retries after acceptance, and the
  per-success `notification_log` row (`ngrp_transition_form_sent`, hash
  prefix only, registered in Sent History as a secure-link type) is a
  display ledger only - its failure is a reported warning, never a false
  "failed". SEND-TRUTH: an assignment is born `pending` and becomes Sent
  only when the provider ACCEPTED the email (`ngrp_activate_token_tx`);
  the `form_sent`/`token_resent` audit event is written inside that same
  transaction.
- Tokens: minted via the evaluation module (32-byte base64url, HMAC with
  `EVALUATION_TOKEN_PEPPER`); only `token_hash` + 8-char hash prefix persist.
  Delivery-safe state machine: `pending → active | failed`, `active →
  revoked`; a resend PREPARES a pending replacement while the old link stays
  active, provider acceptance atomically activates-new/revokes-old
  (`ngrp_activate_token_tx`), and provider failure fails the pending token
  and keeps the old link working (`ngrp_fail_token_tx`) - a failed resend
  never strands the alumnus without a working link. One ACTIVE token per
  assignment (DB partial unique); the public endpoint resolves ACTIVE
  tokens only; staff revocation always by token id.
- Public form `/ngrp/transition#t=<token>`: fragment-only token (stripped on
  load), 8-step endpoint order with fail-closed rate limits, identical 410
  for unknown/pending/failed/revoked, server-enforced effective close: the
  configured closing date means 11:59:59.999 PM America/Los_Angeles
  (DST-aware; `pacificEndOfDay` in JS = `ngrp_pacific_deadline` in SQL), the
  ONE rule shared by enforcement, email copy, page display, and readiness.
  Closure is checked BEFORE any first-use/Opened bookkeeping. Lifecycle
  sent → opened → in_progress → submitted → revised; autosave runs through
  `ngrp_save_draft_tx` (draft + lifecycle atomic; saved:true only on
  commit); submission runs through `ngrp_submit_revision_tx` (locked serial
  revision number, in-transaction deadline, revision + lifecycle + interest
  + eligibility + requirement rows + draft cleanup + audit, all-or-nothing);
  the server requires every fact the active rules calculate with (real
  calendar dates included) so a submitted form is never eligibility-Pending;
  immutable numbered revisions (no UPDATE/DELETE privilege exists);
  revisable until close; expiration retains submissions for staff review.
  Form contact answers stay in the revision - never written back to the
  student profile.
- Planning writes are transactional too: `ngrp_cycle_create_tx` (ids
  validated before the cycle exists), `ngrp_cycle_set_active_tx`,
  `ngrp_sources_set_tx`, `ngrp_units_set_tx` - locked, audited
  in-transaction, all-or-nothing. Cycle-wide recalculation reports partial
  failure and never writes a success audit for one.
- Eligibility: explainable engine (`lib/server/ngrpEligibility.js`) with
  per-code reasons + deadlines, run on submit and on engine-config change;
  calculated vs effective override unchanged from Release 1; support
  participation is not an input.
- Applicants/drawer now render the real lifecycle (composed server-side from
  assignments + latest-revision preferences), with working send/resend,
  review-submitted-form, override, confirm-application (still the only path
  to Confirmed), withdraw, and revoke-link actions.

Apply/verify/rollback for `20260904000000` live in the migration file:
eight server-only tables + ten server-only functions, explicit service_role
REVOKEs before every grant (the outcomes lesson), preflight P1-P5,
verification V1-V3 (`has_table_privilege` + `has_function_privilege`, V1
policy check names the exact eight tables - never `LIKE 'ngrp_%'`), rollback
that drops the functions and never destroys revisions or audit rows without
export.

## Remaining future phases

Phase-2 writers (cycle-manage incl. source-cohort mapping editor in
Planning, send-transition-form + Connect template + token infrastructure,
public transition form, eligibility engine, override/confirm/withdraw/
assign/interview recorders), Support/Planning/Interviews/Residency/
Evaluation tab bodies, legacy reconciliation (after Jester's review of the
audit output), candidate audit-event table.
