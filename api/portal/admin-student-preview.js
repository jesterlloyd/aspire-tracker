// Read-only Student Portal projection for an Owner/Admin-selected student.
// The staff JWT and role are verified on every request; student_id chooses the
// preview record but grants no authority to a non-staff caller.

import { getServiceDb, verifyOwnerAdminCaller } from '../lib/portalAuth.js'
import { buildStudentPortalSummary } from '../lib/studentPortalSummary.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyOwnerAdminCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
  const studentId = typeof req.query?.student_id === 'string' ? req.query.student_id.trim() : ''
  if (!UUID.test(studentId)) return res.status(400).json({ error: 'invalid_student_id' })

  let db
  try { db = getServiceDb() } catch { return res.status(500).json({ error: 'internal_error' }) }

  try {
    const summary = await buildStudentPortalSummary(db, [studentId])
    if (!summary.students.length) return res.status(404).json({ error: 'not_found' })

    const [logsResult, evalsResult, certsResult] = await Promise.all([
      db.from('student_shift_logs').select([
        'id', 'student_id', 'cohort_id', 'shift_date', 'total_hours', 'unit_name',
        'is_assigned_unit', 'preceptor_name', 'is_assigned_preceptor', 'shift_type',
        'learning_highlight', 'support_needed', 'status', 'submitted_at', 'reviewed_at',
        'lifecycle_state', 'unit_override_reason', 'preceptor_override_note',
      ].join(', ')).eq('student_id', studentId).order('shift_date', { ascending: false }),
      db.from('evaluation_assignments').select(`
        id, student_id, cohort_id, timepoint, status, sent_at, opened_at,
        completed_at, expires_at, evaluation_instruments!inner ( slug, display_name )
      `).eq('student_id', studentId).eq('respondent_type', 'student').order('sent_at', { ascending: false }),
      db.from('certificates').select([
        'id', 'student_id', 'certificate_number', 'certificate_year',
        'post_rotation_evaluation_completed_at', 'certificate_unlocked_at',
      ].join(', ')).eq('student_id', studentId),
    ])
    if (logsResult.error || evalsResult.error || certsResult.error) throw new Error('preview_lookup_failed')

    const evaluations = (evalsResult.data || []).map(row => ({
      id: row.id,
      student_id: row.student_id,
      cohort_id: row.cohort_id,
      timepoint: row.timepoint,
      status: row.status,
      sent_at: row.sent_at,
      opened_at: row.opened_at,
      completed_at: row.completed_at,
      expires_at: row.expires_at,
      instrument_slug: row.evaluation_instruments?.slug || null,
      instrument_title: row.evaluation_instruments?.display_name || null,
    }))

    return res.status(200).json({
      summary,
      shift_logs: logsResult.data || [],
      evaluations,
      certificates: certsResult.data || [],
      read_only: true,
    })
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
}
