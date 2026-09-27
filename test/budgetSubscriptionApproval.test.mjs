// test/budgetSubscriptionApproval.test.mjs
//
// SUB-APPROVAL-1 (Owner, 2026-09-27: "add it so I can present it to Margo using the platform, but
// do not put it against the budget yet"). A proposed subscription is shown with what it would cost
// and counts against nothing until the owner approves it, from July 1 or from the day of approval.
// The migration and the Owner's five subscriptions run on PGlite; the day is fixed at 2026-09-27.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../src/lib/budget/budgetModel.js')
const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'

const max = { id: 'm', name: 'Claude Max', billing: 'monthly', amount: 100, anchor_date: '2026-09-01', start_date: '2026-06-01', end_date: null, auto_renew: true, approval_state: 'proposed' }

test('a proposed plan counts against nothing: no charge, no commitment, no renewal', () => {
  assert.equal(M.isApproved({}), true, 'a row from before approval existed is approved')
  assert.equal(M.isApproved(max), false)
  assert.deepEqual(M.chargesToPost(max, [2027], new Set(), TODAY), [])
  assert.equal(M.committedSpend([max], 2027, 'current', TODAY).total, 0)
  assert.equal(M.isActiveSub(max, TODAY), false, 'not in Active or the run rate')
  assert.equal(M.subscriptionStatus(max, TODAY).label, 'Proposed')
  assert.equal(M.subscriptionStatus({ ...max, approval_state: 'declined' }, TODAY).label, 'Declined')
  const annual = { ...max, billing: 'annual', anchor_date: '2026-10-15', start_date: '2023-10-15' }
  assert.equal(M.pendingRenewal(annual, TODAY), null, 'a proposal is not asked to renew')
})

test('approval from a day counts only from that day', () => {
  const approved = { ...max, approval_state: 'approved', post_from: '2026-09-27' }
  assert.deepEqual(M.chargesToPost(approved, [2027], new Set(), TODAY), [], 'nothing between July 1 and today')
  assert.equal(M.committedSpend([approved], 2027, 'current', TODAY).total, 900, 'Oct 1 to Jun 1')
  const fromJuly = { ...max, approval_state: 'approved', post_from: '2026-07-01' }
  assert.deepEqual(M.chargesToPost(fromJuly, [2027], new Set(), TODAY).map(c => c.date), ['2026-07-01', '2026-08-01', '2026-09-01'])
})

const world = async () => {
  const pg = new PGlite()
  await pg.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'append-only'; END $f$;
    CREATE TABLE public.organizations (id uuid PRIMARY KEY); INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, role text, is_owner boolean, created_at timestamptz DEFAULT now());
    CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false, created_at timestamptz DEFAULT now());
    CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, status text, is_demo boolean DEFAULT false);
    CREATE TABLE public.user_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL);`)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING *`)
  await pg.exec(runnable(read('supabase/migrations/20261009000000_program_budget_phase_a.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  return { pg, db: pgliteRest(pg), owner }
}

test('the migration adds approval, keeps every existing plan approved, and runs twice', async () => {
  const { pg, db, owner } = await world()
  await E.createSubscription(db, owner, { fields: { name: 'Existing', billing: 'monthly', amount: 5, anchor_date: '2026-09-01', start_date: '2026-01-01' }, today: TODAY })
  const sql = runnable(read('supabase/migrations/20261010000000_budget_subscription_approval.sql'))
  await pg.exec(sql); await pg.exec(sql)
  assert.deepEqual((await pg.query(`SELECT approval_state FROM budget_subscriptions`)).rows, [{ approval_state: 'approved' }])
  await assert.rejects(pg.exec(`UPDATE budget_subscriptions SET approval_state = 'maybe'`), /chk_budget_subscriptions_approval/)
})

test('the Owner’s subscriptions arrive proposed, cost what the document says, and post nothing until approved', async () => {
  const { pg, db, owner } = await world()
  await pg.exec(runnable(read('supabase/migrations/20261010000000_budget_subscription_approval.sql')))
  const seed = runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql'))
  await pg.exec(seed); await pg.exec(seed)
  const subs = (await pg.query(`SELECT name, amount::text, approval_state, payment_method FROM budget_subscriptions ORDER BY created_at`)).rows
  assert.deepEqual(subs.map(s => [s.name, s.amount, s.approval_state, s.payment_method]), [
    ['Claude Max', '100.00', 'proposed', 'personal_concur'], ['Supabase Pro', '17.50', 'proposed', 'personal_concur'],
    ['Vercel Pro', '20.00', 'proposed', 'personal_concur'], ['Resend', '20.00', 'proposed', 'personal_concur'],
    ['Claude Pro annual purchase', '200.00', 'proposed', 'personal_concur']], 'five rows, once')

  const before = await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })
  assert.deepEqual([before.proposals.count, before.proposals.monthly, before.proposals.perYear, before.proposals.sinceStart, before.proposals.toCome, before.proposals.fromStart, before.proposals.fromToday],
    [4, 157.5, 1890, 455, 1435, 1890, 1435], 'Claude Pro ended before FY27, so four count')
  assert.equal(before.proposals.plans.find(p => p.name === 'Supabase Pro').sinceStart, 35, 'Jul 29 and Aug 29 at the half share')

  await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  let y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.expenses.length, 0, 'starting the year posts no proposed charge')
  assert.deepEqual([y.summary.spent, y.summary.committed], [0, 0], 'nothing against the budget')
  assert.deepEqual(y.subscriptions.map(s => s.status), ['Proposed', 'Proposed', 'Proposed', 'Proposed', 'Cancelled'])

  const id = (n) => y.subscriptions.find(s => s.name === n).id
  const a = await E.decideProposal(db, owner, { id: id('Claude Max'), decision: 'from_year_start', today: TODAY })
  assert.equal(a.message, 'Claude Max approved from Jul 1, 2026. 3 charges posted to the Sheet.')
  const b = await E.decideProposal(db, owner, { id: id('Vercel Pro'), decision: 'from_today', today: TODAY })
  assert.equal(b.posted, 0, 'from today: nothing before today')
  await E.decideProposal(db, owner, { id: id('Resend'), decision: 'decline', today: TODAY })
  await assert.rejects(E.decideProposal(db, owner, { id: id('Resend'), decision: 'from_today', today: TODAY }), /not awaiting approval/)
  y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.deepEqual(y.expenses.map(e => [e.item, e.expense_date, e.amount, e.statusLabel]), [
    ['Claude Max', '2026-07-01', 100, 'Recorded'], ['Claude Max', '2026-08-01', 100, 'Recorded'], ['Claude Max', '2026-09-01', 100, 'Recorded']])
  assert.equal(y.summary.committed, 900 + 180, 'Max and Vercel from October on; Resend declined')
  assert.deepEqual([y.proposals.count, y.proposals.monthly], [1, 17.5], 'only Supabase is still waiting')
  assert.equal(y.subscriptions.find(s => s.name === 'Resend').status, 'Declined')
})

test('the screen lists proposals compactly for every viewer, with one Approve menu per row for the owner', () => {
  // SUB-APPROVAL-2 (Owner, 2026-09-27): one compact list replaced the four slips.
  const subs = read('src/components/budget/BudgetSubscriptions.jsx')
  assert.match(subs, /Awaiting Approval<\/b> · \{prop\.count\} proposed · \{usd\(prop\.monthly\)\} a month · Not counted against the budget until approved/)
  assert.match(subs, /\{canEdit && <ApproveMenu name=\{p\.name\}/, 'the decision is the owner\u2019s')
  for (const d of ['from_year_start', 'from_today', 'decline']) assert.match(subs, new RegExp(`pick\\('${d}'\\)`), d)
  assert.match(subs, /role="menu" aria-label=\{`Decide \$\{name\}`\}/)
  assert.doesNotMatch(subs, /bud-when-proposed/, 'no slips')
  assert.match(read('src/components/budget/BudgetSummary.jsx'), /awaiting approval \(\{usd\(year\.proposals\.monthly\)\} a month\) and not counted in these figures/)
  assert.match(read('api/budget-staff.js'), /subscription_approve: \['action', 'id', 'decision'\]/)
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /canEdit \|\| year\.proposals\?\.count \? \[\{ value: 'subscriptions'/, 'leadership can see proposals before the year starts')
})

// SUB-CELLS-1 (Owner, 2026-09-27: "why are my changes in the sheet not sticking?").
test('a subscription keeps its cells\u2019 formats once 20261011000000 is applied, and says why before it', async () => {
  const { pg, db, owner } = await world()
  const s = await E.createSubscription(db, owner, { fields: { name: 'Vercel Pro', billing: 'monthly', amount: 20, anchor_date: '2026-09-01', start_date: '2026-06-01' }, today: TODAY })
  await assert.rejects(E.saveSheetCells(db, { sheet: 'subscriptions', updates: [{ rowId: s.id, key: 'anchor', format: { date: 'short' } }] }), /20261011000000_budget_subscription_cells/)
  const sql = runnable(read('supabase/migrations/20261011000000_budget_subscription_cells.sql'))
  await pg.exec(sql); await pg.exec(sql)
  await E.saveSheetCells(db, { sheet: 'subscriptions', updates: [{ rowId: s.id, key: 'anchor', format: { date: 'short' } }, { rowId: s.id, key: 'start', format: { date: 'short' } }] })
  await E.saveSheetCells(db, { sheet: 'subscriptions', updates: [{ rowId: s.id, key: 's_owner001', value: 'Jester' }] })
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  const v = y.subscriptions.find(x => x.id === s.id)
  assert.deepEqual(v.cell_formats, { anchor: { date: 'short' }, start: { date: 'short' } }, 'a later save merges, never wipes')
  assert.deepEqual(v.staff_values, { s_owner001: 'Jester' })
  // The Sheet's own rows keep theirs too.
  await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  const e = await E.createExpense(db, owner, { fields: { expense_date: '2026-09-03', item: 'Paper', amount: 5 }, today: TODAY })
  await E.saveSheetCells(db, { updates: [{ rowId: e.id, key: '@date', format: { date: 'long' } }] })
  assert.deepEqual((await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).expenses.find(x => x.id === e.id).cell_formats, { '@date': { date: 'long' } })
})
