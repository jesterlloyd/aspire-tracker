// MASTHEAD-SCENE-4/5: the small city chooser behind the masthead temperature.
//
// Choosing a city moves the whole masthead there - artwork, weather, and time
// of day together - so the card never mixes one city's skyline with another's
// temperature. The dialog says so in one line rather than leaving it to be
// inferred, and Automatic returns to the viewer's own location.
//
// Deliberately tiny and dependency-free: a centered dialog with a backdrop,
// Escape to close, focus moved to the current choice on open and returned to
// the trigger on close, and a radio group so a screen reader announces the
// selection state. Shared by the staff card and all four portals, so it can
// only use app-level (.mast*) classes, never portal-scoped ptl-* ones.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AUTO } from '../../lib/mastheadCityPreference'

export default function CityPickerDialog({ open, options, value, autoResolvedLabel, onSelect, onClose }) {
  const panelRef = useRef(null)
  const selectedRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    // Focus the current choice so keyboard users land inside the dialog.
    const id = setTimeout(() => { selectedRef.current?.focus() }, 0)
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(id) }
  }, [open, onClose])

  if (!open) return null

  // PORTALLED to the body on purpose: the scenic masthead card carries a
  // clip-path (its rounded frame), which clips every descendant - fixed ones
  // included - so a dialog rendered in place would be sliced by the card.
  return createPortal(
    <div className="mast-citypick-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mast-citypick" role="dialog" aria-modal="true" aria-labelledby="mast-citypick-title" ref={panelRef}>
        <h2 className="mast-citypick-title" id="mast-citypick-title">Masthead Scenery</h2>
        <p className="mast-citypick-note">
          The masthead shows this city&rsquo;s artwork and weather. Automatic follows wherever you are.
        </p>
        <div className="mast-citypick-list" role="radiogroup" aria-labelledby="mast-citypick-title">
          {options.map(opt => {
            const selected = opt.key === value
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={selected}
                ref={selected ? selectedRef : null}
                className={`mast-citypick-opt${selected ? ' is-selected' : ''}`}
                onClick={() => { onSelect(opt.key); onClose() }}
              >
                <span className="mast-citypick-label">{opt.label}</span>
                {opt.key === AUTO && autoResolvedLabel && (
                  <span className="mast-citypick-sub">Currently {autoResolvedLabel}</span>
                )}
                {selected && <span className="mast-citypick-check" aria-hidden>✓</span>}
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
