// api/lib/contactStatusUpdate.js
//
// CONTACTS-BOOK-3 (2026-09-20): a contact's STATUS, as opposed to its record. Two fields
// qualify: is_active (Deactivate / Reactivate) and flagged_for_followup (the ribbon).
// Changing either is not an edit of the contact, so the record validation in
// contacts-upsert (a required full_name, the title canon, the derived affiliation, the
// unit catalog) does not apply to it.
//
// Why this exists: contacts-upsert required full_name on EVERY write, updates included,
// and Deactivate / Reactivate send only { id, is_active }. Every one of them was refused
// with "full_name is required", in both Contacts layouts, until this path existed.
//
// The flag's column is Owner-gated (supabase/migrations/20260925000000_contact_followup_flag.sql).
// Until it is applied the write answers 409 not_enabled, and the ribbon renders inert,
// the same contract as the student follow-up flag in api/student-update.js.
//
// Pure apart from the `db` it is handed (a service-role client in production, a fake in
// test/contactsBook.test.mjs), so it is tested without a network.

export const CONTACT_STATUS_FIELDS = Object.freeze(['is_active', 'flagged_for_followup'])

// PostgREST answers an unknown column on UPDATE with PGRST204 (schema cache) and a
// missing column in SQL with 42703; either means the migration has not run.
const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

/** True when the body updates an existing contact and touches nothing but its status. */
export function isContactStatusUpdate(body) {
  if (!body || typeof body !== 'object' || !body.id) return false
  const keys = Object.keys(body).filter(k => k !== 'id')
  return keys.length > 0 && keys.every(k => CONTACT_STATUS_FIELDS.includes(k))
}

/** Resolves to { status, body } for the handler to send. Never throws on a db error. */
export async function applyContactStatusUpdate(db, body) {
  const patch = {}
  for (const key of CONTACT_STATUS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    if (typeof body[key] !== 'boolean') {
      return { status: 400, body: { error: `${key} must be a boolean` } }
    }
    patch[key] = body[key]
  }

  const { data, error } = await db
    .from('contacts')
    .update(patch)
    .eq('id', body.id)
    .select()
    .maybeSingle()

  if (error) {
    if ('flagged_for_followup' in patch && MISSING_COLUMN.has(error.code)) {
      return {
        status: 409,
        body: {
          error: 'not_enabled',
          message: 'The follow-up flag is not enabled yet. Apply supabase/migrations/20260925000000_contact_followup_flag.sql.',
        },
      }
    }
    return { status: 500, body: { error: 'Failed to update contact' } }
  }
  if (!data) return { status: 400, body: { error: 'No contact with that id' } }
  return { status: 200, body: { contact: data } }
}
