import { createClient } from '@supabase/supabase-js'
import { normalizeEmailForLookup, escapeLikePattern } from '../src/lib/emailUtils.js'

const ELIGIBLE_STATUSES = new Set([
  'Form Received', 'Interview Scheduled', 'Interviewed',
  'Placed', 'Active Rotation', 'Completed',
])

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

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
  const { email } = req.body || {}

  if (!email?.trim()) return res.status(400).json({ error: 'Email is required' })

  try {
    // 1. Active cohort
    const { data: cohort } = await db.from('cohorts')
      .select('id, name').eq('accepting_submissions', true).limit(1).maybeSingle()
    if (!cohort) return res.status(400).json({ error: 'Scheduling is not currently open. Please contact the ASPIRE team.' })

    // 2. Student by school_email - forgiving match (case/whitespace/zero-width),
    //    escaped ilike (no % / _ wildcard broadening), JS normalized-equality confirm.
    const cleanEmail = normalizeEmailForLookup(email)
    const { data: candidates } = await db.from('students')
      .select('*').eq('cohort_id', cohort.id).ilike('school_email', escapeLikePattern(cleanEmail)).limit(5)
    const student = (candidates || []).find(s => normalizeEmailForLookup(s.school_email) === cleanEmail) || null
    if (!student) return res.status(404).json({ error: 'We could not find your information. Please confirm your school email address or contact the ASPIRE team.' })

    // 3. Eligibility check
    if (!ELIGIBLE_STATUSES.has(student.status)) {
      return res.status(403).json({ error: 'You are not yet eligible to schedule an interview. Please complete the ASPIRE Student Profile first.' })
    }

    // 4. Existing booking check
    const { data: existingSlot } = await db.from('interview_slots')
      .select('id, slot_date, slot_time, interviewer_name, duration_minutes')
      .eq('booked_by_student_id', student.id)
      .eq('is_booked', true)
      .maybeSingle()

    if (existingSlot) {
      return res.status(200).json({ hasExistingBooking: true, student, booking: existingSlot })
    }

    // 5. Available slots
    const now = fmtLocalDate(new Date())
    const { data: slots } = await db.from('interview_slots')
      .select('*')
      .eq('cohort_id', cohort.id)
      .eq('is_booked', false)
      .gte('slot_date', now)
      .order('slot_date')
      .order('slot_time')

    if (!slots || slots.length === 0) {
      return res.status(200).json({ noSlots: true, student })
    }

    return res.status(200).json({ student, cohortId: cohort.id, slots })

  } catch (err) {
    console.error('interview-lookup error:', err)
    return res.status(500).json({ error: err.message })
  }
}
