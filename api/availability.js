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

      const { data: block, error: blockError } = await db
        .from('interview_availability_blocks')
        .insert({
          cohort_id,
          interviewer_name: interviewer_name || 'ASPIRE Team',
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
          interviewer_name: interviewer_name || 'ASPIRE Team',
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

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('availability error:', err)
    return res.status(500).json({ error: err.message })
  }
}
