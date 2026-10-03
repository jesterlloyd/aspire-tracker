// test/budgetV2Phase4.test.mjs
//
// BUDGET-V2 Phase 4 (2026-09-29), clarity. Reference: docs/mockups/program-budget-v2.html.
//   2. "Not counted yet" on the Summary: receipts to review and subscriptions awaiting approval, each
//      with its way in; the Remaining tile says what approval from July 1 would leave.
//   4. A Platform tag on subscriptions and expenses, the Platform card, the Tag column.
//   6. Empty states: one message and the next action, never a blank chart or ten blank rows.
//   7. Copy: no "once receipt intake arrives".
//   8. Tab counts are amber; red is for urgent only.
//   9. The budget sheets keep number and date formats, Group by, Freeze, + Row, Delete row, Columns.
//  10. On Program Budget the Keith orb is the one floating button (Owner, 2026-09-29).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

const M = await import('../src/lib/budget/budgetModel.js')
const E = await import('../lib/server/budget/engine.js')
const R = await import('../lib/server/budget/receipts.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'

test('the platform costs what its tagged plans cost, now and if the waiting ones are approved', () => {
  const subs = [
    { name: 'Claude Max', tag: 'platform', billing: 'monthly', amount: 100, anchor_date: '2026-09-01', start_date: '2026-06-01', approval_state: 'approved' },
    { name: 'Resend', tag: 'platform', billing: 'monthly', amount: 20, anchor_date: '2026-09-16', start_date: '2026-07-16', approval_state: 'proposed' },
    { name: 'Pro', tag: 'platform', billing: 'annual', amount: 200, anchor_date: '2026-04-15', start_date: '2026-04-15', end_date: '2026-05-31', approval_state: 'proposed' },
    { name: 'Survey tool', tag: null, billing: 'monthly', amount: 50, anchor_date: '2026-09-01', start_date: '2026-01-01', approval_state: 'approved' },
  ]
  assert.deepEqual(M.platformCost(subs, TODAY), { count: 2, active: 1, waiting: 1, monthly: 100, perYear: 1200, ifApprovedMonthly: 120, ifApprovedPerYear: 1440, names: ['Claude Max', 'Resend'] })
})

const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3']
async function world({ phase4 = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  if (phase4) { const sql = runnable(read('supabase/migrations/20261024000000_budget_v2_phase4.sql')); await pg.exec(sql); await pg.exec(sql) }
  return { pg, db, owner }
}
const year = (db) => E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })

test('the migration tags the Owner’s five plans Platform, runs twice, and every charge carries its plan’s tag', async () => {
  const { pg, db, owner } = await world()
  assert.deepEqual((await pg.query(`SELECT name, tag FROM budget_subscriptions ORDER BY name`)).rows.map(r => r.tag), ['platform', 'platform', 'platform', 'platform', 'platform'])
  await assert.rejects(pg.exec(`UPDATE budget_subscriptions SET tag = 'program'`), /chk_budget_subscriptions_tag/)
  let y = await year(db)
  assert.equal(y.tagsEnabled, true)
  await E.decideProposal(db, owner, { id: y.subscriptions.find(s => s.name === 'Resend').id, decision: 'from_year_start', today: TODAY })
  y = await year(db)
  const rows = y.expenses.filter(e => e.item === 'Resend')
  assert.ok(rows.length > 3 && rows.every(e => e.tag === 'platform'), 'posted and Expected charges alike')
  // The Sheet edits the tag; anything but Platform or none is refused.
  const one = await E.createExpense(db, owner, { fields: { expense_date: '2026-09-10', item: 'Domain', amount: 9.99, tag: 'platform' }, today: TODAY })
  assert.equal(one.tag, 'platform')
  assert.equal((await E.updateExpense(db, owner, { id: one.id, patch: { tag: null }, today: TODAY })).tag, null)
  await assert.rejects(E.updateExpense(db, owner, { id: one.id, patch: { tag: 'program' }, today: TODAY }), /Platform or no tag/)
})

test('before the update the Tag column is not offered and charges post as they did', async () => {
  const { db, owner } = await world({ phase4: false })
  let y = await year(db)
  assert.equal(y.tagsEnabled, false)
  await E.decideProposal(db, owner, { id: y.subscriptions.find(s => s.name === 'Resend').id, decision: 'from_year_start', today: TODAY })
  y = await year(db)
  assert.equal(y.expenses.filter(e => e.item === 'Resend' && e.state === 'posted').length, 3)
})

test('the review queue says which receipts match a subscription charge, and a matched one-time row takes the plan’s tag', async () => {
  const { db, owner } = await world()
  const add = async (vendor, date, total) => {
    const reading = { vendor, order_number: '', date, card_last4: '', subtotal: total, tax: 0, shipping: 0, tip: 0, total, has_shipping_address: false, unreadable_fields: [], lines: [{ item: 'Plan', quantity: 1, amount: total, category: 'Technology & Software', confidence: 'high', reason: 'x' }] }
    const { receipt, upload } = await R.startUpload(db, owner, { fileName: `${vendor}.pdf`, contentType: 'application/pdf', size: 3 })
    await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
    return (await R.readReceipt(db, owner, { id: receipt.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
  }
  const resend = await add('Resend', '2026-07-16', 20)
  await add('Staples', '2026-09-12', 86.4)
  const q = await R.reviewQueue(db, { today: TODAY })
  assert.deepEqual(q.map(x => [x.vendor, x.matchesSubscription]), [['Resend', true], ['Staples', false]])
  const out = await R.acceptReceipt(db, owner, { id: resend.id, draft: { ...resend.draft, payment_method: 'personal_concur' }, asOneTime: true, today: TODAY })
  assert.equal((await year(db)).expenses.find(e => e.id === out.expense_ids[0]).tag, 'platform')
})

// ── The screens ──────────────────────────────────────────────────────────────────

let vite, Sheet
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  Sheet = (await vite.ssrLoadModule('/src/components/sheet/EditableSheet.jsx')).default
})
after(async () => { await vite?.close() })

test('the budget sheets keep formats, grouping and rows, and show one message when empty', async () => {
  const { BUDGET_TOOLS } = await vite.ssrLoadModule('/src/components/budget/budgetSheetTools.js')
  const base = {
    initialRows: [], initialLayout: { order: [], hidden: [], widths: {}, frozen: 0, groupBy: null, staffColumns: [], colFormats: {}, summaries: {} },
    lead: { key: '@n', label: 'Name' }, columns: [{ key: 'item', label: 'Item', type: 'text' }], editable: true,
    valueOf: (r, k) => r.cells[k], shownOf: (r, k) => r.cells[k] ?? '', defaultSort: { key: 'item', dir: 'asc' }, labels: {}, onAddRow: async () => null, onDeleteRows: async () => {},
  }
  const full = renderToStaticMarkup(React.createElement(Sheet, base))
  for (const l of ['Bold', 'Align left', 'Clear formatting']) assert.match(full, new RegExp(`aria-label="${l}"`), `${l} stays for every other sheet`)
  const budget = renderToStaticMarkup(React.createElement(Sheet, { ...base, tools: BUDGET_TOOLS, emptyState: React.createElement('b', null, 'No FY27 expenses yet') }))
  for (const l of ['Bold', 'Italic', 'Underline', 'Text colour', 'Fill colour', 'Align left', 'Wrap text', 'Clear formatting']) assert.doesNotMatch(budget, new RegExp(`aria-label="${l}"`), l)
  for (const l of ['Currency', 'Percent', 'Thousands separator', 'Date format']) assert.match(budget, new RegExp(`aria-label="${l}"`), l)
  assert.match(budget, /Group by/); assert.match(budget, /Freeze/); assert.match(budget, /<\/svg> Row<\/button>/); assert.match(budget, /Delete row/)
  assert.doesNotMatch(budget, /<\/svg> Column<\/button>/, '+ Column is not offered')
  assert.match(budget, /<div class="fs-empty" role="status"><b>No FY27 expenses yet<\/b><\/div>/)
  assert.doesNotMatch(budget, /fs-blank/, 'no ten blank rows')
  assert.match(read('src/components/budget/BudgetSheet.jsx'), /tools=\{BUDGET_TOOLS\}/)
  assert.match(read('src/components/budget/BudgetSubscriptions.jsx'), /tools=\{BUDGET_TOOLS\}/)
})

test('the Summary, the tabs, the copy and the floating buttons follow the mockup', () => {
  const sum = read('src/components/budget/BudgetSummary.jsx')
  assert.match(sum, /<h3>Not Counted Yet<\/h3>/)
  assert.match(sum, /if all \{prop\.count\} \{prop\.count === 1 \? 'subscription is' : 'subscriptions are'\} approved from Jul 1/)
  assert.match(sum, /No spending posted in \{s\.label\} yet/)
  assert.match(sum, /No spend in any category yet/)
  assert.match(sum, /<span className="bud-dash">Not set<\/span>/)
  assert.doesNotMatch(read('src/components/budget/BudgetSheet.jsx'), /receipt intake arrives/)
  const view = read('src/components/budget/ProgramBudgetView.jsx')
  assert.match(view, /<span className="bud-tabn"/)
  assert.doesNotMatch(view, /inlineBadgeStyle/, 'no red count on a budget tab')
  assert.match(read('src/components/budget/budget.css'), /\.bud-tabn \{[^}]*background: var\(--pill-warn-bg\); color: var\(--pill-warn-fg\)/)
  const subs = read('src/components/budget/BudgetSubscriptions.jsx')
  // SUBS-KPI-1 (2026-10-03) changed this: the platform cost is a note, not a titled card.
  assert.match(subs, /ASPIRE Intelligence platform cost\./)
  assert.match(subs, /Confirm before approving:/)
  const app = read('src/staff/StaffApp.jsx')
  assert.match(app, /const keithOnly = location\.pathname\.startsWith\('\/settings\/budget'\) && !tourRunning/)
  assert.match(app, /<MainMessagesLauncher hidden=\{keithOnly\} keepLauncherVisible \/>/)
  assert.match(app, /hidden=\{keithOnly\}\n\s+\/>/, 'Feedback steps aside too')
  assert.match(app, /hideLauncher=\{false\}/, 'the Keith orb stays on Program Budget')
})
