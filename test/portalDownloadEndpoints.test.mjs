// ASPIRE-STUDENT-HOME: static-source security guards for the student-facing
// document download endpoints. Confirms JWT authentication, an ACTIVE student
// grant, server-side linked-student resolution (never a client-supplied id),
// sanitized errors, and that no storage path / bucket / signed URL / internal
// id is ever involved or returned.
// Run: node --test test/portalDownloadEndpoints.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const cert = read('api/portal/download-certificate.js')
const badge = read('api/portal/download-badge.js')

// Properties every portal download endpoint must share.
function sharedSecurity(src, name) {
  test(`${name}: shared portal-download security`, async (t) => {
    await t.test('GET only; other methods 405', () => {
      assert.match(src, /if \(req\.method !== 'GET'\) return res\.status\(405\)/)
    })
    await t.test('authenticates the JWT via verifyPortalCaller', () => {
      assert.match(src, /verifyPortalCaller\(req\)/)
      assert.match(src, /if \(!auth\.authenticated\)/)
    })
    await t.test('requires an ACTIVE student role grant', () => {
      assert.match(src, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
      assert.match(src, /if \(!isStudent\) return res\.status\(403\)/)
    })
    await t.test('resolves the linked student server-side (revoked -> empty -> denied)', () => {
      assert.match(src, /getActiveStudentLinks\(db, auth\.profile\.id\)/)
      assert.match(src, /if \(studentIds\.length === 0\)/)
    })
    await t.test('never reads a student_id / certificate_id / path from the client', () => {
      assert.doesNotMatch(src, /req\.query/, 'must not read req.query')
      assert.doesNotMatch(src, /req\.body/, 'must not read req.body')
      assert.doesNotMatch(src, /student_id\s*=\s*req\./)
    })
    await t.test('uses the service role only on the server', () => {
      assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/)
      assert.match(src, /getServiceDb\(\)/)
    })
    await t.test('never touches storage buckets, signed URLs, or public URLs', () => {
      assert.doesNotMatch(src, /storage\.from|createSignedUrl|getPublicUrl|\.bucket|signedUrl/i)
    })
    await t.test('never returns internal identifiers', () => {
      assert.doesNotMatch(src, /auth_user_id/)
      assert.doesNotMatch(src, /user_profile_id/)
    })
    await t.test('errors are sanitized (generic message, no stack/provider leak)', () => {
      assert.match(src, /catch \{[\s\S]*?internal_error/)
      assert.doesNotMatch(src, /err\.message|error\.message|\.stack/)
    })
    await t.test('responses are never cached', () => {
      assert.match(src, /Cache-Control['"],\s*'no-store'/)
    })
  })
}

sharedSecurity(cert, 'download-certificate')
sharedSecurity(badge, 'download-badge')

test('download-certificate specifics', async (t) => {
  await t.test('resolves the certificate by the LINKED student id set only', () => {
    assert.match(cert, /\.from\('certificates'\)/)
    assert.match(cert, /\.in\('student_id', studentIds\)/)
  })
  await t.test('requires the certificate to be unlocked (certificate_unlocked_at) and numbered', () => {
    assert.match(cert, /c\.certificate_unlocked_at && c\.certificate_number/)
  })
  await t.test('generates the PDF on demand and streams it as an attachment', () => {
    assert.match(cert, /generateCompletionCertificate\(/)
    assert.match(cert, /Content-Type['"],\s*'application\/pdf'/)
    assert.match(cert, /Content-Disposition['"],\s*`attachment; filename="/)
    assert.match(cert, /Buffer\.from\(pdfBytes\)/)
  })
  await t.test('never creates a certificate, assigns a number, or issues via RPC', () => {
    // Read-only: no writes and no issuance RPC (the comment may mention
    // certificate_sequences to state that it is never touched).
    assert.doesNotMatch(cert, /\.insert\(|\.update\(|\.upsert\(/)
    assert.doesNotMatch(cert, /issue_participation_certificate|\.rpc\(/)
  })
  await t.test('unavailable certificate returns a sanitized 404', () => {
    assert.match(cert, /status\(404\)\.json\(\{ error: 'certificate_unavailable' \}\)/)
  })
})

test('download-badge specifics (documented no-file limitation)', async (t) => {
  await t.test('returns a sanitized unavailable rather than fabricating a badge', () => {
    assert.match(badge, /status\(404\)\.json\(\{ error: 'badge_unavailable' \}\)/)
    // No badge file is generated, streamed, or read (the doc comment may still
    // reference badgeGenerator.js to explain the limitation).
    assert.doesNotMatch(badge, /Content-Disposition/)
    assert.doesNotMatch(badge, /generateBadgePNGs|res\.send\(|res\.write\(/)
  })
  await t.test('documents that no server-side badge artifact exists', () => {
    assert.match(badge, /no server-side badge artifact/i)
  })
  await t.test('still enforces the full authorization boundary before responding', () => {
    // The unavailable response is reached only AFTER auth + grant + link checks.
    const authIdx = badge.indexOf("getActiveStudentLinks")
    const unavailIdx = badge.lastIndexOf("badge_unavailable")
    assert.ok(authIdx > 0 && unavailIdx > authIdx, 'authz precedes the unavailable response')
  })
})
