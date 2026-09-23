// test/signaturesModel.test.mjs
//
// SIGNATURES-PHASE2: the pure rules behind saving a template and the self-filling fields.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { templateIssues, sendIssues, isAutoField, autoFieldValue, fieldType } from '../src/lib/signatures/sigModel.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const recipients = [
  { roleKey: 'r1', type: 'signer', name: 'Student', email: '' },
  { roleKey: 'r2', type: 'signer', name: 'Witness', email: 'witness@cshs.org' },
]
const fields = [
  { id: 'a', type: 'sig', role: 'r1' }, { id: 'b', type: 'sig', role: 'r2' }, { id: 'c', type: 'date', role: 'r1' },
]

test('a template may leave the first signer as a placeholder; a send may not', () => {
  assert.deepEqual(templateIssues({ recipients, fields, documentType: 'acknowledgment' }), [])
  assert.ok(sendIssues({ recipients, fields, documentType: 'acknowledgment' }).some(x => /Student needs a valid email/.test(x)))
})

test('a template still needs a signature field per signer and an email for every kept recipient', () => {
  const noWitnessEmail = recipients.map(r => r.roleKey === 'r2' ? { ...r, email: '' } : r)
  assert.ok(templateIssues({ recipients: noWitnessEmail, fields, documentType: 'acknowledgment' }).some(x => /Witness needs a valid email/.test(x)))
  assert.ok(templateIssues({ recipients, fields: fields.filter(f => f.id !== 'b'), documentType: 'acknowledgment' }).some(x => /Witness has no signature field/.test(x)))
  const badFirst = recipients.map(r => r.roleKey === 'r1' ? { ...r, email: 'nope' } : r)
  assert.ok(templateIssues({ recipients: badFirst, fields, documentType: 'acknowledgment' }).some(x => /not valid/.test(x)))
})

test('Date signed and Time signed fill themselves in the organization time zone', () => {
  assert.equal(fieldType('time').auto, true)
  assert.ok(isAutoField({ type: 'date' }) && isAutoField({ type: 'time' }) && !isAutoField({ type: 'text' }))
  const at = new Date('2026-09-23T22:05:00Z')
  assert.equal(autoFieldValue('date', at, 'America/Los_Angeles'), '09/23/2026')
  assert.match(autoFieldValue('time', at, 'America/Los_Angeles'), /^3:05\sPM PDT$/)
  assert.equal(autoFieldValue('text', at), undefined)
})

test('a template can be saved without sending, and a re-save never blanks its Catalog details', () => {
  const w = read('src/components/signatures/PrepareWizard.jsx')
  assert.match(w, /const saveTemplateOnly = async/)
  assert.match(w, /d\.templateId && !cat\.touched \? undefined/)
  const api = read('api/sig-staff.js')
  assert.match(api, /async function catalogDetails\(db, c\)/)
  assert.match(api, /if \(!c \|\| typeof c !== 'object'\) return null/)
  // A template whose Catalog row failed is removed, never left unreachable.
  assert.match(api, /await db\.from\('sig_templates'\)\.delete\(\)\.eq\('id', data\.id\)/)
})
