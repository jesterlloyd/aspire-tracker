// api/lib/unitResponseUpsert.js
//
// PHASE3-UNIT-PORTAL: shared server-side unit participation write, used by
// BOTH the public form endpoint (api/unit-form-submit.js) and the
// authenticated portal endpoint (api/portal/unit-participation-submit.js) so
// the two submission paths can never drift.
//
// Performs the exact write sequence the public unit form has always done:
//   1. Upsert the units row for (cohort, unit) so the matching board has a
//      record (patient_population stamped on insert only).
//   2. Upsert unit_cohort_responses with SERVER-managed submission_count,
//      submitted_at, and last_updated_at.
// Field mapping and conditional-null behavior are unchanged from the
// original client logic.

import { PATIENT_POPULATION_MAP } from '../../src/lib/constants.js'

const str = (v) => (typeof v === 'string' ? v.trim() : '')

// values: { unitName, submitterName, submitterEmail, submitterRole, slotsNum,
//           shiftPreference, preferredPreceptors, considerations,
//           reasonForZero, hiringNgrp, hiringNgrpReason, hasFiredAlumni,
//           alumniOutcome, alumniNotes, wouldConsiderAlumni }
// Returns { ok: true } or { error: { status, code } }.
export async function performUnitResponseUpsert(db, cohortId, values) {
  const isHosting = values.slotsNum > 0

  // 1. Units row.
  let unitId
  const { data: existingUnit, error: findErr } = await db
    .from('units')
    .select('id')
    .eq('cohort_id', cohortId)
    .eq('unit_name', values.unitName)
    .limit(1)
    .maybeSingle()
  if (findErr) return { error: { status: 500, code: 'unit_lookup_failed' } }

  const unitFields = {
    contact_person:   values.submitterName,
    contact_email:    values.submitterEmail,
    is_participating: isHosting,
    total_slots:      isHosting ? values.slotsNum : 0,
    slots_remaining:  isHosting ? values.slotsNum : 0,
    shift_preference: str(values.shiftPreference),
    preceptors:       str(values.preferredPreceptors),
    considerations:   str(values.considerations),
  }

  if (existingUnit) {
    unitId = existingUnit.id
    const { error: updateErr } = await db.from('units').update(unitFields).eq('id', unitId)
    if (updateErr) return { error: { status: 500, code: 'unit_update_failed' } }
  } else {
    const { data: newUnit, error: insertErr } = await db.from('units').insert({
      unit_name:          values.unitName,
      ...unitFields,
      patient_population: PATIENT_POPULATION_MAP[values.unitName] || '',
      cohort_id:          cohortId,
    }).select('id').single()
    if (insertErr || !newUnit) return { error: { status: 500, code: 'unit_insert_failed' } }
    unitId = newUnit.id
  }

  // 2. Response row (server-managed counters and timestamps).
  const { data: existingRow, error: existingErr } = await db
    .from('unit_cohort_responses')
    .select('submission_count, submitted_at')
    .eq('cohort_id', cohortId)
    .eq('unit_id', unitId)
    .maybeSingle()
  if (existingErr) return { error: { status: 500, code: 'response_lookup_failed' } }

  const now = new Date().toISOString()
  const upsertData = {
    cohort_id:                    cohortId,
    unit_id:                      unitId,
    unit_name:                    values.unitName,
    response_status:              isHosting ? 'submitted_hosting' : 'submitted_not_hosting',
    submitted_by_name:            values.submitterName,
    submitted_by_email:           values.submitterEmail,
    submitted_by_role:            values.submitterRole,
    slots_offered:                isHosting ? values.slotsNum : 0,
    shift_preference:             str(values.shiftPreference) || null,
    preferred_preceptors:         str(values.preferredPreceptors) || null,
    considerations:               str(values.considerations) || null,
    reason_for_zero:              !isHosting ? (str(values.reasonForZero) || null) : null,
    hiring_new_grads_ngrp:        values.hiringNgrp,
    hiring_new_grads_reason:      values.hiringNgrp === false ? (str(values.hiringNgrpReason) || null) : null,
    has_hired_aspire_alumni:      str(values.hasFiredAlumni) || null,
    aspire_alumni_outcome:        str(values.hasFiredAlumni) === 'yes' ? (str(values.alumniOutcome) || null) : null,
    aspire_alumni_notes:          str(values.hasFiredAlumni) === 'yes' ? (str(values.alumniNotes) || null) : null,
    would_consider_aspire_alumni: str(values.hasFiredAlumni) === 'no'  ? (str(values.wouldConsiderAlumni) || null) : null,
    submission_count:             (existingRow?.submission_count || 0) + 1,
    submitted_at:                 existingRow?.submitted_at || now,
    last_updated_at:              now,
  }

  const { error: upsertErr } = await db
    .from('unit_cohort_responses')
    .upsert(upsertData, { onConflict: 'cohort_id,unit_id' })
  if (upsertErr) return { error: { status: 500, code: 'response_upsert_failed' } }

  // S-06 ENDPOINT CLOSURE: the confirmation email is now sent by the submit endpoints rather than
  // by a separate public route that took its content from a second browser request. These are the
  // values this function actually PERSISTED, so the email and the stored record can never disagree.
  return {
    ok: true,
    notification: {
      unitName:            values.unitName,
      submitterName:       values.submitterName,
      submitterEmail:      values.submitterEmail,
      submitterRole:       values.submitterRole,
      slotsOffered:        upsertData.slots_offered,
      shiftPreference:     upsertData.shift_preference,
      preferredPreceptors: upsertData.preferred_preceptors,
      considerations:      upsertData.considerations,
      reasonForZero:       upsertData.reason_for_zero,
      hiringNgrp:          upsertData.hiring_new_grads_ngrp,
      hiringNgrpReason:    upsertData.hiring_new_grads_reason,
      hasFiredAlumni:      upsertData.has_hired_aspire_alumni,
      alumniOutcome:       upsertData.aspire_alumni_outcome,
      alumniNotes:         upsertData.aspire_alumni_notes,
      wouldConsiderAlumni: upsertData.would_consider_aspire_alumni,
    },
  }
}
