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
  const { studentId, cohortId, slotId } = req.body || {}

  if (!studentId || !cohortId || !slotId) {
    return res.status(400).json({ error: 'studentId, cohortId, and slotId are required' })
  }

  try {
    const now = new Date().toISOString()

    // 1. Mark slot as booked (also sets status column if it exists post-migration)
    const { data: slot, error: slotError } = await db.from('interview_slots')
      .update({ is_booked: true, booked_by_student_id: studentId, booked_at: now, status: 'booked' })
      .eq('id', slotId)
      .eq('is_booked', false) // prevent double-booking
      .select()
      .single()

    if (slotError || !slot) {
      return res.status(400).json({ error: slotError?.message || 'Slot is no longer available. Please select another time.' })
    }

    // 2. Create or update interview_session
    const { data: existingSession, error: lookupError } = await db.from('interview_sessions')
      .select('id').eq('student_id', studentId).eq('cohort_id', cohortId).limit(1).maybeSingle()

    if (lookupError) {
      console.error('[interview-book] session lookup failed:', lookupError.message)
      // Non-fatal — continue with insert
    }

    if (existingSession) {
      const { error: updateError } = await db.from('interview_sessions')
        .update({ self_scheduled: true, slot_id: slotId })
        .eq('id', existingSession.id)
      if (updateError) console.error('[interview-book] session update failed (non-fatal):', updateError.message)
    } else {
      const { error: insertError } = await db.from('interview_sessions').insert({
        student_id: studentId, cohort_id: cohortId,
        self_scheduled: true, slot_id: slotId, session_number: 1,
      })
      if (insertError) console.error('[interview-book] session insert failed (non-fatal):', insertError.message)
    }

    // 3. Update student record
    const { error: studentError } = await db.from('students').update({
      interview_scheduled_date:   slot.slot_date,
      interview_scheduled_time:   slot.slot_time,
      interview_duration_minutes: slot.duration_minutes,
      status:                     'Interview Scheduled',
      scheduling_viewed_at:       now,
    }).eq('id', studentId)

    if (studentError) console.error('[interview-book] student update error:', studentError.message)

    // 4. Log to program_events — non-fatal; use destructured await, NOT .catch()
    const { error: eventError } = await db.from('program_events').insert({
      student_id: studentId,
      cohort_id:  cohortId,
      event_type: 'interview_booked',
      event_date: slot.slot_date,
      notes:      `Interview self-scheduled for ${slot.slot_date} at ${slot.slot_time}`,
      created_by: 'system',
      event_data: {
        slot_id:          slotId,
        slot_date:        slot.slot_date,
        slot_time:        slot.slot_time,
        duration_minutes: slot.duration_minutes,
        interviewer_name: slot.interviewer_name,
      },
    })
    if (eventError) console.warn('[interview-book] program_events log failed (non-blocking):', eventError.message)

    // 5. Fetch interviewer email for notification
    let interviewerEmail = null
    if (slot.interviewer_name?.trim()) {
      const { data: iv } = await db.from('user_profiles')
        .select('email').ilike('full_name', slot.interviewer_name.trim())
        .eq('can_conduct_interviews', true).limit(1).maybeSingle()
      interviewerEmail = iv?.email?.trim() || null
    }

    return res.status(200).json({ success: true, slot, interviewerEmail })

  } catch (err) {
    console.error('[interview-book] unhandled error:', err)
    return res.status(500).json({ error: err.message })
  }
}
