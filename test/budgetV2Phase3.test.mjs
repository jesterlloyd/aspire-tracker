// test/budgetV2Phase3.test.mjs
//
// BUDGET-V2 Phase 3 (2026-09-29), the plan stage. Reference: docs/mockups/program-budget-v2.html.
//   15. Allocations is Plan, and the tabs follow the year's state (Proposal, Current, Closed).
//   14. Next year's proposal: drafted, submitted to Margo, sent back or approved (with changes), kept as
//       versions, exported as a PDF, and on July 1 the approved totals become the year.
//   16. The within-plan check on new spend: within, over (move inside the limit, or ask Margo), no plan.
// Plus the two Owner decisions of 2026-09-29 on Phase 2: approving into a closed month asks first, and
// a receipt dated in a closed month is filed and marked late, never refused.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../src/lib/budget/budgetModel.js')
const PM = await import('../src/lib/budget/planModel.js')
const E = await import('../lib/server/budget/engine.js')
const P = await import('../lib/server/budget/plan.js')
const R = await import('../lib/server/budget/receipts.js')
const { createAcademicsBudgetReviewHandler } = await import('../api/portal/academics-budget-review.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'

// ── The rules ────────────────────────────────────────────────────────────────────

test('a year before its July 1 is a Proposal, and each state shows only its tabs', () => {
  assert.equal(M.yearState(null, 2028, TODAY), 'proposal')
  assert.equal(M.yearState({ started_at: null }, 2028, TODAY), 'proposal')
  assert.equal(M.yearState(null, 2027, TODAY), 'not_started')
  assert.equal(M.yearState({ started_at: 'x' }, 2026, TODAY), 'closed')
  assert.deepEqual(PM.tabsForState('proposal'), ['plan'])
  assert.deepEqual(PM.tabsForState('current'), ['summary', 'sheet', 'subscriptions', 'receipts', 'plan'])
  // BUDGET-TRACKER-1 changed this (Owner, 2026-09-30): a closed year keeps Subscriptions and Receipts.
  assert.deepEqual(PM.tabsForState('closed'), ['summary', 'sheet', 'subscriptions', 'receipts', 'plan'])
  assert.deepEqual(PM.tabsForState('closed', { planVisible: false, owner: false }), ['summary', 'sheet', 'subscriptions'])
})

test('a plan adds up by category, with its Platform share; moves and amendments change what it runs on', () => {
  const items = [{ category_id: 'sup', quantity: 80, unit_cost: 34.5 }, { category_id: 'tech', quantity: 12, unit_cost: 157.5, tag: 'platform' }, { category_id: 'sup', quantity: 80, unit_cost: 3.75 }]
  const t = PM.planTotals(items)
  assert.deepEqual([t.byCategory.get('sup'), t.byCategory.get('tech'), t.total, t.platform], [3060, 1890, 4950, 1890])
  const eff = PM.effectivePlan(new Map([['meals', 2200], ['sup', 3000]]), { moves: [{ from_category_id: 'sup', to_category_id: 'meals', amount: 200 }], amendments: [{ category_id: 'meals', amount: 100, status: 'approved' }, { category_id: 'meals', amount: 999, status: 'pending' }] })
  assert.deepEqual([eff.get('meals'), eff.get('sup')], [2500, 2800])
  assert.equal(PM.moveLimit(2200), 220, '10% of the receiving category')
  assert.equal(PM.moveLimit(8000), 500, 'capped at $500 per move')
  assert.equal(PM.moveLimit(2200, { pct: 5, cap: 100 }), 100)
})

test('the plan line: within, over with a move inside the limit or not, and no plan', () => {
  const plan = { effective: new Map([['meals', 2200], ['sup', 3000], ['print', 100]]), approved: new Map([['meals', 2200], ['sup', 3000], ['print', 100]]), spent: new Map([['meals', 2000], ['sup', 500], ['print', 90]]), names: new Map([['meals', 'Meals & Catering'], ['sup', 'Supplies & Materials'], ['print', 'Printing & Copying']]), limits: PM.DEFAULT_LIMITS }
  assert.deepEqual(PM.planCheck([{ category_id: 'meals', amount: 150 }], plan), { key: 'within', tone: 'ok', text: 'Within approved plan.' })
  const over = PM.planCheck([{ category_id: 'meals', amount: 400 }], plan)
  assert.equal(over.text, 'Outside approved plan. Meals & Catering would reach $2,400.00 of $2,200.00 approved, $200.00 over.', 'the mockup’s words')
  assert.deepEqual([over.canMove, over.limit, over.sources.map(s => s.category_id)], [true, 220, ['sup']], 'Printing has $10 to spare, not $200')
  const far = PM.planCheck([{ category_id: 'meals', amount: 700 }], plan)
  assert.deepEqual([far.canMove, far.whyNoMove], [false, 'A move of $500.00 is over your limit of $220.00 for Meals & Catering.'])
  assert.equal(PM.planCheck([{ category_id: 'meals', amount: 1 }], null, { total: 40000 }).text, 'No approved category plan. This counts against the $40,000.00 total.')
  const rows = PM.rowPlanStatus([
    { id: 'a', category_id: 'meals', amount: 2000, expense_date: '2026-08-01', status: 'recorded' },
    { id: 'b', category_id: 'meals', amount: 400, expense_date: '2026-09-01', status: 'recorded' },
    { id: 'c', category_id: 'misc', amount: 10, expense_date: '2026-09-01', status: 'recorded' },
    { id: 'v', category_id: 'meals', amount: 999, expense_date: '2026-09-02', status: 'void' },
  ], plan)
  assert.deepEqual([...rows].map(([id, s]) => [id, s.text]), [['a', 'Within'], ['b', 'Over $200.00'], ['c', 'Not in plan']])
})

test('the Summary says one quiet line about next year only once it is asked for or started', () => {
  assert.equal(PM.proposalLine({ fy: 2028, plan: null, requested: false }), null)
  assert.deepEqual(PM.proposalLine({ fy: 2028, plan: null, requested: true, requestedBy: 'Margo' }), { text: 'Margo asked for the FY28 proposal.', action: 'Start the FY28 proposal' })
  assert.equal(PM.proposalLine({ fy: 2028, plan: { status: 'submitted', version: 2 } }).text, 'The FY28 proposal is with Margo (v2).')
})

// ── On Postgres ──────────────────────────────────────────────────────────────────

const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2']
async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  const { rows: [margo] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Margo Leader', 'm@x.org', 'nursing_academic', false) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  const p3 = runnable(read('supabase/migrations/20261023000000_budget_v2_phase3.sql'))
  await pg.exec(p3); await pg.exec(p3)
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  const cat = async (name) => (await pg.query(`SELECT id FROM budget_categories WHERE name = $1`, [name])).rows[0].id
  return { pg, db, owner, margo, cat }
}
const load = async (db, fy, viewer = 'owner', approver = false, today = TODAY) => P.withPlan(db, await E.loadYear(db, { fy, viewer, today }), { viewer, approver, today })

test('the migration adds plans, versions, moves, amendments and Margo’s level, and runs twice', async () => {
  const { pg } = await world()
  await pg.exec(`INSERT INTO user_role_grants (role, budget_access) VALUES ('nursing_academic', 'approve')`)
  await assert.rejects(pg.exec(`INSERT INTO user_role_grants (role, budget_access) VALUES ('student', 'approve')`), /user_role_grants_budget_access_check/)
  await assert.rejects(pg.exec(`INSERT INTO budget_plans (budget_id, version, status) SELECT id, 1, 'maybe' FROM budgets LIMIT 1`), /chk_budget_plans_status/)
  const s = (await pg.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'budget_settings' AND column_name IN ('move_limit_pct', 'move_limit_cap') ORDER BY column_name`)).rows.map(r => r.column_default)
  assert.deepEqual(s, ['500', '10'])
})

test('FY28: start, draft, submit, send back, revise, approve with changes; versions and history are kept', async () => {
  const { db, owner, margo, cat } = await world()
  let y = await load(db, 2028)
  assert.deepEqual([y.state, y.years[0], y.plan.current, y.plan.canStart], ['proposal', 2028, null, true])
  assert.ok(!(await load(db, 2027, 'reader')).years.includes(2028), 'leadership does not see a year with nothing submitted')

  const started = await P.startProposal(db, owner, { fy: 2028, today: TODAY })
  assert.equal(started.carried, 4, 'Claude Max, Supabase, Vercel and Resend carry forward; Claude Pro has ended')
  y = await load(db, 2028)
  const cur = y.plan.current
  assert.deepEqual([cur.version, cur.status], [1, 'draft'])
  assert.ok(cur.items.every(i => i.tag === 'platform'))
  assert.equal(cur.total, 1890, 'the four plans a year at their current price')
  assert.equal((await load(db, 2028, 'reader')).plan.current, null, 'a draft never reaches a reader')

  const sup = await cat('Supplies & Materials'), meals = await cat('Meals & Catering')
  const items = [...cur.items, { category_id: sup, name: 'Welcome kits, 2 cohorts', quantity: 80, unit_cost: 34.5, reason: '$34.50 per student.' }, { category_id: meals, name: 'Orientation lunch', quantity: 2, unit_cost: 600, reason: '40 students and 8 staff.' }]
  await P.savePlanDraft(db, owner, { planId: cur.id, items })
  await assert.rejects(P.submitPlan(db, owner, { planId: cur.id }), /Why this budget/)
  await P.savePlanDraft(db, owner, { planId: cur.id, note: 'Two cohorts, the platform and orientation.' })
  const sub = await P.submitPlan(db, owner, { planId: cur.id })
  assert.match(sub.message, /v1 submitted to Margo/)
  await assert.rejects(P.savePlanDraft(db, owner, { planId: cur.id, note: 'x' }), /no longer changes/)
  let r = await load(db, 2027, 'reader', true)
  assert.ok(r.years.includes(2028), 'submitted: leadership sees FY28')
  assert.deepEqual(r.next, { fy: 2028, plan: { status: 'submitted', version: 1 }, requested: false, requestedBy: '' })
  const seen = await load(db, 2028, 'reader', true)
  assert.deepEqual([seen.plan.current.status, seen.plan.current.total, seen.canApprove], ['submitted', 5850, true])

  await P.decidePlan(db, margo, { planId: cur.id, decision: 'send_back', comment: 'Split the welcome kits by cohort.' })
  y = await load(db, 2028)
  assert.deepEqual([y.plan.current.version, y.plan.current.status, y.plan.current.items.length], [2, 'draft', 6], 'v2 opens as a copy of v1')
  assert.equal(y.plan.versions.find(v => v.version === 1).comment, 'Split the welcome kits by cohort.')
  await P.submitPlan(db, owner, { planId: y.plan.current.id })
  const out = await P.decidePlan(db, margo, { planId: y.plan.current.id, decision: 'approve', approved: { [meals]: 1000 } })
  assert.deepEqual([out.changed, out.total], [1, 5650])
  y = await load(db, 2028)
  assert.equal(y.plan.current.status, 'approved')
  assert.equal(y.plan.current.categories.find(c => c.id === meals).approved, 1000)
  assert.deepEqual(y.plan.history.map(h => h.message).reverse(), [
    'FY28 proposal started (v1), with 4 subscriptions carried forward.',
    'FY28 plan v1 submitted to Margo: $5,850.00 across 3 categories.',
    'FY28 plan v1 sent back for revision: Split the welcome kits by cohort. v2 is open.',
    'FY28 plan v2 submitted to Margo: $5,850.00 across 3 categories.',
    'FY28 plan v2 approved with changes to 1 category: $5,650.00 of $5,850.00 requested.',
  ])

  const pdf = await P.planPdf(db, { planId: y.plan.current.id, reader: true })
  assert.equal(Buffer.from(pdf.bytes).subarray(0, 5).toString(), '%PDF-')
  assert.equal(pdf.fileName, 'ASPIRE_Budget_Request_FY28_v2.pdf')

  // July 1, 2027: the approved plan becomes the year.
  const start = await P.autoStartApproved(db, { today: '2027-07-01' })
  assert.deepEqual(start, { started: 2028, total: 5650 })
  const fy28 = await E.loadYear(db, { fy: 2028, viewer: 'owner', today: '2027-07-01' })
  assert.deepEqual([fy28.state, fy28.summary.total], ['current', 5650])
  assert.equal(fy28.allocations.find(a => a.category_id === meals).saved_amount, 1000)
})

test('the running year: an approved plan, a move inside the limit, and an amendment Margo decides', async () => {
  const { db, owner, margo, cat } = await world()
  const sup = await cat('Supplies & Materials'), meals = await cat('Meals & Catering')
  await P.startProposal(db, owner, { fy: 2027, today: TODAY })
  let y = await load(db, 2027)
  await P.savePlanDraft(db, owner, { planId: y.plan.current.id, note: 'FY27 in categories.', items: [{ category_id: meals, name: 'Lunches', quantity: 1, unit_cost: 2200 }, { category_id: sup, name: 'Supplies', quantity: 1, unit_cost: 3000 }] })
  await P.submitPlan(db, owner, { planId: y.plan.current.id })
  await P.decidePlan(db, margo, { planId: y.plan.current.id, decision: 'approve' })
  y = await load(db, 2027)
  assert.deepEqual(y.plan.live.effective, { [meals]: 2200, [sup]: 3000 })
  assert.ok(y.budget.plan_saved_at, 'the running year takes the approved totals as its category plan')

  await assert.rejects(P.movePlan(db, owner, { fy: 2027, from: sup, to: meals, amount: 300 }), /over your limit of \$220\.00/)
  const mv = await P.movePlan(db, owner, { fy: 2027, from: sup, to: meals, amount: 200 })
  assert.equal(mv.message, 'Moved $200.00 from Supplies & Materials to Meals & Catering.')
  const am = await P.requestAmendment(db, owner, { fy: 2027, category_id: meals, amount: 400, reason: 'Preceptor appreciation.' })
  await assert.rejects(P.decideAmendment(db, owner, { id: am.amendment.id, decision: 'maybe' }), /Approve or Decline/)
  await P.decideAmendment(db, margo, { id: am.amendment.id, decision: 'approve' })
  y = await load(db, 2027)
  assert.deepEqual(y.plan.live.effective, { [meals]: 2800, [sup]: 2800 })
  assert.deepEqual(y.plan.amendments.map(a => a.status), ['approved'])
})

test('a receipt over the plan moves and posts in one step, or waits for Margo and posts when she approves', async () => {
  const { db, owner, margo, cat } = await world()
  const sup = await cat('Supplies & Materials'), meals = await cat('Meals & Catering')
  await P.startProposal(db, owner, { fy: 2027, today: TODAY })
  let y = await load(db, 2027)
  await P.savePlanDraft(db, owner, { planId: y.plan.current.id, note: 'x', items: [{ category_id: meals, name: 'Lunches', quantity: 1, unit_cost: 100 }, { category_id: sup, name: 'Supplies', quantity: 1, unit_cost: 3000 }] })
  await P.submitPlan(db, owner, { planId: y.plan.current.id })
  await P.decidePlan(db, margo, { planId: y.plan.current.id, decision: 'approve' })

  const receipt = async (vendor, amount) => {
    const reading = { vendor, order_number: '', date: '2026-09-10', card_last4: '', subtotal: amount, tax: 0, shipping: 0, tip: 0, total: amount, has_shipping_address: false, unreadable_fields: [],
      lines: [{ item: 'Lunch', quantity: 1, amount, category: 'Meals & Catering', confidence: 'high', reason: 'Lunch.' }] }
    const { receipt: rec, upload } = await R.startUpload(db, owner, { fileName: `${vendor}.pdf`, contentType: 'application/pdf', size: 3 })
    await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
    const out = (await R.readReceipt(db, owner, { id: rec.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
    return { ...out, draft: { ...out.draft, business_purpose: 'Preceptor lunch', attendees: [{ name: 'Ana Cruz', title: 'RN', organization: 'Cedars-Sinai', relationship: 'Preceptor' }] } }
  }
  const a = await receipt('Cafe One', 110)
  await assert.rejects(R.acceptReceipt(db, owner, { id: a.id, draft: a.draft, today: TODAY }), /Outside approved plan\. Meals & Catering would reach \$110\.00 of \$100\.00 approved, \$10\.00 over/)
  await R.acceptReceipt(db, owner, { id: a.id, draft: a.draft, move: { from: 'Supplies & Materials' }, today: TODAY })
  y = await load(db, 2027)
  assert.deepEqual([y.plan.moves.length, y.plan.moves[0].amount, y.summary.spent], [1, 10, 110])

  const b = await receipt('Cafe Two', 50)
  // A meal without its purpose and attendees cannot be held for Margo: her yes has to be able to post it.
  await assert.rejects(R.holdForAmendment(db, owner, { id: b.id, draft: { ...b.draft, business_purpose: '', attendees: [] }, today: TODAY }), /business meal[\s\S]*Then ask Margo/)
  const held = await R.holdForAmendment(db, owner, { id: b.id, draft: b.draft, today: TODAY })
  assert.match(held.message, /Asked Margo to raise Meals & Catering by \$50\.00\. The receipt waits for her decision\./)
  assert.equal((await R.intake(db, { today: TODAY })).held[0].held_amendment_id, held.amendment.id)
  await P.decideAmendment(db, margo, { id: held.amendment.id, decision: 'approve' })
  assert.deepEqual(await R.releaseAmendment(db, margo, { amendmentId: held.amendment.id, approved: true, today: TODAY }), { posted: 1, returned: 0 })
  assert.equal((await load(db, 2027)).summary.spent, 160)
})

test('Margo decides only through the approve level; a view grant gets the PDF; a preview is read-only', async () => {
  const { db, owner, margo } = await world()
  await P.startProposal(db, owner, { fy: 2028, today: TODAY })
  const y = await load(db, 2028)
  await P.savePlanDraft(db, owner, { planId: y.plan.current.id, note: 'Why.' })
  await P.submitPlan(db, owner, { planId: y.plan.current.id })
  const call = async (level, body, preview = false) => {
    const h = createAcademicsBudgetReviewHandler({ verifyCaller: async () => ({ ok: true, staffPreview: preview, grant: { id: 'g' }, profile: margo }), makeDb: () => db, budgetLevel: async () => level, today: () => TODAY })
    let status = 0, json = null
    await h({ method: 'POST', body }, { setHeader() {}, status(c) { status = c; return this }, json(o) { json = o; return this }, end() { return this } })
    return { status, json }
  }
  const decide = { action: 'plan_decide', plan_id: y.plan.current.id, decision: 'approve' }
  assert.equal((await call('view', decide)).status, 403)
  assert.equal((await call('approve', decide, true)).status, 403, 'the owner previewing the portal never approves')
  assert.equal((await call('none', { action: 'plan_pdf', plan_id: y.plan.current.id })).status, 403)
  const pdf = await call('view', { action: 'plan_pdf', plan_id: y.plan.current.id })
  assert.deepEqual([pdf.status, pdf.json.fileName], [200, 'ASPIRE_Budget_Request_FY28_v1.pdf'])
  assert.equal((await call('approve', { ...decide, approved_by: 'x' })).status, 400, 'the decider comes from the session')
  const ok = await call('approve', decide)
  assert.deepEqual([ok.status, ok.json.approved], [200, true])
})

test('Margo can ask for next year’s proposal, and the owner’s Summary says so', async () => {
  const { db, margo } = await world()
  await P.requestProposal(db, margo, { today: TODAY })
  const y = await load(db, 2027)
  assert.deepEqual(y.next, { fy: 2028, plan: null, requested: true, requestedBy: 'Margo' })
  assert.deepEqual(PM.proposalLine(y.next), { text: 'Margo asked for the FY28 proposal.', action: 'Start the FY28 proposal' })
})

test('approving into a closed month asks first; a receipt dated in a closed month is filed late, never refused', async () => {
  const { db, owner } = await world()
  await E.closeMonth(db, owner, { fy: 2027, month: '2026-07', note: 'Nothing yet.', today: TODAY })
  const subs = (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).subscriptions
  const resend = subs.find(s => s.name === 'Resend').id
  await assert.rejects(E.decideProposal(db, owner, { id: resend, decision: 'from_year_start', today: TODAY }), (e) => e.code === 'closed_months' && e.message === 'July is closed. Approving Resend from Jul 1, 2026 posts 1 charge into it.' && e.details.charges === 1)
  const ok = await E.decideProposal(db, owner, { id: resend, decision: 'from_year_start', intoClosed: true, today: TODAY })
  assert.equal(ok.posted, 3)

  await E.closeMonth(db, owner, { fy: 2027, month: '2026-08', note: 'Closed.', today: TODAY })
  const reading = { vendor: 'Staples', order_number: '', date: '2026-08-12', card_last4: '', subtotal: 86.4, tax: 0, shipping: 0, tip: 0, total: 86.4, has_shipping_address: false, unreadable_fields: [],
    lines: [{ item: 'Office supplies', quantity: 1, amount: 86.4, category: 'Supplies & Materials', confidence: 'high', reason: 'Supplies.' }] }
  const { receipt: rec, upload } = await R.startUpload(db, owner, { fileName: 's.pdf', contentType: 'application/pdf', size: 3 })
  await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
  const slip = (await R.readReceipt(db, owner, { id: rec.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
  const out = await R.acceptReceipt(db, owner, { id: rec.id, draft: { ...slip.draft, payment_method: 'po_invoice' }, today: TODAY })
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  const row = y.expenses.find(e => e.id === out.expense_ids[0])
  assert.deepEqual([row.expense_date, row.notes], ['2026-08-12', 'Receipt filed Sep 29, 2026, after August closed.'])
  assert.equal(y.history[0].message, 'Staples $86.40 filed Sep 29, 2026, after August closed.')
  // The owner's own edits to August stay locked.
  await assert.rejects(E.updateExpense(db, owner, { id: row.id, patch: { notes: 'x' }, today: TODAY }), /closed/)
})

test('the screens: the Plan tab, the portal review, the grant level and the API', () => {
  const view = read('src/components/budget/ProgramBudgetView.jsx')
  assert.match(view, /current === 'plan' && \(year\.plan\?\.enabled/)
  assert.match(view, /y > currentFiscalYear\(\) \? ' · Proposal' : ''/)
  const plan = read('src/components/budget/BudgetPlan.jsx')
  for (const s of ['Why This Budget', 'Submit to Margo', 'Download PDF for Finance', 'Approve with changes', 'Send back for revision', 'Plan History', 'Platform share', 'Move Limit']) assert.ok(plan.includes(s), s)
  const api = read('api/budget-staff.js')
  for (const a of ['plan_start', 'plan_save', 'plan_submit', 'plan_revise', 'plan_pdf', 'plan_move', 'plan_amend', 'plan_limits', 'receipt_amend']) assert.match(api, new RegExp(`${a}: \\['action'`), a)
  assert.match(read('api/portal/academics-budget.js'), /approver = \(await budgetLevel\(db, auth\.grant\?\.id\)\) === 'approve'/)
  assert.match(read('src/components/settings/GrantPortalAccessModal.jsx'), /Approves the budget plan/)
  assert.match(read('api/cron/budget-maintenance.js'), /await autoStartApproved\(db\)/)
})
