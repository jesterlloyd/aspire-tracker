// NGRP-INTERVIEWS-1 Phase 4: the Interview Schedule's decisions, pure and tested. Who may be booked
// into an open time, what the day says, and what the toast says about the emails that went.
import { unitNameKey } from '../unitNameCanon.js'
import { pacificDateString } from '../birthdayEligibility.js'

const keyOf = v => unitNameKey(v || '')
const PT = { timeZone: 'America/Los_Angeles' }
// The internship calendar's legend colours: scheduled interview, open availability, blocked time.
// They are the wash and the rule; chip text stays on --paper-ink (planner rule 3).
export const SLOT_COLORS = Object.freeze({ booked: '#1D2567', open: '#166534', blocked: '#991B1B' })
export const dayOf = iso => pacificDateString(new Date(iso))
export const timeOf = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...PT })
export const longDate = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
export const nameOf = p => [p?.last_name, p?.preferred_first_name || p?.first_name].filter(Boolean).join(', ')
export const slotWhen = iso => `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...PT })} · ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...PT })}`

// An interview with a result is changed in the binder, never moved from the calendar.
const LOCKED = new Set(['completed', 'decision_recorded', 'applicant_withdrew', 'no_interview', 'no_show'])

/**
 * Everyone who may take `slot`: the applicants paired with its unit. Each choice says whether it
 * books or moves them, or why it cannot. Not-yet-booked first, then by name.
 */
export function bookingChoices(interviewees = [], slots = [], slot) {
  if (!slot) return []
  const held = new Map(slots.filter(s => s.booked && s.booked_candidate_id).map(s => [s.booked_candidate_id, s]))
  return interviewees
    .filter(i => keyOf(i.unit) === keyOf(slot.unit_key))
    .map(i => {
      const h = held.get(i.candidate_id) || null
      const locked = LOCKED.has(i.interview_status)
      return {
        ...i, held: h,
        action: locked ? null : h ? 'move' : 'book',
        note: locked ? 'Interview already has a result' : h ? `Moves from ${slotWhen(h.slot_at)}` : 'Not booked yet',
      }
    })
    .sort((a, b) => (a.action === 'book' ? 0 : a.action === 'move' ? 1 : 2) - (b.action === 'book' ? 0 : b.action === 'move' ? 1 : 2)
      || nameOf(a).localeCompare(nameOf(b)))
}

/** The schedule's one-line count for the shown units. */
export function scheduleCounts(interviewees = [], slots = [], unit = null) {
  const inUnit = x => !unit || keyOf(x) === keyOf(unit)
  const people = interviewees.filter(i => inUnit(i.unit))
  const booked = new Set(slots.filter(s => s.booked && inUnit(s.unit_key)).map(s => s.booked_candidate_id))
  return {
    paired: people.length,
    booked: people.filter(p => booked.has(p.candidate_id)).length,
    open: slots.filter(s => s.status === 'available' && inUnit(s.unit_key)).length,
  }
}

/** What the toast says about the emails a booking sent. */
export function noticeSummary(notices = []) {
  if (!notices.length) return ''
  const alum = notices.find(n => n.audience === 'alumnus')
  const leads = notices.filter(n => n.audience === 'unit_leader')
  const parts = []
  if (alum?.ok) parts.push('the applicant')
  if (leads.some(n => n.ok)) parts.push(`${leads.filter(n => n.ok).length} unit leader${leads.filter(n => n.ok).length === 1 ? '' : 's'}`)
  const sent = parts.length ? `Emailed ${parts.join(' and ')} with a calendar invite.` : ''
  const warn = []
  if (alum && !alum.ok) warn.push(alum.reason === 'no_email' ? 'No email is on file for the applicant.' : 'The applicant\'s email did not go.')
  if (!leads.length) warn.push('No unit leader has portal access for this unit, so no one there was emailed.')
  else if (leads.some(n => !n.ok)) warn.push('A unit leader\'s email did not go.')
  return [sent, ...warn].filter(Boolean).join(' ')
}
