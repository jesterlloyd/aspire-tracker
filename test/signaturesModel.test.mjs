// test/signaturesModel.test.mjs
//
// SIGNATURES-PHASE2: the pure rules behind saving a template and the self-filling fields.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { templateIssues, sendIssues, isAutoField, autoFieldValue, fieldType, roleSlots, slotIssues } from '../src/lib/signatures/sigModel.js'

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

test('a template is roles: no email needed, but a signature field per signer and valid emails when typed', () => {
  const noWitnessEmail = recipients.map(r => r.roleKey === 'r2' ? { ...r, email: '' } : r)
  assert.deepEqual(templateIssues({ recipients: noWitnessEmail, fields, documentType: 'acknowledgment' }), [])
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

test('a Catalog PDF can start a template: picked in the wizard or from its ⋯ menu', async () => {
  const api = read('api/sig-staff.js')
  assert.match(api, /case 'import_catalog_file':/)
  // It copies from the Catalog bucket and never writes back to it.
  assert.match(api, /db\.storage\.from\(CATALOG_BUCKET\)\.download\(r\.storage_path\)/)
  assert.doesNotMatch(api, /from\(CATALOG_BUCKET\)\.(upload|remove|move)/)
  assert.match(api, /\/\^sig-template:\/\.test\(r\.storage_path\)/)
  const w = read('src/components/signatures/PrepareWizard.jsx')
  assert.match(w, /<b>Choose from the Catalog<\/b>/)
  const page = read('src/components/catalog/CatalogPage.jsx')
  assert.match(page, /label: 'Make a signature template'/)
  // The bookcase's + New is the header's menu, never a straight-to-upload button.
  assert.match(page, /<NewMenu inCase /)
  assert.doesNotMatch(page, /onNew=\{canManage \? \(\) => setDialog\(\{ type: 'upload' \}\)/)
  // sigLink must exist before the menu that reads it, or the page throws on render.
  assert.ok(page.indexOf('const sigLink = useCallback') < page.indexOf('const menuItems = useCallback'))
  const { isPdfFile } = await import('../src/lib/catalog/catalogModel.js')
  assert.equal(isPdfFile({ resource_type: 'internal_file', file_type_label: 'PDF' }), true)
  assert.equal(isPdfFile({ resource_type: 'internal_file', file_type_label: 'DOCX' }), false)
  assert.equal(isPdfFile({ resource_type: 'internal_file', file_type_label: 'PDF', kind: 'signature' }), false)
})

test('+ New reaches a Catalog PDF, and Classic shows one + New, on the bookcase', () => {
  const page = read('src/components/catalog/CatalogPage.jsx')
  assert.match(page, /<b>Make a template from a Catalog file<\/b>/)
  assert.match(page, /sigLink\('\?tab=prepare&source=catalog'\)/)
  assert.match(page, /\{canManage && !classic && <NewMenu open=\{newOpen\}/)
  assert.match(read('src/components/signatures/SignaturesPage.jsx'), /params\.get\('source'\) === 'catalog' \? \{ source: 'catalog' \}/)
})

test('a send names every role the To field does not fill; a saved person is only a suggestion', () => {
  const roles = [
    { key: 'r1', type: 'signer', label: 'Student', defaultName: 'Student', defaultEmail: '' },
    { key: 'r2', type: 'signer', label: 'Witness', defaultName: 'Witness', defaultEmail: '' },
    { key: 'r3', type: 'cc', label: 'Coordinator', defaultName: 'Jester', defaultEmail: 'j@cshs.org' },
  ]
  const slots = roleSlots(roles)
  assert.deepEqual(slots.map(s => [s.key, s.label, s.name, s.email]), [['r2', 'Witness', '', ''], ['r3', 'Coordinator', 'Jester', 'j@cshs.org']])
  assert.deepEqual(slotIssues(slots), ['Add an email for Witness.'])
  assert.deepEqual(slotIssues(slots.map(s => ({ ...s, email: s.email || 'w@cshs.org' }))), [])
  const modal = read('src/components/catalog/CatalogSendModal.jsx')
  assert.doesNotMatch(modal, /in Edit fields first/)
  assert.match(modal, /fixed: slots\.map\(/)
})
