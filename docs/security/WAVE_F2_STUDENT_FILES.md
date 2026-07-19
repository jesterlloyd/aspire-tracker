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
| Interviewer | none | none | no | no |
| Unit Leader / Academic Partner / Preceptor / inactive | none | none | no | no |
| Unauthenticated intake | signed upload only | signed upload only | no | no |

Interviewer authorization is never derived from names, emails, free-text, roster
strings, or interview-assignment strings. A reliable interviewer-to-student
authorization relationship does not exist and is deferred to a separate future
product and schema phase.

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

## Pass 2 and Pass 3 (gated, not applied)

- Pass 2 (`..._DRAFT_DO_NOT_APPLY_wave_f2_pass2_backfill.sql`): data-only backfill
  of stored legacy public URLs to canonical paths. Deterministic (derived from the
  existing URL, never guessed). No bucket or policy change.
- Pass 3 (`..._DRAFT_DO_NOT_APPLY_wave_f2_pass3_private_cutover.sql`): flips the
  bucket private with a service-role-only policy. It supersedes the earlier draft
  `20260712000014_phase0b_wave_f2_student_files_private.sql`, which added broad
  `is_staff()` SELECT/INSERT/UPDATE storage policies. Those are unnecessary under
  the server-mediated design (the browser never reads or writes storage directly),
  so the superseded draft must not be applied.

Manual acceptance of Pass 1 (staff + portal file flows verified on the deployed
build) is required before Pass 2. Pass 2 and Pass 3 are separate and are not begun
automatically.
