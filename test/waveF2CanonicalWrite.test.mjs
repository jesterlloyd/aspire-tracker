// WAVE F-2 PASS 2 (canonical-write patch): every write path persists the
// server-returned canonical object path, never a public or signed URL and never a
// browser-supplied path. Static-source guards, plus a resolver both-forms check.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseStoredFileRef } from '../lib/server/studentFiles.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const intake    = read('src/components/StudentIntakeFormPage.jsx')
const sidePanel = read('src/components/StudentSidePanel.jsx')
const client    = read('src/lib/studentFileClient.js')
const staffSign = read('api/student-file-sign.js')
const intakeSign = read('api/student-intake-file-sign.js')
const doc       = read('docs/security/WAVE_F2_STUDENT_FILES.md')

test('intake persists the canonical path (not a URL)', () => {
  assert.match(intake, /const \{ path \} = await signAndUploadIntakeFile\([\s\S]*?kind: 'resume'[\s\S]*?\)\s*\n\s*resume_url = path/)
  assert.match(intake, /const \{ path \} = await signAndUploadIntakeFile\([\s\S]*?kind: 'headshot'[\s\S]*?\)\s*\n\s*headshot_url = path/)
  assert.doesNotMatch(intake, /publicUrlForPath/)
})

test('staff resume/headshot upload (and replacement) persist the canonical path', () => {
  // handleResumeUpload / handleHeadshotUpload back both first-time upload and Replace.
  assert.match(sidePanel, /kind: 'resume', file \}\)[\s\S]*?resume_url: path[\s\S]*?onUpdate\(student\.id, \{ resume_url: path \}\)/)
  assert.match(sidePanel, /kind: 'headshot', file \}\)[\s\S]*?headshot_url: path[\s\S]*?onUpdate\(student\.id, \{ headshot_url: path \}\)/)
  assert.doesNotMatch(sidePanel, /publicUrlForPath/)
})

test('no write path persists a public URL or a signed URL', () => {
  // The getPublicUrl persistence helper is gone from the client.
  assert.doesNotMatch(client, /export function publicUrlForPath/)
  assert.doesNotMatch(client, /\.getPublicUrl\(/)
  // Signed URLs are minted on READ only (createSignedUrl in the access endpoints);
  // no upload flow stores one.
  assert.doesNotMatch(client, /createSignedUrl[^s]/)
  for (const src of [intake, sidePanel]) {
    assert.doesNotMatch(src, /createSignedUrl|getPublicUrl/)
  }
})

test('the path is server-derived; the browser never supplies it for persistence', () => {
  // The client upload requests carry only student identity + declared file metadata;
  // the server returns { token, path } and canonicalPath is built server-side.
  assert.match(client, /signAndUploadStaffFile[\s\S]*?body: JSON\.stringify\(\{ student_id: studentId, kind, filename: file\.name, content_type: file\.type, size: file\.size \}\)/)
  assert.doesNotMatch(client, /body: JSON\.stringify\(\{[^}]*\bpath\b/)  // never posts a path
  assert.match(staffSign, /canonicalPath\(student\.cohort_id, student\.id, kind, meta\.ext\)/)
  assert.match(intakeSign, /canonicalPath\(cohortId, studentId, kind, meta\.ext\)/)
})

test('the compatibility resolver still reads BOTH a legacy public URL and a canonical path', () => {
  const C = '11111111-1111-4111-8111-111111111111'
  const S = '22222222-2222-4222-8222-222222222222'
  const url = `https://proj.supabase.co/storage/v1/object/public/student-files/${C}/${S}/resume.pdf`
  const path = `${C}/${S}/resume.pdf`
  assert.equal(parseStoredFileRef(url).kind, 'legacyPublicUrl')
  assert.equal(parseStoredFileRef(path).kind, 'path')
  assert.equal(parseStoredFileRef(url).path, parseStoredFileRef(path).path)
})

test('future Unit Leader file access is documented, and the portal is NOT implemented', () => {
  assert.match(doc, /Future Unit Leader file access/i)
  assert.match(doc, /server-mediated/i)
  assert.match(doc, /scoped by explicit/i)
  assert.match(doc, /Unit Leader to unit assignments/i)
  assert.match(doc, /NOT built in Wave F-2/i)
  // The Unit Leader portal shell may pre-exist, but Unit Leader student-FILE access
  // must NOT be implemented in Pass 2: the portal references no resume/headshot value
  // and no student-file access endpoint.
  let ul = ''
  try { ul = readFileSync(join(here, '..', 'src/portal/UnitLeaderPortal.jsx'), 'utf8') } catch { ul = '' }
  assert.doesNotMatch(ul, /resume_url|headshot_url|student-file-access|student-file-sign/)
})
