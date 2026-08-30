// Owner/Admin portal preview catalog. This endpoint never grants or persists a
// portal role. Only Student preview needs bootstrap choices here. Unit Leader
// and Academic Partner derive their selectors from their existing authorized
// roster endpoints, while Nursing Education & Leadership is organization-wide.

import { getServiceDb, verifyOwnerAdminCaller } from '../lib/portalAuth.js'

const PREVIEW_ROLES = new Set(['student', 'unit_leader', 'academic_partner', 'nursing_academic'])

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyOwnerAdminCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const role = typeof req.query?.role === 'string' ? req.query.role.trim() : ''
  if (!PREVIEW_ROLES.has(role)) return res.status(400).json({ error: 'invalid_preview_role' })

  // These portals resolve their server-authorized scope in their own data
  // endpoints. Do not make an unrelated student, unit, or school catalog a
  // prerequisite for entering them.
  if (role !== 'student') {
    return res.status(200).json({ students: [], unit_keys: [], school_keys: [] })
  }

  let db
  try { db = getServiceDb() } catch { return res.status(500).json({ error: 'internal_error' }) }

  const studentResult = await db
    .from('students')
    .select('id, cohort_id, first_name, preferred_first_name, last_name, school, status')
  if (studentResult.error) return res.status(500).json({ error: 'student_catalog_unavailable' })

  const cohortIds = [...new Set((studentResult.data || []).map(student => student.cohort_id).filter(Boolean))]
  let cohortRows = []
  if (cohortIds.length > 0) {
    const cohortResult = await db.from('cohorts').select('id, name').in('id', cohortIds)
    if (cohortResult.error) return res.status(500).json({ error: 'cohort_catalog_unavailable' })
    cohortRows = cohortResult.data || []
  }

  const cohorts = Object.fromEntries(cohortRows.map(row => [row.id, row.name]))
  const students = (studentResult.data || [])
    .map(student => ({
      id: student.id,
      label: `${student.preferred_first_name || student.first_name || ''} ${student.last_name || ''}`.trim() || 'Unnamed student',
      school: student.school || null,
      cohort: cohorts[student.cohort_id] || null,
      status: student.status || null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return res.status(200).json({ students, unit_keys: [], school_keys: [] })
}
