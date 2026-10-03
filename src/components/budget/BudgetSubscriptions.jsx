// src/components/budget/BudgetSubscriptions.jsx
//
// PROGRAM-BUDGET A9: recurring charges, tracked once. The basis line (Active, Monthly run rate,
// Per year, Due by Jun 30), Renewals to decide as slips (a decision is a slip, never a table
// row: table canon section 2), and every subscription on an Editable sheet. Next charge, Per
// year, Due by Jun 30 and Status are calculated from the row, by src/lib/budget/budgetModel.js,
// so an edit shows its effect at once.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import EditableSheet from '../sheet/EditableSheet'
import SubscriptionMonths from './SubscriptionMonths'
import DataSheet, { Pill } from '../shared/DataSheet'
import { BUDGET_TOOLS } from './budgetSheetTools'
import {
  usd, dateText, BILLING, PAYMENT_METHODS, nextCharge, perYear, dueByYearEnd, subscriptionStatus, isActiveSub, monthlyEquivalent,
  paymentKey, pacificToday, fyShort, parseMoney, overlappingIds, ifApproved, platformCost,
} from '../../lib/budget/budgetModel'

const LEAD = { key: '@name', label: 'Service', type: 'text' }
const TONE = { green: 'ok', amber: 'warn', blue: 'info', grey: 'off' }
const DASH = <span className="bud-dash">–</span>
const CALCULATED = new Set(['next', 'perYear', 'due', 'status'])
const DEFAULT_LAYOUT = {
  order: [], hidden: [], widths: { '@name': 190, plan: 170, notes: 240 }, frozen: 0, groupBy: null, staffColumns: [],
  colFormats: { amount: { num: 'currency' }, perYear: { num: 'currency' }, due: { num: 'currency' } }, summaries: { perYear: 'sum', due: 'sum' },
}
// BUDGET-FIXES-1 item 1.5 (Owner, 2026-09-29): Amount mixes monthly and annual prices, so it has no
// Σ; Per year and Due by Jun 30 keep theirs. A layout saved with a Sum on Amount loses it here.
const UNSUMMABLE = new Set(['amount'])
function withoutAmountSum(layout) {
  if (!layout.summaries?.amount) return layout
  const summaries = { ...layout.summaries }
  delete summaries.amount
  return { ...layout, summaries }
}
// A pinned Amount carries "set by you" and Use average; the column is wide enough to show both.
const PINNED_AMOUNT_W = 240
function fitPinned(layout, pinned) {
  if (!pinned || (layout.widths?.amount || 0) >= PINNED_AMOUNT_W) return layout
  return { ...layout, widths: { ...(layout.widths || {}), amount: PINNED_AMOUNT_W } }
}
const billingLabel = (k) => BILLING.find(b => b.key === k)?.label || ''
const billingKey = (l) => BILLING.find(b => b.label === l)?.key || 'monthly'

export default function BudgetSubscriptions({ year, canEdit, onWrite, onOpenReceipt = null }) {
  const [today] = useState(() => pacificToday())   // one day per visit, so the calculated columns hold still
  const state = year.state
  const subs = year.subscriptions
  const cats = useMemo(() => new Map(year.categories.map(c => [c.id, c.name])), [year.categories])
  const catIds = useMemo(() => new Map(year.categories.map(c => [c.name, c.id])), [year.categories])
  const active = subs.filter(s => isActiveSub(s, today))
  const run = active.reduce((a, s) => a + monthlyEquivalent(s), 0)
  const next = active.map(s => [s, nextCharge(s, today)]).filter(x => x[1]).sort((a, b) => a[1].localeCompare(b[1]))[0]
  const due = year.summary.committed
  const prop = year.proposals || { plans: [], count: 0 }
  // BUDGET-V2 item 3: one status per row, the overlap check, and what approval would add.
  const overlapping = useMemo(() => overlappingIds(subs), [subs])
  const statusOf = (s) => subscriptionStatus(s, today, { overlapping: overlapping.has(s.id) })
  const counts = subs.reduce((m, s) => { const k = statusOf(s).key; m[k] = (m[k] || 0) + 1; return m }, {})
  const activeLine = [
    counts.proposed ? `${counts.proposed} awaiting approval` : '',
    counts.decide ? `${counts.decide} ${counts.decide === 1 ? 'needs' : 'need'} a decision` : '',
    counts.ending ? `${counts.ending} ending` : '',
    counts.ended ? `${counts.ended} ended` : '',
    counts.declined ? `${counts.declined} declined` : '',
  ].filter(Boolean).join(' · ') || 'None awaiting approval'
  const overlaps = year.overlaps || []
  const overlapNow = overlaps[0] || null
  const [overlapDone, setOverlapDone] = useState(null)   // { id, decision, message } for the Undo line
  const decideOverlap = async (o, decision) => {
    const out = await onWrite.call('subscription_overlap', { id: o.end.id, decision, ...(decision === 'end' ? { end_on: o.endOn } : {}) })
    const was = subs.find(x => x.id === o.end.id) || {}
    setOverlapDone({ id: o.end.id, decision, message: out.message, prior: { end_date: was.end_date || null, auto_renew: was.auto_renew !== false } }); onWrite.changed()
  }
  const undoOverlap = async () => {
    const d = overlapDone
    setOverlapDone(null)
    // Keep both is undone by asking again; Mark ended by putting back the End and Auto-renew it had.
    if (d.decision === 'keep') await onWrite.call('subscription_overlap', { id: d.id, decision: 'reopen' })
    else await onWrite.call('subscription_update', { id: d.id, patch: { end_date: d.prior.end_date, auto_renew: d.prior.auto_renew } })
    onWrite.changed()
  }
  // BUDGET-FIXES-1 item 1.2: Use average hands a pinned Amount back to the receipts, on the server.
  const takeAverage = async (sub) => {
    try { const out = await onWrite.call('subscription_use_average', { id: sub.id }); onWrite.notify(out.message); onWrite.changed() } catch (e) { onWrite.notify(e.message, 'err') }
  }
  // A usage-based plan's estimate moves when a receipt arrives or Use average runs, outside the sheet.
  const decisionKey = subs.filter(x => x.approval_state !== 'approved' || x.overlap_kept).map(x => `${x.id}:${x.approval_state}:${x.overlap_kept ? 1 : 0}`).join(',') + `|${[...overlapping].join(',')}`
    + `|${subs.filter(x => x.billing === 'usage').map(x => `${x.id}:${x.amount}:${x.amount_pinned ? 1 : 0}`).join(',')}`
  const plat = platformCost(subs, today)
  const pct = (n) => (year.summary.total ? ` (${(n / year.summary.total * 100).toFixed(1)}% of budget)` : '')

  const toRow = (s) => ({
    id: s.id, raw: s, format: s.cell_formats || {},
    cells: {
      plan: s.plan || '', vendor: s.vendor || '', billing: billingLabel(s.billing), amount: s.amount == null ? '' : String(s.amount),
      anchor: s.anchor_date || '', start: s.start_date || '', end: s.end_date || '',
      pay: PAYMENT_METHODS.find(p => p.key === s.payment_method)?.label || '', cat: cats.get(s.category_id) || '',
      auto: s.auto_renew ? 'Yes' : 'No', notes: s.notes || '', tag: s.tag === 'platform' ? 'Platform' : '',
      ...(s.staff_values || {}),
    },
  })
  const rows = useMemo(() => subs.map(toRow), [subs]) // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo(() => [
    { key: 'plan', label: 'Plan', type: 'text' },
    { key: 'vendor', label: 'Vendor', type: 'text' },
    { key: 'billing', label: 'Billing', type: 'choice', required: true, options: BILLING.map(b => b.label) },
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'next', label: 'Next charge', type: 'text', compute: (r) => { const n = nextCharge(r.raw, today); return n ? dateText(n) : '' }, note: 'Next charge is worked out from the charge date, Billing and End. Change one of those instead.' },
    // SHEET-LIVE-1 (Owner, 2026-09-27: "it wouldn't allow me to edit (per year column)"): these are
    // worked out, so a click says from what. A proposed or ended plan counts nothing, so it shows a dash.
    { key: 'perYear', label: 'Per year', type: 'number', compute: (r) => perYear(r.raw, today) || null, note: 'Per year is worked out from Amount and Billing, and counts only an approved plan that is running. Change the Amount instead.' },
    { key: 'due', label: `Due by Jun 30`, type: 'number', compute: (r) => dueByYearEnd(r.raw, year.fy, state, today) || null, note: 'Due by Jun 30 is worked out from the charges still to come this year. Change the Amount, Billing or End instead.' },
    { key: 'pay', label: 'Payment', type: 'choice', options: PAYMENT_METHODS.map(p => p.label) },
    ...(year.tagsEnabled ? [{ key: 'tag', label: 'Tag', type: 'choice', options: ['Platform'] }] : []),
    { key: 'cat', label: 'Category', type: 'choice', options: year.categories.map(c => c.name) },
    { key: 'auto', label: 'Auto-renew', type: 'choice', required: true, options: ['Yes', 'No'] },
    { key: 'status', label: 'Status', type: 'text', compute: (r) => subscriptionStatus(r.raw, today, { overlapping: overlapping.has(r.raw.id) }).label, note: 'Status follows the plan: its approval, End date and renewal decision.' },
    { key: 'anchor', label: 'A charge date', type: 'date' },
    { key: 'start', label: 'Start', type: 'date' },
    { key: 'end', label: 'End', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'paragraph' },
  ], [year.categories, year.fy, state, today, overlapping, year.tagsEnabled])

  const toPatch = (key, draft) => {
    const v = typeof draft === 'string' ? draft.trim() : draft
    switch (key) {
      case '@name': return { name: v }
      case 'billing': return { billing: billingKey(v) }
      case 'amount': return { amount: parseMoney(v) ?? v }
      case 'pay': return { payment_method: v ? paymentKey(v) : null }
      case 'cat': return { category_id: v ? catIds.get(v) || null : null }
      case 'auto': return { auto_renew: v === 'Yes' }
      case 'tag': return { tag: v === 'Platform' ? 'platform' : null }
      case 'anchor': return { anchor_date: v }
      case 'start': return { start_date: v }
      case 'end': return { end_date: v || null }
      default: return { [key]: v }
    }
  }
  const decide = (id, decision, ok) => onWrite.run('renewal_decide', { id, decision }, ok)
  // BUDGET-V2 (Owner, 2026-09-29): approving into a closed month asks first.
  const [closedAsk, setClosedAsk] = useState(null)   // { id, name, message }
  const approve = async (id, decision, intoClosed = false) => {
    setClosedAsk(null)
    try {
      const out = await onWrite.call('subscription_approve', { id, decision, ...(intoClosed ? { into_closed: true } : {}) })
      if (out?.message) onWrite.notify(out.message)
      onWrite.changed()
    } catch (e) {
      if (e.code === 'closed_months') setClosedAsk({ id, name: prop.plans.find(p => p.id === id)?.name || 'This plan', message: e.message })
      else onWrite.notify(e.message, 'err')
    }
  }
  const fyStart = dateText(`${year.fy - 1}-07-01`)
  // With no plans yet, Edit plans starts open: it is where the first one is added.
  const [editOpen, setEditOpen] = useState(() => subs.length === 0)

  return (
    <>
      {/* SUBS-KPI-1 (Owner, 2026-10-03): the totals, said once, as the app's KPI cards (the Summary's tiles). */}
      <div className="bud-basis bud-basis-4" role="group" aria-label="Subscription totals">
        <SurfaceCard className="bud-tile"><span className="k">Active</span><b>{active.length}</b><small>{activeLine || 'No other plans'}</small></SurfaceCard>
        <SurfaceCard className="bud-tile"><span className="k">A month</span><b>{usd(run)}</b><small>{prop.count ? `${usd(run + prop.monthly)} if approved` : 'Annual plans spread by month'}</small></SurfaceCard>
        <SurfaceCard className="bud-tile"><span className="k">A year</span><b>{usd(run * 12)}</b><small>{prop.count
          ? `${usd(run * 12 + prop.perYear)} if approved${pct(run * 12 + prop.perYear)}`
          : state === 'current' && year.summary.total ? `${((run * 12) / year.summary.total * 100).toFixed(1)}% of the ${fyShort(year.fy)} budget` : 'At current plans'}</small></SurfaceCard>
        <SurfaceCard className="bud-tile"><span className="k">Due by Jun 30</span><b>{usd(due)}</b><small>{prop.count
          ? `${usd(due + prop.toCome)} if approved`
          : next ? `Next: ${next[0].name}, ${dateText(next[1])}` : 'Nothing scheduled'}</small></SurfaceCard>
      </div>

      {/* BUDGET-V2 item 4: the platform's cost, shown on its own. BUDGET-FIXES-1 item 1.6: it is program spend.
          SUBS-KPI-1 (Owner, 2026-10-03): a note, in both views; never a card with a coloured edge. */}
      {plat.count > 0 && (
        <p className="bud-platnote"><span className="bud-tag">Platform</span>
          <span><b>ASPIRE Intelligence platform cost.</b> The services that build and run the app: {plat.names.join(', ')}.{' '}
            {plat.active ? <>{usd(plat.monthly)} a month, {usd(plat.perYear)} a year now. </> : null}
            {plat.waiting ? <>{usd(plat.ifApprovedMonthly)} a month if approved, {usd(plat.ifApprovedPerYear)} a year. </> : null}
            Counted in program spend; shown on its own so it can be reported separately.</span></p>
      )}
      {canEdit && plat.waiting > 0 && <div className="bud-check bud-check-info"><span><b>Confirm before approving:</b> whether ASPIRE reimburses platform subscriptions, and whether Technology Ventures needs to know. Approvals stay open until you decide.</span></div>}

      {/* SUBS-KPI-1 (Owner, 2026-10-03): leadership sees the plans, read-only, with no Concur status,
          months or decisions; plans awaiting approval or declined are not listed. */}
      {!canEdit && <ReaderPlans subs={subs} statusOf={statusOf} today={today} />}

      {/* The one table: every plan, its cost, its next charge and its months' Concur status (the Owner's view). */}
      {canEdit && <SubscriptionMonths year={year} statusOf={statusOf} onOpenReceipt={onOpenReceipt} />}

      {/* SUB-APPROVAL-1: proposals are shown with what they would cost, and count against nothing. */}
      {canEdit && prop.count > 0 && (
        <section aria-label="Awaiting approval">
          <p className="bud-sub"><b>Awaiting Approval</b> · {prop.count} {prop.count === 1 ? 'subscription' : 'subscriptions'} · {usd(prop.monthly)} a month · Not counted against the budget until approved</p>
          {/* SUB-APPROVAL-2 (Owner, 2026-09-27): one compact list, a row per proposal, one Approve menu each. */}
          <SurfaceCard className={`bud-card bud-proplist${canEdit ? '' : ' bud-proplist-ro'}`}>
            <div className="bud-prop-head" aria-hidden="true">
              <span>Subscription</span><span>A month</span><span>Since {fyStart.replace(/, \d{4}$/, '')}</span><span>To come</span>{canEdit && <span />}
            </div>
            <ul className="bud-prop-rows">
              {prop.plans.map(p => (
                <li key={p.id} className="bud-prop-row">
                  <span className="nm">{p.name}</span>
                  <span className="n" aria-label={`${usd(p.monthly)} a month`}>{usd(p.monthly)}</span>
                  <span className="n" aria-label={`${usd(p.sinceStart)} since ${fyStart}`}>{usd(p.sinceStart)}</span>
                  <span className="n" aria-label={`${usd(p.toCome)} to come through June 30`}>{usd(p.toCome)}</span>
                  {canEdit && <ApproveMenu name={p.name} fyStart={fyStart.replace(/, \d{4}$/, '')} onChoose={(decision) => approve(p.id, decision)} />}
                </li>
              ))}
            </ul>
            <div className="bud-prop-row bud-prop-total">
              <span className="nm">{prop.count} awaiting approval</span>
              <span className="n">{usd(prop.monthly)}</span>
              <span className="n">{usd(prop.sinceStart)}</span>
              <span className="n">{usd(prop.toCome)}</span>
              {canEdit && <span />}
            </div>
            <p className="bud-hint">If approved from {fyStart}: {usd(prop.fromStart)} this year. From today: {usd(prop.fromToday)} through June 30.</p>
            {closedAsk && (
              <div className="bud-check bud-check-warn bud-overlap" role="alertdialog" aria-label={`Approve ${closedAsk.name} into closed months`}>
                <span><b>{closedAsk.message}</b> Post them anyway, or approve from today so the closed months stay as they were.</span>
                <span className="bud-overlap-acts">
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => approve(closedAsk.id, 'from_year_start', true)}>Post into closed months</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => approve(closedAsk.id, 'from_today')}>Approve from today</button>
                  <button type="button" className="bud-btn bud-btn-txt bud-btn-sm" onClick={() => setClosedAsk(null)}>Cancel</button>
                </span>
              </div>
            )}
          </SurfaceCard>
        </section>
      )}

      {canEdit && year.renewals.length > 0 && (
        <section aria-label="Renewals to decide">
          <p className="bud-sub"><b>Renewals to Decide</b> · Annual plans renewing in the next 45 days</p>
          <div className="bud-renews">
            {year.renewals.map(r => (
              <SurfaceCard key={r.id} className="bud-renew" role="group" aria-label={`${r.name} renewal`}>
                <span className="when">In {r.days} {r.days === 1 ? 'day' : 'days'}</span>
                <div><b>{r.name} renews {dateText(r.date)} for {usd(r.amount)}</b>
                  <small>{[r.plan, r.paymentLabel, `auto-renew ${r.auto_renew ? 'on' : 'off'}`].filter(Boolean).join(' · ')}. Decide before the charge posts.</small></div>
                <div className="acts">
                  <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={() => decide(r.id, 'keep', `${r.name} will renew.`)}>Keep</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => decide(r.id, 'cancel')}>Cancel at renewal</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => decide(r.id, 'remind', 'We’ll ask again in 7 days.')}>Remind me in 7 days</button>
                </div>
              </SurfaceCard>
            ))}
          </div>
        </section>
      )}


      {canEdit && overlapNow && !overlapDone && (
        <div className="bud-check bud-check-warn bud-overlap" role="group" aria-label="Overlapping plans">
          <span><b>{overlapNow.end.name} and {overlapNow.keep.name} overlap.</b> Both are from the same vendor and run at the same time. If {overlapNow.keep.name} replaced {overlapNow.end.name}, mark {overlapNow.end.name} ended so it is not counted as a subscription.</span>
          <span className="bud-overlap-acts">
            <button type="button" className="bud-btn bud-btn-sm" onClick={() => decideOverlap(overlapNow, 'end').catch(e => onWrite.notify(e.message, 'err'))}>Mark {overlapNow.end.name} ended {dateText(overlapNow.endOn).replace(/, \d{4}$/, '')}</button>
            <button type="button" className="bud-btn bud-btn-txt bud-btn-sm" onClick={() => decideOverlap(overlapNow, 'keep').catch(e => onWrite.notify(e.message, 'err'))}>Keep both</button>
          </span>
        </div>
      )}
      {overlapDone && (
        <div className="bud-check bud-check-ok bud-overlap" role="status">
          <span>{overlapDone.message}</span>
          <span className="bud-overlap-acts"><button type="button" className="bud-btn bud-btn-txt bud-btn-sm" onClick={() => undoOverlap().catch(e => onWrite.notify(e.message, 'err'))}>Undo</button></span>
        </div>
      )}

      {/* Edit plans: the full editable sheet (formulas, Undo and Redo, + Row), folded until it is wanted. */}
      {canEdit && (
        <section className="bud-editplans" aria-label="Edit plans">
          <button type="button" className="bud-editplans-toggle" aria-expanded={editOpen} onClick={() => setEditOpen(o => !o)}>
            {editOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            <b>Edit Plans</b><span>{subs.length} {subs.length === 1 ? 'subscription' : 'subscriptions'} · add one, change an amount, a date or a payment method</span>
            <span className="act">{editOpen ? 'Hide' : 'Show'}</span>
          </button>
          {editOpen && (<>
            <p className="bud-hint">Amounts in grey italics count only after approval. Each charge is Expected until its date, then Posted in Expenses, marked Subscription. Usage-based amounts are estimates. Click a cell and type to change it; every change saves itself. Amount takes a formula, like =200/12. Set an End date to stop a plan.</p>
            <EditableSheet
              // The sheet keeps its own rows. A decision made outside it (Approve, the overlap check) changes
              // statuses it cannot see, so those redraw it; its own cell edits do not.
              key={`subs-${year.fy}-${decisionKey}`}
              initialRows={rows}
              initialLayout={fitPinned(withoutAmountSum({ ...DEFAULT_LAYOUT, ...(year.subscriptionsLayout || {}) }), subs.some(x => x.billing === 'usage' && x.amount_pinned))}
              lead={LEAD}
              columns={columns}
              editable={canEdit}
              valueOf={(r, k) => (k === '@name' ? r.raw.name : k === 'amount' ? r.raw.amount : r.cells[k])}
              shownOf={(r, k) => (k === '@name' ? r.raw.name : (r.cells[k] ?? ''))}
              searchValues={(r) => [r.raw.name, r.raw.vendor, r.raw.notes]}
              ungroupable={new Set(['amount', 'next', 'perYear', 'due', 'anchor', 'start', 'end', 'notes', 'plan'])}
              unsummable={UNSUMMABLE}
              defaultSort={{ key: '@name', dir: 'asc' }} defaultFilterKey="billing"
              // SUB-CELLS-1: a cell's format and a + Column value live on the row; a save refreshes the year.
              saveLayout={async (layout) => { await onWrite.call('sheet_layout', { layout, sheet: 'subscriptions' }); onWrite.changed() }}
              saveCells={async (updates) => { await onWrite.call('sheet_cells', { updates, sheet: 'subscriptions' }); onWrite.changed() }}
              canEditColumn={(col) => !CALCULATED.has(col.key) && !col.staff}
              tools={BUDGET_TOOLS}
              emptyState={<><b>No subscriptions yet</b><span>{canEdit ? 'Add a row for each recurring charge, like a software plan. Each charge then posts on its date.' : 'None are on file.'}</span></>}
              canClear={(col) => ['plan', 'vendor', 'notes', 'end', 'cat', 'pay', 'tag'].includes(col.key)}
              formulas
              draftOf={(r, col) => (col.key === '@name' ? r.raw.name : r.cells[col.key])}
              commitEdit={async (row, col, editing, { patchRows }) => {
                const out = await onWrite.call('subscription_update', { id: row.id, patch: toPatch(col.key, editing.draft) })
                patchRows(x => (x.id === row.id ? toRow({ ...row.raw, ...normalize(out.subscription) }) : x))
                onWrite.changed()
              }}
              onAddRow={canEdit ? async () => { const out = await onWrite.call('subscription_create', { fields: { name: 'New subscription' } }); onWrite.changed(); return toRow(normalize(out.subscription)) } : undefined}
              onDeleteRows={canEdit ? async (list) => { for (const r of list) await onWrite.call('subscription_delete', { id: r.id }); onWrite.changed() } : undefined}
              renderCell={(row, col, text) => {
                if (col.key === 'status') { const st = statusOf(row.raw); return <Pill tone={TONE[st.tone]}>{st.label}</Pill> }
                // BUDGET-V2 item 3: a proposal shows what it would cost, in grey italics, never a dash. The
                // column's sum counts only what is approved, because the figure is the computed value.
                if (col.key === 'perYear' || col.key === 'due') {
                  const ia = ifApproved(row.raw, year.fy, today)
                  if (ia) return <span className="bud-ifv" title="Counts only after approval">{usd(col.key === 'perYear' ? ia.perYear : ia.due)}</span>
                }
                // BUDGET-FIXES-1 item 1.2: a usage-based Amount is the average of its last three receipts, an
                // estimate; one the owner typed is theirs until Use average hands it back.
                if (col.key === 'amount' && row.raw.billing === 'usage' && text) return (
                  <span className="bud-est">{text} <span className="bud-dash">est.</span>
                    {row.raw.amount_pinned && <> <span className="bud-dash">· set by you</span>
                      {canEdit && <> <button type="button" className="bud-link bud-est-avg" onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); takeAverage(row.raw) }}>Use average</button></>}</>}
                  </span>
                )
                if (col.key === 'tag') return row.raw.tag === 'platform' ? <span className="bud-tag">Platform</span> : DASH
                return text === '' || text == null ? DASH : undefined
              }}
              labels={{
                searchPlaceholder: 'Search services, vendors and notes', searchLabel: 'Search the subscriptions',
                count: (n, total) => (n === total ? `${n} ${n === 1 ? 'subscription' : 'subscriptions'}` : `${n} of ${total}`),
                emptyNote: canEdit ? 'No subscriptions yet. Add a row for each recurring charge.' : 'No subscriptions.',
                noMatch: 'No subscriptions match.', frameLabel: 'Subscriptions. Arrow keys move, Enter edits.',
                readOnlyEdit: 'This view is read-only.',
              }}
              notify={onWrite.notify}
            />
          </>)}
        </section>
      )}
    </>
  )
}

// The server returns a stored row; the date columns may arrive as timestamps.
const d10 = (v) => (v ? String(v).slice(0, 10) : null)
function normalize(s) {
  return { ...s, amount: s.amount == null ? null : Number(s.amount), anchor_date: d10(s.anchor_date), start_date: d10(s.start_date), end_date: d10(s.end_date),
    renewal_kept_for: d10(s.renewal_kept_for), renewal_remind_after: d10(s.renewal_remind_after) }
}

/** One proposal's decision, behind a small menu so the list stays a list. */
function ApproveMenu({ name, fyStart, onChoose }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    ref.current?.querySelector('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (d) => { setOpen(false); onChoose(d) }
  return (
    <span className="bud-approve" ref={ref}>
      <button type="button" className="bud-btn bud-btn-sm" aria-haspopup="menu" aria-expanded={open} aria-label={`Approve ${name}`} onClick={() => setOpen(o => !o)}>Approve ▾</button>
      {open && (
        <div className="fs-menu bud-approve-menu" role="menu" aria-label={`Decide ${name}`}>
          <button type="button" role="menuitem" className="fs-menu-item" onClick={() => pick('from_year_start')}>Approve from {fyStart}</button>
          <button type="button" role="menuitem" className="fs-menu-item" onClick={() => pick('from_today')}>Approve from today</button>
          <div className="fs-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="fs-menu-item fs-menu-danger" onClick={() => pick('decline')}>Decline</button>
        </div>
      )}
    </span>
  )
}


// SUBS-KPI-1: the reader's plan list, one row per plan: what it is, what it costs, when it next charges, a year.
// PLAN-COLUMNS-1 (Owner, 2026-10-03): four even columns, the three figures right-aligned, so Cost and Next
// charge no longer touch while Service holds most of the row.
const READER_HIDDEN = new Set(['proposed', 'declined'])
const READER_PILL = new Set(['ended', 'ending'])
function ReaderPlans({ subs, statusOf, today }) {
  const rows = subs.filter(s => !READER_HIDDEN.has(statusOf(s).key))
  if (!rows.length) return null
  const columns = [
    { key: 'name', label: 'Service', min: 180, grow: 1, priority: 1, sortValue: s => s.name, render: s => {
      const st = statusOf(s)
      return <span className="bud-rplan"><b>{s.name}</b>{s.plan && <small>{s.plan}</small>}{READER_PILL.has(st.key) && <Pill tone={TONE[st.tone]}>{st.label}</Pill>}</span>
    } },
    { key: 'cost', label: 'Cost', min: 110, grow: 1, align: 'right', priority: 1, sortValue: s => Number(s.amount) || 0,
      render: s => <span className="bud-rplan bud-rplan-n"><b>{s.amount == null ? '–' : usd(s.amount)}</b><small>{billingLabel(s.billing)}{s.billing === 'usage' ? ', est.' : ''}</small></span> },
    { key: 'next', label: 'Next charge', min: 110, grow: 1, align: 'right', priority: 2, sortValue: s => nextCharge(s, today) || '9999', render: s => { const n = nextCharge(s, today); return n ? dateText(n) : DASH } },
    { key: 'year', label: 'Per year', min: 110, grow: 1, align: 'right', priority: 1, sortValue: s => perYear(s, today) || 0, render: s => { const y = perYear(s, today); return y ? usd(y) : DASH } },
  ]
  return (
    <SurfaceCard className="bud-card">
      <h2>Plans</h2><p className="bud-sub">Every subscription the program pays for, read-only</p>
      <DataSheet level="plain" columns={columns} rows={rows} rowKey={s => s.id} defaultSort={{ key: 'name', dir: 'asc' }}
        emptyMessage="No plans" aria-label="Subscription plans" />
    </SurfaceCard>
  )
}
