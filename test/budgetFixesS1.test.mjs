// BUDGET-FIXES-1 section 1 (Owner, 2026-09-29): the numbers that disagreed.
//   1.1 a receipt attached to a usage-based charge replaces the estimate, logged in Budget History;
//   1.2 a usage-based plan's Amount is the average of its last three receipts, unless the Owner typed
//       it (pinned, "set by you", Use average);
//   1.3 Unallocated on the Plan; 1.4 one receipt count for the selected year; 1.5 no Sum on Amount;
//   1.6 the Platform line. The Owner chose the FULL receipt total for Supabase (2026-09-29), knowing
//   the seed notes say ASPIRE carries half.
// The lifecycle runs on PGlite with the real migrations, including 20261025000000 and its correction.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const R = await import('../lib/server/budget/receipts.js')
const PM = await import('../src/lib/budget/planModel.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3', '20261024000000_budget_v2_phase4']
const FIXES = runnable(read('supabase/migrations/20261025000000_budget_fixes_s1.sql'))

async function world({ fixes = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  if (fixes) await pg.exec(FIXES)
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 3500, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  const supa = (await pg.query(`SELECT id FROM budget_subscriptions WHERE name = 'Supabase Pro'`)).rows[0].id
  await E.decideProposal(db, owner, { id: supa, decision: 'from_year_start', today: TODAY })
  return { pg, db, owner, supa }
}
async function receipt(db, owner, { date, total, name, lines = null }) {
  const reading = { vendor: 'Supabase Pte. Ltd.', order_number: '', date, card_last4: '2002', subtotal: total, tax: 0, shipping: 0, tip: 0, total, has_shipping_address: false, unreadable_fields: [],
    lines: lines || [{ item: 'Supabase Pro plan', quantity: 1, amount: total, category: 'Technology & Software', confidence: 'high', reason: 'Software.' }] }
  const { receipt: rec, upload } = await R.startUpload(db, owner, { fileName: name, contentType: 'application/pdf', size: 3 })
  await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
  return (await R.readReceipt(db, owner, { id: rec.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
}
const rows = async (pg, supa) => (await pg.query(`SELECT charge_date::text AS d, amount::float AS a, state, receipt_file_id IS NOT NULL AS r FROM budget_expenses WHERE subscription_id = $1 AND deleted_at IS NULL ORDER BY charge_date`, [supa])).rows
const subAmount = async (pg, supa) => Number((await pg.query(`SELECT amount FROM budget_subscriptions WHERE id = $1`, [supa])).rows[0].amount)
const spent = async (db) => (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).summary.spent
const history = async (pg) => (await pg.query(`SELECT kind, message FROM budget_events WHERE kind IN ('receipt_amount', 'estimate_updated') ORDER BY created_at, message`)).rows

test('attaching a receipt makes a usage-based charge the receipt total, and the estimate the average of the last three', async () => {
  const { pg, db, owner, supa } = await world()
  const posted = (await rows(pg, supa)).filter(r => r.state === 'posted')
  assert.deepEqual(posted.map(r => [r.d, r.a]), [['2026-07-29', 17.5], ['2026-08-29', 17.5], ['2026-09-29', 17.5]])
  const before = await spent(db)

  for (const [date, total, name] of [['2026-07-29', 28.52, 'jul.pdf'], ['2026-08-29', 35, 'aug.pdf'], ['2026-09-29', 35, 'sep.pdf']]) {
    const r = await receipt(db, owner, { date, total, name })
    await R.acceptReceipt(db, owner, { id: r.id, draft: r.draft, attachCharge: true, today: TODAY })
  }
  const after = await rows(pg, supa)
  assert.deepEqual(after.filter(r => r.state === 'posted').map(r => [r.d, r.a, r.r]), [['2026-07-29', 28.52, true], ['2026-08-29', 35, true], ['2026-09-29', 35, true]])
  assert.equal(Math.round((await spent(db) - before) * 100) / 100, 46.02, 'Spent rises by the difference, about $46.02')
  assert.equal(await subAmount(pg, supa), 32.84, 'the average of $28.52, $35.00 and $35.00')
  assert.ok(after.filter(r => r.state === 'expected').every(r => r.a === 32.84), 'the Expected charges to come follow the estimate')
  const h = await history(pg)
  assert.equal(h.filter(x => x.kind === 'receipt_amount').length, 3)
  assert.ok(h.some(x => x.message === 'Supabase Pro charge on Jul 29, 2026 set to $28.52 from its receipt (was $17.50 est.).'), h.map(x => x.message).join('\n'))
  assert.ok(h.some(x => x.message === 'Supabase Pro estimate set to $32.84 a month from $31.76, the average of its last 3 receipts ($35.00, $35.00, $28.52).'), h.map(x => x.message).join('\n'))
})

test('Undo puts the estimate back on the row and recomputes the plan from the receipts left', async () => {
  const { pg, db, owner, supa } = await world()
  const jul = await receipt(db, owner, { date: '2026-07-29', total: 28.52, name: 'jul.pdf' })
  await R.acceptReceipt(db, owner, { id: jul.id, draft: jul.draft, attachCharge: true, today: TODAY })
  const aug = await receipt(db, owner, { date: '2026-08-29', total: 35, name: 'aug.pdf' })
  await R.acceptReceipt(db, owner, { id: aug.id, draft: aug.draft, attachCharge: true, today: TODAY })
  assert.equal(await subAmount(pg, supa), 31.76)
  await R.undoReceipt(db, owner, { id: aug.id })
  assert.deepEqual((await rows(pg, supa)).filter(r => r.state === 'posted').map(r => r.a), [28.52, 17.5, 17.5])
  assert.equal(await subAmount(pg, supa), 28.52, 'one receipt left: its amount')
  assert.ok((await history(pg)).some(x => x.message === 'Supabase Pro charge on Aug 29, 2026 put back to $17.50 est.; its receipt was undone.'))
})

test('an Amount the Owner types is pinned; receipts do not move it until Use average', async () => {
  const { pg, db, owner, supa } = await world()
  await E.updateSubscription(db, owner, { id: supa, patch: { amount: 40 }, today: TODAY })
  assert.equal((await pg.query(`SELECT amount_pinned FROM budget_subscriptions WHERE id = $1`, [supa])).rows[0].amount_pinned, true)
  const jul = await receipt(db, owner, { date: '2026-07-29', total: 28.52, name: 'jul.pdf' })
  await R.acceptReceipt(db, owner, { id: jul.id, draft: jul.draft, attachCharge: true, today: TODAY })
  assert.equal(await subAmount(pg, supa), 40, 'pinned: the receipt changes its row, not the plan')
  assert.equal((await rows(pg, supa))[0].a, 28.52)
  const out = await E.applyUsageAverage(db, owner, { id: supa, today: TODAY })
  assert.equal(out.amount, 28.52)
  assert.match(out.message, /Supabase Pro now uses \$28\.52 a month, from its last receipt\./)
  assert.equal((await pg.query(`SELECT amount_pinned FROM budget_subscriptions WHERE id = $1`, [supa])).rows[0].amount_pinned, false)
})

test('the migration corrects receipts attached before this change, logs each one, and runs twice', async () => {
  const { pg, db, owner, supa } = await world({ fixes: false })
  for (const [date, total, name] of [['2026-07-29', 28.52, 'jul.pdf'], ['2026-08-29', 35, 'aug.pdf'], ['2026-09-29', 35, 'sep.pdf']]) {
    const r = await receipt(db, owner, { date, total, name })
    await R.acceptReceipt(db, owner, { id: r.id, draft: r.draft, attachCharge: true, today: TODAY })
  }
  // Production today: the receipts attached by the old code, the rows and the plan still at the
  // estimate. (Before the migration the History kinds do not exist, so no line was written.)
  await pg.exec(`UPDATE budget_expenses SET amount = 17.50 WHERE subscription_id = '${supa}';
    UPDATE budget_subscriptions SET amount = 17.50 WHERE id = '${supa}';`)
  assert.equal((await history(pg)).length, 0)
  await pg.exec(FIXES)
  assert.deepEqual((await rows(pg, supa)).filter(r => r.state === 'posted').map(r => r.a), [28.52, 35, 35])
  assert.equal(await subAmount(pg, supa), 32.84)
  assert.ok((await rows(pg, supa)).filter(r => r.state === 'expected').every(r => r.a === 32.84))
  const h = await history(pg)
  assert.equal(h.filter(x => x.kind === 'receipt_amount').length, 3)
  assert.ok(h.some(x => x.message === 'Supabase Pro estimate set to $32.84 a month from $17.50, the average of its last 3 receipts ($35.00, $35.00, $28.52).'), h.map(x => x.message).join('\n'))
  await pg.exec(FIXES)
  assert.equal((await history(pg)).length, h.length, 'a second run changes nothing and logs nothing')
})

test('before the migration the amount still follows the receipt, and nothing fails for the missing kind', async () => {
  const { pg, db, owner, supa } = await world({ fixes: false })
  const jul = await receipt(db, owner, { date: '2026-07-29', total: 28.52, name: 'jul.pdf' })
  await R.acceptReceipt(db, owner, { id: jul.id, draft: jul.draft, attachCharge: true, today: TODAY })
  assert.equal((await rows(pg, supa))[0].a, 28.52)
  assert.equal(await subAmount(pg, supa), 28.52)
  await assert.rejects(E.applyUsageAverage(db, owner, { id: supa, today: TODAY }), /need their database update/)
})

test('the Plan adds up to the budget: Unallocated, or Over budget by', () => {
  assert.deepEqual(PM.unallocated(3500, 1890), { kind: 'left', amount: 1610, text: '$1,610.00' })
  assert.deepEqual(PM.unallocated(1000, 1890), { kind: 'over', amount: 890, text: 'Over budget by $890.00' })
  assert.equal(PM.unallocated(0, 1890).kind, 'no_budget')
  const plan = read('src/components/budget/BudgetPlan.jsx')
  assert.match(plan, /\{leftLine\('bud-unalloc'\)\}/, 'under the categories')
  assert.match(plan, /\{leftLine\('bud-side-row bud-unalloc-side'\)\}/, 'and in the side panel')
})

test('Receipts counts the selected year, and names the others', async () => {
  const { db, owner } = await world()
  const r = await receipt(db, owner, { date: '2026-07-29', total: 28.52, name: 'jul.pdf' })
  await R.acceptReceipt(db, owner, { id: r.id, draft: r.draft, attachCharge: true, today: TODAY })
  const old = await receipt(db, owner, { date: '2026-05-29', total: 26.45, name: 'may.pdf' })
  await R.acceptReceipt(db, owner, { id: old.id, draft: old.draft, asOneTime: true, today: TODAY })
  const out = await R.intake(db, { today: TODAY })
  assert.deepEqual(out.filedByYear, { 2026: 1, 2027: 1 })
  const tab = read('src/components/budget/BudgetReceipts.jsx')
  // BUDGET-TRACKER-1 changed this (Owner, 2026-09-30): Program Budget is now labelled Budget Tracker.
  // RECEIPTS-REDESIGN-1 (commit "RECEIPTS-REDESIGN-1 (2 of 3)") changed this: the drop zone is one compact
  // row, so the selected year's count is the Filed picker's number and the strip's first tile, and the
  // other years are named in the view bar's hint.
  assert.doesNotMatch(tab, /bud-drop-count/)
  assert.match(tab, /\{otherYears\(data, fy\) \? ` \$\{otherYears\(data, fy\)\}\.` : ''\}/)
  assert.match(read('src/components/budget/BudgetFiled.jsx'), /<span className="k">Filed in \{fyShort\(year\.fy\)\}<\/span>/)
  assert.match(tab, /`\$\{n\} more in \$\{fyShort\(Number\(k\)\)\}`/)
  assert.match(tab, /label: <>Filed<span className="bud-view-n">\{filedIn\(data, fy\)\}<\/span><\/>/)
})

test('Subscriptions: no Sum on Amount, and the Platform line says it is program spend', () => {
  const src = read('src/components/budget/BudgetSubscriptions.jsx')
  assert.match(src, /const UNSUMMABLE = new Set\(\['amount'\]\)/)
  assert.match(src, /initialLayout=\{fitPinned\(withoutAmountSum\(/)
  assert.match(src, /unsummable=\{UNSUMMABLE\}/)
  // SUBS-KPI-1 (2026-10-03) shortened the note's wording; it still says it is program spend.
  assert.match(src, /Counted in program spend; shown on its own so it can be reported separately\./)
  assert.doesNotMatch(src, /Reported separately from program spend/)
  assert.match(read('src/components/sheet/EditableSheet.jsx'), /unsummable\.has\(c\.key\) \? null :/)
  assert.match(src, /set by you/)
  // Found in the browser: the year's view dropped the column, and the pinned cell overflowed 160px.
  assert.match(read('lib/server/budget/engine.js'), /amount_pinned: s\.amount_pinned === true,/)
  assert.match(src, /const PINNED_AMOUNT_W = 240/)
})

test('the row takes the total printed on the receipt, not its lines: a credit line is stored as $0', async () => {
  // Production, 2026-09-29: the July Supabase invoice's lines added to $55.14 against a $28.52 total.
  const { pg, db, owner, supa } = await world({ fixes: false })
  const line = (item, amount) => ({ item, quantity: 1, amount, category: 'Technology & Software', confidence: 'high', reason: 'Software.' })
  const jul = await receipt(db, owner, { date: '2026-07-29', total: 28.52, name: 'jul.pdf', lines: [line('Pro plan', 25), line('Compute', 30.14), line('Compute credit', -26.62)] })
  assert.equal(jul.draft.lines.reduce((a, l) => a + l.amount, 0), 55.14, 'the credit line reads as $0')
  await R.acceptReceipt(db, owner, { id: jul.id, draft: jul.draft, attachCharge: true, today: TODAY })
  assert.equal((await rows(pg, supa))[0].a, 28.52)
  // And the migration's correction reads the same total.
  await pg.exec(`UPDATE budget_expenses SET amount = 17.50 WHERE subscription_id = '${supa}'; UPDATE budget_subscriptions SET amount = 17.50 WHERE id = '${supa}';`)
  await pg.exec(FIXES)
  assert.equal((await rows(pg, supa))[0].a, 28.52)
  assert.equal(await subAmount(pg, supa), 28.52)
})

test('the migration has no temporary tables (the SQL editor dropped them between statements)', () => {
  assert.doesNotMatch(FIXES, /TEMP TABLE/i)
})
