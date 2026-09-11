// api/ngrp-support.js
//
// RESIDENCY-SUPPORT-1: the Residency Support tab's endpoint.
//
// Authorization: verifyNgrpCaller (the one Residency check), then:
//   summary           { cycle_id }                        -> both audiences.
//                     Talent Acquisition gets the same narrowed roster as
//                     every other Residency endpoint (submitted forms only).
//   record            { candidate_id, activity, occurred_on, note?, mentor_name?, event_id? }
//   record_attendance { cycle_id, activity, occurred_on, candidate_ids[], note?, event_id? }
//   void              { entry_id, reason? }
//   set_mentor        { candidate_id, mentor_name, mentor_profile_id? }
//                     -> the ASPIRE team only (Owner, 2026-09-11): staff with
//                        the NGRP manage capability. Talent Acquisition sees
//                        support but never records it.
//
// Entries are voided, never deleted. Weekly check-ins are not recorded here:
// they are sent through ASPIRE Connect and counted from what Connect already
// records (lib/server/ngrpSupportCheckins.js).
// A missing table reads as { provisioned: false } until 20260914000000 is applied.
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { loadApplicantsPayload, isMissingNgrpTable } from '../lib/server/ngrpApplicants.js'
import { TALENT_ACQUISITION, narrowPayloadForTalentAcquisition } from '../lib/server/ngrpTalentAcquisition.js'
import { validateSupportEntry, validateAttendance, validateMentor, validateVoid } from '../lib/server/ngrpSupport.js'
import { fetchResidentCheckins } from '../lib/server/ngrpSupportCheckins.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['summary', 'record', 'record_attendance', 'void', 'set_mentor'])
const WRITES = new Set(['record', 'record_attendance', 'void', 'set_mentor'])
const ENTRIES = 'ngrp_support_entries'
const MENTORS = 'ngrp_resident_mentors'
const ENTRY_FIELDS = 'id, cycle_id, candidate_id, student_id, activity, occurred_on, note, mentor_name, event_id, recorded_at'

const unprovisioned = res => res.status(200).json({ provisioned: false })
const internal = res => res.status(500).json({ error: 'internal_error' })
const invalid = (res, errors) => res.status(422).json({ error: 'validation_failed', errors })
const isUnique = error => error?.code === '23505'

// Today in Pacific time, as YYYY-MM-DD: support cannot be recorded ahead of time.
function pacificToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action || !ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })

  const caller = await verifyNgrpCaller(req, { manage: WRITES.has(action) })
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const isTA = caller.audience === TALENT_ACQUISITION
  // Only the ASPIRE team records support.
  if (WRITES.has(action) && isTA) return res.status(403).json({ error: 'aspire_team_only' })

  const db = getServiceDb()
  const actorId = caller.profile.id
  const today = pacificToday()

  try {
    // ── summary ─────────────────────────────────────────────────────────────
    if (action === 'summary') {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const payload = await loadApplicantsPayload(db, cycleId)
      if (payload.state === 'unprovisioned') return unprovisioned(res)
      if (payload.state === 'cycle_not_found') return res.status(404).json({ error: 'cycle_not_found' })
      if (payload.state !== 'ok') return internal(res)
      const view = isTA ? narrowPayloadForTalentAcquisition(payload) : payload
      const candidateIds = (view.candidates || []).map(c => c.id)
      const studentIds = (view.students || []).map(s => s.id)

      let entries = []
      let mentors = []
      if (candidateIds.length) {
        const [e, m] = await Promise.all([
          db.from(ENTRIES).select(ENTRY_FIELDS).in('candidate_id', candidateIds).is('voided_at', null).order('occurred_on', { ascending: false }),
          db.from(MENTORS).select('candidate_id, mentor_name, mentor_profile_id, assigned_at').in('candidate_id', candidateIds),
        ])
        if (e.error) return isMissingNgrpTable(e.error) ? unprovisioned(res) : internal(res)
        if (m.error) return isMissingNgrpTable(m.error) ? unprovisioned(res) : internal(res)
        entries = e.data || []
        mentors = m.data || []
      } else {
        const probe = await db.from(ENTRIES).select('id').limit(1)
        if (probe.error) return isMissingNgrpTable(probe.error) ? unprovisioned(res) : internal(res)
      }
      const checkins = await fetchResidentCheckins(db, studentIds)
      if (checkins.error) return internal(res)

      return res.status(200).json({
        provisioned: true,
        canRecord: !isTA,
        today,
        entries,
        mentors,
        checkins: checkins.rows,
      })
    }

    // ── record one activity for one alumnus ─────────────────────────────────
    if (action === 'record') {
      const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
      if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
      const v = validateSupportEntry(body, { today })
      if (!v.ok) return invalid(res, v.errors)
      const cand = await db.from('ngrp_candidates').select('id, cycle_id, student_id').eq('id', candidateId).maybeSingle()
      if (cand.error) return isMissingNgrpTable(cand.error) ? unprovisioned(res) : internal(res)
      if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
      const ins = await db.from(ENTRIES).insert({
        ...v.entry,
        cycle_id: cand.data.cycle_id,
        candidate_id: cand.data.id,
        student_id: cand.data.student_id,
        recorded_by_profile_id: actorId,
      }).select(ENTRY_FIELDS).maybeSingle()
      if (ins.error) {
        if (isUnique(ins.error)) return res.status(409).json({ error: 'already_recorded' })
        return isMissingNgrpTable(ins.error) ? unprovisioned(res) : internal(res)
      }
      return res.status(200).json({ ok: true, entry: ins.data })
    }

    // ── group attendance (Town Hall, Interview Bootcamp) ─────────────────────
    if (action === 'record_attendance') {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const v = validateAttendance(body, { today })
      if (!v.ok) return invalid(res, v.errors)
      const cands = await db.from('ngrp_candidates').select('id, cycle_id, student_id').in('id', v.candidateIds)
      if (cands.error) return isMissingNgrpTable(cands.error) ? unprovisioned(res) : internal(res)
      const inCycle = (cands.data || []).filter(c => c.cycle_id === cycleId)
      if (inCycle.length !== v.candidateIds.length) return res.status(404).json({ error: 'candidate_not_found' })
      let created = 0
      let alreadyRecorded = 0
      for (const c of inCycle) {
        const ins = await db.from(ENTRIES).insert({
          ...v.entry, cycle_id: cycleId, candidate_id: c.id, student_id: c.student_id, recorded_by_profile_id: actorId,
        })
        if (ins.error) {
          if (isUnique(ins.error)) { alreadyRecorded += 1; continue }
          return isMissingNgrpTable(ins.error) ? unprovisioned(res) : res.status(500).json({ error: 'internal_error', created })
        }
        created += 1
      }
      return res.status(200).json({ ok: true, created, alreadyRecorded })
    }

    // ── void (never delete) ─────────────────────────────────────────────────
    if (action === 'void') {
      const v = validateVoid(body)
      if (!v.ok) return invalid(res, v.errors)
      const upd = await db.from(ENTRIES)
        .update({ voided_at: new Date().toISOString(), voided_by_profile_id: actorId, void_reason: v.reason })
        .eq('id', v.entryId).is('voided_at', null)
        .select('id').maybeSingle()
      if (upd.error) return isMissingNgrpTable(upd.error) ? unprovisioned(res) : internal(res)
      if (!upd.data) return res.status(404).json({ error: 'entry_not_found' })
      return res.status(200).json({ ok: true })
    }

    // ── set_mentor (one per resident; reassigning updates it) ────────────────
    const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
    if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
    const v = validateMentor(body)
    if (!v.ok) return invalid(res, v.errors)
    const cand = await db.from('ngrp_candidates').select('id').eq('id', candidateId).maybeSingle()
    if (cand.error) return isMissingNgrpTable(cand.error) ? unprovisioned(res) : internal(res)
    if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
    const nowIso = new Date().toISOString()
    const up = await db.from(MENTORS).upsert({
      candidate_id: candidateId, ...v.mentor, assigned_by_profile_id: actorId, assigned_at: nowIso, updated_at: nowIso,
    }, { onConflict: 'candidate_id' }).select('candidate_id, mentor_name, mentor_profile_id, assigned_at').maybeSingle()
    if (up.error) return isMissingNgrpTable(up.error) ? unprovisioned(res) : internal(res)
    return res.status(200).json({ ok: true, mentor: up.data })
  } catch {
    return internal(res)
  }
}
