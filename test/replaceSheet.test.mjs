// test/replaceSheet.test.mjs
//
// REPLACE-SHEET-1 and MONTH-CONTROL-1 (Owner, 2026-10-01). "when replacing a receipt, why wouldn't it
// replace the sheet line too? ... it should update it everywhere", and, asked whether a replacement may
// write into a closed month: "I should be able to control closing or opening of the months; give me
// full editing capability". On real Postgres (PGlite) with the real migrations:
//   - a replacement never writes into a closed month; it names the month, the Owner reopens it, and
//     then it goes through. A replacement that changes nothing in the Sheet is not stopped.
//   - a receipt attached to a row that already existed only sets that row's amount.
//   - a row already Submitted to Concur keeps its Stage and its stored date.
//   - the Owner closes and reopens months in a CLOSED year too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const R = await import('../lib/server/budget/receipts.js')
const M = await import('../src/lib/budget/replaceModel.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-10-01'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261016000000_keith_foundation', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3', '20261024000000_budget_v2_phase4', '20261025000000_budget_fixes_s1', '20261026000000_budget_concur', '20261101000000_receipts_redesign', '20261102000000_receipt_replace_review']

async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 3500, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  return { pg, db, owner }
}
const reading = (total, extra = {}) => ({ document_type: 'receipt', vendor: 'Supabase Pte. Ltd.', order_number: 'LOENXJ-00004', date: '2026-09-29', card_last4: '', subtotal: total, tax: 0, shipping: 0, tip: 0, total, has_shipping_address: false, unreadable_fields: [],
  lines: [{ item: 'Pro Plan', quantity: 1, amount: total, category: 'Technology & Software', confidence: 'high', reason: 'Hosting.' }], ...extra })
const keith = (r) => async () => ({ ok: true, text: JSON.stringify(r), model: 'm', usage: {} })
const bucket = (db) => db.storage.from(R.RECEIPT_BUCKET)
async function filed(db, owner, r, opts = {}) {
  const { receipt, upload } = await R.startUpload(db, owner, { fileName: 'first.pdf', contentType: 'application/pdf', size: 3 })
  await bucket(db).upload(upload.path, Buffer.from('pdf'))
  const out = await R.readReceipt(db, owner, { id: receipt.id, complete: keith(r), today: TODAY })
  const acc = await R.acceptReceipt(db, owner, { id: receipt.id, draft: { ...out.receipt.draft, payment_method: 'personal_concur' }, asOneTime: !opts.attachTo, attachTo: opts.attachTo || null, today: TODAY })
  return { id: receipt.id, rows: acc.expense_ids }
}
async function replacement(db, owner, id, r) {
  const { receipt, upload } = await R.startReplace(db, owner, { id, fileName: 'second.pdf', contentType: 'application/pdf', size: 4 })
  await bucket(db).upload(upload.path, Buffer.from('pdf2'))
  await R.readReceipt(db, owner, { id: receipt.id, complete: keith(r), today: TODAY })
  return (await R.intake(db, { today: TODAY })).waiting.find(x => x.id === receipt.id)
}
const amountOf = async (pg, id) => (await pg.query(`SELECT amount::text FROM budget_expenses WHERE id = $1`, [id])).rows[0].amount

test('a replacement never writes into a closed month: it names it, the Owner reopens it, then it goes through', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner, reading(48.93))
  for (const month of ['2026-07', '2026-08', '2026-09']) await E.closeMonth(db, owner, { fy: 2027, month, note: 'Closed for the test.', today: TODAY })
  const slip = await replacement(db, owner, f.id, reading(26.45))
  // The slip can see the closed month before Accept, from the same context the tab already has.
  const ctx = (await R.intake(db, { today: TODAY })).context
  const closedByYear = new Map(Object.entries(ctx.years).map(([fy, y]) => [Number(fy), y.closedMonths]))
  assert.deepEqual(M.closedMonthsHit(slip.draft, slip.replaces, closedByYear), [{ key: '2026-09', fy: 2027, name: 'September', year: 2026 }])
  await assert.rejects(R.acceptReplacement(db, owner, { id: slip.id, draft: slip.draft, today: TODAY }),
    (e) => e.code === 'month_closed' && e.message === 'September 2026 is closed. Reopen it, then accept the replacement.' && e.details.months[0].key === '2026-09')
  // Nothing changed: the row, the file and the slip are as they were.
  assert.equal(await amountOf(pg, f.rows[0]), '48.93')
  assert.equal((await pg.query(`SELECT status FROM budget_receipts WHERE id = $1`, [slip.id])).rows[0].status, 'review')
  assert.equal((await pg.query(`SELECT file_name FROM budget_receipts WHERE id = $1`, [f.id])).rows[0].file_name, 'first.pdf')
  // The Owner reopens the month; the replacement goes through; the month can be closed again.
  await E.reopenMonth(db, owner, { fy: 2027, month: '2026-09', today: TODAY })
  const out = await R.acceptReplacement(db, owner, { id: slip.id, draft: slip.draft, today: TODAY })
  assert.deepEqual(out.sheet, ['The row: $48.93 becomes $26.45.'])
  assert.equal(await amountOf(pg, f.rows[0]), '26.45')
  assert.equal((await pg.query(`SELECT message FROM budget_events WHERE kind = 'receipt_amount'`)).rows[0].message, 'Supabase Pte. Ltd.: a replacement receipt changed $48.93 to $26.45.')
  assert.equal((await E.closeMonth(db, owner, { fy: 2027, month: '2026-09', note: 'Closed again.', today: TODAY })).closed, '2026-09')
})

test('a replacement that changes nothing in the Sheet is not stopped by a closed month: only the file changes', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner, reading(48.93))
  for (const month of ['2026-07', '2026-08', '2026-09']) await E.closeMonth(db, owner, { fy: 2027, month, note: 'x', today: TODAY })
  const slip = await replacement(db, owner, f.id, reading(48.93))
  const out = await R.acceptReplacement(db, owner, { id: slip.id, draft: slip.draft, today: TODAY })
  assert.deepEqual([out.sheet, out.message], [[], 'The filed receipt now has the new file. The old one is deleted. Expenses already matched it.'])
  assert.equal((await pg.query(`SELECT file_name FROM budget_receipts WHERE id = $1`, [f.id])).rows[0].file_name, 'second.pdf')
})

test('a receipt attached to a row that already existed only sets that row’s amount', async () => {
  const { pg, db, owner } = await world()
  const cat = (await pg.query(`SELECT id FROM budget_categories WHERE name = 'Technology & Software'`)).rows[0].id
  const row = await E.createExpense(db, owner, { today: TODAY, fields: { expense_date: '2026-09-29', item: 'Supabase, my own words', category_id: cat, vendor: 'Supabase', order_number: 'LOENXJ-00004', payment_method: 'personal_concur', amount: 48.93, quantity: 1 } })
  const f = await filed(db, owner, reading(48.93), { attachTo: row.id })
  const slip = await replacement(db, owner, f.id, reading(26.45, { date: '2026-09-30', lines: [{ item: 'Pro Plan', quantity: 1, amount: 26.45, category: 'Miscellaneous', confidence: 'high', reason: 'x' }] }))
  assert.equal(slip.replaces.attached, true)
  assert.deepEqual(M.planLines(M.replacementPlan(slip.draft, slip.replaces)), ['FY27 row 1: $48.93 becomes $26.45.'])
  await R.acceptReplacement(db, owner, { id: slip.id, draft: slip.draft, today: TODAY })
  const [now] = (await pg.query(`SELECT e.item, e.amount::text, e.expense_date::text AS d, c.name AS cat FROM budget_expenses e JOIN budget_categories c ON c.id = e.category_id WHERE e.id = $1`, [row.id])).rows
  assert.deepEqual(now, { item: 'Supabase, my own words', amount: '26.45', d: '2026-09-29', cat: 'Technology & Software' }, 'its own item, date and category stay')
})

test('a row already Submitted to Concur keeps its Stage and its date; the stale Concur draft is cleared', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner, reading(48.93))
  await E.updateExpense(db, owner, { id: f.rows[0], patch: { status: 'submitted' }, today: TODAY })
  await pg.query(`UPDATE budget_receipts SET concur_guidance = '{"amount": 48.93}'::jsonb, policy_confirmed_at = now() WHERE id = $1`, [f.id])
  const slip = await replacement(db, owner, f.id, reading(26.45))
  assert.equal(slip.replaces.rows[0].stage, 'submitted')
  await R.acceptReplacement(db, owner, { id: slip.id, draft: slip.draft, today: TODAY })
  const [row] = (await pg.query(`SELECT status, amount::text, concur_submitted_at IS NOT NULL AS dated FROM budget_expenses WHERE id = $1`, [f.rows[0]])).rows
  assert.deepEqual(row, { status: 'submitted', amount: '26.45', dated: true })
  const [rec] = (await pg.query(`SELECT concur_guidance, policy_confirmed_at FROM budget_receipts WHERE id = $1`, [f.id])).rows
  assert.deepEqual([rec.concur_guidance, rec.policy_confirmed_at], [null, null], 'it quoted the old amount, so it is drafted again on request')
})

test('the pure plan: same category updates, a lone row changing category is one row, attached is the amount alone', () => {
  const target = { attached: false, rows: [{ id: 'a', row_label: 'FY26 row 12', category: 'Technology & Software', item: 'Pro Plan', quantity: 1, amount: 48.93, date: '2026-06-29' }] }
  const draft = (lines, date = '2026-06-29') => ({ vendor: 'Supabase', date, order_number: 'X', lines })
  const line = (category, amount, item = 'Pro Plan') => ({ id: category, item, category, quantity: 1, amount })
  assert.deepEqual(M.planLines(M.replacementPlan(draft([line('Technology & Software', 26.45)]), target)), ['FY26 row 12: $48.93 becomes $26.45.'])
  assert.deepEqual(M.planLines(M.replacementPlan(draft([line('Miscellaneous', 48.93)]), target)), ['FY26 row 12: Technology & Software becomes Miscellaneous.'], 'one row changing category, not a remove and an add')
  assert.deepEqual(M.planLines(M.replacementPlan(draft([line('Technology & Software', 48.93, 'Pro Plan (Jun 29 to Jul 28)')]), target)), ['FY26 row 12: the item becomes "Pro Plan (Jun 29 to Jul 28)".'])
  const none = M.replacementPlan(draft([line('Technology & Software', 48.93)]), target)
  assert.deepEqual([none.changed, none.ops, none.before, none.after], [false, [], 48.93, 48.93])
  const att = M.replacementPlan(draft([line('Miscellaneous', 10), line('Marketing', 16.45)], '2027-01-01'), { ...target, attached: true })
  assert.deepEqual([att.ops.length, att.ops[0].to, att.after], [1, { amount: 26.45, quantity: 1 }, 26.45])
  assert.deepEqual(M.replacementBlocks({ lines: [] }, target), ['Enter an amount.', 'Enter the date.', 'Add at least one line.'])
  assert.deepEqual(M.replacementBlocks({ lines: [{ amount: 5, category: null }] }, { ...target, attached: true }), [], 'an attached receipt needs only its amount')
})

// MONTH-CONTROL-1.
test('the Owner closes and reopens months in a closed year too', async () => {
  const { db, owner } = await world()
  const LATER = '2027-08-01'   // FY27 has ended
  const year = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: LATER })
  assert.equal(year.state, 'closed')
  assert.equal(year.close.target, '2026-07', 'the oldest open month, offered in a closed year as in a current one')
  assert.ok(year.close.checklists['2026-07'])
  assert.equal((await E.closeMonth(db, owner, { fy: 2027, month: '2026-07', note: 'Reconciled late.', today: LATER })).closed, '2026-07')
  assert.equal((await E.loadYear(db, { fy: 2027, viewer: 'owner', today: LATER })).close.target, '2026-08')
  assert.equal((await E.reopenMonth(db, owner, { fy: 2027, month: '2026-07', today: LATER })).reopened, '2026-07')
  const card = read('src/components/budget/BudgetClose.jsx')
  assert.match(card, /const owner = canEdit && \(year\.state === 'current' \|\| year\.state === 'closed'\)/)
})

test('the slip: editable, the plan shown before Accept, Reopen where a closed month is in the way, and edits saved before a reload', () => {
  const slip = read('src/components/budget/ReceiptSlip.jsx')
  assert.match(slip, /const plan = replacementPlan\(d, was\)/)
  assert.match(slip, /const shut = plan\.changed \? closedMonthsHit\(d, was, closedByYear\) : \[\]/)
  assert.match(slip, /disabled=\{busy \|\| blocks\.length > 0 \|\| shut\.length > 0\}/)
  assert.match(slip, /aria-label=\{`Line \$\{i \+ 1\} amount`\}/)
  const tab = read('src/components/budget/BudgetReceipts.jsx')
  assert.match(tab, /await budgetStaff\('receipt_draft', \{ id: slip\.id, draft: slip\.draft \}\)\s*const out = await budgetStaff\('month_reopen'/, 'what is typed is saved before the reload that follows a reopen')
  assert.match(tab, /clearTimeout\(draftTimers\.current\.get\(slip\.id\)\)   \/\/ the draft goes with the accept/)
})
