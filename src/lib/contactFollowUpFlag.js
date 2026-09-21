// CONTACTS-BOOK-3 (Owner, 2026-09-20): the follow-up flag on a contact, and the one place
// that knows how to read and write it. It is the app's canonical ribbon (FlagRibbon), the
// same gesture the Interview Rubric and the Student Chart use, on a third record:
//
//   students.flagged_for_second_interview  bring this candidate back (the rubric)
//   students.flagged_for_followup          come back to this student (the chart)
//   contacts.flagged_for_followup          come back to this person (the address book)
//
// One shared flag per contact that every staff member sees. It carries NO note, and it
// reaches Contacts only: in Classic style the address book's ribbon, its entry mark and
// its Flagged only filter; in Modern style (APPEARANCE-STYLE-1, 2026-09-21) the three
// columns' Flagged tag, row mark and Flagged only. It used to be the book's alone (Owner,
// 2026-09-20); the Appearance brief made Modern keep every feature, flags included.
//
// SHIPPING BEFORE THE COLUMN EXISTS, the student flag's contract.
// supabase/migrations/20260925000000_contact_followup_flag.sql is Owner-gated, so:
// `isContactFlagged` reads an absent column as false, `contactFlagAvailable` tells the
// ribbon to render inert, and `setContactFollowUpFlag` turns the server's 409 into a
// `notEnabled` result. The contacts query selects '*', so applying the migration switches
// the ribbon on with no redeploy.

export const CONTACT_FLAG_COLUMN = 'flagged_for_followup'

/** True only when the column exists AND is set. An absent column is not a flag. */
export function isContactFlagged(contact) {
  return contact?.[CONTACT_FLAG_COLUMN] === true
}

/**
 * Whether this contact came back from a database that has the column at all.
 * `select('*')` omits a column that does not exist, so `undefined` means "not migrated"
 * while `false` means "migrated, not flagged".
 */
export function contactFlagAvailable(contact) {
  return !!contact && contact[CONTACT_FLAG_COLUMN] !== undefined
}

/**
 * Set the flag through the status path of /api/contacts-upsert. The caller passes the
 * session's access token, so this module stays free of the Supabase client and the
 * Address book can import its readers. Resolves to { ok: true, contact } on a write and
 * { ok: false, notEnabled: true } when the migration has not been applied; throws for
 * every other failure so the caller shows a real error.
 */
export async function setContactFollowUpFlag(contactId, flagged, { accessToken, fetchImpl = fetch } = {}) {
  if (!accessToken) throw new Error('Session expired. Please refresh and try again.')
  const res = await fetchImpl('/api/contacts-upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id: contactId, [CONTACT_FLAG_COLUMN]: !!flagged }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.error === 'not_enabled') return { ok: false, notEnabled: true, message: data.message }
  if (!res.ok) throw new Error(data.message || data.error || 'Could not change the follow-up flag')
  return { ok: true, contact: data.contact || null }
}
