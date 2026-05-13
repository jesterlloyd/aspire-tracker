import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server configuration error' })

  const db = createClient(supabaseUrl, serviceKey)
  const { action, ...payload } = req.body || {}

  try {
    if (action === 'update') {
      const { student_id, fields } = payload
      if (!student_id) return res.status(400).json({ error: 'student_id is required' })
      if (!fields || Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' })

      const allowed = [
        'first_name', 'last_name', 'name', 'email', 'school_email', 'personal_email',
        'phone', 'school', 'program', 'program_type', 'cohort_id',
        'cumulative_gpa', 'expected_graduation', 'status',
        'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
        'notes', 'decline_reason', 'badge_created',
        'cs_stage1_submitted', 'cs_link_complete',
        'approved_hours', 'hours_required', 'pending_hours',
        'matched_unit_id', 'preceptor_id',
        'orientation_sent_at', 'interview_preference',
        'interview_scheduled_date', 'interview_scheduled_time',
        'interview_duration_minutes', 'interview_assigned_interviewers',
        'flagged_for_second_interview', 'auto_recommendation',
        'resume_url', 'headshot_url', 'scheduling_viewed_at',
      ]

      const safeFields = {}
      Object.keys(fields).forEach(key => { if (allowed.includes(key)) safeFields[key] = fields[key] })
      if (Object.keys(safeFields).length === 0) return res.status(400).json({ error: 'No valid fields to update' })

      const { data, error } = await db.from('students').update(safeFields).eq('id', student_id).select().single()
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true, data })
    }

    if (action === 'update_status') {
      const { student_id, status, decline_reason } = payload
      if (!student_id || !status) return res.status(400).json({ error: 'student_id and status are required' })
      const updateFields = { status }
      if (decline_reason !== undefined) updateFields.decline_reason = decline_reason
      const { data, error } = await db.from('students').update(updateFields).eq('id', student_id).select().single()
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true, data })
    }

    if (action === 'log_event') {
      const { student_id, cohort_id, event_type, notes, created_by } = payload
      if (!student_id || !event_type) return res.status(400).json({ error: 'student_id and event_type are required' })
      const { error } = await db.from('program_events').insert({
        student_id, cohort_id: cohort_id || null, event_type,
        event_date: new Date().toISOString().split('T')[0],
        notes: notes || '', created_by: created_by || 'System',
      })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('student-update error:', err)
    return res.status(500).json({ error: err.message })
  }
}
