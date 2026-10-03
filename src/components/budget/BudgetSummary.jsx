// src/components/budget/BudgetSummary.jsx
//
// PROGRAM-BUDGET A6: the Summary. Every figure is year.summary, computed by
// src/lib/budget/budgetModel.js on the server; nothing is computed here but layout.
//   1. Leadership: the owner's note and last reconciled month, above the figures.
//      BUDGET-FIXES-1 section 2: How this works moved beside the tabs (BudgetHowItWorks.jsx).
//   2. The basis line: Budget, Spent, Remaining, Used, Cost per student.
//   3. Monthly spend against an even pace, with scheduled subscription charges dashed.
//   4. By category: a DataSheet plain sheet (table canon row 9).
//   5. The owner's note card, beside Budget history.
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import DataSheet, { Missing } from '../shared/DataSheet'
import BudgetClose from './BudgetClose'
import { proposalLine } from '../../lib/budget/planModel'
import { fyShort } from '../../lib/budget/budgetModel'
import { paceLabelSpot } from '../../lib/budget/paceLabel'
import { usd, fyRangeText, parseMoney } from '../../lib/budget/budgetModel'

// HISTORY-FOLD-1 (Owner, 2026-10-03): Budget History shows the newest changes and folds the rest.
const HISTORY_PEEK = 5

const pct = (v) => `${(v * 100).toFixed(1)}%`
const stamp = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

function Meter({ value, over }) {
  return (
    <span className="bud-inline-meter">
      <span className="bud-meter" aria-hidden="true"><i className={over ? 'over' : undefined} style={{ width: `${Math.min(100, value * 100)}%` }} /></span>
      <span>{pct(value)}</span>
    </span>
  )
}

function MonthlyChart({ s }) {
  const W = 720, H = 250, L = 58, R = 14, T = 18, B = 30
  const hi = Math.max(s.evenPace, ...s.byMonth.map(m => m.spent + m.scheduled), 1)
  const step = hi <= 2500 ? 500 : hi <= 6000 ? 1000 : 2000
  const max = Math.ceil((hi * 1.1) / step) * step
  const cw = (W - L - R) / 12, bw = Math.min(24, cw * 0.56)
  const y = (v) => T + (H - T - B) * (1 - v / max)
  const k = (v) => (v >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)
  const ticks = []
  for (let v = 0; v <= max; v += step) ticks.push(v)
  // BUDGET-PACE-LABEL-1: the pace label goes where no bar and no bar's value already is.
  const paceAt = paceLabelSpot({
    bars: s.byMonth.map((m, i) => (m.spent + m.scheduled > 0 ? { cx: L + i * cw + cw / 2, bw, top: y(m.spent + m.scheduled) } : null)).filter(Boolean),
    paceY: y(s.evenPace), yBase: y(0), left: L, right: W - R, step: cw,
  })
  return (
    <>
      <svg className="bud-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly spend for ${s.label} against an even pace of ${usd(s.evenPace)} per month`}>
        {ticks.map(v => <g key={v}><line className="gl" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 8} y={y(v) + 3.5} textAnchor="end">{k(v)}</text></g>)}
        {s.byMonth.map((m, i) => {
          const x = L + i * cw, bx = x + (cw - bw) / 2
          return (
            <g key={m.month}>
              {m.scheduled > 0 && (
                <path className="proj" d={`M${bx},${y(m.spent)} V${y(m.spent + m.scheduled) + 4} q0,-4 4,-4 H${bx + bw - 4} q4,0 4,4 V${y(m.spent)}`}>
                  <title>{m.month}: {usd(m.scheduled)} in expected subscription charges</title>
                </path>
              )}
              {m.spent > 0 && (
                <path className="bar" d={`M${bx},${y(0)} V${y(m.spent) + Math.min(4, y(0) - y(m.spent))} q0,-${Math.min(4, y(0) - y(m.spent))} 4,-${Math.min(4, y(0) - y(m.spent))} H${bx + bw - 4} q4,0 4,${Math.min(4, y(0) - y(m.spent))} V${y(0)} Z`}>
                  <title>{m.month}: {usd(m.spent)}</title>
                </path>
              )}
              {m.spent > 0 && <text className="val" x={x + cw / 2} y={y(m.spent + m.scheduled) - 6} textAnchor="middle">{k(m.spent)}</text>}
              {m.spent === 0 && !m.future && <text x={x + cw / 2} y={y(0) - 6} textAnchor="middle">–</text>}
              <text className={m.future ? 'fut' : undefined} x={x + cw / 2} y={H - 10} textAnchor="middle">{m.month}</text>
            </g>
          )
        })}
        <line className="pace" x1={L} x2={W - R} y1={y(s.evenPace)} y2={y(s.evenPace)} />
        {paceAt && <text x={paceAt.x} y={paceAt.y} textAnchor={paceAt.anchor}>Pace {k(s.evenPace)}/mo</text>}
      </svg>
      <div className="bud-legend">
        <span><i />Spent in month</span>
        {s.state === 'current' && <span><i className="pj" />Expected charges</span>}
        <span><i className="p" />Even pace ({usd(s.evenPace)} per month)</span>
      </div>
      {/* The table view of the chart, for a screen reader. */}
      <table className="bud-sr"><caption>Monthly spend, {s.label}</caption><thead><tr><th>Month</th><th>Spent</th><th>Scheduled</th></tr></thead>
        <tbody>{s.byMonth.map(m => <tr key={m.month}><td>{m.month}</td><td>{usd(m.spent)}</td><td>{usd(m.scheduled)}</td></tr>)}</tbody></table>
    </>
  )
}

export default function BudgetSummary({ year, canEdit, onWrite, onGo, source, onOpenYear, receiptQueue = [] }) {
  const s = year.summary
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [reason, setReason] = useState('')
  const [showIdle, setShowIdle] = useState(false)
  const [histOpen, setHistOpen] = useState(false)   // HISTORY-FOLD-1: the newest HISTORY_PEEK, then the arrow
  const closed = s.state === 'closed'

  const saveTotal = async () => {
    const v = parseMoney(draft)
    if (v == null) { onWrite.notify('Enter the budget in dollars, like 42,500.00.', 'err'); return }
    // BUDGET-FIXES-1 item 2.6: a change to the amount says why, in one line.
    if (!reason.trim()) { onWrite.notify('Say in one line why the budget is changing.', 'err'); return }
    if (await onWrite.run('set_total', { fiscal_year: year.fy, total: v, reason: reason.trim() }, 'Budget changed. Budget History has the old and new amounts and your reason.')) { setEditing(false); setReason('') }
  }

  const cps = s.costPerStudent
  const prop = year.proposals || { count: 0 }
  // BUDGET-V2 item 2: what is waiting outside these figures, each row with the way to it.
  const waitingTotal = receiptQueue.reduce((a, r) => a + (Number(r.total) || 0), 0)
  const matching = receiptQueue.filter(r => r.matchesSubscription).length
  const platformOnly = prop.count > 0 && (year.subscriptions || []).filter(x => x.approval_state === 'proposed' && !x.end_date).every(x => x.tag === 'platform')
  const pending = (receiptQueue.length > 0 || prop.count > 0) && s.state === 'current' ? (
    <SurfaceCard className="bud-pend" role="region" aria-label="Not counted yet">
      <h3>Not Counted Yet</h3>
      {canEdit && receiptQueue.length > 0 && (
        <div className="bud-pend-row">
          <span><b>{receiptQueue.length} {receiptQueue.length === 1 ? 'receipt' : 'receipts'}</b> to review · <b>{usd(waitingTotal)}</b> read by Keith</span>
          {matching > 0 && <span className="bud-hint">{matching} of them match subscription charges</span>}
          {onGo && <button type="button" className="bud-btn bud-btn-sm" onClick={() => onGo('receipts')}>Review receipts</button>}
        </div>
      )}
      {prop.count > 0 && (
        <div className="bud-pend-row">
          <span><b>{prop.count} {prop.count === 1 ? 'subscription' : 'subscriptions'}</b> awaiting approval · <b>{usd(prop.monthly)}</b> a month · <b>{usd(prop.sinceStart)}</b> since Jul 1 · <b>{usd(prop.toCome)}</b> to come</span>
          {platformOnly && <span className="bud-tag">Platform</span>}
          {onGo && <button type="button" className="bud-btn bud-btn-sm" onClick={() => onGo('subscriptions')}>Review subscriptions</button>}
        </div>
      )}
    </SurfaceCard>
  ) : null
  // BUDGET-FIXES-1 item 2.3: Cost per student waits until an expense is tagged to a cohort; the other
  // four tiles fill the row until then.
  const showCps = cps.state !== 'untagged'
  const basis = (
    <div className={showCps ? 'bud-basis' : 'bud-basis bud-basis-4'}>
      <SurfaceCard className="bud-tile">
        <span className="k">Budget</span>
        {editing ? (
          <>
            <span className="bud-money"><span>$</span><input className="bud-input" aria-label="Annual budget" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTotal(); if (e.key === 'Escape') setEditing(false) }} autoFocus /></span>
            <input className="bud-input bud-reason" aria-label="Reason for the change" placeholder="Why it is changing, in one line" maxLength={200} value={reason}
              onChange={e => setReason(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTotal(); if (e.key === 'Escape') setEditing(false) }} />
            <span className="bud-actions"><button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={!reason.trim()} title={reason.trim() ? undefined : 'Add a reason first'} onClick={saveTotal}>Save</button><button type="button" className="bud-btn bud-btn-sm" onClick={() => { setEditing(false); setReason('') }}>Cancel</button></span>
          </>
        ) : (
          <>
            <b>{usd(s.total)}</b><small>Annual, {s.label}</small>
            {canEdit && <button type="button" className="bud-link" onClick={() => { setDraft(s.total.toLocaleString('en-US', { minimumFractionDigits: 2 })); setEditing(true) }}>Change budget</button>}
          </>
        )}
      </SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Spent</span><b>{usd(s.spent)}</b><small>{s.expenseCount} {s.expenseCount === 1 ? 'expense' : 'expenses'} · {s.withReceipts} with {s.withReceipts === 1 ? 'a receipt' : 'receipts'}</small></SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Remaining</span><b>{usd(s.remaining)}</b>
        <small>{closed ? 'Unspent at year end' : s.committed ? `${usd(s.remainingAfterCommitted)} after ${usd(s.committed)} in expected charges` : 'No charges expected yet'}</small>
        {!closed && prop.count > 0 && <span className="bud-if-sub">{usd(s.remaining - prop.fromStart)} if all {prop.count} {prop.count === 1 ? 'subscription is' : 'subscriptions are'} approved from Jul 1</span>}</SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Used</span><b>{pct(s.used)}</b><small>Year elapsed {Math.round(s.elapsed * 100)}%</small>
        <span className="bud-meter" aria-hidden="true"><i className={s.used > 1 ? 'over' : undefined} style={{ width: `${Math.min(100, s.used * 100)}%` }} /><u style={{ left: `calc(${Math.min(100, s.elapsed * 100)}% - 1px)` }} /></span></SurfaceCard>
      {showCps && <SurfaceCard className="bud-tile"><span className="k">Cost per student</span>
        {cps.state === 'ok' && <><b>{usd(cps.value)}</b><small>{cps.cohort} · {usd(cps.spend)} ÷ {cps.size} students</small></>}
        {cps.state === 'size_pending' && <><b><Missing /></b><small>{cps.cohort} · {usd(cps.spend)} tagged · roster size pending</small></>}
      </SurfaceCard>}
    </div>
  )

  const withPlan = s.hasPlan
  const money = (v) => (v ? usd(v) : <Missing />)
  const columns = withPlan ? [
    { key: 'name', label: 'Category', min: 150, grow: 1.6, priority: 1, sortValue: r => r.name },
    { key: 'allocated', label: 'Allocated', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => r.allocated, render: r => (r.allocated ? usd(r.allocated) : <span className="bud-dash">Not set</span>) },
    { key: 'spent', label: 'Spent', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => r.spent, render: r => money(r.spent) },
    { key: 'remaining', label: 'Remaining', min: 90, grow: 0.7, align: 'right', priority: 2, sortValue: r => r.remaining, render: r => (r.allocated ? usd(r.remaining) : <Missing />) },
    { key: 'used', label: 'Used', min: 120, grow: 0.9, align: 'right', priority: 2, sortValue: r => r.used, render: r => (r.used == null ? <Missing /> : <Meter value={r.used} over={r.used > 1} />) },
  ] : [
    { key: 'name', label: 'Category', min: 150, grow: 1.6, priority: 1, sortValue: r => r.name },
    { key: 'spent', label: 'Spent', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => r.spent, render: r => money(r.spent) },
    { key: 'share', label: 'Share of spend', min: 140, grow: 1, align: 'right', priority: 2, sortValue: r => r.share, render: r => (r.spent ? <Meter value={r.share} /> : <Missing />) },
  ]
  const catSub = withPlan
    ? (year.budget?.plan_saved_at ? `${usd(s.total - s.byCategory.reduce((a, c) => a + (c.allocated || 0), 0))} of the budget is not assigned to a category.` : 'Draft. Only you see this plan until Margo approves it on the Plan tab.')
    : `No category plan for ${s.label}${canEdit ? '. Draft one on the Plan tab.' : '. The budget is one annual total.'}`
  // BUDGET-V2 item 6: an empty area says so once, with the next action; never a blank chart.
  const noSpend = !s.byMonth.some(m => m.spent || m.scheduled)
  const noCategorySpend = !s.byCategory.some(c => c.spent) && !withPlan
  // With no plan, a category with no spend says nothing; list the ones that do, and offer the rest.
  const idle = withPlan ? [] : s.byCategory.filter(c => !c.spent)

  // OWNER-NOTE-RETIRE-1 (Owner, 2026-10-03): no Owner Note card in either view. "Last reconciled" is on
  // the year line (BudgetYearLine, lastReconciled). A note already saved stays in the database, unread.
  const history = (
    <SurfaceCard className="bud-card">
      <h2>Budget History</h2><p className="bud-sub">Every change to the annual amount, the category plan and the estimates</p>
      <ul className="bud-hist">
        {year.history.length ? (histOpen ? year.history : year.history.slice(0, HISTORY_PEEK)).map((h, i) => <li key={i}><span className="when">{stamp(h.created_at)}</span><span>{h.message}{h.reason && <span className="bud-hist-why">{h.reason}</span>}{h.actor_name && <small>{h.actor_name}</small>}</span></li>)
          : <li><span className="when">–</span><span>No changes yet</span></li>}
      </ul>
      {year.history.length > HISTORY_PEEK && (
        <button type="button" className="bud-hist-more" aria-expanded={histOpen} onClick={() => setHistOpen(o => !o)}>
          {histOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {histOpen ? 'Show fewer' : `Show all ${year.history.length} changes`}
        </button>
      )}
    </SurfaceCard>
  )

  // BUDGET-V2 item 14: one quiet line about next year's proposal, once it is asked for or started.
  const next = year.next
  const line = proposalLine(next, { approver: !canEdit && !!year.canApprove })
  const askProposal = async () => {
    try { const out = await source.review('proposal_request', {}); onWrite.notify(out.message); onWrite.changed() } catch (e) { onWrite.notify(e.message, 'err') }
  }
  const quiet = (line && (canEdit || next?.plan)) ? (
    <p className="bud-quiet">{line.text} <button type="button" className="bud-linkbtn bud-linkbtn-inline" onClick={() => onOpenYear?.(next.fy)}>{line.action} →</button></p>
  ) : (!canEdit && year.canApprove && next && !next.plan && !next.requested && source?.review) ? (
    <p className="bud-quiet">The {fyShort(next.fy)} proposal has not been started. <button type="button" className="bud-linkbtn bud-linkbtn-inline" onClick={askProposal}>Ask for the {fyShort(next.fy)} proposal →</button></p>
  ) : (!canEdit && next?.requested && !next.plan) ? <p className="bud-quiet">You asked for the {fyShort(next.fy)} proposal.</p> : null

  return (
    <>
      {quiet}
      {basis}
      {pending}
      <BudgetClose year={year} canEdit={canEdit} onWrite={onWrite} onGo={onGo} />
      <div className="bud-two">
        <SurfaceCard className="bud-card"><h2>Monthly Spend</h2><p className="bud-sub">{fyRangeText(year.fy)}{noSpend ? '' : ', against an even monthly pace'}</p>
          {noSpend
            ? <div className="bud-empty bud-empty-box"><b>No spending posted in {s.label} yet</b><span>Bars appear here as you accept receipts and approve subscriptions.</span></div>
            : <MonthlyChart s={s} />}</SurfaceCard>
        <SurfaceCard className="bud-card">
          <h2>By Category</h2><p className="bud-sub">{catSub}</p>
          {noCategorySpend ? (
            <div className="bud-empty bud-empty-box"><b>No spend in any category yet</b><span>All {s.byCategory.length} categories are listed once the first expense posts.</span>
              {canEdit && onGo && <button type="button" className="bud-btn bud-btn-sm" onClick={() => onGo('plan')}>Add a category plan</button>}</div>
          ) : <DataSheet level="plain" columns={columns} rows={showIdle ? s.byCategory : s.byCategory.filter(c => !idle.includes(c))} rowKey={r => r.id} defaultSort={{ key: 'spent', dir: 'desc' }}
            emptyMessage="No categories" aria-label={`Spend by category, ${s.label}`}
            footer={<div className="bud-row2"><span>Total</span><b>{usd(s.spent)}{s.uncategorised ? ` (${usd(s.uncategorised)} with no category)` : ''}</b></div>} />}
          {!noCategorySpend && idle.length > 0 && (
            <p className="bud-hint bud-idle">{showIdle ? '' : `${idle.length} ${idle.length === 1 ? 'category has' : 'categories have'} no spend yet. `}
              <button type="button" className="bud-linkbtn bud-linkbtn-inline" aria-expanded={showIdle} onClick={() => setShowIdle(v => !v)}>{showIdle ? 'Show only categories with spend' : `Show all ${s.byCategory.length}`}</button></p>
          )}
        </SurfaceCard>
      </div>
      {history}
    </>
  )
}
