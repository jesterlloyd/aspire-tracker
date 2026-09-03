// NGRP-WORKSPACE-2: Profiles & Interest - the alumni roster.
//
// This was the Applicants tab. It carries BOTH halves the name states: who each
// alumnus is, and where they are in the Transition Form (sent, opened,
// submitted), their stated interest and their calculated eligibility. That is
// why there is no separate Interest tab - it would have been these same columns
// a second time.
//
// (Original roster contract, unchanged.)
//
// THE ROSTER CONTRACT (server-resolved in /api/ngrp-workspace →
// lib/server/ngrpApplicants.js; this component never queries students):
//   - The selected NGRP cycle is the primary scope
//     (full contract: docs/product/NGRP-WORKSPACE-1.md).
// 1. The cycle's source ASPIRE cohorts come from ngrp_cycle_source_cohorts -
//    one cycle can combine several cohorts, and "All ASPIRE Cohorts" below
//    genuinely means all of THOSE, not whatever cohort the ASPIRE workspace
//    happens to have loaded.
// 2. Students arrive already filtered to canonical status 'Completed' across
//    every mapped cohort, identity straight from the students rows.
// 3. Cycle candidate state joins by student id; a missing row renders the
//    neutral defaults (never a failure).
// 4. Alumni hired through an EARLIER NGRP cycle are excluded server-side; a
//    prior application without a hire never excludes anyone.
// 5. Raw emails never reach the browser - rows carry has_email only.
import { useMemo, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, Send, GraduationCap, X, Eye } from 'lucide-react'
import { writeLaunchContext, LAUNCH_KINDS } from '../../lib/connect/launchContext'
import { FilterKPICard } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import EmptyState from '../EmptyState'
import NgrpStatusPill from './NgrpStatusPill'
import ApplicantDrawer from './ApplicantDrawer'
// NGRP-TRANSITION-PREVIEW-1: the same drawer the Automations and Survey previews use.
// It lives under connect/ by history rather than by coupling (its own header notes the
// shared extraction as debt); Evaluation already imports it across in the same way, so
// this follows the existing practice rather than moving a component three surfaces use.
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { transitionPreviewFor } from '../../lib/ngrp/transitionPreviewFixture'
import {
  FORM_STATES, INTEREST_STATES, ELIGIBILITY_STATES, APPLICATION_STATES,
  INTERVIEW_STATES, KPI_DEFS, SORT_OPTIONS,
  deriveApplicantRows, sortApplicantRows, effectiveEligibility, formTimestamp,
} from '../../lib/ngrp/ngrpStates'
import { useNgrpApplicants, postNgrpManage } from '../../lib/ngrp/useNgrpData'
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
  color: 'var(--text-body, #191919)', fontFamily: 'Plus Jakarta Sans, sans-serif', cursor: 'pointer',
}

function SkeletonRoster() {
  return (
    <div className="ngrp-roster" aria-busy="true" aria-label="Loading alumni roster">
      <div className="ngrp-roster-head"><span style={{ fontSize: 13, fontWeight: 700 }}>Alumni Roster</span></div>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid #EFEDE8' }}>
          <span className="ngrp-skel" style={{ width: 40, height: 40, borderRadius: '50%' }} />
          <span className="ngrp-skel" style={{ width: 180, height: 13 }} />
          <span className="ngrp-skel" style={{ width: 90, height: 20, borderRadius: 999, marginLeft: 'auto' }} />
          <span className="ngrp-skel" style={{ width: 90, height: 20, borderRadius: 999 }} />
          <span className="ngrp-skel" style={{ width: 90, height: 20, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  )
}

export default function ProfilesTab({ cycle, canManage, toast }) {
  const navigate = useNavigate()
  const { status, payload, dataUpdatedAt, refetch } = useNgrpApplicants(cycle?.id)
  // False until migration 20260904000000 is applied - the roster still works
  // with neutral defaults, but send/review actions disable themselves.
  const transitionProvisioned = payload?.transitionProvisioned !== false

  // Filters live in the URL (plan §3.2: shareable, restorable views - and
  // they survive the Connect round trip via the recorded back path). All
  // writes happen in event handlers, never in an effect.
  const [searchParams, setSearchParams] = useSearchParams()
  const kpiFilter    = KPI_DEFS.some(k => k.key === searchParams.get('kpi')) ? searchParams.get('kpi') : 'all'
  const query        = searchParams.get('q') || ''
  const cohortFilter = searchParams.get('cohort') || ''   // cohort_id of a mapped source cohort
  const schoolFilter = searchParams.get('school') || ''
  const sortKey      = SORT_OPTIONS.some(o => o.key === searchParams.get('sort')) ? searchParams.get('sort') : 'priority'
  const setParam = (key, value, defaultValue = '') => {
    const next = new URLSearchParams(searchParams)
    if (!value || value === defaultValue) next.delete(key); else next.set(key, value)
    setSearchParams(next, { replace: true })
  }
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    ;['kpi', 'q', 'cohort', 'school'].forEach(k => next.delete(k))
    setSearchParams(next, { replace: true })
  }

  const [selected, setSelected] = useState(() => new Set())
  const [drawerRowId, setDrawerRowId] = useState(null)
  const [sendReview, setSendReview] = useState(null)
  // NGRP-TRANSITION-PREVIEW-1: renders a synthetic copy of the invitation. No network,
  // no recipient, no token; it cannot send anything.
  const [showEmailPreview, setShowEmailPreview] = useState(false)

  const sourceCohorts = useMemo(() => payload?.sourceCohorts || [], [payload])
  const allRows = useMemo(
    () => deriveApplicantRows(payload?.students || [], payload?.candidates || []),
    [payload])

  // Cohort timeline order from the mapped source cohorts (start_date order,
  // resolved server-side from the cohorts table).
  const cohortOrder = useMemo(
    () => Object.fromEntries(sourceCohorts.map((c, i) => [c.name, i])),
    [sourceCohorts])

  const schoolOptions = useMemo(
    () => [...new Set(allRows.map(r => r.student.school).filter(Boolean))].sort(),
    [allRows])
  // URL filters can outlive the residency cycle that supplied their options.
  // Fail back to the visible All option instead of letting a stale cohort or
  // school continue to empty the roster behind a newly clicked KPI card.
  const activeCohortFilter = sourceCohorts.some(c => c.id === cohortFilter) ? cohortFilter : ''
  const activeSchoolFilter = schoolOptions.includes(schoolFilter) ? schoolFilter : ''

  const activeKpi = KPI_DEFS.find(k => k.key === kpiFilter) || KPI_DEFS[0]
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = allRows.filter(r => {
      if (!activeKpi.match(r)) return false
      if (activeCohortFilter && r.student.cohort_id !== activeCohortFilter) return false
      if (activeSchoolFilter && r.student.school !== activeSchoolFilter) return false
      if (q) {
        const hay = `${displayName(r.student)} ${r.student.first_name || ''} ${r.student.last_name || ''} ${r.student.school || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return sortApplicantRows(rows, sortKey, { cohortOrder })
  }, [allRows, activeKpi, activeCohortFilter, activeSchoolFilter, query, sortKey, cohortOrder])

  const hasFilters = kpiFilter !== 'all' || query || activeCohortFilter || activeSchoolFilter

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

  const reviewSend = () => {
    const send = [], missingEmail = [], resend = []
    for (const r of visibleSelected) {
      if (!r.student.has_email) { missingEmail.push(r); continue }
      if (r.form_status !== 'not_sent') { resend.push(r); continue }
      send.push(r)
    }
    setSendReview({ send, missingEmail, resend })
  }

  // The real handoff: NGRP → Applicants selection travels to ASPIRE Connect →
  // Outreach → Send to Many via the launch context, with the residency cohort
  // AND the current URL filters in the return path. The Connect panel owns
  // the server-side preview + typed confirmation; the send itself mints every
  // secure link server-side.
  const launchSend = useCallback((rows) => {
    const ctx = writeLaunchContext({
      kind: LAUNCH_KINDS.NGRP_TRANSITION_FORM,
      cycleId: cycle.id,
      cycleName: cycle.name || '',
      cohortId: null,
      templateKey: 'ngrp_transition_form_invitation',
      source: 'ngrp_applicants',
      returnPath: `/ngrp/applicants${window.location.search || ''}`,
      studentIds: rows.map(r => r.id),
    })
    if (!ctx) { toast?.error?.('Send unavailable', 'The send could not be prepared in this browser.'); return }
    navigate('/connect/outreach?launch=1')
  }, [cycle, navigate, toast])

  // Stable identity: AutomationEmailPreviewDrawer memoizes its render on `entry`, so a
  // fresh object each parent render would re-render the email on every keystroke above.
  const transitionPreview = useMemo(() => transitionPreviewFor(cycle?.name), [cycle?.name])

  // Staff review/decision actions (drawer). Each is explicit, audited
  // server-side, and refreshes the roster quietly on success.
  const runManage = useCallback(async (action, extra, successTitle, successBody) => {
    const res = await postNgrpManage(action, extra)
    if (!res.ok) {
      toast?.error?.('Not saved', (res.errors || []).map(e => e.message).join(' ') || res.error || 'The action failed.')
      return null
    }
    if (successTitle) toast?.success?.(successTitle, successBody)
    refetch()
    return res
  }, [refetch, toast])

  const drawerRow = drawerRowId ? allRows.find(r => r.id === drawerRowId) : null

  // ── Distinct query states (none conflated with "no alumni") ────────────────
  if (!cycle) return null
  if (status === 'loading') return <SkeletonRoster />
  if (status === 'unauthorized') {
    return <EmptyState icon={<GraduationCap />} heading="NGRP access required" subtext="Your account does not have access to the NGRP Applicants roster." />
  }
  if (status === 'unprovisioned') {
    return (
      <div className="snap" style={{ margin: '14px 0' }}>
        <EmptyState
          icon={<GraduationCap />}
          heading="NGRP persistence is not provisioned yet"
          subtext="Apply the NGRP foundation migration (Owner SQL gate), then reload. No roster is shown until the workspace can answer completely."
        />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="ngrp-banner ngrp-banner-error" role="alert">
        <b>The roster could not be loaded.</b> This is a server or connection problem, not an empty
        roster.{' '}
        <button type="button" onClick={() => refetch()} className="ngrp-linkbtn">Try again</button>
      </div>
    )
  }
  if (!payload) return null

  // Specific empty state: the cycle has NO mapped source cohorts. Different
  // situation from "cohorts mapped but nobody has completed yet".
  if (sourceCohorts.length === 0) {
    return (
      <div className="snap" style={{ margin: '14px 0' }}>
        <EmptyState
          icon={<GraduationCap />}
          heading="No ASPIRE cohorts are participating in this residency cohort"
          subtext={`${cycle.name} has no ASPIRE cohorts linked yet, so there is no student scope to draw applicants from. Choose them in Edit Cohort, from the Scope picker in the header.`}
        />
      </div>
    )
  }

  return (
    <div>
      {/* Stale banner: background refresh failed, cached roster still shown.
          Quiet - a banner, never a toast. */}
      {status === 'stale' && (
        <div className="ngrp-banner ngrp-banner-warn" role="status">
          Live refresh failed - showing data from {relTime(dataUpdatedAt)}.{' '}
          <button type="button" onClick={() => refetch()} className="ngrp-linkbtn">Retry</button>
        </div>
      )}

      {(payload.excludedPriorHires || 0) > 0 && (
        <div className="ngrp-banner ngrp-banner-info" role="note">
          {payload.excludedPriorHires} alumn{payload.excludedPriorHires === 1 ? 'us' : 'i'} hired through an
          earlier NGRP cycle {payload.excludedPriorHires === 1 ? 'is' : 'are'} not listed - they already
          reached the pathway's destination.
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="snap" style={{ margin: '14px 0' }}>
          <EmptyState
            icon={<GraduationCap />}
            heading="No completed alumni yet"
            subtext={`The mapped ASPIRE cohorts (${sourceCohorts.map(c => c.name).join(', ')}) have no students at Completed status yet. Alumni appear here automatically as students complete ASPIRE.`}
          />
        </div>
      ) : (
        <>
          <div className="ngrp-kpis" role="group" aria-label="Roster filters">
            {KPI_DEFS.map(k => (
              <FilterKPICard
                key={k.key}
                value={allRows.filter(k.match).length}
                label={k.label}
                sub={k.sub}
                accent={k.accent}
                active={kpiFilter === k.key}
                onClick={() => setParam('kpi', kpiFilter === k.key ? 'all' : k.key, 'all')}
                ariaLabel={`Filter roster: ${k.label}`}
              />
            ))}
          </div>

          <div className="ngrp-toolbar">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={12} strokeWidth={2.2} aria-hidden="true" style={{ position: 'absolute', left: 9, color: '#9CA3AF' }} />
              <input
                type="search"
                value={query}
                onChange={e => setParam('q', e.target.value)}
                placeholder="Search alumni"
                aria-label="Search alumni by name or school"
                style={{ ...selectStyle, cursor: 'text', paddingLeft: 28, minWidth: 190 }}
              />
            </div>
            {/* Every cohort MAPPED to the cycle is listed - including one with
                zero completed students - because the option list comes from the
                cycle's source-cohort mapping, not from the loaded rows. */}
            <select value={activeCohortFilter} onChange={e => setParam('cohort', e.target.value)} aria-label="Filter by source ASPIRE cohort" style={selectStyle}>
              <option value="">All ASPIRE Cohorts</option>
              {sourceCohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={activeSchoolFilter} onChange={e => setParam('school', e.target.value)} aria-label="Filter by school" style={selectStyle}>
              <option value="">All Schools</option>
              {schoolOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7785' }}>
              Sort
              <select value={sortKey} onChange={e => setParam('sort', e.target.value, 'priority')} aria-label="Sort roster" style={selectStyle}>
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
                color: '#1D2567', fontSize: 11, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif', cursor: 'pointer',
              }}>
                <X size={11} strokeWidth={2.5} aria-hidden="true" />
                Clear filters
              </button>
            )}
          </div>

          <div className="ngrp-roster">
            <div className="ngrp-roster-head">
              <span style={{ fontSize: 13, fontWeight: 700 }}>Alumni Roster</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                  {cycle.name} · {sourceCohorts.length} participating cohort{sourceCohorts.length === 1 ? '' : 's'} · sorted by {SORT_OPTIONS.find(o => o.key === sortKey)?.label.toLowerCase()}
                </span>
                {/* Always available, and deliberately NOT inside the bulk-selection bar:
                    reading what the email says should not require selecting a real
                    alumnus first. The preview is synthetic and sends nothing. */}
                <button
                  type="button"
                  onClick={() => setShowEmailPreview(true)}
                  title="Preview the Transition Form email"
                  aria-label="Preview the Transition Form email"
                  style={{
                    width: 28, height: 28, flexShrink: 0, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', background: 'none',
                    border: 'none', borderRadius: 8, cursor: 'pointer', color: '#9ca3af', padding: 0,
                  }}
                >
                  <Eye size={15} />
                </button>
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
                          subtext="Adjust the filters above, or clear them to see every completed alumnus in the cohort's participating ASPIRE cohorts."
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

            {canManage && selected.size > 0 && (
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
                    fontFamily: 'Plus Jakarta Sans, sans-serif', cursor: 'pointer',
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
                    textDecoration: 'underline', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif',
                  }}
                >
                  Clear selection
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {showEmailPreview && (
        <AutomationEmailPreviewDrawer
          title="NGRP Transition Form"
          entry={transitionPreview}
          footNote="The recipient and link are synthetic; the cohort name is your live one. Rendered with the same template the send uses. The Transition Form is sent by hand, never on a schedule."
          onClose={() => setShowEmailPreview(false)}
        />
      )}

      {sendReview && (
        <>
          <div onClick={() => setSendReview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: 1998 }} />
          <div role="dialog" aria-modal="true" aria-label="Send Transition Form" style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 'min(560px, calc(100vw - 32px))', background: '#fff', borderRadius: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 1999, fontFamily: 'Plus Jakarta Sans, sans-serif',
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
              {!transitionProvisioned && (
                <p style={{
                  margin: '12px 0 0', padding: '9px 12px', borderRadius: 8, fontSize: 12,
                  background: '#F3F4F6', color: '#4B5563', border: '1px solid #D1D5DB',
                }}>
                  Sending is disabled until the pending NGRP migration is applied. Nothing was sent.
                </p>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setSendReview(null)} style={{
                height: 34, padding: '0 14px', borderRadius: 9, background: '#F3F4FF',
                border: '1px solid #E0E7FF', color: '#1D2567', fontSize: 13, fontWeight: 600,
                fontFamily: 'Plus Jakarta Sans, sans-serif', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!transitionProvisioned || (sendReview.send.length + sendReview.resend.length) === 0}
                title={transitionProvisioned ? undefined : 'Requires the pending NGRP migration'}
                onClick={() => {
                  const rows = [...sendReview.send, ...sendReview.resend]
                  setSendReview(null)
                  launchSend(rows)
                }}
                style={{
                  height: 34, padding: '0 16px', borderRadius: 9, border: 'none',
                  background: '#1D2567', color: '#fff', fontSize: 13, fontWeight: 600,
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  cursor: !transitionProvisioned ? 'not-allowed' : 'pointer',
                  opacity: !transitionProvisioned ? 0.55 : 1,
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
        canManage={canManage}
        provisioned={transitionProvisioned}
        onClose={() => setDrawerRowId(null)}
        actions={{
          sendForm: r => launchSend([r]),
          review: r => postNgrpManage('candidate_review', { candidate_id: r.candidate_id }),
          confirmApplication: r => runManage('application_confirm', { candidate_id: r.candidate_id },
            'Application confirmed', `${displayName(r.student)} is now on the official NGRP applicant list.`),
          withdraw: r => runManage('application_withdraw', { candidate_id: r.candidate_id },
            'Withdrawal recorded', `${displayName(r.student)} is recorded as withdrawn (a neutral state).`),
          override: (r, fields) => runManage('eligibility_override', { candidate_id: r.candidate_id, ...fields },
            'Eligibility overridden', 'The calculated result is preserved beside the override.'),
          revokeLink: r => runManage('token_revoke', { candidate_id: r.candidate_id },
            'Link revoked', 'The live Transition Form link no longer works. Use Resend to issue a new one.'),
          // NGRP-INTERVIEW-HIRE-1: recorded in this drawer from both surfaces,
          // so one person's record has exactly one place it is edited.
          setInterview: (r, fields) => runManage('interview_set', { candidate_id: r.candidate_id, ...fields },
            'Interview recorded', `${displayName(r.student)}'s interview state is saved.`),
          setOutcome: (r, fields) => runManage('outcome_set', { candidate_id: r.candidate_id, ...fields },
            'Outcome recorded', `${displayName(r.student)}'s residency outcome is saved.`),
        }}
      />
    </div>
  )
}
