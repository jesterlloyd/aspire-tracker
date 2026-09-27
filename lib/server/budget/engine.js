// lib/server/budget/engine.js
//
// PROGRAM-BUDGET Phase A (BUDGET-A2, 2026-09-27): the Program Budget's server side. Every read
// and write of the budget tables goes through here, from /api/budget-staff (Owner edits, Admin
// reads), /api/portal/academics-budget (granted leadership reads) and the daily cron that posts
// subscription charges. The rules are src/lib/budget/budgetModel.js; this file only reads,
// checks and writes.
//
// Who sees what (Owner decisions, 2026-09-27):
//   owner   everything, and every write.
//   reader  Admin and granted leadership: Summary, Sheet and Subscriptions, and Allocations once
//           a plan is saved (the SAVED figures only). Never receipt files, the review queue,
//           renewals to decide or draft allocations. A reader sees that a receipt is on file,
//           never its id.
//
// Uses only the query-builder calls test/helpers/pgliteRest.mjs supports, so it runs against
// real Postgres in tests. Numeric columns arrive as strings from some clients; every one is
// read through num().

import {
  PROGRAM, DEFAULT_COST_CENTER, budgetSummary, fyShort, fiscalYearOfDate, fiscalYearRange, currentFiscalYear, pacificToday,
  yearState, statusesFor, defaultStatus, statusAfterPaymentChange, statusLabel, paymentLabel, billingLabel, dateText,
  nextCharge, perYear, dueByYearEnd, subscriptionStatus, renewalsToDecide, cancelAtRenewal, chargesToPost, chargeExpense,
  proposalSummary, isProposed, APPROVAL,
  splitEvenly, allocationTotals, budgetChangedMessage, budgetSetMessage, unitCost, counts, FY_MONTHS, monthOf,
  PAYMENT_METHODS, BILLING, REMIND_AFTER_DAYS,
} from '../../../src/lib/budget/budgetModel.js'
import { addDays } from '../../../src/lib/rotationCalendarDates.js'
import { xlsxBook } from '../sheet/xlsx.js'

export class BudgetError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
export const notEnabled = (e) => !!e && (e.code === '42P01' || e.code === '42703' || e.code === 'PGRST205' || e.code === 'PGRST204')
const NOT_ENABLED = 'Program Budget is not enabled yet. Its database update (20261009000000_program_budget_phase_a.sql) has not been applied.'
const num = (v) => (v == null || v === '' ? null : Number(v))
// A date column, as YYYY-MM-DD whichever client read it (PostgREST sends the string; a driver
// may send a Date or an ISO timestamp).
const ymd = (v) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10))
const subIn = (s) => ({ ...s, amount: num(s.amount), anchor_date: ymd(s.anchor_date), start_date: ymd(s.start_date), end_date: ymd(s.end_date), renewal_kept_for: ymd(s.renewal_kept_for), renewal_remind_after: ymd(s.renewal_remind_after), post_from: ymd(s.post_from) })
const expIn = (e) => ({ ...e, amount: num(e.amount), quantity: num(e.quantity), expense_date: ymd(e.expense_date), charge_date: ymd(e.charge_date) })
const money = (v) => Math.round(Number(v) * 100) / 100
const EXITED = new Set(['Not Proceeding', 'Declined'])

async function q(query, code = 'db_failed', message = 'The budget could not be read.') {
  const { data, error } = await query
  if (error) {
    if (notEnabled(error)) throw new BudgetError('not_enabled', NOT_ENABLED, 409)
    throw new BudgetError(code, message, 500)
  }
  return data
}
const actorOf = (profile) => ({ actor_profile_id: profile?.id || null, actor_name: profile?.full_name || profile?.email || '' })

/** Is the database update applied? */
export async function status(db) {
  const { error } = await db.from('budgets').select('id').limit(1)
  if (notEnabled(error)) return { enabled: false }
  if (error) throw new BudgetError('db_failed', 'The budget could not be read.', 500)
  return { enabled: true }
}

// ── Reading ─────────────────────────────────────────────────────────────────────

const budgetFor = async (db, fy) => (await q(db.from('budgets').select('*').eq('program', PROGRAM).eq('fiscal_year', fy).limit(1)))[0] || null
const categoriesOf = async (db) => (await q(db.from('budget_categories').select('id, name, sort_order, is_active').eq('program', PROGRAM).order('sort_order')))
const subscriptionsOf = async (db) => (await q(db.from('budget_subscriptions').select('*').eq('program', PROGRAM).is('deleted_at', null).order('created_at'))).map(subIn)
async function expensesOf(db, budgetId) {
  if (!budgetId) return []
  return (await q(db.from('budget_expenses').select('*').eq('budget_id', budgetId).is('deleted_at', null).order('expense_date').order('created_at')))
    .map(expIn)
}

/** Cohort names, and the roster size of each (real students still proceeding), for cost per student. */
async function cohortsWithRoster(db) {
  const cohorts = (await q(db.from('cohorts').select('id, name, is_demo').order('created_at', { ascending: false }))).filter(c => c.is_demo !== true)
  const students = await q(db.from('students').select('cohort_id, status, is_demo'))
  const size = new Map()
  for (const s of students) if (s.is_demo !== true && s.cohort_id && !EXITED.has(s.status)) size.set(s.cohort_id, (size.get(s.cohort_id) || 0) + 1)
  return cohorts.map(c => ({ id: c.id, name: c.name, size: size.get(c.id) || null }))
}

/** The fiscal years that exist, plus the current one, newest first. */
async function yearsOf(db, today) {
  const rows = await q(db.from('budgets').select('fiscal_year').eq('program', PROGRAM))
  const cur = currentFiscalYear(new Date(`${today}T12:00:00-07:00`))
  return [...new Set([cur, ...rows.map(r => r.fiscal_year)])].sort((a, b) => b - a)
}

/** One subscription as the tab shows it: its stored fields and what is calculated from them. */
function subscriptionView(s, fy, state, today) {
  const st = subscriptionStatus(s, today)
  return {
    id: s.id, name: s.name, plan: s.plan, vendor: s.vendor, billing: s.billing, billingLabel: billingLabel(s.billing), amount: s.amount,
    anchor_date: s.anchor_date, start_date: s.start_date, end_date: s.end_date, payment_method: s.payment_method, paymentLabel: paymentLabel(s.payment_method),
    category_id: s.category_id, auto_renew: s.auto_renew, notes: s.notes,
    approval_state: s.approval_state || APPROVAL.approved, post_from: s.post_from || null,
    cell_formats: s.cell_formats || {}, staff_values: s.staff_values || {},
    nextCharge: nextCharge(s, today), perYear: perYear(s, today), dueByYearEnd: dueByYearEnd(s, fy, state, today), status: st.label, statusTone: st.tone,
  }
}

/** One expense as the Sheet shows it. A reader learns that a receipt is on file, never where. */
function expenseView(e, viewer) {
  return {
    id: e.id, expense_date: e.expense_date, date_precision: e.date_precision, dateText: dateText(e.expense_date, e.date_precision),
    item: e.item, category_id: e.category_id, description: e.description, vendor: e.vendor, order_number: e.order_number,
    payment_method: e.payment_method, paymentLabel: paymentLabel(e.payment_method), status: e.status, statusLabel: statusLabel(e.status),
    quantity: e.quantity, amount: e.amount, unitCost: unitCost(e), cohort_id: e.cohort_id, cost_center: e.cost_center, notes: e.notes,
    hasReceipt: !!e.receipt_file_id, ...(viewer === 'owner' ? { receipt_file_id: e.receipt_file_id } : {}),
    subscription_id: e.subscription_id, source: e.source, cell_formats: e.cell_formats || {}, staff_values: e.staff_values || {},
    statusOptions: statusesFor(e.payment_method),
  }
}

/**
 * Everything the screen shows for one fiscal year, for one kind of viewer. `viewer` is 'owner'
 * or 'reader'; the reader's payload is built without the owner-only fields rather than
 * filtered afterwards, so nothing owner-only is ever in it.
 */
export async function loadYear(db, { fy, viewer = 'reader', today = pacificToday() }) {
  const budget = await budgetFor(db, fy)
  const [categories, subsRaw, expensesRaw, cohorts, years] = await Promise.all([
    categoriesOf(db), subscriptionsOf(db), expensesOf(db, budget?.id), cohortsWithRoster(db), yearsOf(db, today),
  ])
  const state = yearState(budget, fy, today)
  const allocations = budget ? (await q(db.from('budget_allocations').select('category_id, amount, saved_amount').eq('budget_id', budget.id)))
    .map(a => ({ category_id: a.category_id, amount: num(a.amount), saved_amount: num(a.saved_amount) })) : []
  const history = budget ? (await q(db.from('budget_events').select('kind, message, actor_name, created_at').eq('budget_id', budget.id).order('created_at', { ascending: false }))) : []
  const layoutRows = await q(db.from('budget_sheet_views').select('program, layout').in('program', [PROGRAM, `${PROGRAM}:subscriptions`]))
  const layoutOf = (key) => layoutRows.find(r => r.program === key)?.layout || null
  const ownerRow = (await q(db.from('user_profiles').select('full_name').eq('is_owner', true).limit(1)))[0]
  const roster = new Map(cohorts.map(c => [c.id, { name: c.name, size: c.size }]))
  const summary = budgetSummary({ fy, budget: budget && { ...budget, total: num(budget.total) }, expenses: expensesRaw, categories, allocations, subs: subsRaw, roster, viewer, today })
  const planVisible = viewer === 'owner' || !!budget?.plan_saved_at

  // The prior year's result, for the Start form's side card.
  let prior = null
  if (viewer === 'owner' && state === 'not_started') {
    const pb = await budgetFor(db, fy - 1)
    if (pb) {
      const pe = await expensesOf(db, pb.id)
      const ps = budgetSummary({ fy: fy - 1, budget: { ...pb, total: num(pb.total) }, expenses: pe, categories, roster, viewer, today })
      prior = { fy: fy - 1, label: fyShort(fy - 1), total: ps.total, spent: ps.spent, used: ps.used, largestCategory: ps.largestCategory, costPerStudent: ps.costPerStudent, cost_center: pb.cost_center }
    }
  }

  return {
    fy, label: fyShort(fy), state, viewer, years, program: PROGRAM, owner_name: ownerRow?.full_name || '',
    budget: budget ? {
      id: budget.id, total: num(budget.total), cost_center: budget.cost_center, started_at: budget.started_at,
      owner_note: budget.owner_note, last_reconciled_at: budget.last_reconciled_at, plan_saved_at: budget.plan_saved_at,
    } : null,
    categories: categories.filter(c => c.is_active).map(c => ({ id: c.id, name: c.name })),
    expenses: expensesRaw.map(e => expenseView(e, viewer)),
    subscriptions: subsRaw.map(s => subscriptionView(s, fy, state, today)),
    renewals: viewer === 'owner' && state === 'current' ? renewalsToDecide(subsRaw, today).map(r => ({ id: r.sub.id, name: r.sub.name, plan: r.sub.plan, amount: r.sub.amount, paymentLabel: paymentLabel(r.sub.payment_method), auto_renew: r.sub.auto_renew, date: r.renewal.date, days: r.renewal.days })) : [],
    allocations: planVisible ? allocations.map(a => (viewer === 'owner' ? a : { category_id: a.category_id, saved_amount: a.saved_amount })) : [],
    // SUB-APPROVAL-1: what the proposals would cost, for the approval conversation. Every viewer sees it.
    proposals: proposalSummary(subsRaw, fy, today),
    history, summary, cohorts: cohorts.map(c => ({ id: c.id, name: c.name })), prior,
    layout: layoutOf(PROGRAM), subscriptionsLayout: layoutOf(`${PROGRAM}:subscriptions`),
    options: { payments: PAYMENT_METHODS, billing: BILLING },
  }
}

// ── The year itself (Owner) ─────────────────────────────────────────────────────

const parseTotal = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new BudgetError('invalid_total', 'Enter the annual budget in dollars.')
  return money(n)
}
async function logEvent(db, budgetId, kind, message, actor, oldValue = null, newValue = null) {
  await q(db.from('budget_events').insert({ budget_id: budgetId, kind, message, old_value: oldValue, new_value: newValue, ...actorOf(actor) }), 'history_failed', 'The change was saved but its history line was not.')
}
async function logChanges(db, entity, entityId, budgetId, action, changes, actor) {
  const rows = changes.map(c => ({ entity, entity_id: entityId, budget_id: budgetId || null, action, field: c.field || null, old_value: c.old ?? null, new_value: c.new ?? null, ...actorOf(actor) }))
  if (rows.length) await q(db.from('budget_changes').insert(rows), 'history_failed', 'The change was saved but its history was not.')
}

/** Start a fiscal year (A4): its budget, cost center and, optionally, an even draft plan. */
export async function startYear(db, actor, { fy, total, cost_center, plan = 'none', today = pacificToday() }) {
  const r = fiscalYearRange(fy)
  if (!r || today > r.end) throw new BudgetError('invalid_year', 'That fiscal year has ended.')
  const existing = await budgetFor(db, fy)
  if (existing?.started_at) throw new BudgetError('already_started', `${fyShort(fy)} has already started.`, 409)
  const amount = parseTotal(total)
  const fields = { total: amount, cost_center: String(cost_center || DEFAULT_COST_CENTER).trim().slice(0, 80) || DEFAULT_COST_CENTER, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  const budget = existing
    ? (await q(db.from('budgets').update(fields).eq('id', existing.id).select()))[0]
    : (await q(db.from('budgets').insert({ program: PROGRAM, fiscal_year: fy, created_by: actor?.id || null, ...fields }).select()))[0]
  await logEvent(db, budget.id, 'year_started', `${fyShort(fy)} started.`, actor)
  await logEvent(db, budget.id, 'budget_set', budgetSetMessage(amount), actor, null, { total: amount })
  if (plan === 'even') {
    const cats = (await categoriesOf(db)).filter(c => c.is_active)
    const parts = splitEvenly(amount, cats.length)
    await q(db.from('budget_allocations').upsert(cats.map((c, i) => ({ budget_id: budget.id, category_id: c.id, amount: parts[i] })), { onConflict: 'budget_id,category_id' }))
  }
  const posted = await postDueCharges(db, { today })
  return { budget, posted: posted.posted }
}

async function currentBudget(db, fy, today) {
  const b = await budgetFor(db, fy)
  const state = yearState(b, fy, today)
  if (state === 'not_started') throw new BudgetError('not_started', `${fyShort(fy)} has not started.`, 409)
  return { budget: b, state }
}

/** Change the annual budget. Every change is a Budget history line with both amounts. */
export async function setTotal(db, actor, { fy, total, today = pacificToday() }) {
  const { budget } = await currentBudget(db, fy, today)
  const next = parseTotal(total), prev = num(budget.total)
  if (next === prev) return { total: prev }
  await q(db.from('budgets').update({ total: next, updated_at: new Date().toISOString() }).eq('id', budget.id))
  await logEvent(db, budget.id, 'budget_changed', budgetChangedMessage(prev, next), actor, { total: prev }, { total: next })
  return { total: next }
}

export async function setNote(db, actor, { fy, note, today = pacificToday() }) {
  const { budget } = await currentBudget(db, fy, today)
  const text = String(note ?? '').slice(0, 2000)
  await q(db.from('budgets').update({ owner_note: text, updated_at: new Date().toISOString() }).eq('id', budget.id))
  return { owner_note: text }
}

export async function markReconciled(db, actor, { fy, today = pacificToday() }) {
  const { budget } = await currentBudget(db, fy, today)
  const at = new Date().toISOString()
  await q(db.from('budgets').update({ last_reconciled_at: at, updated_at: at }).eq('id', budget.id))
  await logEvent(db, budget.id, 'reconciled', `Marked reconciled on ${dateText(today)}.`, actor)
  return { last_reconciled_at: at }
}

// ── Expenses (the Sheet) ────────────────────────────────────────────────────────

// Fields the owner may edit. A closed year is editable too (Owner, 2026-09-27: "allow me to edit
// it"; the prompt's closed-year locks are retired). Every change is logged with its old and new
// values, and leadership and Admin stay read-only.
export const EXPENSE_FIELDS = Object.freeze(['expense_date', 'item', 'category_id', 'description', 'vendor', 'order_number', 'payment_method', 'status', 'quantity', 'amount', 'cohort_id', 'cost_center', 'notes'])
const TEXT_LIMITS = { item: 200, description: 500, vendor: 120, order_number: 80, cost_center: 80, notes: 2000 }
const YMD = /^\d{4}-\d{2}-\d{2}$/

function cleanExpenseField(field, value, categories) {
  if (field in TEXT_LIMITS) return String(value ?? '').trim().slice(0, TEXT_LIMITS[field])
  if (field === 'expense_date') { if (!YMD.test(String(value))) throw new BudgetError('invalid_date', 'Enter a date.'); return String(value) }
  if (field === 'category_id') { if (value == null || value === '') return null; if (!categories.some(c => c.id === value)) throw new BudgetError('invalid_category', 'Choose a category from the list.'); return value }
  if (field === 'payment_method') { if (value == null || value === '') return null; if (!PAYMENT_METHODS.some(p => p.key === value)) throw new BudgetError('invalid_payment', 'Choose a payment method from the list.'); return value }
  if (field === 'status') return value == null || value === '' ? null : String(value)
  if (field === 'quantity') { const n = Number(value); if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new BudgetError('invalid_quantity', 'Quantity must be more than zero.'); return money(n) }
  if (field === 'amount') { const n = Number(String(value ?? '').replace(/[$,\s]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new BudgetError('invalid_amount', 'Enter the amount spent in dollars.'); return money(n) }
  if (field === 'cohort_id') return value == null || value === '' ? null : String(value)
  throw new BudgetError('invalid_field', `${field} cannot be edited.`)
}

/** The year an expense date belongs to, which must have started (a closed year is fine). */
async function openYearFor(db, date, today) {
  const fy = fiscalYearOfDate(date)
  const b = fy && await budgetFor(db, fy)
  const state = yearState(b, fy, today)
  if (state === 'not_started') throw new BudgetError('not_started', `${fyShort(fy)} has not started. Start it before adding its expenses.`, 409)
  return b
}

export async function createExpense(db, actor, { fields = {}, today = pacificToday() }) {
  const categories = await categoriesOf(db)
  const row = { expense_date: today, item: '', quantity: 1, amount: 0, cost_center: DEFAULT_COST_CENTER, source: 'manual' }
  for (const [k, v] of Object.entries(fields)) { if (!EXPENSE_FIELDS.includes(k)) throw new BudgetError('invalid_field', `${k} cannot be set.`); row[k] = cleanExpenseField(k, v, categories) }
  const budget = await openYearFor(db, row.expense_date, today)
  row.status = row.status && statusesFor(row.payment_method).includes(row.status) ? row.status : defaultStatus(row.payment_method)
  const [created] = await q(db.from('budget_expenses').insert({ ...row, budget_id: budget.id, created_by: actor?.id || null }).select(), 'save_failed', 'The expense could not be added.')
  await logChanges(db, 'expense', created.id, budget.id, 'create', [{ new: row }], actor)
  return expenseView(expIn(created), 'owner')
}

export async function updateExpense(db, actor, { id, patch = {}, today = pacificToday() }) {
  const found = (await q(db.from('budget_expenses').select('*').eq('id', id).is('deleted_at', null).limit(1)))[0]
  if (!found) throw new BudgetError('not_found', 'That expense no longer exists.', 404)
  const current = expIn(found)
  const fyOld = fiscalYearOfDate(current.expense_date)
  const categories = await categoriesOf(db)
  const next = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!EXPENSE_FIELDS.includes(k)) throw new BudgetError('invalid_field', `${k} cannot be edited.`)
    next[k] = cleanExpenseField(k, v, categories)
  }
  // A new payment method keeps the status only if it allows it (A2); a status must fit the method.
  const method = 'payment_method' in next ? next.payment_method : current.payment_method
  if ('payment_method' in next && !('status' in next)) next.status = statusAfterPaymentChange(method, current.status)
  if ('status' in next && next.status != null && !statusesFor(method).includes(next.status)) throw new BudgetError('invalid_status', `${statusLabel(next.status) || next.status} is not a status for ${paymentLabel(method) || 'an expense with no payment method'}.`)
  let budgetId = current.budget_id
  if ('expense_date' in next && fiscalYearOfDate(next.expense_date) !== fyOld) budgetId = (await openYearFor(db, next.expense_date, today)).id
  if ('expense_date' in next) next.date_precision = 'day'
  const changes = Object.keys(next).filter(k => String(current[k] ?? '') !== String(next[k] ?? '')).map(k => ({ field: k, old: current[k] ?? null, new: next[k] ?? null }))
  if (!changes.length) return expenseView(current, 'owner')
  const [saved] = await q(db.from('budget_expenses').update({ ...next, budget_id: budgetId, updated_at: new Date().toISOString() }).eq('id', id).select(), 'save_failed', 'The change could not be saved.')
  await logChanges(db, 'expense', id, budgetId, 'update', changes, actor)
  return expenseView(expIn(saved), 'owner')
}

/** Delete rows (soft: a deleted row keeps its history). */
export async function deleteExpenses(db, actor, { ids = [] }) {
  if (!ids.length) return { deleted: 0 }
  const rows = await q(db.from('budget_expenses').select('id, budget_id, expense_date, item, amount').in('id', ids).is('deleted_at', null))
  const at = new Date().toISOString()
  for (const r of rows) {
    await q(db.from('budget_expenses').update({ deleted_at: at }).eq('id', r.id), 'save_failed', 'The rows could not be deleted.')
    await logChanges(db, 'expense', r.id, r.budget_id, 'delete', [{ old: { item: r.item, amount: num(r.amount), expense_date: r.expense_date } }], actor)
  }
  return { deleted: rows.length }
}

/** The Sheet's own formatting and + Column values; merged with what is stored, never replacing it. */
// The Sheet ('expenses') and the Subscriptions sheet ('subscriptions', SUB-CELLS-1) both keep a
// cell's format and a + Column value on the row itself.
export async function saveSheetCells(db, { updates = [], sheet = 'expenses' }) {
  const table = sheet === 'subscriptions' ? 'budget_subscriptions' : 'budget_expenses'
  const byRow = new Map()
  for (const u of updates) { if (!byRow.has(u.rowId)) byRow.set(u.rowId, []); byRow.get(u.rowId).push(u) }
  let rows = []
  if (byRow.size) {
    const { data, error } = await db.from(table).select('id, cell_formats, staff_values').in('id', [...byRow.keys()])
    if (error) {
      if (notEnabled(error) && sheet === 'subscriptions') throw new BudgetError('not_enabled', 'Formatting single cells on the Subscriptions sheet needs its database update (20261011000000_budget_subscription_cells.sql). A whole column\u2019s format is kept already.', 409)
      if (notEnabled(error)) throw new BudgetError('not_enabled', NOT_ENABLED, 409)
      throw new BudgetError('db_failed', 'The Sheet could not be saved.', 500)
    }
    rows = data || []
  }
  for (const r of rows) {
    const formats = { ...(r.cell_formats || {}) }, values = { ...(r.staff_values || {}) }
    for (const u of byRow.get(r.id)) {
      if ('format' in u) { if (u.format) formats[u.key] = u.format; else delete formats[u.key] }
      if ('value' in u) { if (!/^s_[a-z0-9]{4,20}$/.test(u.key)) throw new BudgetError('invalid_field', 'Only your own columns take a typed value here.'); values[u.key] = String(u.value ?? '').slice(0, 500) }
    }
    await q(db.from(table).update({ cell_formats: formats, staff_values: values }).eq('id', r.id), 'save_failed', 'The Sheet could not be saved.')
  }
  return { saved: rows.length }
}
// The Sheet and the Subscriptions sheet each keep one layout; the second is keyed
// 'ASPIRE:subscriptions' in the same table.
export async function saveSheetLayout(db, actor, { layout, sheet = 'expenses' }) {
  if (!layout || typeof layout !== 'object') throw new BudgetError('invalid_layout', 'The Sheet layout is not valid.')
  const json = JSON.stringify(layout)
  if (json.length > 20000) throw new BudgetError('invalid_layout', 'The Sheet layout is too large.')
  await q(db.from('budget_sheet_views').upsert({ program: sheet === 'subscriptions' ? `${PROGRAM}:subscriptions` : PROGRAM, sheet, layout, updated_by: actor?.id || null, updated_at: new Date().toISOString() }, { onConflict: 'program' }), 'save_failed', 'The Sheet layout could not be saved.')
  return { saved: true }
}

// ── Allocations (A8) ────────────────────────────────────────────────────────────

export async function saveAllocations(db, actor, { fy, amounts = {}, publish = false, today = pacificToday() }) {
  const { budget } = await currentBudget(db, fy, today)
  const cats = (await categoriesOf(db)).filter(c => c.is_active)
  const clean = cats.map(c => { const n = Number(amounts[c.id] ?? 0); if (!Number.isFinite(n) || n < 0) throw new BudgetError('invalid_amount', `Enter a dollar amount for ${c.name}.`); return { category_id: c.id, amount: money(n) } })
  const before = new Map((await q(db.from('budget_allocations').select('category_id, amount, saved_amount').eq('budget_id', budget.id))).map(a => [a.category_id, a]))
  const totals = allocationTotals(num(budget.total), clean.map(c => c.amount))
  if (publish && totals.over) throw new BudgetError('over_allocated', `The plan is over the ${fyShort(fy)} budget by ${Math.abs(totals.left).toFixed(2)}. Lower an allocation before saving.`)
  await q(db.from('budget_allocations').upsert(clean.map(c => ({ budget_id: budget.id, ...c, ...(publish ? { saved_amount: c.amount } : { saved_amount: num(before.get(c.category_id)?.saved_amount) }), updated_at: new Date().toISOString() })), { onConflict: 'budget_id,category_id' }), 'save_failed', 'The plan could not be saved.')
  const changed = clean.filter(c => num(before.get(c.category_id)?.amount ?? 0) !== c.amount)
  for (const c of changed) await logChanges(db, 'allocation', c.category_id, budget.id, 'update', [{ field: 'amount', old: num(before.get(c.category_id)?.amount ?? 0), new: c.amount }], actor)
  if (publish) {
    await q(db.from('budgets').update({ plan_saved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', budget.id))
    await logEvent(db, budget.id, 'plan_saved', `Category plan saved: ${clean.filter(c => c.amount > 0).length} categories, $${totals.assigned.toLocaleString('en-US', { minimumFractionDigits: 2 })} assigned.`, actor, null, Object.fromEntries(clean.map(c => [c.category_id, c.amount])))
  }
  return { ...totals, published: publish }
}

// ── Subscriptions (A9) ──────────────────────────────────────────────────────────

export const SUBSCRIPTION_FIELDS = Object.freeze(['name', 'plan', 'vendor', 'billing', 'amount', 'anchor_date', 'start_date', 'end_date', 'payment_method', 'category_id', 'auto_renew', 'notes'])
function cleanSubField(field, value, categories) {
  if (['name', 'plan', 'vendor'].includes(field)) { const t = String(value ?? '').trim().slice(0, 120); if (field === 'name' && !t) throw new BudgetError('invalid_name', 'Name the service.'); return t }
  if (field === 'notes') return String(value ?? '').slice(0, 2000)
  if (field === 'billing') { if (!BILLING.some(b => b.key === value)) throw new BudgetError('invalid_billing', 'Choose Monthly, Annual or Usage-based.'); return value }
  if (field === 'amount') { const n = Number(String(value ?? '').replace(/[$,\s]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new BudgetError('invalid_amount', 'Enter the amount in dollars.'); return money(n) }
  if (['anchor_date', 'start_date'].includes(field)) { if (!YMD.test(String(value))) throw new BudgetError('invalid_date', 'Enter a date.'); return String(value) }
  if (field === 'end_date') { if (value == null || value === '') return null; if (!YMD.test(String(value))) throw new BudgetError('invalid_date', 'Enter a date.'); return String(value) }
  if (field === 'auto_renew') return value === true || value === 'true' || value === 'Yes'
  return cleanExpenseField(field, value, categories)
}
const subRow = async (db, id) => {
  const s = (await q(db.from('budget_subscriptions').select('*').eq('id', id).is('deleted_at', null).limit(1)))[0]
  if (!s) throw new BudgetError('not_found', 'That subscription no longer exists.', 404)
  return subIn(s)
}

export async function createSubscription(db, actor, { fields = {}, today = pacificToday() }) {
  const categories = await categoriesOf(db)
  const row = { name: 'New subscription', billing: 'monthly', amount: 0, anchor_date: today, start_date: today, auto_renew: true }
  for (const [k, v] of Object.entries(fields)) { if (!SUBSCRIPTION_FIELDS.includes(k)) throw new BudgetError('invalid_field', `${k} cannot be set.`); row[k] = cleanSubField(k, v, categories) }
  if (row.end_date && row.end_date < row.start_date) throw new BudgetError('invalid_date', 'The end date is before the start date.')
  const [created] = await q(db.from('budget_subscriptions').insert({ ...row, program: PROGRAM, created_by: actor?.id || null }).select(), 'save_failed', 'The subscription could not be added.')
  await logChanges(db, 'subscription', created.id, null, 'create', [{ new: row }], actor)
  await postDueCharges(db, { today })
  return created
}

export async function updateSubscription(db, actor, { id, patch = {}, today = pacificToday() }) {
  const current = await subRow(db, id)
  const categories = await categoriesOf(db)
  const next = {}
  for (const [k, v] of Object.entries(patch)) { if (!SUBSCRIPTION_FIELDS.includes(k)) throw new BudgetError('invalid_field', `${k} cannot be edited.`); next[k] = cleanSubField(k, v, categories) }
  const merged = { ...current, ...next }
  if (merged.end_date && merged.end_date < merged.start_date) throw new BudgetError('invalid_date', 'The end date is before the start date.')
  const changes = Object.keys(next).filter(k => String(current[k] ?? '') !== String(next[k] ?? '')).map(k => ({ field: k, old: current[k] ?? null, new: next[k] ?? null }))
  if (!changes.length) return current
  const [saved] = await q(db.from('budget_subscriptions').update({ ...next, updated_at: new Date().toISOString() }).eq('id', id).select(), 'save_failed', 'The change could not be saved.')
  await logChanges(db, 'subscription', id, null, 'update', changes, actor)
  await postDueCharges(db, { today })
  return saved
}

export async function deleteSubscription(db, actor, { id }) {
  const current = await subRow(db, id)
  await q(db.from('budget_subscriptions').update({ deleted_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The subscription could not be removed.')
  await logChanges(db, 'subscription', id, null, 'delete', [{ old: { name: current.name, amount: current.amount } }], actor)
  return { deleted: true }
}

/** Renewals to decide: Keep, Cancel at renewal, or Remind me in 7 days. */
export async function decideRenewal(db, actor, { id, decision, today = pacificToday() }) {
  const s = await subRow(db, id)
  let patch
  if (decision === 'keep') { const n = nextCharge(s, today); patch = { renewal_kept_for: n, renewal_remind_after: null } }
  else if (decision === 'cancel') { patch = cancelAtRenewal(s, today); if (!patch) throw new BudgetError('no_renewal', 'This plan has no renewal coming.') }
  else if (decision === 'remind') patch = { renewal_remind_after: addDays(today, REMIND_AFTER_DAYS) }
  else throw new BudgetError('invalid_decision', 'Choose Keep, Cancel at renewal or Remind me.')
  await q(db.from('budget_subscriptions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The decision could not be saved.')
  await logChanges(db, 'subscription', id, null, 'update', Object.entries(patch).map(([k, v]) => ({ field: k, old: s[k] ?? null, new: v })), actor)
  return decision === 'cancel' ? { ...patch, message: `${s.name} ends ${dateText(patch.end_date)}. Cancel it with the vendor too.` } : patch
}

/**
 * SUB-APPROVAL-1: the owner decides a proposed subscription. 'from_year_start' approves it and
 * counts every charge since the start of the fiscal year it is decided in (July 1); 'from_today'
 * counts from today; 'decline' keeps it for the record and counts nothing. Approval posts any
 * charge already due at once.
 */
export async function decideProposal(db, actor, { id, decision, today = pacificToday() }) {
  const s = await subRow(db, id)
  if (!isProposed(s)) throw new BudgetError('not_proposed', `${s.name} is not awaiting approval.`, 409)
  const fyStart = fiscalYearRange(currentFiscalYear(new Date(`${today}T12:00:00-07:00`))).start
  let patch
  if (decision === 'from_year_start') patch = { approval_state: APPROVAL.approved, approved_at: new Date().toISOString(), post_from: fyStart }
  else if (decision === 'from_today') patch = { approval_state: APPROVAL.approved, approved_at: new Date().toISOString(), post_from: today }
  else if (decision === 'decline') patch = { approval_state: APPROVAL.declined }
  else throw new BudgetError('invalid_decision', 'Choose Approve from July 1, Approve from today, or Decline.')
  const { error } = await db.from('budget_subscriptions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) {
    if (notEnabled(error)) throw new BudgetError('not_enabled', 'Approving a subscription needs its database update (20261010000000_budget_subscription_approval.sql).', 409)
    throw new BudgetError('save_failed', 'The decision could not be saved.', 500)
  }
  await logChanges(db, 'subscription', id, null, 'update', Object.entries(patch).filter(([k]) => k !== 'approved_at').map(([k, v]) => ({ field: k, old: s[k] ?? null, new: v })), actor)
  const posted = decision === 'decline' ? 0 : (await postDueCharges(db, { today })).posted
  const when = decision === 'from_year_start' ? `from ${dateText(fyStart)}` : `from ${dateText(today)}`
  return { ...patch, posted, message: decision === 'decline' ? `${s.name} declined. It stays on file and counts against nothing.` : `${s.name} approved ${when}.${posted ? ` ${posted} ${posted === 1 ? 'charge' : 'charges'} posted to the Sheet.` : ''}` }
}

/**
 * AC-RENEW-1: the renewals the owner has to decide, for the Action Center's Program Budget group.
 * The same rule as the Subscriptions tab's list (renewalsToDecide): approved annual plans renewing
 * within 45 days, not kept, not snoozed with Remind me.
 */
export async function listRenewals(db, { today = pacificToday() } = {}) {
  return renewalsToDecide(await subscriptionsOf(db), today).map(r => ({
    id: r.sub.id, name: r.sub.name, plan: r.sub.plan, amount: r.sub.amount, paymentLabel: paymentLabel(r.sub.payment_method),
    auto_renew: r.sub.auto_renew, date: r.renewal.date, days: r.renewal.days,
  }))
}

// ── Posting subscription charges ───────────────────────────────────────────────

// A year that closed in the last few days still takes its final charges, in case the daily run
// missed June 30. Older closed years are never written.
const POST_GRACE_DAYS = 3

/**
 * Post every subscription charge that is due and not yet a row (A9). Safe to run any number of
 * times: the unique index on (subscription_id, charge_date) refuses a second row, and a charge
 * the owner deleted stays deleted (the deleted row still holds its date).
 */
export async function postDueCharges(db, { today = pacificToday() } = {}) {
  const budgets = await q(db.from('budgets').select('id, fiscal_year, started_at').eq('program', PROGRAM))
  const started = budgets.filter(b => {
    if (!b.started_at) return false
    const r = fiscalYearRange(b.fiscal_year)
    return r && r.start <= today && addDays(r.end, POST_GRACE_DAYS) >= today
  })
  if (!started.length) return { posted: 0 }
  const idOf = new Map(started.map(b => [b.fiscal_year, b.id]))
  const subs = await subscriptionsOf(db)
  let posted = 0
  for (const s of subs) {
    const done = new Set((await q(db.from('budget_expenses').select('charge_date').eq('subscription_id', s.id))).map(r => ymd(r.charge_date)))
    for (const c of chargesToPost(s, [...idOf.keys()], done, today)) {
      const row = { ...chargeExpense(s, c.date), budget_id: idOf.get(c.fiscal_year), cost_center: DEFAULT_COST_CENTER }
      const { data, error } = await db.from('budget_expenses').insert(row).select('id')
      if (error) { if (error.code === '23505') continue; if (notEnabled(error)) throw new BudgetError('not_enabled', NOT_ENABLED, 409); throw new BudgetError('post_failed', 'A subscription charge could not be posted.', 500) }
      await logChanges(db, 'expense', data[0].id, row.budget_id, 'post', [{ new: { subscription: s.name, charge_date: c.date, amount: row.amount } }], null)
      posted++
    }
  }
  return { posted }
}

// ── Export to Excel (A7): Expense Report and Annual Budget Tracker ───────────────

const CURRENCY = '"$"#,##0.00'
export async function exportYear(db, { fy, viewer = 'reader', today = pacificToday() }) {
  const y = await loadYear(db, { fy, viewer, today })
  const catName = new Map(y.categories.map(c => [c.id, c.name]))
  const cohortName = new Map(y.cohorts.map(c => [c.id, c.name]))
  const header = ['Date', 'Item', 'Category', 'Brief Description', 'Vendor', 'Order or Invoice No.', 'Payment', 'Quantity', 'Unit Cost ($)', 'Spent ($)', 'Status', 'Receipt', 'Cohort', 'Cost Center', 'Notes']
  const money$ = (n) => (n == null ? '' : { n, f: { nf: CURRENCY } })
  const rows = y.expenses.map(e => [e.dateText, e.item, catName.get(e.category_id) || '', e.description, e.vendor, e.order_number, e.paymentLabel, { n: e.quantity }, money$(e.unitCost), money$(e.amount), e.statusLabel, e.hasReceipt ? 'On file' : '', cohortName.get(e.cohort_id) || '', e.cost_center, e.notes])
  const counted = y.expenses.filter(e => e.status !== 'void')
  const trackerHeader = ['Category', ...FY_MONTHS, 'Spent ($)', 'Annual Allocated Budget ($)', 'Remaining Budget ($)']
  const allocated = new Map(y.allocations.map(a => [a.category_id, viewer === 'owner' ? a.amount : a.saved_amount]))
  const hasPlan = [...allocated.values()].some(v => v > 0)
  const tracker = y.categories.map(c => {
    const byM = FY_MONTHS.map(m => money(counted.filter(e => e.category_id === c.id && monthOf(e.expense_date) === m).reduce((a, e) => a + e.amount, 0)))
    const spent = money(byM.reduce((a, b) => a + b, 0))
    const al = hasPlan ? (allocated.get(c.id) || 0) : null
    return [c.name, ...byM.map(v => money$(v)), money$(spent), al == null ? '' : money$(al), al == null ? '' : money$(money(al - spent))]
  })
  const monthTotals = FY_MONTHS.map(m => money(counted.filter(e => monthOf(e.expense_date) === m).reduce((a, e) => a + e.amount, 0)))
  tracker.push(Object.assign(['Total', ...monthTotals.map(money$), money$(y.summary.spent), money$(y.summary.total), money$(y.summary.remaining)], { summary: true }))
  const bytes = xlsxBook([
    { sheetName: 'Expense Report', header, rows, widths: [110, 220, 170, 280, 120, 170, 140, 80, 100, 100, 100, 80, 140, 140, 240] },
    { sheetName: 'Annual Budget Tracker', header: trackerHeader, rows: tracker, widths: [190, ...FY_MONTHS.map(() => 80), 100, 150, 150] },
  ])
  return { bytes, fileName: `ASPIRE Budget ${fyShort(fy)}.xlsx` }
}

export { counts, currentFiscalYear, fyShort, pacificToday }
