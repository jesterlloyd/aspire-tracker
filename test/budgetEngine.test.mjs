// test/budgetEngine.test.mjs
//
// PROGRAM-BUDGET Phase A (BUDGET-A2, 2026-09-27): lib/server/budget/engine.js and its two
// endpoints against real Postgres (PGlite), with the real migration and the real FY26 seed.
// The day is fixed at 2026-09-27 so nothing depends on when the test runs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const { createBudgetStaffHandler } = await import('../api/budget-staff.js')
const { createAcademicsBudgetHandler } = await import('../api/portal/academics-budget.js')
const { can } = await import('../lib/server/access.js')

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501'; END $$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, role text, is_owner boolean, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, status text, is_demo boolean DEFAULT false);
  CREATE TABLE public.user_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL);
`

async function world({ seed = true } = {}) {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@cshs.org', 'owner', true) RETURNING *`)
  const { rows: [admin] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Krystal Rodriguez', 'k@cshs.org', 'admin', false) RETURNING *`)
  const { rows: [cohort] } = await pg.query(`INSERT INTO cohorts (name) VALUES ('Fall 2026') RETURNING *`)
  await pg.query(`INSERT INTO students (cohort_id, status) SELECT $1, 'Active Rotation' FROM generate_series(1, 40)`, [cohort.id])
  await pg.query(`INSERT INTO students (cohort_id, status) VALUES ($1, 'Not Proceeding'), ($1, 'Active Rotation')`, [cohort.id])
  await pg.query(`UPDATE students SET is_demo = true WHERE status = 'Active Rotation' AND id = (SELECT id FROM students WHERE status = 'Active Rotation' LIMIT 1)`)
  await pg.exec(runnable(read('supabase/migrations/20261009000000_program_budget_phase_a.sql')))
  if (seed) await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.query(`INSERT INTO user_role_grants (role) VALUES ('nursing_academic'), ('nursing_academic')`)
  return { pg, db: pgliteRest(pg), owner, admin, cohort }
}
const cat = async (db, name) => (await db.from('budget_categories').select('id').eq('name', name).single()).data.id

test('the imported FY26 year reads back closed, $1,620.44 of $40,000.00, with its history', async () => {
  const { db } = await world()
  const y = await E.loadYear(db, { fy: 2026, viewer: 'reader', today: TODAY })
  assert.equal(y.state, 'closed')
  assert.equal(y.label, 'FY26')
  assert.equal(y.expenses.length, 10)
  assert.equal(y.summary.spent, 1620.44)
  assert.equal(y.summary.remaining, 38379.56)
  assert.equal(y.expenses[0].dateText, 'Jan 2026')
  assert.ok(y.expenses.every(e => !('receipt_file_id' in e)), 'a reader never gets a receipt id')
  assert.deepEqual(y.history.map(h => h.message), ['Budget set to $40,000.00, from the FY26 workbook.'])
  assert.equal(y.budget.owner_note, 'This is all ASPIRE spend for FY26. No ASPIRE costs went through other budgets.')
  assert.deepEqual(y.years, [2027, 2026])
})

test('FY27 starts through the Start form, and every budget change is a history line', async () => {
  const { db, owner } = await world()
  const before = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(before.state, 'not_started')
  assert.deepEqual([before.prior.label, before.prior.total, before.prior.spent, before.prior.largestCategory], ['FY26', 40000, 1620.44, 'Supplies & Materials'])
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'even', today: TODAY })
  await assert.rejects(E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY }), /already started/)
  await E.setTotal(db, owner, { fy: 2027, total: 42500, today: TODAY })
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.state, 'current')
  assert.equal(y.budget.total, 42500)
  assert.deepEqual(y.history.map(h => h.message).reverse(), ['FY27 started.', 'Budget set to $40,000.00.', 'Budget changed from $40,000.00 to $42,500.00.'])
  assert.equal(y.allocations.length, 14, 'the even split is a draft')
  assert.equal(Math.round(y.allocations.reduce((a, b) => a + b.amount, 0) * 100), 4000000)
  const reader = await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })
  assert.deepEqual(reader.allocations, [], 'leadership sees no draft plan')
  assert.equal(reader.prior, null)
  await assert.rejects(E.setTotal(db, owner, { fy: 2026, total: 1, today: TODAY }), /closed/)
})

test('an expense follows its payment method, and a closed year locks its dates and amounts', async () => {
  const { db, owner, cohort } = await world()
  await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  const sup = await cat(db, 'Supplies & Materials')
  const e = await E.createExpense(db, owner, { fields: { expense_date: '2026-09-03', item: 'Copy Paper', category_id: sup, payment_method: 'p_card', amount: '38.99', cohort_id: cohort.id }, today: TODAY })
  assert.deepEqual([e.statusLabel, e.amount, e.unitCost], ['Paid', 38.99, 38.99])
  const e2 = await E.updateExpense(db, owner, { id: e.id, patch: { payment_method: 'personal_concur' }, today: TODAY })
  assert.equal(e2.status, 'recorded', 'Paid is not a Concur status, so it resets to the default')
  await E.updateExpense(db, owner, { id: e.id, patch: { status: 'submitted' }, today: TODAY })
  await assert.rejects(E.updateExpense(db, owner, { id: e.id, patch: { status: 'paid' }, today: TODAY }), /not a status for Personal/)
  await assert.rejects(E.createExpense(db, owner, { fields: { expense_date: '2027-08-01', item: 'x' }, today: TODAY }), /FY28 has not started/)

  const fy26 = (await E.loadYear(db, { fy: 2026, viewer: 'owner', today: TODAY })).expenses[0]
  await assert.rejects(E.updateExpense(db, owner, { id: fy26.id, patch: { amount: 1 }, today: TODAY }), /FY26 is closed/)
  const back = await E.updateExpense(db, owner, { id: fy26.id, patch: { payment_method: 'p_card', notes: 'Backfilled' }, today: TODAY })
  assert.deepEqual([back.paymentLabel, back.statusLabel, back.notes], ['P-card', 'Paid', 'Backfilled'], 'Payment, Status and Notes stay editable')
  await assert.rejects(E.deleteExpenses(db, owner, { ids: [fy26.id], today: TODAY }), /FY26 is closed/)

  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.deepEqual(y.summary.costPerStudent, { state: 'ok', cohortId: cohort.id, cohort: 'Fall 2026', size: 40, spend: 38.99, value: 0.97 }, 'the roster counts real, proceeding students only')
  await E.deleteExpenses(db, owner, { ids: [e.id], today: TODAY })
  assert.equal((await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).expenses.length, 0)
  const { data: log } = await db.from('budget_changes').select('action, field').eq('entity_id', e.id).order('created_at')
  assert.deepEqual(log.map(l => [l.action, l.field]), [['create', null], ['update', 'payment_method'], ['update', 'status'], ['update', 'status'], ['delete', null]], 'one history row per changed field')
})

test('subscription charges post once, only into a started year, and a deleted charge stays deleted', async () => {
  const { db, owner } = await world()
  const tech = await cat(db, 'Technology & Software')
  await E.createSubscription(db, owner, { fields: { name: 'Design tool', plan: 'Pro', billing: 'monthly', amount: 15, anchor_date: '2026-10-03', start_date: '2025-01-03', payment_method: 'p_card', category_id: tech }, today: TODAY })
  assert.equal((await E.postDueCharges(db, { today: TODAY })).posted, 0, 'FY27 has not started')
  const started = await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  assert.equal(started.posted, 3, 'July 3, August 3 and September 3')
  assert.equal((await E.postDueCharges(db, { today: TODAY })).posted, 0, 'posting twice adds nothing')
  let y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  const charges = y.expenses.filter(e => e.source === 'subscription')
  assert.deepEqual(charges.map(c => [c.expense_date, c.amount, c.statusLabel, c.description]), [['2026-07-03', 15, 'Paid', 'Pro subscription'], ['2026-08-03', 15, 'Paid', 'Pro subscription'], ['2026-09-03', 15, 'Paid', 'Pro subscription']])
  await E.deleteExpenses(db, owner, { ids: [charges[0].id], today: TODAY })
  assert.equal((await E.postDueCharges(db, { today: TODAY })).posted, 0)
  assert.equal((await E.postDueCharges(db, { today: '2026-10-03' })).posted, 1, 'the October charge posts on its day')
  y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.subscriptions[0].nextCharge, '2026-10-03')
  assert.equal(y.subscriptions[0].perYear, 180)
  assert.equal(y.summary.committed, 135, 'Oct to Jun, nine charges of $15')
})

test('a renewal within 45 days is decided with Keep, Cancel at renewal or Remind me', async () => {
  const { db, owner } = await world()
  await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  const s = await E.createSubscription(db, owner, { fields: { name: 'Survey platform', plan: 'Team plan', billing: 'annual', amount: 600, anchor_date: '2026-10-15', start_date: '2023-10-15', payment_method: 'p_card' }, today: TODAY })
  const renewals = async () => (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).renewals
  assert.deepEqual((await renewals()).map(r => [r.name, r.date, r.days]), [['Survey platform', '2026-10-15', 18]])
  assert.deepEqual((await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })).renewals, [], 'the owner decides')
  await E.decideRenewal(db, owner, { id: s.id, decision: 'remind', today: TODAY })
  assert.equal((await renewals()).length, 0)
  const out = await E.decideRenewal(db, owner, { id: s.id, decision: 'cancel', today: TODAY })
  assert.equal(out.message, 'Survey platform ends Oct 14, 2026. Cancel it with the vendor too.')
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.deepEqual([y.subscriptions[0].status, y.summary.committed], ['Ending', 0])
})

test('a saved plan is what leadership sees; a later draft stays with the owner', async () => {
  const { db, owner } = await world()
  await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  const sup = await cat(db, 'Supplies & Materials')
  await assert.rejects(E.saveAllocations(db, owner, { fy: 2027, amounts: { [sup]: 50000 }, publish: true, today: TODAY }), /over the FY27 budget/)
  await E.saveAllocations(db, owner, { fy: 2027, amounts: { [sup]: 6000 }, publish: true, today: TODAY })
  await E.saveAllocations(db, owner, { fy: 2027, amounts: { [sup]: 7000 }, publish: false, today: TODAY })
  const reader = await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })
  assert.equal(reader.allocations.find(a => a.category_id === sup).saved_amount, 6000)
  assert.ok(reader.allocations.every(a => !('amount' in a)), 'no draft figure reaches a reader')
  assert.equal(reader.summary.byCategory.find(c => c.id === sup).allocated, 6000)
  const ownerView = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(ownerView.summary.byCategory.find(c => c.id === sup).allocated, 7000)
  assert.match(ownerView.history[0].message, /^Category plan saved: 1 categories, \$6,000\.00 assigned\.$/)
})

const unzip = (buf) => {
  const out = {}
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const m = buf.readUInt16LE(i + 8), cs = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28)
    const name = buf.slice(i + 30, i + 30 + nl).toString(); const d = buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + cs)
    out[name] = (m === 8 ? inflateRawSync(d) : d).toString(); i += 30 + nl + xl + cs
  }
  return out
}

test('Export to Excel writes the two sheets finance already uses', async () => {
  const { db } = await world()
  const { bytes, fileName } = await E.exportYear(db, { fy: 2026, viewer: 'reader', today: TODAY })
  assert.equal(fileName, 'ASPIRE Budget FY26.xlsx')
  const f = unzip(Buffer.from(bytes))
  assert.match(f['xl/workbook.xml'], /<sheet name="Expense Report"[^>]*\/><sheet name="Annual Budget Tracker"/)
  assert.match(f['xl/worksheets/sheet1.xml'], /Cardstock for Student Badges/)
  assert.match(f['xl/worksheets/sheet1.xml'], /Jan 2026/)
  assert.match(f['xl/worksheets/sheet2.xml'], /<v>1552\.94<\/v>/, 'Supplies & Materials for the year')
  assert.match(f['xl/worksheets/sheet2.xml'], /<v>1620\.44<\/v>.*<v>40000<\/v>.*<v>38379\.56<\/v>/, 'the Total row: spent, budget, remaining')
})

// ── Endpoints ────────────────────────────────────────────────────────────────────
function call(handler, { method = 'POST', body, query } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method, body, query, headers: {} }, res)
  })
}

test('budget-staff: the Owner edits, an Admin reads the reader view, nobody else gets in', async () => {
  const w = await world()
  const as = (profile) => createBudgetStaffHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => w.db, today: () => TODAY })
  const owner = as(w.owner), admin = as(w.admin), colead = as({ id: 'x', role: 'co-lead', is_owner: false })
  assert.equal((await call(owner, { body: { action: 'start_year', fiscal_year: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none' } })).status, 200)
  const a = await call(admin, { body: { action: 'load', fiscal_year: 2026 } })
  assert.equal(a.status, 200); assert.equal(a.body.viewer, 'reader'); assert.equal(a.body.can_edit, false)
  assert.equal((await call(admin, { body: { action: 'set_total', fiscal_year: 2027, total: 1 } })).status, 403, 'an Admin cannot write')
  assert.equal((await call(colead, { body: { action: 'load', fiscal_year: 2026 } })).status, 403)
  assert.equal((await call(owner, { body: { action: 'load', fiscal_year: 2026, actor: 'someone' } })).status, 400, 'no extra fields')
  assert.equal((await call(owner, { body: { action: 'drop_everything' } })).status, 400)
  const x = await call(admin, { body: { action: 'export', fiscal_year: 2026 } })
  assert.equal(x.status, 200); assert.ok(x.body.xlsx.length > 1000)
  assert.equal(can({ role: 'admin', is_owner: false }, 'budget_admin'), false)
  assert.equal(can({ role: 'admin', is_owner: false }, 'budget_view'), true)
  assert.equal(can({ role: 'co-lead', is_owner: false }, 'budget_view'), false)
})

test('budget-staff before the database update says so instead of failing', async () => {
  const pg = new PGlite(); await pg.exec(PRELUDE)
  const h = createBudgetStaffHandler({ verifyCaller: async () => ({ authenticated: true, profile: { id: 'o', role: 'owner', is_owner: true } }), makeDb: () => pgliteRest(pg), today: () => TODAY })
  assert.deepEqual((await call(h, { body: { action: 'status' } })).body, { enabled: false, can_edit: true })
  const r = await call(h, { body: { action: 'load', fiscal_year: 2027 } })
  assert.equal(r.status, 409); assert.equal(r.body.error, 'not_enabled')
})

test('the portal tab opens only for a grant with budget_access, and is read-only', async () => {
  const w = await world()
  const { data: grants } = await w.db.from('user_role_grants').select('id').eq('role', 'nursing_academic')
  await w.pg.query(`UPDATE user_role_grants SET budget_access = 'view' WHERE id = $1`, [grants[0].id])
  const as = (grant, staffPreview = false) => createAcademicsBudgetHandler({ verifyCaller: async () => ({ ok: true, grant, staffPreview, profile: {} }), makeDb: () => w.db, today: () => TODAY })
  const yes = await call(as(grants[0]), { method: 'GET', query: { fiscal_year: '2026' } })
  assert.equal(yes.status, 200); assert.equal(yes.body.can_edit, false); assert.equal(yes.body.viewer, 'reader')
  assert.equal((await call(as(grants[1]), { method: 'GET', query: {} })).status, 403, 'a grant without the flag')
  assert.equal((await call(as(null, true), { method: 'GET', query: {} })).status, 200, 'Owner and Admin preview')
  assert.equal((await call(as(grants[0]), { method: 'POST', body: {} })).status, 405, 'no write path')
})

test('only the Owner shares the budget with a grant, and the directory survives before the column exists', () => {
  const invite = read('api/invite-portal-user.js')
  assert.match(invite, /const BUDGET_ACCESS_LEVELS = \['none', 'view'\]/)
  assert.match(invite, /if \(budgetAccess != null && !auth\.isOwner\)[\s\S]{0,120}Only the Owner may share the Program Budget/)
  assert.match(invite, /portalRole !== 'nursing_academic' && budgetAccess !== 'none'/, 'no other portal role can hold it')
  assert.match(invite, /budgetErr\.code === '42703' && budgetAccess === 'none'/, 'before the column, none is already true')
  const list = read('api/list-portal-access.js')
  assert.match(list, /select\('id, user_profile_id, role, granted_at, starts_at, expires_at, revoked_at, contacts_access'\)/, 'the main grant read does not name the new column')
  assert.match(list, /select\('id, budget_access'\)\.eq\('role', 'nursing_academic'\)/)
})
