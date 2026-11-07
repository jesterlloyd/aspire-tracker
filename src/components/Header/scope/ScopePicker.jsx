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
// SCOPE-COMMIT-ON-COHORT-1 (Owner, 2026-11-07), replacing SCOPE-STAY-OPEN-1: choosing an
// experience does NOTHING to the screen. It only turns the cohort pane beside it into that
// experience's cohorts. The switch happens when a cohort is clicked: Internship > Winter 2027 to
// Residency > Winter 2027 is pill, Residency, Winter 2027, and only the last click moves anything.
// So the pane can list the experience you are NOT in, which means residency cycles are fetched
// when an authorized caller browses to Residency here (onPreviewExperience), not only inside the
// residency workspace. The caller is the same one NGRP-WORKSPACE-1 authorized; nothing widened.
//
// A dropdown, not a modal or drawer: changing cohort is the frequent act and stays one
// click, and the existing .chart-cohort-dropdown treatment carries over rather than
// introducing an overlay layer with its own focus trap.
//
// The pill omits the experience name when the caller has only one experience. See
// scopePillValue in src/lib/scopePickerLabels.js for why.
import { useState, useRef, useEffect, isValidElement, cloneElement } from 'react'
import Tooltip from '../../ui/Tooltip'
import { scopePillValue, cohortStatusTone } from '../../../lib/scopePickerLabels'

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
}

/**
 * @param experiences        [{ id, label, sub }] - one entry when the caller holds no
 *                           residency access, so the pane is honest rather than absent
 * @param activeExperience   id of the current experience
 * @param onPreviewExperience (id) => void; the pane now shows that experience (no navigation)
 * @param cohortLabel        the cohort half of the pill (may be a state, not a name)
 * @param cohortIsDemo       the selected cohort is the fabricated one; turns the status
 *                           light purple, which is how demo mode announces itself
 * @param cohortStatus       the selected cohort's status; the dot reads it through
 *                           cohortStatusTone (SCOPE-DOT-1: Active green, Planning
 *                           yellow, Completed muted rose, otherwise neutral)
 * @param cohortLabelDimmed  the label is a state ("Cohorts unavailable"), not a choice
 * @param cohortPanes        { [experienceId]: element }, each experience's cohort list; a cohort
 *                           click in a pane that is not the current experience switches to it
 */
export default function ScopePicker({
  experiences = [],
  activeExperience,
  onPreviewExperience,
  cohortLabel,
  cohortStatus = null,
  cohortIsDemo = false,
  cohortLabelDimmed = false,
  cohortPanes = {},
}) {
  const [open, setOpenState] = useState(false)
  // The experience whose cohorts the pane is showing; null means the current one. Every close
  // forgets it, so the picker always reopens on where you are.
  const [browsing, setBrowsing] = useState(null)
  const setOpen = value => { setOpenState(value); if (!value) setBrowsing(null) }
  const shown = browsing || activeExperience
  // DEMO-MODE-1: the demo cohort turns this light purple. See DEMO_TONE.
  const tone = cohortStatusTone(cohortStatus, cohortIsDemo)
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
          onClick={() => setOpen(!open)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 10, height: 'var(--header-control-height, 36px)', boxSizing: 'border-box', padding: '0 13px',
            color: '#fff', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif',
            transition: 'background 0.15s', minWidth: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <span data-cohort-status={cohortIsDemo ? 'demo' : (cohortStatus || 'none')} style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: tone.dot, boxShadow: tone.halo === 'none' ? 'none' : `0 0 0 3px ${tone.halo}` }} />
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
                const isSel = x.id === shown
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => { setBrowsing(x.id); onPreviewExperience?.(x.id) }}
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
            {(() => {
              const pane = cohortPanes[shown] ?? null
              return isValidElement(pane) ? cloneElement(pane, { key: shown, onDone: () => setOpen(false) }) : pane
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
