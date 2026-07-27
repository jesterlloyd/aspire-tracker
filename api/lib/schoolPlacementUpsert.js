// api/lib/schoolPlacementUpsert.js
//
// CANONICAL server write for a school placement request, shared so the public /school-form endpoint
// (api/school-form-submit.js) and the authenticated Academic Partner endpoint
// (api/portal/school-placement-requests.js) can never drift. Mirrors api/lib/unitResponseUpsert.js.
//
// It performs the two-part write a placement request IS: (1) upsert the coordinator-owned
// cohort_school_rotations row for (cohort, school) with the sanitized school-wide availability, then
// (2) duplicate-safe insert/update of each students row linked to that rotation. On a duplicate
// (matched by NORMALIZED school_email) it updates ONLY coordinator-owned seed fields and never
// student-owned or ASPIRE/admin-owned fields, and it preserves an existing submitted_via (so a
// 'student_form' record is not relabeled). It logs one rotation_created program_event for the first
// new student. Notifications and the accepting-submissions check stay with the caller.
//
// PROVENANCE: `submittedVia` records the origin on new rows ('school_form' for the public form,
// 'academic_partner_portal' for the authenticated portal). Recording WHICH authenticated profile
// submitted a request needs a students.submitting_profile_id column that does not exist yet; this
// helper deliberately does NOT invent a hidden field for it. The authenticated caller must gate
// submission until that column exists (see the endpoint), so full provenance is never silently
// dropped.

import { normalizeEmailForLookup } from '../../src/lib/emailUtils.js'
import { sanitizeWeekdays, sanitizeIsoDates, coerceBoolOrNull, coerceMinDaysOrNull } from '../../src/lib/availability.js'

// Sanitize coordinator-owned, school-wide availability to canonical encodings (weekdays Mon-Sun, ISO
// dates). Invalid entries are dropped, never rejected, so a submission never hard-fails on them.
export function sanitizeAvailabilityCols(availability) {
  const av = (availability && typeof availability === 'object' && !Array.isArray(availability)) ? availability : {}
  return {
    unavailable_weekdays: sanitizeWeekdays(av.unavailable_weekdays),
    min_days_per_week:    coerceMinDaysOrNull(av.min_days_per_week),
    weekends_allowed:     coerceBoolOrNull(av.weekends_allowed),
    nights_allowed:       coerceBoolOrNull(av.nights_allowed),
    blackout_dates:       sanitizeIsoDates(av.blackout_dates),
    scheduling_notes:     (typeof av.scheduling_notes === 'string' ? av.scheduling_notes.trim().slice(0, 2000) : '') || null,
  }
}

/**
 * Perform the canonical placement-request write. Assumes inputs are already validated (the shared
 * client validation and the endpoint both run first). Returns
 *   { error: string | null, added: [{name,id,email}], updated: [...], skipped: [name], rotationId }
 * where `error` is a human-readable failure message (the caller maps it to a 500). `added` are the
 * newly inserted students the caller should notify.
 */
export async function performSchoolPlacementUpsert(db, {
  cohortId, cohortName, coordinator, rotationStartDate, rotationEndDate, availability, students = [],
  submittedVia = 'school_form',
}) {
  const availabilityCols = sanitizeAvailabilityCols(availability)

  // (1) Upsert the rotation row for this school + cohort.
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
        ...availabilityCols,
        updated_at:          new Date().toISOString(),
      },
      { onConflict: 'cohort_id,school_name' },
    )
    .select('id').single()
  if (rotErr) {
    console.error('[schoolPlacementUpsert] rotation upsert error:', rotErr)
    return { error: 'Failed to save rotation dates.', added: [], updated: [], skipped: [], rotationId: null }
  }
  const rotationId = rotationRow.id

  const added = []
  const updated = []
  const skipped = []

  // Fetch the cohort's existing students once and index by NORMALIZED school_email (case /
  // whitespace / zero-width insensitive), so a re-submit with different casing updates in place.
  const { data: cohortStudents, error: rosterErr } = await db
    .from('students')
    .select('id, school_email, submitted_via')
    .eq('cohort_id', cohortId)
  if (rosterErr) {
    console.error('[schoolPlacementUpsert] roster fetch error:', rosterErr)
    return { error: 'Failed to load existing students for matching.', added, updated, skipped, rotationId }
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
      skipped.push(`${firstName} ${lastName}`.trim() || '(incomplete row)')
      continue
    }
    const fullName = `${firstName} ${lastName}`

    const existing = existingByEmail.get(normEmail)
    if (existing) {
      // UPDATE only coordinator-owned seed fields. NEVER student-owned (personal_email, phone,
      // date_of_birth, resume_url, headshot_url, interest_statement, unit_preference_*) or
      // ASPIRE/admin-owned (status, interview_outcome, ngrp_outcome, disposition, matched_unit_id,
      // preceptor_id, CS-Link/badge, notes). Preserve any existing submitted_via.
      const updatePayload = {
        first_name:                firstName,
        last_name:                 lastName,
        name:                      fullName,
        school_email:              normEmail,
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
        ...(existing.submitted_via ? {} : { submitted_via: submittedVia }),
      }
      const { error: updErr } = await db.from('students').update(updatePayload).eq('id', existing.id)
      if (updErr) {
        console.error('[schoolPlacementUpsert] student update error:', updErr)
        return { error: `Failed to update student ${fullName}.`, added, updated, skipped, rotationId }
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
        estimated_graduation_date:  s.estimated_graduation_date || null,
        estimated_graduation:       s.estimated_graduation_date || '',
        status:                     'Pending Outreach',
        interview_outcome:          'Pending Interview',
        ngrp_outcome:               'Pending',
        submitted_via:              submittedVia,
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
      console.error('[schoolPlacementUpsert] student insert error:', insertErr)
      return { error: `Failed to add student ${fullName}.`, added, updated, skipped, rotationId }
    }

    // Index the new row so a duplicate email within THIS same submission updates, not re-inserts.
    existingByEmail.set(normEmail, { id: newStudent.id, school_email: normEmail, submitted_via: submittedVia })
    added.push({ name: fullName, id: newStudent.id, email: normEmail })
  }

  // Log one rotation_created event for the first new student.
  if (added.length > 0) {
    const { error: evLogErr } = await db.from('program_events').insert({
      student_id:  added[0].id,
      cohort_id:   cohortId,
      event_type:  'rotation_created',
      event_date:  new Date().toISOString().split('T')[0],
      notes:       `[Auto-logged] Rotation row created/updated for ${coordinator.school.trim()}. Dates: ${rotationStartDate} to ${rotationEndDate}.`,
      created_by:  'system',
    })
    if (evLogErr) console.warn('[schoolPlacementUpsert] program_events log error:', evLogErr.message)
  }

  return { error: null, added, updated, skipped, rotationId }
}
