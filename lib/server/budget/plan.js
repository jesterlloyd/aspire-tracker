// lib/server/budget/plan.js
//
// BUDGET-V2 Phase 3 (2026-09-29): the plan stage, the server side. Reference: the Plan tab, Margo's
// review and the within-plan check in docs/mockups/program-budget-v2.html. The rules are
// src/lib/budget/planModel.js; this file reads, checks and writes.
//
//   withPlan         adds the Plan tab's data (and next year's proposal line) to a loaded year.
//   startProposal    a year's first plan, v1 draft, with the subscriptions carried forward.
//   savePlanDraft    the draft's note and items, as the owner types.
//   submitPlan       freezes the version and puts it in front of Margo.
//   decidePlan       Margo: approve (with changes), or send back with a comment (a new draft version).
//   revisePlan       the owner reopens an approved plan as a new draft version.
//   requestProposal  Margo asks for next year's proposal.
//   movePlan, requestAmendment, decideAmendment   the within-plan check's two paths.
//   planPdf          the request, for Cedars-Sinai's official budget process.
//   autoStartApproved  on July 1 an approved proposal becomes the year's plan and total.
//
// Who does what: the owner drafts, submits, moves and asks; a Leadership grant with budget_access
// 'approve' decides; everyone else reads a plan once it is no longer a draft. Never a draft to a reader.

import { randomUUID } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { BudgetError, notEnabled, startYear, internals as I } from './engine.js'
import {
  PROGRAM, fyShort, fiscalYearRange, currentFiscalYear, pacificToday, yearState, isStarted, counts, usd, dateText,
  isApproved, isProposed, monthlyEquivalent,
} from '../../../src/lib/budget/budgetModel.js'
import { PLAN_STATUS, PLATFORM, DEFAULT_LIMITS, itemAmount, planTotals, effectivePlan, moveLimit, STATUS_TEXT } from '../../../src/lib/budget/planModel.js'

const NOT_ENABLED = 'The plan needs its database update (20261023000000_budget_v2_phase3.sql).'
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLATFORM_CATEGORY = 'Technology & Software'

async function r(query, code = 'db_failed', message = 'The plan could not be read.') {
  const { data, error } = await query
  if (error) { if (notEnabled(error)) throw new BudgetError('not_enabled', NOT_ENABLED, 409); throw new BudgetError(code, message, 500) }
  return data
}
const iso = () => new Date().toISOString()
/** A timestamp as its Pacific day, "Sep 29, 2026" (the app's days are Pacific). */
const pacificDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })
const fyOfToday = (today) => currentFiscalYear(new Date(`${today}T12:00:00-07:00`))

export async function plansEnabled(db) {
  const { error } = await db.from('budget_plans').select('id').limit(1)
  return !error
}

/** The move limit the owner agreed with Margo. Before the update, the defaults. */
export async function limitsOf(db) {
  const { data, error } = await db.from('budget_settings').select('move_limit_pct, move_limit_cap').eq('program', PROGRAM).limit(1)
  const row = error ? null : data?.[0]
  return { pct: row?.move_limit_pct != null ? Number(row.move_limit_pct) : DEFAULT_LIMITS.pct, cap: row?.move_limit_cap != null ? Number(row.move_limit_cap) : DEFAULT_LIMITS.cap }
}

const planRow = (p) => ({ ...p, version: Number(p.version) })
async function versionsOf(db, budgetId) {
  if (!budgetId) return []
  return (await r(db.from('budget_plans').select('*').eq('budget_id', budgetId).order('version', { ascending: false }))).map(planRow)
}
async function planById(db, id) {
  if (!UUID.test(String(id || ''))) throw new BudgetError('not_found', 'That plan no longer exists.', 404)
  const p = (await r(db.from('budget_plans').select('*').eq('id', id).limit(1)))[0]
  if (!p) throw new BudgetError('not_found', 'That plan no longer exists.', 404)
  const b = (await I.q(db.from('budgets').select('*').eq('id', p.budget_id).limit(1)))[0]
  return { plan: planRow(p), budget: b }
}
const itemsOf = async (db, planId) => (await r(db.from('budget_plan_items').select('*').eq('plan_id', planId).order('sort_order'))).map(i => ({ ...i, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) }))
const catsOf = async (db, planId) => (await r(db.from('budget_plan_categories').select('*').eq('plan_id', planId))).map(c => ({ ...c, requested: Number(c.requested), approved: c.approved == null ? null : Number(c.approved) }))

/**
 * The approved plan a year runs on, or null: the latest approved version, its approved totals, the
 * moves and amendments against it, and the effective totals they make.
 */
export async function approvedPlanFor(db, budgetId) {
  if (!budgetId) return null
  const { data, error } = await db.from('budget_plans').select('*').eq('budget_id', budgetId).eq('status', 'approved').order('version', { ascending: false }).limit(1)
  if (error || !data?.[0]) return null
  const plan = planRow(data[0])
  const [cats, moves, amendments] = await Promise.all([   // RECEIPTS-SPEED-1: three reads, one wait
    catsOf(db, plan.id),
    r(db.from('budget_plan_moves').select('*').eq('plan_id', plan.id).order('created_at')),
    r(db.from('budget_amendments').select('*').eq('plan_id', plan.id).order('requested_at')),
  ])
  const approved = new Map(cats.map(c => [c.category_id, c.approved ?? c.requested]))
  return { plan, approved, moves, amendments, effective: effectivePlan(approved, { moves, amendments }) }
}

/** Spent per category in a budget's counted rows. */
const spentOf = (expenses) => {
  const m = new Map()
  for (const e of expenses.filter(counts)) if (e.category_id) m.set(e.category_id, round2((m.get(e.category_id) || 0) + Number(e.amount || 0)))
  return m
}
const namesOf = async (db, ids) => {
  const list = [...new Set(ids.filter(Boolean))]
  return new Map(list.length ? (await I.q(db.from('user_profiles').select('id, full_name').in('id', list))).map(p => [p.id, p.full_name]) : [])
}

/**
 * The Plan tab's data, added to a loaded year. `approver` is a Leadership grant with 'approve'.
 * Also the quiet line on the current year's Summary about next year's proposal.
 */
export async function withPlan(db, year, { viewer = 'reader', approver = false, today = pacificToday() } = {}) {
  // BUDGET-LOAD-SPEED-1 (Owner, 2026-09-30): the year arrives from loadYear with its budget, categories
  // and expenses, so they are not read again, and the rest goes out in waves instead of one at a time.
  const fy = year.fy
  const owner = viewer === 'owner'
  const budget = year.budget || null
  const curFy = fyOfToday(today)
  const current_ = year.state === 'current'
  const eventsOf = (q) => (budget ? I.q(q) : [])
  const [enabled, prior1b, prior2b, nextb, curNextb, limits, events, asks] = await Promise.all([
    plansEnabled(db),
    I.budgetFor(db, fy - 1), I.budgetFor(db, fy - 2),
    current_ ? I.budgetFor(db, fy + 1) : null,
    fy + 1 === curFy + 1 && current_ ? null : I.budgetFor(db, curFy + 1),
    limitsOf(db),
    eventsOf(db.from('budget_events').select('kind, message, actor_name, created_at').eq('budget_id', budget?.id).order('created_at', { ascending: false })),
    current_ ? eventsOf(db.from('budget_events').select('actor_name, created_at').eq('budget_id', budget?.id).eq('kind', 'proposal_requested').order('created_at', { ascending: false }).limit(1)) : [],
  ])
  if (!enabled) return { ...year, plan: { enabled: false }, next: null, canApprove: false }
  const curNext = curNextb || nextb   // next year's budget, whichever read found it
  const [all, prior1Rows, prior2Rows, live, nv, nextVersions] = await Promise.all([
    versionsOf(db, budget?.id),
    prior1b ? I.expensesOf(db, prior1b.id) : [],
    prior2b ? I.expensesOf(db, prior2b.id) : [],
    approvedPlanFor(db, budget?.id),
    current_ ? versionsOf(db, nextb?.id) : [],
    versionsOf(db, curNext?.id),
  ])
  const visible = owner ? all : all.filter(p => p.status !== PLAN_STATUS.draft)
  const current = visible[0] || null
  const categories = year.categories || []   // loadYear's: the active ones
  const prior1 = spentOf(prior1Rows), prior2 = spentOf(prior2Rows)
  const priorBudget = prior1b
  const spent = spentOf(year.expenses || [])

  let plan = null
  if (current) {
    const [items, pcats, people] = await Promise.all([itemsOf(db, current.id), catsOf(db, current.id), namesOf(db, [current.submitted_by, current.decided_by])])
    const totals = planTotals(items)
    const eff = live && live.plan.id === current.id ? live.effective : null
    plan = {
      id: current.id, version: current.version, status: current.status, statusText: STATUS_TEXT[current.status], note: current.note, comment: current.comment,
      submitted_at: current.submitted_at, submitted_by: people.get(current.submitted_by) || '', decided_at: current.decided_at, decided_by: people.get(current.decided_by) || '',
      items: items.map(i => ({ id: i.id, category_id: i.category_id, name: i.name, quantity: i.quantity, unit_cost: i.unit_cost, amount: itemAmount(i), reason: i.reason, tag: i.tag, provenance_id: owner ? i.provenance_id : null })),
      categories: categories.map(c => {
        const pc = pcats.find(x => x.category_id === c.id)
        return {
          id: c.id, name: c.name, prior2: prior2.get(c.id) || 0, prior1: prior1.get(c.id) || 0, spent: spent.get(c.id) || 0,
          requested: current.status === PLAN_STATUS.draft ? (totals.byCategory.get(c.id) || 0) : (pc?.requested || 0),
          approved: pc?.approved ?? null, effective: eff ? (eff.get(c.id) ?? null) : null,
        }
      }),
      total: current.status === PLAN_STATUS.draft ? totals.total : round2(pcats.reduce((a, c) => a + c.requested, 0)),
      approvedTotal: current.status === PLAN_STATUS.approved ? round2(pcats.reduce((a, c) => a + (c.approved ?? c.requested), 0)) : null,
      platform: totals.platform, platformShare: totals.platformShare,
    }
  }
  // The earlier versions and every plan event, for Plan history.
  const history = events.filter(e => /^(proposal_|plan_|amendment_)/.test(e.kind))
  const amendments = live ? live.amendments.map(a => ({ id: a.id, category_id: a.category_id, amount: Number(a.amount), reason: a.reason, status: a.status, comment: a.comment, requested_at: a.requested_at, decided_at: a.decided_at, expense_id: a.expense_id, receipt_id: a.receipt_id })) : []
  const moves = live ? live.moves.map(m => ({ id: m.id, from_category_id: m.from_category_id, to_category_id: m.to_category_id, amount: Number(m.amount), reason: m.reason, created_at: m.created_at })) : []

  // Next year's proposal line on the current year's Summary.
  let next = null
  if (current_) {
    const nvisible = owner ? nv : nv.filter(p => p.status !== PLAN_STATUS.draft)
    const ask = asks[0] || null
    next = { fy: fy + 1, plan: nvisible[0] ? { status: nvisible[0].status, version: nvisible[0].version } : null, requested: !!ask, requestedBy: ask?.actor_name?.split(' ')[0] || '' }
  }

  // The fiscal year menu lists next year as a Proposal: always for the owner, for everyone else once
  // a version has been submitted.
  const showNext = owner || nextVersions.some(p => p.status !== PLAN_STATUS.draft)
  const years = [...new Set([...(showNext ? [curFy + 1] : []), ...(year.years || []).filter(y => y !== curFy + 1 || showNext)])].sort((a, b) => b - a)

  return {
    ...year, years,
    plan: {
      enabled: true, current: plan, versions: visible.map(p => ({ id: p.id, version: p.version, status: p.status, submitted_at: p.submitted_at, decided_at: p.decided_at, comment: p.comment })),
      history, amendments, moves, limits,
      // The approved plan the year runs on (the current version may be a revision still in draft).
      live: live ? { planId: live.plan.id, version: live.plan.version, effective: Object.fromEntries(live.effective), approved: Object.fromEntries(live.approved) } : null,
      priorBudget: priorBudget ? Number(priorBudget.total) : null, priorActual: round2([...prior1.values()].reduce((a, b) => a + b, 0)),
      canStart: owner && !current && (year.state === 'proposal' || isStarted(year.state) || year.state === 'not_started'),
    },
    next, canApprove: !!approver,
  }
}

// ── Drafting (the owner) ────────────────────────────────────────────────────────

/** The items a year's subscriptions carry forward: each plan at its current price, tagged Platform. */
async function carriedItems(db, categories) {
  const tech = categories.find(c => c.name === PLATFORM_CATEGORY)
  const subs = (await I.subscriptionsOf(db)).filter(s => (isApproved(s) || isProposed(s)) && s.approval_state !== 'declined' && !s.end_date)
  return subs.map((s, i) => {
    const annual = s.billing === 'annual'
    return {
      category_id: s.category_id || tech?.id, name: `${s.name}${s.plan ? `, ${s.plan}` : ''}`, quantity: annual ? 1 : 12, unit_cost: round2(annual ? Number(s.amount) : monthlyEquivalent(s)),
      reason: `Carried forward from Subscriptions at the current plan${s.billing === 'usage' ? ' (usage-based, an estimate)' : ''}.`, tag: PLATFORM, sort_order: i,
    }
  }).filter(i => i.category_id)
}

/** Start a year's plan: v1, a draft, with the subscriptions carried forward as items. */
export async function startProposal(db, actor, { fy, today = pacificToday() }) {
  const r0 = fiscalYearRange(fy)
  if (!r0 || today > r0.end) throw new BudgetError('invalid_year', 'That fiscal year has ended.')
  if (fy > fyOfToday(today) + 1) throw new BudgetError('invalid_year', 'Only next year can be proposed.')
  if (!(await plansEnabled(db))) throw new BudgetError('not_enabled', NOT_ENABLED, 409)
  let budget = await I.budgetFor(db, fy)
  if (!budget) budget = (await I.q(db.from('budgets').insert({ program: PROGRAM, fiscal_year: fy, total: 0, created_by: actor?.id || null }).select(), 'save_failed', 'The proposal could not be started.'))[0]
  if ((await versionsOf(db, budget.id)).length) throw new BudgetError('already_started', `The ${fyShort(fy)} plan has already started.`, 409)
  const [plan] = await r(db.from('budget_plans').insert({ budget_id: budget.id, version: 1, status: PLAN_STATUS.draft }).select(), 'save_failed', 'The proposal could not be started.')
  const categories = (await I.categoriesOf(db)).filter(c => c.is_active)
  // A running year's saved allocations come with it, one item per category, so nothing is retyped.
  const allocs = budget.started_at ? (await I.q(db.from('budget_allocations').select('category_id, saved_amount').eq('budget_id', budget.id))).filter(a => Number(a.saved_amount) > 0) : []
  const carried = await carriedItems(db, categories)
  const items = [
    ...allocs.map((a, n) => ({ category_id: a.category_id, name: 'Category allocation', quantity: 1, unit_cost: round2(Number(a.saved_amount)), reason: `From the saved ${fyShort(fy)} allocations.`, tag: null, sort_order: n })),
    ...carried.map((i, n) => ({ ...i, sort_order: allocs.length + n })),
  ]
  if (items.length) await r(db.from('budget_plan_items').insert(items.map(i => ({ ...i, plan_id: plan.id }))), 'save_failed', 'The subscriptions could not be carried forward.')
  await I.logEvent(db, budget.id, 'proposal_started', `${fyShort(fy)} ${yearState(budget, fy, today) === 'proposal' ? 'proposal' : 'plan'} started (v1)${items.length ? `, with ${items.length} ${items.length === 1 ? 'subscription' : 'subscriptions'} carried forward` : ''}.`, actor)
  return { plan: planRow(plan), carried: items.length, message: `${fyShort(fy)} plan started. ${items.length ? `${items.length} ${items.length === 1 ? 'subscription is' : 'subscriptions are'} carried forward, tagged Platform.` : ''}`.trim() }
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? round2(n) : 0 }

/** Save the draft: its note and the whole list of items. Only a draft changes. */
export async function savePlanDraft(db, actor, { planId, note, items }) {
  const { plan } = await planById(db, planId)
  if (plan.status !== PLAN_STATUS.draft) throw new BudgetError('not_draft', `v${plan.version} is ${STATUS_TEXT[plan.status].toLowerCase()} and no longer changes. ${plan.status === PLAN_STATUS.approved ? 'Start a revision to change it.' : ''}`.trim(), 409)
  const cats = new Set((await I.categoriesOf(db)).filter(c => c.is_active).map(c => c.id))
  if (note != null) await r(db.from('budget_plans').update({ note: String(note).slice(0, 4000), updated_at: iso() }).eq('id', plan.id), 'save_failed', 'The note could not be saved.')
  if (Array.isArray(items)) {
    if (items.length > 300) throw new BudgetError('too_many', 'A plan holds up to 300 items.')
    const clean = items.map((i, n) => {
      if (!cats.has(i?.category_id)) throw new BudgetError('invalid_category', 'Choose a category from the list.')
      return { plan_id: plan.id, category_id: i.category_id, name: clip(i.name, 200), quantity: num(i.quantity), unit_cost: num(i.unit_cost), reason: clip(i.reason, 500), tag: i.tag === PLATFORM ? PLATFORM : null, provenance_id: UUID.test(String(i.provenance_id || '')) ? i.provenance_id : null, sort_order: n }
    })
    await r(db.from('budget_plan_items').delete().eq('plan_id', plan.id), 'save_failed', 'The items could not be saved.')
    if (clean.length) await r(db.from('budget_plan_items').insert(clean), 'save_failed', 'The items could not be saved.')
  }
  return { saved: true }
}

/** Submit to Margo: the version freezes, its category totals are recorded, and she sees it. */
export async function submitPlan(db, actor, { planId }) {
  const { plan, budget } = await planById(db, planId)
  if (plan.status !== PLAN_STATUS.draft) throw new BudgetError('not_draft', `v${plan.version} has already been submitted.`, 409)
  const items = await itemsOf(db, plan.id)
  const totals = planTotals(items)
  if (!totals.total) throw new BudgetError('empty_plan', 'Add at least one item with an amount before submitting.')
  if (!String(plan.note || '').trim()) throw new BudgetError('no_note', 'Write "Why this budget" first. Margo reads it first.')
  await r(db.from('budget_plan_categories').delete().eq('plan_id', plan.id))
  await r(db.from('budget_plan_categories').insert([...totals.byCategory].map(([category_id, requested]) => ({ plan_id: plan.id, category_id, requested }))), 'save_failed', 'The plan could not be submitted.')
  await r(db.from('budget_plans').update({ status: PLAN_STATUS.submitted, submitted_at: iso(), submitted_by: actor?.id || null, updated_at: iso() }).eq('id', plan.id), 'save_failed', 'The plan could not be submitted.')
  await I.logEvent(db, budget.id, 'plan_submitted', `${fyShort(budget.fiscal_year)} plan v${plan.version} submitted to Margo: ${usd(totals.total)} across ${totals.byCategory.size} ${totals.byCategory.size === 1 ? 'category' : 'categories'}.`, actor, null, { plan: plan.id, total: totals.total })
  return { submitted: true, message: `v${plan.version} submitted to Margo. It no longer changes; she sees it in the Leadership Portal.` }
}

/** A new draft version, copied from `from` (its note and items), for a send-back or a revision. */
async function nextDraft(db, from) {
  const [draft] = await r(db.from('budget_plans').insert({ budget_id: from.budget_id, version: from.version + 1, status: PLAN_STATUS.draft, note: from.note }).select(), 'save_failed', 'The next version could not be opened.')
  const items = await itemsOf(db, from.id)
  if (items.length) await r(db.from('budget_plan_items').insert(items.map(i => ({ plan_id: draft.id, category_id: i.category_id, name: i.name, quantity: i.quantity, unit_cost: i.unit_cost, reason: i.reason, tag: i.tag, provenance_id: i.provenance_id, sort_order: i.sort_order }))), 'save_failed', 'The next version could not be opened.')
  return planRow(draft)
}

/**
 * Margo decides a submitted version. 'approve' takes her approved total per category (each defaults to
 * what was requested; any change makes it "approved with changes"). 'send_back' keeps her comment and
 * opens the next version as a draft. A year already running takes the approved totals as its plan.
 */
export async function decidePlan(db, actor, { planId, decision, approved = {}, comment = '' }) {
  const { plan, budget } = await planById(db, planId)
  if (plan.status !== PLAN_STATUS.submitted) throw new BudgetError('not_submitted', `v${plan.version} is not waiting for a decision.`, 409)
  const text = String(comment || '').trim().slice(0, 2000)
  const label = `${fyShort(budget.fiscal_year)} plan v${plan.version}`
  if (decision === 'send_back') {
    await r(db.from('budget_plans').update({ status: PLAN_STATUS.sent_back, comment: text, decided_by: actor?.id || null, decided_at: iso(), updated_at: iso() }).eq('id', plan.id), 'save_failed', 'The plan could not be sent back.')
    const draft = await nextDraft(db, plan)
    await I.logEvent(db, budget.id, 'plan_sent_back', `${label} sent back for revision${text ? `: ${text}` : '.'} v${draft.version} is open.`, actor, null, { plan: plan.id })
    return { sent_back: true, message: `Sent back. The owner revises it as v${draft.version}.` }
  }
  if (decision !== 'approve') throw new BudgetError('invalid_decision', 'Choose Approve or Send back.')
  const cats = await catsOf(db, plan.id)
  let changed = 0
  for (const c of cats) {
    const raw = approved?.[c.category_id]
    const v = raw == null || raw === '' ? c.requested : num(raw)
    if (round2(v) !== round2(c.requested)) changed++
    await r(db.from('budget_plan_categories').update({ approved: v }).eq('plan_id', plan.id).eq('category_id', c.category_id), 'save_failed', 'The decision could not be saved.')
  }
  await r(db.from('budget_plans').update({ status: PLAN_STATUS.approved, comment: text, decided_by: actor?.id || null, decided_at: iso(), updated_at: iso() }).eq('id', plan.id), 'save_failed', 'The decision could not be saved.')
  const after = await catsOf(db, plan.id)
  const total = round2(after.reduce((a, c) => a + (c.approved ?? c.requested), 0))
  const requested = round2(after.reduce((a, c) => a + c.requested, 0))
  await I.logEvent(db, budget.id, 'plan_approved', `${label} approved${changed ? ` with changes to ${changed} ${changed === 1 ? 'category' : 'categories'}: ${usd(total)} of ${usd(requested)} requested` : `: ${usd(total)}`}${text ? `. ${text}` : '.'}`, actor, null, { plan: plan.id, total })
  if (budget.started_at) await applyToYear(db, budget, after)
  return { approved: true, changed, total, message: changed ? `Approved with changes: ${usd(total)}.` : `Approved: ${usd(total)}.` }
}

/** A running year's category plan is its approved totals (Summary's By category reads them). */
async function applyToYear(db, budget, cats) {
  const at = iso()
  if (cats.length) await I.q(db.from('budget_allocations').upsert(cats.map(c => ({ budget_id: budget.id, category_id: c.category_id, amount: c.approved ?? c.requested, saved_amount: c.approved ?? c.requested, updated_at: at })), { onConflict: 'budget_id,category_id' }))
  await I.q(db.from('budgets').update({ plan_saved_at: at, updated_at: at }).eq('id', budget.id))
}

/** Reopen an approved plan as the next draft version. The approved one runs until the next is approved. */
export async function revisePlan(db, actor, { planId }) {
  const { plan, budget } = await planById(db, planId)
  if (plan.status !== PLAN_STATUS.approved) throw new BudgetError('not_approved', 'Only an approved plan is revised.', 409)
  const all = await versionsOf(db, budget.id)
  if (all[0].version !== plan.version) throw new BudgetError('newer_version', `v${all[0].version} is already open.`, 409)
  const draft = await nextDraft(db, plan)
  await I.logEvent(db, budget.id, 'proposal_started', `${fyShort(budget.fiscal_year)} plan v${draft.version} opened as a revision of v${plan.version}.`, actor)
  return { plan: draft, message: `v${draft.version} is open. v${plan.version} stays approved until Margo approves the revision.` }
}

/** Margo asks for next year's proposal; the owner's Summary says so. */
export async function requestProposal(db, actor, { today = pacificToday() }) {
  const fy = fyOfToday(today)
  const b = await I.budgetFor(db, fy)
  if (!b?.started_at) throw new BudgetError('not_started', `${fyShort(fy)} has not started.`, 409)
  const nb = await I.budgetFor(db, fy + 1)
  if ((await versionsOf(db, nb?.id)).length) throw new BudgetError('already_started', `The ${fyShort(fy + 1)} proposal has already started.`, 409)
  await I.logEvent(db, b.id, 'proposal_requested', `${actor?.full_name || 'Leadership'} asked for the ${fyShort(fy + 1)} proposal.`, actor)
  return { requested: true, message: `Asked for the ${fyShort(fy + 1)} proposal.` }
}

// ── The within-plan check's two paths (item 16) ─────────────────────────────────

async function livePlan(db, fy) {
  const budget = await I.budgetFor(db, fy)
  const live = await approvedPlanFor(db, budget?.id)
  if (!live) throw new BudgetError('no_plan', `${fyShort(fy)} has no approved category plan.`, 409)
  const spent = spentOf(await I.expensesOf(db, budget.id))
  const names = new Map((await I.categoriesOf(db)).map(c => [c.id, c.name]))
  return { budget, live, spent, names }
}

/** Move money between categories, inside the owner's limit and the source's room. Logged. */
export async function movePlan(db, actor, { fy, from, to, amount, reason = '', expenseId = null, receiptId = null }) {
  const { budget, live, spent, names } = await livePlan(db, fy)
  const a = round2(amount)
  if (!(a > 0)) throw new BudgetError('invalid_amount', 'Enter the amount to move.')
  if (from === to || !live.effective.has(to) && !live.approved.has(to)) throw new BudgetError('invalid_category', 'Choose two different categories in the plan.')
  const limits = await limitsOf(db)
  const limit = moveLimit(live.approved.get(to) || 0, limits)
  if (a > limit) throw new BudgetError('over_limit', `${usd(a)} is over your limit of ${usd(limit)} for ${names.get(to)} (${limits.pct}% of its approved total, up to ${usd(limits.cap)}). Ask Margo for an amendment instead.`, 409)
  const room = round2((live.effective.get(from) || 0) - (spent.get(from) || 0))
  if (a > room) throw new BudgetError('no_room', `${names.get(from)} has ${usd(Math.max(0, room))} left, not ${usd(a)}.`, 409)
  await r(db.from('budget_plan_moves').insert({ plan_id: live.plan.id, from_category_id: from, to_category_id: to, amount: a, reason: clip(reason, 500), expense_id: expenseId, receipt_id: receiptId, created_by: actor?.id || null }), 'save_failed', 'The move could not be saved.')
  await I.logEvent(db, budget.id, 'plan_moved', `Moved ${usd(a)} from ${names.get(from)} to ${names.get(to)}, inside the agreed limit.${reason ? ` ${clip(reason, 200)}` : ''}`, actor, null, { from, to, amount: a })
  return { moved: a, message: `Moved ${usd(a)} from ${names.get(from)} to ${names.get(to)}.` }
}

/** Ask Margo to raise a category's approved total. */
export async function requestAmendment(db, actor, { fy, category_id, amount, reason = '', expenseId = null, receiptId = null }) {
  const { budget, live, names } = await livePlan(db, fy)
  const a = round2(amount)
  if (!(a > 0) || !names.has(category_id)) throw new BudgetError('invalid_amendment', 'Choose the category and the amount.')
  const [row] = await r(db.from('budget_amendments').insert({ plan_id: live.plan.id, category_id, amount: a, reason: clip(reason, 500), expense_id: expenseId, receipt_id: receiptId, requested_by: actor?.id || null }).select(), 'save_failed', 'The request could not be sent.')
  await I.logEvent(db, budget.id, 'amendment_requested', `Asked Margo to raise ${names.get(category_id)} by ${usd(a)}.${reason ? ` ${clip(reason, 200)}` : ''}`, actor, null, { amendment: row.id })
  return { amendment: row, message: `Asked Margo to raise ${names.get(category_id)} by ${usd(a)}.` }
}

/** Margo approves or declines an amendment. */
export async function decideAmendment(db, actor, { id, decision, comment = '' }) {
  if (!UUID.test(String(id || ''))) throw new BudgetError('not_found', 'That request no longer exists.', 404)
  const a = (await r(db.from('budget_amendments').select('*').eq('id', id).limit(1)))[0]
  if (!a) throw new BudgetError('not_found', 'That request no longer exists.', 404)
  if (a.status !== 'pending') throw new BudgetError('decided', 'That request has already been decided.', 409)
  if (!['approve', 'decline'].includes(decision)) throw new BudgetError('invalid_decision', 'Choose Approve or Decline.')
  const status = decision === 'approve' ? 'approved' : 'declined'
  await r(db.from('budget_amendments').update({ status, comment: String(comment || '').trim().slice(0, 2000), decided_by: actor?.id || null, decided_at: iso() }).eq('id', id), 'save_failed', 'The decision could not be saved.')
  const { plan, budget } = await planById(db, a.plan_id)
  const name = (await I.categoriesOf(db)).find(c => c.id === a.category_id)?.name || 'a category'
  await I.logEvent(db, budget.id, status === 'approved' ? 'amendment_approved' : 'amendment_declined', `${name} ${status === 'approved' ? 'raised' : 'not raised'} by ${usd(Number(a.amount))}${comment ? `: ${String(comment).trim().slice(0, 200)}` : '.'}`, actor, null, { amendment: id, plan: plan.id })
  return { amendment: { ...a, status }, message: status === 'approved' ? `Approved. ${name} is raised by ${usd(Number(a.amount))}.` : 'Declined.' }
}

/** The move limit (the owner sets it; Margo confirms it outside the app). */
export async function saveLimits(db, actor, { pct, cap }) {
  const p = Number(pct), c = Number(cap)
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new BudgetError('invalid_limit', 'Enter a percentage from 0 to 100.')
  if (!Number.isFinite(c) || c < 0 || c > 1_000_000) throw new BudgetError('invalid_limit', 'Enter the most one move may be, in dollars.')
  const cur = await limitsOf(db)
  const { error } = await db.from('budget_settings').upsert({ program: PROGRAM, move_limit_pct: round2(p), move_limit_cap: round2(c), updated_by: actor?.id || null, updated_at: iso() }, { onConflict: 'program' })
  if (error) { if (notEnabled(error)) throw new BudgetError('not_enabled', NOT_ENABLED, 409); throw new BudgetError('save_failed', 'The limit could not be saved.', 500) }
  await I.logChanges(db, 'settings', randomUUID(), null, 'update', [{ field: 'move_limit', old: cur, new: { pct: round2(p), cap: round2(c) } }], actor)
  return { limits: { pct: round2(p), cap: round2(c) }, message: 'Move limit saved.' }
}

// ── The start of the year ───────────────────────────────────────────────────────

/**
 * On July 1 (the daily run), an approved proposal becomes the year: its approved total is the budget
 * and its approved category totals are the plan. A year already started, or with no approved plan, is
 * left alone.
 */
export async function autoStartApproved(db, { today = pacificToday() } = {}) {
  if (!(await plansEnabled(db))) return { started: null }
  const fy = fyOfToday(today)
  const b = await I.budgetFor(db, fy)
  if (!b || b.started_at) return { started: null }
  const live = await approvedPlanFor(db, b.id)
  if (!live) return { started: null }
  const total = round2([...live.approved.values()].reduce((a, v) => a + v, 0))
  await startYear(db, null, { fy, total, cost_center: b.cost_center, today })
  const cats = await catsOf(db, live.plan.id)
  await applyToYear(db, { ...b, started_at: iso() }, cats)
  return { started: fy, total }
}

// ── The PDF for Finance ─────────────────────────────────────────────────────────

/** The request as a PDF for Cedars-Sinai's official process: note, category table, items, status. */
export async function planPdf(db, { planId, reader = false }) {
  const { plan, budget } = await planById(db, planId)
  if (reader && plan.status === PLAN_STATUS.draft) throw new BudgetError('not_found', 'That plan no longer exists.', 404)
  const fy = budget.fiscal_year
  const categories = (await I.categoriesOf(db))
  const items = await itemsOf(db, plan.id)
  const pcats = await catsOf(db, plan.id)
  const totals = planTotals(items)
  const prior = await I.budgetFor(db, fy - 1)
  const priorSpent = prior ? spentOf(await I.expensesOf(db, prior.id)) : new Map()
  const people = await namesOf(db, [plan.submitted_by, plan.decided_by])

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 612, H = 792, M = 54
  let page = doc.addPage([W, H]), y = H - M
  const ink = rgb(0.1, 0.12, 0.2), soft = rgb(0.35, 0.38, 0.45)
  const need = (h) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M } }
  const text = (s, x, size = 10, f = font, color = ink) => page.drawText(String(s), { x, y, size, font: f, color })
  const right = (s, xr, size = 10, f = font) => page.drawText(String(s), { x: xr - f.widthOfTextAtSize(String(s), size), y, size, font: f, color: ink })
  const wrap = (s, width, size = 10) => {
    const out = []; let line = ''
    for (const w of String(s || '').split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w } else line = t }
    if (line) out.push(line)
    return out
  }
  const money = (n) => usd(n)

  text(`ASPIRE Budget Request, ${fyShort(fy)}`, M, 18, bold); y -= 22
  text(`${dateText(fiscalYearRange(fy).start)} to ${dateText(fiscalYearRange(fy).end)} · Version ${plan.version} · ${STATUS_TEXT[plan.status]}`, M, 10, font, soft); y -= 14
  if (plan.submitted_at) { text(`Submitted ${pacificDay(plan.submitted_at)}${people.get(plan.submitted_by) ? ` by ${people.get(plan.submitted_by)}` : ''}`, M, 10, font, soft); y -= 14 }
  if (plan.decided_at && plan.status === PLAN_STATUS.approved) { text(`Approved ${pacificDay(plan.decided_at)}${people.get(plan.decided_by) ? ` by ${people.get(plan.decided_by)}` : ''}`, M, 10, font, soft); y -= 14 }
  text('Prepared in ASPIRE Intelligence for the Cedars-Sinai budget process. It is a record of the request, not a finance system entry.', M, 8.5, font, soft); y -= 24

  text('Why This Budget', M, 12, bold); y -= 16
  for (const l of wrap(plan.note || 'No note.', W - 2 * M)) { need(14); text(l, M); y -= 13 }
  y -= 12

  need(40)
  text('Category', M, 10, bold); right(`${fyShort(fy - 1)} ${fy - 1 === fyOfToday(pacificToday()) ? 'to date' : 'actual'}`, 340, 10, bold); right('Requested', 440, 10, bold); right('Approved', W - M, 10, bold); y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: soft }); y -= 14
  const byCat = new Map(pcats.map(c => [c.category_id, c]))
  const rows = categories.filter(c => (plan.status === PLAN_STATUS.draft ? totals.byCategory.get(c.id) : byCat.get(c.id)?.requested) > 0 || priorSpent.get(c.id))
  let tReq = 0, tApp = 0, tPrior = 0
  for (const c of rows) {
    need(14)
    const req = plan.status === PLAN_STATUS.draft ? (totals.byCategory.get(c.id) || 0) : (byCat.get(c.id)?.requested || 0)
    const app = byCat.get(c.id)?.approved
    tReq += req; tPrior += priorSpent.get(c.id) || 0; if (app != null) tApp += app
    text(c.name, M); right(money(priorSpent.get(c.id) || 0), 340); right(money(req), 440); right(app == null ? '–' : money(app), W - M); y -= 14
  }
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.6, color: soft }); y -= 4
  text('Total', M, 10, bold); right(money(tPrior), 340, 10, bold); right(money(round2(tReq)), 440, 10, bold); right(plan.status === PLAN_STATUS.approved ? money(round2(tApp)) : '–', W - M, 10, bold); y -= 16
  if (totals.platform) { text(`Platform (ASPIRE Intelligence) share: ${money(totals.platform)}, ${Math.round(totals.platformShare * 100)}% of the request.`, M, 9, font, soft); y -= 20 }
  if (plan.comment) { need(30); text('Comment', M, 11, bold); y -= 14; for (const l of wrap(plan.comment, W - 2 * M)) { need(14); text(l, M); y -= 13 } y -= 8 }

  need(30); text('Planned Items', M, 12, bold); y -= 16
  for (const c of categories.filter(c => items.some(i => i.category_id === c.id))) {
    need(30); text(c.name, M, 10, bold); y -= 14
    for (const i of items.filter(x => x.category_id === c.id)) {
      need(26)
      text(`${i.name}${i.tag === PLATFORM ? ' (Platform)' : ''}`, M + 10); right(`${i.quantity} × ${money(i.unit_cost)} = ${money(itemAmount(i))}`, W - M); y -= 12
      if (i.reason) for (const l of wrap(i.reason, W - 2 * M - 20, 8.5)) { need(12); text(l, M + 20, 8.5, font, soft); y -= 11 }
      y -= 3
    }
    y -= 6
  }
  const bytes = await doc.save()
  return { bytes, fileName: `ASPIRE_Budget_Request_${fyShort(fy)}_v${plan.version}.pdf` }
}
