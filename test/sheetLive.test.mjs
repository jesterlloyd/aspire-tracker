// test/sheetLive.test.mjs
//
// SHEET-LIVE-1 (Owner, 2026-09-27), three corrections to the Editable sheet and Program Budget:
//   1. "couldn't it be like a real sheet where I just click the cell, change the value, and ... it
//      autosaves?": a cell is edited in the cell and saved when it is left; a calculated column says
//      why it cannot be typed in; a quantity of zero is allowed (migration 20261012000000).
//   2. "why not highlight AND outline all that's selected?": a range is outlined around its edge.
//   3. "is it possible to allow formulas?": src/lib/sheet/sheetFormula.js, a parser (never eval).
// The browser behaviour was verified in a harness against the real engine; these tests hold the
// rules and the wiring.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

const F = await import('../src/lib/sheet/sheetFormula.js')
const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

// ── 3. Formulas ──────────────────────────────────────────────────────────────────

test('a formula does arithmetic in the usual order, with brackets, powers, percent and money', () => {
  const ev = (t) => F.evaluateFormula(t)
  assert.equal(ev('=2+3*4'), 14)
  assert.equal(ev('=(2+3)*4'), 20)
  assert.equal(ev('=2^3^2'), 512, 'a power binds right to left')
  assert.equal(ev('=-2^2'), 4, 'a leading minus belongs to its number, as in Excel')
  assert.equal(ev('=50%*200'), 100)
  assert.equal(ev('=$12.50*2'), 25)
  assert.equal(ev('=0.1+0.2'), 0.3, 'no floating-point dust')
  assert.equal(ev('= 240 / 12 '), 20)
  assert.equal(ev('=sum(1, 2, 3)'), 6, 'function names are not case sensitive')
  assert.equal(ev('=AVERAGE(2, 4)'), 3)
  assert.deepEqual([ev('=MIN(4, 2, 9)'), ev('=MAX(4, 2, 9)'), ev('=ABS(-7)')], [2, 9, 7])
  assert.deepEqual([ev('=ROUND(12.345, 2)'), ev('=ROUND(2.5)'), ev('=ROUND(1.005, 2)')], [12.35, 3, 1.01])
})

test('a formula reads other cells in the same row by column name, and a blank reads as zero', () => {
  const row = { qty: 40, 'unit cost': 8.75, 'spent ($)': '$1,200.50', notes: 'hello', blank: '' }
  const refOf = (n) => row[n.toLowerCase()]
  assert.equal(F.evaluateFormula('=[Qty]*[Unit cost]', refOf), 350)
  assert.equal(F.evaluateFormula('=[Spent ($)]/2', refOf), 600.25, 'a money value with its sign and comma reads as a number')
  assert.equal(F.evaluateFormula('=[blank]+5', refOf), 5)
  assert.deepEqual(F.formulaRefs('=[Qty]*[qty] + [Unit cost]'), ['Qty', 'Unit cost'])
})

test('a formula that cannot be worked out says why in a sentence, and nothing typed runs as code', () => {
  const refOf = (n) => ({ qty: 2, notes: 'hello' })[n.toLowerCase()]
  const err = (t) => F.tryFormula(t, refOf).error
  assert.match(err('=[Qtty]*2'), /no column named \[Qtty\]/)
  assert.match(err('=[Notes]*2'), /\[Notes\] is not a number/)
  assert.match(err('=4/0'), /divides by zero/)
  assert.match(err('=POWER(2, 3)'), /POWER is not a function this sheet knows/)
  assert.match(err('=Qty*2'), /Put a column name in brackets: \[QTY\]/)
  assert.match(err('=(2+3'), /bracket is not closed/)
  assert.match(err('=1,000*2'), /thousands comma/)
  assert.match(err('='), /after the = sign/)
  assert.match(err('=2+'), /ends too soon/)
  for (const bad of ['=constructor', '=alert(1)', '=process.exit()', '=globalThis', '=`x`', '=a;b', '={}']) {
    assert.ok(F.tryFormula(bad, refOf).error, `${bad} is refused, not run`)
  }
  assert.equal(F.isFormula(' =1'), true)
  assert.equal(F.isFormula('1=1'), false)
})

// ── 1. A quantity of zero (migration 20261012000000) ─────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'append-only'; END $f$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY); INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, role text, is_owner boolean, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, status text, is_demo boolean DEFAULT false);
  CREATE TABLE public.user_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL);`
async function world({ zero }) {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING *`)
  await pg.exec(runnable(read('supabase/migrations/20261009000000_program_budget_phase_a.sql')))
  if (zero) await pg.exec(runnable(read('supabase/migrations/20261012000000_budget_expense_zero_quantity.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  const db = pgliteRest(pg)
  const [first] = (await E.loadYear(db, { fy: 2026, viewer: 'owner', today: '2026-09-27' })).expenses
  return { pg, db, owner, first }
}

test('a quantity may be zero once its update is applied; Unit cost then reads as none', async () => {
  const { db, owner, first } = await world({ zero: true })
  const saved = await E.updateExpense(db, owner, { id: first.id, patch: { quantity: '0' }, today: '2026-09-27' })
  assert.deepEqual([saved.quantity, saved.unitCost], [0, null])
  await assert.rejects(E.updateExpense(db, owner, { id: first.id, patch: { quantity: '-1' } }), /zero or more/)
  await assert.rejects(E.updateExpense(db, owner, { id: first.id, patch: { quantity: '' } }), /zero or more/, 'a blank is not zero')
  assert.equal((await E.updateExpense(db, owner, { id: first.id, patch: { quantity: '1,200' }, today: '2026-09-27' })).quantity, 1200)
})

test('before the update, a zero quantity is refused with a sentence that names it (not a bare 500)', async () => {
  const { db, owner, first } = await world({ zero: false })
  await assert.rejects(E.updateExpense(db, owner, { id: first.id, patch: { quantity: 0 }, today: '2026-09-27' }),
    (e) => e.code === 'needs_update' && e.status === 409 && /20261012000000_budget_expense_zero_quantity\.sql/.test(e.message))
})

test('the migration only loosens the check, and the SQL gate lists it as unapplied', () => {
  const sql = read('supabase/migrations/20261012000000_budget_expense_zero_quantity.sql')
  assert.match(sql, /OWNER-GATED/)
  assert.match(sql, /DROP CONSTRAINT IF EXISTS chk_budget_expenses_quantity/)
  assert.match(sql, /CHECK \(quantity >= 0\)/)
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /DELETE|UPDATE public|DROP TABLE|DROP COLUMN/i)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /\| 20261012000000_budget_expense_zero_quantity\.sql \| SHEET-LIVE-1[^|]*\| \*\*UNAPPLIED\.\*\*/)
})

// ── The grid (source and a server render) ───────────────────────────────────────

const sheet = read('src/components/sheet/EditableSheet.jsx')
const css = read('src/components/forms/forms.css')

test('a cell is edited in the cell: typing starts it, Enter and Tab save and move, Escape puts it back, leaving saves', () => {
  assert.match(sheet, /function InlineEditor\(/)
  assert.match(sheet, /e\.key\.length === 1 && !e\.metaKey && !e\.ctrlKey && !e\.altKey/, 'a typed key starts editing')
  assert.match(sheet, /e\.key === 'Enter' \|\| e\.key === 'F2'/)
  assert.match(sheet, /e\.key === 'Enter' && !\(col\.type === 'paragraph' && e\.shiftKey\)\) \{ e\.preventDefault\(\); finish\(\[e\.shiftKey \? -1 : 1, 0\]\)/)
  assert.match(sheet, /e\.key === 'Tab'\) \{ e\.preventDefault\(\); finish\(\[0, e\.shiftKey \? -1 : 1\]\)/)
  assert.match(sheet, /const blur = \(\) => \{ if \(!editing\.error\) finish\(null\) \}/, 'clicking away saves')
  assert.match(sheet, /onChange=\{e => finish\(null, e\.target\.value\)\}/, 'a dropdown saves the moment a choice is picked')
  assert.match(sheet, /value === String\(ed\.original \?\? ''\)\) \{ done\(\); return \}/, 'leaving an unchanged cell writes nothing')
  // The Forms Sheet's correction still needs its reason, so it keeps the panel with a Save button.
  assert.match(sheet, /const usesPanel = \(col\) => col\.type === 'checkboxes' \|\| \(!col\.staff && !!editorExtras\)/)
})

test('every save says Saved where All changes saved sits; a calculated column says what it is worked out from', () => {
  assert.match(sheet, /flash \? <><Check size=\{13\} aria-hidden="true" \/> Saved<\/> : 'All changes saved'/)
  assert.match(css, /\.fs-save-flash \{/)
  assert.match(sheet, /else if \(col\.note\) notify\?\.\(col\.note\)/)
  const subs = read('src/components/budget/BudgetSubscriptions.jsx')
  assert.match(subs, /key: 'perYear'[^\n]*note: 'Per year is worked out from Amount and Billing/)
  for (const k of ['next', 'due', 'status']) assert.match(subs, new RegExp(`key: '${k}'[^\\n]*note: '`), `${k} explains itself`)
  const ledger = read('src/components/budget/BudgetSheet.jsx')
  assert.match(ledger, /key: 'unit'[^\n]*note: 'Unit cost is worked out: Spent divided by Qty/)
  // The page's messages are a toast at the foot of the window, not a notice scrolled out of view.
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /className=\{`bud-toast/)
  assert.match(read('src/components/budget/budget.css'), /\.bud-toast \{ position: fixed;/)
})

test('a range is outlined around its outer edge, and the active cell inside it stays untinted', () => {
  assert.match(sheet, /r === range\.r0 \? ' fs-et' : ''\}\$\{r === range\.r1 \? ' fs-eb' : ''\}\$\{c === range\.c0 \? ' fs-el' : ''\}\$\{c === range\.c1 \? ' fs-er' : ''\}/)
  assert.match(css, /\.fs-grid \.fs-inrange \{ box-shadow: inset 0 var\(--fs-et, 0px\)/, 'each edge keeps a unit, or calc() drops the rule')
  assert.match(css, /\.fs-grid \.fs-et \{ --fs-et: 2px; \}/)
  assert.match(css, /\.fs-inrange\.fs-sel \{ background-image: none; \}/)
})

test('both budget sheets take formulas; the Forms Sheet does not', () => {
  assert.match(read('src/components/budget/BudgetSheet.jsx'), /\n\s+formulas\n/)
  assert.match(read('src/components/budget/BudgetSubscriptions.jsx'), /\n\s+formulas\n/)
  assert.doesNotMatch(read('src/components/forms/FormSheet.jsx'), /formulas/)
  assert.match(sheet, /const takesFormula = \(col\) => formulas && col\.type === 'number' && !col\.compute/)
  // Clear formatting leaves a formula: it is what the cell holds, not how it looks.
  assert.match(sheet, /patch === null \? \(cur\?\.fx \? \{ fx: cur\.fx \} : \{\}\)/)
})

let vite, EditableSheet
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  EditableSheet = (await vite.ssrLoadModule('/src/components/sheet/EditableSheet.jsx')).default
})
after(async () => { await vite?.close() })

test('a cell whose value came from a formula carries a corner mark and shows the formula on hover', () => {
  const rows = [{ id: 'r1', cells: { qty: '4', amount: '10' }, format: { amount: { fx: '=[Qty]*2.5', num: 'currency' } } }]
  const html = (formulas) => renderToStaticMarkup(React.createElement(EditableSheet, {
    initialRows: rows, initialLayout: { order: [], hidden: [], widths: {}, frozen: 0, groupBy: null, staffColumns: [], colFormats: {}, summaries: {} },
    lead: { key: '@n', label: 'Name' }, columns: [{ key: 'qty', label: 'Qty', type: 'number' }, { key: 'amount', label: 'Spent', type: 'number' }],
    editable: true, formulas, valueOf: (r, k) => r.cells[k], shownOf: (r, k) => r.cells[k] ?? '', defaultSort: { key: '@n', dir: 'asc' },
    canEditColumn: () => true, labels: {},
  }))
  const on = html(true)
  assert.match(on, /data-cell="r1\|amount"[^>]*class="fs-cell fs-hasfx"[^>]*title="=\[Qty\]\*2\.5"|data-cell="r1\|amount"[^>]*title="=\[Qty\]\*2\.5"[^>]*class="fs-cell fs-hasfx"/)
  assert.match(on, />\$10\.00</, 'the value keeps its own number format')
  assert.doesNotMatch(html(false), /fs-hasfx/, 'a host without formulas shows no mark')
})
