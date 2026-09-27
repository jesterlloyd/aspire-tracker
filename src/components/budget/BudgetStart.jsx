// src/components/budget/BudgetStart.jsx
//
// PROGRAM-BUDGET A4: a fiscal year that has not started. The owner sees the Start form beside
// the prior year's result; a reader is told the year is not published yet.
import { useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import { Missing } from '../shared/DataSheet'
import { usd, fyShort, fyRangeText, parseMoney, DEFAULT_TOTAL, DEFAULT_COST_CENTER } from '../../lib/budget/budgetModel'

export default function BudgetStart({ year, canEdit, onWrite, onPickYear }) {
  const label = fyShort(year.fy)
  const prior = year.prior
  const [total, setTotal] = useState((prior?.total ?? DEFAULT_TOTAL).toLocaleString('en-US', { minimumFractionDigits: 2 }))
  const [cc, setCc] = useState(prior?.cost_center || DEFAULT_COST_CENTER)
  const [plan, setPlan] = useState('none')
  const [busy, setBusy] = useState(false)

  if (!canEdit) {
    return (
      <SurfaceCard className="bud-empty">
        The {label} budget isn&apos;t published yet.{' '}
        {year.proposals?.count > 0 && <>{year.proposals.count} {year.proposals.count === 1 ? 'subscription is' : 'subscriptions are'} proposed for approval; see Subscriptions.{' '}</>}
        {year.years.includes(year.fy - 1) && <button type="button" className="bud-link" onClick={() => onPickYear(year.fy - 1)}>View {fyShort(year.fy - 1)}</button>}
      </SurfaceCard>
    )
  }

  const start = async () => {
    const v = parseMoney(total)
    if (v == null) { onWrite.notify('Enter the annual budget in dollars.', 'err'); return }
    setBusy(true)
    await onWrite.run('start_year', { fiscal_year: year.fy, total: v, cost_center: cc, plan }, `${label} started.`)
    setBusy(false)
  }

  return (
    <div className="bud-setup">
      <SurfaceCard className="bud-card">
        <h2>Start {label}</h2>
        <p className="bud-sub">{fyRangeText(year.fy)}.{prior ? ` ${prior.label} closes and stays available as history.` : ''}</p>
        <div className="bud-fld">
          <label htmlFor="bud-total">Annual budget</label>
          <span className="bud-money"><span>$</span><input id="bud-total" className="bud-input" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></span>
          <small>You can change this at any time. Each change is logged with the date and the old and new amounts.</small>
        </div>
        <div className="bud-fld">
          <label htmlFor="bud-cc">Cost center</label>
          <input id="bud-cc" className="bud-input" value={cc} maxLength={80} onChange={e => setCc(e.target.value)} />
        </div>
        <div className="bud-fld">
          <span className="lab">Categories</span>
          <span className="bud-opt"><input type="checkbox" checked disabled aria-label="Use the same categories" /><span>Use the same {year.categories.length} categories{prior ? ` as ${prior.label}` : ''}</span></span>
        </div>
        <div className="bud-fld" role="radiogroup" aria-label="Category plan">
          <span className="lab">Category plan</span>
          <label className="bud-opt"><input type="radio" name="bud-plan" checked={plan === 'none'} onChange={() => setPlan('none')} /><span>Start with no category plan<small>Add allocations in the Allocations tab when you&apos;re ready.</small></span></label>
          <label className="bud-opt"><input type="radio" name="bud-plan" checked={plan === 'even'} onChange={() => setPlan('even')} /><span>Split the budget evenly as a draft<small>A starting point to edit. Leadership doesn&apos;t see it until you save.</small></span></label>
        </div>
        <div className="bud-fld"><span><button type="button" className="bud-btn bud-btn-pri" disabled={busy} onClick={start}>{busy ? 'Starting…' : `Start ${label}`}</button></span></div>
      </SurfaceCard>
      {prior && (
        <SurfaceCard className="bud-card">
          <h2>{prior.label} Result</h2>
          <p className="bud-sub">Closed {fyRangeText(prior.fy).split(' to ')[1]}</p>
          <div className="bud-row2"><span>Budget</span><b>{usd(prior.total)}</b></div>
          <div className="bud-row2"><span>Spent</span><b>{usd(prior.spent)}</b></div>
          <div className="bud-row2"><span>Used</span><b>{(prior.used * 100).toFixed(1)}%</b></div>
          <div className="bud-row2"><span>Largest category</span><b>{prior.largestCategory || <Missing />}</b></div>
          <div className="bud-row2"><span>Cost per student</span><b>{prior.costPerStudent?.state === 'ok' ? `${usd(prior.costPerStudent.value)} (${prior.costPerStudent.cohort})` : <Missing />}</b></div>
        </SurfaceCard>
      )}
    </div>
  )
}
