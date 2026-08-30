// Owner/Admin portal preview catalog. This endpoint never grants or persists a
// portal role. It returns the server-derived choices available to the current
// staff actor so portal shells can render their in-portal scope selectors.

import { getServiceDb, verifyOwnerAdminCaller } from '../lib/portalAuth.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyOwnerAdminCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  let db
  try { db = getServiceDb() } catch { return res.status(500).json({ error: 'internal_error' }) }

  const [studentResult, cohortResult, unitResult, schoolResult] = await Promise.all([
    db.from('students').select('id, cohort_id, first_name, preferred_first_name, last_name, school, status'),
    db.from('cohorts').select('id, name'),
    db.from('units').select('unit_name').not('unit_name', 'is', null),
    db.from('schools').select('canonical_name, is_active').eq('is_active', true),
  ])
  if (studentResult.error || cohortResult.error || unitResult.error || schoolResult.error) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const cohorts = Object.fromEntries((cohortResult.data || []).map(row => [row.id, row.name]))
  const students = (studentResult.data || [])
    .map(student => ({
      id: student.id,
      label: `${student.preferred_first_name || student.first_name || ''} ${student.last_name || ''}`.trim() || 'Unnamed student',
      school: student.school || null,
      cohort: cohorts[student.cohort_id] || null,
      status: student.status || null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const unitKeys = [...new Set((unitResult.data || []).map(row => String(row.unit_name || '').trim()).filter(Boolean))].sort()
  const schoolKeys = [...new Set((schoolResult.data || []).map(row => String(row.canonical_name || '').trim()).filter(Boolean))].sort()

  return res.status(200).json({ students, unit_keys: unitKeys, school_keys: schoolKeys })
}
