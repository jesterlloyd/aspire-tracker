// WAVE F-2 (Pass 1): static-source guards for the migrated student-file consumers,
// updated for the ASPIRE-CHART refactor (StudentRow/StudentList removed; student
// rows now render via the shared StudentAvatar, uploads live only in the signed
// StudentSidePanel flow and intake). These lock in the security posture: no
// consumer renders a raw student-files URL, resume/file/badge controls use the
// explicit active-Owner/Admin capabilities (not the broad canEdit), and
// student-deletion cleanup runs after the database delete.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const abs  = (p) => join(here, '..', p)

const auth       = read('src/contexts/AuthContext.jsx')
const sidePanel  = read('src/components/StudentSidePanel.jsx')
const overview   = read('src/components/OverviewTab.jsx')
const rubric     = read('src/components/RubricSession.jsx')
const recipient  = read('src/components/connect/RecipientProfileCard.jsx')
const portal     = read('src/portal/StudentPortal.jsx')
const avatar     = read('src/components/StudentAvatar.jsx')
const app        = read('src/App.jsx')

test('the ASPIRE-CHART refactor deletions are not revived by Wave F-2', () => {
  for (const gone of ['src/components/StudentRow.jsx', 'src/components/StudentList.jsx', 'src/components/InterviewSession.jsx']) {
    assert.equal(existsSync(abs(gone)), false, `${gone} must stay deleted`)
  }
})

test('explicit active-role file capabilities exist (not the broad canEdit)', () => {
  const activeOwnerAdmin = /userProfile\?\.is_active !== false && \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/
  for (const cap of ['canViewStudentResume', 'canManageStudentFiles', 'canGenerateBadge']) {
    assert.match(auth, new RegExp(`${cap}:\\s*userProfile\\?\\.is_active !== false && \\['owner', 'admin'\\]\\.includes\\(userProfile\\?\\.role\\)`), `${cap} must be active Owner/Admin`)
  }
  assert.ok(activeOwnerAdmin.test(auth))
  // canInterview still includes interviewer (interview functionality preserved),
  // but it is never the file gate.
  assert.match(auth, /canInterview:\s*\['owner', 'admin', 'interviewer'\]/)
})

test('StudentSidePanel: file controls by cohort-view, entitled-interviewer badge message, no leak', () => {
  // Resume View/Download shown to anyone who may view this student's files
  // (active Owner/Admin any cohort, or an entitled active interviewer this cohort).
  assert.match(sidePanel, /const canViewResume = canViewStudentResumeInCohort\(data\?\.cohort_id\)/)
  assert.match(sidePanel, /const canViewPhoto  = canViewStudentPhotoInCohort\(data\?\.cohort_id\)/)
  assert.match(sidePanel, /\{canViewResume && \(\s*\n\s*<>\s*\n\s*<button type="button" className="doc-file-link" onClick=\{openResume\}/)
  assert.match(sidePanel, /downloadStudentFile\(\{ studentId: student\.id, kind: 'resume'/)
  // Upload/replace gated on canManageStudentFiles (Owner/Admin only).
  assert.match(sidePanel, /canManageStudentFiles && \(\s*\n\s*<button className="doc-replace-btn"/)
  // Badge is canGenerateBadge; a photo-viewer (Viewer or entitled interviewer) sees the message.
  assert.match(sidePanel, /canGenerateBadge \? \(/)
  assert.match(sidePanel, /Badge generation\/view restricted to Owner\/Admin\./)
  assert.doesNotMatch(sidePanel, /\{canInterview && \(/)
  // Existence is never leaked: resume rows need resume-view or manage; photo rows need photo-view or manage.
  assert.match(sidePanel, /\(data\.resume_url && \(canViewResume \|\| canManageStudentFiles\)\) \?/)
  assert.match(sidePanel, /\(data\.headshot_url && \(canViewPhoto \|\| canManageStudentFiles\)\) \?/)
  // Badge headshot and preview come from the server access endpoint.
  assert.match(sidePanel, /fetchStudentFileUrl\(\{ studentId: student\.id, kind: 'headshot' \}\)/)
  assert.match(sidePanel, /headshotSignedUrl && <img src=\{headshotSignedUrl\}/)
  // No direct student-files storage call remains here.
  assert.doesNotMatch(sidePanel, /storage\.from\('student-files'\)/)
})

test('shared StudentAvatar (used by all student lists) reads a signed headshot', () => {
  assert.match(avatar, /useStudentFileUrl\(\{/)
  assert.match(avatar, /kind: 'headshot'/)
  assert.doesNotMatch(avatar, /<img\s+src=\{student\?\.headshot_url\}/)
})

test('OverviewTab campus strip renders headshots only through signed access', () => {
  // ASPIRE-MASTHEAD: the photo-card grid (and its local signed-url plumbing)
  // retired; the live strip's only headshot path is the shared StudentAvatar,
  // which resolves through useStudentFileUrl (asserted above). No raw
  // headshot_url may bind into an <img> in this file.
  assert.match(overview, /<StudentAvatar student=\{stu\} size=\{38\} \/>/)
  assert.doesNotMatch(overview, /<img[^>]*headshot_url/)
  assert.doesNotMatch(overview, /<img src=\{student\.headshot_url\}/)
})

test('RubricSession: resume gated by cohort entitlement, opens via the endpoint', () => {
  assert.match(rubric, /canViewStudentResumeInCohort\(cohortId\) && student\.resume_url && \(/)
  assert.match(rubric, /openStudentFile\(\{ studentId: student\.id, kind: 'resume' \}\)/)
  assert.doesNotMatch(rubric, /href=\{student\.resume_url\}/)
})

test('connect RecipientProfileCard resolves the student headshot through signed access', () => {
  assert.match(recipient, /useStudentFileUrl\(\{[\s\S]*?kind: 'headshot'/)
  assert.match(recipient, /const sAvatarUrl = studentHeadshotSignedUrl/)
  assert.match(recipient, /recipientType === 'student'/)
})

test('Fable StudentPortal own headshot uses the portal access endpoint', () => {
  // The own headshot still resolves through the server-mediated portal access endpoint. It no
  // longer renders in a hero avatar (the compass band was retired); it is handed to the Edit
  // Profile drawer, which shows the student's identity photo.
  assert.match(portal, /usePortalHeadshotUrl\(\{/)
  assert.match(portal, /headshotUrl=\{ownHeadshotUrl\}/)
  assert.doesNotMatch(portal, /<img\s+src=\{student\?\.headshot_url\}/)
})

test('student deletion: storage cleanup runs AFTER the DB delete, cohort captured first', () => {
  const fn = app.slice(app.indexOf('const deleteStudent'), app.indexOf('const deleteUnit'))
  const captureIdx = fn.indexOf("students.find(s => s.id === id)?.cohort_id")
  const rowDeleteIdx = fn.indexOf("from('students').delete()")
  const cleanupIdx = fn.indexOf("action: 'delete_student'")
  assert.ok(captureIdx > -1 && rowDeleteIdx > -1 && cleanupIdx > -1, 'all three steps present')
  assert.ok(captureIdx < rowDeleteIdx, 'cohort id captured before deletion')
  assert.ok(cleanupIdx > rowDeleteIdx, 'cleanup runs after the database delete')
  assert.match(fn, /if \(cohortId\) cleanupStudentFiles\(\{ studentId: id, action: 'delete_student', cohortId \}\)/)
})
