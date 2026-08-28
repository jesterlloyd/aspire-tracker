// api/portal/academics-contacts.js
//
// Contacts directory for Nursing Education & Leadership. Every request checks
// the active nursing_academic grant. View grants receive active, allowlisted
// directory data. A contacts_access='manage' grant may create, update,
// deactivate, and reactivate contacts. There is deliberately no DELETE path.
//
// CONTACTS-CANON-1: this endpoint enforces the same canonical vocabulary as
// the staff upsert (api/contacts-upsert.js), from the ONE shared module
// src/lib/contactCategories.js: singular categories (legacy values accepted
// and rewritten), per-category title dropdowns with legacy passthrough,
// derived affiliation, catalog-validated multi-unit (unit_name primary +
// related_units rest), the Services field, and the catalog-validated
// Divisions list (both Nursing Executive + Executive Director only; each 503s
// until its Owner-gated migration adds the column - 20260826 for services,
// 20260829 for divisions).
// preferred_contact_method is retired.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { fetchAllRows } from '../lib/fetchAllRows.js'
import {
  canonicalCategory,
  isTitleAllowed,
  affiliationKind,
  contactServicesMeta,
  showsDivisionsField,
  CSMC_AFFILIATION,
} from '../../src/lib/contactCategories.js'
import { getCanonicalUnitNames } from '../../src/lib/unitCatalog.js'
import { CONTACT_DIVISION_OPTIONS } from '../../src/lib/contactScopeFilter.js'
import { resolveOperativeSchoolName } from '../../src/lib/schoolIdentity.js'

const CONTACT_FIELDS = Object.freeze([
  'id', 'full_name', 'preferred_name', 'email', 'phone', 'role', 'category',
  'organization', 'school_name', 'unit_name', 'related_units', 'services',
  'divisions', 'linkedin_url', 'avatar_url', 'is_active', 'notes',
])
// CONTACTS-EDITOR-PARITY-1: notes are EDITOR-ONLY on read (allowlistContact
// strips them for view grants); avatar_url is writable so the editor's photo
// upload and Remove Photo can persist.
const EDITOR_ONLY_FIELDS = Object.freeze(['notes'])
const WRITABLE_FIELDS = Object.freeze([
  'full_name', 'preferred_name', 'email', 'phone', 'role', 'category',
  'organization', 'school_name', 'unit_name', 'related_units', 'services',
  'divisions', 'linkedin_url', 'avatar_url', 'notes',
])
const CANONICAL_UNIT_NAMES = new Set(getCanonicalUnitNames())
const CANONICAL_DIVISIONS = new Set(CONTACT_DIVISION_OPTIONS)
// Columns behind an Owner SQL gate: named in a SELECT before their migration
// lands, they would error every request. GATED_FIELDS drives both the adaptive
// SELECT list and the write gate, so adding the next one is a one-line change.
const GATED_FIELDS = Object.freeze(['services', 'divisions'])
const READY_ALL = Object.freeze(Object.fromEntries(GATED_FIELDS.map(f => [f, true])))
const READY_NONE = Object.freeze(Object.fromEntries(GATED_FIELDS.map(f => [f, false])))
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clean = value => typeof value === 'string' ? value.trim() : ''

function allowlistContact(row, { includeEditorFields = false } = {}) {
  const fields = includeEditorFields
    ? CONTACT_FIELDS
    : CONTACT_FIELDS.filter(f => !EDITOR_ONLY_FIELDS.includes(f))
  return Object.fromEntries(fields.map(field => [field, row?.[field] ?? null]))
}

function parseContactPayload(body, { create = false, existing = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_request' }
  const payload = {}
  for (const field of WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    if (field === 'related_units' || field === 'divisions') {
      const bad = field === 'divisions' ? 'invalid_divisions' : 'invalid_units'
      const raw = body[field]
      if (raw == null) { payload[field] = [] ; continue }
      if (!Array.isArray(raw) || !raw.every(v => typeof v === 'string')) return { error: bad }
      payload[field] = [...new Set(raw.map(v => v.trim()).filter(Boolean))]
      continue
    }
    const value = clean(body[field])
    payload[field] = value || null
  }
  if (create && !clean(payload.full_name)) return { error: 'full_name_required' }
  if (Object.prototype.hasOwnProperty.call(payload, 'full_name') && !clean(payload.full_name)) return { error: 'full_name_required' }
  if (payload.email && !EMAIL_RE.test(payload.email)) return { error: 'invalid_email' }

  // LinkedIn URL: same rule as the staff upsert (api/contacts-upsert.js) -
  // http(s) scheme and a linkedin.com host. Empty clears the field.
  if (payload.linkedin_url) {
    const url = payload.linkedin_url
    if (!(url.startsWith('http://') || url.startsWith('https://')) || !url.includes('linkedin.com')) {
      return { error: 'invalid_linkedin_url' }
    }
  }

  // Notes: bounded free text (mirrors the staff editor's Notes field).
  if (payload.notes && payload.notes.length > 2000) return { error: 'invalid_notes' }

  // Avatar URL: written by the portal photo-upload endpoint (or cleared by
  // Remove Photo). Anything set must be an http(s) URL.
  if (payload.avatar_url && !/^https?:\/\//.test(payload.avatar_url)) {
    return { error: 'invalid_avatar_url' }
  }

  // Category: canonical singular, legacy accepted and rewritten.
  if (payload.category) {
    const canon = canonicalCategory(payload.category)
    if (!canon) return { error: 'invalid_category' }
    payload.category = canon
  }
  if (create && !payload.category) payload.category = 'Other'
  const effCat = canonicalCategory(
    payload.category !== undefined ? payload.category : existing?.category,
  )

  // Title per the category canon (legacy stored value passes through).
  if (payload.role && effCat && !isTitleAllowed(effCat, payload.role, existing?.role)) {
    return { error: 'invalid_role' }
  }

  // Units against the catalog, existing stored values passing through.
  {
    const storedUnits = new Set([existing?.unit_name, ...(existing?.related_units || [])].filter(Boolean))
    const submitted = []
    if (payload.unit_name) submitted.push(payload.unit_name)
    if (Array.isArray(payload.related_units)) submitted.push(...payload.related_units)
    if (submitted.some(u => !CANONICAL_UNIT_NAMES.has(u) && !storedUnits.has(u))) {
      return { error: 'invalid_unit' }
    }
  }

  // Derived affiliation whenever the request touches it.
  const touchesAffiliation = ['category', 'school_name', 'organization']
    .some(k => payload[k] !== undefined)
  if (effCat && touchesAffiliation) {
    const kind = affiliationKind(effCat)
    if (kind === 'school') {
      const raw = payload.school_name !== undefined ? payload.school_name : existing?.school_name
      if (!raw) return { error: 'school_required' }
      // NA-CONTACTS-SCOPE-1: schools outside the ASPIRE catalog are accepted
      // as typed (the editor's Other option), canonicalized when known. A
      // school that later joins the catalog canonicalizes on its next save.
      const resolved = resolveOperativeSchoolName(raw)
      const school = resolved?.displayName || String(raw).trim()
      if (school.length > 160) return { error: 'invalid_school' }
      payload.school_name = school
      payload.organization = school
    } else if (kind === 'csmc') {
      payload.organization = CSMC_AFFILIATION
      payload.school_name = null
    } else {
      if (payload.school_name) {
        const resolved = resolveOperativeSchoolName(payload.school_name)
        if (resolved) payload.school_name = resolved.displayName
        if (payload.organization == null) payload.organization = payload.school_name
      }
      const orgFinal = payload.organization !== undefined ? payload.organization : existing?.organization
      if (!orgFinal) return { error: 'affiliation_required' }
    }
  }

  // Services: BNI Team (Programs) or Nursing Executive + Executive Director.
  if (payload.services) {
    if (payload.services.length > 200) return { error: 'invalid_services' }
    const effRole = payload.role !== undefined ? payload.role : existing?.role
    if (!contactServicesMeta(effCat, effRole)) return { error: 'invalid_services' }
  }

  // Divisions: catalog-validated, and only where the canon puts the field
  // (Nursing Executive + Executive Director). Clearing to [] is always legal,
  // so a title change away from Executive Director can drop stale divisions.
  if (Array.isArray(payload.divisions) && payload.divisions.length > 0) {
    const effRole = payload.role !== undefined ? payload.role : existing?.role
    if (!showsDivisionsField(effCat, effRole)) return { error: 'invalid_divisions' }
    if (payload.divisions.some(d => !CANONICAL_DIVISIONS.has(d))) return { error: 'invalid_divisions' }
  }

  if (!create && typeof body.is_active === 'boolean') payload.is_active = body.is_active
  if (!create && Object.keys(payload).length === 0) return { error: 'no_changes' }
  return { payload }
}

// The SELECT list adapts to schema readiness: until the 20260826 migration
// adds `services`, naming it in a select would error every request, so the
// pre-migration list omits it and allowlistContact fills null.
function selectList(ready) {
  const fields = CONTACT_FIELDS.filter(f => !GATED_FIELDS.includes(f) || ready?.[f])
  return fields.join(', ')
}

async function readContacts(db, includeInactive = false, ready = READY_ALL) {
  return fetchAllRows(
    () => {
      let query = db.from('contacts').select(selectList(ready))
      if (!includeInactive) query = query.eq('is_active', true)
      return query.order('full_name', { ascending: true })
    },
    'contacts_lookup_failed',
  )
}

async function readContact(db, id) {
  const { data, error } = await db.from('contacts')
    .select('id, category, role, unit_name, related_units, school_name, organization')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

async function insertContact(db, payload, ready = READY_ALL) {
  const { data, error } = await db.from('contacts')
    .insert({ ...payload, is_active: true })
    .select(selectList(ready))
    .single()
  if (error) throw error
  return data
}

async function patchContact(db, id, payload, ready = READY_ALL) {
  const { data, error } = await db.from('contacts')
    .update(payload)
    .eq('id', id)
    .select(selectList(ready))
    .maybeSingle()
  if (error) throw error
  return data
}

// Schema-readiness probe for the Owner-gated columns (services, 20260826;
// divisions, 20260829). One combined SELECT answers both once the migrations
// are in; only a pre-migration schema pays for the per-column fallbacks.
async function probeGatedColumns(db) {
  const { error } = await db.from('contacts').select(GATED_FIELDS.join(', ')).limit(1)
  if (!error) return Object.fromEntries(GATED_FIELDS.map(f => [f, true]))
  const ready = {}
  for (const field of GATED_FIELDS) {
    const probe = await db.from('contacts').select(field).limit(1)
    ready[field] = !probe.error
  }
  return ready
}

// A probe seam may return the object, or a bare boolean meaning "services
// only" (the shape this seam had before divisions existed).
function normalizeReady(result) {
  if (typeof result === 'boolean') return { services: result, divisions: false }
  return Object.fromEntries(GATED_FIELDS.map(f => [f, result?.[f] === true]))
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
  fetchContact = readContact,
  createContact = insertContact,
  updateContact = patchContact,
  probeServices = probeGatedColumns,
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

    // One readiness probe per request drives both the SELECT list and the
    // gated-column write guard.
    let ready = READY_NONE
    try { ready = normalizeReady(await probeServices(auth.db)) } catch { ready = READY_NONE }

    if (req.method === 'GET') {
      try {
        const rows = await fetchContacts(auth.db, auth.canManageContacts === true, ready)
        return res.status(200).json({
          contacts: (rows || []).map(row => allowlistContact(row, { includeEditorFields: auth.canManageContacts === true })),
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

    // Gated-column readiness: a non-empty value fails closed until its
    // migration lands; a clear (null / []) against a pre-migration schema is a
    // no-op, so the field simply is not there yet rather than erroring.
    const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)
    const guardGated = (payload) => {
      for (const field of GATED_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(payload, field)) continue
        if (ready[field]) continue
        if (!isEmpty(payload[field])) return `${field}_unavailable`
        delete payload[field]
      }
      return null
    }

    if (req.method === 'POST') {
      const parsed = parseContactPayload(req.body, { create: true })
      if (parsed.error) return res.status(400).json({ error: parsed.error })
      try {
        const gate = guardGated(parsed.payload)
        if (gate) return res.status(503).json({ error: gate })
        // Pre-migration compatibility: contacts.role is NOT NULL until the
        // 20260826 migration relaxes it; "no title" inserts as ''.
        if (parsed.payload.role == null) parsed.payload.role = ''
        const contact = await createContact(auth.db, parsed.payload, ready)
        await audit(auth.db, auth.profile, 'contact_created', contact, parsed.payload)
        return res.status(201).json({ contact: allowlistContact(contact, { includeEditorFields: true }) })
      } catch (err) {
        return mutationError(res, err)
      }
    }

    const id = clean(req.body?.id)
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_contact_id' })
    let existing
    try {
      existing = await fetchContact(auth.db, id)
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
    if (!existing) return res.status(404).json({ error: 'contact_not_found' })
    const parsed = parseContactPayload(req.body, { existing })
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    try {
      const gate = guardGated(parsed.payload)
      if (gate) return res.status(503).json({ error: gate })
      if (Object.keys(parsed.payload).length === 0) {
        // The only change was a services clear against a pre-migration schema.
        return res.status(400).json({ error: 'no_changes' })
      }
      const contact = await updateContact(auth.db, id, parsed.payload, ready)
      if (!contact) return res.status(404).json({ error: 'contact_not_found' })
      const action = Object.prototype.hasOwnProperty.call(parsed.payload, 'is_active')
        ? (parsed.payload.is_active ? 'contact_reactivated' : 'contact_deactivated')
        : 'contact_updated'
      await audit(auth.db, auth.profile, action, contact, parsed.payload)
      return res.status(200).json({ contact: allowlistContact(contact, { includeEditorFields: true }) })
    } catch (err) {
      return mutationError(res, err)
    }
  }
}

export default createAcademicsContactsHandler()
