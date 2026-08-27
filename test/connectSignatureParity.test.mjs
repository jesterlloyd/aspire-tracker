// test/connectSignatureParity.test.mjs
//
// SIGNATURE-PREVIEW-PARITY-1 guards:
//   1. The rendered manual-email signature honors the sender's Department and
//      falls back to the exact institute line it always printed.
//   2. The Settings preview mirrors the sent block (Kind regards, shared
//      sender-scoped GIF map, CS-Red name) instead of a lookalike.
//   3. Both send endpoints pass the department through EMPTY when unset, so
//      unset departments render unchanged.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectSignatureImagePath, CONNECT_SIGNATURE_DEFAULT_AFFILIATION } from '../src/lib/connectSignatureAssets.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the shared image map is sender-scoped and normalized', () => {
  assert.equal(connectSignatureImagePath('JesterLloyd.Bautista@cshs.org'), '/signature-jester.gif')
  assert.equal(connectSignatureImagePath('  jesterlloyd.bautista@cshs.org  '), '/signature-jester.gif')
  assert.equal(connectSignatureImagePath('someone.else@cshs.org'), null)
  assert.equal(CONNECT_SIGNATURE_DEFAULT_AFFILIATION, 'Geri & Richard Brawerman Nursing Institute')
})

test('the renderer honors Department and defaults to the historical institute line', () => {
  const tpl = read('lib/server/connect/emailTemplates.js')
  // Affiliation comes from the signature (escaped), with the institute default.
  assert.match(tpl, /escapeHtml\(String\(s\.affiliation \|\| ''\)\.trim\(\) \|\| CONNECT_SIGNATURE_DEFAULT_AFFILIATION\)/)
  assert.match(tpl, /<span style="display:block;">\$\{affiliation\}<\/span>/)
  // The hard-coded institute line is gone; the shared image map is the source.
  assert.doesNotMatch(tpl, /<span style="display:block;">Geri &amp; Richard/)
  assert.match(tpl, /connectSignatureImagePath\(emailKey\)/)
  assert.doesNotMatch(tpl, /const SIGNATURE_IMAGES = \{/)
})

test('the Settings preview mirrors the sent block', () => {
  const panel = read('src/components/settings/SignaturePanel.jsx')
  assert.match(panel, /Kind regards,/)
  assert.doesNotMatch(panel, /Warm regards,/)
  // Same shared map and default as the renderer - never a private lookalike.
  assert.match(panel, /connectSignatureImagePath\(email\)/)
  assert.match(panel, /CONNECT_SIGNATURE_DEFAULT_AFFILIATION/)
  // CS-Red bold name, GIF above the name at the sent dimensions.
  assert.match(panel, /const CS_RED = '#dc1e34'/)
  assert.match(panel, /<strong style=\{\{ color: CS_RED \}\}>/)
  assert.match(panel, /width=\{160\} height=\{60\}/)
})

test('both send endpoints pass the department through empty when unset', () => {
  for (const f of ['api/connect-send-direct-email.js', 'api/connect-send-bulk-message.js']) {
    const src = read(f)
    assert.match(src, /affiliation: String\(cs\.department \|\| ''\)\.trim\(\),/, f)
    assert.doesNotMatch(src, /\.trim\(\) \|\| 'Brawerman Nursing Institute, Cedars-Sinai'/, f)
  }
})

test('invitation emails close with Kind regards (birthday keeps Warm wishes)', () => {
  assert.match(read('lib/server/email/portalInvitation.js'), /aspireSystemSignature\('Kind regards,'\)/)
  assert.match(read('lib/server/email/staffInvitation.js'), /aspireSystemSignature\('Kind regards,'\)/)
  assert.match(read('src/lib/notifications/templates/birthdayGreeting.js'), /aspireHandwrittenSignature\('Warm wishes,'\)/)
})
