// api/ngrp-candidate-assess.js
//
// CANDIDATE-SCORE-1 (Owner, 2026-11-01): Keith assesses one NGRP applicant's Transition Form
// statements and explains the candidate score (lib/server/ngrpCandidateScores.js). Its own file
// because a Sonnet run outlives the default function limit (vercel.json gives it 60 s).
//
//   POST { action: 'status' }                          -> { ok, available, reason? }
//   POST { action: 'assess', cycle_id, candidate_id }  -> { ok, assessment, score }
//
// Who: the residency workspace's own gate (verifyNgrpCaller with manage), then the Skill's
// allowed roles decide: Owner, Admin and Talent Acquisition (as role talent_acquisition). The
// applicant must be on that cohort's roster, read through the demo boundary, and have submitted
// the Transition Form. Nothing here writes to the candidate.
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { TALENT_ACQUISITION } from '../lib/server/ngrpTalentAcquisition.js'
import { serviceDbForRequest } from '../lib/server/demoScope.js'
import { assessCandidate, assessmentAvailability } from '../lib/server/ngrpCandidateScores.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const caller = await verifyNgrpCaller(req, { manage: true })
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const ta = caller.audience === TALENT_ACQUISITION
  const actor = ta ? { ...caller.profile, role: 'talent_acquisition', is_owner: false } : caller.profile

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const db = serviceDbForRequest(getServiceDb(), req)
  try {
    if (body.action === 'status') {
      const a = await assessmentAvailability(db, actor)
      return res.status(200).json({ ok: true, available: a.available, reason: a.reason || null })
    }
    if (body.action === 'assess') {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
      if (!cycleId || !candidateId) return res.status(422).json({ error: 'invalid_ids' })
      const r = await assessCandidate(db, { cycleId, candidateId, actor })
      if (!r.ok) {
        if (r.cause) console.error('[ngrp-candidate-assess]', r.error, r.cause?.message || r.cause)
        return res.status(r.status || 500).json({ ok: false, error: r.error })
      }
      return res.status(200).json({ ok: true, assessment: r.assessment, score: r.score })
    }
    return res.status(400).json({ error: 'invalid_action' })
  } catch (err) {
    console.error('[ngrp-candidate-assess] failed:', err?.message || err)
    return res.status(500).json({ error: 'internal_error' })
  }
}
