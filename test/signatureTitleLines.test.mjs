// test/signatureTitleLines.test.mjs
//
// SIG-TITLE-2 (Owner, 2026-10-29): a signature title may run to two lines, held in the one
// stored `title` field after a line break. The Connect renderer, the Settings preview and the
// signature-request prefill all read it through signatureTitleLines; the automated emails carry
// the Program Lead's second line, "ASPIRE Lead".
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { signatureTitleLines } from '../src/lib/connectSignatureAssets.js'
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('a title splits into at most two trimmed lines', () => {
  assert.deepEqual(signatureTitleLines('Nursing Professional Development Practitioner\nASPIRE Lead'),
    ['Nursing Professional Development Practitioner', 'ASPIRE Lead'])
  assert.deepEqual(signatureTitleLines('  One line  '), ['One line'])
  assert.deepEqual(signatureTitleLines('\nASPIRE Lead\r\n'), ['ASPIRE Lead'])
  assert.deepEqual(signatureTitleLines('a\nb\nc'), ['a', 'b'])
  assert.deepEqual(signatureTitleLines(null), [])
})

test('a Connect email prints each title line on its own line, escaped', () => {
  const { html } = buildDirectMessageEmail({
    body: 'Hello',
    signature: { displayName: 'Jester Lloyd Bautista', credentials: 'PhD', title: 'NPD Practitioner\nASPIRE <Lead>', affiliation: '', email: 'x@example.org', phone: '' },
  })
  assert.match(html, /<span style="display:block;">NPD Practitioner<\/span>\s*<span style="display:block;">ASPIRE &lt;Lead&gt;<\/span>/)
})

test('the Settings preview and the signature prefill read the same split', () => {
  assert.match(read('src/components/settings/ProfilePanel.jsx'), /signatureTitleLines\(form\.title\)\.map/)
  assert.match(read('src/components/settings/ProfilePanel.jsx'), /id="pf-title2"/)
  assert.match(read('lib/server/signatures/engine.js'), /cs\.title \|\| ''\)\.split\(\/\\r\?\\n\/\)/)
})

test('every automated signature names ASPIRE Lead under the title', () => {
  for (const p of ['lib/server/email/aspireShell.js', 'src/lib/notifications/handwrittenSignature.js', 'src/lib/notifications/templates/midpointCheckin.js']) {
    assert.match(read(p), /Nursing Professional Development Practitioner<\/span>\s*<span style="display:block;">ASPIRE Lead<\/span>/, p)
  }
  assert.match(read('src/lib/notifications/templates/clockoutReminder.js'), /'Nursing Professional Development Practitioner',\s*'ASPIRE Lead',/)
})
