// WAVE F-2 (Pass 1): static-source guards for the student-file endpoints. These
// serverless handlers need real Supabase to run, so following the repository
// convention they are verified by source assertions rather than execution.
//
// Run: node --test test/studentFilesEndpoints.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

const intakeSign = read('../api/student-intake-file-sign.js')
const staffSign = read('../api/student-file-sign.js')
const access = read('../api/student-file-access.js')
const portalAccess = read('../api/portal/student-file-access.js')
const cleanup = read('../api/student-file-cleanup.js')
const all = { intakeSign, staffSign, access, portalAccess, cleanup }

test('every endpoint uses the shared core (one place for path/validation rules)', () => {
  assert.match(intakeSign, /from '\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(staffSign, /from '\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(access, /from '\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(portalAccess, /from '\.\.\/\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(cleanup, /from '\.\.\/lib\/server\/studentFiles\.js'/)
})

test('the browser never supplies an authoritative path', () => {
  // Paths come only from canonicalPath / studentFolderPrefix (server-derived).
  assert.match(intakeSign, /canonicalPath\(cohortId, studentId, kind, meta\.ext\)/)
  assert.match(staffSign, /canonicalPath\(student\.cohort_id, student\.id, kind, meta\.ext\)/)
  assert.match(cleanup, /studentFolderPrefix\(cohortId, studentId\)/)
  // No endpoint ever reads an object path or folder from the request body.
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /body\.(path|object_path|storage_path|folder)/, `${name} must not trust a client path`)
  }
  // Only the cleanup endpoint reads body.cohort_id, and only as a uuid-validated
  // scoping fallback for delete_student after the row is gone (never a path).
  for (const [name, s] of Object.entries(all)) {
    if (name === 'cleanup') continue
    assert.doesNotMatch(s, /body\.cohort_id/, `${name} must not read a client cohort id`)
  }
  assert.match(cleanup, /const bodyCohort = typeof body\.cohort_id === 'string'/)
  assert.match(cleanup, /if \(!isUuid\(bodyCohort\)\) return res\.status\(404\)/)
  // The cohort fallback is gated to delete_student only.
  assert.match(cleanup, /else if \(action === 'delete_student'\) \{[\s\S]*?bodyCohort/)
})

test('intake signed upload: anonymous, server-resolved, validated', () => {
  // Same resolver as the existing intake, no JWT.
  assert.match(intakeSign, /resolveAcceptingCohort/)
  assert.match(intakeSign, /resolveStudentByEmail\(db, cohortResult\.cohortId, schoolEmail/)
  assert.match(intakeSign, /validateFileMeta\(\{ kind, filename: body\.filename, contentType: body\.content_type, size: body\.size \}\)/)
  // Preserves re-submit overwrite via upsert; one-path token.
  assert.match(intakeSign, /createSignedUploadUrl\(cp\.path, \{ upsert: true \}\)/)
  // Returns only token + path, no bucket internals.
  assert.match(intakeSign, /return res\.status\(200\)\.json\(\{ token: signed\.token, path: signed\.path \|\| cp\.path \}\)/)
  assert.doesNotMatch(intakeSign, /verifyStaffCaller|Authorization|Bearer/)
})

test('staff signed upload: Owner/Admin only, cohort resolved server-side', () => {
  assert.match(staffSign, /const UPLOAD_ROLES = \['owner', 'admin'\]/)
  assert.match(staffSign, /verifyStaffCaller\(req\)/)
  assert.match(staffSign, /if \(!UPLOAD_ROLES\.includes\(role\)\) return res\.status\(403\)/)
  // Cohort is looked up from the student row, not the client.
  assert.match(staffSign, /from\('students'\)\.select\('id, cohort_id'\)\.eq\('id', studentId\)/)
  assert.match(staffSign, /createSignedUploadUrl\(cp\.path, \{ upsert: true \}\)/)
})

test('access endpoint: the role matrix, server-mediated, short-lived signed URLs', () => {
  // ROLE MATRIX UPDATED 2026-08-05 (approved): a Co-Lead is near-Owner for
  // student ACCESS and reads student files across ALL cohorts, so the
  // unrestricted branch is now owner|admin|co-lead (`isUnrestricted`, was
  // `isOwnerAdmin`). Interviewer stays entitlement-gated, Viewer stays
  // headshot-only, and upload/replace/delete stay Owner/Admin elsewhere.
  // Owner/Admin: both, any cohort. Viewer: headshot only, their students. Interviewer:
  // both for entitled cohorts. Anything else: 403.
  assert.match(access, /verifyPortalCaller\(req\)/)
  assert.match(access, /const isUnrestricted = role === 'owner' \|\| role === 'admin' \|\| role === 'co-lead'/)
  assert.match(access, /const isViewer = role === 'viewer'/)
  assert.match(access, /const isInterviewer = role === 'interviewer'/)
  assert.match(access, /if \(!isUnrestricted && !isViewer && !isInterviewer\) \{[\s\S]*?staff_role_required/)
  assert.match(access, /if \(!roleKinds\.has\(n\.kind\)\) return nullResult/)
  assert.match(access, /const cohortOk = isUnrestricted \|\| isViewer \|\| entitledCohorts\.has\(row\.cohort_id\)/)
  // Resolves stored value (legacy URL or path) then mints signed URLs.
  assert.match(access, /parseStoredFileRef\(row\[COLUMN\[n\.kind\]\]\)/)
  // STUDENT-PHOTO-PERF-1: signing is grouped per kind so each kind gets its own
  // lifetime from the shared table (headshots long, resumes short).
  assert.match(access, /createSignedUrls\(group\.map\(\(t\) => t\.path\), signedUrlTtlSeconds\(kind\)\)/)
  // Batch supported for list views.
  assert.match(access, /Array\.isArray\(body\.items\)/)
  // Never returns a bucket/path in errors; unauthorized/empty -> null url.
  assert.doesNotMatch(access, /signed_url: ref\.path|bucket_id/)
})

test('access endpoint: interviewer access is entitlement-gated, identity-only, inactive denied', () => {
  // Interviewers are granted per active cohort entitlement (identity), not by role alone.
  assert.match(access, /activeEntitledCohortIds\(supabaseAdmin, caller\.profile\.id\)/)
  // Inactive callers are rejected by verifyPortalCaller before authorization runs.
  assert.match(access, /verifyPortalCaller\(req\)/)
  // No name-string or email-based authorization anywhere.
  assert.doesNotMatch(access, /interviewer_name|interview_assigned_interviewers|\.email/)
})

test('portal access: own headshot only, server-resolved, no resume', () => {
  assert.match(portalAccess, /verifyPortalStudentCaller\(req\)/)
  assert.match(portalAccess, /const studentId = caller\.studentIds\[0\]/)
  assert.match(portalAccess, /select\('id, headshot_url'\)/)
  // No resume column, no student_id from the client.
  assert.doesNotMatch(portalAccess, /resume_url|body\.student_id/)
  assert.match(portalAccess, /const SIGNED_URL_TTL_SECONDS = signedUrlTtlSeconds\('headshot'\)/)
  assert.match(portalAccess, /createSignedUrl\(ref\.path, SIGNED_URL_TTL_SECONDS\)/)
})

test('cleanup: Owner/Admin, scoped to one student folder, two actions', () => {
  assert.match(cleanup, /const CLEANUP_ROLES = \['owner', 'admin'\]/)
  assert.match(cleanup, /studentFolderPrefix\(cohortId, studentId\)/)
  // Replace resolves the cohort from the still-present row; delete_student can
  // fall back to the caller-supplied uuid after the row is gone.
  assert.match(cleanup, /cohortId = student\.cohort_id/)
  assert.match(cleanup, /action === 'replace' \|\| body\.action === 'delete_student'/)
  // Replace removes only other-extension siblings of the same kind.
  assert.match(cleanup, /name\.startsWith\(`\$\{kind\}\.`\) && name !== keepName/)
  // delete_student removes everything under the resolved folder only.
  assert.match(cleanup, /toRemove = listed\.names/)
})

test('no endpoint changes the bucket or a storage policy (Pass 1 is code-only)', () => {
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /updateBucket|CREATE POLICY|DROP POLICY|storage\.buckets|public\s*[:=]\s*false/i, `${name} must not touch bucket/policy`)
    // Access is via short-lived signed URLs, never getPublicUrl in the endpoints.
    assert.doesNotMatch(s, /getPublicUrl/, `${name} must not mint public URLs`)
  }
})

test('privacy: no student content or path logged, safe errors', () => {
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /console\.(log|info|debug)/, `${name}`)
  }
  // The sign endpoints must return { token, path } (transport-necessary for
  // uploadToSignedUrl, as the catalog upload endpoint does); the path there is
  // the object the authorized caller is uploading to. The READ and cleanup
  // endpoints must never return a path/bucket/URL-field to the client.
  for (const [name, s] of Object.entries({ access, portalAccess, cleanup })) {
    assert.doesNotMatch(s, /res\.status\([0-9]+\)\.json\(\{[^}]*\b(path|resume_url|headshot_url|bucket_id|storage_path)\b/, `${name} must not leak a path/bucket`)
  }
})

test('hygiene: no em dash, correct ASPIRE usage', () => {
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /—/, `${name} em dash`)
    assert.doesNotMatch(s, /ASPIRE Program/, `${name} ASPIRE Program`)
  }
})
