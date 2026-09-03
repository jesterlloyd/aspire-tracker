// src/components/Header/scope/ScopePicker.jsx
//
// SCOPE-PICKER-1: one header control for both scope dimensions, replacing the adjacent
// Experience and Cohort pills (and, in Residency, the separate residency cohort pill).
//
// THE TWO PANES ARE NOT THE SAME KIND OF THING, and the design has to admit it:
//   EXPERIENCE navigates. Choosing Residency leaves the ASPIRE workspace for the NGRP
//     one and restores that experience's last-used tab. It commits immediately, which
//     is exactly what the old Experience pill did.
//   COHORT filters. It changes what the current workspace is scoped to and moves you
//     nowhere. Every ASPIRE query filters on the selected cohort.
// Because Experience commits immediately, the cohort pane only ever lists the
// experience you are ALREADY in. There is no preview of the other side, so residency
// cycles are still fetched only inside the residency workspace by an authorized
// caller, exactly as NGRP-WORKSPACE-1 shipped it. Merging the pills did not widen that.
//
// A dropdown, not a modal or drawer: changing cohort is the frequent act and stays one
// click, and the existing .chart-cohort-dropdown treatment carries over rather than
// introducing an overlay layer with its own focus trap.
//
// The pill omits the experience name when the caller has only one experience. See
// scopePillValue in src/lib/scopePickerLabels.js for why.
import { useState, useRef, useEffect, isValidElement, cloneElement } from 'react'
import Tooltip from '../../ui/Tooltip'
import { scopePillValue } from '../../../lib/scopePickerLabels'

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
}

/**
 * @param experiences        [{ id, label, sub }] - one entry when the caller holds no
 *                           residency access, so the pane is honest rather than absent
 * @param activeExperience   id of the current experience
 * @param onSwitchExperience (id) => void; navigates, so it also closes the picker
 * @param cohortLabel        the cohort half of the pill (may be a state, not a name)
 * @param cohortLive         green dot: accepting submissions / an open residency cycle
 * @param cohortLabelDimmed  the label is a state ("Cohorts unavailable"), not a choice
 * @param cohortPane         the cohort list for the CURRENT experience
 */
export default function ScopePicker({
  experiences = [],
  activeExperience,
  onSwitchExperience,
  cohortLabel,
  cohortLive = false,
  cohortLabelDimmed = false,
  cohortPane = null,
}) {
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

  const current = experiences.find(x => x.id === activeExperience) || experiences[0] || null
  const multiExperience = experiences.length > 1
  const value = scopePillValue({
    experienceLabel: current?.label || '',
    cohortLabel,
    multiExperience,
  })

  return (
    <div
      ref={areaRef}
      className="chart-cohort-area"
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); closeAndRefocus() } }}
    >
      <Tooltip label="Change scope" placement="bottom">
        <button
          ref={triggerRef}
          data-tour="scope-switcher"
          aria-label="Change scope"
          aria-expanded={open}
          onClick={() => setOpen(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 999, padding: '7px 13px',
            color: '#fff', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif',
            transition: 'background 0.15s', minWidth: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: cohortLive ? '#5DD39E' : '#9ca3af', boxShadow: cohortLive ? '0 0 0 3px rgba(93,211,158,0.2)' : 'none' }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2, flexShrink: 0 }}>Scope</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, opacity: cohortLabelDimmed ? 0.7 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
          <span style={{ opacity: 0.5, lineHeight: 0, marginLeft: 2, flexShrink: 0 }}><HeaderChevron /></span>
        </button>
      </Tooltip>

      {open && (
        <div className="chart-cohort-dropdown chart-scope-dropdown">
          <div className="chart-scope-pane chart-scope-pane-experience">
            <div className="chart-scope-kicker">Experience</div>
            <div role="listbox" aria-label="Experience">
              {experiences.map(x => {
                const isSel = x.id === activeExperience
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => { if (!isSel) onSwitchExperience(x.id); closeAndRefocus() }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', border: 'none',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      padding: '12px 14px', cursor: 'pointer',
                      background: isSel ? '#e8edf8' : 'transparent',
                      borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--sand)' }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{x.label}</div>
                    <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>{x.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="chart-scope-pane chart-scope-pane-cohort">
            <div className="chart-scope-kicker">Cohort</div>
            {/* Close only, no refocus: the footer's Edit and Add both open a
                dialog, and that dialog owns focus from the moment it mounts
                (ModalShell restores it to the opener on close). Sending focus
                back to the pill here would fight it. */}
            {isValidElement(cohortPane) ? cloneElement(cohortPane, { onDone: () => setOpen(false) }) : cohortPane}
          </div>
        </div>
      )}
    </div>
  )
}
