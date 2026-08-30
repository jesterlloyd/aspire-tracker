// NGRP-WORKSPACE-1: the Applicants roster. A real-time operational view over
// COMPLETED ASPIRE students (the canonical rows App.jsx already loads for the
// active cohort), joined to cycle-specific ngrp_candidates rows when they
// exist. No student data is duplicated: identity renders from the student
// record, workflow state from the candidate record (or neutral defaults).
//
// The primary workspace selector is the NGRP cycle (in NgrpWorkspace's cycle
// strip); the ASPIRE cohort is a FILTER here - the two are different entities
// and one cycle may draw alumni from several cohorts.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Send, GraduationCap, X } from 'lucide-react'
import { FilterKPICard } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import EmptyState from '../EmptyState'
import NgrpStatusPill from './NgrpStatusPill'
import ApplicantDrawer from './ApplicantDrawer'
import {
  FORM_STATES, INTEREST_STATES, ELIGIBILITY_STATES, APPLICATION_STATES,
  INTERVIEW_STATES, KPI_DEFS, SORT_OPTIONS,
  deriveApplicantRows, sortApplicantRows, effectiveEligibility, formTimestamp,
} from '../../lib/ngrp/ngrpStates'
import { displayName } from '../../lib/utils'

const relTime = ts => {
  if (!ts) return '—'
  const ms = Date.now() - new Date(ts).getTime()
  if (Number.isNaN(ms)) return '—'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const selectStyle = {
  height: 32, padding: '0 8px', border: '1px solid var(--border-input, rgba(29,37,103,0.10))',
  borderRadius: 7, fontSize: 12, background: 'var(--bg-input, #fff)',
  color: 'var(--text-body, #191919)', fontFamily: 'DM Sans, sans-serif', cursor: 'pointer',
}

export default function ApplicantsTab({
  students, cohorts, cycle, candidates, provisioned, canEdit, toast,
}) {
  // Filters live in the URL (plan §3.2: shareable, restorable views). All
  // writes happen in event handlers - never in an effect - matching the
  // app-wide URL-state rule from ASPIRE-CHART.
  const [searchParams, setSearchParams] = useSearchParams()
  const kpiFilter    = KPI_DEFS.some(k => k.key === searchParams.get('kpi')) ? searchParams.get('kpi') : 'all'
  const query        = searchParams.get('q') || ''
  const cohortFilter = searchParams.get('cohort') || ''
  const schoolFilter = searchParams.get('school') || ''
  const sortKey      = SORT_OPTIONS.some(o => o.key === searchParams.get('sort')) ? searchParams.get('sort') : 'priority'
  const setParam = (key, value, defaultValue = '') => {
    const next = new URLSearchParams(searchParams)
    if (!value || value === defaultValue) next.delete(key); else next.set(key, value)
    setSearchParams(next, { replace: true })
  }
  const setKpiFilter    = v => setParam('kpi', v, 'all')
  const setQuery        = v => setParam('q', v)
  const setCohortFilter = v => setParam('cohort', v)
  const setSchoolFilter = v => setParam('school', v)
  const setSortKey      = v => setParam('sort', v, 'priority')

  const [selected, setSelected]   = useState(() => new Set())
  const [drawerRowId, setDrawerRowId] = useState(null)
  const [sendReview, setSendReview]   = useState(null) // { send:[], missingEmail:[], resend:[] }

  const allRows = useMemo(() => deriveApplicantRows(students, candidates), [students, candidates])

  // Cohort timeline order from the real cohorts table (start_date order).
  const cohortOrder = useMemo(() => {
    const sorted = [...(cohorts || [])].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    return Object.fromEntries(sorted.map((c, i) => [c.name, i]))
  }, [cohorts])

  const cohortOptions = useMemo(
    () => [...new Set(allRows.map(r => r.student.aspire_cohort).filter(Boolean))]
      .sort((a, b) => (cohortOrder[a] ?? 99) - (cohortOrder[b] ?? 99)),
    [allRows, cohortOrder])
  const schoolOptions = useMemo(
    () => [...new Set(allRows.map(r => r.student.school).filter(Boolean))].sort(),
    [allRows])

  const activeKpi = KPI_DEFS.find(k => k.key === kpiFilter) || KPI_DEFS[0]
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = allRows.filter(r => {
      if (!activeKpi.match(r)) return false
      if (cohortFilter && r.student.aspire_cohort !== cohortFilter) return false
      if (schoolFilter && r.student.school !== schoolFilter) return false
      if (q) {
        const hay = `${displayName(r.student)} ${r.student.first_name || ''} ${r.student.last_name || ''} ${r.student.school || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return sortApplicantRows(rows, sortKey, { cohortOrder })
  }, [allRows, activeKpi, cohortFilter, schoolFilter, query, sortKey, cohortOrder])

  const hasFilters = kpiFilter !== 'all' || query || cohortFilter || schoolFilter
  // One atomic URL write - sequential setParam calls would each read the
  // pre-handler searchParams and clobber one another.
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    ;['kpi', 'q', 'cohort', 'school'].forEach(k => next.delete(k))
    setSearchParams(next, { replace: true })
  }

  const toggleRow = id => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const visibleSelected = filteredRows.filter(r => selected.has(r.id))
  const allVisibleSelected = filteredRows.length > 0 && visibleSelected.length === filteredRows.length
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    if (allVisibleSelected) filteredRows.forEach(r => next.delete(r.id))
    else filteredRows.forEach(r => next.add(r.id))
    return next
  })

  // Bulk send: validate the selection before anything happens. The actual send
  // hands the recipient list to ASPIRE Connect > Outreach > Send to Many with
  // one secure, recipient-specific link each (Phase-2 endpoint; gated below).
  const reviewSend = () => {
    const send = [], missingEmail = [], resend = []
    for (const r of visibleSelected) {
      const email = r.student.school_email || r.student.personal_email
      if (!email) { missingEmail.push(r); continue }
      if (r.form_status !== 'not_sent') { resend.push(r); continue }
      send.push(r)
    }
    setSendReview({ send, missingEmail, resend })
  }

  const drawerRow = drawerRowId ? filteredRows.concat(allRows).find(r => r.id === drawerRowId) : null

  // ── Empty roster (no completed students in this cohort at all) ─────────────
  if (allRows.length === 0) {
    return (
      <div className="snap" style={{ margin: '14px 0' }}>
        <EmptyState
          icon={<GraduationCap />}
          heading="No completed alumni yet"
          subtext="Alumni appear here automatically when ASPIRE students in the selected cohort reach Completed status. Switch the ASPIRE cohort in the header to view another cohort's alumni."
        />
      </div>
    )
  }

  return (
    <div>
      {/* KPI filter cards - each card filters the roster below and stays compact
          so the roster remains the main focus. */}
      <div className="ngrp-kpis" role="group" aria-label="Roster filters">
        {KPI_DEFS.map(k => (
          <FilterKPICard
            key={k.key}
            value={allRows.filter(k.match).length}
            label={k.label}
            sub={k.sub}
            accent={k.accent}
            active={kpiFilter === k.key}
            onClick={() => setKpiFilter(kpiFilter === k.key ? 'all' : k.key)}
            ariaLabel={`Filter roster: ${k.label}`}
          />
        ))}
      </div>

      {/* Toolbar: search, cohort filter, school filter, sort, count */}
      <div className="ngrp-toolbar">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={12} strokeWidth={2.2} aria-hidden="true" style={{ position: 'absolute', left: 9, color: '#9CA3AF' }} />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search alumni"
            aria-label="Search alumni by name or school"
            style={{ ...selectStyle, cursor: 'text', paddingLeft: 28, minWidth: 190 }}
          />
        </div>
        <select value={cohortFilter} onChange={e => setCohortFilter(e.target.value)} aria-label="Filter by ASPIRE cohort" style={selectStyle}>
          <option value="">All ASPIRE Cohorts</option>
          {cohortOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={schoolFilter} onChange={e => setSchoolFilter(e.target.value)} aria-label="Filter by school" style={selectStyle}>
          <option value="">All Schools</option>
          {schoolOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7785' }}>
          Sort
          <select value={sortKey} onChange={e => setSortKey(e.target.value)} aria-label="Sort roster" style={selectStyle}>
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: '#6B7785' }} aria-live="polite">
          {filteredRows.length} of {allRows.length} alumni
        </span>
        {hasFilters && (
          <button type="button" onClick={clearFilters} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
            borderRadius: 7, border: '1px solid rgba(29,37,103,0.15)', background: '#F0F3FF',
            color: '#1D2567', fontSize: 11, fontWeight: 600, fontFamily: 'DM Sans, sans-serif', cursor: 'pointer',
          }}>
            <X size={11} strokeWidth={2.5} aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {/* Roster */}
      <div className="ngrp-roster">
        <div className="ngrp-roster-head">
          <span style={{ fontSize: 13, fontWeight: 700 }}>Alumni Roster</span>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>
            {cycle ? `NGRP ${cycle.name}` : 'No NGRP cycle selected'} · sorted by {SORT_OPTIONS.find(o => o.key === sortKey)?.label.toLowerCase()}
          </span>
        </div>
        <div className="ngrp-roster-scroll">
          <table className="ngrp-table">
            <thead>
              <tr>
                <th scope="col" className="ngrp-cb">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label={allVisibleSelected ? 'Deselect all visible alumni' : 'Select all visible alumni'}
                  />
                </th>
                <th scope="col">Alumnus</th>
                <th scope="col">Transition Form</th>
                <th scope="col">Interest</th>
                <th scope="col">Eligibility</th>
                <th scope="col">Application</th>
                <th scope="col" className="ngrp-col-unit">Assigned Unit</th>
                <th scope="col" className="ngrp-col-iv">Interview</th>
                <th scope="col" className="ngrp-col-upd">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 0 }}>
                    <EmptyState
                      compact
                      heading="No alumni match the current filters"
                      subtext="Adjust the filters above, or clear them to see every completed alumnus."
                    />
                  </td>
                </tr>
              )}
              {filteredRows.map(r => {
                const s = r.student
                const overridden = Boolean(r.eligibility_effective)
                const ts = formTimestamp(r)
                return (
                  <tr
                    key={r.id}
                    className={drawerRowId === r.id ? 'sel' : undefined}
                    tabIndex={0}
                    onClick={() => setDrawerRowId(r.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrawerRowId(r.id) } }}
                    aria-label={`Open details for ${displayName(s)}`}
                  >
                    <td className="ngrp-cb" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        aria-label={`Select ${displayName(s)}`}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 210 }}>
                        <StudentAvatar student={s} size={40} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>{displayName(s)}</div>
                          <div style={{ fontSize: 10.5, color: '#6b7280', lineHeight: 1.35 }}>
                            {[s.school, s.program_type].filter(Boolean).join(' · ')}
                          </div>
                          {s.aspire_cohort && (
                            <span style={{
                              display: 'inline-block', fontSize: 9, fontWeight: 700, color: '#4A5D8F',
                              background: '#EDF0F7', borderRadius: 8, padding: '1px 6px', marginTop: 2,
                            }}>
                              {s.aspire_cohort}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <NgrpStatusPill config={FORM_STATES} value={r.form_status} srPrefix="Transition Form" />
                      {ts && <div className="ngrp-cellsub">{relTime(ts)}</div>}
                      {r.form_status === 'revised' && (r.form_revision_count || 0) > 0 && (
                        <div className="ngrp-cellsub">Rev {r.form_revision_count}</div>
                      )}
                    </td>
                    <td><NgrpStatusPill config={INTEREST_STATES} value={r.interest} srPrefix="Interest" /></td>
                    <td>
                      <NgrpStatusPill config={ELIGIBILITY_STATES} value={effectiveEligibility(r)} srPrefix="Eligibility" />
                      {overridden && <div className="ngrp-cellsub">staff override · see details</div>}
                    </td>
                    <td><NgrpStatusPill config={APPLICATION_STATES} value={r.application_status} srPrefix="Application" /></td>
                    <td className="ngrp-col-unit">
                      {r.assigned_unit
                        ? <span style={{ fontSize: 12, fontWeight: 600 }}>{r.assigned_unit}</span>
                        : <span style={{ fontSize: 12, color: '#9CA3AF' }}>—</span>}
                      {r.assigned_unit_changed_at && <div className="ngrp-cellsub">changed</div>}
                    </td>
                    <td className="ngrp-col-iv"><NgrpStatusPill config={INTERVIEW_STATES} value={r.interview_status} srPrefix="Interview" /></td>
                    <td className="ngrp-col-upd" style={{ fontSize: 11, color: '#6B7785', fontVariantNumeric: 'tabular-nums' }}>
                      {relTime(r.last_activity_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Bulk-selection action bar */}
        {canEdit && selected.size > 0 && (
          <div className="ngrp-selbar" role="region" aria-label="Bulk actions">
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {visibleSelected.length} selected
            </span>
            {selected.size !== visibleSelected.length && (
              <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)' }}>
                ({selected.size - visibleSelected.length} more hidden by filters - only visible alumni are sent)
              </span>
            )}
            <button
              type="button"
              onClick={reviewSend}
              disabled={visibleSelected.length === 0}
              style={{
                height: 32, padding: '0 14px', borderRadius: 9, border: 'none',
                background: '#fff', color: '#1D2567', fontSize: 12.5, fontWeight: 700,
                fontFamily: 'DM Sans, sans-serif', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Send size={13} strokeWidth={2.2} aria-hidden="true" />
              Send Transition Form
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 600,
                textDecoration: 'underline', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {/* Bulk-send review dialog - validates recipients BEFORE anything is sent. */}
      {sendReview && (
        <>
          <div onClick={() => setSendReview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: 1998 }} />
          <div role="dialog" aria-modal="true" aria-label="Send Transition Form" style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 'min(560px, calc(100vw - 32px))', background: '#fff', borderRadius: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 1999, fontFamily: 'DM Sans, sans-serif',
            display: 'flex', flexDirection: 'column', maxHeight: '80vh',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 16, fontWeight: 700 }}>
              Send Transition Form
            </div>
            <div style={{ padding: '14px 20px', fontSize: 13, color: '#4A5560', overflowY: 'auto' }}>
              <p style={{ margin: '0 0 10px' }}>
                Each alumnus receives one secure, recipient-specific Transition Form link through
                ASPIRE Connect → Outreach → Send to Many. Sending records
                “Transition Form Sent” - it is not an invitation to apply.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <li><b>{sendReview.send.length}</b> will receive the form for the first time</li>
                {sendReview.resend.length > 0 && (
                  <li><b>{sendReview.resend.length}</b> already received it - a new link will replace the old one
                    ({sendReview.resend.map(r => displayName(r.student)).join(', ')})</li>
                )}
                {sendReview.missingEmail.length > 0 && (
                  <li style={{ color: '#92400E' }}>
                    <b>{sendReview.missingEmail.length}</b> cannot be sent - no email on file
                    ({sendReview.missingEmail.map(r => displayName(r.student)).join(', ')}). They stay
                    selected so you can fix the profile and retry.
                  </li>
                )}
              </ul>
              {!provisioned && (
                <p style={{
                  margin: '12px 0 0', padding: '9px 12px', borderRadius: 8, fontSize: 12,
                  background: '#F3F4F6', color: '#4B5563', border: '1px solid #D1D5DB',
                }}>
                  Sending is disabled until the NGRP foundation migration and Phase-2 send endpoint
                  are applied (see docs/product/NGRP-WORKSPACE-1.md). Nothing was sent.
                </p>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setSendReview(null)} style={{
                height: 34, padding: '0 14px', borderRadius: 9, background: '#F3F4FF',
                border: '1px solid #E0E7FF', color: '#1D2567', fontSize: 13, fontWeight: 600,
                fontFamily: 'DM Sans, sans-serif', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button
                type="button"
                disabled
                title="Requires the NGRP foundation migration + Phase-2 send endpoint"
                onClick={() => toast?.info?.('Not sent', 'The NGRP send endpoint is not provisioned yet.')}
                style={{
                  height: 34, padding: '0 16px', borderRadius: 9, border: 'none',
                  background: '#1D2567', color: '#fff', fontSize: 13, fontWeight: 600,
                  fontFamily: 'DM Sans, sans-serif', cursor: 'not-allowed', opacity: 0.55,
                }}
              >
                Continue in Connect ({sendReview.send.length + sendReview.resend.length})
              </button>
            </div>
          </div>
        </>
      )}

      <ApplicantDrawer
        open={Boolean(drawerRow)}
        row={drawerRow}
        cycle={cycle}
        canEdit={canEdit}
        provisioned={provisioned}
        onClose={() => setDrawerRowId(null)}
      />
    </div>
  )
}
