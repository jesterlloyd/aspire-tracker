// api/portal/academics-contacts.js
//
// Contacts directory for Nursing Education & Leadership. Every request checks
// the active nursing_academic grant. View grants receive active, allowlisted
// directory data. A contacts_access='manage' grant may create, update,
// deactivate, and reactivate contacts. There is deliberately no DELETE path.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { fetchAllRows } from '../lib/fetchAllRows.js'

const CONTACT_FIELDS = Object.freeze([
  'id', 'full_name', 'preferred_name', 'email', 'phone', 'role', 'category',
  'organization', 'school_name', 'unit_name', 'preferred_contact_method',
  'avatar_url', 'is_active',
])
const WRITABLE_FIELDS = Object.freeze([
  'full_name', 'preferred_name', 'email', 'phone', 'role', 'category',
  'organization', 'school_name', 'unit_name', 'preferred_contact_method',
])
const CATEGORIES = new Set([
  'Academic Partners', 'Unit Leadership', 'Preceptors', 'BNI Team',
  'Nursing Executives', 'Other',
])
const CONTACT_METHODS = new Set(['email', 'phone', 'text', 'teams', 'no_preference'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clean = value => typeof value === 'string' ? value.trim() : ''

function allowlistContact(row) {
  return Object.fromEntries(CONTACT_FIELDS.map(field => [field, row?.[field] ?? null]))
}

function parseContactPayload(body, { create = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_request' }
  const payload = {}
  for (const field of WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const value = clean(body[field])
    payload[field] = value || null
  }
  if (create && !clean(payload.full_name)) return { error: 'full_name_required' }
  if (Object.prototype.hasOwnProperty.call(payload, 'full_name') && !clean(payload.full_name)) return { error: 'full_name_required' }
  if (payload.email && !EMAIL_RE.test(payload.email)) return { error: 'invalid_email' }
  if (payload.category && !CATEGORIES.has(payload.category)) return { error: 'invalid_category' }
  if (payload.preferred_contact_method && !CONTACT_METHODS.has(payload.preferred_contact_method)) return { error: 'invalid_contact_method' }
  if (create && !payload.category) payload.category = 'Other'
  if (!create && typeof body.is_active === 'boolean') payload.is_active = body.is_active
  if (!create && Object.keys(payload).length === 0) return { error: 'no_changes' }
  return { payload }
}

async function readContacts(db, includeInactive = false) {
  return fetchAllRows(
    () => {
      let query = db.from('contacts').select(CONTACT_FIELDS.join(', '))
      if (!includeInactive) query = query.eq('is_active', true)
      return query.order('full_name', { ascending: true })
    },
    'contacts_lookup_failed',
  )
}

async function insertContact(db, payload) {
  const { data, error } = await db.from('contacts')
    .insert({ ...payload, is_active: true })
    .select(CONTACT_FIELDS.join(', '))
    .single()
  if (error) throw error
  return data
}

async function patchContact(db, id, payload) {
  const { data, error } = await db.from('contacts')
    .update(payload)
    .eq('id', id)
    .select(CONTACT_FIELDS.join(', '))
    .maybeSingle()
  if (error) throw error
  return data
}

async function emitContactsAudit(db, actor, action, contact, changes = {}) {
  try {
    await db.from('activity_logs').insert({
      user_id: actor?.id ?? null,
      user_name: actor?.full_name ?? '',
      user_role: 'nursing_academic_contacts_editor',
      action_type: action,
      entity_type: 'contact',
      entity_id: String(contact?.id || ''),
      description: `${actor?.full_name || 'A Contacts Editor'} ${action.replace(/_/g, ' ')} ${contact?.full_name || 'a contact'}`,
      metadata: {
        actor_profile_id: actor?.id ?? null,
        changed_fields: Object.keys(changes).sort(),
        is_active: contact?.is_active !== false,
      },
    })
  } catch (err) {
    console.warn('[academics-contacts] audit failed', err?.message || err)
  }
}

function mutationError(res, err) {
  if (err?.code === '23505') return res.status(409).json({ error: 'contact_conflict' })
  return res.status(500).json({ error: 'internal_error' })
}

export function createAcademicsContactsHandler({
  verifyCaller = verifyPortalNursingAcademicCaller,
  fetchContacts = readContacts,
  createContact = insertContact,
  updateContact = patchContact,
  audit = emitContactsAudit,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    if (req.method === 'GET') {
      try {
        const rows = await fetchContacts(auth.db, auth.canManageContacts === true)
        return res.status(200).json({
          contacts: (rows || []).map(allowlistContact),
          contacts_access: auth.canManageContacts === true ? 'manage' : 'view',
          can_manage_contacts: auth.canManageContacts === true,
        })
      } catch {
        return res.status(500).json({ error: 'internal_error' })
      }
    }

    if (auth.canManageContacts !== true) {
      return res.status(403).json({ error: 'contacts_editor_required' })
    }

    if (req.method === 'POST') {
      const parsed = parseContactPayload(req.body, { create: true })
      if (parsed.error) return res.status(400).json({ error: parsed.error })
      try {
        const contact = await createContact(auth.db, parsed.payload)
        await audit(auth.db, auth.profile, 'contact_created', contact, parsed.payload)
        return res.status(201).json({ contact: allowlistContact(contact) })
      } catch (err) {
        return mutationError(res, err)
      }
    }

    const id = clean(req.body?.id)
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_contact_id' })
    const parsed = parseContactPayload(req.body)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    try {
      const contact = await updateContact(auth.db, id, parsed.payload)
      if (!contact) return res.status(404).json({ error: 'contact_not_found' })
      const action = Object.prototype.hasOwnProperty.call(parsed.payload, 'is_active')
        ? (parsed.payload.is_active ? 'contact_reactivated' : 'contact_deactivated')
        : 'contact_updated'
      await audit(auth.db, auth.profile, action, contact, parsed.payload)
      return res.status(200).json({ contact: allowlistContact(contact) })
    } catch (err) {
      return mutationError(res, err)
    }
  }
}

export default createAcademicsContactsHandler()
