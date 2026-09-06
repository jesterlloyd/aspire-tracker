// MASTHEAD-SCENE-4/5: the city chooser behind the masthead temperature.
//
// Choosing a city moves the whole masthead there - artwork, weather, and time
// of day together - so the card never mixes one city's skyline with another's
// temperature. Automatic returns to the viewer's own location.
//
// MASTHEAD-PICKER-GRID-1 (Owner, 2026-09-05): the options are a grid of
// picture cards rather than a list. Three across on desktop, two on a
// tablet, one on a phone; every card is a radio in one group, arrow keys
// walk the group, Enter or Space (or a click) chooses. The selection and
// Automatic-location logic is untouched: options, value and the resolved
// label still come from the caller, exactly as before.
//
// Deliberately dependency-free: a centered dialog with a backdrop, Escape to
// close, focus moved to the current choice on open and returned by the
// browser on close, the page locked behind it so a long grid scrolls inside
// the dialog and not the page. Shared by the staff card and all four
// portals, so it can only use app-level (.mast*) classes, never ptl-*.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AUTO, pickerImageFor } from '../../lib/mastheadCityPreference'

export default function CityPickerDialog({ open, options, value, autoResolvedLabel, onSelect, onClose }) {
  const panelRef = useRef(null)
  const selectedRef = useRef(null)
  const gridRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    // Lock the page behind the dialog: the grid scrolls, the page does not.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the current choice so keyboard users land inside the dialog.
    const id = setTimeout(() => { (selectedRef.current || gridRef.current?.querySelector('[role="radio"]'))?.focus() }, 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      clearTimeout(id)
    }
  }, [open, onClose])

  if (!open) return null

  // Arrow keys walk the radio group (focus only; Enter, Space or a click
  // chooses), Home and End jump to the ends.
  const onGridKey = (e) => {
    const radios = [...(gridRef.current?.querySelectorAll('[role="radio"]') || [])]
    const i = radios.indexOf(document.activeElement)
    if (i < 0 || radios.length === 0) return
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    let next = null
    if (step) next = radios[(i + step + radios.length) % radios.length]
    else if (e.key === 'Home') next = radios[0]
    else if (e.key === 'End') next = radios[radios.length - 1]
    if (next) { e.preventDefault(); next.focus() }
  }

  // PORTALLED to the body on purpose: the scenic masthead card carries a
  // clip-path (its rounded frame), which clips every descendant - fixed ones
  // included - so a dialog rendered in place would be sliced by the card.
  return createPortal(
    <div className="mast-citypick-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mast-citypick" role="dialog" aria-modal="true" aria-labelledby="mast-citypick-title" ref={panelRef}>
        <div className="mast-citypick-head">
          <div>
            <h2 className="mast-citypick-title" id="mast-citypick-title">Masthead Scenery</h2>
            <p className="mast-citypick-note">
              Choose the scenery shown in your masthead.<br />
              Automatic follows your current location.
            </p>
          </div>
          <button type="button" className="mast-citypick-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden focusable="false">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <div className="mast-citypick-grid" role="radiogroup" aria-labelledby="mast-citypick-title" ref={gridRef} onKeyDown={onGridKey}>
          {options.map(opt => {
            const selected = opt.key === value
            const img = pickerImageFor(opt.key)
            const isAuto = opt.key === AUTO
            const sub = isAuto && autoResolvedLabel ? autoResolvedLabel : null
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={sub ? `${opt.label}, currently ${sub}` : opt.label}
                ref={selected ? selectedRef : null}
                className={`mast-citypick-card${selected ? ' is-selected' : ''}`}
                onClick={() => { onSelect(opt.key); onClose() }}
              >
                <span className="mast-citypick-frame">
                  {img
                    ? <img className="mast-citypick-img" src={img} alt="" draggable={false} decoding="async" />
                    : <span className="mast-citypick-img mast-citypick-img-empty" aria-hidden />}
                  {selected && (
                    <span className="mast-citypick-check" aria-hidden>
                      <svg viewBox="0 0 20 20" width="12" height="12" focusable="false">
                        <path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    </span>
                  )}
                </span>
                <span className="mast-citypick-label">{opt.label}</span>
                {sub && <span className="mast-citypick-sub">{sub}</span>}
              </button>
            )
          })}
        </div>
        <div className="mast-citypick-actions">
          <button type="button" className="mast-citypick-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
