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
//
// The roster contract (multi-cohort resolution, Completed-only, identity from
// students, prior-hire exclusion, email stripping) lives in
// lib/server/ngrpApplicants.js so it is unit-tested without a live database.
// Unknown-table conditions surface as { provisioned: false }; they are never
// conflated with "no cycles configured" or an ordinary error.
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { fetchCycles, fetchSourceCohorts, loadApplicantsPayload } from '../lib/server/ngrpApplicants.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['cycles', 'applicants'])

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
    // Attach each cycle's mapped source cohorts so the client can show the
    // mapping without a second round trip. A missing mapping table (partial
    // provisioning) degrades that one cycle's list to empty rather than
    // failing the whole action.
    const cycles = []
    for (const cycle of result.cycles) {
      const mapped = await fetchSourceCohorts(db, cycle.id)
      cycles.push({ ...cycle, source_cohorts: mapped.cohorts || [] })
    }
    return res.status(200).json({ provisioned: true, cycles })
  }

  // action === 'applicants'
  const cycleId = typeof body.cycle_id === 'string' ? body.cycle_id : null
  if (!cycleId || !UUID.test(cycleId)) return res.status(422).json({ error: 'invalid_cycle_id' })

  const payload = await loadApplicantsPayload(db, cycleId)
  if (payload.state === 'unprovisioned') return res.status(200).json({ provisioned: false })
  if (payload.state === 'cycle_not_found') return res.status(404).json({ error: 'cycle_not_found' })
  if (payload.state !== 'ok') return res.status(500).json({ error: 'internal_error' })

  return res.status(200).json({
    provisioned: true,
    cycle: payload.cycle,
    sourceCohorts: payload.sourceCohorts,
    students: payload.students,
    candidates: payload.candidates,
    excludedPriorHires: payload.excludedPriorHires,
  })
}
