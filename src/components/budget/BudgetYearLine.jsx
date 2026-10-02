// src/components/budget/BudgetYearLine.jsx
//
// BUDGET-POLISH-1 (Owner, 2026-09-29): the year's one line, "FY27 · Current · Nursing Education
// 8720000 · Jul 1, 2026 to Jun 30, 2027", in the Settings band's subtitle slot instead of a line of
// its own, to save vertical space. The owner edits the cost center from it: a small popover, so the
// band keeps its one fixed line (SETTINGS-BAND-1).
//
// COST-CENTER-FIX-1 (Owner, 2026-10-02: "the changes wouldn't stick"): the band's subtitle is a fixed
// 20px line with overflow hidden, so a popover hanging below it was cut off: the field showed and its
// Save button never did. The popover is drawn on <body> at the button's place instead (fixed), where
// nothing clips it. Enter saves; Escape and a click elsewhere close it.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fyRangeText, STATE_CHIP } from '../../lib/budget/budgetModel'

export default function BudgetYearLine({ year, canEdit, onWrite }) {
  const cc = year.budget?.cost_center || ''
  const editable = canEdit && (year.state === 'current' || year.state === 'closed') && !!year.budget
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(cc)
  const [apply, setApply] = useState(true)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const pop = useRef(null)
  const [at, setAt] = useState(null)                  // where the button is, for the popover
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    const place = () => { const r = ref.current?.getBoundingClientRect(); if (r) setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 348)) }) }
    place()
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])
  const save = async () => {
    if (busy || !draft.trim() || draft.trim() === cc) return
    setBusy(true)
    if (await onWrite.run('set_cost_center', { fiscal_year: year.fy, cost_center: draft, apply_to_rows: apply })) setOpen(false)
    setBusy(false)
  }
  return (
    <span className="bud-yearline">
      <span className={`bud-chip bud-chip-sm bud-chip-${year.state}`}>{year.label} · {STATE_CHIP[year.state]}</span>
      {cc && (editable
        ? <span className="bud-ccline" ref={ref}>
            <button type="button" className="bud-cc-btn" aria-expanded={open} title="Change the cost center" onClick={() => { setDraft(cc); setOpen(o => !o) }}>{cc}</button>
            {open && at && createPortal((
              <span className="bud-cc-pop" role="dialog" aria-label="Cost center" ref={pop} style={{ top: at.top, left: at.left }}>
                <label className="bud-fld"><span>Cost center</span>
                  <input className="bud-input" value={draft} maxLength={80} autoFocus onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} /></label>
                <label className="bud-cc-apply"><input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)} />Also update this year’s rows that show the old one (closed months stay as they are)</label>
                <span className="bud-close-acts">
                  <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || !draft.trim() || draft.trim() === cc} onClick={save}>Save</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
                </span>
              </span>
            ), document.body)}
          </span>
        : <span>{cc}</span>)}
      <span>{fyRangeText(year.fy)}</span>
    </span>
  )
}
