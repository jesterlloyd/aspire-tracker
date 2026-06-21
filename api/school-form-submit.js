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
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js'
import { sanitizeWeekdays, sanitizeIsoDates, coerceBoolOrNull, coerceMinDaysOrNull } from '../src/lib/availability.js'

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
    availability,
    students = [],
  } = req.body || {}

  // AVAILABILITY-CANON-1B: coordinator-owned, school-wide availability constraints. Sanitized to
  // canonical encodings (weekdays Mon–Sun, ISO dates) and written ONLY to cohort_school_rotations.
  // Invalid weekday/date entries are dropped (not rejected) so a submission never hard-fails on them.
  const av = (availability && typeof availability === 'object' && !Array.isArray(availability)) ? availability : {}
  const availabilityCols = {
    unavailable_weekdays: sanitizeWeekdays(av.unavailable_weekdays),
    min_days_per_week:    coerceMinDaysOrNull(av.min_days_per_week),
    weekends_allowed:     coerceBoolOrNull(av.weekends_allowed),
    nights_allowed:       coerceBoolOrNull(av.nights_allowed),
    blackout_dates:       sanitizeIsoDates(av.blackout_dates),
    scheduling_notes:     (typeof av.scheduling_notes === 'string' ? av.scheduling_notes.trim().slice(0, 2000) : '') || null,
  }

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
        // AVAILABILITY-CANON-1B: coordinator-owned availability (school-wide), upserted alongside dates.
        ...availabilityCols,
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
  const updated = []
  const skipped = []

  // STUDENT-PROFILE-CANON-1G: case/whitespace/zero-width-insensitive matching. Fetch the cohort's
  // existing students once and index by NORMALIZED school_email. The prior dedup used a
  // case-sensitive .eq(school_email), so a coordinator re-submit with different casing/whitespace
  // (e.g. ivan.cruz01@… vs Ivan.Cruz01@…) could fail to match and create a duplicate. lower(trim())
  // is not expressible as a Supabase filter, so the comparison is done in JS (mirrors /student-form).
  const { data: cohortStudents, error: rosterErr } = await db
    .from('students')
    .select('id, school_email, submitted_via')
    .eq('cohort_id', cohortId)
  if (rosterErr) {
    console.error('[school-form-submit] roster fetch error:', rosterErr)
    return res.status(500).json({ error: 'Failed to load existing students for matching.' })
  }
  const existingByEmail = new Map()
  for (const st of (cohortStudents || [])) {
    const key = normalizeEmailForLookup(st.school_email)
    if (key && !existingByEmail.has(key)) existingByEmail.set(key, st)
  }

  for (const s of students) {
    const firstName = (s.first_name || '').trim()
    const lastName  = (s.last_name || '').trim()
    const normEmail = normalizeEmailForLookup(s.email)
    if (!firstName || !lastName || !normEmail) {
      console.warn('[school-form-submit] skipping incomplete student row')
      skipped.push(`${firstName} ${lastName}`.trim() || '(incomplete row)')
      continue
    }
    const fullName = `${firstName} ${lastName}`

    const existing = existingByEmail.get(normEmail)
    if (existing) {
      // Existing student matched case-insensitively → UPDATE only coordinator-owned seed fields.
      // NEVER touch student-owned (personal_email, phone, date_of_birth, resume_url, headshot_url,
      // prior_healthcare_experience, interest_statement, unit_preference_*) or ASPIRE/admin-owned
      // (status, interview_outcome, ngrp_outcome, disposition, matched_unit_id, matched_preceptor,
      // preceptor_id, shift_assigned, CS-Link/badge, notes). Preserve submitted_via='student_form'.
      const updatePayload = {
        first_name:                firstName,
        last_name:                 lastName,
        name:                      fullName,
        school_email:              normEmail,                // normalize stored value (same address)
        school:                    coordinator.school.trim(),
        program_type:              s.program_type || '',
        hours_required:            parseInt(s.hours_required) || 0,
        estimated_graduation_date: s.estimated_graduation_date || null,
        estimated_graduation:      s.estimated_graduation_date || '',
        school_coordinator_name:   coordinator.name.trim(),
        school_coordinator_email:  coordinator.email.trim(),
        coordinators:              (coordinator.notes || '').trim(),
        aspire_cohort:             cohortName || '',
        cohort_school_rotation_id: rotationId,
        // submitted_via: preserve any existing value (especially 'student_form'); set only when null.
        ...(existing.submitted_via ? {} : { submitted_via: 'school_form' }),
      }
      const { error: updErr } = await db.from('students').update(updatePayload).eq('id', existing.id)
      if (updErr) {
        console.error('[school-form-submit] student update error:', updErr)
        return res.status(500).json({ error: `Failed to update student ${fullName}.` })
      }
      updated.push({ name: fullName, id: existing.id, email: normEmail })
      continue
    }

    const { data: newStudent, error: insertErr } = await db
      .from('students').insert({
        name:                       fullName,
        first_name:                 firstName,
        last_name:                  lastName,
        school_email:               normEmail,
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
      return res.status(500).json({ error: `Failed to add student ${fullName}.` })
    }

    // Index the new row so a duplicate email within THIS same submission updates, not re-inserts.
    existingByEmail.set(normEmail, { id: newStudent.id, school_email: normEmail, submitted_via: 'school_form' })
    added.push({ name: fullName, id: newStudent.id, email: normEmail })
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
    updated: updated.map(s => s.name),
    skipped,
    rotationId,
  })
}
