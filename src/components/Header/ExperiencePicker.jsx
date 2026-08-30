// NGRP-WORKSPACE-1 (correction 2): the Experience picker - the header's
// entry point to the two experiences, replacing the earlier segmented
// ASPIRE | NGRP switcher:
//   Internship -> the existing ASPIRE workspace (unchanged)
//   Residency  -> the NGRP workspace
// It sits in the right-side control cluster directly BESIDE the Cohort
// picker (before search), in the same dark translucent pill + dropdown
// treatment, so "which experience, which cohort" reads as one adjacent pair.
// App.jsx renders it ONLY for profiles holding the ngrp_access capability -
// for everyone else the control (and with it the Residency option) simply
// does not exist. Switching restores each experience's last operational tab
// and never changes the other experience's cohort selection.
import { useState, useRef, useEffect } from 'react'
import Tooltip from '../ui/Tooltip'

const EXPERIENCES = [
  { id: 'internship', label: 'Internship', sub: 'ASPIRE student pathway' },
  { id: 'residency',  label: 'Residency',  sub: 'New-graduate RN residency (NGRP)' },
]

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
}

export default function ExperiencePicker({ active, onSwitch }) {
  const [open, setOpen] = useState(false)
  const areaRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    const handler = e => { if (areaRef.current && !areaRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Keyboard completion: closing the dropdown (Escape, or a selection made by
  // Enter/Space/click) hands focus back to the trigger pill.
  const closeAndRefocus = () => { setOpen(false); triggerRef.current?.focus() }

  const current = EXPERIENCES.find(x => x.id === active) || EXPERIENCES[0]

  return (
    <div
      ref={areaRef}
      className="chart-cohort-area"
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); closeAndRefocus() } }}
    >
      <Tooltip label="Switch experience" placement="bottom">
        <button
          ref={triggerRef}
          data-tour="experience-switcher"
          aria-label="Switch experience"
          aria-expanded={open}
          onClick={() => setOpen(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 999, padding: '7px 13px',
            color: '#fff', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>Experience</span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{current.label}</span>
          <span style={{ opacity: 0.5, lineHeight: 0, marginLeft: 2 }}><HeaderChevron /></span>
        </button>
      </Tooltip>

      {open && (
        <div className="chart-cohort-dropdown" role="listbox" aria-label="Experience">
          <div style={{ padding: '10px 14px 6px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--sand)' }}>
            Select Experience
          </div>
          {EXPERIENCES.map(x => {
            const isSel = x.id === active
            return (
              // Native button: Enter/Space activation for free, no synthetic
              // key handling. Styling matches the previous rows exactly.
              <button
                key={x.id}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => { if (!isSel) onSwitch(x.id); closeAndRefocus() }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  fontFamily: 'DM Sans, sans-serif',
                  padding: '14px 16px', cursor: 'pointer',
                  background: isSel ? '#e8edf8' : 'transparent',
                  borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--sand)' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{x.label}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{x.sub}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
