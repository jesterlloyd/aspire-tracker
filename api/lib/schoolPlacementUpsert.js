// api/lib/schoolPlacementUpsert.js
//
// CANONICAL server write for a school placement request, shared so the public /school-form endpoint
// (api/school-form-submit.js) and the authenticated Academic Partner endpoint
// (api/portal/school-placement-requests.js) can never drift. Mirrors api/lib/unitResponseUpsert.js.
//
// PLACEMENT-RESUBMIT-1: `mode` selects what this write touches. 'full' is the normal submission.
// 'add_students' attaches a roster to the EXISTING rotation row and writes NOTHING on it - no dates,
// no coordinator, no availability - and fails closed when no such row exists. In either mode a
// submitted BLANK availability value never clears a stored one (mergeAvailabilityCols); the fields
// that were preserved come back as `preservedFields`. See src/lib/placementResubmission.js for the
// incident this answers.
//
// It performs the two-part write a placement request IS: (1) upsert the coordinator-owned
// cohort_school_rotations row for (cohort, school) with the sanitized school-wide availability, then
// (2) duplicate-safe insert/update of each students row linked to that rotation. On a duplicate
// (matched by NORMALIZED school_email) it updates ONLY coordinator-owned seed fields and never
// student-owned or ASPIRE/admin-owned fields, and it preserves an existing submitted_via (so a
// 'student_form' record is not relabeled). It logs one rotation_created program_event for the first
// new student. Notifications and the accepting-submissions check stay with the caller.
//
// PROVENANCE: the caller passes a TRUSTED, server-selected `provenance` object
// ({ source, submittedByProfileId, submittedAt }) plus a `provenanceReady` flag. The ORIGINAL source
// is recorded once in submitted_via (preserved on updates). The LATEST placement submission is
// recorded in placement_request_last_source / _submitted_by_profile_id / _submitted_at, refreshed on
// every insert AND duplicate-safe update, but ONLY when provenanceReady (the migration is applied).
// Before then the public path still writes the student, simply omitting the new columns; the
// authenticated path gates its whole write on readiness (see the endpoint), so an authenticated
// request is never written without its full provenance.

import { normalizeEmailForLookup } from '../../src/lib/emailUtils.js'
import { sanitizeWeekdays, sanitizeIsoDates, coerceBoolOrNull, coerceMinDaysOrNull } from '../../src/lib/availability.js'
import { resolveOperativeSchoolName } from '../../src/lib/schoolIdentity.js'
import { COURSE_TYPES } from '../../src/lib/constants.js'
import { checkLength, checkLengths, LIMITS, MAX_STUDENTS_PER_PLACEMENT_REQUEST } from './fieldLimits.js'
import {
  sanitizeSubmitMode, mergeAvailabilityCols, preservedAvailabilityFields,
  describeExistingRequest, AVAILABILITY_COLUMNS,
} from '../../src/lib/placementResubmission.js'

// PLACEMENT-RESUBMIT-1: the stored rotation row for (cohort, school), or null.
// Both submit paths read it BEFORE writing so a blank cannot erase a stored
// value, and both lookup endpoints read it to warn the coordinator up front.
// `schoolName` must already be the canonical operative identity.
export async function readExistingRotation(db, { cohortId, schoolName }) {
  const { data, error } = await db
    .from('cohort_school_rotations')
    .select(`id, school_name, rotation_start_date, rotation_end_date, coordinator_name, coordinator_email, updated_at, ${AVAILABILITY_COLUMNS.join(', ')}`)
    .eq('cohort_id', cohortId)
    .eq('school_name', schoolName)
    .maybeSingle()
  if (error) throw error
  return data || null
}

// The public-safe summary a form shows before submitting. Counts the students
// on the rotation row without ever returning who they are.
export async function lookupExistingPlacementRequest(db, { cohortId, school }) {
  const resolved = resolveOperativeSchoolName(school)
  const schoolName = resolved?.displayName || String(school || '').trim()
  if (!cohortId || !schoolName) return { exists: false }
  const row = await readExistingRotation(db, { cohortId, schoolName })
  if (!row) return { exists: false }
  const { count } = await db
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('cohort_school_rotation_id', row.id)
  return describeExistingRequest(row, count || 0)
}

// The latest-submission provenance columns added by
// supabase/migrations/20260727000000_add_academic_partner_placement_provenance.sql.
export const PLACEMENT_PROVENANCE_COLUMNS = [
  'placement_request_last_source',
  'placement_request_last_submitted_by_profile_id',
  'placement_request_last_submitted_at',
]

// Runtime readiness probe: are the provenance columns present in the live schema? A cheap bounded
// select that returns an error (undefined_column) until the migration is applied and PostgREST has
// reloaded. Returns true only when all three columns resolve. The server fails closed on false, so
// readiness is never inferred from client state, and the SAME code path enables writes once the
// migration exists (no redeploy needed). Not cached, so it re-detects automatically.
export async function isPlacementProvenanceReady(db) {
  const { error } = await db.from('students').select(PLACEMENT_PROVENANCE_COLUMNS.join(', ')).limit(1)
  return !error
}

// NURSING-ACADEMICS-1: same runtime readiness probe for students.course_type
// (added by 20260824000000_nursing_academics_portal_foundation.sql). Until
// the Owner applies that migration, submissions simply omit the column, so
// the LIVE placement forms keep working; once it exists, the same code path
// starts writing it with no redeploy.
export async function isCourseTypeReady(db) {
  const { error } = await db.from('students').select('course_type').limit(1)
  return !error
}

// A submitted course type is either empty (unclassified) or a catalog value.
// Anything else is dropped to '' rather than persisted as free text - the
// whole point of the column is that it is structured.
export function sanitizeCourseType(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  return COURSE_TYPES.includes(v) ? v : ''
}

// S-06 LENGTH CAPS: validates the coordinator-owned fields and the student roster a placement
// request carries. Shared by BOTH submit paths (public /school-form and the Academic Partner
// portal) so the two cannot drift, exactly like the write below.
//
// Returns null when everything fits, or { field, label, max, message } for the FIRST problem, so
// the submitter is pointed at one specific field. Over-length input is rejected, never truncated.
// Callers shape their own error response around it.
export function validatePlacementRequestInput({ coordinator = {}, students = [], availability = {} } = {}) {
  const roster = Array.isArray(students) ? students : [];
  if (roster.length > MAX_STUDENTS_PER_PLACEMENT_REQUEST) {
    return {
      field: 'students',
      label: 'Students',
      max: MAX_STUDENTS_PER_PLACEMENT_REQUEST,
      message: `This submission lists ${roster.length} students. Please submit at most ${MAX_STUDENTS_PER_PLACEMENT_REQUEST} at a time.`,
    };
  }

  const coordinatorProblem = checkLengths([
    ['coordinator.school', 'School name',       coordinator.school, LIMITS.IDENTITY],
    ['coordinator.name',   'Coordinator name',  coordinator.name,   LIMITS.NAME],
    ['coordinator.email',  'Coordinator email', coordinator.email,  LIMITS.EMAIL],
    ['coordinator.notes',  'Coordinator notes', coordinator.notes,  LIMITS.NARRATIVE],
  ]);
  if (coordinatorProblem) return coordinatorProblem;

  const notesProblem = checkLength(
    'availability.scheduling_notes', 'Scheduling notes',
    (availability || {}).scheduling_notes, LIMITS.NARRATIVE,
  );
  if (notesProblem) return notesProblem;

  for (let i = 0; i < roster.length; i += 1) {
    const s = roster[i] || {};
    // Row number is 1-based so the message matches what the coordinator sees on the form.
    const row = i + 1;
    const problem = checkLengths([
      [`students[${i}].first_name`, `Student ${row} first name`, s.first_name, LIMITS.NAME],
      [`students[${i}].last_name`,  `Student ${row} last name`,  s.last_name,  LIMITS.NAME],
      [`students[${i}].email`,      `Student ${row} email`,      s.email,      LIMITS.EMAIL],
      [`students[${i}].program_type`, `Student ${row} program`,  s.program_type, LIMITS.IDENTITY],
      [`students[${i}].course_type`, `Student ${row} course type`, s.course_type, LIMITS.IDENTITY],
      [`students[${i}].phone`,      `Student ${row} phone`,      s.phone,      LIMITS.PHONE],
      [`students[${i}].estimated_graduation_date`, `Student ${row} graduation date`, s.estimated_graduation_date, LIMITS.DATE],
    ]);
    if (problem) return problem;
  }

  return null;
}

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
  provenance = { source: 'school_form', submittedByProfileId: null, submittedAt: null },
  provenanceReady = false,
  mode = 'full',
}) {
  const submitMode = sanitizeSubmitMode(mode)
  const submittedAvailability = sanitizeAvailabilityCols(availability)

  // TRUSTED provenance. The caller selects the source and profile id SERVER-SIDE and generates the
  // timestamp server-side; nothing here comes from the browser payload. `source` is also the original
  // submitted_via on a NEW row (submitted_via is set once and preserved; the placement_request_last_*
  // columns are the LATEST submission and are refreshed on every insert AND update). The
  // placement_request_last_* columns are written ONLY when the schema is ready, so the public path
  // keeps working before the migration is applied (it simply omits them until then).
  const source = provenance?.source || 'school_form'
  const submittedAt = provenance?.submittedAt || new Date().toISOString()
  const provenanceCols = provenanceReady ? {
    placement_request_last_source: source,
    placement_request_last_submitted_by_profile_id: provenance?.submittedByProfileId ?? null,
    placement_request_last_submitted_at: submittedAt,
  } : {}

  // AP-SCHOOL-CANONICALIZATION-1 (revised against the actual production schema: there is NO
  // public.schools table and NO students.school_id column): resolve the submitted school string
  // against the static identity catalog (src/lib/schoolIdentity.js) ONCE and persist a single
  // OPERATIVE identity everywhere in this write - into students.school and
  // cohort_school_rotations.school_name. This is what stops "Cal State Northridge" and
  // "California State University, Northridge" from ever forming two groups or two rotation rows
  // again. An UNKNOWN school degrades to the raw trimmed string (the public form must not hard-fail
  // for a school not yet in the catalog); the Academic Partner endpoint separately fails closed
  // BEFORE calling this helper, so AP submissions can never write free-text school names.
  const canonicalSchool = resolveOperativeSchoolName(coordinator.school)
  const schoolName = canonicalSchool?.displayName || coordinator.school.trim()

  // NURSING-ACADEMICS-1: probe course_type readiness here (not at the
  // endpoints) so both submit paths keep working before the migration is
  // applied and start writing the column the moment it exists.
  let courseTypeReady = false
  try { courseTypeReady = await isCourseTypeReady(db) } catch { courseTypeReady = false }
  // On UPDATE, a non-empty catalog value refreshes the classification; an
  // empty submission NEVER wipes one (historical mapping is owner-entered and
  // must survive a coordinator resubmission that left the field blank).
  const courseTypeColsFor = (s, { isUpdate }) => {
    if (!courseTypeReady) return {}
    const v = sanitizeCourseType(s.course_type)
    if (isUpdate && !v) return {}
    return { course_type: v || null }
  }

  // (1) The rotation row for this school + cohort. PLACEMENT-RESUBMIT-1: read
  // the stored row FIRST. The unique key is (cohort_id, school_name), so a
  // second submission from the same school lands on the SAME row - the upsert
  // is a replace, not an insert, and that is how a Fall II request overwrote a
  // Fall I rotation window and erased its blackout dates.
  let existingRotation
  try {
    existingRotation = await readExistingRotation(db, { cohortId, schoolName })
  } catch (readErr) {
    console.error('[schoolPlacementUpsert] rotation read error:', readErr)
    return { error: 'Failed to load the existing rotation for this school.', added: [], updated: [], skipped: [], rotationId: null }
  }

  // 'add_students' attaches a roster to an EXISTING request and writes nothing
  // on the rotation row: no dates, no coordinator, no availability. It is only
  // meaningful when that row exists, so it fails closed rather than silently
  // degrading into the full write that would overwrite.
  if (submitMode === 'add_students' && !existingRotation) {
    return {
      error: 'There is no existing placement request for this school and cohort to add students to.',
      added: [], updated: [], skipped: [], rotationId: null,
    }
  }

  // A blank NEVER clears a stored value (see mergeAvailabilityCols). The
  // backstop that holds even when the resubmission warning is dismissed.
  const availabilityCols = mergeAvailabilityCols(submittedAvailability, existingRotation)
  const preservedFields = preservedAvailabilityFields(submittedAvailability, existingRotation)

  let rotationId
  if (submitMode === 'add_students') {
    rotationId = existingRotation.id
  } else {
    const { data: rotationRow, error: rotErr } = await db
      .from('cohort_school_rotations')
      .upsert(
        {
          cohort_id:           cohortId,
          school_name:         schoolName,
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
    rotationId = rotationRow.id
  }

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
        school:                    schoolName,
        program_type:              s.program_type || '',
        ...courseTypeColsFor(s, { isUpdate: true }),
        hours_required:            parseInt(s.hours_required) || 0,
        estimated_graduation_date: s.estimated_graduation_date || null,
        estimated_graduation:      s.estimated_graduation_date || '',
        school_coordinator_name:   coordinator.name.trim(),
        school_coordinator_email:  coordinator.email.trim(),
        coordinators:              (coordinator.notes || '').trim(),
        aspire_cohort:             cohortName || '',
        cohort_school_rotation_id: rotationId,
        // submitted_via is the ORIGINAL source: preserve it, set only when currently null.
        ...(existing.submitted_via ? {} : { submitted_via: source }),
        // Latest-submission provenance is refreshed on every duplicate-safe update (when ready).
        ...provenanceCols,
      }
      const { error: updErr } = await db.from('students').update(updatePayload).eq('id', existing.id)
      if (updErr) {
        console.error('[schoolPlacementUpsert] student update error:', updErr)
        return { error: `Failed to update student ${fullName}.`, added, updated, skipped, rotationId }
      }
      updated.push({ name: fullName, id: existing.id, email: normEmail, programType: (s.program_type || '').trim() })
      continue
    }

    const { data: newStudent, error: insertErr } = await db
      .from('students').insert({
        name:                       fullName,
        first_name:                 firstName,
        last_name:                  lastName,
        school_email:               normEmail,
        phone:                      (s.phone || '').trim(),
        school:                     schoolName,
        program_type:               s.program_type || '',
        ...courseTypeColsFor(s, { isUpdate: false }),
        hours_required:             parseInt(s.hours_required) || 0,
        hours_completed:            0,
        estimated_graduation_date:  s.estimated_graduation_date || null,
        estimated_graduation:       s.estimated_graduation_date || '',
        status:                     'Pending Outreach',
        interview_outcome:          'Pending Interview',
        ngrp_outcome:               'Pending',
        submitted_via:              source,
        ...provenanceCols,
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
    existingByEmail.set(normEmail, { id: newStudent.id, school_email: normEmail, submitted_via: source })
    added.push({ name: fullName, id: newStudent.id, email: normEmail, programType: (s.program_type || '').trim() })
  }

  // Log one rotation_created event for the first new student.
  if (added.length > 0) {
    const { error: evLogErr } = await db.from('program_events').insert({
      student_id:  added[0].id,
      cohort_id:   cohortId,
      event_type:  'rotation_created',
      event_date:  new Date().toISOString().split('T')[0],
      notes:       `[Auto-logged] Rotation row created/updated for ${schoolName}. Dates: ${rotationStartDate} to ${rotationEndDate}.`,
      created_by:  'system',
    })
    if (evLogErr) console.warn('[schoolPlacementUpsert] program_events log error:', evLogErr.message)
  }

  // schoolName is the canonical display identity this write persisted; callers use it for
  // notifications so the email never echoes the raw submitted variant.
  return { error: null, added, updated, skipped, rotationId, schoolName, mode: submitMode, preservedFields }
}
