# Phase 0A Access Audit: Routes, Auth, API, Grants, Policies, Workflow Dependencies

Status: complete as a repository-evidence audit. Live-state confirmation requires the
Owner to run the read-only script at `db/audit/phase0a_live_state_audit.sql` in the
Supabase SQL editor and share the output. No schema, policy, data, or code changes were
made by this audit.

Date: 2026-07-12
Baseline commit at audit start: f46a324df18ea260c4b1fb5787f80b7c9d5f0b47
Scope: ASPIRE Intelligence production application (aspireintelligence.app)

## Classification definitions

- verified: confirmed in repository code or SQL, and the mechanism is fully traceable.
- partially verified: created by tracked SQL and never dropped by tracked SQL, or a
  dependency inferred from code, but the live database may differ (dashboard changes
  are invisible to the repository). Requires the live-state script to confirm.
- suspected: inferred from convention or absence of evidence. Requires live-state
  confirmation before any remediation is applied.

Key structural fact for every classification below: several objects were created
directly in the Supabase dashboard and have no tracked definition, including
`user_profiles`, `activity_logs`, the `student-files` and `avatars` storage buckets,
and the RPCs `get_my_profile`, `get_all_user_profiles`, `get_active_interviewers`,
and `update_my_avatar`. The repository cannot prove their current state.

---

## 1. Route inventory

Top-level routes are declared in `src/App.jsx:1181-1204`.

Public routes (no session):

| Route | Component | Access mechanism |
|---|---|---|
| `/unit-form/*` | UnitFormPage | anon key, direct table reads and upsert (see F4) |
| `/school-form/*` | SchoolFormPage | anon key, cohort read plus password RPCs |
| `/student-form/*` | StudentIntakeFormPage | anon key, direct table reads plus storage upload, submit via API |
| `/interview-schedule/*` | InterviewSchedulePage | API only (`/api/interview-lookup`, `/api/interview-book`) |
| `/shift-log/*` | ShiftLogLifecycle | API only (`/api/shift-log/*`) |
| `/evaluation/readiness/*` | EvaluationPage | hashed token in URL fragment, API validate and submit |
| `/evaluation/feedback/*` | PreceptorEvaluationPage | hashed token, API |
| `/evaluation/experience/*` | StudentEvaluationPage | hashed token, API |
| `/evaluation/post-rotation/*` | PostRotationEvaluationPage | hashed token, API |
| `/auth/reset-password` | ResetPasswordPage | Supabase recovery link |

Authenticated: everything else falls through the `/*` wildcard to `AuthedShell`
(`src/App.jsx:1203`), which renders the login page in place when no session exists.
Tab paths: `/aggregate`, `/students`, `/interviews`, `/rotation/*`, `/evaluation`,
`/connect*`, `/catalog*`, `/settings*`. Redirect legacies: `/interview-room`,
`/embed`, `/rotation/checkins`. Vercel serves a single SPA rewrite excluding `/api/`.

Phase 1 will insert `/`, `/login`, and public content routes above the wildcard.
No existing route changes.

## 2. Authentication and identity model

- Supabase email plus password (`src/pages/Login.jsx:17`), no self-registration,
  invitation only via `api/invite-user.js` (invitable roles: admin, interviewer,
  viewer; owner is never invitable).
- Browser client uses the anon key with a persisted session
  (`src/lib/supabase.js`), so all client queries run as role `anon` (no session,
  public pages) or `authenticated` (staff session).
- Profile loading via RPC `get_my_profile` (dashboard-defined, untracked).
- Client role derivation in `src/contexts/AuthContext.jsx:117-125`; permission
  matrix in `src/lib/permissions.js`. These are UI conveniences, not security.
- Server helper `public.is_owner_or_admin()` (SECURITY DEFINER, tracked in
  `migrations/migration_track_b_v1a_secure_completion_rpc.sql`) is the only
  DB-side role predicate currently in use by policies.

## 3. API endpoint authorization inventory

Three classes, all under `api/` (Vercel functions):

1. JWT-verified privileged endpoints: verify the caller's Supabase JWT via
   `auth.getUser()`, then load the caller's `user_profiles` row with the service
   role client for the authority check. Body never influences authorization.
   Examples: `invite-user.js`, `admin-users.js`, `manage-interviewers.js`,
   `student-update.js`, `templates-admin.js`, `knowledge-admin.js`, `catalog-*`.
2. Public token endpoints: HMAC-SHA256 hashed tokens (pepper
   `EVALUATION_TOKEN_PEPPER`, raw token never stored), rate limited. Evaluation
   validate and submit endpoints, `certificate-participation-download.js`.
3. Public email-identity endpoints: `shift-log/*`, `student-intake-submit.js`,
   `school-form-submit.js`, `interview-lookup.js`, `interview-book.js`,
   `unit-form-notification.js`. Identity is an email match server-side.

All three classes use `SUPABASE_SERVICE_ROLE_KEY` internally (35 files), which
bypasses RLS. Cron endpoints under `api/cron/` run on Vercel cron.

## 4. Client direct database access map

Tables read or written directly from the browser (count of `.from()` call sites in
`src/`): students 38, units 23, student_shift_logs 14, preceptors 14, cohorts 12,
matches 11, interview_rubrics 9, interview_availability_blocks 9, contacts 9,
evaluation_assignments 8, interview_slots 7, program_events 6, interviews 6,
cohort_school_rotations 6, unit_leaders 5, unit_cohort_responses 5,
notification_log 5, interviewers 5, interview_sessions 5, user_profiles 4,
student_active_disposition 4, student_preceptor_assignments 3,
student_disposition_followups 3, communications 3, support_request_reads 2,
student_reads 2, preceptor_cohort_participation 2, certificates 2,
catalog_resources 2, activity_logs 2, student_disposition_private_notes 1,
catalog_categories 1.

Client RPC calls: get_active_interviewers, get_my_profile, get_all_user_profiles,
update_my_avatar, update_my_connect_signature, record_student_disposition,
clear_student_disposition, complete_disposition_followup,
school_form_requires_password, verify_school_form_password.

Storage buckets used from the browser: student-files (12 sites, includes anon
upload from the public intake form), contact-avatars, avatars, aspire-catalog.

Anon-context (public page) direct DB dependencies, verified in code:

| Public page | Direct anon dependency |
|---|---|
| StudentIntakeFormPage | SELECT * from `students` filtered by email (`src/components/StudentIntakeFormPage.jsx:195-211`), SELECT `cohorts` (accepting cohort), SELECT `units`, storage upload to `student-files` |
| UnitFormPage | SELECT `cohorts`, `units`, `unit_cohort_responses` (`:93`), UPSERT `unit_cohort_responses` (`:234`) |
| SchoolFormPage | SELECT `cohorts`, RPCs `school_form_requires_password`, `verify_school_form_password` |
| InterviewSchedulePage | none (API only) |
| ShiftLogLifecycle | none (API only) |
| Evaluation pages | none (API only) |

## 5. Policy-by-policy inventory

Grant baseline: Supabase grants ALL on new `public` tables to `anon` and
`authenticated` by default. Tracked REVOKEs exist only for: communications (anon,
s1a), evaluation_* (all, stage 1 and 2), certificates and certificate_sequences,
support_request_reads (anon). Every other table is assumed to retain default
grants, so effective access is decided entirely by RLS policies. Classification
for this baseline: suspected, confirm with script section 3.

Legend: U = USING, WC = WITH CHECK. "Expected live" means what the repository
history implies exists in production today.

### 5.1 students

| # | Policy | Cmd | Role | U / WC | Defined | Expected live |
|---|---|---|---|---|---|---|
| 1 | anon_all | ALL | anon | true / true | setup.sql:37 | yes, never dropped by tracked SQL |
| 2 | anon_insert_students | INSERT | anon | - / true | fix_school_form_columns.sql:15 | yes |
| 3 | authenticated_all_students | ALL | authenticated | true / true | migration_authenticated_rls_audit(_v2).sql | yes |

- Client paths: entire staff app (38 sites); public intake form anon SELECT *.
- API dependency: student-intake-submit, student-update, shift-log/lookup-student,
  interview-lookup, many more (service role, unaffected by RLS).
- Workflows: all staff workflows; public intake pre-fill.
- Classification: policy creation verified; live persistence of 1 and 2 partially
  verified. If live, the public anon key can read and write the entire students
  table including interview scores, notes, and compliance data. Finding F1, F3.
- Remediation: move the intake pre-fill lookup server-side, then drop policies 1
  and 2; re-scope policy 3 to staff (`is_staff()`); portal roles get curated
  access in later phases, never base-table grants.

### 5.2 cohorts

| # | Policy | Cmd | Role | U / WC | Defined | Expected live |
|---|---|---|---|---|---|---|
| 1 | anon_all | ALL | anon | true / true | migration_cohorts.sql:21 | yes |
| 2 | authenticated_all_cohorts | ALL | authenticated | true / true | audit v1/v2 | yes |

- Anon dependency (verified): SchoolFormPage, StudentIntakeFormPage, UnitFormPage
  all SELECT cohorts while unauthenticated.
- Classification: partially verified live.
- Remediation: replace anon ALL with anon SELECT only (interim, keeps all three
  public forms working, removes public write). Later phases move public reads to
  endpoints or a narrow public view. Re-scope policy 2 to staff.

### 5.3 units

Same shape as cohorts: `anon_all` (migration_matching.sql:24) plus
`authenticated_all_units`.

Correction (implementation evidence, 2026-07-12): the anon dependency is wider
than first recorded. Besides the verified anon SELECTs (intake form unit
preferences, unit form unit lookup), the public unit form also INSERTS and
UPDATES units rows as anon (`src/components/UnitFormPage.jsx`, submit handler:
contact person, slots, participation flags). Remediation therefore moves from
Wave C to Wave D: the server-side submit endpoint takes over the units writes
first, then anon narrows to SELECT only. Cohorts remains the only Wave C
table.

### 5.4 matches

`anon_all` (migration_matching.sql:41) plus `authenticated_all_matches`. No anon
dependency found in any public page. Classification: partially verified live.
Remediation: drop anon entirely; staff re-scope.

### 5.5 communications

`anon_all_comms` was dropped and anon privileges revoked by
`migrations/migration_security_s1a_remove_anon_communications_access.sql`
(verified in repo, live state partially verified). Remaining:
`authenticated_all_communications` (ALL, true/true). Remediation: staff re-scope.

### 5.6 interview_rubrics

| # | Policy | Cmd | Role | U / WC | Defined | Expected live |
|---|---|---|---|---|---|---|
| 1 | anon_all_rubrics | ALL | anon | true / true | migration_interview_redesign.sql:36 | yes, the rubrics RLS fix only replaced the authenticated policy |
| 2 | authenticated_all_rubrics | ALL | authenticated | true / true | migration_rubrics_authenticated_rls.sql | yes |

- No anon dependency exists. If policy 1 is live, interview scores and comments
  are publicly readable and writable with the anon key. Finding F1 (highest
  sensitivity instance).
- Remediation: drop policy 1; re-scope policy 2 to staff.

### 5.7 interview_sessions

`anon_all_sessions` (migration_interview_sessions.sql:26) plus
`authenticated_all_interview_sessions`. Realtime-enabled table. No anon
dependency. Remediation: drop anon; staff re-scope; confirm realtime publication
membership in script section 7.

### 5.8 interviewers

Three anon policies (SELECT, INSERT, UPDATE; migration_interviews.sql:68-73) plus
`authenticated_all_interviewers`. Public scheduling uses API only. Remediation:
drop all three anon policies; staff re-scope.

### 5.9 interviews (legacy table)

Three anon policies (SELECT, INSERT, UPDATE; migration_interviews.sql:78-83) plus
`authenticated_all_interviews`. Remediation: drop anon; staff re-scope.

### 5.10 program_events

Service role ALL plus four anon policies (SELECT, INSERT, UPDATE, DELETE;
migration_program_events_rls.sql) plus `authenticated_all_program_events`. No anon
dependency. If live, the public can delete program history. Remediation: drop all
four anon policies; staff re-scope.

### 5.11 interview_availability_blocks and interview_slots

`anon_all_blocks`, `anon_all_slots` (migration_scheduling.sql) plus
`authenticated_all_*`. Public booking goes through `api/interview-book.js`
(service role); the 9 and 7 client call sites are staff scheduling UI.
Remediation: drop anon; staff re-scope.

### 5.12 student_shift_logs

`anon_all_shift_logs` (migration_shift_logs.sql:29) plus
`authenticated_all_student_shift_logs`. Public shift-log flow is API only
(verified). If anon policy is live, shift narratives and support_needed text are
publicly readable and writable. Remediation: drop anon; staff re-scope; student
self-access arrives in Phase 2 through curated paths only.

### 5.13 ngrp_outcomes and cohort_snapshots

Each: "Anon full access" ALL policy plus "Service role full access" plus
`authenticated_all_*` (migration_phase1_analytics.sql, audit v1/v2). NGRP hiring
and retention outcomes would be publicly readable if live. Remediation: drop
anon; staff re-scope.

### 5.14 preceptors

Remediated by `migration_preceptor_schema_v2.sql` (verified): anon and permissive
policies dropped; now `authenticated_read_preceptors` (SELECT, true) plus
owner-only INSERT, UPDATE, DELETE. Remediation: re-scope SELECT to staff in 0B;
otherwise sound.

### 5.15 preceptor_cohort_participation

`authenticated_read_pcp` (SELECT, true) plus owner-only writes (verified).
Remediation: re-scope SELECT to staff.

### 5.16 student_preceptor_assignments

`student_preceptor_assignments_owner_admin_read` (SELECT, role IN owner, admin)
only; writes via service role (verified, least privilege). No change in 0B.

### 5.17 user_profiles (dashboard-created table)

| # | Policy | Cmd | Role | U / WC | Defined | Expected live |
|---|---|---|---|---|---|---|
| 1 | authenticated_all_user_profiles | ALL | authenticated | true / true | audit v2 | yes |

- Client paths: get_my_profile RPC, 4 direct call sites, admin UI via
  `api/admin-users.js` (service role).
- Classification: creation verified in tracked SQL; live state partially
  verified; the dashboard may hold additional untracked policies.
- Finding F2 (critical): any authenticated account, including viewer and
  interviewer, can UPDATE any row, including setting its own `role` to admin or
  `is_owner` to true. This is a standing privilege escalation path for current
  staff accounts and becomes untenable the moment external accounts exist.
- Remediation: replace with (a) self SELECT, (b) staff SELECT, (c) self UPDATE
  restricted to cosmetic columns via a column-guard trigger or a dedicated RPC
  (avatar and signature already have RPCs), (d) all role and activation writes
  via service role endpoints only. Must land in 0B before any portal work.

### 5.18 activity_logs (dashboard-created table)

`authenticated_all_activity_logs` (ALL, true/true, audit v2). Any staff account
can read, alter, or delete the audit trail. Client writes go through
`logActivity` (INSERT) and owner-only UI reads. Remediation: INSERT for staff,
SELECT for owner only (matches UI), no UPDATE or DELETE for any client role.

### 5.19 unit_leaders

| # | Policy | Cmd | Role | U / WC | Defined | Expected live |
|---|---|---|---|---|---|---|
| 1 | service_role_all_unit_leaders | ALL | service_role | true / true | db/migrations/unit_response_system.sql:32 | yes |
| 2 | authenticated_read_unit_leaders | SELECT | authenticated | true | :35 | yes |
| 3 | anon_read_unit_leaders | SELECT | anon | true | :39 | yes |
| 4 | authenticated_all_unit_leaders | ALL | authenticated | true / true | audit v2 | yes |

- Policy 3 was deliberate (public form roster). Policy 4 lets any staff account
  rewrite the roster. Remediation: drop policy 4; keep 1 to 3 for now; revisit
  anon read minimization in Phase 3 (roster contains names, emails, roles).

### 5.20 unit_cohort_responses (Amendment 7 verification)

| # | Policy | Cmd | Role | U / WC | Defined | Expected live |
|---|---|---|---|---|---|---|
| 1 | service_role_all_unit_responses | ALL | service_role | true / true | db/migrations/unit_response_system.sql:100 | yes |
| 2 | authenticated_read_unit_responses | SELECT | authenticated | true | :103 | yes |
| 3 | anon_insert_unit_responses | INSERT | anon | - / true | :106 | yes |
| 4 | anon_update_unit_responses | UPDATE | anon | true / true | :109-110 | yes |
| 5 | anon_select_unit_responses | SELECT | anon | true | :112 | yes |
| 6 | authenticated_all_unit_cohort_responses | ALL | authenticated | true / true | audit v2 | yes |

- Workflow dependency, verified in code: the public `/unit-form` pre-fills from
  an existing row (anon SELECT, `src/components/UnitFormPage.jsx:93`) and
  submits via UPSERT (anon INSERT plus anon UPDATE on conflict,
  `src/components/UnitFormPage.jsx:234`). Dropping policies 3, 4, or 5 today
  breaks the live unit participation form. The table also stores NGRP hiring
  answers and ASPIRE alumni feedback, publicly readable through policy 5.
- Exposure: anyone with the anon key can read all unit responses and overwrite
  any unit's submission for any cohort (policies 4 and 5 are unscoped).
- Classification: policy definitions and the dependency are verified in repo;
  live persistence partially verified (script confirms).
- Remediation (sequenced, not immediate): build a server-side submit endpoint
  (mirroring `school-form-submit.js`) plus a server-side pre-fill lookup, deploy,
  then drop policies 3, 4, 5, then drop policy 6 in the staff re-scope wave.
  Planned inside Phase 0B as a code-plus-SQL pair; the form must never lose its
  public availability window during a cohort intake period.

### 5.21 contacts

Four authenticated CRUD policies (true/true) plus service role ALL (verified,
migration_contacts_table.sql). Remediation: staff re-scope all four.

### 5.22 cohort_school_rotations

`cohort_school_rotations_authenticated_select` plus deliberate
`cohort_school_rotations_anon_select` (20260522000000_rotation_dates.sql). Writes
are service role only (verified). The anon SELECT client dependency was not
located in the public pages; classification: suspected dependency, verify before
dropping. Content is rotation windows (low sensitivity). Remediation: keep in 0B,
re-evaluate in Phase 3.

### 5.23 student_dispositions, followups, private notes

- student_dispositions: `authenticated_all_student_dispositions` (ALL,
  true/true). Remediation: owner and admin SELECT (matching the RPC posture),
  writes via existing SECURITY DEFINER RPCs only.
- student_disposition_followups: hardened already,
  `owner_admin_select_disposition_followups` SELECT via is_owner_or_admin()
  (verified, track_b_v1b). Writes via RPCs. No 0B change.
- student_disposition_private_notes: owner and admin only on all four commands
  (verified). No 0B change.

### 5.24 support_request_reads, student_reads, session_reads

- support_request_reads: SELECT and INSERT own rows AND is_owner_or_admin(),
  anon revoked, append-only (verified). Uses `user_id = auth.uid()` directly.
- student_reads and session_reads: own-row SELECT, INSERT, UPDATE via the
  sub-select `user_id = (select id from user_profiles where auth_user_id =
  auth.uid())`, no TO clause (defaults to public; anon cannot satisfy the
  predicate).
- Finding F9: the two conventions are only both correct if
  `user_profiles.id = auth_user_id` for every row. Script section 6 verifies the
  invariant. Low urgency; UPDATE policies lack WITH CHECK (cosmetic, F10).

### 5.25 notification_log and message_archive

- notification_log: service role ALL plus SELECT for owner, admin, co_lead
  (verified, migration_notification_log.sql:46-58). Sound.
- message_archive: RLS enabled, zero policies, service role only (verified).
  Sound.

### 5.26 evaluation framework, certificates

evaluation_instruments, evaluation_assignments, evaluation_assignment_tokens,
evaluation_responses, evaluation_reminders, evaluation_rate_limit_counters,
certificates, certificate_sequences: REVOKE ALL from anon and authenticated,
owner and admin SELECT where applicable, all writes service role or SECURITY
DEFINER RPCs with explicit REVOKE and service-role-only EXECUTE (verified,
stage 1 and 2 plus certificate migrations). This is the target pattern for the
rest of the database. No 0B change.

### 5.27 knowledge and template governance tables

Eight tables, RLS enabled, zero policies, all access via service role endpoints
(verified, kt1). Sound.

### 5.28 catalog_resources and catalog_categories

Owner and admin read, interviewer read of active resources, categories readable
by owner, admin, interviewer; writes service role (verified). Role checks are
string lists, so future portal roles are excluded by default. No 0B change.

### 5.29 cron_runs, automation_settings

RLS enabled, zero policies, service role only (verified). Sound.

### 5.30 storage buckets

| Bucket | Tracked policies | Classification |
|---|---|---|
| contact-avatars | public read (anon plus authenticated), owner and admin insert and update (verified, 20260601000001) | sound for its content |
| student-files | none tracked; browser uploads from the public intake form and 12 staff call sites | F7, upgraded to partially verified: the intake form calls `getPublicUrl` on uploaded resumes and headshots and stores the resulting URLs (`src/components/StudentIntakeFormPage.jsx`), which only work on a PUBLIC bucket. Student documents are therefore reachable by unauthenticated URL (unguessable UUID paths are the only protection). Script sections 2 and 5 confirm the bucket flag and any write policies; remediation (signed URLs plus private bucket) is Wave F |
| avatars | none tracked | unknown, F7 |
| aspire-catalog | none tracked; described as private, Owner-managed; access via signed URLs from `api/catalog-resource-open.js` | unknown, F7 |

### 5.31 RPC and function surface

Tracked and hardened (service role EXECUTE only, verified): all evaluation submit
and validate RPCs, certificate issuance, governance lifecycle RPCs,
shift_log_check_out.

Tracked, authenticated EXECUTE (verified): is_owner_or_admin,
complete_disposition_followup, record_student_disposition,
clear_student_disposition, update_my_connect_signature.

Untracked, definitions unknown (F8): get_my_profile, get_all_user_profiles,
get_active_interviewers, update_my_avatar, school_form_requires_password and
verify_school_form_password (tracked bodies, but no tracked EXECUTE grants).
Postgres grants EXECUTE to PUBLIC by default on new functions, so any of these
that is SECURITY DEFINER and unrevoked is callable by anon. In particular, if
`get_all_user_profiles` returns all profiles and is anon-callable, staff names
and emails leak publicly. Script section 4 lists every public function with its
security mode and ACL; remediation follows the output.

---

## 6. Findings register (ranked)

| ID | Severity | Classification | Finding |
|---|---|---|---|
| F1 | Critical | partially verified | Residual permissive anon policies on students, cohorts, units, matches, interview_rubrics, interview_sessions, interviews, interviewers, interview_availability_blocks, interview_slots, student_shift_logs, ngrp_outcomes, cohort_snapshots, program_events (plus anon_insert_students). The audit v1/v2 migrations added authenticated policies but never dropped the anon ones. If live, the anon key embedded in the public bundle reads and writes core program data. |
| F2 | Critical | partially verified | `authenticated_all_user_profiles` allows any authenticated account to update any profile, including self-escalation to admin or owner. |
| F3 | High | verified dependency | The public intake form reads `students` with SELECT * as anon by design; any anon SELECT policy on students exposes the full table (filters are client-side only). |
| F4 | High | verified dependency | `unit_cohort_responses` anon INSERT, UPDATE (unscoped), SELECT are live dependencies of the public `/unit-form` upsert; the anon UPDATE lets anyone overwrite any unit's submission, and anon SELECT exposes NGRP and alumni feedback answers. |
| F5 | High | partially verified | `authenticated_all_activity_logs` lets any staff account alter or delete the audit trail. |
| F6 | Medium | verified | Broad `authenticated_all_*` (FOR ALL, true/true) on students, cohorts, units, matches, communications, rubrics, sessions, interviews, interviewers, blocks, slots, shift logs, ngrp_outcomes, cohort_snapshots, program_events, contacts, dispositions, unit_leaders, unit_cohort_responses gives every staff role full write and delete, and is incompatible with introducing external roles (hard prerequisite for Phase 2). |
| F7 | Medium | suspected | student-files, avatars, aspire-catalog bucket policies are untracked; student-files receives anon uploads from the public intake form. |
| F8 | Medium | suspected | Untracked RPCs may be anon-executable via default PUBLIC EXECUTE; get_all_user_profiles is the highest-risk candidate. |
| F9 | Low | suspected | Mixed identity conventions in read-receipt policies assume `user_profiles.id = auth_user_id`; invariant unverified. |
| F10 | Low | verified | student_reads and session_reads UPDATE policies lack WITH CHECK and TO clauses; cosmetic hardening. |

## 7. Remediation map (input to Phase 0B)

Wave order, each wave independently revertible:

1. Wave A (additive): create `is_staff()` SECURITY DEFINER helper alongside
   is_owner_or_admin(); no behavior change.
2. Wave B (drop-only, zero dependency): drop every anon policy with no public
   page dependency: interview_rubrics, interview_sessions, interviews (x3),
   interviewers (x3), interview_availability_blocks, interview_slots,
   student_shift_logs, matches, ngrp_outcomes, cohort_snapshots, program_events
   (x4), anon_insert_students. Pure risk removal.
3. Wave C (narrowing with dependency preserved): cohorts, replace anon ALL
   with anon SELECT only. Public forms keep working; public write access ends.
   (Units originally sat here too; moved to Wave D when implementation
   evidence showed the unit form also writes units as anon, see 5.3.)
4. Wave D (code plus SQL pairs): move intake pre-fill lookup server-side, then
   drop `anon_all` on students; move unit form submit and pre-fill server-side,
   then drop the three anon policies on unit_cohort_responses and narrow units
   to anon SELECT.
5. Wave E (staff re-scope): replace every `authenticated_all_*` with staff-scoped
   policies; user_profiles and activity_logs get their dedicated shapes (5.17,
   5.18).
6. Wave F (per script output): bucket and RPC hardening based on live-state
   results (F7, F8), plus F9 and F10 cleanups.

Waves B and C and the user_profiles fix are the minimum bar before any Phase 2
external account exists. Waves depend on live-state confirmation first.

## 8. Live-state verification (Owner action)

Run `db/audit/phase0a_live_state_audit.sql` in the Supabase SQL editor (entire
file, read-only, no locks, safe during production hours) and return the output.
The script only SELECTs from catalogs: pg_policies, pg_class, role_table_grants,
pg_proc, storage.buckets, pg_publication_tables, plus the user_profiles
invariant count. Every "partially verified" and "suspected" classification above
resolves to verified or cleared based on that output, and Wave ordering in Phase
0B will be adjusted to match.
