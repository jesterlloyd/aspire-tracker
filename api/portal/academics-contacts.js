// api/portal/academics-contacts.js
//
// Read-only ASPIRE Contacts directory for the Nursing Education & Leadership
// portal. An active nursing_academic grant is verified on every request.
// The response is deliberately allowlisted and excludes notes, history,
// internal metadata, and every write or messaging capability.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { fetchAllRows } from '../lib/fetchAllRows.js'

const ALLOWED_FIELDS = Object.freeze([
  'id', 'full_name', 'preferred_name', 'email', 'phone', 'role', 'category',
  'organization', 'school_name', 'unit_name', 'preferred_contact_method',
])

function allowlistContact(row) {
  return Object.fromEntries(ALLOWED_FIELDS.map(field => [field, row?.[field] ?? null]))
}

async function readContacts(db) {
  return fetchAllRows(
    () => db.from('contacts')
      .select(ALLOWED_FIELDS.join(', '))
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    'contacts_lookup_failed',
  )
}

export function createAcademicsContactsHandler({
  verifyCaller = verifyPortalNursingAcademicCaller,
  fetchContacts = readContacts,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    try {
      const rows = await fetchContacts(auth.db)
      return res.status(200).json({ contacts: (rows || []).map(allowlistContact) })
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createAcademicsContactsHandler()
