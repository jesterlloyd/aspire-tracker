// src/components/budget/BudgetAllocations.jsx
//
// PROGRAM-BUDGET A8: the category plan. The owner edits a draft (saved as they leave each field)
// and publishes it with Save plan; leadership and Admin see only a saved plan, and only its
// saved figures (the server never sends them the draft).
import { useMemo, useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import DataSheet, { Missing } from '../shared/DataSheet'
import { usd, allocationTotals, splitEvenly, parseMoney } from '../../lib/budget/budgetModel'

export default function BudgetAllocations({ year, canEdit, onWrite }) {
  const s = year.summary
  const closed = s.state === 'closed'
  const editable = canEdit   // a closed year's plan is editable too (Owner, 2026-09-27)
  const initial = useMemo(() => Object.fromEntries(year.allocations.map(a => [a.category_id, canEdit ? a.amount : a.saved_amount])), [year.allocations, canEdit])
  const [amounts, setAmounts] = useState(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ? v.toLocaleString('en-US') : ''])))
  const value = (id) => parseMoney(amounts[id] || '0') ?? 0
  const totals = allocationTotals(s.total, year.categories.map(c => value(c.id)))
  const spentOf = new Map(s.byCategory.map(c => [c.id, c.spent]))
  const numeric = () => Object.fromEntries(year.categories.map(c => [c.id, value(c.id)]))
  const isDraft = canEdit && !year.budget?.plan_saved_at && Object.values(initial).some(v => v > 0)
  const changedSinceSave = canEdit && year.budget?.plan_saved_at && year.allocations.some(a => a.amount !== a.saved_amount)

  if (closed && !canEdit && !Object.values(initial).some(v => v > 0)) {
    return <SurfaceCard className="bud-empty">{s.label} had no category plan. It ran on one {usd(s.total)} total.</SurfaceCard>
  }

  const saveDraft = () => onWrite.run('allocations_save', { fiscal_year: year.fy, amounts: numeric(), publish: false }, null, { reload: false })
  const even = () => {
    const parts = splitEvenly(s.total, year.categories.length)
    setAmounts(Object.fromEntries(year.categories.map((c, i) => [c.id, parts[i].toLocaleString('en-US')])))
    onWrite.run('allocations_save', { fiscal_year: year.fy, amounts: Object.fromEntries(year.categories.map((c, i) => [c.id, parts[i]])), publish: false }, 'Split evenly as a draft.')
  }
  const publish = () => onWrite.run('allocations_save', { fiscal_year: year.fy, amounts: numeric(), publish: true }, 'Plan saved. Leadership now sees it, and Budget history has the entry.')

  const columns = [
    { key: 'name', label: 'Category', min: 160, grow: 1.6, priority: 1, sortValue: r => r.name },
    { key: 'amount', label: 'Allocation', min: 140, grow: 0.8, align: 'right', priority: 1, sortValue: r => value(r.id),
      render: r => (editable
        ? <span className="bud-money"><span>$</span><input className="bud-input bud-alloc-input" aria-label={`${r.name} allocation`} inputMode="decimal" placeholder="0" value={amounts[r.id] || ''}
            onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))} onBlur={saveDraft} /></span>
        : (value(r.id) ? usd(value(r.id)) : <Missing />)) },
    { key: 'share', label: 'Share', min: 70, grow: 0.5, align: 'right', priority: 2, sortValue: r => value(r.id), render: r => (s.total ? `${((value(r.id) / s.total) * 100).toFixed(1)}%` : <Missing />) },
    { key: 'spent', label: 'Spent', min: 90, grow: 0.7, align: 'right', priority: 1, sortValue: r => spentOf.get(r.id) || 0, render: r => (spentOf.get(r.id) ? usd(spentOf.get(r.id)) : <Missing />) },
  ]

  return (
    <>
      {isDraft && <div className="bud-notice" role="status"><b>Draft.</b>&nbsp;Leadership doesn&apos;t see a category plan until you save it.</div>}
      {changedSinceSave && <div className="bud-notice" role="status"><b>Unsaved changes.</b>&nbsp;Leadership still sees the plan saved {new Date(year.budget.plan_saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</div>}
      <div className="bud-alloc">
        <SurfaceCard className="bud-card">
          <DataSheet level="plain" columns={columns} rows={year.categories} rowKey={r => r.id} defaultSort={null} aria-label={`Category plan, ${s.label}`}
            footer={<div className="bud-row2"><span>Total allocated</span><b>{usd(totals.assigned)} · {s.total ? ((totals.assigned / s.total) * 100).toFixed(1) : '0.0'}%</b></div>} />
        </SurfaceCard>
        <div className="bud">
          <SurfaceCard className="bud-card bud-bal">
            <span className="bud-k">{totals.over ? 'Over-allocated' : 'Unallocated'}</span>
            <span className={`big${totals.over ? ' over' : ''}`}>{usd(Math.abs(totals.left))}</span>
            <div className="bud-stack" aria-hidden="true">{year.categories.filter(c => value(c.id) > 0).map(c => <i key={c.id} title={`${c.name}: ${usd(value(c.id))}`} style={{ width: `${Math.min(100, (value(c.id) / (s.total || 1)) * 100)}%` }} />)}</div>
            <div className="bud-row2"><span>Annual budget</span><b>{usd(s.total)}</b></div>
            <div className="bud-row2"><span>Assigned to categories</span><b>{usd(totals.assigned)}</b></div>
            <p className="bud-hint">Unallocated money stays available to any category.</p>
          </SurfaceCard>
          {editable && (
            <SurfaceCard className="bud-card">
              <div className="bud-actions">
                <button type="button" className="bud-btn bud-btn-pri" disabled={totals.over} onClick={publish}>Save plan</button>
                <button type="button" className="bud-btn" onClick={even}>Split evenly</button>
              </div>
              <p className="bud-hint">{totals.over ? 'The plan is over the budget. Lower an allocation to save it.' : 'Saving publishes the plan to leadership and logs it in Budget history.'}</p>
            </SurfaceCard>
          )}
        </div>
      </div>
    </>
  )
}
