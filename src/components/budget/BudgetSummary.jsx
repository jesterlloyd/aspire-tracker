// src/components/budget/BudgetSummary.jsx
//
// PROGRAM-BUDGET A6: the Summary. Every figure is year.summary, computed by
// src/lib/budget/budgetModel.js on the server; nothing is computed here but layout.
//   1. Leadership: the owner's note and last reconciled date, above the figures.
//   2. The basis line: Budget, Spent, Remaining, Used, Cost per student.
//   3. Monthly spend against an even pace, with scheduled subscription charges dashed.
//   4. By category: a DataSheet plain sheet (table canon row 9).
//   5. The owner's note card, beside Budget history.
import { useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import DataSheet, { Missing } from '../shared/DataSheet'
import { usd, fyRangeText, parseMoney } from '../../lib/budget/budgetModel'

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
                  <title>{m.month}: {usd(m.scheduled)} in scheduled subscription charges</title>
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
        <text x={W - R} y={y(s.evenPace) - 6} textAnchor="end">Pace {k(s.evenPace)}/mo</text>
      </svg>
      <div className="bud-legend">
        <span><i />Spent in month</span>
        {s.state === 'current' && <span><i className="pj" />Scheduled subscriptions</span>}
        <span><i className="p" />Even pace ({usd(s.evenPace)} per month)</span>
      </div>
      {/* The table view of the chart, for a screen reader. */}
      <table className="bud-sr"><caption>Monthly spend, {s.label}</caption><thead><tr><th>Month</th><th>Spent</th><th>Scheduled</th></tr></thead>
        <tbody>{s.byMonth.map(m => <tr key={m.month}><td>{m.month}</td><td>{usd(m.spent)}</td><td>{usd(m.scheduled)}</td></tr>)}</tbody></table>
    </>
  )
}

export default function BudgetSummary({ year, canEdit, onWrite }) {
  const s = year.summary
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState(year.budget?.owner_note || '')
  const reader = !canEdit
  const closed = s.state === 'closed'

  const saveTotal = async () => {
    const v = parseMoney(draft)
    if (v == null) { onWrite.notify('Enter the budget in dollars, like 42,500.00.', 'err'); return }
    if (await onWrite.run('set_total', { fiscal_year: year.fy, total: v }, 'Budget changed. Budget history has the old and new amounts.')) setEditing(false)
  }

  const cps = s.costPerStudent
  const basis = (
    <div className="bud-basis">
      <SurfaceCard className="bud-tile">
        <span className="k">Budget</span>
        {editing ? (
          <>
            <span className="bud-money"><span>$</span><input className="bud-input" aria-label="Annual budget" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTotal(); if (e.key === 'Escape') setEditing(false) }} autoFocus /></span>
            <span className="bud-actions"><button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={saveTotal}>Save</button><button type="button" className="bud-btn bud-btn-sm" onClick={() => setEditing(false)}>Cancel</button></span>
          </>
        ) : (
          <>
            <b>{usd(s.total)}</b><small>Annual, {s.label}</small>
            {canEdit && <button type="button" className="bud-link" onClick={() => { setDraft(s.total.toLocaleString('en-US', { minimumFractionDigits: 2 })); setEditing(true) }}>Change budget</button>}
          </>
        )}
      </SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Spent</span><b>{usd(s.spent)}</b><small>{s.expenseCount} expenses · {s.withReceipts} with receipts</small></SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Remaining</span><b>{usd(s.remaining)}</b>
        <small>{closed ? 'Unspent at year end' : `${usd(s.remainingAfterCommitted)} after ${usd(s.committed)} in subscriptions due`}</small></SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Used</span><b>{pct(s.used)}</b><small>Year elapsed {Math.round(s.elapsed * 100)}%</small>
        <span className="bud-meter" aria-hidden="true"><i className={s.used > 1 ? 'over' : undefined} style={{ width: `${Math.min(100, s.used * 100)}%` }} /><u style={{ left: `calc(${Math.min(100, s.elapsed * 100)}% - 1px)` }} /></span></SurfaceCard>
      <SurfaceCard className="bud-tile"><span className="k">Cost per student</span>
        {cps.state === 'ok' && <><b>{usd(cps.value)}</b><small>{cps.cohort} · {usd(cps.spend)} ÷ {cps.size} students</small></>}
        {cps.state === 'size_pending' && <><b><Missing /></b><small>{cps.cohort} · {usd(cps.spend)} tagged · roster size pending</small></>}
        {cps.state === 'untagged' && <><b><Missing /></b><small>Tag expenses to a cohort to see this</small></>}
      </SurfaceCard>
    </div>
  )

  const withPlan = s.hasPlan
  const money = (v) => (v ? usd(v) : <Missing />)
  const columns = withPlan ? [
    { key: 'name', label: 'Category', min: 150, grow: 1.6, priority: 1, sortValue: r => r.name },
    { key: 'allocated', label: 'Allocated', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => r.allocated, render: r => money(r.allocated) },
    { key: 'spent', label: 'Spent', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => r.spent, render: r => money(r.spent) },
    { key: 'remaining', label: 'Remaining', min: 90, grow: 0.7, align: 'right', priority: 2, sortValue: r => r.remaining, render: r => (r.allocated ? usd(r.remaining) : <Missing />) },
    { key: 'used', label: 'Used', min: 120, grow: 0.9, align: 'right', priority: 2, sortValue: r => r.used, render: r => (r.used == null ? <Missing /> : <Meter value={r.used} over={r.used > 1} />) },
  ] : [
    { key: 'name', label: 'Category', min: 150, grow: 1.6, priority: 1, sortValue: r => r.name },
    { key: 'spent', label: 'Spent', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => r.spent, render: r => money(r.spent) },
    { key: 'share', label: 'Share of spend', min: 140, grow: 1, align: 'right', priority: 2, sortValue: r => r.share, render: r => (r.spent ? <Meter value={r.share} /> : <Missing />) },
  ]
  const catSub = withPlan
    ? (year.budget?.plan_saved_at ? `${usd(s.total - s.byCategory.reduce((a, c) => a + (c.allocated || 0), 0))} of the budget is not assigned to a category.` : 'Draft. Only you see this plan until you save it in Allocations.')
    : `No category plan for ${s.label}${canEdit ? '. Add one in Allocations.' : '. The budget is one annual total.'}`

  const noteCard = canEdit ? (
    <SurfaceCard className="bud-card bud-note">
      <h2>Owner Note</h2><p className="bud-sub">Leadership sees this above the figures.</p>
      <label className="bud-sr" htmlFor="bud-note">Owner note</label>
      <textarea id="bud-note" className="bud-textarea" value={note} maxLength={2000} placeholder="Context leadership needs to read these numbers correctly"
        onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== (year.budget?.owner_note || '')) onWrite.run('set_note', { fiscal_year: year.fy, note }, 'Note saved.') }} />
      <div className="bud-rec"><span>Last reconciled: <b>{year.budget?.last_reconciled_at ? stamp(year.budget.last_reconciled_at) : 'Not yet'}</b></span>
        {<button type="button" className="bud-btn bud-btn-sm" onClick={() => onWrite.run('mark_reconciled', { fiscal_year: year.fy }, 'Marked reconciled today.')}>Mark reconciled today</button>}</div>
    </SurfaceCard>
  ) : (
    <SurfaceCard className="bud-card bud-note">
      <h2>From the Program Owner</h2><p className="bud-sub">Last reconciled: {year.budget?.last_reconciled_at ? stamp(year.budget.last_reconciled_at) : 'not yet'}</p>
      {year.budget?.owner_note ? <blockquote>{year.budget.owner_note}</blockquote> : <p className="bud-hint">No note.</p>}
    </SurfaceCard>
  )
  const history = (
    <SurfaceCard className="bud-card">
      <h2>Budget History</h2><p className="bud-sub">Every change to the annual amount and the category plan</p>
      <ul className="bud-hist">
        {year.history.length ? year.history.map((h, i) => <li key={i}><span className="when">{stamp(h.created_at)}</span><span>{h.message}{h.actor_name && <small>{h.actor_name}</small>}</span></li>)
          : <li><span className="when">–</span><span>No changes yet</span></li>}
      </ul>
    </SurfaceCard>
  )

  return (
    <>
      {reader && noteCard}
      {basis}
      {year.proposals?.count > 0 && (
        <p className="bud-hint" role="note">{year.proposals.count} {year.proposals.count === 1 ? 'subscription is' : 'subscriptions are'} awaiting approval ({usd(year.proposals.monthly)} a month) and not counted in these figures. See Subscriptions.</p>
      )}
      <div className="bud-two">
        <SurfaceCard className="bud-card"><h2>Monthly Spend</h2><p className="bud-sub">{fyRangeText(year.fy)}, against an even monthly pace</p><MonthlyChart s={s} /></SurfaceCard>
        <SurfaceCard className="bud-card">
          <h2>By Category</h2><p className="bud-sub">{catSub}</p>
          <DataSheet level="plain" columns={columns} rows={s.byCategory} rowKey={r => r.id} defaultSort={{ key: 'spent', dir: 'desc' }}
            emptyMessage="No categories" aria-label={`Spend by category, ${s.label}`}
            footer={<div className="bud-row2"><span>Total</span><b>{usd(s.spent)}{s.uncategorised ? ` (${usd(s.uncategorised)} with no category)` : ''}</b></div>} />
        </SurfaceCard>
      </div>
      <div className="bud-two">{canEdit ? noteCard : null}{history}</div>
    </>
  )
}
