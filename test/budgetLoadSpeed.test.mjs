// BUDGET-LOAD-SPEED-1 (Owner, 2026-09-30: "8-10 seconds for the program budget to load. that's super
// slow"). Each database read from the server costs about a quarter second (the public brand endpoint,
// one read, answered 0.26s slower than an endpoint with none), and opening the Program Budget read
// about 25 of them one after another: loadYear, then withPlan re-reading the budget, the categories and
// the history and walking the prior years one at a time. Now each goes out in waves. This holds the
// depth: at 60ms a read, the whole load must finish in well under the old 25 round trips.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const P = await import('../lib/server/budget/plan.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-30'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3', '20261024000000_budget_v2_phase4', '20261025000000_budget_fixes_s1']

async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 3500, cost_center: 'N', plan: 'none', today: TODAY })
  await P.startProposal(db, owner, { fy: 2028, today: TODAY })
  return { db, owner }
}
function slowed(db, ms) {
  const seen = { n: 0 }
  const from = (t) => { const b = db.from(t); const run = b.then.bind(b); b.then = (ok, no) => { seen.n++; return new Promise(r => setTimeout(r, ms)).then(() => run(ok, no)) }; return b }
  return { db: { ...db, from }, seen }
}

test('opening the Program Budget waits on a few round trips, not twenty-five', async () => {
  const { db: raw } = await world()
  for (const [fy, viewer] of [[2027, 'owner'], [2028, 'owner'], [2027, 'reader']]) {
    const { db, seen } = slowed(raw, 60)
    const t = Date.now()
    const y = await P.withPlan(db, await E.loadYear(db, { fy, viewer, today: TODAY }), { viewer, today: TODAY })
    const ms = Date.now() - t
    // BUDGET-FEWER-READS-1 changed this: each table is read once (production queued 29 reads; now ~14).
    assert.ok(seen.n <= 16, `FY${fy} ${viewer}: ${seen.n} reads; it was 29`)
    assert.ok(ms < 60 * 10, `FY${fy} ${viewer}: about ${Math.round(ms / 60)} round trips deep (${ms}ms); it was about 25`)
    assert.equal(y.plan.enabled, true)
  }
})

test('the waves read the same things: the FY28 proposal, its prior years and the menu', async () => {
  const { db } = await world()
  const y = await P.withPlan(db, await E.loadYear(db, { fy: 2028, viewer: 'owner', today: TODAY }), { viewer: 'owner', today: TODAY })
  assert.equal(y.plan.enabled, true)
  assert.equal(y.plan.current.status, 'draft')
  assert.equal(y.plan.priorBudget, 3500, 'FY27 is the prior year')
  assert.ok(y.plan.current.categories.some(c => c.prior2 > 0), 'FY26 spending reaches the FY28 plan as two years back')
  assert.deepEqual(y.years.slice(0, 2), [2028, 2027])
  const cur = await P.withPlan(db, await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY }), { viewer: 'owner', today: TODAY })
  assert.deepEqual([cur.next.fy, cur.next.plan.status], [2028, 'draft'], 'the Summary line about next year')
  const reader = await P.withPlan(db, await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY }), { viewer: 'reader', today: TODAY })
  assert.equal(reader.next.plan, null, 'a draft stays the owner’s')
  assert.ok(!reader.years.includes(2028), 'and so does next year in the menu, until a version is submitted')
})
