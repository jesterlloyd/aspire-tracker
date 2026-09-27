// test/programBudgetMigration.test.mjs
//
// PROGRAM-BUDGET Phase A (2026-09-27): the migration and the FY26 seed on real Postgres (PGlite).
// The eight tables exist with RLS on and nothing granted to the browser roles; the history
// tables refuse UPDATE, DELETE and TRUNCATE; a status the payment method does not allow is
// refused; a subscription charge posts once per date; budget_access is 'none' by default and
// only a nursing_academic grant may hold 'view'; the seed imports the ten workbook rows
// ($1,620.44) and runs twice without doubling; the migration runs twice.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261009000000_program_budget_phase_a.sql')
const seed = read('db/migrations/seed_program_budget_fy26.sql')
const checks = read('db/audit/program_budget_phase_a_checks.sql')

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501'; END $$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, is_owner boolean, created_at timestamptz DEFAULT now());
  INSERT INTO public.user_profiles (full_name, is_owner) VALUES ('Jester Lloyd Bautista', true), ('Admin Person', false);
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
  CREATE TABLE public.user_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL);
  INSERT INTO public.user_role_grants (role) VALUES ('nursing_academic'), ('student');
  CREATE OR REPLACE FUNCTION pg_temp.noop() RETURNS void LANGUAGE sql AS 'SELECT 1';
`
// PGlite has no PostgREST; the NOTIFY is harmless but the listener does not exist.
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

async function fresh() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(runnable(migration))
  return db
}
const one = async (db, sql) => (await db.query(sql)).rows[0]

test('eight tables, RLS on, nothing for anon or authenticated, and the migration runs twice', async () => {
  const db = await fresh()
  await db.exec(runnable(migration))
  const { rows } = await db.query(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'budget%' AND c.relkind = 'r' ORDER BY 1`)
  assert.deepEqual(rows.map(r => r.relname), ['budget_allocations', 'budget_categories', 'budget_changes', 'budget_events', 'budget_expenses', 'budget_sheet_views', 'budget_subscriptions', 'budgets'])
  assert.ok(rows.every(r => r.relrowsecurity))
  const g = await one(db, `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee IN ('anon', 'authenticated') AND table_name LIKE 'budget%'`)
  assert.equal(g.n, 0)
  const p = await one(db, `SELECT count(*)::int AS n FROM pg_policies WHERE tablename LIKE 'budget%'`)
  assert.equal(p.n, 0, 'no browser policy: every read goes through the API')
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.budget_categories`)).n, 14)
})

test('history is append-only', async () => {
  const db = await fresh()
  await db.exec(runnable(seed))
  await assert.rejects(db.exec(`UPDATE public.budget_events SET message = 'x'`), /append-only/)
  await assert.rejects(db.exec(`DELETE FROM public.budget_events`), /append-only/)
  await assert.rejects(db.exec(`TRUNCATE public.budget_events`), /append-only/)
  await db.exec(`INSERT INTO public.budget_changes (entity, entity_id, action) VALUES ('expense', gen_random_uuid(), 'update')`)
  await assert.rejects(db.exec(`DELETE FROM public.budget_changes`), /append-only/)
})

test('a status must be one the payment method allows', async () => {
  const db = await fresh()
  await db.exec(`INSERT INTO public.budgets (fiscal_year, total, started_at) VALUES (2027, 40000, now())`)
  const ins = (pay, status) => db.exec(`INSERT INTO public.budget_expenses (budget_id, expense_date, item, amount, payment_method, status)
    SELECT id, '2026-09-03', 'x', 1, ${pay ? `'${pay}'` : 'NULL'}, ${status ? `'${status}'` : 'NULL'} FROM public.budgets WHERE fiscal_year = 2027`)
  await ins('p_card', 'paid'); await ins('personal_concur', 'submitted'); await ins('po_invoice', 'paid'); await ins(null, 'recorded'); await ins(null, null)
  await assert.rejects(ins('p_card', 'recorded'), /chk_budget_expenses_status/)
  await assert.rejects(ins('po_invoice', 'reimbursed'), /chk_budget_expenses_status/)
  await assert.rejects(ins(null, 'paid'), /chk_budget_expenses_status/)
  await assert.rejects(ins('cash', null), /chk_budget_expenses_payment/)
})

test('a subscription charge posts once per date', async () => {
  const db = await fresh()
  await db.exec(`INSERT INTO public.budgets (fiscal_year, total, started_at) VALUES (2027, 40000, now());
    INSERT INTO public.budget_subscriptions (id, name, billing, amount, anchor_date, start_date) VALUES ('11111111-1111-4111-8111-111111111111', 'Design tool', 'monthly', 15, '2026-10-03', '2025-01-03')`)
  const post = () => db.exec(`INSERT INTO public.budget_expenses (budget_id, expense_date, item, amount, subscription_id, charge_date, source, payment_method, status)
    SELECT id, '2026-09-03', 'Design tool', 15, '11111111-1111-4111-8111-111111111111', '2026-09-03', 'subscription', 'p_card', 'paid' FROM public.budgets WHERE fiscal_year = 2027`)
  await post()
  await assert.rejects(post(), /uq_budget_expenses_charge/)
})

test('budget_access is none by default, and only Nursing Education & Leadership may view', async () => {
  const db = await fresh()
  assert.deepEqual((await db.query(`SELECT DISTINCT budget_access FROM public.user_role_grants`)).rows, [{ budget_access: 'none' }])
  await db.exec(`UPDATE public.user_role_grants SET budget_access = 'view' WHERE role = 'nursing_academic'`)
  await assert.rejects(db.exec(`UPDATE public.user_role_grants SET budget_access = 'view' WHERE role = 'student'`), /budget_access_check/)
  await assert.rejects(db.exec(`UPDATE public.user_role_grants SET budget_access = 'edit' WHERE role = 'nursing_academic'`), /budget_access_check/)
})

test('the FY26 seed imports the ten workbook rows, $1,620.44, once', async () => {
  const db = await fresh()
  await db.exec(runnable(seed))
  await db.exec(runnable(seed))
  const b = await one(db, `SELECT total::text, owner_note, started_at IS NOT NULL AS started FROM public.budgets WHERE fiscal_year = 2026`)
  assert.deepEqual(b, { total: '40000.00', owner_note: 'This is all ASPIRE spend for FY26. No ASPIRE costs went through other budgets.', started: true })
  const e = await one(db, `SELECT count(*)::int AS n, sum(amount)::text AS total, bool_and(date_precision = 'month') AS months,
    bool_and(payment_method IS NULL AND status IS NULL AND receipt_file_id IS NULL) AS empty, count(DISTINCT budget_id)::int AS budgets FROM public.budget_expenses`)
  assert.deepEqual(e, { n: 10, total: '1620.44', months: true, empty: true, budgets: 1 })
  const byMonth = (await db.query(`SELECT to_char(expense_date, 'Mon YYYY') AS m, sum(amount)::text AS s FROM public.budget_expenses GROUP BY 1 ORDER BY min(expense_date)`)).rows
  assert.deepEqual(byMonth, [{ m: 'Jan 2026', s: '75.50' }, { m: 'Feb 2026', s: '25.14' }, { m: 'Mar 2026', s: '1519.80' }], 'matches the workbook’s Annual Budget Tracker row')
  const h = await one(db, `SELECT string_agg(message, '|') AS m FROM public.budget_events`)
  assert.equal(h.m, 'Budget set to $40,000.00, from the FY26 workbook.')
  const orders = (await db.query(`SELECT order_number FROM public.budget_expenses WHERE order_number <> '' ORDER BY order_number`)).rows.map(r => r.order_number)
  assert.deepEqual(orders, ['113-2454901-2790626', '113-4985467-8610640', '114-2621881-4457026'])
})

test('the checks file is read-only and numbered for the gate', () => {
  for (const s of ['PRE 1', 'PRE 2', 'POST 1', 'POST 2', 'POST 3', 'POST 4', 'POST 5', 'SEED 1', 'SEED 2', 'SEED 3']) assert.match(checks, new RegExp(`── ${s}:`))
  assert.doesNotMatch(checks.replace(/--.*$/gm, ''), /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i)
})
