// api/portal/unit-interviews.js
//
// NGRP-INTERVIEWS-1 Phase 3: the Unit Leader Portal's Interviews tab. POST { action, ... }.
//
// AUTHORIZATION. verifyPortalUnitLeaderCaller (an active unit_leader grant and the caller's live
// unit scopes, the source every Unit Leader endpoint uses). Every applicant, block and slot is then
// checked against those units on the server: an applicant is in reach only while Talent
// Acquisition has PAIRED them with one of the caller's units (lib/server/ngrpUnitInterviews.js).
// An Owner or Admin previewing the portal reads everything and writes nothing.
//
//   overview       { unit_key? }                     -> cycles, interviewees (own rubric status
//                                                        only), rankedFirst counts, blocks, slots
//   rubric_get     { candidate_id }                  -> the book: applicant page + own rubric
//   rubric_save    { candidate_id, ...fields, status? } -> own rubric (created on first save)
//   times_open     { cycle_id, unit, block_date, start_time, end_time, duration_minutes,
//                    break_minutes?, interview_mode? } -> a block cut into slots
//   times_remove   { block_id }                      -> refused while a slot in it is booked
//   slot_block / slot_unblock { slot_id }
import { verifyPortalUnitLeaderCaller } from '../lib/unitLeaderScope.js'
import {
  loadUnitInterviews, loadRubricBook, saveRubric, openTimes, removeTimes, setSlotBlocked,
} from '../../lib/server/ngrpUnitInterviews.js'

const READS = new Set(['overview', 'rubric_get'])
const WRITES = new Set(['rubric_save', 'times_open', 'times_remove', 'slot_block', 'slot_unblock'])

export function createUnitInterviewsHandler({ verifyCaller = verifyPortalUnitLeaderCaller } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
    const action = typeof body.action === 'string' ? body.action : null
    if (!READS.has(action) && !WRITES.has(action)) return res.status(400).json({ error: 'invalid_action' })

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
    if (WRITES.has(action) && auth.staffPreview) return res.status(403).json({ error: 'preview_read_only' })
    const { db, profile, unitKeys } = auth

    try {
      if (action === 'overview') {
        const r = await loadUnitInterviews(db, { unitKeys, unitFilter: body.unit_key || null, profileId: profile.id })
        if (r.state !== 'ok') return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({
          ok: true, preview: auth.staffPreview === true, cycles: r.cycles, interviewees: r.interviewees,
          rankedFirst: r.rankedFirst, blocks: r.blocks, slots: r.slots, rubricsProvisioned: r.rubricsProvisioned,
        })
      }
      if (action === 'rubric_get') {
        const r = await loadRubricBook(db, { candidateId: body.candidate_id, unitKeys, profileId: profile.id })
        if (r.state === 'not_found') return res.status(404).json({ error: 'not_found' })
        if (r.state !== 'ok') return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ ok: true, applicant: r.applicant, rubric: r.rubric, rubricsProvisioned: r.rubricsProvisioned, preview: auth.staffPreview === true })
      }
      let r
      if (action === 'rubric_save') r = await saveRubric(db, { candidateId: body.candidate_id, unitKeys, profile, input: body })
      if (action === 'times_open') r = await openTimes(db, { unitKeys, profile, input: body })
      if (action === 'times_remove') r = await removeTimes(db, { unitKeys, profile, blockId: body.block_id })
      if (action === 'slot_block' || action === 'slot_unblock') r = await setSlotBlocked(db, { unitKeys, profile, slotId: body.slot_id, blocked: action === 'slot_block' })
      const { status, ...out } = r
      return res.status(status).json(status === 200 ? { ok: true, ...out } : out)
    } catch (e) {
      console.error('[unit-interviews]', action, e?.message)
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createUnitInterviewsHandler()
