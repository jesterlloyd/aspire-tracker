// src/lib/connect/bulkAudience.js
//
// BULK-EXACT-RECIPIENTS-1 (P0): the Send-to-Many audience model, extracted pure.
//
// THE INCIDENT THIS EXISTS FOR: a bulk send reached 12 recipients when exactly
// 6 were reviewed. The extra recipients were real selections - restored from a
// saved draft and carried across source tabs and filters - that the operator
// could not see. Every rule that decides WHO IS IN THE AUDIENCE now lives here,
// dependency-free, so it is directly testable and the composer cannot drift
// from it.
//
// Contracts:
//   • The audience is exactly the operator's explicit selections, deduped
//     deterministically (Students → Contacts → Paste · Type, first ID-bearing
//     record wins). Nothing here adds a recipient by school, cohort, status,
//     category, or previous send.
//   • 'Select all shown' selects only currently displayed records, and never
//     a 'Not Proceeding' student (they remain individually selectable, with a
//     required acknowledgment at Review).
//   • Hidden selections are first-class: visibleSelectionSplit() reports how
//     many selected recipients the current tab/filter view is NOT showing, so
//     the composer can always display "N selected · M not shown here".
//   • The send payload is a pure projection of the reviewed audience -
//     buildPayloadRecipients() emits one entry per reviewed recipient and
//     nothing else, with status_ack set only for Not Proceeding students the
//     operator explicitly acknowledged.

// Explicit .js extensions: this module is imported by BOTH the Vite client and the Node test
// runner (the audience rules are the tested safety surface), and Node resolves ESM strictly.
import { isValidEmail } from '../notifications/studentRecipient.js'
import { normalizeEmailForLookup } from '../emailUtils.js'
import { dedupeRecipients, firstNameFromName } from '../recipientParse.js'
import { getStudentPreferredFirstName } from '../studentNameFormatters.js'
import { studentEmailForSource } from '../studentBulkEmail.js'

export const NOT_PROCEEDING_STATUS = 'Not Proceeding'

// The explicit Email-source dropdown ('school' | 'personal') decides the recipient email - NOT the
// routing helper. A student without an email for that source is excluded.
export function studentToRecipient(s, source) {
  if (!s) return null
  const email = studentEmailForSource(s, source)
  if (!email) return null
  // Greeting/merge + recipient-facing display honor the student's preferred first name.
  const preferredFirst = getStudentPreferredFirstName(s)
  const name = `${preferredFirst} ${s.last_name || ''}`.trim()
  return {
    email, normEmail: normalizeEmailForLookup(email), name,
    firstName: preferredFirst, school: s.school || null,
    status: s.status || null,
    source: 'student', studentId: s.id, contactId: null,
    emailType: source,
  }
}

export function contactToRecipient(c) {
  if (!c || !isValidEmail(c.email)) return null
  const name = c.preferred_name || c.full_name || ''
  return {
    email: c.email.trim(), normEmail: normalizeEmailForLookup(c.email), name,
    firstName: firstNameFromName(name), school: c.school_name || null,
    organization: c.organization || null,
    source: 'contact', studentId: null, contactId: c.id,
  }
}

/**
 * The combined, deduped audience - the ONE definition of "who gets this send".
 * Selected ids that no longer resolve in the current students/contacts data
 * (a cohort switch, a deleted record) are dropped, never guessed.
 */
export function buildCombinedRecipients({ studentSel, contactSel, picked, students, contacts, emailSource }) {
  const fromStudents = [...studentSel]
    .map(id => studentToRecipient((students || []).find(s => s.id === id), emailSource))
    .filter(Boolean)
  const fromContacts = [...contactSel]
    .map(id => contactToRecipient((contacts || []).find(c => c.id === id)))
    .filter(Boolean)
  // Order matters for the dedupe rule: Students → Contacts → Paste · Type (chips).
  return dedupeRecipients([...fromStudents, ...fromContacts, ...(picked || [])])
}

/**
 * 'Select all shown' policy: only the currently displayed students, and never
 * a Not Proceeding student. Returns the ids eligible for bulk selection.
 */
export function selectableShownStudentIds(filteredStudents) {
  return (filteredStudents || [])
    .filter(s => String(s.status || '') !== NOT_PROCEEDING_STATUS)
    .map(s => s.id)
}

/**
 * How much of the selected audience can the operator SEE right now?
 * A recipient is visible only when the active source tab currently renders a
 * row/chip for it: Students tab rows, Contacts tab rows, or Paste · Type chips.
 * Everything else is hidden - and hidden must never mean silent.
 */
export function visibleSelectionSplit({ recipients, source, filteredStudents, filteredContacts, picked }) {
  const rs = recipients || []
  let isVisible
  if (source === 'students') {
    const shown = new Set((filteredStudents || []).map(s => s.id))
    isVisible = r => r.source === 'student' && r.studentId && shown.has(r.studentId)
  } else if (source === 'contacts') {
    const shown = new Set((filteredContacts || []).map(c => c.id))
    isVisible = r => r.source === 'contact' && r.contactId && shown.has(r.contactId)
  } else {
    const chips = new Set((picked || []).map(p => p.normEmail))
    isVisible = r => chips.has(r.normEmail)
  }
  const visible = rs.filter(isVisible)
  return { visible: visible.length, hidden: rs.length - visible.length }
}

/** The Not Proceeding students in the audience - each requires an explicit Review acknowledgment. */
export function notProceedingRecipients(recipients) {
  return (recipients || []).filter(
    r => r.source === 'student' && String(r.status || '') === NOT_PROCEEDING_STATUS
  )
}

/**
 * The send payload: a pure projection of the reviewed audience. One entry per
 * reviewed recipient, in review order, nothing added, nothing implied.
 * emailType travels only for students; status_ack only for Not Proceeding
 * students, and only when the operator acknowledged them at Review.
 */
export function buildPayloadRecipients(recipients, { ackNotProceeding = false } = {}) {
  return (recipients || []).map(r => ({
    source:    r.source,
    email:     r.email,
    name:      r.name,
    firstName: r.firstName,
    school:    r.school,
    studentId: r.studentId,
    contactId: r.contactId,
    ...(r.source === 'student' ? { emailType: r.emailType } : {}),
    ...(r.source === 'student'
        && String(r.status || '') === NOT_PROCEEDING_STATUS
        && ackNotProceeding === true
      ? { status_ack: true } : {}),
  }))
}
