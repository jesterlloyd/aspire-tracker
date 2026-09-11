// api/ngrp-workspace.js
//
// NGRP-WORKSPACE-1 (correction): the NGRP read endpoint. The browser holds NO
// direct privilege on any ngrp_* table (RLS enabled, all client-role
// privileges revoked); every read comes through here under a verified caller.
//
// Authorization: verifyNgrpCaller - active Owner capability (is_owner),
// Admin, or Co-Lead (both spellings), decided by the ONE capability table in
// lib/server/access.js. Interviewer, Viewer, portal roles, inactive staff,
// and anonymous callers are refused before any query runs.
//
// Actions (POST { action, ... }):
//   cycles                     -> { provisioned, cycles }
//   applicants { cycle_id }    -> { provisioned, cycle, sourceCohorts,
//                                   students, candidates, excludedPriorHires }
//   export { cycle_id }        -> { provisioned, csv, filename }: the same
//                                   roster as a CSV, built here (RESIDENCY-PORTAL-3)
//   locate { candidate_id }    -> { provisioned, cycle_id }: the residency
//                                   cohort an applicant belongs to
//
// The roster contract (multi-cohort resolution, Completed-only, identity from
// students, prior-hire exclusion, email stripping) lives in
// lib/server/ngrpApplicants.js so it is unit-tested without a live database.
// Unknown-table conditions surface as { provisioned: false }; they are never
// conflated with "no cycles configured" or an ordinary error.
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { fetchCycles, fetchSourceCohortsForCycles, loadApplicantsPayload, isMissingNgrpTable } from '../lib/server/ngrpApplicants.js'
import { liveAssignmentForCandidate } from '../lib/server/ngrpTransition.js'
import { TALENT_ACQUISITION, hasSubmittedForm, narrowPayloadForTalentAcquisition } from '../lib/server/ngrpTalentAcquisition.js'
import { buildResidencyCsv, fetchLatestRevisions } from '../lib/server/ngrpResidencyExport.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['cycles', 'applicants', 'export', 'locate'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyNgrpCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action || !ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })

  const db = getServiceDb()

  if (action === 'cycles') {
    const result = await fetchCycles(db)
    if (result.error) return res.status(500).json({ error: 'internal_error' })
    if (result.provisioned === false) return res.status(200).json({ provisioned: false, cycles: [] })
    // ONE batched mapping read for every listed cycle, with truthful states:
    // a missing mapping table (partial provisioning) reports the whole action
    // as unprovisioned, an ordinary query failure is a server error, and only
    // a successful query may present an empty source_cohorts list. An error
    // is never dressed up as "no source cohorts mapped".
    const mapped = await fetchSourceCohortsForCycles(db, result.cycles.map(c => c.id))
    if (mapped.error) return res.status(500).json({ error: 'internal_error' })
    if (mapped.provisioned === false) return res.status(200).json({ provisioned: false, cycles: [] })
    const cycles = result.cycles.map(c => ({ ...c, source_cohorts: mapped.byCycle.get(c.id) || [] }))
    return res.status(200).json({ provisioned: true, cycles })
  }

  // Which residency cohort an applicant belongs to, so a notification link can
  // switch the cohort picker before opening them. Talent Acquisition gets an
  // answer only for alumni who submitted the Transition Form, like everywhere else.
  if (action === 'locate') {
    const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
    if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
    const cand = await db.from('ngrp_candidates').select('id, cycle_id').eq('id', candidateId).maybeSingle()
    if (cand.error) return isMissingNgrpTable(cand.error) ? res.status(200).json({ provisioned: false }) : res.status(500).json({ error: 'internal_error' })
    if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
    if (caller.audience === TALENT_ACQUISITION) {
      const live = await liveAssignmentForCandidate(db, candidateId)
      if (live.error) return res.status(500).json({ error: 'internal_error' })
      if (!hasSubmittedForm(live.assignment?.status)) return res.status(404).json({ error: 'candidate_not_found' })
    }
    return res.status(200).json({ provisioned: true, cycle_id: cand.data.cycle_id })
  }

  // action === 'applicants' | 'export'
  const cycleId = typeof body.cycle_id === 'string' ? body.cycle_id : null
  if (!cycleId || !UUID.test(cycleId)) return res.status(422).json({ error: 'invalid_cycle_id' })

  const payload = await loadApplicantsPayload(db, cycleId)
  if (payload.state === 'unprovisioned') return res.status(200).json({ provisioned: false })
  if (payload.state === 'cycle_not_found') return res.status(404).json({ error: 'cycle_not_found' })
  if (payload.state !== 'ok') return res.status(500).json({ error: 'internal_error' })
  // RESIDENCY-PORTAL-2: Talent Acquisition sees only alumni who submitted the
  // Transition Form, plus the cohort-wide counts At a Glance shows.
  const view = caller.audience === TALENT_ACQUISITION ? narrowPayloadForTalentAcquisition(payload) : payload

  // RESIDENCY-PORTAL-3: the roster as a CSV. Built from the view above, so it
  // holds exactly the rows this caller's roster shows, plus each alumnus's
  // latest Transition Form answers.
  if (action === 'export') {
    const revisions = await fetchLatestRevisions(db, view.candidates)
    if (revisions.error) return res.status(500).json({ error: 'internal_error' })
    return res.status(200).json({
      provisioned: true,
      ...buildResidencyCsv({
        cycle: payload.cycle, students: view.students, candidates: view.candidates,
        revisionsByAssignment: revisions.byAssignment,
      }),
    })
  }

  return res.status(200).json({
    provisioned: true,
    cycle: payload.cycle,
    sourceCohorts: payload.sourceCohorts,
    students: view.students,
    candidates: view.candidates,
    ...(view.pipeline ? { pipeline: view.pipeline } : {}),
    excludedPriorHires: payload.excludedPriorHires,
    // NGRP-RELEASE-2: false while migration 20260904000000 is unapplied - the
    // roster still renders (neutral defaults), but send/review actions
    // disable themselves honestly instead of failing mid-flight.
    transitionProvisioned: payload.transitionProvisioned !== false,
  })
}
