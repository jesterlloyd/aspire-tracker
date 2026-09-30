// RECEIPTS-SPEED-1 (Owner, 2026-09-29: "why does it take 30+ seconds for the receipts to load? and when
// I switch tabs and go back ... another 30+ seconds"). The Receipts tab made three requests one after
// another (status, intake, Filed), and intake and Filed each read the whole check context one query at
// a time: about forty round trips in a row. Now one request, reads in parallel, and the tab paints the
// last answer at once when the owner comes back. These tests hold all three.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const R = await import('../lib/server/budget/receipts.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3']

async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  return { pg, db, owner }
}

/** Every query waits `ms` before it runs, as it would crossing the network; counts the queries. */
function slowed(db, ms) {
  const seen = { n: 0 }
  const from = (t) => { const b = db.from(t); const run = b.then.bind(b); b.then = (ok, no) => { seen.n++; return new Promise(r => setTimeout(r, ms)).then(() => run(ok, no)) }; return b }
  return { db: { ...db, from }, seen }
}

test('one request answers status, intake and Filed, the same as the three separate reads', async () => {
  const { db } = await world()
  const out = await R.openReceipts(db, { fy: 2027, today: TODAY })
  assert.deepEqual(out.status, await R.receiptsStatus(db))
  assert.deepEqual(out.intake, await R.intake(db, { today: TODAY }))
  assert.deepEqual(out.filed, await R.filedReceipts(db, { fy: 2027, today: TODAY }))
})

test('the reads go out together: at 60ms a query, opening Receipts waits on a few round trips, not forty', async () => {
  const { db: raw } = await world()
  const { db, seen } = slowed(raw, 60)
  const started = Date.now()
  await R.openReceipts(db, { fy: 2027, today: TODAY })
  const ms = Date.now() - started
  // BUDGET-FEWER-READS-1 changed this: each table once for every year (was 22 reads).
  assert.ok(seen.n <= 16, `${seen.n} reads; it was 22`)
  assert.ok(ms < 60 * 6, `about ${Math.round(ms / 60)} round trips deep (${ms}ms); one at a time it was about forty`)
})

test('the tab makes one request and keeps the last answer for the person who asked', () => {
  const api = read('src/components/budget/budgetApi.js')
  assert.match(api, /budgetStaff\('receipts_open', \{ fiscal_year: fy \}\)/)
  assert.match(api, /lastReceipts\.user === user && lastReceipts\.fy === fy/, 'never another person’s receipts')
  const tab = read('src/components/budget/BudgetReceipts.jsx')
  assert.doesNotMatch(tab, /budgetStaff\('receipts_(status|intake)'\)/)
  assert.match(tab, /const seen = await cachedReceipts\(fy\); if \(seen\) apply\(seen\)/)
  assert.match(tab, /<BudgetFiled key=\{year\.fy\} year=\{year\} receipts=\{filed\}/)
  const staff = read('api/budget-staff.js')
  assert.match(staff, /receipts_open: \['action', 'fiscal_year'\]/)
  assert.doesNotMatch(staff, /READS = new Set\(\[[^\]]*receipts_open/, 'Owner only, like every receipt read')
})
