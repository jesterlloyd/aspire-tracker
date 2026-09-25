/* global process */
// api/cohort-password-set.js
//
// S-08: the ONE writer of a cohort's school form password. The two cohort modals used to
// write cohorts.school_form_password in plaintext from the browser; they now post the
// password here, and this endpoint hands it to set_school_form_password (service_role
// only), which stores a bcrypt hash in cohort_form_secrets and clears any plaintext.
//
// Owner or Admin, verified server-side from the Bearer JWT (S-05's deactivation check
// included). The password is never logged, never echoed, and never written anywhere but
// the RPC argument. An empty password clears the cohort's password. Until
// 20261002000000 is applied the RPC does not exist and this answers 503 with
// password_hashing_not_enabled, so nothing ever falls back to writing plaintext.

import { randomUUID } from 'crypto'
import { verifyOwnerAdminCaller, getServiceDb } from './lib/portalAuth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_PASSWORD_LENGTH = 200

async function emitAudit(db, profile, cohortId, cleared, requestId) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: profile.id,
      user_name: profile.full_name || '',
      user_role: profile.role || '',
      action_type: cleared ? 'cohort_form_password_cleared' : 'cohort_form_password_set',
      entity_type: 'cohort',
      entity_id: String(cohortId),
      cohort_id: cohortId,
      description: cleared ? 'Cleared the school form password' : 'Set the school form password',
      metadata: {},
    })
    if (error) console.warn('[cohort-password-set] audit insert error', { request_id: requestId, errorCode: error.code })
  } catch {
    console.warn('[cohort-password-set] audit insert threw', { request_id: requestId })
  }
}

export function createCohortPasswordSetHandler({ verifyCaller = verifyOwnerAdminCaller, getDb = getServiceDb } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    const requestId = `req_${randomUUID().slice(0, 8)}`

    const auth = await verifyCaller(req)
    if (!auth.ok) {
      const status = auth.status === 403 ? 403 : 401
      return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
    const cohortId = typeof body.cohort_id === 'string' ? body.cohort_id : ''
    if (!UUID_RE.test(cohortId)) return res.status(400).json({ error: 'invalid_request', field: 'cohort_id' })
    if (body.password !== undefined && typeof body.password !== 'string') {
      return res.status(400).json({ error: 'invalid_request', field: 'password' })
    }
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length > MAX_PASSWORD_LENGTH) return res.status(400).json({ error: 'invalid_request', field: 'password' })
    const cleared = password.trim() === ''

    const db = getDb()
    const { data, error } = await db.rpc('set_school_form_password', { p_cohort_id: cohortId, p_password: password })
    if (error) {
      // 42883: the function does not exist yet. The migration has not been applied; say
      // so rather than fall back to the plaintext column.
      if (error.code === '42883' || /set_school_form_password/.test(error.message || '')) {
        console.log('[cohort-password-set] hashing not enabled', { request_id: requestId })
        return res.status(503).json({ error: 'password_hashing_not_enabled', message: 'The password store is not ready yet. Ask the ASPIRE team to apply the pending database migration.' })
      }
      console.log('[cohort-password-set] rpc failed', { request_id: requestId, errorCode: error.code })
      return res.status(500).json({ error: 'internal_error' })
    }
    if (data !== true) return res.status(404).json({ error: 'not_found' })

    await emitAudit(db, auth.profile, cohortId, cleared, requestId)
    console.log('[cohort-password-set] ok', { request_id: requestId, cleared })
    return res.status(200).json({ success: true, cleared })
  }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: 'internal_error' })
  }
  return createCohortPasswordSetHandler()(req, res)
}
