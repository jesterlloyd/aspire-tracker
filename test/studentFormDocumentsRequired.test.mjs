// /student-form Section 4 (Documents) is REQUIRED: both resume and headshot.
//
// Functional tests drive the pure requirement helpers directly - the client rule
// (src/lib/studentDocuments.js) and the authoritative server rule
// (api/student-intake-submit.js checkDocumentsRequired), including the returning-student allowance
// (a document already durably on file need not be re-uploaded). Source guards prove the form label is
// no longer optional, uploads are fatal, durable references gate submission, focus/scroll/a11y are
// wired, and existing-submission protection is intact.
//
// Run: node --test test/studentFormDocumentsRequired.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { evaluateRequiredDocuments, DOCUMENT_MESSAGES } from '../src/lib/studentDocuments.js'
import { checkDocumentsRequired } from '../api/student-intake-submit.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const form = read('src/components/StudentIntakeFormPage.jsx')
const serverApi = read('api/student-intake-submit.js')

// ─── Client requirement rule ───────────────────────────────────────────────────

test('client rule: blocks when both documents are missing', () => {
  assert.deepEqual(evaluateRequiredDocuments({ hasResume: false, hasHeadshot: false }),
    { field: 'resume', message: DOCUMENT_MESSAGES.both })
})

test('client rule: blocks when only the resume is missing', () => {
  assert.deepEqual(evaluateRequiredDocuments({ hasResume: false, hasHeadshot: true }),
    { field: 'resume', message: DOCUMENT_MESSAGES.resume })
})

test('client rule: blocks when only the headshot is missing', () => {
  assert.deepEqual(evaluateRequiredDocuments({ hasResume: true, hasHeadshot: false }),
    { field: 'headshot', message: DOCUMENT_MESSAGES.headshot })
})

test('client rule: passes only when both documents are present', () => {
  assert.equal(evaluateRequiredDocuments({ hasResume: true, hasHeadshot: true }), null)
})

// ─── Server (authoritative) requirement rule ────────────────────────────────────

test('server rule: rejects a bypassed submission missing both documents', () => {
  assert.deepEqual(checkDocumentsRequired({}, {}),
    { field: 'resume_url', message: 'Upload your resume and headshot before submitting.' })
})

test('server rule: rejects when only one incoming document is present', () => {
  assert.deepEqual(checkDocumentsRequired({ resume_url: 'c/s/resume.pdf' }, {}),
    { field: 'headshot_url', message: 'Upload your headshot before submitting.' })
  assert.deepEqual(checkDocumentsRequired({ headshot_url: 'c/s/headshot.jpg' }, {}),
    { field: 'resume_url', message: 'Upload your resume before submitting.' })
})

test('server rule: a selected-but-failed upload (empty path) does not satisfy', () => {
  // The client sends no path when the upload failed; an empty string must not count.
  assert.deepEqual(checkDocumentsRequired({ resume_url: '', headshot_url: '   ' }, {}),
    { field: 'resume_url', message: 'Upload your resume and headshot before submitting.' })
})

test('server rule: passes when both incoming references are present', () => {
  assert.equal(checkDocumentsRequired({ resume_url: 'c/s/resume.pdf', headshot_url: 'c/s/headshot.jpg' }, {}), null)
})

test('server rule: a document already durably on file satisfies its slot (returning student)', () => {
  // Resume already on the record + incoming headshot → satisfied (require only the missing one).
  assert.equal(checkDocumentsRequired({ headshot_url: 'c/s/headshot.jpg' }, { resume_url: 'c/s/resume.pdf' }), null)
  // Headshot already on file + incoming resume → satisfied.
  assert.equal(checkDocumentsRequired({ resume_url: 'c/s/resume.pdf' }, { headshot_url: 'c/s/headshot.jpg' }), null)
  // Both already on file, nothing incoming → satisfied.
  assert.equal(checkDocumentsRequired({}, { resume_url: 'c/s/resume.pdf', headshot_url: 'c/s/headshot.jpg' }), null)
})

test('client and server messages are in parity and expose no storage internals', () => {
  assert.equal(checkDocumentsRequired({}, {}).message, DOCUMENT_MESSAGES.both)
  assert.equal(checkDocumentsRequired({ headshot_url: 'x/y/z.jpg' }, {}).message, DOCUMENT_MESSAGES.resume)
  assert.equal(checkDocumentsRequired({ resume_url: 'x/y/z.pdf' }, {}).message, DOCUMENT_MESSAGES.headshot)
  for (const m of Object.values(DOCUMENT_MESSAGES)) {
    assert.ok(!/url|path|bucket|storage|resume_url|headshot_url/i.test(m), `message leaks internals: ${m}`)
  }
})

// ─── Form (client) source guards ────────────────────────────────────────────────

test('Section 4 is no longer optional and carries a required indicator + copy', () => {
  assert.doesNotMatch(form, /Section 4: Documents \(Optional\)/)
  assert.match(form, /Section 4: Documents \*/)                     // required marker (glyph, not color)
  assert.match(form, /Resume \*/)
  assert.match(form, /Headshot \*/)
  assert.match(form, /Upload both documents to continue\. Your headshot is required for badge creation, and your resume supports interview preparation\./)
})

test('form uploads are fatal and gate on a durable reference (no non-fatal path)', () => {
  assert.doesNotMatch(form, /non-fatal/)                            // old "upload failure is non-fatal" removed
  assert.match(form, /evaluateRequiredDocuments\(/)                 // pre-submit required check
  assert.match(form, /let resume_url = resumeUrl/)                  // reuse a prior successful upload
  assert.match(form, /let headshot_url = headshotUrl/)
  assert.match(form, /if \(!resume_url\)\s+\{ failDocuments/)       // final durable-reference guard
  assert.match(form, /if \(!headshot_url\) \{ failDocuments/)
})

test('form moves focus to the first missing control and scrolls Section 4 into view', () => {
  assert.match(form, /docSectionRef\.current\?\.scrollIntoView/)
  assert.match(form, /firstMissing === 'resume' \? resumeBtnRef\.current : headshotBtnRef\.current/)
})

test('accessibility: inputs are aria-required, described by help text, and errors alert', () => {
  const ariaReq = form.match(/aria-required="true"/g) || []
  assert.ok(ariaReq.length >= 2, 'both file inputs must be aria-required')
  assert.match(form, /aria-describedby="sf-doc-help"/)
  assert.match(form, /id="sf-doc-help"/)
  assert.match(form, /role="alert" id="sf-doc-error"/)
})

test('a new/removed file invalidates its prior durable upload reference', () => {
  assert.match(form, /setResumeFile\(f \|\| null\); setResumeUrl\(''\)/)
  assert.match(form, /setHeadshotFile\(f \|\| null\); setHeadshotUrl\(''\)/)
})

test('upload privacy/access is unchanged: still the signed-upload client, no public URL construction', () => {
  assert.match(form, /signAndUploadIntakeFile\(/)
  assert.doesNotMatch(form, /object\/public/)
})

// ─── Server source guards ───────────────────────────────────────────────────────

test('server enforces the requirement and requests the canonical document columns', () => {
  assert.match(serverApi, /checkDocumentsRequired\(body, student\)/)
  assert.match(serverApi, /error: 'documents_required'/)
  // STUDENT-PORTAL-PROFILE-1: the resolver also loads interview_scheduled_date, the
  // scheduling marker the shared lock reads.
  assert.match(serverApi, /resolveStudentByEmail\(db, cohortId, schoolEmail, 'id, cohort_id, status, interview_scheduled_date, cs_cedars_status, resume_url, headshot_url'\)/)
})

test('existing-submission protection is intact (advanced records are not overwritten)', () => {
  // STUDENT-PORTAL-PROFILE-1: the former local INTAKE_ELIGIBLE_STATUSES list became
  // the SHARED canonical lock (same statuses, plus a booked interview failing closed),
  // used identically by the portal profile endpoint.
  assert.match(serverApi, /if \(isStudentProfileLocked\(student\)\)/)
  assert.match(serverApi, /error: 'already_processed'/)
  // The document check runs before the students update (never mutates an ineligible record).
  assert.ok(serverApi.indexOf('checkDocumentsRequired(body, student)') < serverApi.indexOf(".from('students').update(updates)"))
})
