// NGRP-INTERVIEWS-1 Phase 3 (Owner, 2026-10-05): the Unit Leader Portal's Interviews tab. "Copy the
// table from internship - calendar on top, results table at the bottom, opens to the rubric.
// Interviews today tiles at the very top." Built from the internship Interviews tab's own parts:
// the Interviews Today tiles (OnCampusNow, shown only on a day with interviews), the KPI filter
// cards (FilterKPICard) and the worklist (`ir-worklist` rows), each row opening the NGRP rubric book.
//
// ONE-CALENDAR-1 (Owner, 2026-10-06): the calendar is NOT here. The unit's one calendar is on At a
// Glance (Residency view), where times are opened, blocked and removed; this tab keeps the tiles,
// the results and the rubric.
//
// A unit leader sees only the applicants Talent Acquisition paired with their unit, and only their
// own rubric. Applicants who ranked the unit first show as a count, never by name. An Owner or Admin
// previewing the portal sees it all read-only (the server refuses their writes too).
import { useCallback, useEffect, useMemo, useState } from 'react'
import OnCampusNow from '../../components/oncampus/OnCampusNow'
import { FilterKPICard } from '../../components/KPIBand'
import { dayOf, timeOf } from '../../lib/ngrp/interviewScheduleModel'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { recommendationLabel } from '../../lib/ngrp/ngrpRubric'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { pacificDateString } from '../../lib/birthdayEligibility'
import UnitStudentAvatar from './UnitStudentAvatar'
import NgrpRubricBook from './NgrpRubricBook'
import { fetchUnitInterviews } from './unitInterviewsApi'

const REC_PILL = { recommend: ['#dcfce7', '#166534'], recommend_with_reservations: ['#fef3c7', '#92400e'], do_not_recommend: ['#fee2e2', '#991b1b'] }
const PT = { timeZone: 'America/Los_Angeles' }
const nameOf = p => [p.last_name, p.preferred_first_name || p.first_name].filter(Boolean).join(', ')
const full = p => `${p.preferred_first_name || p.first_name} ${p.last_name}`.trim()
const fmtAppt = iso => (iso ? `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...PT })} · ${timeOf(iso)}` : null)

export default function UnitInterviewsWorkspace({ unitKey = null, toast = null }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState(null)
  const today = pacificDateString()

  const load = useCallback(async () => {
    const r = await fetchUnitInterviews(unitKey)
    if (!r.ok) { setStatus('error'); return }
    setData(r.data); setStatus('ready')
  }, [unitKey])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])
  useRegisterPortalRefresh(load)

  const preview = data?.preview === true
  const interviewees = useMemo(() => data?.interviewees || [], [data])
  const slots = useMemo(() => data?.slots || [], [data])
  const byCandidate = useMemo(() => new Map(interviewees.map(i => [i.candidate_id, i])), [interviewees])

  if (openId) {
    return <NgrpRubricBook candidateId={openId} readOnly={preview} toast={toast} onBack={() => { setOpenId(null); load() }} />
  }
  if (status === 'loading') return <div className="ptl-card" role="status">Loading interviews…</div>
  if (status === 'error') return <div className="ptl-card">Interviews could not be loaded. Use Refresh to try again.</div>

  // ── Interviews Today ──
  const todays = slots.filter(s => s.booked && dayOf(s.slot_at) === today)
  const tiles = todays.map(s => {
    const p = s.booked_candidate_id ? byCandidate.get(s.booked_candidate_id) : null
    return {
      key: s.id, name: p ? full(p) : 'Booked', subLabel: `${s.unit_key} · ${timeOf(s.slot_at)}`,
      avatar: <UnitStudentAvatar url={null} name={p ? full(p) : 'Booked'} size={34} />,
      badge: p?.interview_mode ? { label: INTERVIEW_MODE_LABELS[p.interview_mode], tone: 'day' } : null,
      statusText: p?.my_rubric?.status === 'completed' ? 'Scored' : 'Open rubric',
      onClick: p ? () => setOpenId(p.candidate_id) : undefined,
      ariaLabel: p ? `Open the rubric for ${full(p)}` : 'Booked interview',
    }
  })

  // ── Results ──
  const counts = {
    total: interviewees.length,
    scheduled: interviewees.filter(i => i.interview_status === 'scheduled' || slots.some(s => s.booked && s.booked_candidate_id === i.candidate_id)).length,
    toScore: interviewees.filter(i => i.my_rubric?.status !== 'completed').length,
    scored: interviewees.filter(i => i.my_rubric?.status === 'completed').length,
  }
  const apptOf = i => {
    const s = slots.find(x => x.booked && x.booked_candidate_id === i.candidate_id)
    return s?.slot_at || i.interview_at || null
  }
  const rows = interviewees
    .filter(i => !filter || (filter === 'scheduled' ? !!apptOf(i) : filter === 'to_score' ? i.my_rubric?.status !== 'completed' : i.my_rubric?.status === 'completed'))
    .sort((a, b) => String(apptOf(a) || '9').localeCompare(String(apptOf(b) || '9')) || nameOf(a).localeCompare(nameOf(b)))
  const ranked = (data?.rankedFirst || []).filter(r => r.count > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--aspire-gap-card, 16px)' }}>
      {preview && <p className="ptl-notice ptl-notice-warn" role="status">Preview: you see this tab as a unit leader does. Nothing can be saved from a preview.</p>}
      <OnCampusNow title="Interviews Today" sub={`${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...PT })} · ${tiles.length} scheduled`} rows={tiles} flush />

      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="ptl-card-title ptl-roster-heading" style={{ margin: 0 }}>Interview Results</h3>
          {ranked.length > 0 && (
            <span className="ptl-muted" style={{ fontSize: 12.5 }}>
              {ranked.map(r => `${r.count} applicant${r.count === 1 ? '' : 's'} ranked ${r.unit} first`).join(' · ')}. Names appear once Talent Acquisition pairs them with you.
            </span>
          )}
          <span className="ptl-muted" style={{ fontSize: 12.5 }}>Interview times are opened on At a Glance's calendar, in its Residency view.</span>
        </div>
        <div className="ir-kpis" style={{ display: 'grid', gap: 10, padding: '10px 0 12px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <FilterKPICard value={counts.total} label="Paired With You" accent="nightfall" active={!filter} onClick={() => setFilter(null)} />
          <FilterKPICard value={counts.scheduled} label="Scheduled" accent="marina" active={filter === 'scheduled'} onClick={() => setFilter(filter === 'scheduled' ? null : 'scheduled')} />
          <FilterKPICard value={counts.toScore} label="To Score" accent="dawn" active={filter === 'to_score'} onClick={() => setFilter(filter === 'to_score' ? null : 'to_score')} />
          <FilterKPICard value={counts.scored} label="Scored" accent="sage" active={filter === 'scored'} onClick={() => setFilter(filter === 'scored' ? null : 'scored')} />
        </div>
        {interviewees.length === 0 ? (
          <div className="ptl-card"><p className="ptl-muted" style={{ margin: 0 }}>No applicants are paired with your unit yet. Talent Acquisition pairs them on the Interview Board; they appear here when they do.</p></div>
        ) : (
          <div className="ir-worklist">
            <div className="ir-wl-thead">
              <div style={{ width: 6, flexShrink: 0 }} />
              <div className="ir-wl-th ir-wl-col-student">Applicant</div>
              <div className="ir-wl-th ir-wl-col-appt">Appointment</div>
              <div className="ir-wl-th ir-wl-col-workflow">Their Choice</div>
              <div className="ir-wl-th ir-wl-col-outcome">Your Rubric</div>
              <div className="ir-wl-th ir-wl-col-action">Action</div>
            </div>
            {rows.map(i => {
              const appt = apptOf(i)
              const mine = i.my_rubric
              const pill = mine?.status === 'completed' && REC_PILL[mine.recommendation]
              return (
                <div key={i.candidate_id} className="ir-wl-row" role="button" tabIndex={0} aria-label={`Open the rubric for ${full(i)}`}
                  onClick={() => setOpenId(i.candidate_id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(i.candidate_id) } }}>
                  <div className="ir-wl-flag-strip" style={{ background: 'transparent' }} />
                  <div className="ir-wl-cell ir-wl-col-student">
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <UnitStudentAvatar url={null} name={full(i)} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{nameOf(i)}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{[i.school, i.program_type].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                  </div>
                  <div className="ir-wl-cell ir-wl-col-appt">
                    {appt ? (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-accent-primary)', whiteSpace: 'nowrap' }}>{fmtAppt(appt)}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>{INTERVIEW_MODE_LABELS[i.interview_mode] || 'Format not recorded'}</div>
                      </>
                    ) : <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Not Scheduled</span>}
                  </div>
                  <div className="ir-wl-cell ir-wl-col-workflow">{i.choice_rank ? `#${i.choice_rank} choice` : 'Not ranked'}<div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{i.unit}</div></div>
                  <div className="ir-wl-cell ir-wl-col-outcome">
                    {mine?.status === 'completed' ? (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>{mine.composite}<span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 11 }}> / 15</span></div>
                        {pill && <span style={{ alignSelf: 'flex-start', display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4, background: pill[0], color: pill[1] }}>{recommendationLabel(mine.recommendation)}</span>}
                      </>
                    ) : <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{mine ? 'In progress' : 'Not started'}</span>}
                  </div>
                  <div className="ir-wl-cell ir-wl-col-action">
                    <button type="button" className="ptl-btn ptl-btn-sm" style={{ marginTop: 0, whiteSpace: 'nowrap' }} onClick={e => { e.stopPropagation(); setOpenId(i.candidate_id) }}>{mine?.status === 'completed' ? 'View Rubric' : 'Open Rubric'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}
