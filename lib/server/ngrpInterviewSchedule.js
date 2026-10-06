/* global Buffer */
// lib/server/ngrpInterviewSchedule.js
//
// NGRP-INTERVIEWS-1 Phase 4 (Owner, 2026-10-06): "the unit leaders can put their availability
// (time), since the interviews are only scheduled for 2 days each time. HR can add the times too
// and then HR books the interviewees." Residency > Interview Schedule is that calendar, for the
// ASPIRE team and Talent Acquisition, over one residency cohort: every unit's open times, with
// Open Times for any participating unit, Block and Remove, and Book on an open time.
//
// Opening, blocking and removing are Phase 3's own functions (ngrpUnitInterviews.js), called with
// the one unit the row belongs to, so a unit leader and HR change times by the same rules. A
// booking names an applicant PAIRED with the time's unit (the Interview Board), at most one booked
// time per applicant per cohort (the table enforces it too). Booking someone who already holds a
// time moves them. The applicant's interview in the binder follows the booking.
import { loadApplicantsPayload, isMissingNgrpTable } from './ngrpApplicants.js'
import { fetchLatestRevisions } from './ngrpResidencyExport.js'
import { residencyRecipient } from './ngrpResidencyRecipient.js'
import { recordNgrpAudit } from './ngrpAudit.js'
import { openTimes, removeTimes, setSlotBlocked, isUuid } from './ngrpUnitInterviews.js'
import { deriveApplicantRows, effectivePreferences } from '../../src/lib/ngrp/ngrpStates.js'
import { unitNameKey } from '../../src/lib/unitNameCanon.js'
import { interviewNoticeEmail, interviewIcs, NGRP_SUPPORT_EMAIL } from './email/ngrpInterviewEmail.js'

const keyOf = v => unitNameKey(v || '')
export const INTERVIEW_NOTICE_TYPE = 'ngrp_interview_notice'
const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
// A booking can move the binder only while nothing later has been recorded.
const BOOKABLE_STATUSES = ['not_scheduled', 'scheduled', 'cancelled', null, undefined]
const nameOf = s => [s?.last_name, s?.preferred_first_name || s?.first_name].filter(Boolean).join(', ')

/** The cohort's participating units (active), the vocabulary Open Times offers. */
async function cycleUnits(db, cycleId) {
  const u = await db.from('ngrp_cycle_units').select('unit_name, is_active, display_order').eq('cycle_id', cycleId).order('display_order')
  if (u.error) return isMissingNgrpTable(u.error) ? { units: [] } : { error: u.error }
  return { units: (u.data || []).filter(x => x.is_active).map(x => x.unit_name) }
}

/** Pure: the schedule's people, every applicant paired with a unit. Exported for tests. */
export function scheduleInterviewees(rows = []) {
  return rows.filter(r => r.candidate_id && r.assigned_unit).map(r => {
    const prefs = effectivePreferences(r).preferences || []
    const rank = prefs.findIndex(p => keyOf(p) === keyOf(r.assigned_unit))
    return {
      candidate_id: r.candidate_id, unit: r.assigned_unit,
      first_name: r.student?.first_name || '', last_name: r.student?.last_name || '',
      preferred_first_name: r.student?.preferred_first_name || '',
      choice_rank: rank >= 0 ? rank + 1 : null,
      interview_status: r.interview_status || 'not_scheduled', interview_at: r.interview_at || null, interview_mode: r.interview_mode || null,
    }
  })
}

/** Everything the Interview Schedule draws for one residency cohort. */
export async function loadSchedule(db, { cycleId }) {
  const payload = await loadApplicantsPayload(db, cycleId)
  if (payload.state === 'unprovisioned') return { state: 'unprovisioned' }
  if (payload.state === 'cycle_not_found') return { state: 'not_found' }
  if (payload.state !== 'ok') return { state: 'error' }
  const interviewees = scheduleInterviewees(deriveApplicantRows(payload.students, payload.candidates))
  const cu = await cycleUnits(db, cycleId)
  if (cu.error) return { state: 'error' }
  const [b, s] = await Promise.all([
    db.from('ngrp_interview_blocks').select('id, cycle_id, unit_key, block_date, start_time, end_time, duration_minutes, break_minutes, interview_mode').eq('cycle_id', cycleId).order('block_date'),
    db.from('ngrp_interview_slots').select('id, block_id, cycle_id, unit_key, slot_at, duration_minutes, status, booked_candidate_id').eq('cycle_id', cycleId).order('slot_at'),
  ])
  if (b.error || s.error) {
    if (isMissingNgrpTable(b.error || s.error)) return { state: 'ok', provisioned: false, units: cu.units, interviewees, blocks: [], slots: [] }
    return { state: 'error' }
  }
  const byId = new Map(interviewees.map(i => [i.candidate_id, i]))
  const slots = (s.data || []).map(slot => {
    const who = slot.booked_candidate_id ? byId.get(slot.booked_candidate_id) : null
    return { ...slot, booked: slot.status === 'booked', booked_name: slot.status === 'booked' ? (who ? nameOf(who) : 'Booked') : null }
  })
  const units = [...new Set([...cu.units, ...(b.data || []).map(x => x.unit_key)])]
  return { state: 'ok', provisioned: true, units, interviewees, blocks: b.data || [], slots }
}

// ── Times: Phase 3's rules, for the one unit the row is about ──────────────────

export async function openScheduleTimes(db, { cycleId, profile, input }) {
  const cu = await cycleUnits(db, cycleId)
  if (cu.error) return { status: 500, error: 'internal_error' }
  const unit = cu.units.find(u => keyOf(u) === keyOf(input?.unit))
  if (!unit) return { status: 422, error: 'validation_failed', errors: [{ field: 'unit', message: 'Choose one of this cohort\'s participating units.' }] }
  return openTimes(db, { unitKeys: [unit], profile, input: { ...input, unit, cycle_id: cycleId } })
}

export async function removeScheduleTimes(db, { cycleId, profile, blockId }) {
  if (!isUuid(blockId)) return { status: 404, error: 'not_found' }
  const b = await db.from('ngrp_interview_blocks').select('id, cycle_id, unit_key').eq('id', blockId).maybeSingle()
  if (b.error) return { status: 500, error: 'internal_error' }
  if (!b.data || b.data.cycle_id !== cycleId) return { status: 404, error: 'not_found' }
  return removeTimes(db, { unitKeys: [b.data.unit_key], profile, blockId })
}

export async function blockScheduleSlot(db, { cycleId, profile, slotId, blocked }) {
  if (!isUuid(slotId)) return { status: 404, error: 'not_found' }
  const s = await db.from('ngrp_interview_slots').select('id, cycle_id, unit_key').eq('id', slotId).maybeSingle()
  if (s.error) return { status: 500, error: 'internal_error' }
  if (!s.data || s.data.cycle_id !== cycleId) return { status: 404, error: 'not_found' }
  return setSlotBlocked(db, { unitKeys: [s.data.unit_key], profile, slotId, blocked })
}

// ── Booking ───────────────────────────────────────────────────────────────

const SLOT_COLS = 'id, block_id, cycle_id, unit_key, slot_at, duration_minutes, status, booked_candidate_id'
const release = (db, slotId) => db.from('ngrp_interview_slots')
  .update({ status: 'available', booked_candidate_id: null, booked_at: null, booked_by_profile_id: null })
  .eq('id', slotId).eq('status', 'booked').select('id')
const claim = (db, slotId, candidateId, profileId, nowIso) => db.from('ngrp_interview_slots')
  .update({ status: 'booked', booked_candidate_id: candidateId, booked_at: nowIso, booked_by_profile_id: profileId })
  .eq('id', slotId).eq('status', 'available').select(SLOT_COLS)

async function blockMode(db, blockId) {
  const b = await db.from('ngrp_interview_blocks').select('interview_mode').eq('id', blockId).maybeSingle()
  return b.data?.interview_mode || null
}

/**
 * Book `candidateId` into the open time `slotId`, or move them there from the time they hold.
 * Returns { status, kind: 'booked'|'moved', slot, previous, notices } or { status, error }.
 */
export async function bookInterview(db, { cycleId, profile, slotId, candidateId, mailer = null, nowIso = new Date().toISOString() }) {
  if (!isUuid(slotId) || !isUuid(candidateId)) return { status: 404, error: 'not_found' }
  const [s, c] = await Promise.all([
    db.from('ngrp_interview_slots').select(SLOT_COLS).eq('id', slotId).maybeSingle(),
    db.from('ngrp_candidates').select('id, cycle_id, student_id, assigned_unit, interview_status, interview_at, interview_mode').eq('id', candidateId).maybeSingle(),
  ])
  if (s.error || c.error) return isMissingNgrpTable(s.error || c.error) ? { status: 409, error: 'not_enabled' } : { status: 500, error: 'internal_error' }
  const slot = s.data, cand = c.data
  if (!slot || slot.cycle_id !== cycleId || !cand || cand.cycle_id !== cycleId) return { status: 404, error: 'not_found' }
  if (!cand.assigned_unit || keyOf(cand.assigned_unit) !== keyOf(slot.unit_key)) {
    return { status: 422, error: 'not_paired', message: `This applicant is not paired with ${slot.unit_key}. Pair them on the Interview Board first.` }
  }
  if (!BOOKABLE_STATUSES.includes(cand.interview_status)) {
    return { status: 409, error: 'interview_recorded', message: 'This applicant\'s interview already has a result. Change it in their binder first.' }
  }
  if (slot.status !== 'available') return { status: 409, error: slot.status === 'booked' ? 'slot_taken' : 'slot_blocked' }

  const held = await db.from('ngrp_interview_slots').select(SLOT_COLS).eq('cycle_id', cycleId).eq('booked_candidate_id', candidateId).eq('status', 'booked').maybeSingle()
  if (held.error) return { status: 500, error: 'internal_error' }
  const previous = held.data || null
  if (previous) {
    const r = await release(db, previous.id)
    if (r.error) return { status: 500, error: 'internal_error' }
  }
  const got = await claim(db, slotId, candidateId, profile.id, nowIso)
  if (got.error || !(got.data || []).length) {
    // Put them back where they were: a failed move must not leave them with no time.
    if (previous) await claim(db, previous.id, candidateId, previous.booked_by_profile_id || profile.id, nowIso)
    return { status: 409, error: 'slot_taken' }
  }
  const booked = got.data[0]
  const mode = (await blockMode(db, booked.block_id)) || cand.interview_mode || null
  const upd = await db.from('ngrp_candidates').update({
    interview_status: 'scheduled', interview_at: booked.slot_at, interview_mode: mode,
    interview_recorded_by_profile_id: profile.id, interview_recorded_at: nowIso,
  }).eq('id', candidateId)
  if (upd.error) {
    await release(db, booked.id)
    if (previous) await claim(db, previous.id, candidateId, previous.booked_by_profile_id || profile.id, nowIso)
    return { status: 500, error: 'internal_error' }
  }
  const kind = previous ? 'moved' : 'booked'
  await recordNgrpAudit(db, {
    eventType: 'interview_booked', cycleId, candidateId, studentId: cand.student_id, actorProfileId: profile.id,
    metadata: { unit: booked.unit_key, slot_at: booked.slot_at, ...(previous ? { moved_from: previous.slot_at } : {}) },
  })
  const notices = await sendInterviewNotices(db, { kind, cycleId, candidate: cand, slot: booked, previous, mode, mailer, nowIso })
  return { status: 200, kind, slot: booked, previous, notices }
}

/** Cancel the booking on `slotId`: the time opens again and the binder reads Not scheduled. */
export async function cancelInterview(db, { cycleId, profile, slotId, mailer = null, nowIso = new Date().toISOString() }) {
  if (!isUuid(slotId)) return { status: 404, error: 'not_found' }
  const s = await db.from('ngrp_interview_slots').select(SLOT_COLS).eq('id', slotId).maybeSingle()
  if (s.error) return { status: 500, error: 'internal_error' }
  const slot = s.data
  if (!slot || slot.cycle_id !== cycleId) return { status: 404, error: 'not_found' }
  if (slot.status !== 'booked') return { status: 200, idempotent: true }
  const c = await db.from('ngrp_candidates').select('id, cycle_id, student_id, assigned_unit, interview_status, interview_at, interview_mode').eq('id', slot.booked_candidate_id).maybeSingle()
  if (c.error) return { status: 500, error: 'internal_error' }
  const r = await release(db, slotId)
  if (r.error) return { status: 500, error: 'internal_error' }
  const cand = c.data
  // The binder forgets the time only when it is still this booking's time.
  if (cand && cand.interview_status === 'scheduled' && cand.interview_at && Date.parse(cand.interview_at) === Date.parse(slot.slot_at)) {
    await db.from('ngrp_candidates').update({
      interview_status: 'not_scheduled', interview_at: null,
      interview_recorded_by_profile_id: profile.id, interview_recorded_at: nowIso,
    }).eq('id', cand.id)
  }
  await recordNgrpAudit(db, {
    eventType: 'interview_booking_cancelled', cycleId, candidateId: cand?.id || null, studentId: cand?.student_id || null,
    actorProfileId: profile.id, metadata: { unit: slot.unit_key, slot_at: slot.slot_at },
  })
  const notices = cand ? await sendInterviewNotices(db, { kind: 'cancelled', cycleId, candidate: cand, slot, mode: cand.interview_mode, mailer, nowIso }) : []
  return { status: 200, kind: 'cancelled', notices }
}

// ── Notices ───────────────────────────────────────────────────────────────

/** The alumnus's residency address: the Transition Form's preferred email, else personal. */
async function alumnusRecipient(db, { cycleId, candidate }) {
  const st = await db.from('students').select('id, first_name, preferred_first_name, last_name, personal_email, is_demo').eq('id', candidate.student_id).maybeSingle()
  if (st.error || !st.data) return { student: null, email: null }
  let formPreferredEmail = null
  const payload = await loadApplicantsPayload(db, cycleId)
  if (payload.state === 'ok') {
    const row = (payload.candidates || []).find(x => x.id === candidate.id)
    if (row?.assignment_id) {
      const revs = await fetchLatestRevisions(db, [row])
      formPreferredEmail = revs.byAssignment?.get(row.assignment_id)?.identity?.preferred_email || null
    }
  }
  const r = residencyRecipient({ formPreferredEmail, student: st.data })
  return { student: st.data, email: r.email }
}

/** The unit's leaders: an active Unit Leader grant scoped to this unit, an active profile with an email. */
export async function unitLeaderRecipients(db, unitKey) {
  const scopes = await db.from('user_unit_scopes').select('user_profile_id, unit_key, starts_at, expires_at, revoked_at')
  if (scopes.error) return []
  const now = Date.now()
  const live = r => !r.revoked_at && (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.expires_at || Date.parse(r.expires_at) > now)
  const ids = [...new Set((scopes.data || []).filter(r => live(r) && keyOf(r.unit_key) === keyOf(unitKey)).map(r => r.user_profile_id))]
  if (!ids.length) return []
  const [grants, profiles] = await Promise.all([
    db.from('user_role_grants').select('user_profile_id, starts_at, expires_at, revoked_at').eq('role', 'unit_leader').in('user_profile_id', ids),
    db.from('user_profiles').select('id, full_name, email, is_active').in('id', ids),
  ])
  if (grants.error || profiles.error) return []
  const granted = new Set((grants.data || []).filter(live).map(g => g.user_profile_id))
  return (profiles.data || []).filter(p => granted.has(p.id) && p.is_active !== false && p.email)
    .map(p => ({ id: p.id, name: p.full_name || '', email: p.email }))
}

async function sendOne(db, mailer, { to, name, subject, html, ics, audience, studentId, metadata }) {
  let status = 'sent', error = null, id = null
  try {
    const out = await mailer.emails.send({
      from: FROM, reply_to: NGRP_SUPPORT_EMAIL, to: [to], subject, html,
      attachments: [{ filename: 'interview.ics', content: Buffer.from(ics).toString('base64') }],
      tags: [{ name: 'type', value: INTERVIEW_NOTICE_TYPE }],
    })
    if (out?.error) { status = 'failed'; error = out.error.message || 'send_failed' } else id = out?.data?.id || null
  } catch (e) { status = 'failed'; error = e?.message || 'send_failed' }
  try {
    await db.from('notification_log').insert({
      notification_type: INTERVIEW_NOTICE_TYPE, audience, recipient_type: audience === 'alumnus' ? 'student' : 'user',
      recipient_email: to, recipient_name: name || null, subject, status, resend_email_id: id, error_message: error,
      student_id: studentId || null, sent_at: new Date().toISOString(), metadata,
    })
  } catch { /* the log is best-effort; the result below still says what happened */ }
  return { to, audience, ok: status === 'sent' }
}

/**
 * Email the alumnus and the unit's leaders, each with the invite. Never fails the booking: a
 * notice that could not go is reported in the result and logged as failed.
 */
export async function sendInterviewNotices(db, { kind, cycleId, candidate, slot, previous = null, mode = null, mailer, nowIso }) {
  if (!mailer) return []
  const { student, email } = await alumnusRecipient(db, { cycleId, candidate })
  if (!student) return []
  const unit = slot.unit_key
  const applicantName = `${student.preferred_first_name || student.first_name || ''} ${student.last_name || ''}`.trim()
  const ics = interviewIcs({ kind, candidateId: candidate.id, unit, slot, applicantName, mode, nowIso })
  const metadata = { kind, cycle_id: cycleId, candidate_id: candidate.id, slot_id: slot.id, slot_at: slot.slot_at, unit }
  const out = []
  if (email) {
    const m = interviewNoticeEmail({ kind, audience: 'alumnus', applicant: student, unit, slot, previous, mode })
    out.push(await sendOne(db, mailer, { to: email, name: applicantName, ...m, ics, audience: 'alumnus', studentId: student.id, metadata }))
  } else {
    out.push({ to: null, audience: 'alumnus', ok: false, reason: 'no_email' })
  }
  for (const lead of await unitLeaderRecipients(db, unit)) {
    const m = interviewNoticeEmail({ kind, audience: 'unit', applicant: student, unit, slot, previous, mode, recipientName: lead.name.split(' ')[0] })
    out.push(await sendOne(db, mailer, { to: lead.email, name: lead.name, ...m, ics, audience: 'unit_leader', studentId: student.id, metadata: { ...metadata, user_profile_id: lead.id } }))
  }
  return out
}
