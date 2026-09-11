// api/ngrp-preceptor-feedback.js
//
// RESIDENCY-PORTAL-2b: preceptor feedback requests for the Residency Portal.
// Talent Acquisition sees only that feedback exists; to read it they ask, the
// Owner approves, and only the person who asked can then open it, for that
// one applicant. Every opening is recorded before anything is returned.
//
// Authorization: verifyNgrpCaller (the one Residency check). Each action then
// narrows by audience:
//   summary { cycle_id }                  -> both audiences; Talent Acquisition
//                                            sees submitted-form alumni only and
//                                            only its own requests
//   request { candidate_id, note? }       -> Talent Acquisition only
//   decide  { request_id, decision,       -> the Owner only (is_owner), checked
//             expected_status, note? }       here and again in the database
//   view    { request_id }                -> the requester only, while approved
//
// The two ngrp_preceptor_feedback_* tables are server-only (service_role).
// A missing table or function reads as { provisioned: false } so the feature
// hides itself until migration 20260912000000 is applied.
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { isOwnerCaller } from '../lib/server/access.js'
import { loadApplicantsPayload, isMissingNgrpTable } from '../lib/server/ngrpApplicants.js'
import { liveAssignmentForCandidate } from '../lib/server/ngrpTransition.js'
import {
  TALENT_ACQUISITION, hasSubmittedForm, narrowPayloadForTalentAcquisition,
} from '../lib/server/ngrpTalentAcquisition.js'
import {
  PRECEPTOR_FEEDBACK_FORM_TYPE, REQUEST_NOTE_MAX, shapePreceptorFeedback, buildFeedbackSummary,
} from '../lib/server/ngrpPreceptorFeedback.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['summary', 'request', 'decide', 'view'])
const DECISIONS = new Set(['approved', 'declined', 'revoked'])
const DECIDABLE = new Set(['pending', 'approved'])
const REQUESTS = 'ngrp_preceptor_feedback_requests'
const EVENTS = 'ngrp_preceptor_feedback_access_events'
const DECIDE_STATUS = { owner_required: 403, request_not_found: 404, state_conflict: 409, invalid_transition: 409 }

const unprovisioned = res => res.status(200).json({ provisioned: false })
const internal = res => res.status(500).json({ error: 'internal_error' })
const missing = error => isMissingNgrpTable(error) || error?.code === 'PGRST202'
const uuidOf = v => (typeof v === 'string' && UUID.test(v) ? v : null)

function cleanNote(v) {
  if (v == null) return { ok: true, note: null }
  if (typeof v !== 'string') return { ok: false }
  const t = v.trim()
  if (!t) return { ok: true, note: null }
  return t.length > REQUEST_NOTE_MAX ? { ok: false } : { ok: true, note: t }
}

// Submitted preceptor feedback for these students. Callers choose the columns;
// the view action asks for content only, never ids or the preceptor.
function feedbackRows(db, studentIds, columns) {
  if (studentIds.length === 0) return Promise.resolve({ data: [], error: null })
  return db.from('evaluation_responses')
    .select(columns)
    .eq('form_type', PRECEPTOR_FEEDBACK_FORM_TYPE)
    .in('student_id', studentIds)
    .not('submitted_at', 'is', null)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyNgrpCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const isTA = caller.audience === TALENT_ACQUISITION

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action || !ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })

  const db = getServiceDb()

  try {
    // ── summary ─────────────────────────────────────────────────────────────
    if (action === 'summary') {
      const cycleId = uuidOf(body.cycle_id)
      if (!cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const payload = await loadApplicantsPayload(db, cycleId)
      if (payload.state === 'unprovisioned') return unprovisioned(res)
      if (payload.state === 'cycle_not_found') return res.status(404).json({ error: 'cycle_not_found' })
      if (payload.state !== 'ok') return internal(res)
      // The same roster the workspace endpoint returns to this audience.
      const view = isTA ? narrowPayloadForTalentAcquisition(payload) : payload
      const students = view.students || []
      const candidates = view.candidates || []

      const responses = await feedbackRows(db, students.map(s => s.id), 'student_id')
      if (responses.error) return internal(res)

      let requests = []
      const candidateIds = candidates.map(c => c.id)
      if (candidateIds.length) {
        let q = db.from(REQUESTS)
          .select('id, candidate_id, requester_profile_id, requested_at, request_note, status, decided_at, decision_note')
          .in('candidate_id', candidateIds)
        if (isTA) q = q.eq('requester_profile_id', caller.profile.id)
        const r = await q
        if (r.error) return missing(r.error) ? unprovisioned(res) : internal(res)
        requests = r.data || []
      } else {
        // Nothing to look up, but the table still has to exist for the
        // feature to show.
        const probe = await db.from(REQUESTS).select('id').limit(1)
        if (probe.error) return missing(probe.error) ? unprovisioned(res) : internal(res)
      }

      let requesterNames = new Map()
      let viewEvents = []
      if (!isTA && requests.length) {
        const [profiles, events] = await Promise.all([
          db.from('user_profiles').select('id, full_name').in('id', [...new Set(requests.map(r => r.requester_profile_id))]),
          db.from(EVENTS).select('request_id, created_at').eq('event_type', 'viewed').in('request_id', requests.map(r => r.id)),
        ])
        if (profiles.error || events.error) return internal(res)
        requesterNames = new Map((profiles.data || []).map(p => [p.id, p.full_name]))
        viewEvents = events.data || []
      }

      return res.status(200).json({
        provisioned: true,
        audience: isTA ? TALENT_ACQUISITION : 'staff',
        canDecide: !isTA && isOwnerCaller(caller.profile),
        byStudent: buildFeedbackSummary({
          talentAcquisition: isTA,
          callerId: caller.profile.id,
          students,
          candidates,
          responseStudentIds: (responses.data || []).map(r => r.student_id),
          requests,
          requesterNames,
          viewEvents,
        }),
      })
    }

    // ── request ─────────────────────────────────────────────────────────────
    if (action === 'request') {
      // The ASPIRE team already reads preceptor feedback in Evaluation.
      if (!isTA) return res.status(403).json({ error: 'talent_acquisition_only' })
      const candidateId = uuidOf(body.candidate_id)
      if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
      const note = cleanNote(body.note)
      if (!note.ok) return res.status(422).json({ error: 'invalid_note' })

      const cand = await db.from('ngrp_candidates').select('id, student_id').eq('id', candidateId).maybeSingle()
      if (cand.error) return missing(cand.error) ? unprovisioned(res) : internal(res)
      if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
      // Same rule as the roster: only alumni who submitted the Transition Form.
      const live = await liveAssignmentForCandidate(db, candidateId)
      if (live.error) return missing(live.error) ? unprovisioned(res) : internal(res)
      if (!hasSubmittedForm(live.assignment?.status)) return res.status(404).json({ error: 'candidate_not_found' })

      const fb = await feedbackRows(db, [cand.data.student_id], 'student_id')
      if (fb.error) return internal(res)
      if ((fb.data || []).length === 0) return res.status(409).json({ error: 'no_feedback' })

      const { data, error } = await db.rpc('ngrp_pf_request_tx', {
        p_candidate_id: candidateId, p_requester_profile_id: caller.profile.id, p_note: note.note,
      })
      if (error) return missing(error) ? unprovisioned(res) : internal(res)
      if (!data?.ok) {
        return res.status(data?.reason === 'candidate_not_found' ? 404 : 422).json({ error: data?.reason || 'request_failed' })
      }
      return res.status(200).json({ ok: true, created: data.created === true, request: { id: data.request_id, status: data.status } })
    }

    // ── decide ──────────────────────────────────────────────────────────────
    if (action === 'decide') {
      if (isTA || !isOwnerCaller(caller.profile)) return res.status(403).json({ error: 'owner_required' })
      const requestId = uuidOf(body.request_id)
      if (!requestId) return res.status(422).json({ error: 'invalid_request_id' })
      if (!DECISIONS.has(body.decision)) return res.status(422).json({ error: 'invalid_decision' })
      if (!DECIDABLE.has(body.expected_status)) return res.status(422).json({ error: 'invalid_expected_status' })
      const note = cleanNote(body.note)
      if (!note.ok) return res.status(422).json({ error: 'invalid_note' })

      const { data, error } = await db.rpc('ngrp_pf_decide_tx', {
        p_request_id: requestId,
        p_actor_profile_id: caller.profile.id,
        p_decision: body.decision,
        p_expected_status: body.expected_status,
        p_note: note.note,
      })
      if (error) return missing(error) ? unprovisioned(res) : internal(res)
      if (!data?.ok) {
        return res.status(DECIDE_STATUS[data?.reason] || 422).json({ error: data?.reason || 'decision_failed', status: data?.status })
      }
      return res.status(200).json({ ok: true, request: { id: data.request_id, status: data.status } })
    }

    // ── view ────────────────────────────────────────────────────────────────
    // Only the person who asked, only for the applicant they asked about, only
    // while the request is approved. Anything else reads as not found.
    if (!isTA) return res.status(403).json({ error: 'talent_acquisition_only' })
    const requestId = uuidOf(body.request_id)
    if (!requestId) return res.status(422).json({ error: 'invalid_request_id' })
    const r = await db.from(REQUESTS)
      .select('id, candidate_id, student_id, requester_profile_id, status')
      .eq('id', requestId).maybeSingle()
    if (r.error) return missing(r.error) ? unprovisioned(res) : internal(res)
    const request = r.data
    if (!request || request.requester_profile_id !== caller.profile.id || request.status !== 'approved') {
      return res.status(404).json({ error: 'request_not_found' })
    }
    const live = await liveAssignmentForCandidate(db, request.candidate_id)
    if (live.error) return internal(res)
    if (!hasSubmittedForm(live.assignment?.status)) return res.status(404).json({ error: 'request_not_found' })

    const fb = await feedbackRows(db, [request.student_id], 'timepoint, responses, submitted_at')
    if (fb.error) return internal(res)
    const rows = fb.data || []

    // Recorded BEFORE anything is returned: a view that cannot be logged shows nothing.
    const logged = await db.from(EVENTS).insert({
      request_id: request.id,
      candidate_id: request.candidate_id,
      student_id: request.student_id,
      actor_profile_id: caller.profile.id,
      event_type: 'viewed',
      response_count: rows.length,
    })
    if (logged.error) return internal(res)

    return res.status(200).json({ ok: true, feedback: shapePreceptorFeedback(rows) })
  } catch {
    return internal(res)
  }
}
