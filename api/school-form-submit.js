// api/school-form-submit.js
// Handles ASPIRE school coordinator form submissions.
// Replaces the previous direct-Supabase approach in SchoolFormPage.jsx.
//
// Responsibilities:
//   1. Upsert cohort_school_rotations row for (cohort, school) pair.
//   2. Insert each student, linking to the rotation row.
//   3. Log rotation_created event for the first new student added.
//   4. Fire form_received notifications (fire-and-forget).
//
// No auth required: this endpoint is called from a public-facing form that is
// password-gated at the client. The cohort accepting_submissions check
// prevents spoofed submissions against closed cohorts.

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const {
    cohortId, cohortName,
    coordinator,
    rotationStartDate, rotationEndDate,
    students = [],
  } = req.body || {}

  // Required field validation
  if (!cohortId) return res.status(400).json({ error: 'cohortId is required' })
  if (!coordinator?.school?.trim()) return res.status(400).json({ error: 'School name is required' })
  if (!coordinator?.name?.trim() || !coordinator?.email?.trim())
    return res.status(400).json({ error: 'Coordinator name and email are required' })
  if (!rotationStartDate || !rotationEndDate)
    return res.status(400).json({ error: 'Rotation start and end dates are required' })
  if (rotationEndDate <= rotationStartDate)
    return res.status(400).json({ error: 'Rotation end date must be after start date' })
  if (!students.length) return res.status(400).json({ error: 'At least one student is required' })

  const db = getDb()

  // Verify cohort is still accepting submissions
  const { data: cohort } = await db
    .from('cohorts').select('id, name, accepting_submissions')
    .eq('id', cohortId).single()
  if (!cohort?.accepting_submissions)
    return res.status(400).json({ error: 'This cohort is not currently accepting submissions.' })

  // Upsert rotation row for this school + cohort
  const { data: rotationRow, error: rotErr } = await db
    .from('cohort_school_rotations')
    .upsert(
      {
        cohort_id:           cohortId,
        school_name:         coordinator.school.trim(),
        rotation_start_date: rotationStartDate,
        rotation_end_date:   rotationEndDate,
        coordinator_name:    coordinator.name.trim(),
        coordinator_email:   coordinator.email.trim(),
        updated_at:          new Date().toISOString(),
      },
      { onConflict: 'cohort_id,school_name' }
    )
    .select('id').single()

  if (rotErr) {
    console.error('[school-form-submit] rotation upsert error:', rotErr)
    return res.status(500).json({ error: 'Failed to save rotation dates.' })
  }

  const rotationId = rotationRow.id
  const added   = []
  const skipped = []

  for (const s of students) {
    const schoolEmail = (s.email || '').trim()
    if (!s.first_name?.trim() || !s.last_name?.trim() || !schoolEmail) {
      console.warn('[school-form-submit] skipping incomplete student row')
      continue
    }

    // Duplicate check: same school_email in this cohort
    const { data: existing } = await db
      .from('students').select('id')
      .eq('cohort_id', cohortId).eq('school_email', schoolEmail)
      .limit(1).maybeSingle()

    if (existing) {
      skipped.push(`${s.first_name.trim()} ${s.last_name.trim()}`)
      continue
    }

    const { data: newStudent, error: insertErr } = await db
      .from('students').insert({
        name:                       `${s.first_name.trim()} ${s.last_name.trim()}`,
        first_name:                 s.first_name.trim(),
        last_name:                  s.last_name.trim(),
        school_email:               schoolEmail,
        phone:                      (s.phone || '').trim(),
        school:                     coordinator.school.trim(),
        program_type:               s.program_type || '',
        hours_required:             parseInt(s.hours_required) || 0,
        hours_completed:            0,
        // estimated_graduation_date is the new date-typed column
        estimated_graduation_date:  s.estimated_graduation_date || null,
        // Preserve the legacy text column for backward compatibility
        estimated_graduation:       s.estimated_graduation_date || '',
        status:                     'Pending Outreach',
        interview_outcome:          'Pending Interview',
        ngrp_outcome:               'Pending',
        submitted_via:              'school_form',
        school_coordinator_name:    coordinator.name.trim(),
        school_coordinator_email:   coordinator.email.trim(),
        aspire_cohort:              cohortName || '',
        gpa_verified:               false,
        bls_current:                false,
        health_cleared:             false,
        background_check:           false,
        coordinators:               (coordinator.notes || '').trim(),
        cohort_id:                  cohortId,
        cohort_school_rotation_id:  rotationId,
      }).select('id').single()

    if (insertErr) {
      console.error('[school-form-submit] student insert error:', insertErr)
      return res.status(500).json({ error: `Failed to add student ${s.first_name} ${s.last_name}.` })
    }

    added.push({ name: `${s.first_name.trim()} ${s.last_name.trim()}`, id: newStudent.id, email: schoolEmail })
  }

  // Log rotation_created event for the first new student
  if (added.length > 0) {
    const { error: evLogErr } = await db.from('program_events').insert({
      student_id:  added[0].id,
      cohort_id:   cohortId,
      event_type:  'rotation_created',
      event_date:  new Date().toISOString().split('T')[0],
      notes:       `[Auto-logged] Rotation row created/updated for ${coordinator.school.trim()}. Dates: ${rotationStartDate} to ${rotationEndDate}.`,
      created_by:  'system',
    })
    if (evLogErr) console.warn('[school-form-submit] program_events log error:', evLogErr.message)
  }

  // Fire-and-forget: form_received notifications for each new student
  const baseUrl = process.env.VITE_APP_URL || 'https://aspire-tracker.vercel.app'
  for (const s of added) {
    fetch(`${baseUrl}/api/form-received-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId:        s.id,
        cohortId,
        studentName:      s.name,
        studentFirstName: s.name.split(' ')[0],
        studentEmail:     s.email,
        school:           coordinator.school.trim(),
      }),
    }).catch(e => console.warn('[school-form-submit] notification failed:', e.message))
  }

  return res.status(200).json({
    success: true,
    added:   added.map(s => s.name),
    skipped,
    rotationId,
  })
}
