// lib/server/ngrpUnitInterviews.js
//
// NGRP-INTERVIEWS-1 Phase 3: the Unit Leader Portal's Interviews tab, on the server. Owner
// decisions (2026-10-05): a unit leader interviews the residency applicants Talent Acquisition
// PAIRED with their unit on the Interview Board (ngrp_candidates.assigned_unit), with an internship
// interviewer's abilities: open times, see their interviewees, score with the NGRP rubric. They see
// only their OWN rubric; the panel and everyone else's rubrics stay with the ASPIRE team and Talent
// Acquisition. Applicants who ranked the unit first appear as a COUNT, never by name, until paired.
//
// Every function takes the service-role client and the caller's resolved unit keys
// (verifyPortalUnitLeaderCaller). Nothing here trusts a unit or an applicant the browser names: an
// applicant is in reach only while paired with one of the caller's units, in a residency cohort
// that is being worked (Planning or Active).
import { fetchCycles, loadApplicantsPayload, isMissingNgrpTable } from './ngrpApplicants.js'
import { fetchLatestRevisions } from './ngrpResidencyExport.js'
import { recordNgrpAudit } from './ngrpAudit.js'
import { deriveApplicantRows, effectivePreferences } from '../../src/lib/ngrp/ngrpStates.js'
import { digestCycles } from '../../src/lib/ngrp/residencyDigestModel.js'
import { validateRubricSave, compositeOf } from '../../src/lib/ngrp/ngrpRubric.js'
import { transitionSummaryRows } from '../../src/lib/ngrp/transitionSummary.js'
import { unitNameKey } from '../../src/lib/unitNameCanon.js'
import { RUBRIC_FIELDS } from './ngrpInterviewRubrics.js'

const keyOf = v => unitNameKey(v || '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = v => typeof v === 'string' && UUID.test(v)

// What the tab shows of a person: never an email, a phone, a date of birth or an id beyond the
// candidate's own (which the routes need).
function personOf(student) {
  return {
    first_name: student?.first_name || '', last_name: student?.last_name || '',
    preferred_first_name: student?.preferred_first_name || '',
    school: student?.school || '', program_type: student?.program_type || '', aspire_cohort: student?.aspire_cohort || '',
  }
}

/** The caller's units as { key, name }, narrowed to one when `unitFilter` names one of them. */
export function scopeUnits(unitKeys = [], unitFilter = null) {
  const all = [...new Set(unitKeys)].map(name => ({ key: keyOf(name), name })).filter(u => u.key)
  if (!unitFilter) return all
  return all.filter(u => u.key === keyOf(unitFilter))
}

/** Pure: interviewees, the ranked-first count, from one cohort's rows. Exported for tests. */
export function interviewSlice(rows = [], units = []) {
  const byKey = new Map(units.map(u => [u.key, u]))
  const interviewees = rows
    .filter(r => r.candidate_id && r.assigned_unit && byKey.has(keyOf(r.assigned_unit)))
    .map(r => {
      const prefs = effectivePreferences(r).preferences || []
      const rankIdx = prefs.findIndex(p => keyOf(p) === keyOf(r.assigned_unit))
      return {
        candidate_id: r.candidate_id, unit: byKey.get(keyOf(r.assigned_unit)).name, ...personOf(r.student),
        choice_rank: rankIdx >= 0 ? rankIdx + 1 : null,
        interview_status: r.interview_status || 'not_scheduled', interview_at: r.interview_at || null,
        interview_mode: r.interview_mode || null,
      }
    })
  const rankedFirst = units.map(u => ({
    unit: u.name,
    count: rows.filter(r => keyOf((effectivePreferences(r).preferences || [])[0]) === u.key).length,
  }))
  return { interviewees, rankedFirst }
}

async function workedCycles(db) {
  const c = await fetchCycles(db)
  if (c.error) return { error: c.error }
  if (c.provisioned === false) return { provisioned: false, cycles: [] }
  return { provisioned: true, cycles: digestCycles(c.cycles) }
}

/** Everything the tab draws. { state, cycles, interviewees, rankedFirst, blocks, slots, rubricsProvisioned } */
export async function loadUnitInterviews(db, { unitKeys, unitFilter = null, profileId }) {
  const units = scopeUnits(unitKeys, unitFilter)
  const wc = await workedCycles(db)
  if (wc.error) return { state: 'error' }
  if (!wc.provisioned || !units.length) return { state: 'ok', cycles: [], interviewees: [], rankedFirst: [], blocks: [], slots: [], rubricsProvisioned: false }

  const interviewees = []
  const rankedFirst = new Map(units.map(u => [u.name, 0]))
  for (const cycle of wc.cycles) {
    const payload = await loadApplicantsPayload(db, cycle.id)
    if (payload.state === 'unprovisioned' || payload.state === 'cycle_not_found') continue
    if (payload.state !== 'ok') return { state: 'error' }
    const slice = interviewSlice(deriveApplicantRows(payload.students, payload.candidates), units)
    for (const p of slice.interviewees) interviewees.push({ ...p, cycle_id: cycle.id, cycle_name: cycle.name })
    for (const r of slice.rankedFirst) rankedFirst.set(r.unit, rankedFirst.get(r.unit) + r.count)
  }

  // The caller's OWN rubrics only.
  let rubricsProvisioned = true
  const mine = new Map()
  if (interviewees.length) {
    const r = await db.from('ngrp_interview_rubrics').select('candidate_id, status, cj_score, pp_score, ga_score, individual_recommendation, updated_at')
      .eq('interviewer_profile_id', profileId).in('candidate_id', interviewees.map(i => i.candidate_id))
    if (r.error) { if (isMissingNgrpTable(r.error)) rubricsProvisioned = false; else return { state: 'error' } }
    for (const row of r.data || []) mine.set(row.candidate_id, { status: row.status, composite: compositeOf(row), recommendation: row.individual_recommendation, updated_at: row.updated_at })
  }

  // The units' open times and bookings. A booking names the person only when they are one of
  // the caller's interviewees (paired with the unit); otherwise it reads "Booked".
  const cycleIds = wc.cycles.map(c => c.id)
  const names = new Map(interviewees.map(i => [i.candidate_id, i]))
  const unitNames = units.map(u => u.name)
  let blocks = [], slots = []
  if (cycleIds.length) {
    const [b, s] = await Promise.all([
      db.from('ngrp_interview_blocks').select('id, cycle_id, unit_key, block_date, start_time, end_time, duration_minutes, break_minutes, interview_mode').in('cycle_id', cycleIds).in('unit_key', unitNames),
      db.from('ngrp_interview_slots').select('id, block_id, cycle_id, unit_key, slot_at, duration_minutes, status, booked_candidate_id').in('cycle_id', cycleIds).in('unit_key', unitNames).order('slot_at'),
    ])
    if (b.error || s.error) {
      if (!isMissingNgrpTable(b.error || s.error)) return { state: 'error' }
      rubricsProvisioned = false
    } else {
      blocks = b.data || []
      slots = (s.data || []).map(({ booked_candidate_id, ...slot }) => {
        const who = booked_candidate_id ? names.get(booked_candidate_id) : null
        return { ...slot, booked: slot.status === 'booked', booked_candidate_id: who ? booked_candidate_id : null, booked_name: who ? [who.last_name, who.preferred_first_name || who.first_name].filter(Boolean).join(', ') : null }
      })
    }
  }

  return {
    state: 'ok',
    // ONE-CALENDAR-3: the cohort's key dates, for the Residency view of the unit's calendar.
    cycles: wc.cycles.map(c => ({
      id: c.id, name: c.name,
      application_open_date: c.application_open_date || null, application_deadline: c.application_deadline || null,
      interview_window_start: c.interview_window_start || null, interview_window_end: c.interview_window_end || null,
      residency_start_date: c.residency_start_date || null,
    })),
    interviewees: interviewees.map(i => ({ ...i, my_rubric: mine.get(i.candidate_id) || null })),
    rankedFirst: [...rankedFirst].map(([unit, count]) => ({ unit, count })),
    blocks, slots, rubricsProvisioned,
  }
}

/** The candidate, if it is in the caller's reach: paired with one of their units, in a worked cohort. */
export async function reachableCandidate(db, { candidateId, unitKeys }) {
  if (!isUuid(candidateId)) return { notFound: true }
  const c = await db.from('ngrp_candidates').select('id, cycle_id, student_id, assigned_unit, interview_status, interview_at, interview_mode').eq('id', candidateId).maybeSingle()
  if (c.error) return { error: c.error }
  if (!c.data?.assigned_unit) return { notFound: true }
  const unit = scopeUnits(unitKeys).find(u => u.key === keyOf(c.data.assigned_unit))
  if (!unit) return { notFound: true }
  const wc = await workedCycles(db)
  if (wc.error) return { error: wc.error }
  const cycle = (wc.cycles || []).find(x => x.id === c.data.cycle_id)
  if (!cycle) return { notFound: true }
  return { candidate: c.data, unit, cycle }
}

/**
 * The rubric book's two pages: the applicant (identity, choices, interview, and their Transition
 * Form answers only when the submission carries the units consent, UNIT-SHARE-CONSENT-1) and the
 * caller's own rubric, or null.
 */
export async function loadRubricBook(db, { candidateId, unitKeys, profileId }) {
  const reach = await reachableCandidate(db, { candidateId, unitKeys })
  if (reach.error) return { state: 'error' }
  if (reach.notFound) return { state: 'not_found' }
  const payload = await loadApplicantsPayload(db, reach.cycle.id)
  if (payload.state !== 'ok') return { state: 'error' }
  const row = deriveApplicantRows(payload.students, payload.candidates).find(r => r.candidate_id === candidateId)
  if (!row) return { state: 'not_found' }
  let form = { shared: false, rows: [] }
  const revs = await fetchLatestRevisions(db, [row])
  const answers = revs.byAssignment?.get(row.assignment_id)
  if (answers?.attestation?.consent_unit_share === true) {
    form = { shared: true, rows: transitionSummaryRows(answers).filter(([label]) => !/^Consent to share/.test(label)) }
  }
  const mine = await db.from('ngrp_interview_rubrics').select(RUBRIC_FIELDS).eq('candidate_id', candidateId).eq('interviewer_profile_id', profileId).maybeSingle()
  if (mine.error && !isMissingNgrpTable(mine.error)) return { state: 'error' }
  return {
    state: 'ok',
    applicant: {
      candidate_id: candidateId, cycle_name: reach.cycle.name, unit: reach.unit.name, ...personOf(row.student),
      preferences: effectivePreferences(row).preferences || [],
      interview_status: row.interview_status, interview_at: row.interview_at || null, interview_mode: row.interview_mode || null,
      form,
    },
    rubric: mine.data || null,
    rubricsProvisioned: !mine.error,
  }
}

// The fields a save may set, beside what validateRubricSave checks.
const RUBRIC_WRITABLE = ['cj_question', 'cj_question_other', 'cj_score', 'cj_notes', 'pp_question', 'pp_question_other', 'pp_score', 'pp_notes',
  'ga_question', 'ga_question_other', 'ga_score', 'ga_notes', 'individual_recommendation', 'suggested_unit', 'summary_comments', 'status']

/**
 * Save the caller's own rubric for one applicant (created on the first save; one per interviewer
 * per applicant, which the table also enforces). Completing it records the event, and a first
 * completed rubric marks the interview held in the binder (Owner: the rubric feeds the binder).
 */
export async function saveRubric(db, { candidateId, unitKeys, profile, input, nowIso = new Date().toISOString() }) {
  const reach = await reachableCandidate(db, { candidateId, unitKeys })
  if (reach.error) return { status: 500, error: 'internal_error' }
  if (reach.notFound) return { status: 404, error: 'not_found' }
  const src = Object.fromEntries(Object.entries(input || {}).filter(([k]) => RUBRIC_WRITABLE.includes(k)))
  const existing = await db.from('ngrp_interview_rubrics').select(RUBRIC_FIELDS).eq('candidate_id', candidateId).eq('interviewer_profile_id', profile.id).maybeSingle()
  if (existing.error) return isMissingNgrpTable(existing.error) ? { status: 409, error: 'not_enabled' } : { status: 500, error: 'internal_error' }
  const current = existing.data || {}
  const v = validateRubricSave(src, current)
  if (!v.ok) return { status: 422, error: 'validation_failed', errors: v.errors }
  const fields = { ...v.fields, updated_at: nowIso }
  const completing = fields.status === 'completed' && current.status !== 'completed'
  const reopening = fields.status === 'in_progress' && current.status === 'completed'
  if (completing) fields.completed_at = nowIso
  if (reopening) fields.completed_at = null

  let saved
  if (existing.data) {
    saved = await db.from('ngrp_interview_rubrics').update(fields).eq('id', existing.data.id).select(RUBRIC_FIELDS).single()
  } else {
    saved = await db.from('ngrp_interview_rubrics').insert({
      ...fields, cycle_id: reach.cycle.id, candidate_id: candidateId, unit_key: reach.unit.name,
      interviewer_profile_id: profile.id, interviewer_name: String(profile.full_name || profile.email || 'Interviewer').slice(0, 160),
      interview_at: reach.candidate.interview_at || null,
    }).select(RUBRIC_FIELDS).single()
  }
  if (saved.error) return { status: 500, error: 'internal_error' }

  if (completing || reopening) {
    await recordNgrpAudit(db, {
      eventType: completing ? 'interview_rubric_completed' : 'interview_rubric_reopened',
      cycleId: reach.cycle.id, candidateId, studentId: reach.candidate.student_id, actorProfileId: profile.id,
      metadata: { unit: reach.unit.name, ...(completing ? { composite: compositeOf(saved.data), recommendation: saved.data.individual_recommendation } : {}) },
    })
  }
  // The rubric feeds the binder: a completed rubric means the interview was held.
  if (completing && ['not_scheduled', 'scheduled'].includes(reach.candidate.interview_status || 'not_scheduled')) {
    const upd = await db.from('ngrp_candidates').update({
      interview_status: 'completed', interview_recorded_by_profile_id: profile.id, interview_recorded_at: nowIso,
    }).eq('id', candidateId)
    if (!upd.error) {
      await recordNgrpAudit(db, { eventType: 'interview_recorded', cycleId: reach.cycle.id, candidateId, studentId: reach.candidate.student_id, actorProfileId: profile.id, metadata: { interview_status: 'completed', from: 'rubric' } })
    }
  }
  return { status: 200, rubric: saved.data }
}

// ── Open times ──────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const minutesOf = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** A Pacific wall-clock date and time as a UTC ISO string (DST-correct). Exported for tests. */
export function pacificToIso(ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const asPacific = ts => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map(x => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  }
  const offset = asPacific(guess) - guess
  let ts = guess - offset
  const again = asPacific(ts) - ts
  if (again !== offset) ts = guess - again
  return new Date(ts).toISOString()
}

/** Pure: the slots a block makes. Exported for tests. */
export function slotTimes({ block_date, start_time, end_time, duration_minutes, break_minutes = 0 }) {
  const out = []
  const end = minutesOf(end_time)
  for (let t = minutesOf(start_time); t + duration_minutes <= end; t += duration_minutes + break_minutes) {
    const hhmm = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    out.push(pacificToIso(block_date, hhmm))
  }
  return out
}

export function validateBlock(input = {}) {
  const errors = []
  const b = {
    block_date: input.block_date, start_time: input.start_time, end_time: input.end_time,
    duration_minutes: Number(input.duration_minutes), break_minutes: Number(input.break_minutes || 0),
    interview_mode: input.interview_mode || null,
  }
  if (!DATE.test(b.block_date || '')) errors.push({ field: 'block_date', message: 'Choose a date.' })
  if (!TIME.test(b.start_time || '')) errors.push({ field: 'start_time', message: 'Choose a start time.' })
  if (!TIME.test(b.end_time || '')) errors.push({ field: 'end_time', message: 'Choose an end time.' })
  if (!(b.duration_minutes >= 10 && b.duration_minutes <= 120)) errors.push({ field: 'duration_minutes', message: 'Each interview is 10 to 120 minutes.' })
  if (![0, 5, 10, 15, 30].includes(b.break_minutes)) errors.push({ field: 'break_minutes', message: 'Choose a break of 0, 5, 10, 15 or 30 minutes.' })
  if (b.interview_mode && !['in_person', 'virtual'].includes(b.interview_mode)) errors.push({ field: 'interview_mode', message: 'Choose in person or virtual.' })
  if (!errors.length && minutesOf(b.end_time) <= minutesOf(b.start_time)) errors.push({ field: 'end_time', message: 'The end comes after the start.' })
  if (!errors.length && !slotTimes(b).length) errors.push({ field: 'end_time', message: 'That span is too short for one interview.' })
  return errors.length ? { ok: false, errors } : { ok: true, block: b }
}

export async function openTimes(db, { unitKeys, profile, input }) {
  const unit = scopeUnits(unitKeys).find(u => u.key === keyOf(input?.unit))
  if (!unit) return { status: 404, error: 'unit_not_found' }
  if (!isUuid(input?.cycle_id)) return { status: 422, error: 'invalid_cycle_id' }
  const wc = await workedCycles(db)
  if (wc.error) return { status: 500, error: 'internal_error' }
  if (!(wc.cycles || []).some(c => c.id === input.cycle_id)) return { status: 404, error: 'cycle_not_found' }
  const v = validateBlock(input)
  if (!v.ok) return { status: 422, error: 'validation_failed', errors: v.errors }
  const ins = await db.from('ngrp_interview_blocks').insert({ ...v.block, cycle_id: input.cycle_id, unit_key: unit.name, created_by_profile_id: profile.id }).select('id').single()
  if (ins.error) return isMissingNgrpTable(ins.error) ? { status: 409, error: 'not_enabled' } : { status: 500, error: 'internal_error' }
  const times = slotTimes(v.block)
  const slots = await db.from('ngrp_interview_slots').insert(times.map(slot_at => ({ block_id: ins.data.id, cycle_id: input.cycle_id, unit_key: unit.name, slot_at, duration_minutes: v.block.duration_minutes })))
  if (slots.error) {
    await db.from('ngrp_interview_blocks').delete().eq('id', ins.data.id)
    return { status: 500, error: 'internal_error' }
  }
  await recordNgrpAudit(db, { eventType: 'interview_times_opened', cycleId: input.cycle_id, actorProfileId: profile.id, metadata: { unit: unit.name, date: v.block.block_date, slots: times.length } })
  return { status: 200, block_id: ins.data.id, slot_count: times.length }
}

async function blockInReach(db, { blockId, unitKeys }) {
  if (!isUuid(blockId)) return { notFound: true }
  const b = await db.from('ngrp_interview_blocks').select('id, cycle_id, unit_key, block_date').eq('id', blockId).maybeSingle()
  if (b.error) return { error: b.error }
  if (!b.data || !scopeUnits(unitKeys).some(u => u.key === keyOf(b.data.unit_key))) return { notFound: true }
  return { block: b.data }
}

/** Remove a span of open times, refused while anyone is booked into it. */
export async function removeTimes(db, { unitKeys, profile, blockId }) {
  const r = await blockInReach(db, { blockId, unitKeys })
  if (r.error) return { status: 500, error: 'internal_error' }
  if (r.notFound) return { status: 404, error: 'not_found' }
  const booked = await db.from('ngrp_interview_slots').select('id').eq('block_id', blockId).eq('status', 'booked').limit(1)
  if (booked.error) return { status: 500, error: 'internal_error' }
  if ((booked.data || []).length) return { status: 409, error: 'has_bookings' }
  const del = await db.from('ngrp_interview_blocks').delete().eq('id', blockId)
  if (del.error) return { status: 500, error: 'internal_error' }
  await recordNgrpAudit(db, { eventType: 'interview_times_removed', cycleId: r.block.cycle_id, actorProfileId: profile.id, metadata: { unit: r.block.unit_key, date: r.block.block_date } })
  return { status: 200 }
}

/** Block or reopen one open time. A booked time is never blocked from here. */
export async function setSlotBlocked(db, { unitKeys, profile, slotId, blocked }) {
  if (!isUuid(slotId)) return { status: 404, error: 'not_found' }
  const s = await db.from('ngrp_interview_slots').select('id, cycle_id, unit_key, status').eq('id', slotId).maybeSingle()
  if (s.error) return { status: 500, error: 'internal_error' }
  if (!s.data || !scopeUnits(unitKeys).some(u => u.key === keyOf(s.data.unit_key))) return { status: 404, error: 'not_found' }
  if (s.data.status === 'booked') return { status: 409, error: 'booked' }
  const next = blocked ? 'blocked' : 'available'
  if (s.data.status === next) return { status: 200, idempotent: true }
  const upd = await db.from('ngrp_interview_slots').update({ status: next }).eq('id', slotId).eq('status', s.data.status)
  if (upd.error) return { status: 500, error: 'internal_error' }
  await recordNgrpAudit(db, { eventType: blocked ? 'interview_slot_blocked' : 'interview_slot_unblocked', cycleId: s.data.cycle_id, actorProfileId: profile.id, metadata: { unit: s.data.unit_key } })
  return { status: 200 }
}
