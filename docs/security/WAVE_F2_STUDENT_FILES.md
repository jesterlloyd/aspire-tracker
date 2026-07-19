# Wave F-2: Student Files Privacy (Pass 1)

Closes finding F7 (student-files is a public storage bucket holding resumes and
headshots). Pass 1 is the complete application-side replacement so the bucket can
later be made private without breaking any workflow. Pass 1 changes no SQL, no
bucket setting, and no storage policy; the bucket stays public and every stored
`resume_url` / `headshot_url` value keeps working.

## Architecture

All student-file access is server-mediated. The browser never touches Supabase
storage directly and never constructs an object path.

- Reads: a consumer asks `POST /api/student-file-access` (staff) or
  `GET /api/portal/student-file-access` (portal, own headshot) for a short-lived
  signed URL by `{ student_id, kind }`. The endpoint enforces the role matrix and
  returns `signed_url` (or `null`), never a path or bucket name.
- Uploads: the browser requests a signed upload token
  (`/api/student-intake-file-sign` anonymous, `/api/student-file-sign` staff),
  then `uploadToSignedUrl(path, token, file)`. The server resolves the student,
  cohort, and canonical path and validates declared type/extension/size. No direct
  anonymous or authenticated storage upload remains in the app.
- Cleanup: `/api/student-file-cleanup` (Owner/Admin, service-role) does `replace`
  (remove obsolete extension variants after a re-upload) and `delete_student`
  (remove a deleted student's folder).

### Compatibility resolver

A stored value may be a legacy full public URL OR a canonical object path. The
server (`lib/server/studentFiles.js` `parseStoredFileRef`) and the client
(`src/lib/studentFileClient.js` `classifyStoredFileRef`) both resolve either to a
path. Because a signed URL works on a public or private bucket, and because reads
go through the access endpoint, consumers are identical before and after the
Pass 2 backfill and before and after the Pass 3 privatization. They never change
again.

## Access matrix (server-enforced; UI hides always-denied controls)

| Role | Resume | Headshot | Replace/Delete | Badge |
| --- | --- | --- | --- | --- |
| Owner / Admin | full | full | yes | yes |
| Viewer | none | view (cohort-wide-visible set) | no | no |
| Student Portal | none | own only | no | no |
| Interviewer (entitled) | view + download (entitled cohorts) | view + download (entitled cohorts) | no | no |
| Unit Leader / Academic Partner / Preceptor / inactive | none | none | no | no |
| Unauthenticated intake | signed upload only | signed upload only | no | no |

Interviewer authorization is never derived from names, emails, free-text, roster
strings, or interview-assignment strings. An active interviewer receives read-only
resume and photo access, cohort-wide, for every cohort in which they hold an active
entitlement in `interviewer_cohort_entitlements` (keyed on `user_profiles.id`).
Entitlement is durable (it survives rubric submission, interview completion,
reassignment, slot/block changes, and the cohort later going inactive) and ends
only on manual revocation or account deactivation, which the server checks live.
The table is server-mediated only (RLS grants the browser no access); active
Owner/Admin manage it through `/api/interviewer-entitlements`, the file-access
endpoint gates reads by it, and `/api/my-interviewer-cohorts` drives which controls
the staff UI shows. Interviewers never upload, replace, delete, or touch badges;
where the badge would appear they see exactly `Badge generation/view restricted to
Owner/Admin.`

Viewer photo access: an active Viewer receives signed headshot access (no resume)
for the students they already see, matching the Viewer matrix row above; inactive
Viewers are denied. This is enforced in the same file-access endpoint.

Identity-backed scheduling: Owner/Admin availability scheduling selects a linked
interviewer ACCOUNT (`interview_availability_blocks.interviewer_profile_id`), not a
free-text name (which remains display only). Creating a block for an interviewer
auto-ensures an active cohort entitlement (idempotent); reassignment never revokes
the original interviewer's entitlement and the replacement gets one from their own
block. This is the authorization posture: names are never the boundary.

Migrations (both APPLY MANUALLY, in order):
`20260719000000_interviewer_cohort_entitlements.sql` (table + RLS + the scheduling
identity column) then `20260719000001_interviewer_cohort_entitlements_backfill.sql`
(a separate, actor-selected backfill: run its read-only Owner/Admin listing, choose
the granting profile id, then run the guarded backfill block; it aborts rather than
guess if there is not exactly one active cohort). These supersede the unapplied
`20260718000002_interviewer_assignment_identity.sql`.

### Explicit active-role capabilities

File controls use dedicated capabilities in `src/contexts/AuthContext.jsx`, not the
broad `canEdit` (which omits the `is_active` check). A user is active only when
`is_active !== false`; the server endpoints remain authoritative regardless.

- `canViewStudentResume` (active Owner/Admin): see/open/download a resume.
- `canManageStudentFiles` (active Owner/Admin): upload/replace/delete student files.
- `canGenerateBadge` (active Owner/Admin): generate a student badge. Deliberately
  not `canInterview`, so Interviewers (no headshot access) never see the control.
  The badge headshot is fetched through the staff access endpoint; the generator
  keeps its "headshot required" fallback.

## Migrated consumers (Pass 1)

Retraced after the ASPIRE-CHART refactor, which removed `StudentRow`,
`StudentList`, and `InterviewSession`. Student rows now render headshots through
the shared `StudentAvatar` (covering `StudentListPanel`, `StudentMatchingCard`,
`StudentCard`, `TodaysInterviews`, `InterviewRubricTab`, connect
`RecipientPicker`), so that one migrated primitive covers every list surface.
Student-file uploads live only in the signed `StudentSidePanel` flow and the
anonymous intake.

Migrated: intake upload (`StudentIntakeFormPage`), staff uploads + replace
cleanup (`StudentSidePanel`), shared avatar (`StudentAvatar`), staff detail reads
(`StudentSidePanel`, `OverviewTab` campus card), interviewer session resume link
(`RubricSession`, active Owner/Admin only), connect recipient headshot
(`RecipientProfileCard`), the Fable portal own headshot (`StudentPortal`), and
student-deletion cleanup (`App.jsx deleteStudent`).

Consumers that render images on other buckets (user avatars, contact avatars,
catalog) are out of scope.

### Canonical-path persistence (Pass 2)

Every write path now persists the server-returned canonical object path
`<cohort_id>/<student_id>/<kind>.<ext>` for `students.resume_url` /
`students.headshot_url`, never a public or signed URL and never a browser-supplied
path. The two upload sites (`StudentIntakeFormPage` intake, `StudentSidePanel`
staff resume/headshot, which also serves replacement) store the `path` returned by
`signAndUpload*`; the `publicUrlForPath`/`getPublicUrl` persistence helper was
removed from the client. Reads still resolve the stored path through the server
access endpoint, and the compatibility resolver still accepts any legacy public URL
during the migration and rollback window.

## Cleanup safety

- Replace: upload the new object, persist the new reference, and only then remove
  obsolete extension variants. The current file is never removed before the
  upload and DB update succeed.
- Student deletion: the database delete runs first; storage cleanup runs only
  after it succeeds, is best-effort, and never fails the deletion. The cohort id
  is captured before deletion (the row is gone by cleanup time) and passed as a
  uuid-validated scoping id. A durable orphan-retry sweep remains part of the
  controlled Pass 2 cleanup.

## Reusable portal design contract (for future role portals)

The Fable "Compass" Student Portal is the approved design foundation for the
future Unit Leader and Academic Partner portals (not built in Wave F-2). Those
portals should inherit the shared authenticated shell, navigation, responsive and
safe-area behavior, typography and spacing, surface/card language, focus and
accessibility patterns, loading/empty/success/warning/error states, the
`#DC1E34` numeric unread badge, and the Messages inbox/thread/compose/reply/unread
conventions, while remaining role-specific in home priorities, scope, tasks, data
visibility, actions, and language.

Wave F-2's contribution to that contract: student-file access is a role-scoped
capability, never a property of the shared shell. A shared avatar/headshot
primitive must resolve through a role-appropriate server access endpoint and must
not let one role inherit another role's file access through component reuse.
Student-specific file logic (resume, badge) stays out of shared primitives.

### Future Unit Leader file access (locked product matrix; NOT built in Wave F-2)

The Unit Leader Portal is not implemented in Wave F-2. When it is built, a Unit
Leader's access to a student's resume, photo, work/school contact, personal email,
and personal phone MUST be server-mediated (a dedicated access endpoint, never a
direct public or signed URL and never a broad storage policy) and scoped by explicit
Unit Leader to unit assignments: a Unit Leader may see the operational profile only
for students connected to their assigned units, resolved by identity
(`user_profiles.id` -> unit assignment), never by names, emails, free-text, or
roster strings. Unit Leaders must NOT receive interview rubrics, readiness survey
answers, certificates, uploaded onboarding documents, internal staff notes, or
private support-request narratives. Messaging (when built) is one-to-one, only with
students connected to assigned units, either party may initiate, ASPIRE staff may
view and intervene, and Report a Concern stays a shortcut that opens a prefilled
ASPIRE message. This mirrors the interviewer entitlement pattern: identity-based,
scoped, server-authoritative.

## Pass 2 and Pass 3 (gated, not applied)

- Pass 2 (`20260719000002_wave_f2_pass2_url_to_path_backfill.sql`, APPLY MANUALLY):
  data-only backfill of the two confirmed columns `students.resume_url` and
  `students.headshot_url` from recognized student-files public URLs to the canonical
  object path. It converts ONLY values with the `/storage/v1/object/public/student-files/`
  marker whose extracted path is `<uuid>/<uuid>/<kind>.<ext>`; it leaves other buckets,
  signed URLs, external/malformed URLs, URL-encoded or non-canonical names,
  already-canonical paths, empties, and NULLs unchanged. It is transactional and
  idempotent, snapshots every changed value into `wave_f2_pass2_url_backfill_backup`
  for rollback, and touches no storage object, bucket, or policy. The compatibility
  resolver still serves both forms, so access is identical before and after. Run the
  read-only preflight in `db/audit/wave_f2_pass2_preflight_and_verification.sql` first.
  Supersedes and replaces the removed placeholder draft
  `20260718000000_DRAFT_DO_NOT_APPLY_wave_f2_pass2_backfill.sql`.
- Pass 3 (`..._DRAFT_DO_NOT_APPLY_wave_f2_pass3_private_cutover.sql`): flips the
  bucket private with a service-role-only policy. It supersedes the earlier draft
  `20260712000014_phase0b_wave_f2_student_files_private.sql`, which added broad
  `is_staff()` SELECT/INSERT/UPDATE storage policies. Those are unnecessary under
  the server-mediated design (the browser never reads or writes storage directly),
  so the superseded draft must not be applied.

Manual acceptance of Pass 1 (staff + portal file flows verified on the deployed
build) is required before Pass 2. Pass 2 and Pass 3 are separate and are not begun
automatically.
