// src/lib/unitFormResponders.js
//
// UNIT-FORM-RESPONDER-1 (Owner, 2026-11-11): the public Unit Availability Form asks who is
// answering from ASPIRE Connect > Contacts. Unit, then role, then a name picked from that
// unit's Unit Leader contacts in that role; the address the confirmation goes to comes from
// the contact.
//
// PURE (no client, node-testable), read by the form page and by both unit-form endpoints.
//
// What a PUBLIC page may be told. S-10 closed a leak in which naming a unit returned the last
// submitter's name, address and free text. This module keeps that closed where it can:
//   - a responder is { id, name, role, email_hint }. The address itself NEVER leaves the
//     server: the form shows a masked hint, submits the contact's id, and the submit endpoint
//     reads the address from Contacts. Names by unit and role are what the Owner asked the
//     form to show, and are the least a name picker can disclose.
//   - picking a name proves nothing, so it never releases the guarded half of a previous
//     response (see api/unit-form-lookup.js). Only typing the address it was filed under does.

/** The option in the name picker that falls back to typing a name and an address. */
export const NOT_LISTED = '__not_listed__'

// Which Connect titles answer to each role the form offers. Connect's "Interim" is the
// form's "Acting"; a Director has no role of their own on the form and answers as Executive
// Director's neighbour. Charge Nurse and Other are never Unit Leader contacts: free text.
const ROLE_TITLES = Object.freeze({
  'Associate Director': ['Associate Director'],
  'Acting Associate Director': ['Acting Associate Director', 'Interim Associate Director'],
  'Executive Director': ['Executive Director', 'Director'],
  'Assistant Nurse Manager': ['Assistant Nurse Manager'],
  'NPD Practitioner': ['NPD Practitioner'],
  'Clinical Nurse Specialist': ['Clinical Nurse Specialist'],
})

const clean = (v) => String(v || '').trim()

/** "jenita.lastname@cshs.org" -> "j••••••@cshs.org". Enough to recognise, not enough to copy. */
export function maskEmail(email) {
  const e = clean(email)
  const at = e.lastIndexOf('@')
  if (at < 1) return ''
  return `${e[0]}••••••${e.slice(at)}`
}

/**
 * What the public form is told about a unit's leaders.
 * @param leaders rows from unitLeaderRows(contacts, { unitName })
 */
export function publicResponders(leaders) {
  return (Array.isArray(leaders) ? leaders : [])
    .filter(l => l && l.contact_id != null && clean(l.full_name))
    .map(l => ({
      id: String(l.contact_id),
      name: clean(l.full_name),
      role: clean(l.role),
      email_hint: maskEmail(l.email),
    }))
}

/** The responders who hold the role chosen on the form, by name. */
export function respondersForRole(responders, role) {
  const titles = ROLE_TITLES[clean(role)]
  if (!titles) return []
  return (Array.isArray(responders) ? responders : [])
    .filter(r => r && titles.includes(clean(r.role)))
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name), undefined, { sensitivity: 'base' }))
}

/** The unit's leader row a submitted contact id names, or null. Server side. */
export function findResponder(leaders, contactId) {
  const id = clean(contactId)
  if (!id) return null
  return (Array.isArray(leaders) ? leaders : []).find(l => l && String(l.contact_id) === id) || null
}

// ── Answers the Owner wants to hear about ───────────────────────────────────────

/**
 * UNIT-FORM-CONCERN-1 (Owner, 2026-11-11): a unit that hired an ASPIRE alumnus and would not
 * again, or that has not and would not consider one. ONE rule, read by the internal alert
 * email, Needs you / the Action Center and the response drawer.
 * @returns {string[]} one sentence per concern; empty when there is none
 */
export function hiringConcerns({ alumniOutcome, wouldConsiderAlumni } = {}) {
  const out = []
  if (clean(alumniOutcome) === 'would_not_hire_again') out.push('Hired an ASPIRE alumnus and would not hire again')
  if (clean(wouldConsiderAlumni) === 'no') out.push('Would not consider hiring an ASPIRE alumnus')
  return out
}

/** The same rule over a stored unit_cohort_responses row. */
export function responseHiringConcerns(row) {
  if (!row) return []
  return hiringConcerns({
    alumniOutcome: row.aspire_alumni_outcome,
    wouldConsiderAlumni: row.would_consider_aspire_alumni,
  })
}
