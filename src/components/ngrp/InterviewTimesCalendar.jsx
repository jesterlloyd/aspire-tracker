// NGRP-INTERVIEWS-1 Phase 4: ONE interview-times calendar for both places that change times. The
// Unit Leader Portal's Interviews tab (a unit leader's own units) and Residency > Interview Schedule
// (the ASPIRE team and Talent Acquisition, every unit) draw the same planner calendar on slate
// paper, with the same day panel, the same legend and the same Open Times dialog, so a unit leader
// and HR see the same times the same way. Moved here from UnitInterviewsWorkspace (Phase 3).
//
// It holds no data: the host passes the slots and blocks and says what each day-panel row may do.
import { useState } from 'react'
import { MiniCalendar } from '../CalendarSidebar'
import {
  CanonicalCalendarLayout, CanonicalCalendarSidebar, CanonicalCalendarTodayPanel,
  CanonicalCalendarNav, CanonicalCalendarMonthTitle, CanonicalWeekdayHeader,
  CanonicalMonthCell, CanonicalActivityChip,
} from '../shared/CanonicalCalendarFoundation'
import { ModalShell, Field } from './NgrpFormUi'
import { inputStyle, btn } from '../../lib/ngrp/ngrpCohortForm'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { pacificDateString } from '../../lib/birthdayEligibility'
import { SLOT_COLORS, dayOf, timeOf, longDate } from '../../lib/ngrp/interviewScheduleModel'

const ghost = { padding: '2px 8px', borderRadius: 'var(--aspire-radius-control)', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }

/** A small action in the day panel: the planner's own ghost button. */
export function DayAction({ children, onClick, style = null }) {
  return <button type="button" className="pl-ghost" style={{ ...ghost, ...style }} onClick={onClick}>{children}</button>
}

/**
 * `slotActions(slot)` returns the buttons a day-panel row shows; `onRemoveBlock(block)` removes a
 * span (omit it to hide Remove). `showUnit` names each time's unit (for the every-unit view).
 */
export default function InterviewTimesCalendar({
  slots = [], blocks = [], title, description, labelledBy, toolbarAction = null,
  slotActions = null, onRemoveBlock = null, showUnit = false,
}) {
  const today = pacificDateString()
  const [selected, setSelected] = useState(today)
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split('-').map(Number); return { year: y, month: m - 1 } })

  const first = new Date(cursor.year, cursor.month, 1).getDay()
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const ymd = d => `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => ymd(i + 1))]
  while (cells.length % 7) cells.push(null)
  const slotsOn = d => slots.filter(s => dayOf(s.slot_at) === d)
  const blocksOn = d => blocks.filter(b => b.block_date === d)
  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const step = n => setCursor(c => { const d = new Date(c.year, c.month + n, 1); return { year: d.getFullYear(), month: d.getMonth() } })
  const daySlots = slotsOn(selected)

  return (
    <CanonicalCalendarLayout paper="slate" title={title} labelledBy={labelledBy} description={description}
      toolbar={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <div style={{ flex: 1 }}>
            <CanonicalCalendarNav onPrev={() => step(-1)} onNext={() => step(1)} prevAriaLabel="Previous month" nextAriaLabel="Next month"
              onToday={() => { const [y, m] = today.split('-').map(Number); setCursor({ year: y, month: m - 1 }); setSelected(today) }} />
          </div>
          <CanonicalCalendarMonthTitle ariaLive="polite">{monthName}</CanonicalCalendarMonthTitle>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>{toolbarAction}</div>
        </div>
      }
      sidebar={
        <CanonicalCalendarSidebar>
          <MiniCalendar selectedDate={selected} onSelectDate={d => { setSelected(d); const [y, m] = d.split('-').map(Number); setCursor({ year: y, month: m - 1 }) }} />
          <CanonicalCalendarTodayPanel kicker={selected === today ? 'Today' : 'Selected day'} dateLabel={longDate(selected)}
            summary={daySlots.length ? `${daySlots.filter(x => x.booked).length} scheduled · ${daySlots.filter(x => x.status === 'available').length} open` : null}
            emptyLabel="No interview times this day.">
            {daySlots.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.booked ? SLOT_COLORS.booked : s.status === 'blocked' ? SLOT_COLORS.blocked : SLOT_COLORS.open }} aria-hidden="true" />
                <span style={{ fontWeight: 600, color: 'var(--paper-ink)' }}>{timeOf(s.slot_at)}</span>
                {showUnit && <span style={{ color: 'var(--paper-ink)' }}>{s.unit_key}</span>}
                <span style={{ color: 'var(--paper-muted)' }}>{s.booked ? (s.booked_name || 'Booked') : s.status === 'blocked' ? 'Blocked' : 'Open'}</span>
                {slotActions && <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>{slotActions(s)}</span>}
              </div>
            ))}
            {onRemoveBlock && blocksOn(selected).map(b => (
              <DayAction key={b.id} style={{ marginTop: 6, padding: '4px 10px' }} onClick={() => onRemoveBlock(b)}>
                Remove {showUnit ? `${b.unit_key} ` : ''}{b.start_time.slice(0, 5)} to {b.end_time.slice(0, 5)} times
              </DayAction>
            ))}
          </CanonicalCalendarTodayPanel>
          <div className="pl-legend">
            <span><i aria-hidden="true" style={{ background: 'rgba(29,37,103,0.10)', borderLeft: `3px solid ${SLOT_COLORS.booked}` }} />Scheduled interview</span>
            <span><i aria-hidden="true" style={{ background: 'rgba(21,128,61,0.10)', borderLeft: `3px solid ${SLOT_COLORS.open}` }} />Open time</span>
            <span><i aria-hidden="true" style={{ background: 'rgba(185,28,28,0.10)', borderLeft: `3px solid ${SLOT_COLORS.blocked}` }} />Blocked time</span>
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
                {booked.slice(0, 2).map(x => <CanonicalActivityChip key={x.id} label={`${(x.booked_name || 'Booked').split(',')[0]} · ${timeOf(x.slot_at)}`} color={SLOT_COLORS.booked} ink="var(--paper-ink)" />)}
                {booked.length > 2 && <CanonicalActivityChip label={`+${booked.length - 2} more`} secondary />}
                {open > 0 && <CanonicalActivityChip label={`${open} open`} color={SLOT_COLORS.open} ink="var(--paper-ink)" />}
                {blocked > 0 && <CanonicalActivityChip label={`${blocked} blocked`} color={SLOT_COLORS.blocked} ink="var(--paper-ink)" />}
              </CanonicalMonthCell>
            )
          })())}
        </div>
      </div>
    </CanonicalCalendarLayout>
  )
}

/** The "+ Open Times" button, the planner's own ghost button with the event hover. */
export function OpenTimesButton({ onClick }) {
  return (
    <button type="button" className="pl-ghost pl-ghost-event" style={{ height: 32, padding: '0 14px', borderRadius: 9, fontWeight: 600, fontSize: 12 }}
      onClick={onClick}>+ Open Times</button>
  )
}

/**
 * Open a span of interview times. `save(form)` resolves { ok, data } and owns the request, so the
 * Unit Leader Portal and Residency each send it through their own endpoint.
 */
export function OpenTimesModal({ cycles = [], units = [], note, onClose, onSaved, save }) {
  const [f, setF] = useState({ cycle_id: cycles[0]?.id || '', unit: units[0] || '', block_date: '', start_time: '09:00', end_time: '12:00', duration_minutes: 30, break_minutes: 0, interview_mode: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    setBusy(true); setErrors([])
    const r = await save({ ...f, interview_mode: f.interview_mode || null })
    setBusy(false)
    if (!r.ok) { setErrors(r.errors?.map(e => e.message) || ['The times could not be opened. Try again in a moment.']); return }
    onSaved(r, f)
  }
  return (
    <ModalShell label="Open interview times" onClose={onClose} width={520}>
      <div style={{ padding: 20, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567' }}>Open Interview Times</h2>
        <p style={{ margin: 0, fontSize: 13, color: '#4A5560' }}>{note}</p>
        {cycles.length > 1 && (
          <Field label="Residency cohort">
            <select style={inputStyle} value={f.cycle_id} onChange={e => set('cycle_id', e.target.value)}>{cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        )}
        {units.length > 1 && (
          <Field label="Unit">
            <select style={inputStyle} value={f.unit} onChange={e => set('unit', e.target.value)}>{units.map(u => <option key={u} value={u}>{u}</option>)}</select>
          </Field>
        )}
        <Field label="Date"><input style={inputStyle} type="date" value={f.block_date} onChange={e => set('block_date', e.target.value)} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="From"><input style={inputStyle} type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)} /></Field>
          <Field label="To"><input style={inputStyle} type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)} /></Field>
          <Field label="Each interview">
            <select style={inputStyle} value={f.duration_minutes} onChange={e => set('duration_minutes', Number(e.target.value))}>{[20, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}</select>
          </Field>
          <Field label="Break between">
            <select style={inputStyle} value={f.break_minutes} onChange={e => set('break_minutes', Number(e.target.value))}>{[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m ? `${m} minutes` : 'None'}</option>)}</select>
          </Field>
        </div>
        <Field label="Format (optional)">
          <select style={inputStyle} value={f.interview_mode} onChange={e => set('interview_mode', e.target.value)}>
            <option value="">Not decided</option>{Object.entries(INTERVIEW_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {errors.length > 0 && <p role="alert" style={{ margin: 0, color: '#B3282D', fontSize: 12.5 }}>{errors.join(' ')}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={btn()} onClick={onClose}>Cancel</button>
          <button type="button" style={btn(true)} disabled={busy || !f.block_date} onClick={submit}>{busy ? 'Opening…' : 'Open Times'}</button>
        </div>
      </div>
    </ModalShell>
  )
}
