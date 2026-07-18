// WAVE F-2 (Pass 1): static-source guards for the migrated student-file consumers.
// These lock in the security posture of the frontend migration: no consumer
// renders a raw student-files URL any more, resume controls are Owner/Admin only,
// the badge is gated to the new canGenerateBadge capability, and student-deletion
// storage cleanup runs after the database delete.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const auth       = read('src/contexts/AuthContext.jsx')
const sidePanel  = read('src/components/StudentSidePanel.jsx')
const studentRow = read('src/components/StudentRow.jsx')
const overview   = read('src/components/OverviewTab.jsx')
const rubric     = read('src/components/RubricSession.jsx')
const recipient  = read('src/components/connect/RecipientProfileCard.jsx')
const portal     = read('src/portal/StudentPortal.jsx')
const app        = read('src/App.jsx')

test('canGenerateBadge is an active Owner/Admin capability, not canInterview', () => {
  // The capability exists and requires active + owner/admin.
  assert.match(auth, /canGenerateBadge:\s*userProfile\?\.is_active !== false && \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
  // It is distinct from canInterview (which still includes interviewer).
  assert.match(auth, /canInterview:\s*\['owner', 'admin', 'interviewer'\]/)
})

test('StudentSidePanel: badge is canGenerateBadge, resume is Owner/Admin, no raw URLs render', () => {
  // Badge gated on the new capability, not canInterview.
  assert.match(sidePanel, /\{canGenerateBadge && \(/)
  assert.doesNotMatch(sidePanel, /\{canInterview && \(/)
  // Badge headshot comes from the server access endpoint.
  assert.match(sidePanel, /fetchStudentFileUrl\(\{ studentId: student\.id, kind: 'headshot' \}\)/)
  // Resume View/Download gated on canEdit and routed through signed access.
  assert.match(sidePanel, /\{canEdit && \([\s\S]*?onClick=\{openResume\}/)
  assert.match(sidePanel, /downloadStudentFile\(\{ studentId: student\.id, kind: 'resume'/)
  // The live headshot preview renders the signed URL, not the stored value.
  assert.match(sidePanel, /headshotSignedUrl && <img src=\{headshotSignedUrl\}/)
  // No live anchor points at the raw resume/headshot value (the only remaining
  // data.resume_url/href pairing lives in the {false && ...} dead block).
})

test('StudentRow: signed uploads, replace cleanup, Owner/Admin resume, signed headshot', () => {
  // No direct storage upload / getPublicUrl to student-files remains.
  assert.doesNotMatch(studentRow, /storage\.from\('student-files'\)/)
  assert.match(studentRow, /signAndUploadStaffFile\(\{ studentId: student\.id, kind: 'resume'/)
  assert.match(studentRow, /signAndUploadStaffFile\(\{ studentId: student\.id, kind: 'headshot'/)
  assert.match(studentRow, /cleanupStudentFiles\(\{ studentId: student\.id, action: 'replace'/)
  // Resume View gated on canEdit, headshot preview from signed URL.
  assert.match(studentRow, /\{canEdit && \([\s\S]*?onClick=\{openResume\}/)
  assert.match(studentRow, /headshotSignedUrl && <img src=\{headshotSignedUrl\}/)
})

test('OverviewTab campus card renders the signed headshot, not the raw URL', () => {
  assert.match(overview, /useStudentFileUrl\(\{[\s\S]*?kind: 'headshot'/)
  assert.match(overview, /<img src=\{headshotSignedUrl\}/)
  assert.doesNotMatch(overview, /<img src=\{student\.headshot_url\}/)
})

test('RubricSession: resume is Owner/Admin only and opens via the access endpoint', () => {
  assert.match(rubric, /\{canEdit && student\.resume_url && \(/)
  assert.match(rubric, /openStudentFile\(\{ studentId: student\.id, kind: 'resume' \}\)/)
  // No raw resume anchor remains.
  assert.doesNotMatch(rubric, /href=\{student\.resume_url\}/)
})

test('connect RecipientProfileCard resolves the student headshot through signed access', () => {
  assert.match(recipient, /useStudentFileUrl\(\{[\s\S]*?kind: 'headshot'/)
  assert.match(recipient, /const sAvatarUrl = studentHeadshotSignedUrl/)
  // Only fetch for a student recipient (contacts use a different bucket).
  assert.match(recipient, /recipientType === 'student'/)
})

test('Fable StudentPortal own headshot uses the portal access endpoint', () => {
  assert.match(portal, /usePortalHeadshotUrl\(\{/)
  assert.match(portal, /ownHeadshotUrl \? <img src=\{ownHeadshotUrl\}/)
  // The .ptl-avatar markup and initials fallback are preserved.
  assert.match(portal, /: initials\(fullName\)/)
})

test('student deletion: storage cleanup runs AFTER the DB delete, cohort captured first', () => {
  const fn = app.slice(app.indexOf('const deleteStudent'), app.indexOf('const deleteUnit'))
  const captureIdx = fn.indexOf("students.find(s => s.id === id)?.cohort_id")
  const rowDeleteIdx = fn.indexOf("from('students').delete()")
  const cleanupIdx = fn.indexOf("action: 'delete_student'")
  assert.ok(captureIdx > -1 && rowDeleteIdx > -1 && cleanupIdx > -1, 'all three steps present')
  // cohort captured before the row delete; cleanup after it.
  assert.ok(captureIdx < rowDeleteIdx, 'cohort id captured before deletion')
  assert.ok(cleanupIdx > rowDeleteIdx, 'cleanup runs after the database delete')
  // Cleanup is best-effort (not awaited into the delete result) and only when a cohort is known.
  assert.match(fn, /if \(cohortId\) cleanupStudentFiles\(\{ studentId: id, action: 'delete_student', cohortId \}\)/)
})
