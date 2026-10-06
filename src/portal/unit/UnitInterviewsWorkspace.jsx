// NGRP-INTERVIEWS-1 Phase 3 (Owner, 2026-10-05): the Unit Leader Portal's Interviews tab. "Copy the
// table from internship - calendar on top, results table at the bottom, opens to the rubric.
// Interviews today tiles at the very top." Built from the internship Interviews tab's own parts:
// the Interviews Today tiles (OnCampusNow, shown only on a day with interviews), the planner
// calendar (CanonicalCalendarFoundation, slate paper), the KPI filter cards (FilterKPICard) and the
// worklist (`ir-worklist` rows), each row opening the NGRP rubric book.
//
// A unit leader sees only the applicants Talent Acquisition paired with their unit, and only their
// own rubric. Applicants who ranked the unit first show as a count, never by name. An Owner or Admin
// previewing the portal sees it all read-only (the server refuses their writes too).
import { useCallback, useEffect, useMemo, useState } from 'react'
import OnCampusNow from '../../components/oncampus/OnCampusNow'
import { FilterKPICard } from '../../components/KPIBand'
import { MiniCalendar } from '../../components/CalendarSidebar'
import {
  CanonicalCalendarLayout, CanonicalCalendarSidebar, CanonicalCalendarTodayPanel,
  CanonicalCalendarNav, CanonicalCalendarMonthTitle, CanonicalWeekdayHeader,
  CanonicalMonthCell, CanonicalActivityChip,
} from '../../components/shared/CanonicalCalendarFoundation'
import { ModalShell } from '../../components/ngrp/NgrpFormUi'
import { confirmDialog } from '../../components/shared/confirmDialog'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { recommendationLabel } from '../../lib/ngrp/ngrpRubric'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { pacificDateString } from '../../lib/birthdayEligibility'
import UnitStudentAvatar from './UnitStudentAvatar'
import NgrpRubricBook from './NgrpRubricBook'
import {
  fetchUnitInterviews, openInterviewTimes, removeInterviewTimes, setInterviewSlotBlocked,
} from './unitInterviewsApi'

// The internship calendar's legend colours: scheduled interview, open availability, blocked time.
const BOOKED = '#1D2567'
const OPEN = '#166534'
const BLOCKED = '#991B1B'
const REC_PILL = { recommend: ['#dcfce7', '#166534'], recommend_with_reservations: ['#fef3c7', '#92400e'], do_not_recommend: ['#fee2e2', '#991b1b'] }
const PT = { timeZone: 'America/Los_Angeles' }
const dayOf = iso => pacificDateString(new Date(iso))
const timeOf = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...PT })
const longDate = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const nameOf = p => [p.last_name, p.preferred_first_name || p.first_name].filter(Boolean).join(', ')
const full = p => `${p.preferred_first_name || p.first_name} ${p.last_name}`.trim()
const fmtAppt = iso => (iso ? `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...PT })} · ${timeOf(iso)}` : null)

function OpenTimesModal({ cycles, units, onClose, onSaved, toast }) {
  const [f, setF] = useState({ cycle_id: cycles[0]?.id || '', unit: units[0] || '', block_date: '', start_time: '09:00', end_time: '12:00', duration_minutes: 30, break_minutes: 0, interview_mode: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const save = async () => {
    setBusy(true); setErrors([])
    const r = await openInterviewTimes({ ...f, interview_mode: f.interview_mode || null })
    setBusy(false)
    if (!r.ok) { setErrors(r.data?.errors?.map(e => e.message) || ['The times could not be opened. Try again in a moment.']); return }
    toast?.success?.('Times opened', `${r.data.slot_count} interview time${r.data.slot_count === 1 ? '' : 's'} on ${longDate(f.block_date)}.`)
    onSaved()
  }
  const field = { display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }
  return (
    <ModalShell label="Open interview times" onClose={onClose} width={520}>
      <div style={{ padding: 20, display: 'grid', gap: 12 }}>
        <h2 className="ptl-card-title" style={{ margin: 0 }}>Open Interview Times</h2>
        <p className="ptl-muted" style={{ margin: 0 }}>The span is cut into interview times. Talent Acquisition or the applicant books one through a link.</p>
        {cycles.length > 1 && (
          <label style={field}>Residency cohort
            <select className="ptl-field" value={f.cycle_id} onChange={e => set('cycle_id', e.target.value)}>{cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
        {units.length > 1 && (
          <label style={field}>Unit
            <select className="ptl-field" value={f.unit} onChange={e => set('unit', e.target.value)}>{units.map(u => <option key={u} value={u}>{u}</option>)}</select>
          </label>
        )}
        <label style={field}>Date<input className="ptl-field" type="date" value={f.block_date} onChange={e => set('block_date', e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={field}>From<input className="ptl-field" type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)} /></label>
          <label style={field}>To<input className="ptl-field" type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)} /></label>
          <label style={field}>Each interview
            <select className="ptl-field" value={f.duration_minutes} onChange={e => set('duration_minutes', Number(e.target.value))}>{[20, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}</select>
          </label>
          <label style={field}>Break between
            <select className="ptl-field" value={f.break_minutes} onChange={e => set('break_minutes', Number(e.target.value))}>{[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m ? `${m} minutes` : 'None'}</option>)}</select>
          </label>
        </div>
        <label style={field}>Format (optional)
          <select className="ptl-field" value={f.interview_mode} onChange={e => set('interview_mode', e.target.value)}>
            <option value="">Not decided</option>{Object.entries(INTERVIEW_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {errors.length > 0 && <p role="alert" style={{ margin: 0, color: 'var(--aspire-bad)', fontSize: 12.5 }}>{errors.join(' ')}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="ptl-btn ptl-btn-sm" style={{ marginTop: 0 }} disabled={busy || !f.block_date} onClick={save}>{busy ? 'Opening…' : 'Open Times'}</button>
        </div>
      </div>
    </ModalShell>
  )
}

export default function UnitInterviewsWorkspace({ unitKey = null, toast = null }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState(null)
  const [modal, setModal] = useState(false)
  const today = pacificDateString()
  const [selected, setSelected] = useState(today)
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split('-').map(Number); return { year: y, month: m - 1 } })

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
  const units = useMemo(() => [...new Set([...(data?.rankedFirst || []).map(r => r.unit)])], [data])
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

  // ── Calendar ──
  const first = new Date(cursor.year, cursor.month, 1).getDay()
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const ymd = d => `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => ymd(i + 1))]
  while (cells.length % 7) cells.push(null)
  const slotsOn = d => slots.filter(s => dayOf(s.slot_at) === d)
  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const step = n => setCursor(c => { const d = new Date(c.year, c.month + n, 1); return { year: d.getFullYear(), month: d.getMonth() } })
  const blocksOn = d => (data?.blocks || []).filter(b => b.block_date === d)
  const removeBlock = async (b) => {
    if (!(await confirmDialog(`Remove the open times on ${longDate(b.block_date)}?`, { confirmLabel: 'Remove Times', danger: true }))) return
    const r = await removeInterviewTimes(b.id)
    if (!r.ok) { toast?.error?.('Not removed', r.error === 'has_bookings' ? 'Someone is booked into these times. Ask Talent Acquisition to move the booking first.' : 'The times could not be removed.'); return }
    load()
  }
  const toggleSlot = async (s) => {
    const r = await setInterviewSlotBlocked(s.id, s.status !== 'blocked')
    if (!r.ok) { toast?.error?.('Not changed', 'That time could not be changed.'); return }
    load()
  }

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

      <CanonicalCalendarLayout paper="slate" title="Interview Calendar" labelledBy="ul-iv-cal"
        description="Your unit's residency interviews and the times you have opened."
        toolbar={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <div style={{ flex: 1 }}>
              <CanonicalCalendarNav onPrev={() => step(-1)} onNext={() => step(1)} prevAriaLabel="Previous month" nextAriaLabel="Next month"
                onToday={() => { const [y, m] = today.split('-').map(Number); setCursor({ year: y, month: m - 1 }); setSelected(today) }} />
            </div>
            <CanonicalCalendarMonthTitle ariaLive="polite">{monthName}</CanonicalCalendarMonthTitle>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              {!preview && data?.rubricsProvisioned !== false && (data?.cycles || []).length > 0 && (
                <button type="button" className="pl-ghost pl-ghost-event" style={{ height: 32, padding: '0 14px', borderRadius: 9, fontWeight: 600, fontSize: 12 }}
                  onClick={() => setModal(true)}>+ Open Times</button>
              )}
            </div>
          </div>
        }
        sidebar={
          <CanonicalCalendarSidebar>
            <MiniCalendar selectedDate={selected} onSelectDate={d => { setSelected(d); const [y, m] = d.split('-').map(Number); setCursor({ year: y, month: m - 1 }) }} />
            <CanonicalCalendarTodayPanel kicker={selected === today ? 'Today' : 'Selected day'} dateLabel={longDate(selected)}
              summary={(() => { const s = slotsOn(selected); const b = s.filter(x => x.booked).length; const o = s.filter(x => x.status === 'available').length; return s.length ? `${b} scheduled · ${o} open` : null })()}
              emptyLabel="No interview times this day.">
              {slotsOn(selected).map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.booked ? BOOKED : s.status === 'blocked' ? BLOCKED : OPEN }} aria-hidden="true" />
                  <span style={{ fontWeight: 600, color: 'var(--paper-ink)' }}>{timeOf(s.slot_at)}</span>
                  <span style={{ color: 'var(--paper-muted)' }}>{s.booked ? (s.booked_name || 'Booked') : s.status === 'blocked' ? 'Blocked' : 'Open'}</span>
                  {!preview && !s.booked && (
                    <button type="button" className="pl-ghost" style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 'var(--aspire-radius-control)', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }} onClick={() => toggleSlot(s)}>{s.status === 'blocked' ? 'Reopen' : 'Block'}</button>
                  )}
                </div>
              ))}
              {!preview && blocksOn(selected).map(b => (
                <button key={b.id} type="button" className="pl-ghost" style={{ marginTop: 6, padding: '4px 10px', borderRadius: 'var(--aspire-radius-control)', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }} onClick={() => removeBlock(b)}>
                  Remove {b.start_time.slice(0, 5)} to {b.end_time.slice(0, 5)} times
                </button>
              ))}
            </CanonicalCalendarTodayPanel>
            <div className="pl-legend">
              <span><i aria-hidden="true" style={{ background: 'rgba(29,37,103,0.10)', borderLeft: `3px solid ${BOOKED}` }} />Scheduled interview</span>
              <span><i aria-hidden="true" style={{ background: 'rgba(21,128,61,0.10)', borderLeft: `3px solid ${OPEN}` }} />Open time</span>
              <span><i aria-hidden="true" style={{ background: 'rgba(185,28,28,0.10)', borderLeft: `3px solid ${BLOCKED}` }} />Blocked time</span>
            </div>
          </CanonicalCalendarSidebar>
        }>
        <div className="pl-calbox">
          <CanonicalWeekdayHeader />
          <div className="pl-monthgrid" role="grid" aria-label={`${monthName} interviews`} style={{ gridTemplateColumns: 'repeat(7, 1fr)', '--weeks': cells.length / 7 }}>
            {cells.map((d, i) => d === null ? <CanonicalMonthCell key={`p${i}`} isOtherMonth /> : (() => {
              const s = slotsOn(d)
              const booked = s.filter(x => x.booked)
              const open = s.filter(x => x.status === 'available').length
              const blocked = s.filter(x => x.status === 'blocked').length
              return (
                <CanonicalMonthCell key={d} day={Number(d.slice(-2))} isToday={d === today} isSelected={d === selected} isFuture={d > today}
                  ariaLabel={`${longDate(d)}, ${booked.length} interviews, ${open} open`} onClick={() => setSelected(d)}>
                  {booked.slice(0, 2).map(x => <CanonicalActivityChip key={x.id} label={`${(x.booked_name || 'Booked').split(',')[0]} · ${timeOf(x.slot_at)}`} color={BOOKED} ink="var(--paper-ink)" />)}
                  {booked.length > 2 && <CanonicalActivityChip label={`+${booked.length - 2} more`} secondary />}
                  {open > 0 && <CanonicalActivityChip label={`${open} open`} color={OPEN} ink="var(--paper-ink)" />}
                  {blocked > 0 && <CanonicalActivityChip label={`${blocked} blocked`} color={BLOCKED} ink="var(--paper-ink)" />}
                </CanonicalMonthCell>
              )
            })())}
          </div>
        </div>
      </CanonicalCalendarLayout>

      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="ptl-card-title ptl-roster-heading" style={{ margin: 0 }}>Interview Results</h3>
          {ranked.length > 0 && (
            <span className="ptl-muted" style={{ fontSize: 12.5 }}>
              {ranked.map(r => `${r.count} applicant${r.count === 1 ? '' : 's'} ranked ${r.unit} first`).join(' · ')}. Names appear once Talent Acquisition pairs them with you.
            </span>
          )}
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

      {modal && <OpenTimesModal cycles={data?.cycles || []} units={units} toast={toast} onClose={() => setModal(false)} onSaved={() => { setModal(false); load() }} />}
    </div>
  )
}
