// src/components/budget/BudgetYearLine.jsx
//
// BUDGET-POLISH-1 (Owner, 2026-09-29): the year's one line, "FY27 · Current · Nursing Education
// 8720000 · Jul 1, 2026 to Jun 30, 2027", in the Settings band's subtitle slot instead of a line of
// its own, to save vertical space. The owner edits the cost center from it: a small popover, so the
// band keeps its one fixed line (SETTINGS-BAND-1).
import { useEffect, useRef, useState } from 'react'
import { fyRangeText, STATE_CHIP } from '../../lib/budget/budgetModel'

export default function BudgetYearLine({ year, canEdit, onWrite }) {
  const cc = year.budget?.cost_center || ''
  const editable = canEdit && (year.state === 'current' || year.state === 'closed') && !!year.budget
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(cc)
  const [apply, setApply] = useState(true)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const save = async () => {
    setBusy(true)
    if (await onWrite.run('set_cost_center', { fiscal_year: year.fy, cost_center: draft, apply_to_rows: apply })) setOpen(false)
    setBusy(false)
  }
  return (
    <span className="bud-yearline">
      <span className={`bud-chip bud-chip-sm bud-chip-${year.state}`}>{year.label} · {STATE_CHIP[year.state]}</span>
      {cc && (editable
        ? <span className="bud-cc" ref={ref}>
            <button type="button" className="bud-cc-btn" aria-expanded={open} title="Change the cost center" onClick={() => { setDraft(cc); setOpen(o => !o) }}>{cc}</button>
            {open && (
              <span className="bud-cc-pop" role="dialog" aria-label="Cost center">
                <label className="bud-fld"><span>Cost center</span>
                  <input className="bud-input" value={draft} maxLength={80} autoFocus onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} /></label>
                <label className="bud-cc-apply"><input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)} />Also update this year’s rows that show the old one (closed months stay as they are)</label>
                <span className="bud-close-acts">
                  <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || !draft.trim() || draft.trim() === cc} onClick={save}>Save</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
                </span>
              </span>
            )}
          </span>
        : <span>{cc}</span>)}
      <span>{fyRangeText(year.fy)}</span>
    </span>
  )
}
