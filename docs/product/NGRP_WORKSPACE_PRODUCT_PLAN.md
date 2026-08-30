# NGRP Workspace: Product and Delivery Plan

Date: 2026-08-28  
Status: Product plan only. No application code, migration, SQL, or production data changed.

## 1. Product outcome

Add an NGRP workspace inside ASPIRE Intelligence that follows an ASPIRE alumnus from completed senior rotation through New-Graduate RN Residency application, interview, hire, mentorship, evaluation, and retention.

The first release serves the ASPIRE team. It uses existing ASPIRE alumni records and does not create a second alumni directory. Jenn and Robert's HR portal is deferred until the internal workflow establishes which information HR needs.

### Success criteria

- Jester can see every completed alumnus across all ASPIRE cohorts mapped to the selected NGRP residency cycle and identify who still needs the Transition Form.
- ASPIRE Connect can send one secure Transition Form link to each selected alumnus through **Outreach > Send to Many**.
- Form, interest, eligibility, application, unit, and interview indicators update without reopening the student record.
- The app distinguishes interest and readiness from a confirmed NGRP application.
- Support activities remain optional and never change eligibility.
- Owner, Admin, and Co-Lead can manage NGRP records. Other roles receive only the explicitly assigned access described below.
- The app measures the full conversion path and retention without implying that support activities caused an outcome.

## 2. Decisions already approved

- Population: ASPIRE alumni whose student records already exist in ASPIRE Intelligence.
- Entry into applicant counts: only an alumnus marked **Application Confirmed** counts as an NGRP applicant.
- Roster scope (corrected 2026-08-30): Applicants shows every completed alumnus from ALL ASPIRE cohorts mapped to the selected NGRP residency cycle (via `ngrp_cycle_source_cohorts`), including people who have not received the form. The internal ASPIRE-cohort filter narrows that combined roster; it never defines it. An alumnus already hired through an earlier NGRP cycle (durable `hired_at` in `ngrp_residency_outcomes`) is excluded; a prior application, interview, no-offer, or withdrawal without a hire never excludes anyone, and a later separation does not re-open prospect status.
- Neutral state: **Not applied** and **Not confirmed** are neutral. They are not failures, demerits, or negative outcomes.
- Form delivery: Jester sends the Transition Form manually from ASPIRE Connect through a reusable Send to Many template.
- Form hosting: ASPIRE hosts the form through a secure, tokenized link. Alumni do not need portal access.
- Form revision: an alumnus can save, submit, reopen, and revise the form until the cycle deadline. The app shows the latest submission time and preserves prior submitted revisions.
- Unit preferences: the form collects three ranked units from the units participating in that residency cycle.
- HR assignment: HR eventually assigns one unit and one interview. A preference is not an assignment.
- Eligibility: the app calculates explainable **Eligible**, **Conditionally Eligible**, or **Not Eligible** results. A neutral **Pending** state appears before sufficient information exists.
- Conditional licensure: an applicant may be conditionally eligible when NCLEX is scheduled and licensure can be completed by the cycle's licensing deadline. The default deadline is 21 days before the interview window.
- Preceptor evidence: reuse the existing end-of-rotation preceptor evaluation. Do not send a second preceptor survey.
- HR-facing preceptor result: HR eventually sees only an approved summary of **Recommended**, **Recommended with considerations**, or **Unable to recommend**. HR never sees raw preceptor answers.
- Support: resume review, Town Hall, Interview Bootcamp, and mentorship are optional ASPIRE benefits. Participation does not affect eligibility.
- Mentorship: weekly check-ins begin after residency starts. A submitted check-in creates a follow-up task for Jester.
- Retention: retained means still employed at Cedars-Sinai as an RN at 3, 6, or 12 months.
- Benchmarks: compare retention with a cycle-specific traditional residency benchmark and an organization-wide benchmark.
- HR portal: pause design and implementation until the internal workflow is operating. Preserve a future HR access boundary in the data model.

## 3. Information architecture

### 3.1 Workspace switcher

Add an explicit header switcher:

- **ASPIRE** opens the existing A-SP-I-R-E student-placement workspace.
- **NGRP** opens the new alumni-to-residency workspace.

Do not switch workspaces based on vertical scrolling or gestures. Preserve direct URLs, browser navigation, keyboard navigation, and a clear active-workspace label.

Recommended routes:

| NGRP tab | Route | Purpose |
|---|---|---|
| Applicants | `/ngrp/applicants` | Cohort roster, Transition Form, eligibility, interest, application state |
| Support | `/ngrp/support` | Resume review, Town Hall, Bootcamp, and mentorship participation |
| Planning | `/ngrp/planning` | Residency cycles, deadlines, participating units, events, requirements, benchmarks |
| Interviews | `/ngrp/interviews` | Assigned unit, schedule, interviewers, result, and follow-up |
| Residency | `/ngrp/residency` | Offer, acceptance, hire, unit, start date, orientation, and mentorship |
| Evaluation | `/ngrp/evaluation` | Preceptor summary, Bootcamp change, resident surveys, and retention |

The NGRP navigation spells ASPIRE:

- **A** Applicants
- **S** Support
- **P** Planning
- **I** Interviews
- **R** Residency
- **E** Evaluation

### 3.2 Scoping model

Use a residency-cycle selector as the primary NGRP scope. One NGRP cycle can include alumni from multiple ASPIRE cohorts.

Use ASPIRE cohort as a filter inside Applicants. This lets Jester answer, "Which Summer 2026 alumni still need the form?" without incorrectly tying the whole residency cycle to Summer 2026.

The cycle-to-cohort relationship is an explicit many-to-many mapping table, `ngrp_cycle_source_cohorts` (one row per `(cycle_id, cohort_id)`, unique, with created-at and actor audit; no duplicated cohort names or student identity). Planning manages the mappings; the Applicants read contract resolves them server-side, so the roster is never derived from whichever single cohort the ASPIRE workspace has loaded. In the header, the NGRP workspace swaps the ASPIRE cohort picker for an "NGRP Residency Cycle" picker; the two selections are separate state (per-authenticated-user cycle preference), and switching workspaces never changes the other side's pick.

Recommended selector behavior:

- Default to the current active NGRP cycle.
- Sort cycles chronologically by application opening date, then residency start date.
- Show closed cycles after active and planned cycles.
- Preserve the last selected NGRP cycle per authenticated staff user.
- Keep cohort, school, status, and search filters in the URL so views are shareable and restorable.

## 4. Role and privacy model

| Actor | NGRP access |
|---|---|
| Owner | Full management, overrides, release of preceptor summary, reporting, and configuration |
| Admin | Full day-to-day NGRP management, excluding Owner-only governance decisions |
| Co-Lead | Full NGRP workflow management and student-level access; no platform governance |
| Interviewer | No general NGRP workspace access. An assigned NGRP interview can later expose only that interview and its permitted rubric |
| Viewer | No NGRP access in the initial release |
| Alumnus | Token-scoped access only to their Transition Form or assigned check-in/evaluation form |
| HR | Deferred portal. Future access comes from an explicit HR grant, not staff-role inference |

Server authorization must enforce these rules. Hiding a button is not authorization.

### Privacy boundaries

- Never expose another alumnus through a tokenized form link.
- Never store a raw form token. Store only a keyed hash and a short nonsecret prefix for support.
- Never copy a Transition Form contact correction into the master student profile silently. Show the difference and require an explicit staff reconciliation action.
- Never expose raw preceptor evaluation answers to HR.
- Keep narrative mentorship and evaluation responses out of aggregate exports.
- Log eligibility overrides, preceptor-summary releases, application confirmation, unit assignment, and retention changes with actor and timestamp.

## 5. Applicants tab

Applicants is the operational starting point and the default NGRP route.

### 5.1 Page structure

1. Show the active residency cycle and cycle dates.
2. Show KPI cards that filter the roster:
   - Completed ASPIRE alumni
   - Form not sent
   - Form submitted
   - Eligible
   - Conditionally eligible
   - Application confirmed
3. Show search and filters for ASPIRE cohort, school, interest, eligibility, application, assigned unit, and interview state.
4. Show the alumni roster.
5. Open a detail drawer for the selected alumnus. Keep context in the roster instead of navigating away.

### 5.2 Roster columns

| Column | Behavior |
|---|---|
| Alumnus | Photo, full name, school, program, and ASPIRE cohort |
| Transition Form | Not sent, sent, opened, in progress, or submitted; include latest timestamp |
| Interest | Interested, undecided, not interested, or no response |
| Eligibility | Pending, eligible, conditional, or not eligible; show reason tooltip |
| Application | Neutral not confirmed, confirmed, or withdrawn |
| Assigned unit | HR-assigned unit only; never substitute a ranked preference |
| Interview | Not scheduled, scheduled, completed, cancelled, or no interview |
| Updated | Most recent relevant workflow change |

Default sort order:

1. Application confirmed
2. Interested and eligible
3. Interested and conditionally eligible
4. Submitted but pending review
5. Form sent but incomplete
6. Form not sent
7. Not interested or withdrawn

Allow Student A-Z, cohort timeline, school, eligibility, and most-recently-updated sorts.

### 5.3 Indicator language and color

- Green check: eligible, submitted, confirmed, completed, hired, or retained.
- Amber clock: conditional, due, pending requirement, or scheduled.
- Blue information icon: sent, opened, interested, or assigned.
- Red alert: not eligible, expired requirement, missed deadline, or failed delivery.
- Gray dash: no action, no response, or not confirmed. Gray states remain neutral.

Color must never be the only signal. Pair every color with text and an icon.

### 5.4 Real-time behavior

- Invalidate the Applicants queries immediately after staff actions.
- Publish form-send, form-open, draft-save, form-submit, revision, and application-confirmation events.
- Subscribe the open roster to authorized changes where the existing Supabase Realtime posture permits it.
- Use a quiet periodic refetch as a fallback. Do not generate a toast for routine background refreshes.
- Deduplicate status notifications. Never repeat the draft-restored toast defect that previously made the Interviews screen unusable.

## 6. Transition Form

### 6.1 Public route and lifecycle

Recommended public route: `/ngrp/transition/:token`.

Lifecycle:

`Not sent -> Sent -> Opened -> In progress -> Submitted -> Revised`

- **Submitted** is not **Application Confirmed**.
- Reopening before the deadline does not erase the submitted revision.
- A new submission creates a revision and moves the assignment's latest-submitted pointer.
- Expiration blocks new changes but preserves the submitted response for staff review.
- Revoking or resending a link revokes the old token and creates a new token against the same assignment.

### 6.2 Form sections

1. **Identity and contact**
   - Prefilled alumnus identity
   - Preferred contact information
   - Current Cedars-Sinai employment status
2. **Education**
   - School and nursing program
   - Degree type
   - Program completion or graduation date
   - Nursing GPA
   - US program and accreditation confirmation when required
3. **ASPIRE experience**
   - ASPIRE cohort
   - Precepted unit
   - Completed rotation hours or shifts
   - Prior NGRP application history
4. **Licensure and certifications**
   - California RN license status and number when issued
   - NCLEX scheduled date when pending
   - Months of paid RN experience as of application date
   - BLS status, issuer, and expiration
   - ACLS status, issuer, and expiration when applicable
5. **Residency interest**
   - Interested, undecided, or not interested
   - Three ranked units from the active cycle's participating-unit list
   - Interest and strengths responses
6. **Application readiness**
   - Online application
   - Resume with facility, unit, and clinical hours
   - Personal statement of no more than two pages
   - Transcript with completion date
   - Two recommendation letters
7. **Attestation**
   - Accuracy confirmation
   - Consent to ASPIRE follow-up

### 6.3 Save and revision rules

- Autosave a draft after validated field changes.
- Show the last saved time.
- Allow submission only when the required fields for calculation are complete.
- Allow revisions until the cycle deadline.
- Show staff the submitted revision, revision count, and last submitted time.
- Preserve every submitted revision for audit. Draft autosaves may update the active draft in place.

## 7. Eligibility engine

The engine returns a result and explicit reason codes. It does not return an unexplained score.

### 7.1 Results

- **Pending:** the form is missing information required for calculation or has not been submitted.
- **Eligible:** every active cycle requirement passes.
- **Conditionally Eligible:** every hard rule passes except one or more requirements that the cycle permits the alumnus to complete before a configured deadline.
- **Not Eligible:** at least one hard rule fails or a conditional requirement misses its deadline.

### 7.2 Default qualification rules

- Active California RN license by the application date, unless the cycle permits the NCLEX exception.
- Fewer than 9 months of paid RN experience on the application date.
- Nursing GPA of at least 3.0.
- For external applicants, at least an ADN from an accredited US program under the configured accreditation rule.
- Nursing program completed within 12 months before the application date.
- Active BLS and any unit-required ACLS from an accepted issuer by the configured deadline.

### 7.3 Conditional rules

- Default licensing deadline: 21 days before the interview window begins.
- A scheduled NCLEX can produce **Conditionally Eligible** only when all other hard rules pass and the scheduled date is on or before the licensing deadline.
- A cycle can designate another requirement as conditionally satisfiable and assign its deadline.
- The app recalculates the result whenever source facts, cycle rules, or deadlines change.

### 7.4 Overrides

Owner, Admin, and Co-Lead can override an eligibility result. Require:

- Replacement result
- Reason category
- Narrative note
- Actor and timestamp

Show both calculated and effective results. Never overwrite the calculated result with the override.

## 8. Application confirmation

Use this sequence:

`Transition Form Sent -> Submitted -> Eligibility Calculated -> Application Confirmed`

Jester or authorized HR staff confirms the application after matching ASPIRE responses against the official applicant list. A form submission or an eligible result never confirms an application automatically.

Each alumnus can participate in multiple NGRP cycles. Store each cycle attempt separately under one alumnus profile.

## 9. Support tab

Track optional ASPIRE services without using them as eligibility criteria.

### 9.1 Pre-hire activities

- Resume review: not offered, offered, requested, scheduled, completed, declined
- Town Hall: invited, registered, attended, absent
- Interview Bootcamp: invited, registered, attended, completed
- Bootcamp pre- and post-assessment assignment status

### 9.2 Post-hire mentorship

- Start mentorship on the residency start date.
- Schedule a weekly secure check-in form.
- Create one follow-up task for Jester when a check-in is submitted or an answer crosses an escalation rule.
- Track response sent, touchpoint date, channel, follow-up status, and next due date.
- Allow Jester to record an email, call, meeting, or manual check-in.
- Stop or pause the schedule when the resident separates, completes the mentorship period, or Jester pauses it.

Support reporting can compare participants and nonparticipants, but labels must say **observed association**, not program-caused improvement.

## 10. Planning tab

Planning owns NGRP cycle configuration. It does not record individual participation.

### 10.1 Cycle configuration

- Cycle name and status: planning, accepting interest, application open, application closed, interviews, offers, residency active, completed, archived
- Application opening and closing dates
- Interview window
- Licensing deadline
- Residency start date
- Participating units
- Unit capacity when HR provides it
- Qualification and conditional-requirement rules
- Required application checklist
- Traditional residency retention benchmark
- Organization-wide retention benchmark

### 10.2 Events

Reuse the existing `program_events` and calendar foundation where possible. Add a cycle relationship instead of creating a second calendar system.

Planning configures Town Halls, Bootcamps, application dates, interview windows, orientation, workshops, and milestones. Support records each alumnus's attendance or completion against those events.

## 11. Interviews tab

- Show application-confirmed candidates by default.
- Store one HR-assigned unit for the primary NGRP interview.
- Preserve the three ranked preferences separately for comparison.
- Track schedule, interviewer, location or meeting link, completion, result, and notes.
- Allow Jester to enter or correct HR-provided data.
- Keep NGRP interview rubrics separate from ASPIRE student interview rubrics unless a deliberate shared instrument is approved.
- If interviewers receive access later, they can view and edit only their assigned interview record and their own rubric. Owner, Admin, and Co-Lead retain full access.

Recommended interview states:

`Not assigned -> Assigned -> Scheduled -> Completed -> Decision recorded`

Terminal alternatives: cancelled, applicant withdrew, no interview, no show.

## 12. Residency tab

Track the employment outcome and mentorship context:

- Offer status and date
- Offered unit and shift
- Offer accepted or declined
- Hire status and hire date
- Final hired unit
- Residency start date
- Eight-week or 24-shift orientation summary when available
- Permanent-assignment date
- Mentorship state and next check-in
- Separation date and reason when applicable

The initial release does not need to reproduce the full residency learning-management system or all 13 workshops. Planning can hold major workshops as events. Expand workshop-level tracking only after the workflow proves that ASPIRE owns that data.

## 13. Evaluation tab

### 13.1 Measures

- Existing end-of-rotation preceptor hiring recommendation
- Approved preceptor summary for HR
- Interview Bootcamp pre- and post-assessment
- Resident experience at 3, 6, and 12 months
- Employment retention at 3, 6, and 12 months
- Traditional residency benchmark
- Organization-wide benchmark

### 13.2 Retention definition

A resident is retained at a checkpoint when the person remains employed at Cedars-Sinai as an RN on the checkpoint date.

Track employment status separately from survey completion. A missing survey response is not a separation. A separation entered after a checkpoint triggers deterministic recalculation for all affected checkpoints.

### 13.3 Funnel and outcome measures

- Completed ASPIRE alumni
- Transition Form sent
- Transition Form submitted
- Interested
- Eligible or conditional
- Application confirmed
- Interviewed
- Offered
- Hired
- Retained at 3, 6, and 12 months

Every KPI must show its denominator and cycle scope. Support-impact comparisons remain observational.

## 14. Recommended data model

Use additive, cycle-centered tables. Do not overload the existing cohort or student record with every NGRP state.

| Table | Purpose |
|---|---|
| `ngrp_cycles` | Cycle dates, state, deadlines, requirements, and benchmark configuration |
| `ngrp_cycle_source_cohorts` | Which ASPIRE cohorts feed a cycle (explicit many-to-many, unique per pair, audit columns; managed by Planning) |
| `ngrp_cycle_units` | Participating units, display order, active state, and optional capacity |
| `ngrp_candidates` | One alumnus attempt per student and cycle; interest, calculated/effective eligibility, application state |
| `ngrp_transition_assignments` | Form lifecycle, deadline, latest revision, and send state |
| `ngrp_transition_tokens` | Hashed token metadata, expiration, revocation, and first-use audit |
| `ngrp_transition_drafts` | Current autosaved draft for an assignment |
| `ngrp_transition_revisions` | Immutable submitted revisions and derived eligibility inputs |
| `ngrp_candidate_requirements` | Requirement result, evidence state, deadline, and reason per candidate |
| `ngrp_support_activities` | Cycle-level support offering or event definition |
| `ngrp_support_participation` | Candidate-level invitation, registration, attendance, and completion |
| `ngrp_interviews` | Assigned unit, schedule, interviewer, result, and notes |
| `ngrp_residency_outcomes` | Offer, acceptance, hire, unit, start, orientation, and separation |
| `ngrp_mentor_checkins` | Check-in assignment, response state, escalation, and staff follow-up |
| `ngrp_retention_checkpoints` | Due date, employment result, survey state, benchmark snapshot |
| `ngrp_audit_events` | Allowlisted workflow event type, actor, entity, timestamp, and safe metadata |

### Existing `ngrp_outcomes` table

The repository already contains a legacy `ngrp_outcomes` table and student-level `ngrp_outcome` fields. Treat them as legacy sources, not the new source of truth.

Before migration:

1. Inspect the live table definition, constraints, policies, row counts, and distinct values.
2. Reconcile student-level fields with `ngrp_outcomes` rows.
3. Map trustworthy history into cycle-centered rows.
4. Preserve unresolved conflicts in a reconciliation report.
5. Keep legacy columns readable during transition.
6. Remove or retire legacy writes only after production parity is verified.

Do not drop legacy data in the first NGRP migration.

## 15. ASPIRE Connect integration

Add a reusable Send to Many template such as `ngrp_transition_form_invitation`.

The template should:

- Use students or alumni as the recipient source.
- Accept selected rows from Applicants as a launch context.
- Create one candidate and one form assignment per student and cycle idempotently.
- Generate one raw token per recipient on the server.
- Store only the token hash.
- Insert the recipient-specific secure link at send time.
- Use the existing bulk chunking and delivery reporting pattern.
- Report delivered, failed, and skipped recipients honestly.
- Return to Applicants with the cycle and cohort filters preserved.

Sending the template means **Transition Form Sent**, not **Invited to Apply**.

## 16. Automation plan

Add automation only after the manual workflow is stable.

| Automation | Trigger | Result |
|---|---|---|
| Form reminder | Sent or opened, incomplete, before deadline | One idempotent reminder delivery |
| Conditional eligibility recheck | Requirement or cycle deadline changes | Recalculate eligibility and reason codes |
| Interview reminder | Scheduled interview approaches | Recipient-specific reminder and delivery record |
| Weekly mentor check-in | Hired, residency started, mentorship active | Create and send one tokenized check-in assignment |
| Retention checkpoint | 3, 6, or 12 months after residency start | Create due checkpoint and optional resident survey |
| Staff follow-up | Check-in submitted or escalation rule met | Create one deduplicated task for Jester |

Every cron uses an idempotency key and durable delivery state. Re-running a cron must not create duplicate assignments, emails, tasks, or toasts.

## 17. Phased delivery

### Phase 0: Product specification and Fable design gate

Deliver:

- This plan as the product source of truth
- Canonical status dictionary and role matrix
- Fable concepts for the workspace switcher, Applicants roster, detail drawer, Planning setup, and later Placement Board
- Desktop and responsive states using the app's canonical width, spacing, typography, masthead, KPI cards, tables, and drawers

Exit gate:

- Jester approves the workspace switcher and Applicants screen.
- Design does not invent unapproved fields, permissions, or actions.

### Phase 1: Foundation

Deliver:

- Additive cycle-centered schema and RLS
- Server authorization and API foundations
- ASPIRE | NGRP workspace switcher
- Six-tab NGRP route shell
- Cycle selector and Planning minimum viable configuration
- Legacy NGRP reconciliation report

Exit gate:

- Owner, Admin, and Co-Lead access works server-side.
- Existing ASPIRE tabs and routes behave unchanged.
- No legacy NGRP data is deleted.

### Phase 2: Applicants and Transition Form

Deliver:

- Completed-alumni roster
- KPI filters, search, sort, indicators, and detail drawer
- Tokenized Transition Form with autosave and immutable submissions
- Eligibility engine and overrides
- Send to Many template and delivery integration
- Application confirmation workflow
- Quiet live refresh

Exit gate:

- Jester can select alumni, send the form, observe its lifecycle, review eligibility, and confirm official applications.
- A repeated send does not create duplicate candidate attempts.
- Not applied remains visually and semantically neutral.

### Phase 3: Planning and Support

Deliver:

- Full cycle configuration
- Participating units and deadlines
- Event relationships
- Resume review, Town Hall, and Bootcamp participation
- Bootcamp pre/post survey assignments

Exit gate:

- Support participation cannot alter eligibility in the UI, API, or database functions.
- Individual participation and cycle event configuration remain separate.

### Phase 4: Interviews and Residency

Deliver:

- Internal unit assignment and interview tracker
- Interview schedule and results
- Offer, acceptance, hire, unit, start, and separation tracking
- Weekly mentorship assignments and Jester follow-up tasks

Exit gate:

- The record preserves preferences, HR assignment, interview, offer, and hire as distinct facts.
- Mentorship starts only after residency starts.

### Phase 5: Evaluation and reporting

Deliver:

- Approved preceptor summary release
- Bootcamp comparison
- Resident 3/6/12-month evaluations
- Retention checkpoints and benchmarks
- Funnel, cohort, unit, school, and support-participation reporting
- Aggregate CSV exports without narrative responses

Exit gate:

- Retention is based on employment, not survey completion.
- Every metric shows its denominator and scope.
- Support comparisons use noncausal language.

### Phase 6: HR portal discovery and implementation

Begin only after Phases 2 through 4 establish the internal workflow.

Candidate high-level surfaces for discovery:

- Aggregate At a Glance
- Application-confirmed candidates
- Requirements checklist
- Placement Board for one unit and one interview
- Interview calendar
- Offers and hired residents
- Residency and mentorship calendar
- Retention summaries

Decide Jenn and Robert's exact tabs, record detail, edit rights, exports, and preceptor-summary access before building the portal.

## 18. Fable design brief

Use Claude/Fable for visual exploration, not for permission or data-model decisions. Fable may decide the best visual treatment within the boundaries below.

```text
Design a new NGRP workspace inside the existing ASPIRE Intelligence application.

Context
ASPIRE currently uses a top header and an A-SP-I-R-E navigation set for At a Glance, Student Profiles, Interviews, Rotation, and Evaluation. Add an explicit ASPIRE | NGRP workspace switcher. NGRP uses six tabs that also spell ASPIRE: Applicants, Support, Planning, Interviews, Residency, and Evaluation.

Primary design target
Design the NGRP Applicants tab first. It is a real-time operational roster of every completed ASPIRE alumnus across the ASPIRE cohorts mapped to the selected NGRP residency cycle. Jester uses it to decide who needs a secure Transition Form and to monitor progress.

Required Applicants content
- Primary NGRP cycle selector
- ASPIRE cohort filter, school filter, search, and sort
- KPI filter cards for Completed Alumni, Form Not Sent, Form Submitted, Eligible, Conditionally Eligible, and Application Confirmed
- Roster columns for alumnus, Transition Form, interest, eligibility, application, assigned unit, interview, and last update
- Profile photo, full name, school, program, and ASPIRE cohort
- A detail drawer that preserves the table context
- Bulk selection and a Send Transition Form action that hands recipients to ASPIRE Connect > Outreach > Send to Many
- Clear distinctions between ranked unit preferences, HR-assigned unit, and interview state

State language
- Not applied and not confirmed are neutral gray states, never failures
- Green check: positive completion or eligibility
- Amber clock: conditional, due, or scheduled
- Blue information: sent, opened, interested, or assigned
- Red alert: not eligible, expired requirement, missed deadline, or failed delivery
- Every color must include text and an icon

Visual constraints
- Follow the current ASPIRE canonical content width. Do not stretch edge to edge.
- Reuse the existing Nightfall header, DM Sans typography, pastel KPI cards, hover lift, tables, drawers, pills, and light-blue profile treatment.
- Keep the interface calm and information-dense. Avoid oversized cards and decorative charts that do not support a decision.
- Keep the selected roster and filtered table visible after a KPI click.
- Freeze the table header during vertical scrolling.
- Support laptop, wide desktop, and narrow responsive views.
- Preserve keyboard navigation, focus states, contrast, and noncolor status cues.

Autonomy
Choose the strongest layout, spacing, grouping, iconography, and responsive behavior. You may propose a better visual hierarchy when it preserves every workflow and permission boundary above. Do not invent new statuses, automatic application confirmation, eligibility rules, or HR access.

Also provide lighter concepts for:
1. The ASPIRE | NGRP workspace switcher
2. Planning cycle setup
3. An internal one-unit interview assignment board
4. Residency and mentorship timeline
5. Evaluation and retention dashboard

Deliver desktop mockups, responsive behavior notes, component annotations, interaction states, empty/loading/error states, and a short rationale for the chosen Applicants layout.
```

## 19. Migration and release sequence

1. Run read-only preflight queries against live NGRP, student, cohort, evaluation, event, and access tables.
2. Create a reconciliation report for legacy `students.ngrp_*` fields and `ngrp_outcomes`.
3. Apply additive cycle, candidate, form, and audit tables with service-role writes and explicit staff read policies or server-only access.
4. Deploy server endpoints before exposing client actions.
5. Add the NGRP shell behind an Owner-controlled feature gate.
6. Verify role, route, and cohort isolation with synthetic records.
7. Enable Applicants for Owner first.
8. Enable Admin and Co-Lead after acceptance testing.
9. Backfill verified legacy outcomes into cycle attempts.
10. Retire legacy write paths only after reconciliation and parity checks pass.

Do not combine a destructive cleanup with the foundation migration. Every migration package must include preflight, verification, and rollback guidance.

## 20. Verification matrix

### Authorization

- Owner, Admin, and both Co-Lead spellings receive intended access.
- Interviewer, Viewer, portal roles, anon, and inactive staff fail closed.
- Form tokens resolve one assignment only.
- Raw preceptor responses never reach HR-facing payloads.

### Form and Outreach

- Bulk sends create one assignment per student and cycle.
- Repeated requests are idempotent.
- A failed delivery does not show as delivered.
- Old tokens stop working after revoke or resend.
- Autosave does not create submitted revisions.
- Revision history survives later edits.
- Deadline enforcement occurs server-side.

### Eligibility

- Boundary tests cover GPA 2.99 and 3.00, paid RN experience below and at 9 months, program completion at and beyond 12 months, licensing dates, NCLEX deadlines, and certification expiration.
- Missing information remains Pending.
- Conditional results show reasons and deadlines.
- Overrides preserve the calculated result and audit record.

### Workflow integrity

- Submitted does not become Application Confirmed automatically.
- Preferences do not become assignments automatically.
- Support participation does not change eligibility.
- Survey nonresponse does not become separation.
- One alumnus can have separate attempts in multiple cycles.

### UI and reliability

- KPI cards filter without hiding the roster below.
- Table header remains visible while scrolling.
- Background refresh does not create repeated toasts.
- Empty, loading, stale, offline, and error states remain usable.
- The ASPIRE workspace continues to load and route unchanged.

## 21. Product risks and controls

| Risk | Control |
|---|---|
| Cohort and residency cycle are treated as the same entity | Use a primary cycle selector and separate cohort filter |
| Legacy NGRP fields conflict with the new workflow | Reconcile before backfill; preserve unresolved conflicts |
| Form submission is mistaken for an official application | Require explicit Application Confirmed action |
| Neutral alumni states feel punitive | Use gray text/icon states and neutral labels |
| Eligibility appears arbitrary | Show rule result, reason, deadline, and override history |
| Support participation becomes an unintended requirement | Enforce separation in schema, API, UI, and tests |
| Preceptor feedback leaks | Release an approved summary only; keep raw response privileged |
| Cron retries create duplicates | Use durable idempotency keys and unique constraints |
| HR portal is built around assumptions | Defer it until internal usage produces evidence |
| Fable invents behavior | Treat this document as the workflow and permission contract |

## 22. Recommended first implementation package

Start with Phase 0 and the non-destructive portion of Phase 1:

1. Approve the Fable Applicants concept and workspace switcher.
2. Audit the live NGRP schema with read-only preflight queries.
3. Produce the additive foundation migration and verification SQL.
4. Build the NGRP route shell and cycle selector behind a feature gate.
5. Stop for migration approval and visual acceptance before building the tokenized form.

This sequence resolves the two highest-risk decisions first: cycle-centered data and the daily Applicants workflow.
