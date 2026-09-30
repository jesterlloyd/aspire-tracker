// src/lib/budget/planModel.js
//
// BUDGET-V2 Phase 3 (2026-09-29): the plan stage. Reference: the Plan tab and the within-plan check in
// docs/mockups/program-budget-v2.html. Pure: the Plan tab, Margo's review in the Leadership Portal, the
// receipt slip, the Sheet and the server all read these rules, so a figure means the same everywhere.
//
// Owner decisions: Margo approves CATEGORY totals, not items. Items are the owner's reasoning. The owner
// may move money between categories without asking, up to a limit: DEFAULT_LIMITS, 10% of the
// receiving category's approved total, capped at $500 per move; both are settings Margo confirms.
// Anything beyond that is an amendment Margo decides.

import { usd, fyShort } from './budgetModel.js'

export const PLAN_STATUS = Object.freeze({ draft: 'draft', submitted: 'submitted', approved: 'approved', sent_back: 'sent_back' })
export const STATUS_TEXT = Object.freeze({ draft: 'Draft', submitted: 'Submitted to Margo', approved: 'Approved', sent_back: 'Sent back' })
export const DEFAULT_LIMITS = Object.freeze({ pct: 10, cap: 500 })
export const PLATFORM = 'platform'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const sum = (xs) => round2(xs.reduce((a, b) => a + (Number(b) || 0), 0))

/** An item's amount: quantity x unit cost. */
export const itemAmount = (i) => round2((Number(i?.quantity) || 0) * (Number(i?.unit_cost) || 0))

/**
 * What a plan asks for: per category, the total, and the Platform share (items tagged Platform).
 * `items` are { category_id, quantity, unit_cost, tag }.
 */
export function planTotals(items = []) {
  const byCategory = new Map()
  for (const i of items) byCategory.set(i.category_id, round2((byCategory.get(i.category_id) || 0) + itemAmount(i)))
  const total = sum([...byCategory.values()])
  const platform = sum(items.filter(i => i.tag === PLATFORM).map(itemAmount))
  return { byCategory, total, platform, platformShare: total ? platform / total : 0 }
}

/**
 * The totals a plan runs on, per category: what Margo approved, plus moves in, less moves out, plus
 * amendments she approved. `approved` is Map category -> approved total.
 */
export function effectivePlan(approved, { moves = [], amendments = [] } = {}) {
  const eff = new Map([...approved].map(([k, v]) => [k, round2(v)]))
  for (const m of moves) {
    eff.set(m.to_category_id, round2((eff.get(m.to_category_id) || 0) + Number(m.amount)))
    eff.set(m.from_category_id, round2((eff.get(m.from_category_id) || 0) - Number(m.amount)))
  }
  for (const a of amendments) if (a.status === 'approved') eff.set(a.category_id, round2((eff.get(a.category_id) || 0) + Number(a.amount)))
  return eff
}

/** The most the owner may move INTO a category without asking: pct of its approved total, capped. */
export const moveLimit = (approvedTotal, limits = DEFAULT_LIMITS) => round2(Math.min((Number(limits.pct) / 100) * (Number(approvedTotal) || 0), Number(limits.cap)))

/**
 * The within-plan check for new spend (BUDGET-V2 item 16). `lines` are { category_id, amount } of the
 * new spend; `plan` is null (no approved plan) or { effective: Map, approved: Map, spent: Map,
 * names: Map, limits }. One answer:
 *   none     no approved category plan: it counts against the year's total.
 *   within   every category stays within its effective total.
 *   over     the first category that would go over, how far, the move (if it is inside the limit and
 *            a source has room) and the amendment it would take otherwise.
 */
export function planCheck(lines = [], plan = null, { total = 0 } = {}) {
  if (!plan) return { key: 'none', tone: 'info', text: `No approved category plan. This counts against the ${usd(total)} total.` }
  const add = new Map()
  for (const l of lines) if (l.category_id) add.set(l.category_id, round2((add.get(l.category_id) || 0) + Number(l.amount || 0)))
  const over = []
  for (const [cat, amount] of add) {
    const eff = plan.effective.get(cat) || 0
    const reach = round2((plan.spent.get(cat) || 0) + amount)
    if (reach > eff) over.push({ category_id: cat, name: plan.names.get(cat) || 'This category', reach, approved: eff, over: round2(reach - eff) })
  }
  if (!over.length) return { key: 'within', tone: 'ok', text: 'Within approved plan.' }
  const o = over[0]
  const limit = moveLimit(plan.approved.get(o.category_id) ?? o.approved, plan.limits)
  const sources = [...plan.effective]
    .filter(([cat]) => cat !== o.category_id && !add.has(cat))
    .map(([cat, eff]) => ({ category_id: cat, name: plan.names.get(cat) || '', room: round2(eff - (plan.spent.get(cat) || 0)) }))
    .filter(s => s.room >= o.over)
    .sort((a, b) => b.room - a.room || a.name.localeCompare(b.name))
  const canMove = o.over <= limit && sources.length > 0
  const why = o.over > limit ? `A move of ${usd(o.over)} is over your limit of ${usd(limit)} for ${o.name}.` : !sources.length ? `No category has ${usd(o.over)} to spare.` : ''
  return {
    key: 'over', tone: 'warn', over, first: o, limit, sources, canMove, whyNoMove: why,
    text: `Outside approved plan. ${o.name} would reach ${usd(o.reach)} of ${usd(o.approved)} approved, ${usd(o.over)} over.`,
  }
}

/**
 * Each posted row's place in the plan, for the Sheet's Plan column: rows in date order, the first row
 * that takes its category past the effective total and every one after it are over (by the part that
 * is over). A row with an amendment waiting says so.
 */
export function rowPlanStatus(expenses = [], plan = null, { pending = new Set() } = {}) {
  const out = new Map()
  if (!plan) return out
  const run = new Map()
  const rows = [...expenses].filter(e => !e.deleted_at && e.status !== 'void' && (e.state || 'posted') === 'posted' && e.category_id)
    .sort((a, b) => String(a.expense_date).localeCompare(String(b.expense_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
  for (const e of rows) {
    const before = run.get(e.category_id) || 0
    const after = round2(before + Number(e.amount || 0))
    run.set(e.category_id, after)
    const eff = plan.effective.get(e.category_id)
    if (pending.has(e.id)) out.set(e.id, { key: 'pending', text: 'Waiting for Margo' })
    else if (eff == null) out.set(e.id, { key: 'unplanned', text: 'Not in plan', over: round2(Number(e.amount || 0)) })
    else if (after > eff) out.set(e.id, { key: 'over', text: `Over ${usd(round2(Math.min(after - eff, Number(e.amount || 0))))}`, over: round2(Math.min(after - eff, Number(e.amount || 0))) })
    else out.set(e.id, { key: 'within', text: 'Within' })
  }
  return out
}

/** The plan's one-line status: "Draft · v2", "Submitted to Margo · v1", "Approved · v1". */
export const statusLine = (plan) => (plan ? `${STATUS_TEXT[plan.status] || plan.status} · v${plan.version}` : '')

/** Which tabs a year shows (BUDGET-V2 item 15). A reader sees Plan once a plan is not a draft. */
export function tabsForState(state, { owner = true, planVisible = true, receipts = true } = {}) {
  if (state === 'proposal') return ['plan']
  if (state === 'closed') return ['summary', 'sheet', ...(planVisible ? ['plan'] : [])]
  if (state === 'current') return ['summary', 'sheet', 'subscriptions', ...(owner && receipts ? ['receipts'] : []), ...(planVisible ? ['plan'] : [])]
  return ['summary', 'subscriptions']
}

/** The Summary's quiet line about next year's proposal. Null when there is nothing to say. */
export function proposalLine(next, { approver = false } = {}) {
  if (!next) return null
  const fy = fyShort(next.fy)
  if (!next.plan) return next.requested ? { text: `${next.requestedBy || 'Margo'} asked for the ${fy} proposal.`, action: `Start the ${fy} proposal` } : null
  if (next.plan.status === 'draft') return { text: `The ${fy} proposal is a draft (v${next.plan.version}).`, action: `Open the ${fy} proposal` }
  if (next.plan.status === 'submitted') return approver
    ? { text: `The ${fy} proposal is waiting for your review (v${next.plan.version}).`, action: `Review the ${fy} proposal` }
    : { text: `The ${fy} proposal is with Margo (v${next.plan.version}).`, action: `Open the ${fy} proposal` }
  if (next.plan.status === 'approved') return { text: `The ${fy} proposal is approved (v${next.plan.version}).`, action: `Open the ${fy} proposal` }
  return null
}
