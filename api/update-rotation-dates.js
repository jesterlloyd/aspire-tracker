// api/update-rotation-dates.js
// Admin override: update rotation_start_date and rotation_end_date on a
// cohort_school_rotations row. Owner and admin only.
//
// POST body: { rotation_id, rotation_start_date, rotation_end_date }
// Returns:   { success, affected_student_count, rotation_id }

import { createClient } from '@supabase/supabase-js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const adminToken = req.headers['x-admin-token']
  if (!process.env.ADMIN_NOTIFICATION_TOKEN || adminToken !== process.env.ADMIN_NOTIFICATION_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { rotation_id, rotation_start_date, rotation_end_date } = req.body || {}

  if (!rotation_id) return res.status(400).json({ error: 'rotation_id is required' })
  if (!rotation_start_date || !rotation_end_date)
    return res.status(400).json({ error: 'Both rotation_start_date and rotation_end_date are required' })
  if (rotation_end_date <= rotation_start_date)
    return res.status(400).json({ error: 'End date must be after start date' })

  const db = getDb()

  // Fetch the current row (to get old dates and school_name for logging)
  const { data: current, error: fetchErr } = await db
    .from('cohort_school_rotations')
    .select('id, school_name, cohort_id, rotation_start_date, rotation_end_date')
    .eq('id', rotation_id)
    .single()

  if (fetchErr || !current) {
    return res.status(404).json({ error: 'Rotation row not found' })
  }

  // Count affected students
  const { count: affected } = await db
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('cohort_school_rotation_id', rotation_id)

  const affectedCount = affected ?? 0

  // Update the rotation row
  const { error: updateErr } = await db
    .from('cohort_school_rotations')
    .update({
      rotation_start_date,
      rotation_end_date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rotation_id)

  if (updateErr) {
    console.error('[update-rotation-dates] update error:', updateErr)
    return res.status(500).json({ error: 'Failed to update rotation dates.' })
  }

  // Log rotation_updated event for each affected student
  if (affectedCount > 0) {
    const { data: affectedStudents } = await db
      .from('students')
      .select('id, cohort_id')
      .eq('cohort_school_rotation_id', rotation_id)

    const today = new Date().toISOString().split('T')[0]
    const notes = `[Auto-logged] Rotation dates updated for ${current.school_name}. ` +
      `Old: ${current.rotation_start_date} to ${current.rotation_end_date}. ` +
      `New: ${rotation_start_date} to ${rotation_end_date}. ` +
      `${affectedCount} student(s) affected.`

    const events = (affectedStudents || []).map(s => ({
      student_id:  s.id,
      cohort_id:   s.cohort_id,
      event_type:  'rotation_updated',
      event_date:  today,
      notes,
      created_by:  'system',
    }))

    if (events.length) {
      await db.from('program_events').insert(events)
        .catch(e => console.warn('[update-rotation-dates] program_events log failed:', e.message))
    }
  }

  return res.status(200).json({
    success:                true,
    rotation_id,
    affected_student_count: affectedCount,
  })
}
