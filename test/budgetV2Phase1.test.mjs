// test/budgetV2Phase1.test.mjs
//
// BUDGET-V2 Phase 1 (2026-09-29), correct numbers. Reference: docs/mockups/program-budget-v2.html.
//   1. A receipt for a subscription charge attaches to it, or holds until the plan is approved; it
//      never adds a second row unless the owner says "Post as one-time instead".
//   3. Every subscription has one status; two plans from one vendor at once are a question; a
//      proposal shows what it would cost.
//   5. A remembered card sets the payment method on every open receipt paid with it.
//   Void counts nowhere, the Sheet's Σ row included.
// The rules are pure and tested here; the lifecycle runs on PGlite with the real migrations and the
// Owner's own subscriptions. The day is fixed at 2026-09-29.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../src/lib/budget/budgetModel.js')
const C = await import('../src/lib/budget/chargeMatch.js')
const K = await import('../src/lib/budget/receiptChecks.js')
const RM = await import('../src/lib/budget/receiptModel.js')
const R = await import('../lib/server/budget/receipts.js')
const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'

// The Owner's plans, as seeded (db/migrations/seed_program_budget_subscriptions_proposed.sql).
const resend = { id: 'rs', name: 'Resend', vendor: 'Resend', billing: 'monthly', amount: 20, anchor_date: '2026-09-16', start_date: '2026-07-16', end_date: null, auto_renew: true, approval_state: 'proposed' }
const max = { id: 'mx', name: 'Claude Max', vendor: 'Anthropic, PBC', billing: 'monthly', amount: 100, anchor_date: '2026-09-01', start_date: '2026-06-01', end_date: null, auto_renew: true, approval_state: 'proposed' }
const pro = { id: 'pr', name: 'Claude Pro annual purchase', vendor: 'Anthropic, PBC', billing: 'annual', amount: 200, anchor_date: '2026-04-15', start_date: '2026-04-15', end_date: '2026-05-31', auto_renew: false, approval_state: 'proposed' }
const supa = { id: 'sp', name: 'Supabase Pro', vendor: 'Supabase Pte. Ltd.', billing: 'usage', amount: 17.5, anchor_date: '2026-08-29', start_date: '2026-05-29', end_date: null, auto_renew: true, approval_state: 'proposed' }
const draft = (vendor, date, amount, extra = {}) => ({ vendor, date, order_number: '', total: amount, lines: [{ id: 'l1', item: 'Plan', category: 'Technology & Software', quantity: 1, amount }], payment_method: 'personal_concur', business_purpose: '', attendees: [], ...extra })

// ── Item 3: statuses, the overlap check, "if approved" ───────────────────────────

test('a vendor is one vendor however it is written', () => {
  assert.ok(M.sameVendor('Anthropic', 'Anthropic, PBC'))
  assert.ok(M.sameVendor('SUPABASE', 'Supabase Pte. Ltd.'))
  assert.ok(M.sameVendor('Vercel', 'Vercel Inc.'))
  assert.ok(!M.sameVendor('Resend', 'Vercel Inc.'))
  assert.ok(!M.sameVendor('', 'Vercel'))
})

test('every subscription has one status, and the ones the app cannot place need a decision', () => {
  const st = (s, opts) => M.subscriptionStatus(s, TODAY, opts).label
  assert.equal(st(resend), 'Awaiting approval')
  assert.equal(st(pro), 'Ended', 'Claude Pro ended May 31, 2026, before FY27')
  assert.equal(st({ ...resend, approval_state: 'approved' }), 'Active')
  assert.equal(st({ ...resend, approval_state: 'approved', end_date: '2026-12-31' }), 'Ending')
  assert.equal(st({ ...resend, approval_state: 'declined' }), 'Declined')
  assert.equal(st({ ...pro, end_date: null }), 'Needs a decision', 'annual, no renewal, no end: no next charge and nothing says it stopped')
  assert.equal(st({ ...resend, amount: 0 }), 'Needs a decision')
  assert.equal(st({ ...supa, amount: 0 }), 'Awaiting approval', 'a usage estimate may be zero')
  assert.equal(st(resend, { overlapping: true }), 'Needs a decision')
})

test('the overlap check asks only about plans from one vendor that share days', () => {
  assert.deepEqual(M.subscriptionOverlaps([resend, max, pro, supa]), [], 'the Owner’s Pro ended the day before Max began')
  // The mockup's case: Pro with no end, Max from Jun 1.
  const open = M.subscriptionOverlaps([max, { ...pro, end_date: null }])
  assert.equal(open.length, 1)
  assert.deepEqual([open[0].end.id, open[0].keep.id, open[0].endOn], ['pr', 'mx', '2026-05-31'], 'the older plan ends the day before the newer began')
  assert.deepEqual(M.subscriptionOverlaps([max, { ...pro, end_date: null, overlap_kept: true }]), [], 'Keep both stops asking')
  assert.deepEqual(M.subscriptionOverlaps([max, { ...pro, end_date: null, approval_state: 'declined' }]), [], 'a declined plan runs nowhere')
  assert.deepEqual([...M.overlappingIds([max, { ...pro, end_date: null }])], ['pr'], 'only the plan it would end needs a decision')
  const ps = M.proposalSummary([max, { ...pro, end_date: null }], 2027, TODAY)
  assert.deepEqual(ps.plans.map(p => p.name), ['Claude Max'], 'and it is not offered for approval until decided')
})

test('a proposal shows what approval would add; anything else shows nothing', () => {
  assert.deepEqual(M.ifApproved(max, 2027, TODAY), { perYear: 1200, due: 900 }, 'Oct 1 to Jun 1, nine charges')
  assert.deepEqual(M.ifApproved(resend, 2027, TODAY), { perYear: 240, due: 180 })
  assert.equal(M.ifApproved(pro, 2027, TODAY), null, 'ended')
  assert.equal(M.ifApproved({ ...max, approval_state: 'approved' }, 2027, TODAY), null)
})

// ── Item 1: the charge match ─────────────────────────────────────────────────────

test('a receipt for a proposed plan’s charge holds; an approved one attaches; nothing else is guarded', () => {
  const m = C.matchSubscriptionCharge(draft('Resend', '2026-07-16', 20), [resend])
  assert.equal(m.kind, 'hold')
  assert.equal(m.charge_date, '2026-07-16')
  assert.equal(C.matchText(m), 'Matches the Resend subscription charge on Jul 16 ($20.00). Posting it as a new row would count this charge twice. Resend is awaiting approval, so hold this receipt until you approve it.')
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-19', 20), [resend])?.charge_date, '2026-07-16', 'three days either side')
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-20', 20), [resend]), null, 'four is too far')
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-16', 20.02), [resend]), null, 'a fixed price matches to the cent')

  const approved = { ...resend, approval_state: 'approved', post_from: '2026-07-01' }
  const row = { id: 'e1', subscription_id: 'rs', charge_date: '2026-07-16', receipt_file_id: null, row_label: 'FY27 row 1' }
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-16', 20), [approved], [row]).kind, 'attach')
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-16', 20), [approved], [{ ...row, receipt_file_id: 'd' }]).kind, 'filed')
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-16', 20), [{ ...approved, post_from: TODAY }], []).kind, 'uncounted', 'approved from today: July does not count')
  assert.ok(!C.GUARDED.has('uncounted'))
  assert.equal(C.matchSubscriptionCharge(draft('Resend', '2026-07-16', 20), [{ ...resend, approval_state: 'declined' }]), null)
})

test('two plans from one vendor are told apart by amount, and a usage plan matches on vendor and date', () => {
  assert.equal(C.matchSubscriptionCharge(draft('Anthropic', '2026-08-01', 100), [pro, max]).subscription.name, 'Claude Max')
  const s = C.matchSubscriptionCharge(draft('Supabase', '2026-07-29', 26.45), [supa])
  assert.equal(s.kind, 'hold')
  assert.equal(s.usage, true)
  // BUDGET-FIXES-1 changed this: attaching now makes a usage-based row the receipt's total (item 1.1).
  assert.match(C.matchText({ ...s, kind: 'attach' }), /usage-based, so the row takes this receipt’s total in place of its estimate/)
})

test('the slip’s checks carry the match, and a matched receipt is not new spend', () => {
  const years = new Map([[2027, { state: 'current', total: 40000, spent: {}, plan: null }]])
  const out = K.receiptChecks(draft('Resend', '2026-07-16', 20), { years, subscriptions: [resend], today: TODAY })
  assert.equal(out.subMatch.kind, 'hold')
  assert.ok(out.checks.some(c => c.key === 'sub_match' && c.tone === 'warn'))
  assert.ok(!out.checks.some(c => c.key === 'plan'), 'no plan line for a charge that is not new spend')
  assert.deepEqual(RM.slipState(out, 1), { tone: 'warn', text: 'Matches Resend · awaiting approval' })
  const plain = K.receiptChecks(draft('Staples', '2026-09-03', 20), { years, subscriptions: [resend], today: TODAY })
  assert.equal(plain.subMatch, null)
  assert.ok(plain.checks.some(c => c.key === 'plan'), 'BUDGET-V2 item 16: one plan line')
})

// ── Item 5: remember a card ──────────────────────────────────────────────────────

test('a remembered card reads as the owner said, after the P-card', () => {
  const cards = [{ last4: '2002', method: 'personal_concur' }]
  assert.deepEqual(RM.paymentFromCard('2002', '', cards), { method: 'personal_concur', tone: 'ok', text: 'Card ending 2002 is remembered as Personal (Concur).', remembered: true })
  assert.equal(RM.paymentFromCard('2002', '2002', cards).method, 'p_card', 'the P-card on file wins')
  assert.equal(RM.paymentFromCard('9999', '', cards).method, null)
  const slips = [{ id: 'a', draft: { payment_method: null }, proposal: { card_last4: '2002' } }, { id: 'b', draft: { payment_method: 'personal_concur' }, proposal: { card_last4: '2002' } }, { id: 'c', draft: { payment_method: null }, proposal: { card_last4: '1111' } }]
  assert.deepEqual(RM.receiptsOnCard(slips, '2002', 'personal_concur', 'x').map(s => s.id), ['a'], 'only the ones it would change')
})

// ── Void ─────────────────────────────────────────────────────────────────────────

test('Void counts nowhere: not in Spent, not in the Sheet’s Σ row or group subtotals', () => {
  const rows = [{ amount: 10, status: 'recorded', expense_date: '2026-09-01' }, { amount: 99, status: 'void', expense_date: '2026-09-02' }]
  const s = M.budgetSummary({ fy: 2027, budget: { total: 1000, started_at: '2026-07-01' }, expenses: rows, today: TODAY })
  assert.deepEqual([s.spent, s.expenseCount], [10, 1])
  const sheet = read('src/components/sheet/EditableSheet.jsx')
  assert.match(sheet, /summarize\(\(countsInTotals \? rows\.filter\(countsInTotals\) : rows\)/)
  assert.match(sheet, /summarize\(\(countsInTotals \? group\.rows\.filter\(countsInTotals\) : group\.rows\)/)
  const budgetSheet = read('src/components/budget/BudgetSheet.jsx')
  assert.match(budgetSheet, /countsInTotals=\{\(r\) => r\.raw\.status !== 'void'\}/)
  assert.match(budgetSheet, /cellClass=\{\(r\) => \(r\.raw\.status === 'void' \? 'bud-void' : undefined\)\}/)
  assert.match(read('src/components/budget/budget.css'), /td\.bud-void \{ text-decoration: line-through;/)
})

// ── The lifecycle, on Postgres ───────────────────────────────────────────────────

const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts']
async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  const v2 = runnable(read('supabase/migrations/20261021000000_budget_v2_phase1.sql'))
  await pg.exec(v2); await pg.exec(v2)
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  return { pg, db, owner }
}
/** A receipt Keith has read, through the real upload and reading path with a stubbed model. */
async function receipt(db, owner, { vendor, date, total, card = '2002', name = 'r.pdf' }) {
  const reading = { vendor, order_number: '', date, card_last4: card, subtotal: total, tax: 0, shipping: 0, tip: 0, total, has_shipping_address: false, unreadable_fields: [],
    lines: [{ item: `${vendor} plan`, quantity: 1, amount: total, category: 'Technology & Software', confidence: 'high', reason: 'Software.' }] }
  const { receipt: rec, upload } = await R.startUpload(db, owner, { fileName: name, contentType: 'application/pdf', size: 3 })
  await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
  return (await R.readReceipt(db, owner, { id: rec.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
}

test('the migration adds held receipts, remembered cards and Keep both, refuses a hold with no plan, and runs twice', async () => {
  const { pg } = await world()
  const cols = (t) => pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${t}'`).then(r => r.rows.map(x => x.column_name))
  assert.ok((await cols('budget_receipts')).includes('held_subscription_id'))
  assert.ok((await cols('budget_settings')).includes('remembered_cards'))
  assert.ok((await cols('budget_subscriptions')).includes('overlap_kept'))
  await assert.rejects(pg.exec(`INSERT INTO budget_receipts (status, file_name, storage_path, content_type, size_bytes) VALUES ('held', 'x', 'p', 'application/pdf', 1)`), /chk_budget_receipts_held/)
  await assert.rejects(pg.exec(`INSERT INTO budget_settings (program, remembered_cards) VALUES ('X', '{}'::jsonb)`), /chk_budget_settings_cards/)
})

test('a Resend receipt holds, never posts a second row, and attaches to its charge when Resend is approved', async () => {
  const { db, owner } = await world()
  const jul = await receipt(db, owner, { vendor: 'Resend', date: '2026-07-16', total: 20, name: 'jul.pdf' })
  const aug = await receipt(db, owner, { vendor: 'Resend', date: '2026-08-16', total: 20, name: 'aug.pdf' })
  const office = await receipt(db, owner, { vendor: 'Staples', date: '2026-09-12', total: 86.4, name: 'office.pdf' })

  // Accept and post refuses to add the charge as a row of its own.
  await assert.rejects(R.acceptReceipt(db, owner, { id: jul.id, draft: jul.draft, today: TODAY }), (e) => e.code === 'matches_charge' && /count this charge twice/.test(e.message))
  // Attach is not available while Resend waits.
  await assert.rejects(R.acceptReceipt(db, owner, { id: jul.id, draft: jul.draft, attachCharge: true, today: TODAY }), /awaiting approval/)

  // Hold one, then Hold all takes the rest that match, and leaves the office order alone.
  await R.holdReceipt(db, owner, { id: jul.id, today: TODAY })
  const all = await R.holdAll(db, owner, { today: TODAY })
  assert.equal(all.held, 1)
  let intake = await R.intake(db, { today: TODAY })
  assert.deepEqual(intake.held.map(x => [x.file_name, x.held_charge_date]).sort(), [['aug.pdf', '2026-08-16'], ['jul.pdf', '2026-07-16']])
  assert.deepEqual(intake.waiting.map(x => x.id), [office.id], 'held receipts leave To Review')
  assert.deepEqual((await R.reviewQueue(db, { today: TODAY })).map(x => x.id), [office.id], 'and the Action Center')

  // Approve Resend from July 1: three charges post, the two held receipts attach to theirs.
  const subs = (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).subscriptions
  const resendId = subs.find(s => s.name === 'Resend').id
  await E.decideProposal(db, owner, { id: resendId, decision: 'from_year_start', today: TODAY })
  const rel = await R.releaseHeld(db, owner, { subscriptionId: resendId, today: TODAY })
  assert.deepEqual(rel, { attached: 2, returned: 0 })
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  const rows = y.expenses.filter(e => e.item === 'Resend')
  assert.deepEqual(rows.map(e => [e.expense_date, e.amount, e.hasReceipt]), [['2026-07-16', 20, true], ['2026-08-16', 20, true], ['2026-09-16', 20, false]], 'one row per charge, two with their receipts')
  assert.equal(y.summary.spent, 60, 'Spent is the three charges, not five rows')
  intake = await R.intake(db, { today: TODAY })
  assert.equal(intake.held.length, 0)

  // Post as one-time instead is the owner's explicit choice, and still available.
  const sep = await receipt(db, owner, { vendor: 'Resend', date: '2026-09-16', total: 20, name: 'sep.pdf' })
  const again = await R.acceptReceipt(db, owner, { id: sep.id, draft: sep.draft, attachCharge: true, today: TODAY })
  assert.equal(again.attached, true, 'September attaches to the charge approval posted')
  assert.equal((await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).summary.spent, 60)
})

test('declining a plan sends its held receipts back to review, and Undo on a hold puts it back', async () => {
  const { db, owner } = await world()
  const r1 = await receipt(db, owner, { vendor: 'Vercel', date: '2026-08-01', total: 20 })
  await R.holdReceipt(db, owner, { id: r1.id, today: TODAY })
  await R.undoReceipt(db, owner, { id: r1.id })
  assert.equal((await R.intake(db, { today: TODAY })).waiting[0].id, r1.id, 'undo returns it to review')
  await R.holdReceipt(db, owner, { id: r1.id, today: TODAY })
  const vercel = (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).subscriptions.find(s => s.name === 'Vercel Pro').id
  await E.decideProposal(db, owner, { id: vercel, decision: 'decline', today: TODAY })
  assert.deepEqual(await R.releaseHeld(db, owner, { subscriptionId: vercel, today: TODAY }), { attached: 0, returned: 1 })
  const back = (await R.intake(db, { today: TODAY })).waiting.find(x => x.id === r1.id)
  assert.ok(back, 'back in To Review')
  const posted = await R.acceptReceipt(db, owner, { id: r1.id, draft: back.draft, today: TODAY })
  assert.equal(posted.expense_ids.length, 1, 'a declined plan does not guard its receipts: it posts as one-time')
})

test('approving from today sends a held receipt for an earlier charge back to review', async () => {
  const { db, owner } = await world()
  const r1 = await receipt(db, owner, { vendor: 'Anthropic', date: '2026-08-01', total: 100 })
  await R.holdReceipt(db, owner, { id: r1.id, today: TODAY })
  const maxId = (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).subscriptions.find(s => s.name === 'Claude Max').id
  await E.decideProposal(db, owner, { id: maxId, decision: 'from_today', today: TODAY })
  assert.deepEqual(await R.releaseHeld(db, owner, { subscriptionId: maxId, today: TODAY }), { attached: 0, returned: 1 })
})

test('remembering a card sets every open receipt on it and every receipt read after', async () => {
  const { db, owner } = await world()
  const a = await receipt(db, owner, { vendor: 'Staples', date: '2026-09-02', total: 10, name: 'a.pdf' })
  const b = await receipt(db, owner, { vendor: 'Staples', date: '2026-09-03', total: 11, name: 'b.pdf' })
  assert.equal(a.draft.payment_method, null, 'no P-card on file: the owner chooses')
  const out = await R.rememberCard(db, owner, { last4: '2002', method: 'personal_concur' })
  assert.equal(out.applied, 2)
  assert.equal(out.message, 'Card ending 2002 remembered as Personal (Concur). 2 other receipts updated.')
  const intake = await R.intake(db, { today: TODAY })
  assert.deepEqual(intake.waiting.filter(x => [a.id, b.id].includes(x.id)).map(x => x.draft.payment_method), ['personal_concur', 'personal_concur'])
  assert.deepEqual(intake.context.rememberedCards, [{ last4: '2002', method: 'personal_concur' }])
  const c = await receipt(db, owner, { vendor: 'Staples', date: '2026-09-04', total: 12, name: 'c.pdf' })
  assert.equal(c.draft.payment_method, 'personal_concur', 'a new reading uses it')
  await assert.rejects(R.rememberCard(db, owner, { last4: '4111 1111 1111 1111', method: 'personal_concur' }), /last four digits/)
  const forgot = await R.rememberCard(db, owner, { last4: '2002', remember: false })
  assert.deepEqual(forgot.remembered_cards, [])
})

test('the overlap check is answered by ending the older plan or keeping both, and either is undone', async () => {
  const { pg, db, owner } = await world()
  await pg.exec(`UPDATE budget_subscriptions SET end_date = NULL WHERE name = 'Claude Pro annual purchase'`)
  let y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.overlaps.length, 1)
  const pro2 = y.subscriptions.find(s => s.name === 'Claude Pro annual purchase')
  assert.equal(pro2.status, 'Needs a decision')
  assert.equal(y.subscriptions.find(s => s.name === 'Claude Max').status, 'Awaiting approval')
  assert.equal(y.proposals.count, 4, 'Pro waits for its decision, as in the mockup')
  const kept = await E.decideOverlap(db, owner, { id: y.overlaps[0].end.id, decision: 'keep', today: TODAY })
  assert.match(kept.message, /Keeping both/)
  assert.equal((await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).overlaps.length, 0)
  await E.decideOverlap(db, owner, { id: pro2.id, decision: 'reopen', today: TODAY })
  y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  const ended = await E.decideOverlap(db, owner, { id: pro2.id, decision: 'end', end_on: y.overlaps[0].endOn, today: TODAY })
  assert.equal(ended.message, 'Claude Pro annual purchase marked ended May 31, 2026. Charges it already posted stay in Expenses.')
  y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.deepEqual([y.overlaps.length, y.subscriptions.find(s => s.id === pro2.id).status], [0, 'Ended'])
})

test('the API names every new action, and each is Owner-only', () => {
  const api = read('api/budget-staff.js')
  for (const a of ['receipt_hold', 'receipts_hold_all', 'receipt_unhold', 'card_remember', 'subscription_overlap']) assert.match(api, new RegExp(`${a}: \\['action'`), a)
  assert.match(api, /receipt_accept: \['action', 'id', 'draft', 'attach_to', 'attach_charge', 'as_one_time', 'move_from'\]/, 'Phase 3 added move_from')
  assert.match(api, /const READS = new Set\(\['status', 'load', 'export', 'renewals'\]\)/, 'none of them is a read')
  assert.match(api, /R\.releaseHeld\(db, actor, \{ subscriptionId: body\.id/)
})
