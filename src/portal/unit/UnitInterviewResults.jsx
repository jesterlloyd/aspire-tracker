// ONE-CALENDAR-2 (Owner, 2026-10-06): the Unit Leader's interview results, one table in two places.
// The Interviews tab shows it under the Interviews Today tiles; At a Glance shows it under the
// calendar when the Residency view is picked, in place of Your Students. Built from the internship
// Interviews tab's own parts: the KPI filter cards and the `ir-worklist` rows. A row opens the
// applicant's rubric through `onOpen(candidateId)`; the host decides whether that is in place (the
// Interviews tab) or a trip to the Interviews tab (At a Glance).
import { useState } from 'react'
import { FilterKPICard } from '../../components/KPIBand'
import { recommendationLabel } from '../../lib/ngrp/ngrpRubric'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { timeOf } from '../../lib/ngrp/interviewScheduleModel'
import UnitStudentAvatar from './UnitStudentAvatar'

const REC_PILL = { recommend: ['#dcfce7', '#166534'], recommend_with_reservations: ['#fef3c7', '#92400e'], do_not_recommend: ['#fee2e2', '#991b1b'] }
const PT = { timeZone: 'America/Los_Angeles' }
const nameOf = p => [p.last_name, p.preferred_first_name || p.first_name].filter(Boolean).join(', ')
const full = p => `${p.preferred_first_name || p.first_name} ${p.last_name}`.trim()
const fmtAppt = iso => (iso ? `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...PT })} · ${timeOf(iso)}` : null)

export default function UnitInterviewResults({ interviewees = [], slots = [], rankedFirst = [], heading = 'Interview Results', note = null, onOpen }) {
  const [filter, setFilter] = useState(null)
  const apptOf = i => {
    const s = slots.find(x => x.booked && x.booked_candidate_id === i.candidate_id)
    return s?.slot_at || i.interview_at || null
  }
  const counts = {
    total: interviewees.length,
    scheduled: interviewees.filter(i => !!apptOf(i)).length,
    toScore: interviewees.filter(i => i.my_rubric?.status !== 'completed').length,
    scored: interviewees.filter(i => i.my_rubric?.status === 'completed').length,
  }
  const rows = interviewees
    .filter(i => !filter || (filter === 'scheduled' ? !!apptOf(i) : filter === 'to_score' ? i.my_rubric?.status !== 'completed' : i.my_rubric?.status === 'completed'))
    .sort((a, b) => String(apptOf(a) || '9').localeCompare(String(apptOf(b) || '9')) || nameOf(a).localeCompare(nameOf(b)))
  const ranked = rankedFirst.filter(r => r.count > 0)
  const toggle = key => setFilter(filter === key ? null : key)

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 className="ptl-card-title ptl-roster-heading" style={{ margin: 0 }}>{heading}</h3>
        {ranked.length > 0 && (
          <span className="ptl-muted" style={{ fontSize: 12.5 }}>
            {ranked.map(r => `${r.count} applicant${r.count === 1 ? '' : 's'} ranked ${r.unit} first`).join(' · ')}. Names appear once Talent Acquisition pairs them with you.
          </span>
        )}
        {note && <span className="ptl-muted" style={{ fontSize: 12.5 }}>{note}</span>}
      </div>
      <div className="ir-kpis" style={{ display: 'grid', gap: 10, padding: '10px 0 12px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <FilterKPICard value={counts.total} label="Paired With You" accent="nightfall" active={!filter} onClick={() => setFilter(null)} />
        <FilterKPICard value={counts.scheduled} label="Scheduled" accent="marina" active={filter === 'scheduled'} onClick={() => toggle('scheduled')} />
        <FilterKPICard value={counts.toScore} label="To Score" accent="dawn" active={filter === 'to_score'} onClick={() => toggle('to_score')} />
        <FilterKPICard value={counts.scored} label="Scored" accent="sage" active={filter === 'scored'} onClick={() => toggle('scored')} />
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
            const open = () => onOpen?.(i.candidate_id)
            return (
              <div key={i.candidate_id} className="ir-wl-row" role="button" tabIndex={0} aria-label={`Open the rubric for ${full(i)}`}
                onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}>
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
                  <button type="button" className="ptl-btn ptl-btn-sm" style={{ marginTop: 0, whiteSpace: 'nowrap' }} onClick={e => { e.stopPropagation(); open() }}>{mine?.status === 'completed' ? 'View Rubric' : 'Open Rubric'}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
