// test/outreachFormButton.test.mjs
//
// OUTREACH-FORM-BUTTON-1 (2026-09-24): an Outreach email's button can open a Catalog form.
// The button holds the FORM; each recipient's email gets their OWN link at send time, a
// preview gets the bare address and creates nothing, and a respondent can get their filed
// copy again from the same link. Real Postgres (PGlite) through the forms engine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.env.FORM_TOKEN_SECRET ||= 'test-form-secret-0123456789abcdef0123456789'
const E = await import('../lib/server/forms/engine.js')
const B = await import('../lib/server/forms/outreachButtons.js')
const M = await import('../src/lib/forms/formModel.js')
const { buttonAttrs } = await import('../src/components/connect/blocks/ButtonBlock.js').catch(() => ({}))

const read = (p) => readFileSync(join(root, p), 'utf8')
const formsTest = read('test/formsEngine.test.mjs')
const PRELUDE = formsTest.match(/const PRELUDE = `([\s\S]*?)`/)[1]
const sigMigration = read('supabase/migrations/20260927000000_signatures_phase2.sql')
const formsMigration = read('supabase/migrations/20260928000000_forms_phase3.sql')

async function world() {
  const pg = new PGlite()
  await pg.exec(PRELUDE); await pg.exec(sigMigration); await pg.exec(formsMigration)
  const db = pgliteRest(pg)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (role, is_owner, email, full_name) VALUES ('owner', true, 'owner@cshs.org', 'Jester Lloyd Bautista') RETURNING *`)
  const { rows: [student] } = await pg.query(`INSERT INTO students (first_name, last_name, school, unit, school_email) VALUES ('Ava', 'Reyes', 'UCLA', '6 NE', 'ava@ucla.edu') RETURNING *`)
  const form = await E.createForm(db, { title: 'Sizes', definition: { title: 'Sizes', questions: [{ id: 'a', type: 'short', label: 'A', required: true, help: '' }] } }, owner)
  await E.publish(db, form.id, owner)
  return { pg, db, owner, student, form: await E.loadForm(db, form.id) }
}
const appUrl = 'https://aspire.test'
const button = (formId, extra = '') => `<p>Hi</p><div data-label="Complete your form" data-url="" data-form="${formId}" data-form-title="Sizes"${extra} data-aspire-block="button"></div><p>Thanks</p>`

test('the editor stores the form on the button, never a link', () => {
  const src = read('src/components/connect/blocks/ButtonBlock.js')
  assert.match(src, /'data-form': attrs\.form/)
  if (buttonAttrs) {
    assert.deepEqual(buttonAttrs({ label: 'Go', form: 'f1', formTitle: 'Sizes', url: 'https://x.org' }), { label: 'Go', url: '', form: 'f1', formTitle: 'Sizes', due: '', reminders: '' })
    assert.deepEqual(buttonAttrs({ label: 'Go', url: 'https://x.org' }), { label: 'Go', url: 'https://x.org', form: '', formTitle: '', due: '', reminders: '' })
  }
  const modal = read('src/components/connect/blocks/ButtonModal.jsx')
  assert.match(modal, /A Catalog form/)
  assert.match(modal, /eq\('kind', 'form'\)/)
})

test('buttons are found, previewed without a link, and a plain button is left alone', async () => {
  const html = button('11111111-1111-4111-8111-111111111111', ' data-due="2026-10-01" data-reminders="off"') + '<div data-label="Site" data-url="https://x.org" data-aspire-block="button"></div>'
  assert.deepEqual(B.formButtons(html), [{ formId: '11111111-1111-4111-8111-111111111111', dueAt: '2026-10-01', reminders: 'off' }])
  const pv = await B.previewFormButtons(html, appUrl)
  assert.match(pv, /data-url="https:\/\/aspire\.test\/form"/)
  assert.doesNotMatch(pv, /data-form|data-due|data-reminders/)
  assert.match(pv, /data-url="https:\/\/x\.org"/, 'an ordinary button keeps its address')
  assert.equal(B.hasFormButtons('<p>none</p>'), false)
})

test('each recipient gets their own link; a second send reuses it; a failed email withdraws a new one', async () => {
  const w = await world()
  const html = button(w.form.id, ' data-due="2026-10-01"')
  const forms = await B.prepareFormButtons(w.db, html)
  const ctx = { forms, batchId: '22222222-2222-4222-8222-222222222222', subject: 'Your form', appUrl, sender: w.owner }
  const ava = await B.personalizeFormButtons(w.db, html, { ...ctx, person: { name: 'Ava Reyes', email: 'ava@ucla.edu', studentId: w.student.id } })
  const ben = await B.personalizeFormButtons(w.db, html, { ...ctx, person: { name: 'Ben Cho', email: 'ben@ucla.edu' } })
  const linkOf = (h) => h.match(/data-url="(https:\/\/aspire\.test\/form#t=[A-Za-z0-9_-]{43})"/)?.[1]
  assert.ok(linkOf(ava.html) && linkOf(ben.html))
  assert.notEqual(linkOf(ava.html), linkOf(ben.html), 'every link is personal')
  assert.doesNotMatch(ava.html, /data-form/)
  assert.equal(ava.created.length, 1)
  await E.settleOutreachLinks(w.db, ava.created, true)
  await E.settleOutreachLinks(w.db, ben.created, false)

  const { rows } = await w.pg.query(`SELECT email, status, student_id, due_at, delivery_ok, audience_label FROM form_assignments ORDER BY email`)
  assert.equal(rows[0].email, 'ava@ucla.edu'); assert.equal(rows[0].status, 'sent'); assert.equal(rows[0].student_id, w.student.id)
  assert.equal(rows[0].delivery_ok, true); assert.equal(rows[0].audience_label, 'ASPIRE Connect Outreach')
  assert.equal(new Date(rows[0].due_at).toISOString(), '2026-10-02T06:59:00.000Z', 'due at the end of the day, Pacific time')
  assert.equal(rows[1].status, 'voided', 'an email that failed takes its new link back')

  const again = await B.personalizeFormButtons(w.db, html, { ...ctx, person: { name: 'Ava Reyes', email: 'ava@ucla.edu', studentId: w.student.id } })
  assert.equal(again.created.length, 0)
  assert.equal(linkOf(again.html), linkOf(ava.html), 'an open link is sent again, not a second one')
  const link = await E.resolveLink(w.db, linkOf(ava.html).split('#t=')[1])
  assert.equal(link.assignment.email, 'ava@ucla.edu')
})

test('an unpublished or missing form stops the send before anyone is emailed', async () => {
  const w = await world()
  const draft = await E.createForm(w.db, { title: 'Draft one' }, w.owner)
  await assert.rejects(B.prepareFormButtons(w.db, button(draft.id)), /not published yet/)
  await assert.rejects(B.prepareFormButtons(w.db, button('33333333-3333-4333-8333-333333333333')), /no longer exists/)
})

test('the respondent can get their filed copy again from the same link', async () => {
  const w = await world()
  const html = button(w.form.id)
  const forms = await B.prepareFormButtons(w.db, html)
  const p = await B.personalizeFormButtons(w.db, html, { forms, batchId: '44444444-4444-4444-8444-444444444444', appUrl, sender: w.owner, person: { name: 'Ben Cho', email: 'ben@ucla.edu' } })
  const token = p.html.match(/#t=([A-Za-z0-9_-]{43})/)[1]
  const link = await E.resolveLink(w.db, token)
  await assert.rejects(E.respondentCopy(w.db, link), /until the form is submitted/)
  await E.submit(w.db, { ...link, answers: { a: 'yes' } }, { mailer: { emails: { send: async () => ({ data: {}, error: null }) } }, appUrl })
  const after = await E.resolveLink(w.db, token)
  const state = await E.respondentState(w.db, after)
  assert.equal(state.state, 'done'); assert.equal(state.copy, true)
  const copy = await E.respondentCopy(w.db, after)
  assert.equal(copy.fileName, 'Sizes.pdf')
  assert.ok(Buffer.from(copy.pdf, 'base64').subarray(0, 5).toString('latin1') === '%PDF-')
})

test('both send paths make links per recipient, and send-to-one refuses CC with a form button', () => {
  const bulk = read('api/connect-send-bulk-message.js')
  assert.match(bulk, /prepareFormButtons\(supabaseAdmin, bodyRaw\)/)
  assert.match(bulk, /personalizeFormButtons\(supabaseAdmin, mergedBody/)
  assert.match(bulk, /settleFormButtons\(supabaseAdmin, formRows, !sendError\)/)
  assert.match(bulk, /previewFormButtons\(mergedBody\)/)
  const direct = read('api/connect-send-direct-email.js')
  assert.match(direct, /cannot be sent with CC/)
  assert.match(direct, /personalizeFormButtons\(supabaseAdmin, trimmedBody/)
  assert.match(direct, /settleFormButtons\(supabaseAdmin, formRows, !sendError\)/)
})

test('the no-account pages show the organization\'s document logo and application title', () => {
  const brand = read('api/organization-brand.js')
  assert.match(brand, /title: org\.header_short_name/)
  assert.match(brand, /organizationAssetUrl\(supabaseAdmin, org\.document_logo_path\)/)
  assert.doesNotMatch(brand, /main_phone|general_email|address_line/, 'nothing but the brand is public')
  for (const f of ['src/pages/FormPage.jsx', 'src/components/signatures/SignerFlow.jsx']) {
    const src = read(f)
    assert.match(src, /<PublicBrand/, f)
    assert.doesNotMatch(src, /<i aria-hidden="true">A<\/i>ASPIRE Intelligence/, f)
  }
})
