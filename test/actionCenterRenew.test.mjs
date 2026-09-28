// test/actionCenterRenew.test.mjs
//
// AC-RENEW-1 (prompt A9): an annual subscription renewing within 45 days that the Owner has not
// decided goes to the Action Center (and At a Glance's Needs you) as a Program Budget item with the
// chip Renew. Owner only. The item is navigation: Open lands on Program Budget > Subscriptions, where
// Keep and Cancel at renewal live; Snooze hides it. The day is fixed at 2026-09-27.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const Y = await import('../src/lib/home/needsYouModel.js')
const Q = await import('../src/lib/actionCenter/queueModel.js')
const E = await import('../lib/server/budget/engine.js')
const { createBudgetStaffHandler } = await import('../api/budget-staff.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'

const renewals = [
  { id: 'a', name: 'Survey platform', amount: 600, paymentLabel: 'P-card', date: '2026-10-15', days: 18 },
  { id: 'b', name: 'Domain and hosting', amount: 240, paymentLabel: 'Personal (Concur)', date: '2026-10-02', days: 5 },
]

test('the Program Budget group lists renewals soonest first, and hides itself when there are none', () => {
  const g = Y.budgetGroup({ renewals })
  assert.equal(g.key, 'budget')
  assert.equal(g.name, 'Program Budget')
  assert.deepEqual(g.rows.map(r => r.id), ['renew:b', 'renew:a'], 'the renewal five days out leads')
  // BUDGET-B4 (2026-09-27): each budget row names its own chip (Renew, Review or Submit).
  assert.deepEqual(g.rows[1], {
    id: 'renew:a', chip: 'Renew', title: 'Survey platform · $600.00', meta: 'Renews Oct 15, 2026 · in 18 days · P-card',
    pill: { text: 'In 18 days', tone: 'amber' }, ageMs: 28 * 86400000, to: '/settings/budget?tab=subscriptions',
  })
  assert.equal(g.rows[0].pill.tone, 'red', 'a week or less is red')
  assert.equal(Y.budgetGroup({ renewals: [] }), null)
  assert.ok(Y.GROUP_ORDER.includes('budget'))
})

test('in the Action Center it is a Renew item: personal, Open and Snooze, and it says when', () => {
  const items = Q.normalizeHomeQueue({ groups: [Y.budgetGroup({ renewals })], now: Date.parse('2026-09-27T12:00:00Z') })
  const it = items.find(i => i.key === 'renew:a')
  assert.deepEqual([it.group, it.chip, it.personal, it.cohort, it.title, it.qualifier], ['budget', 'Renew', true, null, 'Survey platform', '$600.00'])
  assert.deepEqual(it.actions.map(a => a.key), ['open', 'snooze'], 'Keep and Cancel stay on the Subscriptions tab')
  assert.equal(it.ageLabel, 'In 18 days', 'not how long it has waited')
  assert.equal(it.href, '/settings/budget?tab=subscriptions')
  assert.deepEqual(Q.chipCounts(items), [{ chip: 'Renew', count: 2 }])
  assert.ok(Q.ACTION_CENTER_GROUPS.some(g => g.key === 'budget' && g.label === 'Program Budget'))
})

async function world() {
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
  for (const f of ['supabase/migrations/20261009000000_program_budget_phase_a.sql', 'supabase/migrations/20261010000000_budget_subscription_approval.sql']) await pg.exec(runnable(read(f)))
  return { pg, db: pgliteRest(pg), owner }
}

test('the engine lists only approved annual plans within 45 days that nobody has decided', async () => {
  const { pg, db, owner } = await world()
  const mk = (name, extra = {}) => E.createSubscription(db, owner, { fields: { name, billing: 'annual', amount: 600, anchor_date: '2026-10-15', start_date: '2023-10-15', payment_method: 'p_card', ...extra }, today: TODAY })
  const due = await mk('Survey platform')
  const later = await mk('Later plan', { anchor_date: '2027-03-01', start_date: '2025-03-01' })
  const monthly = await mk('Monthly plan', { billing: 'monthly', anchor_date: '2026-10-03', start_date: '2025-01-03' })
  const proposed = await mk('Proposed plan')
  await pg.query(`UPDATE budget_subscriptions SET approval_state = 'proposed' WHERE id = $1`, [proposed.id])
  const kept = await mk('Kept plan')
  await E.decideRenewal(db, owner, { id: kept.id, decision: 'keep', today: TODAY })
  const listed = await E.listRenewals(db, { today: TODAY })
  assert.deepEqual(listed.map(r => [r.name, r.date, r.days, r.paymentLabel]), [['Survey platform', '2026-10-15', 18, 'P-card']])
  assert.ok(![later, monthly].some(s => listed.find(r => r.id === s.id)))
  await E.decideRenewal(db, owner, { id: due.id, decision: 'remind', today: TODAY })
  assert.deepEqual(await E.listRenewals(db, { today: TODAY }), [], 'Remind me in 7 days takes it off the queue too')
})

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', body, headers: {} }, res)
  })
}

test('the endpoint gives the Owner the renewals and everyone else none', async () => {
  const { db, owner } = await world()
  await E.createSubscription(db, owner, { fields: { name: 'Survey platform', billing: 'annual', amount: 600, anchor_date: '2026-10-15', start_date: '2023-10-15' }, today: TODAY })
  const as = (profile) => createBudgetStaffHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db, today: () => TODAY })
  const o = await call(as(owner), { action: 'renewals' })
  assert.deepEqual([o.status, o.body.renewals.length], [200, 1])
  const a = await call(as({ id: 'x', role: 'admin', is_owner: false }), { action: 'renewals' })
  assert.deepEqual([a.status, a.body.renewals], [200, []], 'an Admin is given none, not an error')
})

test('both queues ask only for the Owner, and Open lands on the Subscriptions tab', () => {
  const hook = read('src/hooks/useActionCenterQueue.js')
  // BUDGET-B4 (2026-09-27) folded renewals into one Program Budget query with receipts to review and
  // Concur to submit (loadBudgetQueue); still Owner only, still the budget group.
  assert.match(hook, /queryKey: \['home_budget_queue'\], queryFn: loadBudgetQueue, enabled: enabled && !!isOwner/)
  assert.match(hook, /if \(qBudget\.data\) out\.push\(budgetGroup\(qBudget\.data\)\)/)
  const home = read('src/components/OverviewTab.jsx')
  assert.match(home, /if \(isOwner\) out\.push\(\{ key: 'budget', status: qStatus\(qBudget\)/)
  assert.match(read('src/lib/home/homeLoaders.js'), /if \(e\.code === 'not_enabled'\) return \[\]/, 'before the budget tables, there are simply none')
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/)
})
