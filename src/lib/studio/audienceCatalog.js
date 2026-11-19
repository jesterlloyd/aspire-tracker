// src/lib/studio/audienceCatalog.js
//
// STUDIO-2 (Owner, 2026-11-05): who a Studio send goes to, described as a RULE ("Winter 2027
// students who are Placed", "Winter 2027 residency applicants who submitted the Transition Form")
// instead of a list of ticks. Pure: the drawer reads it to draw the choices and the server reads it
// to resolve the rule (lib/server/studio/resolveAudience.js), so the two can never disagree about
// what a rule means.
//
// Three populations, each with the filters it can honestly be asked:
//   students  this ASPIRE cohort's students, by status and school. Not Proceeding is NEVER in a
//             rule's result; a person who must get it anyway is ticked by hand, with the
//             acknowledgment, exactly as in Phase 1.
//   alumni    one residency cohort's roster, by Transition Form, licensure and hire. Addressed by
//             the residency rule (residencyRecipient: Cedars-Sinai once hired, else the form's
//             preferred email, else personal; never the school address).
//   contacts  active Connect contacts, by category, and (STUDIO-FILTERS-1) by unit, division, title,
//             unit leads only, and whether they answered a cohort's request: a unit's capacity
//             request for anyone who holds units, the school's placement requests for an Academic
//             Partner.
//
// A rule never names an address. The server decides every address, and what it decided is what the
// sender reviews, removes from and freezes before anything is sent.

import { ASPIRE_STATUSES } from '../constants.js'
import { CONTACT_CATEGORY_ORDER } from '../contactCategories.js'

export const POPULATIONS = Object.freeze([
  { key: 'students', label: 'Students', line: 'An ASPIRE cohort, by status and school' },
  { key: 'alumni', label: 'Residency Applicants', line: 'A residency cohort, by Transition Form, licensure and hire' },
  { key: 'contacts', label: 'Contacts', line: 'Active Connect contacts, by category, unit, division, title or response' },
])
const POP_KEYS = new Set(POPULATIONS.map(p => p.key))

export const NOT_PROCEEDING = 'Not Proceeding'
/** The statuses a rule may ask for. Not Proceeding is not one of them. */
export const RULE_STATUSES = Object.freeze(ASPIRE_STATUSES.filter(s => s !== NOT_PROCEEDING))

export const STUDENT_EMAIL_ROUTES = Object.freeze([
  { key: 'automatic', label: 'Their usual address', line: 'School while studying, personal once they have finished' },
  { key: 'school', label: 'School email' },
  { key: 'personal', label: 'Personal email' },
])
const ROUTE_KEYS = new Set(STUDENT_EMAIL_ROUTES.map(r => r.key))

export const FORM_FILTERS = Object.freeze([
  { key: 'any', label: 'Anyone on the roster' },
  { key: 'submitted', label: 'Submitted the Transition Form' },
  { key: 'not_submitted', label: 'Has not submitted it' },
])
export const LICENSE_FILTERS = Object.freeze([
  { key: 'active', label: 'Licensed' },
  { key: 'pending', label: 'NCLEX ahead' },
  { key: 'none', label: 'Not yet' },
])
export const HIRE_FILTERS = Object.freeze([
  { key: 'any', label: 'Hired or not' },
  { key: 'yes', label: 'Hired' },
  { key: 'no', label: 'Not hired' },
])
const FORM_KEYS = new Set(FORM_FILTERS.map(f => f.key))
const LICENSE_KEYS = new Set(LICENSE_FILTERS.map(f => f.key))
const HIRE_KEYS = new Set(HIRE_FILTERS.map(f => f.key))

export const CONTACT_CATEGORIES = CONTACT_CATEGORY_ORDER

// STUDIO-FILTERS-1 (Owner, 2026-11-19: "filter contacts, for example unit leaders by unit or division,
// or those who haven't responded, before I send them so I don't add or remove manually").
// A response is always to ONE ASPIRE cohort's request. For a contact who holds units it is the unit's
// capacity request (cohort_unit_response_targets and unit_cohort_responses, the rule At a Glance
// counts with); for an Academic Partner it is whether their school has sent that cohort any students.
export const RESPONSE_STATES = Object.freeze([
  { key: 'any', label: 'Anyone' },
  { key: 'pending', label: 'Has not responded' },
  { key: 'responded', label: 'Has responded' },
])
const RESPONSE_KEYS = new Set(RESPONSE_STATES.map(r => r.key))
export const MAX_UNITS = 60
export const MAX_TITLES = 30

export const MAX_COHORTS = 12
export const MAX_SCHOOLS = 40
/** The most people one Studio send may reach. 27 batches of 75. */
export const MAX_AUDIENCE = 2000

/** Why someone a rule or a pick named is not on the list. Words, for the review screen. */
export const EXCLUDE_REASONS = Object.freeze({
  no_email: 'No email address on file',
  not_proceeding: 'Not Proceeding',
  opted_out: 'Turned off program news',
  duplicate: 'Already on the list at this address',
  removed: 'You removed them',
  changed_since_review: 'Joined the rule after you reviewed it',
  over_limit: `More than ${MAX_AUDIENCE} people`,
  inactive: 'Inactive contact',
  not_found: 'Not found',
  email_mismatch: 'That address is not theirs any more',
  invalid_email: 'Not an email address',
  not_proceeding_not_acknowledged: 'Not Proceeding, not confirmed',
  not_in_reviewed_list: 'Not on the list you reviewed',
  residency_route_not_reviewed: 'Not on the list you reviewed',
  already_sent_in_batch: 'Already sent in this batch',
  contact_inactive: 'Inactive contact',
  student_not_found: 'Not found',
  contact_not_found: 'Not found',
  missing_email: 'No email address on file',
})
export const reasonWords = (code) => EXCLUDE_REASONS[code] || String(code || 'Left out').replace(/_/g, ' ')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ids = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(x => UUID.test(x)))].slice(0, max)
const pickList = (v, allowed, max = 50) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(x => allowed.has(x)))].slice(0, max)
const texts = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).map(x => x.slice(0, 120)))].slice(0, max)

/**
 * The one shape a rule takes, whatever arrived. Unknown values are dropped, never guessed.
 * { population, cohortIds, statuses, schools, emailRoute, cycleId, form, license, hired, categories }
 */
export function sanitizeRule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const population = POP_KEYS.has(r.population) ? r.population : 'students'
  if (population === 'students') {
    return {
      population,
      cohortIds: ids(r.cohortIds, MAX_COHORTS),
      statuses: pickList(r.statuses, new Set(RULE_STATUSES)),
      schools: texts(r.schools, MAX_SCHOOLS),
      emailRoute: ROUTE_KEYS.has(r.emailRoute) ? r.emailRoute : 'automatic',
    }
  }
  if (population === 'alumni') {
    return {
      population,
      cycleId: UUID.test(String(r.cycleId || '')) ? String(r.cycleId) : null,
      form: FORM_KEYS.has(r.form) ? r.form : 'any',
      license: pickList(r.license, LICENSE_KEYS),
      hired: HIRE_KEYS.has(r.hired) ? r.hired : 'any',
    }
  }
  const resp = r.response && typeof r.response === 'object' ? r.response : {}
  const respCohort = UUID.test(String(resp.cohortId || '')) ? String(resp.cohortId) : null
  const respState = RESPONSE_KEYS.has(resp.state) ? resp.state : 'any'
  return {
    population,
    categories: pickList(r.categories, new Set(CONTACT_CATEGORIES)),
    units: texts(r.units, MAX_UNITS),
    divisions: texts(r.divisions, 20),
    titles: texts(r.titles, MAX_TITLES),
    leadsOnly: r.leadsOnly === true,
    response: { cohortId: respCohort, state: respCohort ? respState : 'any' },
  }
}

/** True when a contacts rule asks about a cohort's request. */
export const asksResponse = (rule) => {
  const r = sanitizeRule(rule)
  return r.population === 'contacts' && r.response.state !== 'any' && !!r.response.cohortId
}

/** What a rule still needs before it can be resolved, as one sentence, or '' when it is ready. */
export function ruleProblem(rule) {
  const r = sanitizeRule(rule)
  if (r.population === 'students' && !r.cohortIds.length) return 'Choose at least one ASPIRE cohort.'
  if (r.population === 'alumni' && !r.cycleId) return 'Choose a residency cohort.'
  if (r.population === 'contacts' && r.response?.state !== 'any' && !r.response?.cohortId) return 'Choose the cohort whose request they answered.'
  return ''
}

/**
 * The rule in one plain line, for the review screen and the send record:
 * "Winter 2027 students · Placed or Active Rotation · their usual address".
 * `names` maps cohort and cycle ids to their names.
 */
export function describeRule(rule, names = {}) {
  const r = sanitizeRule(rule)
  const nameOf = (id) => names[id] || 'a cohort'
  const or = (list) => list.length <= 1 ? (list[0] || '') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`
  if (r.population === 'students') {
    const parts = [`${or(r.cohortIds.map(nameOf)) || 'No cohort'} students`]
    if (r.statuses.length) parts.push(or(r.statuses))
    if (r.schools.length) parts.push(or(r.schools))
    parts.push((STUDENT_EMAIL_ROUTES.find(x => x.key === r.emailRoute)?.label || '').toLowerCase())
    return parts.join(' · ')
  }
  if (r.population === 'alumni') {
    const parts = [`${r.cycleId ? nameOf(r.cycleId) : 'No cohort'} residency applicants`]
    if (r.form !== 'any') parts.push(FORM_FILTERS.find(f => f.key === r.form).label.toLowerCase())
    if (r.license.length) parts.push(or(r.license.map(k => LICENSE_FILTERS.find(f => f.key === k).label)))
    if (r.hired !== 'any') parts.push(HIRE_FILTERS.find(f => f.key === r.hired).label.toLowerCase())
    return parts.join(' · ')
  }
  const parts = [r.categories.length ? `Contacts · ${or(r.categories)}` : 'Every active contact']
  if (r.divisions.length) parts.push(`${or(r.divisions)} division`)
  if (r.units.length) parts.push(r.units.length > 4 ? `${r.units.length} units` : or(r.units))
  if (r.titles.length) parts.push(or(r.titles))
  if (r.leadsOnly) parts.push('unit leads only')
  if (r.response.state !== 'any' && r.response.cohortId) {
    parts.push(`${r.response.state === 'pending' ? 'not yet responded to' : 'responded to'} ${nameOf(r.response.cohortId)}`)
  }
  return parts.join(' · ')
}

// ── Who replies go to ──────────────────────────────────────────────────────────────────────────
// Owner, 2026-11-05: a residency send replies to ngrp@cshs.org with aspire@cshs.org included; any
// other send replies to the person who sent it.
export const RESIDENCY_REPLY_TO = Object.freeze(['ngrp@cshs.org', 'aspire@cshs.org'])
export const REPLY_ROUTES = Object.freeze([
  { key: 'sender', label: 'Replies come to you' },
  { key: 'residency', label: `Replies go to ${RESIDENCY_REPLY_TO.join(' and ')}` },
])
const REPLY_KEYS = new Set(REPLY_ROUTES.map(r => r.key))

/** A residency audience defaults to the residency inboxes; everything else to the sender. */
export const defaultReplyRoute = (rule) => (rule && sanitizeRule(rule).population === 'alumni' ? 'residency' : 'sender')
export const cleanReplyRoute = (v) => (REPLY_KEYS.has(v) ? v : 'sender')

/** The reply_to a send carries: an array for residency, the sender's own address otherwise. */
export function replyToFor(route, senderEmail, fallback) {
  if (cleanReplyRoute(route) === 'residency') return [...RESIDENCY_REPLY_TO]
  return senderEmail || fallback
}
