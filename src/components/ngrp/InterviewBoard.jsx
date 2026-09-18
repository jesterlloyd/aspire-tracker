// INTERVIEW-BOARD-1 (Owner, 2026-09-17): Residency > Interview Board.
//
// IT IS THE PLACEMENT BOARD, wearing the nouns this side of the app uses. Same
// materials, same paper notes, same pins, same ribbons, same drag (the shared
// useBoardDrag), same pastel unit boards, same headerless KPI band. Interviewees on
// the left, Hiring Units on the right, because a matching board reads the same way
// everywhere in this app. What differs is only what the two sides mean:
//
//   - Pairing someone with a unit means that unit will INTERVIEW them. It is not a
//     hire; the hire is recorded in the applicant drawer, the same drawer Profiles &
//     Interest opens, once Talent Acquisition confirms it.
//   - A RANKED PREFERENCE IS NOT AN ASSIGNMENT. Preferences come from the person's
//     own Transition Form; the assignment is HR's decision. When HR pairs someone
//     with a unit they never ranked, the pin says so rather than implying a match.
//   - NO RUBRICS AND NO SCORES. This program records who was interviewed and who was
//     hired, never how anyone was graded. Interviewees are never ranked against each
//     other.
//
// UNPAIRING IS IMMEDIATE HERE, unlike the Placement Board's ten-second hold. It has
// to destroy nothing to be undone: one field, one endpoint, no preceptor to clear, no
// status to revert, no notification records to orphan. So the write goes straight
// through and the toast offers an Undo that simply pairs them again.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNgrpPlanning, useNgrpApplicants, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows, effectiveEligibility, ELIGIBILITY_STATES, INTERVIEW_STATES } from '../../lib/ngrp/ngrpStates'
import { displayName } from '../../lib/utils'
import { UNIT_CATALOG } from '../../lib/unitCatalog'
import { KPICell } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import ApplicantDrawer from './ApplicantDrawer'
import { useBoardDrag } from '../placement/useBoardDrag'
import { RANK_TONE } from '../../lib/placementBoardView'
import '../placement/placementBoard.css'
import {
  placeableRows, preferencesOf, unitPool, placementSummary,
  preferenceCounts, topChoicePct, preferenceRankFor,
  orderInterviewees, groupIntervieweesForUnit, pinForAssignment,
} from '../../lib/ngrp/ngrpPlacement'

const nameOf = r => displayName(r.student)
const DIVISION_OF = new Map(UNIT_CATALOG.map(u => [u.name.toLowerCase(), u.division]))
const DESC_OF = new Map(UNIT_CATALOG.map(u => [u.name.toLowerCase(), u.description]))

// ── The KPI band: the Placement Board's, cell for cell, with no title row ─────
function InterviewOverview({ summary, prefCounts }) {
  const topPct = topChoicePct(prefCounts)
  const recorded = prefCounts.top + prefCounts.second + prefCounts.other
  const pairedSub = (() => {
    const parts = []
    if (prefCounts.top > 0) parts.push(`${prefCounts.top} 1st choice`)
    if (prefCounts.second > 0) parts.push(`${prefCounts.second} 2nd choice`)
    if (prefCounts.other > 0) parts.push(`${prefCounts.other} 3rd choice`)
    if (prefCounts.notRecorded > 0) parts.push(`${prefCounts.notRecorded} not ranked`)
    return parts.length ? parts.join(' · ') : 'Pending a unit'
  })()

  return (
    <section className="snap pb-glance" aria-label="Interview Board at a Glance">
      <div className="glance-kpis snap-kpis">
        <KPICell value={summary.inPool}  label="Interviewees" sub={`${summary.units} hiring unit${summary.units === 1 ? '' : 's'}`} />
        <KPICell value={summary.placed}  label="Paired"       sub={pairedSub} accent="sage" />
        <KPICell value={summary.unplaced} label="Not Paired"  sub="Waiting for a unit" accent={summary.unplaced > 0 ? 'warning' : null} />
        <KPICell
          value={summary.seats == null ? '-' : Math.max(0, summary.seats - summary.placed)}
          label="Open Seats"
          sub={summary.seats == null ? 'Some units have no number set' : `of ${summary.seats} total`}
        />
        <KPICell
          value={topPct !== null ? `${topPct}%` : '-'}
          label="Top Choice"
          sub={topPct !== null
            ? `of ${recorded} ranked pairing${recorded !== 1 ? 's' : ''}`
            : summary.placed > 0 ? 'No pairing matched a ranked choice' : 'No pairings yet'}
        />
      </div>
    </section>
  )
}

// ── One interviewee, as a paper note ─────────────────────────────────────────
function IntervieweeNote({
  row, units, isSelected, isDragging, isDimmed, pickRank, paired,
  onSelect, onRecord, onDragStart, onDragEnd, canManage,
}) {
  const name = nameOf(row)
  const elig = ELIGIBILITY_STATES[effectiveEligibility(row)]
  const prefs = preferencesOf(row)
  const outcome = row.outcome || {}
  const interactive = !!canManage

  const classes = [
    'paper-note', 'pb-note', paired ? 'pb-pinned-note' : 'pb-pool-note',
    isSelected ? 'pb-note-selected' : '',
    isDimmed ? 'pb-note-dimmed' : '',
    isDragging ? 'pb-note-dragging' : '',
    interactive ? 'pb-note-interactive' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      data-pb-note=""
      data-interviewee-id={row.id}
      role={interactive && onSelect ? 'button' : undefined}
      tabIndex={interactive && onSelect ? 0 : undefined}
      aria-pressed={interactive && onSelect ? !!isSelected : undefined}
      aria-label={`${name}${row.student?.school ? `, ${row.student.school}` : ''}`}
      draggable={interactive && !!onDragStart}
      onDragStart={interactive && onDragStart ? (e => onDragStart(e, row)) : undefined}
      onDragEnd={interactive && onDragEnd ? onDragEnd : undefined}
      onClick={interactive && onSelect ? () => onSelect(row) : undefined}
      onKeyDown={interactive && onSelect ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row) }
      } : undefined}
    >
      <div className="pb-note-main">
        <div className="pb-note-left">
          <div className="pb-note-id">
            <StudentAvatar student={row.student} size={40} />
            <div className="pb-note-id-text">
              <div className="pb-note-name">{name}</div>
              {row.student?.school && <div className="pb-note-school material-soft">{row.student.school}</div>}
            </div>
          </div>

          <div className="pb-note-chips">
            {elig?.label && <span className="pb-chip pb-chip-status" data-testid="interviewee-eligibility">{elig.label}</span>}
            {/* Hired outranks the interview state: it is the later fact, and the
                durable one. */}
            {outcome.hired_at
              ? <span className="pb-chip pb-chip-ready-confirmed">Hired{outcome.hired_unit ? ` · ${outcome.hired_unit}` : ''}</span>
              : outcome.offer_accepted_at
                ? <span className="pb-chip pb-chip-ready-confirmed">Offer accepted</span>
                : outcome.offer_extended_at
                  ? <span className="pb-chip pb-chip-ready-review">Offer extended</span>
                  : null}
            {row.interview_status && row.interview_status !== 'not_scheduled' && (
              <span className="pb-chip">{INTERVIEW_STATES[row.interview_status]?.label || row.interview_status}</span>
            )}
            {pickRank && (
              <span className={`pb-chip pb-chip-rank-${RANK_TONE[pickRank]}`} data-testid="interviewee-pick-chip">
                #{pickRank} pick
              </span>
            )}
          </div>

          <button
            type="button"
            className="pb-link pb-note-record"
            onClick={e => { e.stopPropagation(); onRecord(row) }}
          >
            Record interview or hire
          </button>
        </div>

        {prefs.length > 0 ? (
          <ol className="pb-note-top3" aria-label="Units they ranked">
            {prefs.map((unitName, i) => {
              const u = units.find(x => x.unit_name.toLowerCase() === unitName.toLowerCase())
              const full = u && u.remaining != null && u.remaining <= 0
              return (
                <li key={unitName} className="pb-note-top3-row">
                  <span className="pb-note-top3-rank" aria-hidden="true">{i + 1}.</span>
                  <span className="pb-note-top3-unit">{unitName}{full ? ' (Full)' : ''}</span>
                </li>
              )
            })}
          </ol>
        ) : (
          <span className="pb-note-top3 material-soft">Ranked nothing on their form</span>
        )}
      </div>
    </div>
  )
}

export default function InterviewBoard({ cycle, canManage, toast }) {
  const queryClient = useQueryClient()
  const planning = useNgrpPlanning(cycle?.id || null)
  const applicants = useNgrpApplicants(cycle?.id)
  const [saving, setSaving] = useState(null)
  const [focusedUnit, setFocusedUnit] = useState(null)
  const [selected, setSelected] = useState(null)
  const [drawerId, setDrawerId] = useState(null)
  const [division, setDivision] = useState('')
  const [school, setSchool] = useState('')
  const [announcement, setAnnouncement] = useState('')

  const rows = useMemo(
    () => placeableRows(deriveApplicantRows(applicants.payload?.students, applicants.payload?.candidates)),
    [applicants.payload],
  )
  const units = useMemo(() => planning.data?.units || [], [planning.data])
  const pool = useMemo(() => unitPool(units, rows), [units, rows])
  const summary = useMemo(() => placementSummary(units, rows), [units, rows])
  const prefCounts = useMemo(() => preferenceCounts(rows), [rows])

  const announce = (message) => {
    setAnnouncement('')
    requestAnimationFrame(() => setAnnouncement(message))
  }

  // ── The write. One field, one endpoint, both directions. ───────────────────
  const setUnit = async (row, unit, { silent = false } = {}) => {
    setSaving(row.id)
    const res = await postNgrpManage('assign_unit', { candidate_id: row.candidate_id, unit })
    setSaving(null)
    if (!res.ok) {
      toast?.error?.(
        res.status === 503 ? 'Not provisioned yet' : (unit ? 'Not paired' : 'Not unpaired'),
        res.status === 503
          ? 'The placement migration has not been applied yet, so pairings cannot be saved.'
          : (res.errors?.[0]?.message || res.error || 'The change could not be saved.'),
      )
      return false
    }
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace'] })
    applicants.refetch()
    if (!silent) {
      if (unit) {
        const rank = preferenceRankFor(row, unit)
        toast?.success?.('Paired', `${nameOf(row)} will interview with ${unit} (${rank <= 3 ? `their ${['1st', '2nd', '3rd'][rank - 1]} choice` : 'not one they ranked'}).`)
      } else {
        // Unpairing loses nothing, so Undo simply pairs them again.
        const was = row.assigned_unit
        toast?.info?.(`${nameOf(row)} moved back to Interviewees.`, `They were paired with ${was}.`, {
          duration: 10000,
          action: { label: 'Undo', onClick: () => setUnit({ ...row, assigned_unit: null }, was, { silent: true }) },
        })
      }
    }
    return true
  }

  const pair = async (row, unitName) => {
    if (!canManage || !row || !unitName) return
    const u = pool.find(x => x.unit_name === unitName)
    if (u && u.remaining != null && u.remaining <= 0) {
      toast?.warning?.(`${unitName} is full.`, 'Pull a pin to free a seat.')
      announce(`${unitName} is full. Pull a pin to free a seat.`)
      return
    }
    setSelected(null)
    announce(`Pairing ${nameOf(row)} with ${unitName}.`)
    await setUnit(row, unitName)
  }

  const unpair = async (row) => {
    if (!canManage) return
    announce(`${nameOf(row)} moved back to Interviewees.`)
    await setUnit(row, null)
  }

  const {
    dragLayer, dragKind, draggingId, dropTargetId, listDropActive,
    startListDrag, startTargetDrag, endDrag, targetHandlers, listHandlers,
  } = useBoardDrag({
    hasRoom: (unitName) => {
      const u = pool.find(x => x.unit_name === unitName)
      return !!u && (u.remaining == null || u.remaining > 0)
    },
    onDropOnTarget: (rowId, unitName) => {
      const row = rows.find(r => r.id === rowId)
      if (row) pair(row, unitName)
    },
    onDropOnList: (rowId) => {
      const row = rows.find(r => r.id === rowId)
      if (row) unpair(row)
    },
  })

  const divisions = useMemo(
    () => [...new Set(pool.map(u => DIVISION_OF.get(u.unit_name.toLowerCase())).filter(Boolean))].sort(),
    [pool],
  )
  const schools = useMemo(
    () => [...new Set(rows.map(r => r.student?.school).filter(Boolean))].sort(),
    [rows],
  )

  // The left column holds whoever is still waiting. A paired interviewee is a note
  // on their unit's board, exactly as a placed student is.
  const waiting = useMemo(() => {
    const list = rows.filter(r => !r.assigned_unit && (!school || r.student?.school === school))
    return orderInterviewees(list, focusedUnit, nameOf)
  }, [rows, school, focusedUnit])
  const groups = useMemo(() => groupIntervieweesForUnit(waiting, focusedUnit), [waiting, focusedUnit])

  // A selected interviewee brings the units they ranked to the front, ribboned.
  const visibleUnits = useMemo(() => {
    const list = division
      ? pool.filter(u => DIVISION_OF.get(u.unit_name.toLowerCase()) === division)
      : [...pool]
    list.sort((a, b) => a.unit_name.localeCompare(b.unit_name))
    if (!selected) return { ordered: list, ranks: new Map() }
    const ranks = new Map()
    const lead = []
    for (const p of preferencesOf(selected)) {
      const u = list.find(x => x.unit_name.toLowerCase() === p.toLowerCase())
      if (u && !ranks.has(u.unit_name)) {
        ranks.set(u.unit_name, ranks.size + 1)
        lead.push(u)
      }
    }
    return { ordered: [...lead, ...list.filter(u => !ranks.has(u.unit_name))], ranks }
  }, [pool, division, selected])

  const drawerRow = drawerId ? rows.find(r => r.id === drawerId) || null : null

  const runManage = async (action, row, fields, title, body) => {
    const res = await postNgrpManage(action, { candidate_id: row.candidate_id, ...fields })
    if (!res.ok) {
      toast?.error?.(
        res.status === 503 ? 'Not provisioned yet' : 'Not saved',
        res.status === 503
          ? 'A pending NGRP migration has not been applied yet, so this cannot be saved.'
          : (res.errors?.[0]?.message || res.error || 'The change could not be saved.'),
      )
      return
    }
    toast?.success?.(title, body)
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace'] })
    applicants.refetch()
  }

  const selectInterviewee = (row) => {
    const next = selected?.id === row.id ? null : row
    setSelected(next)
    if (!next) { announce('Selection cleared.'); return }
    const prefs = preferencesOf(next)
    announce(`${nameOf(next)} selected.${prefs.length ? ` They ranked ${prefs.join(', ')}.` : ' They ranked nothing.'}`)
  }
  const activateUnit = (unitName) => {
    if (selected) { pair(selected, unitName); return }
    const next = focusedUnit === unitName ? null : unitName
    setFocusedUnit(next)
    announce(next ? `Showing interviewees who ranked ${next}.` : 'Showing every interviewee.')
  }
  const clearSelection = (e) => {
    if (!e.currentTarget.contains(e.target)) return
    if (e.target.closest('button, a, input, select, textarea, label, [role="button"], [data-pb-board], [data-pb-note], [role="dialog"], .modal-overlay')) return
    if (selected) { setSelected(null); announce('Selection cleared.') }
    if (focusedUnit) setFocusedUnit(null)
  }

  if (!canManage) {
    return (
      <div className="snap" style={{ margin: '0 0 14px', padding: '22px 24px' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
          The Interview Board requires NGRP management access.
        </p>
      </div>
    )
  }
  if (planning.status === 'loading' || applicants.status === 'loading') {
    return <div className="state-box"><div className="spinner" /><p>Loading the Interview Board…</p></div>
  }
  if (planning.status === 'unprovisioned' || applicants.status === 'unprovisioned') {
    return (
      <div className="snap" style={{ margin: '0 0 14px', padding: '22px 24px', background: '#F3F4F6' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#4B5563', lineHeight: 1.6 }}>
          The Interview Board needs migration 20260906000000 (the assigned unit and interview
          record). It has not been applied yet, so no pairings are shown and none can be saved.
        </p>
      </div>
    )
  }
  if (planning.status === 'error' || applicants.status === 'error') {
    return (
      <div className="ngrp-banner ngrp-banner-error" role="alert">
        <b>The Interview Board could not load.</b> This is a server or connection problem.{' '}
        <button type="button" className="ngrp-linkbtn" onClick={() => { planning.refetch(); applicants.refetch() }}>Try again</button>
      </div>
    )
  }

  return (
    <div className="matching-tab pb-tab ngrp-ib" style={{ position: 'relative' }}>
      <InterviewOverview summary={summary} prefCounts={prefCounts} />
      {dragLayer}
      <div className="sr-only" role="status" aria-live="polite" data-testid="board-announcer">{announcement}</div>

      <div className={`pb-board${dragKind ? ` pb-dragging-${dragKind}` : ''}`} onClick={clearSelection}>

        {/* ── Interviewees ────────────────────────────────────────────────── */}
        <section
          className={`pb-pool pb-pool-students${listDropActive ? ' pb-pool-drop' : ''}`}
          aria-label="Interviewees"
          {...listHandlers}
        >
          <header className="material-navy-flat pb-pool-hdr">
            <h2 className="pb-pool-title">Interviewees</h2>
            <span className="pb-count material-soft">
              {waiting.length} waiting{summary.placed > 0 ? ` · ${summary.placed} paired` : ''}
            </span>
            <span className="pb-hdr-spacer" />
            <select className="pb-select" value={school} onChange={e => setSchool(e.target.value)} aria-label="School">
              <option value="">All Schools</option>
              {schools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </header>

          <div className="material-leather-cream pb-pool-body">
            {focusedUnit && (
              <div className="pb-banner" data-testid="pool-unit-banner">
                <span>Showing interviewees for <strong>{focusedUnit}</strong></span>
                <button type="button" className="pb-banner-clear" onClick={() => { setFocusedUnit(null); announce('Showing every interviewee.') }}>
                  Clear
                </button>
              </div>
            )}

            {waiting.length === 0 ? (
              <div className="paper-note pb-note pb-empty-note">
                <div className="pb-empty-title">
                  {rows.length === 0 ? 'Nobody is on the board yet.' : summary.unplaced === 0 ? 'Everyone is paired.' : 'No interviewee matches this filter.'}
                </div>
                <p className="pb-empty-text material-soft">
                  {rows.length === 0
                    ? 'An alumnus arrives here on their own once they submit the Transition Form, are eligible or conditionally eligible, and say they are interested.'
                    : summary.unplaced === 0
                      ? 'Pull a pin on any board to bring someone back here.'
                      : 'No eligible interviewee from this school is waiting for a unit.'}
                </p>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.key} className={`pb-group${group.dimmed ? ' pb-group-dimmed' : ''}`}>
                  {group.label && (
                    <div className="material-cream-label pb-group-label" data-testid={`pool-group-${group.key}`}>
                      {group.label} · {group.rows.length}
                    </div>
                  )}
                  <div className="pb-note-list">
                    {group.rows.map(row => (
                      <div key={row.id} className="pb-note-slot">
                        <IntervieweeNote
                          row={row}
                          units={pool}
                          canManage={canManage}
                          isSelected={selected?.id === row.id}
                          isDragging={draggingId === row.id}
                          pickRank={focusedUnit ? (preferenceRankFor(row, focusedUnit) <= 3 ? preferenceRankFor(row, focusedUnit) : null) : null}
                          onSelect={selectInterviewee}
                          onRecord={r => setDrawerId(r.id)}
                          onDragStart={(e, r) => startListDrag(e, { id: r.id, name: nameOf(r) })}
                          onDragEnd={endDrag}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── Hiring Units ────────────────────────────────────────────────── */}
        <section className="pb-pool pb-pool-units" aria-label="Hiring Units">
          <header className="material-navy-flat pb-pool-hdr">
            <h2 className="pb-pool-title">Hiring Units</h2>
            {selected && <span className="pb-hdr-hint material-soft">By preference for {nameOf(selected)}</span>}
            <span className="pb-hdr-spacer" />
            <select className="pb-select" value={division} onChange={e => setDivision(e.target.value)} aria-label="Division">
              <option value="">All Divisions</option>
              {divisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </header>

          <div className="pb-legend" aria-label="Pin colours show which choice the pairing matched">
            <span><i className="pb-dot material-rank-first" aria-hidden="true" />Ranked 1st</span>
            <span><i className="pb-dot material-rank-second" aria-hidden="true" />2nd</span>
            <span><i className="pb-dot material-rank-third" aria-hidden="true" />3rd</span>
            <span><i className="pb-dot material-rank-other" aria-hidden="true" />Not ranked</span>
          </div>

          <div className="pb-units-body">
            {visibleUnits.ordered.length === 0 ? (
              <div className="paper-note pb-note pb-empty-note">
                <div className="pb-empty-title">No units are hiring into this cohort yet.</div>
                <p className="pb-empty-text material-soft">Pick them in Edit Cohort.</p>
              </div>
            ) : (
              <div className="pb-unit-grid">
                {visibleUnits.ordered.map(u => {
                  const key = u.unit_name.toLowerCase()
                  const rank = visibleUnits.ranks.get(u.unit_name) || null
                  const full = u.remaining != null && u.remaining <= 0
                  const openSeats = u.seats == null ? 0 : Math.max(0, u.seats - u.assigned)
                  return (
                    <section
                      key={u.unit_name}
                      className={[
                        'pb-unit',
                        focusedUnit === u.unit_name ? 'pb-unit-focused' : '',
                        dropTargetId === u.unit_name ? 'pb-unit-drop' : '',
                        selected && !rank ? 'pb-unit-dimmed' : '',
                      ].filter(Boolean).join(' ')}
                      data-pb-board=""
                      data-unit-name={u.unit_name}
                      role="group"
                      tabIndex={0}
                      aria-label={`${u.unit_name} board, ${u.assigned} of ${u.seats == null ? 'an unset number of' : u.seats} seats filled`}
                      onClick={e => { if (e.currentTarget.contains(e.target)) activateUnit(u.unit_name) }}
                      onKeyDown={e => {
                        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                          e.preventDefault(); activateUnit(u.unit_name)
                        }
                      }}
                      {...targetHandlers(u.unit_name)}
                    >
                      <header className="material-board-head pb-unit-hdr">
                        <div className="pb-unit-hdr-top">
                          <h3 className="pb-unit-name">{u.unit_name}</h3>
                          {u.over && <span className="pb-chip pb-chip-warn">{u.assigned - u.seats} over</span>}
                        </div>
                        {DESC_OF.get(key) && <div className="pb-unit-desc material-soft">{DESC_OF.get(key)}</div>}
                        <div className="pb-unit-capacity">
                          <span className="pb-unit-capacity-text material-soft">
                            {u.seats == null
                              ? `${u.assigned} paired · no seat count set`
                              : `${u.assigned} of ${u.seats} seats${full ? ' · Full' : ` · ${openSeats} open`}`}
                          </span>
                          <span className="pb-unit-notified material-soft">{u.requested} ranked it</span>
                        </div>
                      </header>

                      <div className="material-board pb-unit-body">
                        {rank && (
                          <span className={`material-ribbon material-rank-${RANK_TONE[rank]} pb-ribbon`} data-testid="choice-ribbon">
                            #{rank} choice{full ? ' · Full' : ''}
                          </span>
                        )}
                        {u.rows.map((row, i) => {
                          const pin = pinForAssignment(row)
                          return (
                            <div key={row.id} className={`pb-pinned ${i % 2 === 0 ? 'pb-tilt-a' : 'pb-tilt-b'}`}>
                              <span className="pb-pin-anchor">
                                <button
                                  type="button"
                                  data-testid="pull-pin"
                                  className={`material-pin material-rank-${pin.tone} pb-pin`}
                                  aria-label={`Pull pin: unpair ${nameOf(row)} from ${u.unit_name} (${pin.spoken})`}
                                  disabled={saving === row.id}
                                  onClick={e => { e.stopPropagation(); unpair(row) }}
                                >
                                  <span aria-hidden="true">{pin.glyph}</span>
                                </button>
                              </span>
                              <IntervieweeNote
                                row={row}
                                units={pool}
                                paired
                                canManage={canManage}
                                isDragging={draggingId === row.id}
                                onRecord={r => setDrawerId(r.id)}
                                onDragStart={(e, r) => startTargetDrag(e, { id: r.id, targetId: u.unit_name, name: nameOf(r) })}
                                onDragEnd={endDrag}
                              />
                            </div>
                          )
                        })}
                        {Array.from({ length: openSeats }).map((_, i) => (
                          <div key={`seat-${i}`} className="pb-open-slot" aria-hidden="true">Open seat</div>
                        ))}
                        {u.seats == null && (
                          <div className="pb-open-slot" aria-hidden="true">No seat count set</div>
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <p className="pb-footnote">
        Pairing an interviewee with a unit means that unit will <b>interview</b> them. It is not a
        hire: the hire is recorded in the applicant drawer, the same one Profiles &amp; Interest
        opens, once Talent Acquisition confirms the person accepted and started. No interview
        rubric or score is stored anywhere in ASPIRE.
      </p>

      <ApplicantDrawer
        open={Boolean(drawerRow)}
        row={drawerRow}
        cycle={cycle}
        canManage={canManage}
        provisioned={applicants.payload?.transitionProvisioned !== false}
        onClose={() => setDrawerId(null)}
        actions={{
          setInterview: (r, fields) => runManage('interview_set', r, fields,
            'Interview recorded', `${nameOf(r)}'s interview state is saved.`),
          setOutcome: (r, fields) => runManage('outcome_set', r, fields,
            'Outcome recorded', `${nameOf(r)}'s residency outcome is saved.`),
        }}
      />
    </div>
  )
}
