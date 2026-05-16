import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const db = createClient(supabaseUrl, serviceKey)
  const { action, ...payload } = req.body || {}

  try {

    // CREATE BLOCK + GENERATE SLOTS
    if (action === 'create_block') {
      const {
        cohort_id, interviewer_name, block_date,
        start_time, end_time, duration_minutes,
        created_by_user_id,
      } = payload

      if (!cohort_id || !block_date || !start_time || !end_time || !duration_minutes) {
        return res.status(400).json({ error: 'Missing required fields' })
      }
      // interviewer_name must be a real person — never fall back to a generic label
      if (!interviewer_name?.trim()) {
        return res.status(400).json({ error: 'interviewer_name is required. Blocks must be attributed to a specific interviewer.' })
      }

      const { data: block, error: blockError } = await db
        .from('interview_availability_blocks')
        .insert({
          cohort_id,
          interviewer_name: interviewer_name.trim(),
          block_date,
          start_time,
          end_time,
          duration_minutes: parseInt(duration_minutes),
          is_active: true,
          created_by_user_id: created_by_user_id || null,
        })
        .select('id, cohort_id, interviewer_name, block_date, start_time, end_time, duration_minutes')
        .single()

      if (blockError) return res.status(400).json({ error: blockError.message })

      // Generate time slots
      const slots = []
      const [startH, startM] = start_time.split(':').map(Number)
      const [endH,   endM  ] = end_time.split(':').map(Number)
      const startTotal = startH * 60 + startM
      const endTotal   = endH   * 60 + endM
      const dur        = parseInt(duration_minutes)

      for (let t = startTotal; t + dur <= endTotal; t += dur) {
        const h = Math.floor(t / 60).toString().padStart(2, '0')
        const m = (t % 60).toString().padStart(2, '0')
        slots.push({
          block_id:         block.id,
          cohort_id,
          slot_date:        block_date,
          slot_time:        `${h}:${m}`,
          duration_minutes: dur,
          interviewer_name: interviewer_name.trim(),
          is_booked:        false,
        })
      }

      if (slots.length === 0) {
        return res.status(400).json({
          error: 'No slots generated. Check that end time is after start time and duration fits within the block.',
        })
      }

      const { data: createdSlots, error: slotsError } = await db
        .from('interview_slots')
        .insert(slots)
        .select('id, slot_date, slot_time, duration_minutes, interviewer_name, is_booked')

      if (slotsError) {
        await db.from('interview_availability_blocks').delete().eq('id', block.id)
        return res.status(400).json({ error: `Slot generation failed: ${slotsError.message}` })
      }

      return res.status(200).json({
        success: true,
        block,
        slots: createdSlots,
        slot_count: createdSlots.length,
      })
    }

    // DELETE BLOCK + ITS SLOTS
    if (action === 'delete_block') {
      const { block_id } = payload

      // Strict validation — never delete without a valid UUID
      if (!block_id || typeof block_id !== 'string' || block_id.length < 10) {
        console.error('delete_block called with invalid block_id:', block_id)
        return res.status(400).json({ error: 'Invalid block_id. Delete aborted.' })
      }

      console.log('Deleting block:', block_id)

      // Delete only unbooked slots for this specific block
      const { error: slotsError } = await db
        .from('interview_slots')
        .delete()
        .eq('block_id', block_id)
        .eq('is_booked', false)

      if (slotsError) {
        console.error('Slot delete error:', slotsError.message)
        return res.status(400).json({ error: slotsError.message })
      }

      // Check for remaining booked slots
      const { count } = await db
        .from('interview_slots')
        .select('*', { count: 'exact', head: true })
        .eq('block_id', block_id)
        .eq('is_booked', true)

      if ((count || 0) > 0) {
        return res.status(400).json({
          error: `Cannot delete: ${count} booked slot${count !== 1 ? 's' : ''} in this block. Cancel those bookings first.`,
        })
      }

      // Delete the block itself
      const { error: blockError } = await db
        .from('interview_availability_blocks')
        .delete()
        .eq('id', block_id)

      if (blockError) return res.status(400).json({ error: blockError.message })
      return res.status(200).json({ success: true })
    }

    // CANCEL BOOKING
    if (action === 'cancel_booking') {
      const { slot_id, student_id, cohort_id: cid, cancelled_by } = payload

      if (!slot_id || !student_id) {
        return res.status(400).json({ error: 'slot_id and student_id are required' })
      }

      console.log('Cancelling booking:', { slot_id, student_id })

      // 1. Clear the slot
      const { error: slotError } = await db
        .from('interview_slots')
        .update({ is_booked: false, booked_by_student_id: null, booked_at: null })
        .eq('id', slot_id)
        .eq('booked_by_student_id', student_id)

      if (slotError) {
        console.error('Slot clear error:', slotError.message)
        return res.status(400).json({ error: slotError.message })
      }

      // 2. Delete sessions for this slot with no rubric data
      const { data: sessions } = await db
        .from('interview_sessions')
        .select('id, cj_question_text, pp_question_text, ga_question_text')
        .eq('slot_id', slot_id)

      if (sessions?.length > 0) {
        for (const sess of sessions) {
          const hasRubric = sess.cj_question_text || sess.pp_question_text || sess.ga_question_text
          if (!hasRubric) await db.from('interview_sessions').delete().eq('id', sess.id)
        }
      }

      // 3. Delete orphaned sessions linked by student_id with no rubric data
      const { data: studentSessions } = await db
        .from('interview_sessions')
        .select('id, cj_question_text, pp_question_text, ga_question_text')
        .eq('student_id', student_id)

      if (studentSessions?.length > 0) {
        for (const sess of studentSessions) {
          const hasRubric = sess.cj_question_text || sess.pp_question_text || sess.ga_question_text
          if (!hasRubric) await db.from('interview_sessions').delete().eq('id', sess.id)
        }
      }

      // 4. Revert student status and clear scheduled date/time fields
      const { error: studentError } = await db
        .from('students')
        .update({
          status:                   'Form Received',
          interview_scheduled_date: null,
          interview_scheduled_time: null,
        })
        .eq('id', student_id)

      if (studentError) console.error('Student status revert error:', studentError.message)

      // 5. Log event
      if (cid) {
        const { error: logErr } = await db.from('program_events').insert({
          student_id:  student_id,
          cohort_id:   cid,
          event_type:  'interview_cancelled',
          event_date:  new Date().toISOString().split('T')[0],
          notes:       'Interview booking cancelled.',
          created_by:  cancelled_by || 'System',
        })
        if (logErr) console.warn('Event log error:', logErr.message)
      }

      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('availability error:', err)
    return res.status(500).json({ error: err.message })
  }
}
