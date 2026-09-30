// Owner/Admin only. Return the minimal residency routing context for students
// already visible through the caller's RLS and current demo/live population.
import { verifyOwnerAdminCaller, getServiceDb } from './lib/portalAuth.js'
import { getUserScopedDb } from './lib/messagesAuth.js'
import { populationDb } from '../lib/server/demoScope.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createStudentEmailContextHandler({
  verifyCaller = verifyOwnerAdminCaller, makeUserDb = getUserScopedDb, makeServiceDb = getServiceDb,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
    let body
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { return res.status(400).json({ error: 'invalid_request' }) }
    const ids = body?.student_ids
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(id => typeof id === 'string' && UUID.test(id))) {
      return res.status(400).json({ error: 'invalid_student_ids' })
    }
    try {
      const userDb = makeUserDb(req)
      if (!userDb) return res.status(401).json({ error: 'unauthenticated' })
      const visible = await populationDb(userDb, req).from('students').select('id').in('id', ids)
      if (visible.error) throw visible.error
      const allowed = (visible.data || []).map(s => s.id)
      if (!allowed.length) return res.status(200).json({ students: [] })
      const outcomes = await populationDb(makeServiceDb(), req).from('ngrp_residency_outcomes')
        .select('student_id, hired_at, separated_at, cs_email').in('student_id', allowed)
      if (outcomes.error) throw outcomes.error
      return res.status(200).json({ students: allowed.map(id => ({
        id, residency_outcomes: (outcomes.data || []).filter(o => o.student_id === id)
          .map(({ hired_at, separated_at, cs_email }) => ({ hired_at, separated_at, cs_email })),
      })) })
    } catch {
      return res.status(500).json({ error: 'email_context_unavailable' })
    }
  }
}
export default createStudentEmailContextHandler()
