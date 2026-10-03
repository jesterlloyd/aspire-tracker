// test/programBudgetUi.test.mjs
//
// PROGRAM-BUDGET A3 (2026-09-27): the Program Budget screens, rendered. A real year is built by
// the real engine on PGlite (the FY26 seed, then FY27 started with subscriptions, expenses and a
// saved plan with a later draft), and each tab is server-rendered for the Owner and for a reader
// (Admin and granted leadership). What a reader may not see is checked in the markup, and the
// wiring (the Settings rail, the portal tab, the grant switch) in the source.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'
const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'

let vite, C, Y
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  const load = async (p) => (await vite.ssrLoadModule(p)).default
  C = {
    Summary: await load('/src/components/budget/BudgetSummary.jsx'), Sheet: await load('/src/components/budget/BudgetSheet.jsx'),
    Subs: await load('/src/components/budget/BudgetSubscriptions.jsx'), Alloc: await load('/src/components/budget/BudgetAllocations.jsx'),
    Start: await load('/src/components/budget/BudgetStart.jsx'),
  }
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
  const db = pgliteRest(pg)
  const cat = async (n) => (await db.from('budget_categories').select('id').eq('name', n).single()).data.id
  const sup = await cat('Supplies & Materials'), tech = await cat('Technology & Software')
  Y = { notStartedOwner: await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY }), notStartedReader: await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY }) }
  await E.createSubscription(db, owner, { fields: { name: 'Survey platform', billing: 'annual', amount: 600, anchor_date: '2026-10-15', start_date: '2023-10-15', payment_method: 'p_card', category_id: tech }, today: TODAY })
  await E.startYear(db, owner, { fy: 2027, total: 40000, today: TODAY })
  await E.createExpense(db, owner, { fields: { expense_date: '2026-09-03', item: 'Copy Paper', category_id: sup, payment_method: 'p_card', amount: 41.41 }, today: TODAY })
  await E.saveAllocations(db, owner, { fy: 2027, amounts: { [sup]: 6000 }, publish: true, today: TODAY })
  await E.saveAllocations(db, owner, { fy: 2027, amounts: { [sup]: 6500 }, publish: false, today: TODAY })
  Y.owner = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  Y.reader = await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })
  Y.closedOwner = await E.loadYear(db, { fy: 2026, viewer: 'owner', today: TODAY })
})
after(async () => { await vite?.close() })

const onWrite = { notify() {}, call: async () => ({}), changed() {}, run: async () => true }
const html = (Comp, year, canEdit) => renderToStaticMarkup(React.createElement(Comp, { year, canEdit, onWrite, onPickYear() {} }))

test('Summary: the owner changes the budget and writes the note; a reader reads the note first', () => {
  const owner = html(C.Summary, Y.owner, true), reader = html(C.Summary, Y.reader, false)
  assert.match(owner, /Change budget/)
  assert.match(owner, /Owner Note/)
  // BUDGET-FIXES-1 item 2.5 changed this: no Mark reconciled today; Last reconciled is the last closed month.
  assert.doesNotMatch(owner, /Mark reconciled today/)
  assert.match(owner, /Last reconciled: <b>(No month closed yet|[A-Z][a-z]+ \d{4}, closed [A-Z][a-z]{2} \d{1,2})<\/b>/)
  assert.doesNotMatch(reader, /Change budget|Mark reconciled today|<textarea/)
  assert.ok(reader.indexOf('From the Program Owner') < reader.indexOf('Budget</span>'), 'the note comes before the figures')
  assert.match(owner, /\$41\.41/)
  // BUDGET-V2 item 12 (2026-09-29): upcoming charges are Expected charges.
  assert.match(owner, /after \$600\.00 in expected charges/, 'Remaining names what subscriptions will still charge')
  assert.match(owner, /Expected charges/)
  assert.match(owner, /Budget History/)
  assert.match(reader, /\$6,000\.00/, 'a reader sees the saved plan')
  assert.doesNotMatch(reader, /\$6,500\.00/, 'and never the draft')
})

test('Sheet: the owner adds and deletes rows; a reader gets a view-only sheet; a closed year is editable too', () => {
  const owner = html(C.Sheet, Y.owner, true), reader = html(C.Sheet, Y.reader, false), closed = html(C.Sheet, Y.closedOwner, true)
  assert.match(owner, /<\/svg> Row<\/button>/)
  assert.match(owner, /Delete row/)
  assert.match(owner, /Copy Paper/)
  assert.match(owner, /class="bud-dash">–</, 'missing is an en dash')
  assert.match(reader, /View only/)
  assert.doesNotMatch(reader, /<\/svg> Row<\/button>|Delete row/)
  assert.match(closed, /Jan 2026/, 'an imported row shows its month')
  // Owner, 2026-09-27: a closed year is editable (the prompt's locks are retired).
  // BUDGET-V2 item 12: the only lock in a closed year is Concur on a row that is not Personal (Concur),
  // which is locked in every year; a closed MONTH locks its rows until it is reopened (Phase 2).
  const locked = [...closed.matchAll(/data-cell="([^"|]+)\|([^"]+)"[^>]*class="[^"]*fs-locked/g)].map(m => m[2])
  // BUDGET-CONCUR-1 changed this: the Concur column is now the Submitted to Concur checkbox, keyed concur_done.
  assert.deepEqual([...new Set(locked)], locked.length ? ['concur_done'] : [], 'nothing in a closed year is locked but Concur on a non-personal row')
  assert.match(closed, /<\/svg> Row<\/button>/, 'a closed year takes new rows')
  assert.match(closed, /Delete row/)
})

// SUBSCRIPTIONS-ONE-VIEW-1 changed the last two lines (Owner, 2026-10-02, "Portal gets less"): a reader
// sees the totals and the Platform Cost statement, never the plan-by-plan list; the totals are one line.
test('Subscriptions: the owner decides renewals on slips; a reader sees the totals, not the plans or the decision', () => {
  const owner = html(C.Subs, Y.owner, true), reader = html(C.Subs, Y.reader, false)
  assert.match(owner, /Renewals to Decide/)
  assert.match(owner, /Survey platform renews Oct 15, 2026 for \$600\.00/)
  assert.match(owner, /Cancel at renewal/)
  assert.match(owner, /Remind me in 7 days/)
  assert.doesNotMatch(reader, /Renewals to Decide|Cancel at renewal/)
  assert.doesNotMatch(reader, /Renews soon|fs-frame|Edit Plans/, 'no plan-by-plan list for leadership')
  assert.match(reader, /aria-label="Subscription totals"/)
  assert.match(reader, /a month/)
  assert.match(owner, /Edit Plans/)
})

test('Allocations: the owner edits a draft and saves the plan; a reader sees only the saved figures', () => {
  const owner = html(C.Alloc, Y.owner, true), reader = html(C.Alloc, Y.reader, false)
  assert.match(owner, /Save plan/)
  assert.match(owner, /Unsaved changes\./)
  assert.match(owner, /aria-label="Supplies &amp; Materials allocation"[^>]*value="6,500"/)
  assert.doesNotMatch(reader, /Save plan|<input/)
  assert.match(reader, /\$6,000\.00/)
  assert.doesNotMatch(reader, /6,500/)
  assert.match(html(C.Alloc, Y.closedOwner, true), /Save plan/, 'the owner can add a plan to a closed year')
  assert.match(html(C.Alloc, { ...Y.closedOwner, allocations: [] }, false), /FY26 had no category plan\. It ran on one \$40,000\.00 total\./)
})

test('a year that has not started: the owner gets the Start form, a reader is told it is not published', () => {
  const owner = html(C.Start, Y.notStartedOwner, true), reader = html(C.Start, Y.notStartedReader, false)
  assert.match(owner, /Start FY27/)
  assert.match(owner, /value="40,000\.00"/, 'prefilled with the prior year’s total')
  assert.match(owner, /You can change this at any time\. Each change is logged with the date and the old and new amounts\./)
  assert.match(owner, /FY26 Result/)
  assert.match(owner, /\$1,620\.44/)
  assert.match(reader, /The FY27 budget isn(&#x27;|')t published yet\./)
  assert.doesNotMatch(reader, /Start FY27/)
})

test('the screens are wired where the Owner decided', () => {
  const sections = read('src/components/settings/settingsSections.js')
  // SETTINGS-FULLSCREEN-1 (2026-09-27) added fullScreen: true (the page drops the rail for a Catalog-style crumb).
  // BUDGET-TRACKER-1 changed this (Owner, 2026-09-30): Program Budget is now labelled Budget Tracker.
  // NAV-POLISH-1 changed this (Owner, 2026-10-02): both full-screen pages are the Program group.
  assert.match(sections, /key: 'communityBenefit'[^\n]+\n\s+\{ key: 'programBudget', label: 'Budget Tracker', path: '\/settings\/budget', group: 'Program', implemented: true, fullScreen: true, visible: r => r\.isAdmin \}/)
  assert.match(read('src/components/settings/SettingsShell.jsx'), /currentKey === 'programBudget' && <ProgramBudgetPanel \/>/)
  const portal = read('src/portal/na/NursingAcademicsPortal.jsx')
  assert.match(portal, /view === 'budget' && \(budgetEnabled \?/)
  assert.match(portal, /source=\{PORTAL_SOURCE\}/)
  assert.match(read('src/portal/PortalApp.jsx'), /budgetPortal\(\{ probe: '1' \}\)/, 'the tab waits for the server to say yes')
  assert.match(read('src/components/budget/budgetApi.js'), /write: null,/, 'the portal source has no write path')
  const modal = read('src/components/settings/GrantPortalAccessModal.jsx')
  assert.match(modal, /if \(role === 'nursing_academic' && isOwner\) base\.budget_access = budgetAccess/)
  assert.match(modal, /\{isOwner && \(/)
  const css = read('src/components/budget/budget.css')
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /border-radius:\s*[1-9]/, 'no literal radii (0 is square, not a radius)')
})
