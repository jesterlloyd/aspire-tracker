// src/lib/ngrp/residencyActivityModel.js
//
// RESIDENCY-TA-1 (Owner, 2026-10-05): Settings > Residency Activity, "a log of who did what",
// now that Talent Acquisition works in Residency beside the ASPIRE team. The rows are
// ngrp_audit_events; this module says each one in words. Pure, so the page and its tests read
// the same rules.
import { supportActivity } from './ngrpSupportActivities.js'

// Every event type the log can hold (lib/server/ngrpAudit.js), as a short past-tense phrase.
export const EVENT_LABELS = Object.freeze({
  cycle_created: 'Created the residency cohort',
  cycle_updated: 'Edited the residency cohort',
  cycle_activated: 'Made the residency cohort active',
  source_cohorts_changed: 'Changed the ASPIRE cohorts',
  units_changed: 'Changed the hiring units',
  form_sent: 'Sent the Transition Form',
  form_opened: 'Opened the Transition Form',
  form_submitted: 'Submitted the Transition Form',
  form_revised: 'Revised the Transition Form',
  token_revoked: 'Revoked a form link',
  token_resent: 'Resent the Transition Form',
  eligibility_calculated: 'Eligibility calculated',
  eligibility_overridden: 'Overrode eligibility',
  application_confirmed: 'Confirmed the application',
  application_withdrawn: 'Withdrew the application',
  unit_assigned: 'Paired with a unit',
  unit_assignment_cleared: 'Cleared the unit pairing',
  interview_recorded: 'Recorded the interview',
  offer_extended: 'Recorded an offer',
  offer_accepted: 'Recorded an accepted offer',
  hire_recorded: 'Recorded the hire',
  not_proceeding_recorded: 'Recorded as Not Proceeding',
  application_reinstated: 'Reinstated the application',
  unit_preferences_set: 'Set the unit choices',
  offer_declined: 'Recorded a declined offer',
  not_selected: 'Recorded as not selected',
  reflection_started: 'Started the reflection tool',
  reflection_sent: 'Sent a reflection',
  reflection_opened: 'Opened a reflection',
  reflection_submitted: 'Submitted a reflection',
  reflection_stopped: 'Stopped the reflection tool',
  support_logged: 'Logged support',
  support_voided: 'Removed a support entry',
  followup_flagged: 'Flagged for follow-up',
  followup_unflagged: 'Removed the follow-up flag',
  document_uploaded: 'Uploaded a document',
  resume_scored: 'Scored the résumé',
})

export const eventLabel = type => EVENT_LABELS[type] || String(type || '').replace(/_/g, ' ')

// The action groups the page filters by.
export const ACTION_GROUPS = Object.freeze([
  Object.freeze({ key: 'all', label: 'All actions', types: null }),
  Object.freeze({ key: 'support', label: 'Support', types: ['support_logged', 'support_voided'] }),
  Object.freeze({ key: 'flags', label: 'Flags', types: ['followup_flagged', 'followup_unflagged'] }),
  Object.freeze({ key: 'documents', label: 'Documents and résumés', types: ['document_uploaded', 'resume_scored'] }),
  Object.freeze({ key: 'application', label: 'Application', types: ['form_sent', 'form_opened', 'form_submitted', 'form_revised', 'token_revoked', 'token_resent', 'eligibility_calculated', 'eligibility_overridden', 'application_confirmed', 'application_withdrawn', 'unit_preferences_set', 'not_proceeding_recorded', 'application_reinstated'] }),
  Object.freeze({ key: 'hiring', label: 'Interviews and hiring', types: ['unit_assigned', 'unit_assignment_cleared', 'interview_recorded', 'offer_extended', 'offer_accepted', 'offer_declined', 'hire_recorded', 'not_selected'] }),
])
export const matchesGroup = (row, groupKey) => {
  const g = ACTION_GROUPS.find(x => x.key === groupKey)
  return !g || !g.types || g.types.includes(row.event_type)
}

// Who did it, as the log shows it: their name and which team they are on.
const ROLE_TEAM = { owner: 'ASPIRE', admin: 'ASPIRE', 'co-lead': 'ASPIRE', co_lead: 'ASPIRE', interviewer: 'ASPIRE', portal: 'Talent Acquisition' }
export function actorOf(row) {
  if (row.actor_kind === 'alumnus') return { name: row.student_name || 'The alumnus', team: 'Alumnus' }
  if (row.actor_kind === 'system' || !row.actor_profile_id) return { name: 'Automatic', team: 'System' }
  return { name: row.actor_name || 'A former account', team: ROLE_TEAM[row.actor_role] || 'ASPIRE' }
}

// The one detail worth a column: which activity, which document, what readiness.
export function detailOf(row) {
  const m = row.metadata || {}
  if (m.activity) return supportActivity(m.activity)?.label || m.activity
  if (m.doc_type) return String(m.doc_type).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
  if (row.event_type === 'resume_scored' && m.status) return m.status
  if (m.unit) return m.unit
  if (m.hired_unit) return m.hired_unit
  if (m.interview_status) return String(m.interview_status).replace(/_/g, ' ')
  return ''
}

/** The page's CSV: exactly the rows shown, in words. */
export function activityCsv(rows = []) {
  const esc = v => {
    let s = String(v ?? '')
    if (/^[=+\-@]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [['When', 'Who', 'Team', 'Action', 'Alumnus', 'Detail', 'Residency cohort'].join(',')]
  for (const r of rows) {
    const a = actorOf(r)
    lines.push([r.created_at, a.name, a.team, eventLabel(r.event_type), r.student_name || '', detailOf(r), r.cycle_name || ''].map(esc).join(','))
  }
  return `\uFEFF${lines.join('\n')}`
}
