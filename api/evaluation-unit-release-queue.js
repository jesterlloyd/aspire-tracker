// api/evaluation-unit-release-queue.js
//
// STAFF (Owner/Admin) review queue for the Unit Leader evaluation release gate. GET only.
//
// AUTHORIZATION. verifyOwnerAdminCaller requires an active Owner/Admin. The rows are read
// with the caller's JWT client (getUserScopedDb), so the release table's owner/admin RLS
// policy is the enforcing boundary; a non-owner/admin would read nothing even if the
// endpoint check were bypassed.
//
// STAFF MAY SEE identity + lifecycle metadata (this is the moderation/release console), so
// the row shape is deliberately richer than the Unit Leader surface. response_id IS returned
// here — only to Owner/Admin — because exact-row lifecycle actions need it.
//
// Only the two approved instruments are ever listed.

import { verifyOwnerAdminCaller } from './lib/portalAuth.js'
import { getUserScopedDb } from './lib/messagesAuth.js'
import { APPROVED_INSTRUMENTS } from '../lib/server/unitEvaluations/config.js'
import { validateQueueQuery } from '../lib/server/unitEvaluations/validation.js'
import { serializeReviewQueueRow } from '../lib/server/unitEvaluations/serialize.js'

const RELEASE_COLUMNS = [
  'response_id', 'instrument_slug', 'timepoint', 'hist_unit_key', 'hist_preceptor_label',
  'hist_cohort_label', 'hist_rotation_end', 'unit_leader_eligible_at', 'snapshot_source',
  'moderation_state', 'release_state', 'released_at', 'revoked_at',
].join(', ')

function displayName(s) {
  if (!s) return null
  const first = s.preferred_first_name || s.first_name || ''
  const last = s.last_name || ''
  return `${first} ${last}`.trim() || null
}

export function createReviewQueueHandler({
  verifyCaller = verifyOwnerAdminCaller,
  makeUserDb = getUserScopedDb,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    const v = validateQueueQuery(req.query)
    if (!v.ok) return res.status(v.status).json({ error: v.error })
    const f = v.value

    const db = makeUserDb(req)
    if (!db) return res.status(401).json({ error: 'unauthenticated' })

    try {
      // 1) Release rows (owner/admin RLS), scoped to the two approved instruments + filters.
      let q = db.from('evaluation_response_unit_release')
        .select(RELEASE_COLUMNS)
        .in('instrument_slug', APPROVED_INSTRUMENTS)
        .order('unit_leader_eligible_at', { ascending: true, nullsFirst: false })
        .limit(1000)
      if (f.instrument) q = q.eq('instrument_slug', f.instrument)
      if (f.timepoint) q = q.eq('timepoint', f.timepoint)
      if (f.unitKey) q = q.eq('hist_unit_key', f.unitKey)
      if (f.releaseState) q = q.eq('release_state', f.releaseState)
      if (f.moderationState) q = q.eq('moderation_state', f.moderationState)
      const relRes = await q
      if (relRes.error) return res.status(500).json({ error: 'internal_error' })
      const rels = relRes.data || []

      // 2) Resolve student display names via responses → students (owner/admin RLS).
      const responseIds = [...new Set(rels.map(r => r.response_id).filter(Boolean))]
      const nameByResponse = new Map()
      if (responseIds.length > 0) {
        const respRes = await db.from('evaluation_responses')
          .select('id, student_id').in('id', responseIds)
        if (respRes.error) return res.status(500).json({ error: 'internal_error' })
        const studentByResponse = new Map((respRes.data || []).map(r => [r.id, r.student_id]))
        const studentIds = [...new Set([...studentByResponse.values()].filter(Boolean))]
        const nameByStudent = new Map()
        if (studentIds.length > 0) {
          const stuRes = await db.from('students')
            .select('id, first_name, last_name, preferred_first_name').in('id', studentIds)
          if (stuRes.error) return res.status(500).json({ error: 'internal_error' })
          for (const s of stuRes.data || []) nameByStudent.set(s.id, displayName(s))
        }
        for (const [rid, sid] of studentByResponse) nameByResponse.set(rid, nameByStudent.get(sid) || null)
      }

      const rows = rels.map(r => serializeReviewQueueRow(r, nameByResponse.get(r.response_id)))
      return res.status(200).json({ rows })
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createReviewQueueHandler()
