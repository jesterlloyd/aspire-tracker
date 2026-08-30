// api/portal/student-summary.js
//
// PHASE2-PORTAL: student portal summary endpoint.
//
// Data-access pattern (amendment 4): JWT-verified serverless endpoint with a
// centralized column allowlist. Chosen for this resource because the summary
// joins students, cohorts, preceptor assignments, and preceptors, and the
// students table mixes portal-visible columns with staff-only ones (interview
// scores, notes, compliance flags, access management). The allowlists below
// are the ONLY columns that can ever leave this endpoint.
//
// Authorization: verified JWT -> user_profiles row -> ACTIVE 'student' role
// grant -> ACTIVE user_student_links rows. The request body and query string
// contribute NOTHING to authorization; there are no parameters.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'
import { buildStudentPortalSummary } from '../lib/studentPortalSummary.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const env = globalThis.process?.env || {}
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !(env.VITE_SUPABASE_URL || env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    const status = auth.status === 403 ? 403 : 401
    return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const db = getServiceDb()

  const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
  if (!isStudent) return res.status(403).json({ error: 'forbidden' })

  const studentIds = await getActiveStudentLinks(db, auth.profile.id)
  if (studentIds.length === 0) return res.status(200).json({ students: [] })

  try {
    return res.status(200).json(await buildStudentPortalSummary(db, studentIds))
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
}
