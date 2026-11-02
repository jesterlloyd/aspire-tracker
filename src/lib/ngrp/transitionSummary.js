// src/lib/ngrp/transitionSummary.js
//
// APPLICANT-PACKET-1: a submitted Transition Form revision as label / value rows, in the order
// staff read them. One rule for the applicant chart's "Review submitted form" and the applicant
// packet's Transition Form page, so the two can never list different answers. Pure.

export function transitionSummaryRows(payload) {
  if (!payload) return []
  const rows = []
  const push = (label, v) => { if (v !== undefined && v !== null && v !== '') rows.push([label, String(v)]) }
  push('Preferred email', payload.identity?.preferred_email)
  push('Preferred phone', payload.identity?.preferred_phone)
  push('CS employment', payload.identity?.cs_employment_status?.replace(/_/g, ' '))
  push('Degree', payload.education?.degree_type)
  push('Completion date', payload.education?.completion_date)
  push('GPA', payload.education?.gpa)
  push('US accredited', payload.education?.us_accredited === true ? 'Yes' : payload.education?.us_accredited === false ? 'No' : undefined)
  push('Precepted unit', payload.aspire?.precepted_unit === 'Other'
    ? `Other: ${payload.aspire?.precepted_unit_other || 'not named'}`
    : payload.aspire?.precepted_unit)
  push('ASPIRE shifts', payload.aspire?.rotation_shifts)
  push('Prior NGRP application', payload.aspire?.prior_ngrp_applied === true ? `Yes${payload.aspire?.prior_ngrp_details ? ` - ${payload.aspire.prior_ngrp_details}` : ''}` : payload.aspire?.prior_ngrp_applied === false ? 'No' : undefined)
  push('CA RN license', payload.licensure?.ca_rn_status)
  push('License #', payload.licensure?.license_number)
  push('NCLEX scheduled', payload.licensure?.nclex_scheduled_date)
  push('Paid RN months', payload.licensure?.paid_rn_months)
  push('BLS', payload.licensure?.bls_status ? `${payload.licensure.bls_status}${payload.licensure.bls_issuer ? ` (${payload.licensure.bls_issuer})` : ''}${payload.licensure.bls_expiration ? ` exp ${payload.licensure.bls_expiration}` : ''}` : undefined)
  if (payload.licensure?.acls_required) push('ACLS', payload.licensure?.acls_status || 'required, not reported')
  push('Interest', payload.residency_interest?.interest?.replace(/_/g, ' '))
  push('Interest statement', payload.residency_interest?.interest_statement)
  push('Strengths', payload.residency_interest?.strengths_statement)
  const ready = Object.entries(payload.readiness || {}).filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, ' '))
  if (ready.length) push('Readiness checked', ready.join(', '))
  push('Consent to share with Talent Acquisition', payload.attestation?.consent_hr_share === true ? 'Yes' : 'Not given (submitted before this consent existed)')
  // UNIT-SHARE-CONSENT-1: the wider wording (hiring units that interview them), since 2026-10-05.
  push('Consent to share with interviewing units', payload.attestation?.consent_unit_share === true ? 'Yes' : 'Not given (submitted before this consent existed)')
  return rows
}

// ROW-ANSWERS-1 (Owner, 2026-11-01): what Interest & Eligibility's row drawer lists. It is the list
// above plus the ranked unit choices. Those stay out of transitionSummaryRows on purpose, because
// the Unit Leader Portal reads that list and a unit is not shown where else someone ranked.
export function transitionAnswerRows(payload) {
  if (!payload) return []
  const units = payload.residency_interest?.unit_preferences
  const ranked = Array.isArray(units) ? units.filter(Boolean) : []
  return [
    ...(ranked.length ? [['Ranked unit choices', ranked.map((u, i) => `${i + 1}. ${u}`).join(', ')]] : []),
    ...transitionSummaryRows(payload),
  ]
}

const pacificDay = iso => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
}

// The drawer's line above the answers, and its whole body when there are none.
export function submittedLine(revision) {
  const day = pacificDay(revision?.submitted_at)
  return [`Revision ${revision?.revision_number ?? 1}`, day && `submitted ${day}`].filter(Boolean).join(' · ')
}
export function noAnswersLine(row) {
  if (!row?.candidate_id || row.form_status === 'not_sent') return 'The Transition Form has not been sent yet, so there are no answers to show.'
  const sent = pacificDay(row.form_sent_at)
  return `No answers yet. The form was ${sent ? `sent ${sent}` : 'sent'} and has not been submitted.`
}
