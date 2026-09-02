// NGRP-PLACEMENT-BOARD-1: Residency > Placement board.
//
// BUILT ON THE ASPIRE BOARD'S OWN STRUCTURE AND CLASSES (Owner), because it is
// meant to BE that board for the residency side, not a second design that
// happens to do the same job. Same three sections top to bottom: Placement at a
// Glance, then Unit Pool and Applicant Pool side by side. Same .embed-* panel
// system, the same .euc-card unit cards, the same .ov-panel-title headings, the
// same preference-match segmented bar. Nothing here restyles what exists.
//
// The one word that changes is the right-hand panel. ASPIRE says "Student
// Pool"; these people finished ASPIRE and are not students any more. It is not
// "Candidate Pool" either, because this codebase already spends "candidate" on
// the prospective end of the funnel (ngrp_candidates, "prospective
// candidates"), which is the wrong end for a board that only holds people whose
// application is confirmed.
//
// FOCUS RUNS BOTH WAYS (Owner). Clicking a unit reorders the applicants who
// ranked it and says which choice it was for each; clicking an applicant lights
// up the units they asked for. Selecting one never hides the other side.
//
// A RANKED PREFERENCE IS NOT AN ASSIGNMENT. The plan states it outright. The
// board shows both and lets neither imply the other: when HR assigns a unit
// nobody ranked, it says so rather than quietly reporting a match.
//
// NO RUBRICS AND NO SCORES. The Owner was explicit that this program records who
// was interviewed and who was hired, not how anyone was graded. Applicants are
// never ranked against each other.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNgrpPlanning, useNgrpApplicants, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows, effectiveEligibility, ELIGIBILITY_STATES, INTERVIEW_STATES } from '../../lib/ngrp/ngrpStates'
import { displayName } from '../../lib/utils'
import { UNIT_CATALOG } from '../../lib/unitCatalog'
import { KPICell } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import ApplicantDrawer from './ApplicantDrawer'
import { F } from '../../lib/ngrp/ngrpCohortForm'
import {
  placeableRows, preferencesOf, assignedRank, unitPool, placementSummary,
  preferenceCounts, topChoicePct, preferenceRankFor, orderForFocus,
} from '../../lib/ngrp/ngrpPlacement'

const nameOf = r => displayName(r.student)

// The ASPIRE board's own segment palette, so the two bars read identically.
const PREF_SEGMENTS = [
  { key: 'top',         label: 'Top choice',   color: '#C8D5C0' },
  { key: 'second',      label: 'Second',       color: '#D5DCEC' },
  { key: 'other',       label: 'Other',        color: '#F4D9B6' },
  { key: 'notRecorded', label: 'Not ranked',   color: '#E5E7EB' },
  { key: 'unassigned',  label: 'Unassigned',   color: '#F2D5E0' },
]

const DIVISION_OF = new Map(UNIT_CATALOG.map(u => [u.name.toLowerCase(), u.division]))
const DESC_OF = new Map(UNIT_CATALOG.map(u => [u.name.toLowerCase(), u.description]))

function SegmentedBar({ counts, total }) {
  if (!total) return <div style={{ height: 9, borderRadius: 5, background: '#f3f4f6' }} />
  const active = PREF_SEGMENTS.filter(s => counts[s.key] > 0)
  return (
    <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', background: '#f3f4f6', gap: 1 }}>
      {active.map(s => (
        <div key={s.key} style={{ width: `${(counts[s.key] / total) * 100}%`, background: s.color, minWidth: 4 }} />
      ))}
    </div>
  )
}

function PlacementOverview({ cycle, summary, prefCounts }) {
  const topPct = topChoicePct(prefCounts)
  const counts = { ...prefCounts, unassigned: summary.unplaced }
  const matchedSub = (() => {
    const parts = []
    if (prefCounts.top > 0) parts.push(`${prefCounts.top} top choice`)
    if (prefCounts.second > 0) parts.push(`${prefCounts.second} 2nd choice`)
    if (prefCounts.other > 0) parts.push(`${prefCounts.other} other`)
    if (prefCounts.notRecorded > 0) parts.push(`${prefCounts.notRecorded} not ranked`)
    return parts.length ? parts.join(' · ') : 'Pending assignment'
  })()

  return (
    <section style={{ background: 'var(--bg-card,#fff)', border: '1px solid var(--border-card,rgba(29,37,103,0.08))', borderRadius: 14, boxShadow: 'var(--shadow-card)', overflow: 'hidden', fontFamily: F }}>
      <div style={{ padding: '11px 22px 9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card,rgba(29,37,103,0.04))' }}>
        <div className="ov-panel-title">Placement at a Glance</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted,#98A2B3)', fontVariantNumeric: 'tabular-nums' }}>
          {cycle?.name || 'Cohort'} · {summary.units} hiring unit{summary.units === 1 ? '' : 's'}
        </div>
      </div>
      <div style={{ display: 'flex', background: 'var(--border-card,rgba(29,37,103,0.04))', gap: 1, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 0' }}><KPICell value={summary.confirmed} label="Applicants" sub="Application confirmed" /></div>
        <div style={{ flex: '1 1 0' }}><KPICell value={summary.placed} label="Assigned" sub={matchedSub} accent="sage" /></div>
        <div style={{ flex: '1 1 0' }}><KPICell value={summary.unplaced} label="Unassigned" sub="Pending a unit" accent={summary.unplaced > 0 ? 'warning' : null} /></div>
        <div style={{ flex: '1 1 0' }}>
          <KPICell
            value={summary.seats == null ? '' : Math.max(0, summary.seats - summary.placed)}
            label="Open Seats"
            sub={summary.seats == null ? 'Some units have no number set' : `of ${summary.seats} total`}
          />
        </div>
        <div style={{ flex: '1.6 1 0', minWidth: 200, background: 'var(--bg-card,#fff)', padding: '14px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-caption,#475467)', fontWeight: 700 }}>Preference Match</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: topPct !== null ? 'var(--color-status-success,#2D4A2B)' : 'var(--text-muted,#98A2B3)', lineHeight: 1.2 }}>
            {topPct !== null ? `${topPct}% received top choice` : summary.placed > 0 ? 'No assignment matched a ranked choice' : '-'}
          </div>
          <SegmentedBar counts={counts} total={summary.confirmed} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {PREF_SEGMENTS.map(seg => (
              <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-caption,#6b7280)', whiteSpace: 'nowrap' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: seg.color, display: 'inline-block', flexShrink: 0 }} />
                {seg.label} · {counts[seg.key]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function PlacementBoard({ cycle, canManage, toast }) {
  const queryClient = useQueryClient()
  const planning = useNgrpPlanning(cycle?.id || null)
  const applicants = useNgrpApplicants(cycle?.id)
  const [saving, setSaving] = useState(null)
  const [focusedUnit, setFocusedUnit] = useState(null)
  const [selectedApplicant, setSelectedApplicant] = useState(null)
  const [drawerId, setDrawerId] = useState(null)
  const [division, setDivision] = useState('')
  const [search, setSearch] = useState('')
  const [showOnly, setShowOnly] = useState('all')

  const rows = useMemo(
    () => placeableRows(deriveApplicantRows(applicants.payload?.students, applicants.payload?.candidates)),
    [applicants.payload],
  )
  const units = useMemo(() => planning.data?.units || [], [planning.data])
  const pool = useMemo(() => unitPool(units, rows), [units, rows])
  const summary = useMemo(() => placementSummary(units, rows), [units, rows])
  const prefCounts = useMemo(() => preferenceCounts(rows), [rows])

  const divisions = useMemo(
    () => [...new Set(pool.map(u => DIVISION_OF.get(u.unit_name.toLowerCase())).filter(Boolean))],
    [pool],
  )
  const visibleUnits = division ? pool.filter(u => DIVISION_OF.get(u.unit_name.toLowerCase()) === division) : pool

  // Focus runs both ways: a selected applicant lights up the units they ranked.
  const selectedPrefs = selectedApplicant ? preferencesOf(selectedApplicant).map(p => p.toLowerCase()) : []

  const visibleApplicants = useMemo(() => {
    let list = rows
    if (showOnly === 'unassigned') list = list.filter(r => !r.assigned_unit)
    else if (showOnly === 'assigned') list = list.filter(r => r.assigned_unit)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r => `${nameOf(r)} ${r.student?.school || ''}`.toLowerCase().includes(q))
    return orderForFocus(list, focusedUnit, nameOf)
  }, [rows, showOnly, search, focusedUnit])

  // Resolved from the live rows each render, so a save is reflected in the open
  // drawer rather than leaving a stale copy on screen.
  const drawerRow = drawerId ? rows.find(r => r.id === drawerId) || null : null

  const focusPrefTally = useMemo(() => {
    if (!focusedUnit) return null
    const t = { 1: 0, 2: 0, 3: 0 }
    for (const r of rows) {
      const rank = preferenceRankFor(r, focusedUnit)
      if (rank <= 3) t[rank] += 1
    }
    return t
  }, [rows, focusedUnit])

  // NGRP-INTERVIEW-HIRE-1: the board opens the SAME drawer Profiles opens, so
  // one person's record has exactly one place it is edited rather than two that
  // can disagree.
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

  const assign = async (row, unit) => {
    setSaving(row.id)
    const res = await postNgrpManage('assign_unit', { candidate_id: row.candidate_id, unit })
    setSaving(null)
    if (!res.ok) {
      toast?.error?.(
        res.status === 503 ? 'Not provisioned yet' : 'Not assigned',
        res.status === 503
          ? 'The placement migration has not been applied yet, so assignments cannot be saved.'
          : (res.errors?.[0]?.message || res.error || 'The assignment could not be saved.'),
      )
      return
    }
    toast?.success?.(unit ? 'Unit assigned' : 'Assignment cleared',
      unit ? `${nameOf(row)} is assigned to ${unit}.` : `${nameOf(row)} is back in the unassigned list.`)
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace'] })
    applicants.refetch()
  }

  if (!canManage) {
    return (
      <div className="snap" style={{ margin: '0 0 14px', padding: '22px 24px' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280', fontFamily: F }}>
          The placement board requires NGRP management access.
        </p>
      </div>
    )
  }
  if (planning.status === 'loading' || applicants.status === 'loading') {
    return <div className="state-box"><div className="spinner" /><p>Loading the placement board…</p></div>
  }
  if (planning.status === 'unprovisioned' || applicants.status === 'unprovisioned') {
    return (
      <div className="snap" style={{ margin: '0 0 14px', padding: '22px 24px', background: '#F3F4F6' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#4B5563', fontFamily: F, lineHeight: 1.6 }}>
          The placement board needs migration 20260906000000 (the assigned unit and interview
          record). It has not been applied yet, so no assignments are shown and none can be saved.
        </p>
      </div>
    )
  }
  if (planning.status === 'error' || applicants.status === 'error') {
    return (
      <div className="ngrp-banner ngrp-banner-error" role="alert">
        <b>The placement board could not load.</b> This is a server or connection problem.{' '}
        <button type="button" className="ngrp-linkbtn" onClick={() => { planning.refetch(); applicants.refetch() }}>Try again</button>
      </div>
    )
  }

  return (
    <div className="ngrp-pb-page">
      <PlacementOverview cycle={cycle} summary={summary} prefCounts={prefCounts} />

      <div className="ngrp-pb-cols">
        {/* ── Unit Pool ─────────────────────────────────────────────────── */}
        <section className="embed-units-panel">
          <div className="embed-light-hdr">
            <span className="embed-panel-title-light">Unit Pool</span>
            <select className="embed-light-select" value={division} onChange={e => setDivision(e.target.value)} aria-label="Filter units by division">
              <option value="">All Divisions</option>
              {divisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {selectedApplicant && (
              <span style={{ fontSize: 11.5, color: 'var(--text-muted,#6B7785)', fontStyle: 'italic' }}>
                By preference for {nameOf(selectedApplicant)}
              </span>
            )}
          </div>
          <div className="embed-units-body">
            {visibleUnits.length === 0 && (
              <p className="ngrp-pb-empty">No units are hiring into this cohort yet. Pick them in Edit Cohort.</p>
            )}
            <div className="embed-unit-grid">
              {visibleUnits.map(u => {
                const key = u.unit_name.toLowerCase()
                const focused = focusedUnit === u.unit_name
                const prefRank = selectedPrefs.indexOf(key)
                const wanted = prefRank !== -1
                return (
                  <div
                    key={u.unit_name}
                    className={`euc-card ngrp-uc${focused ? ' ngrp-uc-focus' : ''}${wanted ? ' ngrp-uc-wanted' : ''}${u.over ? ' ngrp-uc-over' : ''}`}
                  >
                    <button
                      type="button"
                      className="ngrp-uc-head"
                      aria-pressed={focused}
                      onClick={() => setFocusedUnit(focused ? null : u.unit_name)}
                    >
                      <span className="ngrp-uc-title">
                        <span className="ngrp-uc-name">{u.unit_name}</span>
                        <span className="ngrp-uc-desc">{DESC_OF.get(key) || ''}</span>
                      </span>
                      <span className="ngrp-uc-badges">
                        {wanted && <span className="ngrp-uc-pref">Choice {prefRank + 1}</span>}
                        <span className={`euc-fill-badge ${u.remaining === 0 || u.over ? 'euc-fill-full' : 'euc-fill-open'}`}>
                          {u.seats == null ? `${u.assigned} assigned` : u.over ? `${u.assigned - u.seats} over` : `${u.remaining} open`}
                        </span>
                      </span>
                    </button>

                    <div className="ngrp-uc-slots">
                      {/* One slot per new grad this unit said it was hiring, so
                          an empty seat is visible as a seat rather than absent. */}
                      {u.rows.map(r => (
                        <div key={r.id} className="ngrp-uc-slot ngrp-uc-slot-filled">
                          <StudentAvatar student={r.student} size={22} />
                          <span className="ngrp-uc-slot-name">{nameOf(r)}</span>
                          {assignedRank(r) > 0
                            ? <span className="ngrp-uc-slot-rank">choice {assignedRank(r)}</span>
                            : <span className="ngrp-uc-slot-rank ngrp-uc-slot-rank-off">not ranked</span>}
                          <button
                            type="button"
                            className="ngrp-uc-slot-clear"
                            aria-label={`Remove ${nameOf(r)} from ${u.unit_name}`}
                            disabled={saving === r.id}
                            onClick={() => assign(r, null)}
                          >×</button>
                        </div>
                      ))}
                      {u.seats != null && Array.from({ length: Math.max(0, u.seats - u.assigned) }, (_, i) => (
                        <div key={`open-${i}`} className="ngrp-uc-slot ngrp-uc-slot-open">
                          {selectedApplicant && !selectedApplicant.assigned_unit
                            ? (
                              <button
                                type="button"
                                className="ngrp-uc-slot-place"
                                disabled={saving === selectedApplicant.id}
                                onClick={() => assign(selectedApplicant, u.unit_name)}
                              >
                                Place {nameOf(selectedApplicant)} here
                              </button>
                            )
                            : <span className="ngrp-uc-slot-empty">Open seat</span>}
                        </div>
                      ))}
                      {u.seats == null && (
                        <p className="ngrp-uc-noseats">No number of new grads set for this unit.</p>
                      )}
                    </div>

                    <div className="ngrp-uc-foot">{u.requested} applicant{u.requested === 1 ? '' : 's'} ranked it</div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Applicant Pool ────────────────────────────────────────────── */}
        <section className="embed-students-panel">
          <div className="embed-light-hdr">
            <span className="embed-panel-title-light">Applicant Pool</span>
            <input
              className="embed-pool-search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search applicants"
            />
            <select className="embed-light-select" value={showOnly} onChange={e => setShowOnly(e.target.value)} aria-label="Filter applicants">
              <option value="all">All applicants</option>
              <option value="unassigned">Unassigned</option>
              <option value="assigned">Assigned</option>
            </select>
          </div>

          <div className="embed-students-body">
            <div className="ngrp-pb-count">
              {visibleApplicants.length} applicant{visibleApplicants.length === 1 ? '' : 's'}
              {summary.unplaced > 0 && <span className="ngrp-pb-count-warn"> · {summary.unplaced} unassigned</span>}
            </div>

            {/* The focused unit's preference tally, exactly as the ASPIRE board
                reports it above the student pool. */}
            {focusedUnit && (
              <div className="ngrp-pb-focusbar">
                <span>Preferences for <b>{focusedUnit}</b>:</span>
                <span className="ngrp-pb-focus-n">{focusPrefTally[1]}, 1st choice</span>
                <span className="ngrp-pb-focus-n">{focusPrefTally[2]}, 2nd</span>
                <span className="ngrp-pb-focus-n">{focusPrefTally[3]}, 3rd</span>
                <button type="button" className="embed-light-btn" onClick={() => setFocusedUnit(null)}>Clear</button>
              </div>
            )}

            {visibleApplicants.length === 0 && (
              <p className="ngrp-pb-empty">
                {rows.length === 0
                  ? 'No confirmed applicants yet. An alumnus reaches this board once their application is confirmed in Profiles & Interest.'
                  : 'No applicant matches these filters.'}
              </p>
            )}

            <div className="embed-student-grid">
              {visibleApplicants.map(row => {
                const prefs = preferencesOf(row)
                const rank = assignedRank(row)
                const selected = selectedApplicant?.id === row.id
                const focusRank = focusedUnit ? preferenceRankFor(row, focusedUnit) : 4
                const elig = ELIGIBILITY_STATES[effectiveEligibility(row)]
                return (
                  <div
                    key={row.id}
                    className={`ngrp-ac${selected ? ' ngrp-ac-sel' : ''}${focusedUnit && focusRank === 4 ? ' ngrp-ac-dim' : ''}`}
                  >
                    <button
                      type="button"
                      className="ngrp-ac-head"
                      aria-pressed={selected}
                      onClick={() => setSelectedApplicant(selected ? null : row)}
                    >
                      <StudentAvatar student={row.student} size={34} />
                      <span className="ngrp-ac-id">
                        <span className="ngrp-ac-name">{nameOf(row)}</span>
                        <span className="ngrp-ac-meta">{[row.student?.school, elig?.label].filter(Boolean).join(' · ')}</span>
                      </span>
                      {focusedUnit && focusRank <= 3 && (
                        <span className="ngrp-ac-focusrank">Choice {focusRank}</span>
                      )}
                    </button>

                    {/* Where the row stands beyond placement. Hired outranks the
                        interview state, because it is the later fact and the
                        durable one. */}
                    <div className="ngrp-ac-track">
                      {row.outcome?.hired_at
                        ? <span className="ngrp-ac-chip ngrp-ac-chip-hired">Hired{row.outcome.hired_unit ? ` · ${row.outcome.hired_unit}` : ''}</span>
                        : row.outcome?.offer_accepted_at
                          ? <span className="ngrp-ac-chip ngrp-ac-chip-offer">Offer accepted</span>
                          : row.outcome?.offer_extended_at
                            ? <span className="ngrp-ac-chip ngrp-ac-chip-offer">Offer extended</span>
                            : null}
                      {row.interview_status && row.interview_status !== 'not_scheduled' && (
                        <span className="ngrp-ac-chip">{INTERVIEW_STATES[row.interview_status]?.label || row.interview_status}</span>
                      )}
                      <button type="button" className="ngrp-ac-record" onClick={() => setDrawerId(row.id)}>
                        Record interview or hire
                      </button>
                    </div>

                    <div className="ngrp-ac-prefs">
                      {prefs.length === 0
                        ? <span className="ngrp-ac-noprefs">No ranked preferences on their form</span>
                        : prefs.map((p, i) => (
                          <span
                            key={p}
                            className={`ngrp-ac-pref${row.assigned_unit && p.toLowerCase() === row.assigned_unit.toLowerCase() ? ' ngrp-ac-pref-on' : ''}`}
                          >
                            <span className="ngrp-ac-pref-rank">{i + 1}</span>{p}
                          </span>
                        ))}
                    </div>

                    <div className="ngrp-ac-assign">
                      {row.assigned_unit
                        ? (
                          <span className={`ngrp-ac-assigned${rank === 0 ? ' ngrp-ac-assigned-off' : ''}`}>
                            {row.assigned_unit}
                            <span className="ngrp-ac-assigned-rank">{rank === 0 ? 'not ranked' : `choice ${rank}`}</span>
                          </span>
                        )
                        : <span className="ngrp-ac-unassigned">Unassigned</span>}
                      <select
                        className="embed-light-select"
                        value={row.assigned_unit || ''}
                        disabled={saving === row.id || pool.length === 0}
                        onChange={e => assign(row, e.target.value || null)}
                        aria-label={`Assigned unit for ${nameOf(row)}`}
                      >
                        <option value="">Not assigned</option>
                        {pool.map(u => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>)}
                        {row.assigned_unit && !pool.some(u => u.unit_name === row.assigned_unit) && (
                          <option value={row.assigned_unit}>{row.assigned_unit} (no longer hiring)</option>
                        )}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 11.5, color: '#6B7785', fontFamily: F, lineHeight: 1.55 }}>
        Interview and hire outcomes are recorded in the applicant drawer, the same one Profiles &amp;
        Interest opens. No interview rubric or score is stored anywhere in ASPIRE.
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
