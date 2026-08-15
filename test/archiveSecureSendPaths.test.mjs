// ARCHIVE-SNAPSHOT-1 FAMILY 4: every token-bearing sender hands the exact sent
// HTML to the fail-closed secure archive writer, only after a log id exists.
// Run: node --test test/archiveSecureSendPaths.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SECURE_LINK_TYPES } from '../api/lib/archiveClassification.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const SENDERS = [
  ['api/evaluation-send-bulk-invitations.js', 'evaluation_invitation_sent', 'html'],
  ['api/evaluation-send-test-email.js', 'evaluation_invitation_test', 'html'],
  ['api/evaluation-send-survey-test.js', 'evaluation_survey_test_sent', 'sentHtml'],
  ['api/evaluation-release-casey-fink-post-rotation-survey.js', 'casey_fink_post_rotation_request_sent', 'html'],
  ['api/evaluation-release-post-rotation-survey.js', 'post_rotation_evaluation_request_sent', 'html'],
  ['api/evaluation-release-student-eval-survey.js', 'student_preceptor_eval_request_sent', 'html'],
  ['lib/server/evaluation/preceptorSend.js', 'preceptor_feedback_request_sent', 'html'],
  ['lib/server/certificates/unlockPreceptorCertificate.js', 'preceptor_certificate_ready', 'html'],
]

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

test('the classification registry covers every wired secure sender exactly once', () => {
  assert.deepEqual(new Set(SENDERS.map(([, type]) => type)), new Set(SECURE_LINK_TYPES))
})

for (const [file, type, payload] of SENDERS) {
  test(`${type} archives through the fail-closed writer after log id capture`, () => {
    const src = read(file)
    assert.match(src, /import \{ archiveSentMessage \}/)
    assert.match(src, /\.from\('notification_log'\)/)
    assert.match(src, /\.insert\(/)
    assert.match(src, /\.select\('id'\)/)
    assert.match(src, /\.single\(\)/)
    assert.match(src, /notificationLogId/)

    const logAt = src.indexOf(".from('notification_log')")
    const archiveAt = src.indexOf('archiveSentMessage({', logAt)
    assert.ok(logAt >= 0 && archiveAt > logAt, 'archive must follow the audit row')
    const archiveBlock = src.slice(archiveAt, archiveAt + 500)
    assert.match(archiveBlock, /contentKind: 'secure_link_email'/)
    if (payload === 'html') assert.match(archiveBlock, /\bhtml\s*,/)
    else assert.match(archiveBlock, new RegExp(`html:\\s*${payload}\\b`))
    const guard = src.slice(Math.max(logAt, archiveAt - 180), archiveAt)
    assert.match(guard, /notificationLogId/, 'missing log id must skip the archive')
  })

  test(`${type} notification metadata contains no reusable link or token`, () => {
    const src = stripComments(read(file))
    const start = src.indexOf(".from('notification_log')")
    const end = src.indexOf(".select('id')", start)
    assert.ok(start >= 0 && end > start)
    const logInsert = src.slice(start, end)
    assert.doesNotMatch(logInsert, /\b(?:survey_url|surveyUrl|testUrl|downloadUrl|certificateUrl|token)\s*:/,
      'notification_log metadata must never persist a reusable credential')
  })
}

test('secure integration does not add a second provider send or re-render inside archive blocks', () => {
  for (const [file] of SENDERS) {
    const src = stripComments(read(file))
    const block = src.match(/archiveSentMessage\(\{[\s\S]*?templateVersion:\s*1,?[\s\S]*?\}\);?/m)?.[0] || ''
    assert.ok(block, `${file} archive call not found`)
    assert.doesNotMatch(block, /emails\.send|build[A-Z].*Email|generateToken|\.from\(/, file)
  }
})
