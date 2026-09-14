// lib/server/ngrpReflection.js
//
// RESIDENCY-REFLECTION-1: the server side of the bi-weekly reflection. Starting
// a run, sending one period, and resolving a resident's link. Node-safe and
// db-injected, so every rule is unit-testable with a mocked client.
//
// TOKEN POSTURE (the evaluation-token rules, as the Transition Form keeps them):
// the raw token exists only inside the sending function's scope and inside the
// emailed URL fragment. It is never stored, logged, or returned to staff. Only
// the HMAC hash and its 8-character prefix persist, and only an ACTIVE token
// resolves.
//
// ONE TOKEN PER SEND, ONE KEY PER TOKEN. A period's token is minted 'pending',
// the provider is called with an idempotency key tied to that token, and only
// provider acceptance activates it and marks the period sent. A rejected send
// fails the token; the next run mints a fresh one. The one honest gap: a crash
// between the provider call and the acceptance record leaves a pending token
// whose raw value nobody holds, so the next run fails it and sends a new link.
// The resident may then hold one dead link and one live one; the live one is
// the later email, and the dead one says so when opened.
import {
  buildSchedule, closesOn, PERIOD_COUNT, PERIOD_DAYS, SCHEDULE_SHIFTS, RESIDENT_SHIFTS,
} from '../../src/lib/ngrp/ngrpReflectionForm.js'
import { pacificEndOfDay } from './ngrpTransition.js'
import { residencyRecipient, isHired } from './ngrpResidencyRecipient.js'
import { recordNgrpAudit } from './ngrpAudit.js'

export const RUNS = 'ngrp_reflection_runs'
export const PERIODS = 'ngrp_reflection_periods'
export const TOKENS = 'ngrp_reflection_tokens'
export const SUBMISSIONS = 'ngrp_reflection_submissions'
export const NOTIFICATION_TYPE = 'ngrp_reflection_sent'
export const TEMPLATE_KEY = 'ngrp_reflection_period'
export const PERIOD_FIELDS = 'id, run_id, candidate_id, student_id, period_number, opens_on, due_on, send_on, status, sent_at, opened_at, last_saved_at, submitted_at'
export const RUN_FIELDS = 'id, candidate_id, cycle_id, student_id, started_on, started_at, period_count, period_days, status, stopped_at'

// The instant a period stops accepting saves and submissions: Pacific end of
// day on due_on + GRACE_DAYS, the same rule the Transition Form uses for its
// close, so both forms shut at 11:59:59 PM Pacific and never at a UTC rollover.
export function periodClosesAt(period) {
  return pacificEndOfDay(closesOn(period))
}

export function isPeriodClosed(period, nowIso) {
  const close = periodClosesAt(period)
  return Boolean(close && nowIso && nowIso > close)
}

// ── Start ───────────────────────────────────────────────────────────────────
// Creates the run and all of its periods. Period 1 is then sent by the caller
// through sendReflectionPeriod. A second Start for the same resident is a
// 'already_started' refusal, never a second run.
export async function startReflectionRun(db, { candidate, actorProfileId, startedOn, periodCount = PERIOD_COUNT, periodDays = PERIOD_DAYS }) {
  const schedule = buildSchedule({ startedOn, periodCount, periodDays })
  const run = await db.from(RUNS).insert({
    candidate_id: candidate.id, cycle_id: candidate.cycle_id, student_id: candidate.student_id,
    started_on: startedOn, started_by_profile_id: actorProfileId,
    period_count: periodCount, period_days: periodDays, status: 'active',
  }).select(RUN_FIELDS).maybeSingle()
  if (run.error) {
    if (run.error.code === '23505') return { ok: false, reason: 'already_started' }
    return { ok: false, reason: 'run_write_failed', error: run.error }
  }
  if (!run.data) return { ok: false, reason: 'run_write_failed' }
  const periods = await db.from(PERIODS).insert(schedule.map(p => ({
    run_id: run.data.id, candidate_id: candidate.id, student_id: candidate.student_id, ...p, status: 'pending',
  }))).select(PERIOD_FIELDS)
  if (periods.error) return { ok: false, reason: 'periods_write_failed', error: periods.error }
  await recordNgrpAudit(db, {
    eventType: 'reflection_started', cycleId: candidate.cycle_id, candidateId: candidate.id,
    studentId: candidate.student_id, actorProfileId,
    metadata: { period_count: periodCount },
  })
  return { ok: true, run: run.data, periods: (periods.data || []).sort((a, b) => a.period_number - b.period_number) }
}

export async function stopReflectionRun(db, { run, actorProfileId, nowIso }) {
  const upd = await db.from(RUNS).update({ status: 'stopped', stopped_at: nowIso, stopped_by_profile_id: actorProfileId })
    .eq('id', run.id).eq('status', 'active').select('id').maybeSingle()
  if (upd.error) return { ok: false, reason: 'run_update_failed', error: upd.error }
  if (!upd.data) return { ok: true, idempotent: true }
  // Every live link dies with the run; a stopped resident cannot keep submitting.
  const periodIds = await db.from(PERIODS).select('id').eq('run_id', run.id)
  if (!periodIds.error && (periodIds.data || []).length) {
    await db.from(TOKENS).update({ status: 'revoked', revoked_at: nowIso })
      .in('period_id', periodIds.data.map(p => p.id)).eq('status', 'active')
  }
  await recordNgrpAudit(db, {
    eventType: 'reflection_stopped', cycleId: run.cycle_id, candidateId: run.candidate_id,
    studentId: run.student_id, actorProfileId,
  })
  return { ok: true }
}

// ── Who receives it, and where ───────────────────────────────────────────────
// A resident is a hired, not separated alumnus; the address rule is the
// residency one (Cedars-Sinai first, personal as backup, never the school).
export function reflectionRecipient({ outcome, student }) {
  if (!isHired(outcome)) return { email: null, reason: 'not_a_resident' }
  return residencyRecipient({ outcome, student })
}

// ── Send one period (durable, replay-safe) ──────────────────────────────────
// ctx: { db, run, period, student, outcome, actorProfileId|null, generateToken,
//        sendEmail, buildEmail, baseUrl, nowIso }
// Returns { outcome: 'sent'|'skipped'|'repaired'|'failed', reason?, tokenHashPrefix?, providerId? }
export async function sendReflectionPeriod(ctx) {
  const { db, run, period, student, outcome, actorProfileId = null, generateToken, sendEmail, buildEmail, baseUrl, nowIso } = ctx
  const fail = (reason, extra = {}) => ({ outcome: 'failed', reason, periodId: period.id, ...extra })

  if (period.sent_at) return { outcome: 'skipped', reason: 'already_sent', periodId: period.id }
  if (run.status !== 'active') return { outcome: 'skipped', reason: 'run_not_active', periodId: period.id }

  const to = reflectionRecipient({ outcome, student })
  if (!to.email) return fail(to.reason || 'no_email')

  // An ACTIVE token with an unsent period means the provider accepted the
  // email and only the period update was lost: repair, do not resend.
  const live = await db.from(TOKENS).select('id, status, token_hash_prefix, provider_email_id, provider_accepted_at')
    .eq('period_id', period.id).in('status', ['active', 'pending'])
  if (live.error) return fail('token_read_failed')
  const active = (live.data || []).find(t => t.status === 'active')
  if (active) {
    const repaired = await markSent(db, period, active.provider_accepted_at || nowIso)
    if (repaired.error) return fail('period_update_failed')
    return { outcome: 'repaired', periodId: period.id, tokenHashPrefix: active.token_hash_prefix, providerId: active.provider_email_id }
  }
  // A pending token whose raw value nobody holds cannot be re-sent: fail it.
  for (const stale of (live.data || []).filter(t => t.status === 'pending')) {
    await db.from(TOKENS).update({ status: 'failed', failed_reason: 'superseded' }).eq('id', stale.id)
  }

  const { raw, hash, hashPrefix } = generateToken()
  const minted = await db.from(TOKENS).insert({
    period_id: period.id, token_hash: hash, token_hash_prefix: hashPrefix, status: 'pending',
    created_by_profile_id: actorProfileId,
  }).select('id').maybeSingle()
  if (!minted.data) return fail('token_write_failed')
  const tokenId = minted.data.id

  const url = `${baseUrl}/ngrp/reflection#t=${raw}`
  const { subject, html } = buildEmail({ student, run, period, url })
  const sent = await sendEmail({ to: to.email, subject, html, idempotencyKey: `ngrp-reflection/${period.id}/${tokenId}` })
  if (!sent.ok) {
    if (sent.reason === 'provider_rejected') {
      await db.from(TOKENS).update({ status: 'failed', failed_reason: 'provider_rejected' }).eq('id', tokenId)
      return fail('provider_rejected')
    }
    return fail(sent.reason || 'provider_error', { indeterminate: true })
  }

  const activated = await db.from(TOKENS).update({
    status: 'active', provider_email_id: sent.providerId || null, provider_accepted_at: nowIso,
  }).eq('id', tokenId)
  if (activated.error) return fail('activation_failed', { providerAccepted: true, recoverable: true })
  const marked = await markSent(db, period, nowIso)
  if (marked.error) return fail('period_update_failed', { providerAccepted: true, recoverable: true })

  await recordNgrpAudit(db, {
    eventType: 'reflection_sent', cycleId: run.cycle_id, candidateId: run.candidate_id,
    studentId: run.student_id, actorProfileId, actorKind: actorProfileId ? 'staff' : 'system',
    metadata: { period_number: period.period_number, token_hash_prefix: hashPrefix },
  })
  return { outcome: 'sent', periodId: period.id, tokenHashPrefix: hashPrefix, providerId: sent.providerId || null, subject, to: to.email }
}

function markSent(db, period, sentAt) {
  return db.from(PERIODS).update({ status: 'sent', sent_at: sentAt }).eq('id', period.id).is('sent_at', null)
}

// ── Public resolution (token → exactly one period) ──────────────────────────
export async function resolveReflectionToken(db, tokenHash, nowIso) {
  const tok = await db.from(TOKENS).select('*').eq('token_hash', tokenHash).maybeSingle()
  if (tok.error) return { state: 'error' }
  if (!tok.data || tok.data.status !== 'active' || tok.data.revoked_at) return { state: 'unknown' }
  const per = await db.from(PERIODS).select(PERIOD_FIELDS + ', draft').eq('id', tok.data.period_id).maybeSingle()
  if (per.error) return { state: 'error' }
  if (!per.data) return { state: 'unknown' }
  const run = await db.from(RUNS).select(RUN_FIELDS).eq('id', per.data.run_id).maybeSingle()
  if (run.error || !run.data) return { state: 'error' }
  if (run.data.status !== 'active') return { state: 'unknown' }
  const closed = isPeriodClosed(per.data, nowIso)
  return { state: 'ok', closed, token: tok.data, period: per.data, run: run.data }
}

// ── The resident's schedule (RESIDENCY-REFLECTION-2, Owner 2026-09-14) ──────
// One calendar per resident: a mark means "I work, or worked, this day". Marks
// show on Residency > Activity and seed each period's shift cards. A removed
// mark is deleted; it is a plan, not a record of care.
export const SCHEDULE = 'ngrp_resident_schedule_days'
export const SCHEDULE_FIELDS = 'id, candidate_id, student_id, on_date, shift'
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function residentShift(outcome) {
  return RESIDENT_SHIFTS.includes(outcome?.shift) ? outcome.shift : null
}

export function isRealDay(v) {
  if (typeof v !== 'string' || !YMD.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export async function loadSchedule(db, candidateId) {
  const { data, error } = await db.from(SCHEDULE).select(SCHEDULE_FIELDS).eq('candidate_id', candidateId).order('on_date')
  if (error) return { error }
  return { rows: (data || []).map(r => ({ on_date: r.on_date, shift: r.shift || null })) }
}

/**
 * Mark a day. A Variable resident names the shift for that day; anyone else's
 * mark carries no shift of its own and reads the hire record. Marking a day
 * that is already marked is a no-op, not an error.
 */
export async function addScheduleDay(db, { run, onDate, shift = null, residentShiftType = null }) {
  if (!isRealDay(onDate)) return { ok: false, reason: 'invalid_date' }
  let dayShift = null
  if (residentShiftType === 'Variable') {
    if (!SCHEDULE_SHIFTS.includes(shift)) return { ok: false, reason: 'shift_required' }
    dayShift = shift
  }
  const ins = await db.from(SCHEDULE).insert({
    candidate_id: run.candidate_id, student_id: run.student_id, on_date: onDate, shift: dayShift,
  })
  if (ins.error) {
    if (ins.error.code === '23505') return { ok: true, idempotent: true }
    return { ok: false, reason: 'schedule_write_failed', error: ins.error }
  }
  return { ok: true, mark: { on_date: onDate, shift: dayShift } }
}

export async function removeScheduleDay(db, { run, onDate }) {
  if (!isRealDay(onDate)) return { ok: false, reason: 'invalid_date' }
  const del = await db.from(SCHEDULE).delete().eq('candidate_id', run.candidate_id).eq('on_date', onDate)
  if (del.error) return { ok: false, reason: 'schedule_write_failed', error: del.error }
  return { ok: true }
}

// The periods the cron should send today (Pacific). A period is due for a send
// when its send day has arrived, it has not been sent, and it is not already
// past due; a missed Friday is caught the next run rather than dropped.
export function periodsToSend(periods, runsById, todayYmd) {
  return (periods || []).filter(p =>
    !p.sent_at
    && p.period_number > 1
    && p.send_on <= todayYmd
    && p.due_on >= todayYmd
    && runsById.get(p.run_id)?.status === 'active')
}
