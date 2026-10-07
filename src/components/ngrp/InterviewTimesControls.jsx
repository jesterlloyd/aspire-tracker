// ONE-CALENDAR-1 (Owner, 2026-10-06: one calendar per portal). The interview-times pieces that the
// Residency Calendar and the Unit Leader's At a Glance calendar both draw, so a unit leader and HR
// see the same times the same way: the day-panel rows (time, unit, who or state, and the actions the
// host allows), the month-cell chips, the Open Times dialog and its button. Neither calendar is
// drawn here; each host places these inside the planner it already has.
import { useState } from 'react'
import { ModalShell, Field } from './NgrpFormUi'
import { inputStyle, btn } from '../../lib/ngrp/ngrpCohortForm'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { CanonicalActivityChip } from '../shared/CanonicalCalendarFoundation'
import { SLOT_COLORS, timeOf, slotColor, slotStateWord, nameOf, slotWhen } from '../../lib/ngrp/interviewScheduleModel'

const ghost = { padding: '2px 8px', borderRadius: 'var(--aspire-radius-control)', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }

/** A small action in the day panel: the planner's own ghost button. */
export function DayAction({ children, onClick, style = null }) {
  return <button type="button" className="pl-ghost" style={{ ...ghost, ...style }} onClick={onClick}>{children}</button>
}

/** One interview time in the day panel. `actions` is what the host offers for it (or null). */
export function InterviewSlotRow({ slot, showUnit = false, actions = null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontSize: 13, flexWrap: 'wrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: slotColor(slot) }} aria-hidden="true" />
      <span style={{ fontWeight: 600, color: 'var(--paper-ink)' }}>{timeOf(slot.slot_at)}</span>
      {showUnit && <span style={{ color: 'var(--paper-ink)' }}>{slot.unit_key}</span>}
      <span style={{ color: 'var(--paper-muted)' }}>{slotStateWord(slot)}</span>
      {actions && <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>{actions}</span>}
    </div>
  )
}

/** The Remove button for a span of open times, under the day's rows. */
export function RemoveTimesAction({ block, showUnit = false, onClick }) {
  return (
    <DayAction style={{ marginTop: 6, padding: '4px 10px' }} onClick={onClick}>
      Remove {showUnit ? `${block.unit_key} ` : ''}{String(block.start_time).slice(0, 5)} to {String(block.end_time).slice(0, 5)} times
    </DayAction>
  )
}

/** A month cell's interview chips: up to two bookings by name, then the open and blocked counts. */
export function InterviewDayChips({ slots = [] }) {
  const booked = slots.filter(s => s.booked)
  const open = slots.filter(s => s.status === 'available').length
  const blocked = slots.filter(s => s.status === 'blocked').length
  if (!slots.length) return null
  return (
    <>
      {booked.slice(0, 2).map(x => <CanonicalActivityChip key={x.id} label={`${(x.booked_name || 'Booked').split(',')[0]} · ${timeOf(x.slot_at)}`} color={SLOT_COLORS.booked} ink="var(--paper-ink)" />)}
      {booked.length > 2 && <CanonicalActivityChip label={`+${booked.length - 2} more`} secondary />}
      {open > 0 && <CanonicalActivityChip label={`${open} open`} color={SLOT_COLORS.open} ink="var(--paper-ink)" />}
      {blocked > 0 && <CanonicalActivityChip label={`${blocked} blocked`} color={SLOT_COLORS.blocked} ink="var(--paper-ink)" />}
    </>
  )
}

/** The legend's three interview entries, appended to whatever the host's legend already lists. */
export function InterviewLegend() {
  return (
    <>
      <span><i aria-hidden="true" style={{ background: 'rgba(29,37,103,0.10)', borderLeft: `3px solid ${SLOT_COLORS.booked}` }} />Scheduled interview</span>
      <span><i aria-hidden="true" style={{ background: 'rgba(21,128,61,0.10)', borderLeft: `3px solid ${SLOT_COLORS.open}` }} />Open time</span>
      <span><i aria-hidden="true" style={{ background: 'rgba(185,28,28,0.10)', borderLeft: `3px solid ${SLOT_COLORS.blocked}` }} />Blocked time</span>
    </>
  )
}

/** The "+ Open Times" button, the planner's own ghost button with the event hover. */
export function OpenTimesButton({ onClick }) {
  return (
    <button type="button" className="pl-ghost pl-ghost-event" style={{ height: 32, padding: '0 14px', borderRadius: 9, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}
      onClick={onClick}>+ Open Times</button>
  )
}

/**
 * Open a span of interview times. `save(form)` resolves { ok, data } or { ok, errors } and owns
 * the request, so the Unit Leader Portal and Residency each send it through their own endpoint.
 */
export function OpenTimesModal({ cycles = [], units = [], note, defaultDate = '', onClose, onSaved, save }) {
  const [f, setF] = useState({ cycle_id: cycles[0]?.id || '', unit: units[0] || '', block_date: defaultDate, start_time: '09:00', end_time: '12:00', duration_minutes: 30, break_minutes: 0, interview_mode: '' })
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

/** Book a paired applicant into an open time (HR and the ASPIRE team, on the Residency Calendar). */
export function BookDialog({ slot, choices, onClose, onBook, busyId }) {
  return (
    <ModalShell label="Book an interview" onClose={onClose} width={520}>
      <div style={{ padding: 20, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567' }}>Book {slot.unit_key} · {slotWhen(slot.slot_at)}</h2>
        <p style={{ margin: 0, fontSize: 13, color: '#4A5560' }}>
          The applicants paired with {slot.unit_key} on the Interview Board. Booking emails the applicant and the unit's leaders a calendar invite.
        </p>
        {choices.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: '#4A5560' }}>No one is paired with {slot.unit_key} yet. Pair applicants on the Interview Board first.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {choices.map(c => (
              <li key={c.candidate_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid rgba(29,37,103,0.12)', borderRadius: 'var(--aspire-radius-control)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#191919' }}>{nameOf(c)}</div>
                  <div style={{ fontSize: 11.5, color: '#4A5560' }}>{c.choice_rank ? `#${c.choice_rank} choice` : 'Did not rank this unit'} · {c.note}</div>
                </div>
                {c.action && (
                  <button type="button" style={btn(c.action === 'book')} disabled={Boolean(busyId)} onClick={() => onBook(c)}>
                    {busyId === c.candidate_id ? 'Booking…' : c.action === 'move' ? 'Move Here' : 'Book'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={btn()} onClick={onClose}>Close</button>
        </div>
      </div>
    </ModalShell>
  )
}
