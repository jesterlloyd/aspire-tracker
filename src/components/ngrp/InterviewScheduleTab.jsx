// NGRP-INTERVIEWS-1 Phase 4 (Owner, 2026-10-06): Residency > Interview Schedule. "The unit leaders
// can put their availability (time), since the interviews are only scheduled for 2 days each time.
// HR can add the times too and then HR books the interviewees."
//
// The calendar is the Unit Leader Portal's own (InterviewTimesCalendar), over every unit in this
// residency cohort, for the ASPIRE team and Talent Acquisition. An open time offers Book, which
// lists the applicants paired with that unit (the Interview Board) and moves one who already holds
// a time; a booked time offers Cancel. Each booking, move or cancel emails the applicant and the
// unit's leaders with a calendar invite (sent by the server, never from here).
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useInterviewSchedule, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import {
  bookingChoices, scheduleCounts, noticeSummary, nameOf, slotWhen, longDate,
} from '../../lib/ngrp/interviewScheduleModel'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { inputStyle, btn } from '../../lib/ngrp/ngrpCohortForm'
import { confirmDialog } from '../shared/confirmDialog'
import DataSheet from '../shared/DataSheet'
import { ModalShell } from './NgrpFormUi'
import InterviewTimesCalendar, { OpenTimesModal, OpenTimesButton, DayAction } from './InterviewTimesCalendar'

const ALL = ''
const ERRORS = {
  slot_taken: 'Someone else just took that time. Choose another.',
  slot_blocked: 'That time is blocked. Reopen it first.',
  has_bookings: 'Someone is booked into these times. Cancel or move the booking first.',
  not_enabled: 'Interview scheduling is not switched on yet.',
}

function BookDialog({ slot, choices, onClose, onBook, busyId }) {
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

export default function InterviewScheduleTab({ cycle, canManage = false, toast = null }) {
  const qc = useQueryClient()
  const q = useInterviewSchedule(cycle?.id)
  const [unit, setUnit] = useState(ALL)
  const [opening, setOpening] = useState(false)
  const [bookSlot, setBookSlot] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const data = q.data || {}
  const interviewees = useMemo(() => data.interviewees || [], [data.interviewees])
  const allSlots = useMemo(() => data.slots || [], [data.slots])
  const units = data.units || []
  const shownSlots = unit ? allSlots.filter(s => s.unit_key === unit) : allSlots
  const shownBlocks = unit ? (data.blocks || []).filter(b => b.unit_key === unit) : (data.blocks || [])
  const counts = scheduleCounts(interviewees, allSlots, unit || null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ngrp_workspace', 'schedule', cycle?.id] })
    qc.invalidateQueries({ queryKey: ['ngrp_workspace', 'applicants', cycle?.id] })
  }
  const fail = (title, r) => toast?.error?.(title, r.message || ERRORS[r.error] || 'Try again in a moment.')
  const write = (action, payload) => postNgrpManage(action, { cycle_id: cycle.id, ...payload })

  const book = async (choice) => {
    setBusyId(choice.candidate_id)
    const r = await write('schedule_book', { slot_id: bookSlot.id, candidate_id: choice.candidate_id })
    setBusyId(null)
    if (!r.ok) { fail('Not booked', r); refresh(); return }
    toast?.success?.(r.kind === 'moved' ? 'Interview moved' : 'Interview booked', `${nameOf(choice)}, ${slotWhen(r.slot.slot_at)}. ${noticeSummary(r.notices)}`.trim())
    setBookSlot(null); refresh()
  }
  const cancel = async (s) => {
    if (!(await confirmDialog(`Cancel ${s.booked_name || 'this'} interview on ${slotWhen(s.slot_at)}? The applicant and the unit's leaders are emailed, and the time opens again.`, { confirmLabel: 'Cancel Interview', cancelLabel: 'Keep Interview', danger: true }))) return
    const r = await write('schedule_cancel', { slot_id: s.id })
    if (!r.ok) { fail('Not cancelled', r); return }
    toast?.success?.('Interview cancelled', noticeSummary(r.notices))
    refresh()
  }
  const toggle = async (s) => {
    const r = await write('schedule_slot_block', { slot_id: s.id, blocked: s.status !== 'blocked' })
    if (!r.ok) { fail('Not changed', r); return }
    refresh()
  }
  const removeBlock = async (b) => {
    if (!(await confirmDialog(`Remove ${b.unit_key}'s open times on ${longDate(b.block_date)}?`, { confirmLabel: 'Remove Times', danger: true }))) return
    const r = await write('schedule_remove_times', { block_id: b.id })
    if (!r.ok) { fail('Not removed', r); return }
    refresh()
  }

  if (!cycle) return null
  if (q.isLoading) return <section className="snap" role="status"><p className="ngrp-glance-muted" style={{ margin: 0 }}>Loading the interview schedule…</p></section>
  if (q.isError) return <section className="snap"><p className="ngrp-glance-muted" style={{ margin: 0 }}>The interview schedule could not be loaded. Refresh to try again.</p></section>
  if (data.provisioned === false) return <section className="snap"><p className="ngrp-glance-muted" style={{ margin: 0 }}>Interview scheduling is not switched on for this residency cohort yet.</p></section>

  const slotActions = !canManage ? null : s => {
    if (s.booked) return <DayAction onClick={() => cancel(s)}>Cancel</DayAction>
    if (s.status === 'blocked') return <DayAction onClick={() => toggle(s)}>Reopen</DayAction>
    return (
      <>
        <DayAction onClick={() => setBookSlot(s)}>Book</DayAction>
        <DayAction onClick={() => toggle(s)}>Block</DayAction>
      </>
    )
  }

  const held = new Map(allSlots.filter(s => s.booked).map(s => [s.booked_candidate_id, s]))
  const rows = interviewees.filter(i => !unit || i.unit === unit)
  const columns = [
    { key: 'name', label: 'Applicant', min: 170, grow: 2.2, priority: 1, sortValue: i => nameOf(i), render: i => nameOf(i) },
    { key: 'unit', label: 'Unit', min: 110, grow: 1.2, priority: 1, sortValue: i => i.unit, render: i => i.unit },
    { key: 'choice', label: 'Their Choice', min: 96, grow: 0.8, priority: 3, sortValue: i => i.choice_rank || 99, render: i => (i.choice_rank ? `#${i.choice_rank}` : 'Not ranked') },
    { key: 'when', label: 'Interview', min: 140, grow: 1.2, priority: 1, sortValue: i => held.get(i.candidate_id)?.slot_at || null,
      render: i => (held.get(i.candidate_id) ? slotWhen(held.get(i.candidate_id).slot_at) : <span className="ngrp-glance-muted">Not booked</span>) },
    { key: 'mode', label: 'Format', min: 90, grow: 0.8, priority: 2, sortValue: i => i.interview_mode || '', render: i => INTERVIEW_MODE_LABELS[i.interview_mode] || '' },
  ]

  return (
    <>
      <section className="snap" aria-label="Interview Schedule filter">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-heading)' }}>
            Unit
            <select style={{ ...inputStyle, width: 220 }} value={unit} onChange={e => setUnit(e.target.value)}>
              <option value={ALL}>All units</option>
              {units.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <span style={{ fontSize: 12.5, color: 'var(--text-caption)' }}>
            {counts.paired} paired · {counts.booked} booked · {counts.open} open time{counts.open === 1 ? '' : 's'}. Unit leaders add times in the Unit Leader Portal; times added here show there too.
          </span>
        </div>
      </section>

      <InterviewTimesCalendar slots={shownSlots} blocks={canManage ? shownBlocks : []} title="Interview Schedule" labelledBy="ngrp-iv-schedule"
        description={cycle?.name ? `Every unit's interview times and bookings for ${cycle.name}.` : "Every unit's interview times and bookings."}
        showUnit={!unit}
        toolbarAction={canManage && units.length > 0 ? <OpenTimesButton onClick={() => setOpening(true)} /> : null}
        slotActions={slotActions} onRemoveBlock={canManage ? removeBlock : null} />

      <section className="snap ngrp-glance-panel" aria-label="Paired applicants">
        <DataSheet level="plain" title="Paired Applicants" caption="Everyone paired with a unit on the Interview Board, and their booked time."
          columns={columns} rows={rows} rowKey={i => i.candidate_id} defaultSort={{ key: 'when', dir: 'asc' }}
          emptyMessage={interviewees.length ? 'No one is paired with this unit yet.' : 'No one is paired with a unit yet. Pair applicants on the Interview Board.'} />
      </section>

      {opening && (
        <OpenTimesModal units={unit ? [unit, ...units.filter(u => u !== unit)] : units}
          note="The span is cut into interview times for the unit. Its leaders see them on their Interviews tab."
          save={async f => { const r = await write('schedule_open_times', f); return r.ok ? { ok: true, data: r } : { ok: false, errors: r.errors?.length ? r.errors : [{ message: r.message || ERRORS[r.error] || 'The times could not be opened.' }] } }}
          onClose={() => setOpening(false)}
          onSaved={(r, f) => { toast?.success?.('Times opened', `${r.data.slot_count} interview time${r.data.slot_count === 1 ? '' : 's'} for ${f.unit} on ${longDate(f.block_date)}.`); setOpening(false); refresh() }} />
      )}
      {bookSlot && (
        <BookDialog slot={bookSlot} choices={bookingChoices(interviewees, allSlots, bookSlot)} busyId={busyId}
          onClose={() => setBookSlot(null)} onBook={book} />
      )}
    </>
  )
}
