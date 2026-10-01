// test/receiptsRedesign.test.mjs
//
// RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): the server side, on real Postgres (PGlite) with the real
// migrations. A Stage change stamps when and by whom wherever it is made and writes a history line;
// the receipt's own Mark submitted waits for the policy tick when Keith's draft carries a warning (the
// Sheet and Close month do not ask); Undo is the same action backwards; Keith's late note carries
// [REASON] and is only for a receipt that IS late; and the migration dates rows already marked.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const R = await import('../lib/server/budget/receipts.js')
const C = await import('../lib/server/budget/concur.js')
const D = await import('../lib/server/keith/skillDefs.js')
const { createBudgetStaffHandler } = await import('../api/budget-staff.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-10-01'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261016000000_keith_foundation', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3', '20261024000000_budget_v2_phase4', '20261025000000_budget_fixes_s1', '20261026000000_budget_concur']
const REDESIGN = runnable(read('supabase/migrations/20261101000000_receipts_redesign.sql'))

async function world({ redesign = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  if (redesign) { await pg.exec(REDESIGN); await pg.exec(REDESIGN) }   // safe to re-run
  await pg.exec(`CREATE TABLE IF NOT EXISTS knowledge_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, slug text, category text, body text, source_attribution text, precedence_rank int, updated_at timestamptz DEFAULT now(), aliases text[], tags text[], body_format text, expires_at date, review_date date, state text);`)
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug IN ('read-receipt', 'prepare-concur')`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 3500, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  return { pg, db, owner }
}
async function filed(db, owner, { vendor = 'Vercel Inc.', total = 20, date = '2026-09-01', method = 'personal_concur', order = 'A-1' } = {}) {
  const reading = { vendor, order_number: order, date, card_last4: '9999', subtotal: total, tax: 0, shipping: 0, tip: 0, total, has_shipping_address: false, unreadable_fields: [],
    lines: [{ item: 'Pro plan', quantity: 1, amount: total, category: 'Technology & Software', confidence: 'high', reason: 'Hosting.' }] }
  const { receipt: rec, upload } = await R.startUpload(db, owner, { fileName: 'r.pdf', contentType: 'application/pdf', size: 3 })
  await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
  const r = (await R.readReceipt(db, owner, { id: rec.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
  const acc = await R.acceptReceipt(db, owner, { id: r.id, draft: { ...r.draft, payment_method: method }, asOneTime: true, today: TODAY })
  return { id: r.id, rows: acc.expense_ids }
}
const guidance = (tone) => JSON.stringify({ report_name: 'ASPIRE Platform Infrastructure - September 2026', expense_type: 'Miscellaneous', description: 'Vercel Pro', business_purpose: 'Runs the app.', attendees: [], attach: [], checks: [{ tone, text: 'Confirm that this plan is necessary for ASPIRE.' }], notes: '' })
const keith = (text) => async () => ({ ok: true, text, model: 'm', usage: {} })
const one = async (db, id) => (await R.filedReceipts(db, { fy: 2027, today: TODAY })).find(x => x.id === id)

test('a filed receipt says where it is in Concur and whether it is late, from the one 60-day rule', async () => {
  const { db, owner } = await world()
  const sep = await filed(db, owner)
  const jul = await filed(db, owner, { date: '2026-07-01', order: 'A-2' })
  const card = await filed(db, owner, { method: 'p_card', order: 'A-3', vendor: 'Staples' })
  const a = await one(db, sep.id)
  assert.deepEqual([a.concurState, a.paid, a.due], ['open', false, { deadline: '2026-10-31', daysLeft: 30, timing: 'ok' }])
  assert.deepEqual([a.submitted_at, a.reimbursed_at, a.policy, a.late_note, a.lateNoteEnabled, a.read_by_keith], [null, null, { enabled: true, confirmed_at: null, confirmed_by: '' }, null, true, true])
  assert.deepEqual((await one(db, jul.id)).due, { deadline: '2026-08-30', daysLeft: -32, timing: 'late' })
  const p = await one(db, card.id)
  assert.deepEqual([p.concurState, p.paid, p.due], [null, true, null], 'a P-card receipt never needs Concur')
})

test('Mark submitted, Mark reimbursed and Undo: the rows, the stored dates and a history line follow', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const sub = await C.setReceiptStage(db, owner, { id: f.id, to: 'submitted', today: TODAY })
  assert.deepEqual([sub.stage, sub.changed, sub.before], ['submitted', 1, [{ id: f.rows[0], status: 'recorded' }]])
  assert.ok(sub.submitted_at)
  let [row] = (await pg.query(`SELECT status, concur_submitted_at, concur_submitted_by, reimbursed_at FROM budget_expenses WHERE id = $1`, [f.rows[0]])).rows
  assert.deepEqual([row.status, !!row.concur_submitted_at, row.concur_submitted_by, row.reimbursed_at], ['submitted', true, owner.id, null])
  let r = await one(db, f.id)
  assert.deepEqual([r.concurState, r.due, !!r.submitted_at], ['submitted', null, true], 'submitted: no deadline any more, and the stamp has its date')

  await C.setReceiptStage(db, owner, { id: f.id, to: 'reimbursed', today: TODAY })
  ;[row] = (await pg.query(`SELECT status, concur_submitted_at, reimbursed_at, reimbursed_by FROM budget_expenses WHERE id = $1`, [f.rows[0]])).rows
  assert.deepEqual([row.status, !!row.concur_submitted_at, !!row.reimbursed_at, row.reimbursed_by], ['reimbursed', true, true, owner.id])

  // Undo is the same action backwards: one step, then the other.
  await C.setReceiptStage(db, owner, { id: f.id, to: 'submitted', today: TODAY })
  ;[row] = (await pg.query(`SELECT status, concur_submitted_at, reimbursed_at FROM budget_expenses WHERE id = $1`, [f.rows[0]])).rows
  assert.deepEqual([row.status, !!row.concur_submitted_at, row.reimbursed_at], ['submitted', true, null], 'the submitted date is kept, the reimbursed one cleared')
  await C.setReceiptStage(db, owner, { id: f.id, to: 'recorded', today: TODAY })
  ;[row] = (await pg.query(`SELECT status, concur_submitted_at, reimbursed_at FROM budget_expenses WHERE id = $1`, [f.rows[0]])).rows
  assert.deepEqual([row.status, row.concur_submitted_at, row.reimbursed_at], ['recorded', null, null])
  assert.equal((await one(db, f.id)).concurState, 'open')

  const events = (await pg.query(`SELECT kind, message FROM budget_events WHERE kind LIKE 'concur_%' ORDER BY created_at`)).rows
  assert.deepEqual(events.map(e => e.kind), ['concur_submitted', 'concur_reimbursed', 'concur_undone', 'concur_undone'])
  assert.equal(events[0].message, 'Pro plan $20.00 marked Submitted to Concur.')
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_changes WHERE entity = 'expense' AND field = 'status'`)).rows[0].n, 4, 'and each is in the row’s own log')
  await assert.rejects(C.setReceiptStage(db, owner, { id: f.id, to: 'paid' }), /Choose Submitted to Concur/)
  const card = await filed(db, owner, { method: 'p_card', order: 'A-9' })
  await assert.rejects(C.setReceiptStage(db, owner, { id: card.id, to: 'submitted' }), /Only a Personal \(Concur\) purchase/)
})

test('the Sheet stamps the same dates: the stamp is the stored date wherever the Stage was changed', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const out = await E.updateExpense(db, owner, { id: f.rows[0], patch: { status: 'submitted' }, today: TODAY })
  assert.ok(out.concur_submitted_at, 'the Sheet’s row carries it')
  assert.ok((await one(db, f.id)).submitted_at)
  assert.deepEqual(E.concurStamps('recorded', 'reimbursed', 'personal_concur', owner, 'T'), { reimbursed_at: 'T', reimbursed_by: owner.id, concur_submitted_at: 'T', concur_submitted_by: owner.id }, 'straight to Reimbursed dates both')
  assert.equal(E.concurStamps('recorded', 'submitted', 'p_card', owner), null)
  assert.equal(E.concurStamps('submitted', 'submitted', 'personal_concur', owner), null)
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_events WHERE kind = 'concur_submitted'`)).rows[0].n, 1)
})

test('Mark submitted waits for the policy tick when Keith’s draft has a warning; the Sheet does not ask', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  await C.prepareConcur(db, owner, { id: f.id, complete: keith(guidance('warn')) })
  await assert.rejects(C.setReceiptStage(db, owner, { id: f.id, to: 'submitted', today: TODAY }), (e) => e.code === 'confirm_first' && /Confirm the business purpose first/.test(e.message))
  const ok = await C.confirmPolicy(db, owner, { id: f.id })
  assert.deepEqual([ok.confirmed, ok.confirmed_by], [true, 'Jester Lloyd Bautista'])
  const r = await one(db, f.id)
  assert.deepEqual([!!r.policy.confirmed_at, r.policy.confirmed_by], [true, 'Jester Lloyd Bautista'])
  const [log] = (await pg.query(`SELECT new_value, actor_name FROM budget_changes WHERE entity = 'receipt' AND field = 'policy_confirmed'`)).rows
  assert.deepEqual([log.new_value, log.actor_name], [{ confirmed: true, by: 'Jester Lloyd Bautista' }, 'Jester Lloyd Bautista'], 'who confirmed it and when, in the audit trail')
  assert.equal((await pg.query(`SELECT message FROM budget_events WHERE kind = 'policy_confirmed'`)).rows[0].message, 'Vercel Inc. $20.00: business purpose confirmed as necessary for ASPIRE operations.')
  assert.equal((await C.setReceiptStage(db, owner, { id: f.id, to: 'submitted', today: TODAY })).changed, 1)

  // A new draft has new checks: the earlier tick no longer stands.
  await C.setReceiptStage(db, owner, { id: f.id, to: 'recorded', today: TODAY })
  await C.prepareConcur(db, owner, { id: f.id, complete: keith(guidance('warn')) })
  assert.equal((await one(db, f.id)).policy.confirmed_at, null)
  await assert.rejects(C.setReceiptStage(db, owner, { id: f.id, to: 'submitted', today: TODAY }), /Confirm the business purpose first/)
  // The Sheet (and Close month, which uses the same path) is not gated (Owner, 2026-10-01).
  assert.equal((await E.updateExpense(db, owner, { id: f.rows[0], patch: { status: 'submitted' }, today: TODAY })).status, 'submitted')

  // An info-only draft asks for nothing.
  const g = await filed(db, owner, { order: 'B-1' })
  await C.prepareConcur(db, owner, { id: g.id, complete: keith(guidance('info')) })
  assert.equal((await C.setReceiptStage(db, owner, { id: g.id, to: 'submitted', today: TODAY })).changed, 1)
})

test('Draft late note: one paragraph with [REASON], only for a late receipt, off until the Owner turns it on', async () => {
  const { pg, db, owner } = await world()
  const jul = await filed(db, owner, { date: '2026-07-01' })
  const sep = await filed(db, owner, { order: 'A-2' })
  const note = 'This expense is submitted after the 60-day window because [REASON]. It is the July Vercel Pro subscription for the ASPIRE Intelligence platform, and the itemized receipt is attached.'
  const [skill] = (await pg.query(`SELECT status, enabled, allowed_roles FROM keith_skills WHERE slug = 'draft-late-note'`)).rows
  assert.deepEqual(skill, { status: 'draft', enabled: false, allowed_roles: ['owner'] }, 'seeded off, with the owner already ticked so Activate works')
  await assert.rejects(C.draftLateNote(db, owner, { id: jul.id, complete: keith(JSON.stringify({ note })), today: TODAY }), (e) => e.code === 'keith_off' && /Settings > Keith > Skills/.test(e.message))
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'draft-late-note'`)
  let sent = null
  const out = await C.draftLateNote(db, owner, { id: jul.id, complete: async (req) => { sent = req; return { ok: true, text: JSON.stringify({ note }), model: 'm', usage: {} } }, today: TODAY })
  assert.equal(out.late_note.text, note)
  assert.ok(out.late_note.provenance_id, 'a Keith mark')
  assert.match(sent.messages[0].content, /"days_late":32/)
  assert.doesNotMatch(sent.messages[0].content, /9999/, 'never a card number')
  assert.equal((await one(db, jul.id)).late_note.text, note, 'saved on the receipt')
  // Keith never invents the reason: a draft without the placeholder is refused, not shown.
  await assert.rejects(C.draftLateNote(db, owner, { id: jul.id, complete: keith(JSON.stringify({ note: 'It is late because I was busy.' })), today: TODAY }), (e) => e.code === 'keith_failed')
  assert.throws(() => D.DRAFT_LATE_NOTE.parse({ note: '[REASON] and [REASON]' }), /exactly once/)
  await assert.rejects(C.draftLateNote(db, owner, { id: sep.id, complete: keith(JSON.stringify({ note })), today: TODAY }), /only for a receipt past the limit/)
})

test('before the update everything still works: no dates, no history kind, and the new pieces say what they need', async () => {
  const { pg, db, owner } = await world({ redesign: false })
  const f = await filed(db, owner)
  const out = await C.setReceiptStage(db, owner, { id: f.id, to: 'submitted', today: TODAY })
  assert.deepEqual([out.changed, out.submitted_at], [1, null])
  assert.equal((await pg.query(`SELECT status FROM budget_expenses WHERE id = $1`, [f.rows[0]])).rows[0].status, 'submitted')
  const r = await one(db, f.id)
  assert.deepEqual([r.concurState, r.submitted_at, r.policy.enabled, r.lateNoteEnabled], ['submitted', null, false, false])
  await assert.rejects(C.confirmPolicy(db, owner, { id: f.id }), (e) => e.code === 'not_enabled' && /20261101000000_receipts_redesign\.sql/.test(e.message))
  await assert.rejects(C.draftLateNote(db, owner, { id: f.id, today: TODAY }), (e) => e.code === 'not_enabled')
  // Keith's Concur draft is not disturbed by the column it cannot clear yet.
  await C.setReceiptStage(db, owner, { id: f.id, to: 'recorded', today: TODAY })
  assert.equal((await C.prepareConcur(db, owner, { id: f.id, complete: keith(guidance('warn')) })).guidance.expense_type, 'Miscellaneous')
})

test('the update dates rows already marked from their own change log, and is safe to run twice', async () => {
  const { pg, db, owner } = await world({ redesign: false })
  const a = await filed(db, owner)
  const b = await filed(db, owner, { order: 'A-2' })
  await E.updateExpense(db, owner, { id: a.rows[0], patch: { status: 'submitted' }, today: TODAY })
  await E.updateExpense(db, owner, { id: b.rows[0], patch: { status: 'submitted' }, today: TODAY })
  await E.updateExpense(db, owner, { id: b.rows[0], patch: { status: 'reimbursed' }, today: TODAY })
  await pg.exec(REDESIGN); await pg.exec(REDESIGN)
  const rows = (await pg.query(`SELECT e.id, e.status, e.concur_submitted_at = (SELECT max(created_at) FROM budget_changes c WHERE c.entity_id = e.id AND c.field = 'status' AND c.new_value #>> '{}' = 'submitted') AS sub_ok,
    e.concur_submitted_by, e.reimbursed_at IS NOT NULL AS paid FROM budget_expenses e WHERE e.id = ANY($1)`, [[a.rows[0], b.rows[0]]])).rows
  const of = (id) => rows.find(x => x.id === id)
  assert.deepEqual([of(a.rows[0]).status, of(a.rows[0]).sub_ok, of(a.rows[0]).concur_submitted_by, of(a.rows[0]).paid], ['submitted', true, owner.id, false])
  assert.deepEqual([of(b.rows[0]).status, of(b.rows[0]).sub_ok, of(b.rows[0]).paid], ['reimbursed', true, true])
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM keith_skills WHERE slug = 'draft-late-note'`)).rows[0].n, 1)
})

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', body, headers: {} }, res)
  })
}
test('the three actions are the Owner’s through the endpoint', async () => {
  const { pg, db, owner } = await world()
  const { rows: [admin] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('An Admin', 'a@x.org', 'admin', false) RETURNING *`)
  const f = await filed(db, owner)
  const as = (profile) => createBudgetStaffHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db, today: () => TODAY, complete: keith('{}') })
  for (const body of [{ action: 'receipt_stage', id: f.id, to: 'submitted' }, { action: 'receipt_policy_confirm', id: f.id }, { action: 'receipt_late_note', id: f.id }]) {
    assert.equal((await call(as(admin), body)).status, 403, `${body.action} is Owner-only`)
  }
  assert.deepEqual((await call(as(owner), { action: 'receipt_policy_confirm', id: f.id, confirmed: true })).body.confirmed, true)
  const st = await call(as(owner), { action: 'receipt_stage', id: f.id, to: 'submitted' })
  assert.deepEqual([st.status, st.body.stage, st.body.changed], [200, 'submitted', 1])
  assert.equal((await call(as(owner), { action: 'receipt_stage', id: f.id, to: 'submitted', when: 'x' })).status, 400, 'an unknown field is refused')
  assert.equal((await call(as(owner), { action: 'receipt_late_note', id: f.id })).status, 409, 'not late: no note')
})

test('the migration is gated, checked and reversible', () => {
  const sql = read('supabase/migrations/20261101000000_receipts_redesign.sql')
  assert.match(sql, /OWNER-GATED: do not apply from a session/)
  assert.match(sql, /-- Rollback:/)
  assert.match(sql, /ARRAY\['owner'\]::text\[\]/, 'seeded with the owner role, or Activate refuses')
  assert.doesNotMatch(sql, /ASPIRE Pro(?=gram\b)gram/)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /20261101000000_receipts_redesign\.sql/)
  assert.match(read('db/audit/receipts_redesign_checks.sql'), /draft-late-note/)
})
