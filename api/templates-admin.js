// api/templates-admin.js
//
// KT-2a: Governance endpoint foundation for the Templates store (templates +
// template_partials).
//
// SAFE draft + revision management against the KT-1 governance tables
// (templates, template_revisions, template_partials). Owner/Admin only.
// Authorization is SERVER-VERIFIED (WS1 pattern: inline verifyCaller). All table
// access is via the service-role client; RLS on the KT-1 tables denies client
// roles by design.
//
// SCOPE (KT-2a): list/get reads, create/update DRAFTS, submit/update/discard
// PENDING REVISIONS against ACTIVE templates, and partial draft create/update.
// Every action performs a SINGLE core write. NO lifecycle/versioning here: no
// activate, apply, deprecate, archive, restore, and NO writes to
// template_versions or template_partial_versions. Deferred to KT-2b. A revision
// is a FULL proposed snapshot, never a partial diff. `management` is server-set
// to 'governed'; clients can never supply it (and thus cannot create
// code_managed templates).
//
// POST body: { action, ...params }. See ACTION_SCHEMAS for the exact allow-list
// per action; any unexpected top-level or nested key is rejected (400).

import { createClient } from '@supabase/supabase-js'

// ── Constants (must match KT-1 CHECK constraints) ────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATES    = ['draft', 'active', 'deprecated', 'archived']
const AUDIENCES = ['student', 'coordinator', 'preceptor', 'unit_leader', 'internal', 'executive']
const CHANNELS  = ['keith_draft', 'connect_outreach', 'transactional_readonly']
// management vocab is enforced server-side ('governed' default); clients never set it.

// Field caps
const MAX_TITLE = 200
const MAX_PURPOSE = 2000
const MAX_SUBJECT = 500
const MAX_BODY = 50000
const MAX_DESCRIPTION = 2000
const MAX_CHANGE_NOTE = 2000
const MAX_PLACEHOLDER_NAME = 200
const MAX_PLACEHOLDER_DESC = 2000

const PLACEHOLDER_KEYS = ['name', 'description', 'required']

// Exact top-level key allow-list per action. `management`, `state`,
// `current_version`, and every actor field are intentionally absent everywhere.
const ACTION_SCHEMAS = {
  list_templates:            ['action', 'state', 'channel', 'audience'],
  get_template:              ['action', 'template_id'],
  create_template_draft:     ['action', 'title', 'purpose', 'audience', 'channel', 'subject_pattern', 'body', 'placeholder_schema'],
  update_template_draft:     ['action', 'template_id', 'title', 'purpose', 'audience', 'channel', 'subject_pattern', 'body', 'placeholder_schema'],
  submit_template_revision:  ['action', 'template_id', 'title', 'purpose', 'audience', 'channel', 'subject_pattern', 'body', 'placeholder_schema', 'change_note'],
  get_template_revision:     ['action', 'template_id'],
  update_template_revision:  ['action', 'template_id', 'title', 'purpose', 'audience', 'channel', 'subject_pattern', 'body', 'placeholder_schema', 'change_note'],
  discard_template_revision: ['action', 'template_id'],
  list_partials:             ['action', 'state'],
  get_partial:               ['action', 'partial_id'],
  create_partial_draft:      ['action', 'name', 'description', 'body'],
  update_partial_draft:      ['action', 'partial_id', 'name', 'description', 'body'],

  // KT-2b lifecycle (delegated to RPCs) + version reads (service-role reads)
  activate_template:         ['action', 'template_id', 'change_note'],
  apply_template_revision:   ['action', 'template_id'],
  restore_template_version:  ['action', 'template_id', 'version_number', 'change_note'],
  change_template_state:     ['action', 'template_id', 'target_state'],
  list_template_versions:    ['action', 'template_id'],
  get_template_version:      ['action', 'template_id', 'version_number'],
  activate_partial:          ['action', 'partial_id', 'change_note'],
  restore_partial_version:   ['action', 'partial_id', 'version_number', 'change_note'],
  change_partial_state:      ['action', 'partial_id', 'target_state'],
  list_partial_versions:     ['action', 'partial_id'],
  get_partial_version:       ['action', 'partial_id', 'version_number'],
}

// KT-2b: lifecycle actions are Owner-only (Admin denied lifecycle, may read versions).
// Partials have no apply action by design.
const LIFECYCLE_ACTIONS = new Set([
  'activate_template', 'apply_template_revision', 'restore_template_version', 'change_template_state',
  'activate_partial', 'restore_partial_version', 'change_partial_state',
])

// Version list projections: metadata only (NO body/content). get returns full snapshot.
const TEMPLATE_VERSION_LIST_COLS = 'version_number, change_note, editor_id, created_at'
const PARTIAL_VERSION_LIST_COLS  = 'version_number, change_note, editor_id, created_at'

// List projections (body omitted for leanness; full row on get).
const TEMPLATE_LIST_COLS = 'id, title, purpose, audience, channel, subject_pattern, placeholder_schema, management, state, current_version, created_by, updated_by, created_at, updated_at'
const PARTIAL_LIST_COLS = 'id, name, description, state, current_version, created_by, updated_by, created_at, updated_at'

// ── Helpers ──────────────────────────────────────────────────────────────────
function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(key => !allowedKeys.includes(key))
}
function isNonEmptyString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}
function isCappedString(v, max) {
  return typeof v === 'string' && v.length <= max
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0
}

// KT-2b: map a governance RPC's typed exception to a normalized HTTP response.
// Detection mirrors the house pattern (api/shift-log/check-out.js handleRpcError):
// primary on rpcError.code (SQLSTATE), fallback on rpcError.message token. Bodies
// are sanitized (no SQLSTATE/function names/SQL text); full detail to server log only.
function mapGovernanceRpcError(rpcError, res, requestId, ctx) {
  const code = rpcError.code
  const msg = rpcError.message || ''
  const is = (c, token) => code === c || msg.includes(token)

  if (is('P0101', 'governance_target_not_found') ||
      is('P0102', 'governance_revision_not_found') ||
      is('P0103', 'governance_version_not_found')) {
    console.log('[templates-admin] rpc not_found', { ...ctx, code, request_id: requestId })
    return res.status(404).json({ error: 'not_found' })
  }
  if (is('P0104', 'governance_invalid_transition')) {
    console.log('[templates-admin] rpc invalid_transition', { ...ctx, code, request_id: requestId })
    return res.status(409).json({ error: 'conflict', message: 'Invalid state transition.' })
  }
  if (is('P0105', 'governance_archived_terminal')) {
    console.log('[templates-admin] rpc archived_terminal', { ...ctx, code, request_id: requestId })
    return res.status(409).json({ error: 'conflict', message: 'Archived records cannot change state.' })
  }
  if (is('P0106', 'governance_invalid_version_sequence')) {
    console.log('[templates-admin] rpc invalid_version_sequence', { ...ctx, code, request_id: requestId })
    return res.status(409).json({ error: 'conflict', message: 'Version sequence conflict; please retry.' })
  }
  if (is('P0107', 'governance_invalid_actor')) {
    // The endpoint always passes auth.profileId (resolved by verifyCaller); P0107
    // means it no longer resolves in-RPC - a data-integrity anomaly, not a normal
    // client error. Loud server log; sanitized 403 (KT-2a no_profile → 403 parity).
    console.error('[templates-admin] governance_invalid_actor: actor profileId did not resolve in user_profiles (data-integrity anomaly)', { ...ctx, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'Access denied.' })
  }
  console.error('[templates-admin] rpc unexpected error', { ...ctx, code, msg, request_id: requestId })
  return res.status(500).json({ error: 'internal_error' })
}

// placeholder_schema: JSON array; each element an object whose keys are a subset
// of {name, description, required}; name required non-empty string; description
// optional string; required optional boolean.
function validatePlaceholderSchema(v) {
  if (!Array.isArray(v)) return { field: 'placeholder_schema', message: 'Must be a JSON array.' }
  for (let i = 0; i < v.length; i++) {
    const el = v[i]
    if (!isPlainObject(el)) return { field: `placeholder_schema[${i}]`, message: 'Each element must be an object.' }
    const extra = Object.keys(el).filter(k => !PLACEHOLDER_KEYS.includes(k))
    if (extra.length > 0) return { field: `placeholder_schema[${i}].${extra[0]}`, message: 'Unexpected placeholder key.' }
    if (!isNonEmptyString(el.name, MAX_PLACEHOLDER_NAME)) return { field: `placeholder_schema[${i}].name`, message: 'Required non-empty string.' }
    if (el.description !== undefined && !isCappedString(el.description, MAX_PLACEHOLDER_DESC)) return { field: `placeholder_schema[${i}].description`, message: 'Must be a string.' }
    if (el.required !== undefined && typeof el.required !== 'boolean') return { field: `placeholder_schema[${i}].required`, message: 'Must be a boolean.' }
  }
  return null
}

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }

  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  let user
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' }
    user = data.user
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' }
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, full_name')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    return {
      authenticated: true,
      userId: user.id,
      profileId: profile.id,
      role: profile.role || '',
      isOwner: profile.is_owner === true,
      userName: profile.full_name || '',
    }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

function canGovern(role, isOwner) {
  if (isOwner) return true
  return role === 'admin'
}

// Best-effort audit (house pattern: warn + continue on failure, no transaction).
// Actor is the caller's user_profiles.id (profileId), NEVER auth.users.id.
async function emitAudit(db, auth, { actionType, entityType, entityId, description, metadata, requestId }) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: auth.profileId,
      user_name: auth.userName,
      user_role: auth.role,
      action_type: actionType,
      entity_type: entityType,
      entity_id: String(entityId || ''),
      cohort_id: null,
      description,
      metadata: metadata || {},
    })
    if (error) console.warn('[templates-admin] audit insert error', { request_id: requestId, actionType, errorCode: error.code })
  } catch {
    console.warn('[templates-admin] audit insert threw', { request_id: requestId, actionType })
  }
}

// Validate template content fields.
// `mode`: 'create' (title+audience+channel required; rest optional)
//         'patch'  (all optional, validated when present)
//         'snapshot' (full proposed revision: all content fields required)
function validateTemplateFields(body, mode) {
  // title
  if (mode === 'patch') {
    if (body.title !== undefined && !isNonEmptyString(body.title, MAX_TITLE)) return { field: 'title', message: 'Non-empty, max 200 characters.' }
  } else if (!isNonEmptyString(body.title, MAX_TITLE)) {
    return { field: 'title', message: 'Required, non-empty, max 200 characters.' }
  }
  // audience
  if (mode === 'patch') {
    if (body.audience !== undefined && !AUDIENCES.includes(body.audience)) return { field: 'audience', message: 'Invalid audience.' }
  } else if (typeof body.audience !== 'string' || !AUDIENCES.includes(body.audience)) {
    return { field: 'audience', message: 'Invalid audience.' }
  }
  // channel
  if (mode === 'patch') {
    if (body.channel !== undefined && !CHANNELS.includes(body.channel)) return { field: 'channel', message: 'Invalid channel.' }
  } else if (typeof body.channel !== 'string' || !CHANNELS.includes(body.channel)) {
    return { field: 'channel', message: 'Invalid channel.' }
  }

  if (mode === 'snapshot') {
    if (!isCappedString(body.purpose, MAX_PURPOSE)) return { field: 'purpose', message: 'Required string, max 2000 characters.' }
    if (!isCappedString(body.subject_pattern, MAX_SUBJECT)) return { field: 'subject_pattern', message: 'Required string, max 500 characters.' }
    if (!isCappedString(body.body, MAX_BODY)) return { field: 'body', message: 'Required string, max 50000 characters.' }
    const pErr = validatePlaceholderSchema(body.placeholder_schema)
    if (pErr) return pErr
  } else {
    if (body.purpose !== undefined && !isCappedString(body.purpose, MAX_PURPOSE)) return { field: 'purpose', message: 'Max 2000 characters.' }
    if (body.subject_pattern !== undefined && !isCappedString(body.subject_pattern, MAX_SUBJECT)) return { field: 'subject_pattern', message: 'Max 500 characters.' }
    if (body.body !== undefined && !isCappedString(body.body, MAX_BODY)) return { field: 'body', message: 'Max 50000 characters.' }
    if (body.placeholder_schema !== undefined) {
      const pErr = validatePlaceholderSchema(body.placeholder_schema)
      if (pErr) return pErr
    }
  }
  if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) {
    return { field: 'change_note', message: 'Max 2000 characters.' }
  }
  return null
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${Math.random().toString(36).slice(2, 10)}`

  // (1)(2) authenticate caller + resolve profile
  const auth = await verifyCaller(req)
  if (!auth.authenticated) {
    console.log('[templates-admin] auth rejected', { reason: auth.reason, request_id: requestId })
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' })
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
  }

  // (3) body + action present
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action) return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Missing action.' })

  // (4) action allow-list + exact top-level schema
  const allowed = ACTION_SCHEMAS[action]
  if (!allowed) return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' })
  const unexpected = findUnexpectedKeys(body, allowed)
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected request field.' })
  }

  // (5) role authorization - Owner/Admin for every action (denies co-lead/co_lead/
  // interviewer/viewer/no-profile). KT-2b lifecycle actions tighten to Owner-only.
  if (!canGovern(auth.role, auth.isOwner)) {
    console.log('[templates-admin] insufficient authority', { action, callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to perform this action.' })
  }
  if (LIFECYCLE_ACTIONS.has(action) && !auth.isOwner) {
    console.log('[templates-admin] lifecycle requires owner', { action, callerRole: auth.role, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'Only the Owner may perform lifecycle actions.' })
  }

  const db = getDb()

  try {
    switch (action) {
      // ── Template reads ───────────────────────────────────────────────────
      case 'list_templates': {
        if (body.state !== undefined && !STATES.includes(body.state)) return res.status(400).json({ error: 'invalid_request', field: 'state' })
        if (body.channel !== undefined && !CHANNELS.includes(body.channel)) return res.status(400).json({ error: 'invalid_request', field: 'channel' })
        if (body.audience !== undefined && !AUDIENCES.includes(body.audience)) return res.status(400).json({ error: 'invalid_request', field: 'audience' })
        let q = db.from('templates').select(TEMPLATE_LIST_COLS).order('updated_at', { ascending: false })
        if (body.state !== undefined) q = q.eq('state', body.state)
        if (body.channel !== undefined) q = q.eq('channel', body.channel)
        if (body.audience !== undefined) q = q.eq('audience', body.audience)
        const { data, error } = await q
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ templates: data || [] })
      }

      case 'get_template': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const { data, error } = await db.from('templates').select('*').eq('id', body.template_id).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ template: data })
      }

      // ── Template draft create/update ─────────────────────────────────────
      case 'create_template_draft': {
        const vErr = validateTemplateFields(body, 'create')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })
        const row = {
          title: body.title,
          purpose: body.purpose !== undefined ? body.purpose : '',
          audience: body.audience,
          channel: body.channel,
          subject_pattern: body.subject_pattern !== undefined ? body.subject_pattern : '',
          body: body.body !== undefined ? body.body : '',
          placeholder_schema: body.placeholder_schema !== undefined ? body.placeholder_schema : [],
          management: 'governed', // server-set; clients can never create code_managed
          state: 'draft',
          created_by: auth.profileId,
          updated_by: auth.profileId,
        }
        const { data, error } = await db.from('templates').insert(row).select('id, state, channel, audience').maybeSingle()
        if (error) {
          console.log('[templates-admin] create_template_draft failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_created', entityType: 'template', entityId: data.id,
          description: 'Created template draft',
          metadata: { template_id: data.id, state: data.state, channel: data.channel, audience: data.audience },
          requestId,
        })
        return res.status(200).json({ success: true, template_id: data.id, state: data.state })
      }

      case 'update_template_draft': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const vErr = validateTemplateFields(body, 'patch')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })

        const { data: tpl, error: fErr } = await db.from('templates').select('id, state').eq('id', body.template_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!tpl) return res.status(404).json({ error: 'not_found' })
        if (tpl.state !== 'draft') return res.status(409).json({ error: 'conflict', message: 'Template is not in draft state.' })

        const patch = { updated_by: auth.profileId, updated_at: new Date().toISOString() }
        if (body.title !== undefined) patch.title = body.title
        if (body.purpose !== undefined) patch.purpose = body.purpose
        if (body.audience !== undefined) patch.audience = body.audience
        if (body.channel !== undefined) patch.channel = body.channel
        if (body.subject_pattern !== undefined) patch.subject_pattern = body.subject_pattern
        if (body.body !== undefined) patch.body = body.body
        if (body.placeholder_schema !== undefined) patch.placeholder_schema = body.placeholder_schema
        // management/state/current_version are never touched here.

        const { error: uErr } = await db.from('templates').update(patch).eq('id', body.template_id).eq('state', 'draft')
        if (uErr) {
          console.log('[templates-admin] update_template_draft failed', { request_id: requestId, errorCode: uErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_updated', entityType: 'template', entityId: body.template_id,
          description: 'Updated template draft',
          metadata: { template_id: body.template_id, state: 'draft' },
          requestId,
        })
        return res.status(200).json({ success: true, template_id: body.template_id })
      }

      // ── Template revisions (against ACTIVE templates) ────────────────────
      case 'submit_template_revision': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const vErr = validateTemplateFields(body, 'snapshot')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })

        const { data: tpl, error: fErr } = await db.from('templates').select('id, state').eq('id', body.template_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!tpl) return res.status(404).json({ error: 'not_found' })
        if (tpl.state !== 'active') return res.status(409).json({ error: 'conflict', message: 'Revisions may only be submitted against an active template.' })

        const row = {
          template_id: body.template_id,
          title: body.title,
          purpose: body.purpose,
          audience: body.audience,
          channel: body.channel,
          subject_pattern: body.subject_pattern,
          body: body.body,
          placeholder_schema: body.placeholder_schema,
          change_note: body.change_note !== undefined ? body.change_note : '',
          author_id: auth.profileId,
          submitted_at: new Date().toISOString(),
        }
        const { data, error } = await db.from('template_revisions').insert(row).select('id').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'conflict', message: 'A pending revision already exists for this template.' })
          console.log('[templates-admin] submit_template_revision failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_revision_submitted', entityType: 'template', entityId: body.template_id,
          description: 'Submitted template revision',
          metadata: { template_id: body.template_id, revision_id: data.id, ...(body.change_note ? { change_note: body.change_note } : {}) },
          requestId,
        })
        return res.status(200).json({ success: true, template_id: body.template_id, revision_id: data.id })
      }

      case 'get_template_revision': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const { data, error } = await db.from('template_revisions').select('*').eq('template_id', body.template_id).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ revision: data })
      }

      case 'update_template_revision': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const vErr = validateTemplateFields(body, 'snapshot')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })

        const { data: rev, error: fErr } = await db.from('template_revisions').select('id, author_id').eq('template_id', body.template_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!rev) return res.status(404).json({ error: 'not_found' })
        if (!auth.isOwner && rev.author_id !== auth.profileId) {
          return res.status(403).json({ error: 'forbidden', message: 'You may only modify a revision you authored.' })
        }
        const patch = {
          title: body.title,
          purpose: body.purpose,
          audience: body.audience,
          channel: body.channel,
          subject_pattern: body.subject_pattern,
          body: body.body,
          placeholder_schema: body.placeholder_schema,
          change_note: body.change_note !== undefined ? body.change_note : '',
          updated_at: new Date().toISOString(),
        }
        const { error: uErr } = await db.from('template_revisions').update(patch).eq('id', rev.id)
        if (uErr) {
          console.log('[templates-admin] update_template_revision failed', { request_id: requestId, errorCode: uErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_revision_updated', entityType: 'template', entityId: body.template_id,
          description: 'Updated template revision',
          metadata: { template_id: body.template_id, revision_id: rev.id, ...(body.change_note ? { change_note: body.change_note } : {}) },
          requestId,
        })
        return res.status(200).json({ success: true, template_id: body.template_id, revision_id: rev.id })
      }

      case 'discard_template_revision': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const { data: rev, error: fErr } = await db.from('template_revisions').select('id, author_id').eq('template_id', body.template_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!rev) return res.status(404).json({ error: 'not_found' })
        if (!auth.isOwner && rev.author_id !== auth.profileId) {
          return res.status(403).json({ error: 'forbidden', message: 'You may only discard a revision you authored.' })
        }
        const { error: dErr } = await db.from('template_revisions').delete().eq('id', rev.id)
        if (dErr) {
          console.log('[templates-admin] discard_template_revision failed', { request_id: requestId, errorCode: dErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_revision_discarded', entityType: 'template', entityId: body.template_id,
          description: 'Discarded template revision',
          metadata: { template_id: body.template_id, revision_id: rev.id },
          requestId,
        })
        return res.status(200).json({ success: true, template_id: body.template_id })
      }

      // ── Template partials (draft create/update + reads) ──────────────────
      case 'list_partials': {
        if (body.state !== undefined && !STATES.includes(body.state)) return res.status(400).json({ error: 'invalid_request', field: 'state' })
        let q = db.from('template_partials').select(PARTIAL_LIST_COLS).order('name', { ascending: true })
        if (body.state !== undefined) q = q.eq('state', body.state)
        const { data, error } = await q
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ partials: data || [] })
      }

      case 'get_partial': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        const { data, error } = await db.from('template_partials').select('*').eq('id', body.partial_id).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ partial: data })
      }

      case 'create_partial_draft': {
        if (!isNonEmptyString(body.name, MAX_TITLE)) return res.status(400).json({ error: 'invalid_request', field: 'name', message: 'Required, non-empty, max 200 characters.' })
        if (body.description !== undefined && !isCappedString(body.description, MAX_DESCRIPTION)) return res.status(400).json({ error: 'invalid_request', field: 'description', message: 'Max 2000 characters.' })
        if (body.body !== undefined && !isCappedString(body.body, MAX_BODY)) return res.status(400).json({ error: 'invalid_request', field: 'body', message: 'Max 50000 characters.' })
        const row = {
          name: body.name,
          description: body.description !== undefined ? body.description : '',
          body: body.body !== undefined ? body.body : '',
          state: 'draft',
          created_by: auth.profileId,
          updated_by: auth.profileId,
        }
        const { data, error } = await db.from('template_partials').insert(row).select('id, state').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'conflict', message: 'A partial with this name already exists.' })
          console.log('[templates-admin] create_partial_draft failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_partial_created', entityType: 'template_partial', entityId: data.id,
          description: 'Created template partial draft',
          metadata: { partial_id: data.id, state: data.state },
          requestId,
        })
        return res.status(200).json({ success: true, partial_id: data.id, state: data.state })
      }

      case 'update_partial_draft': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        if (body.name !== undefined && !isNonEmptyString(body.name, MAX_TITLE)) return res.status(400).json({ error: 'invalid_request', field: 'name', message: 'Non-empty, max 200 characters.' })
        if (body.description !== undefined && !isCappedString(body.description, MAX_DESCRIPTION)) return res.status(400).json({ error: 'invalid_request', field: 'description', message: 'Max 2000 characters.' })
        if (body.body !== undefined && !isCappedString(body.body, MAX_BODY)) return res.status(400).json({ error: 'invalid_request', field: 'body', message: 'Max 50000 characters.' })

        const { data: partial, error: fErr } = await db.from('template_partials').select('id, state').eq('id', body.partial_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!partial) return res.status(404).json({ error: 'not_found' })
        if (partial.state !== 'draft') return res.status(409).json({ error: 'conflict', message: 'Partial is not in draft state.' })

        const patch = { updated_by: auth.profileId, updated_at: new Date().toISOString() }
        if (body.name !== undefined) patch.name = body.name
        if (body.description !== undefined) patch.description = body.description
        if (body.body !== undefined) patch.body = body.body

        const { error: uErr } = await db.from('template_partials').update(patch).eq('id', body.partial_id).eq('state', 'draft')
        if (uErr) {
          if (uErr.code === '23505') return res.status(409).json({ error: 'conflict', message: 'A partial with this name already exists.' })
          console.log('[templates-admin] update_partial_draft failed', { request_id: requestId, errorCode: uErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'template_partial_updated', entityType: 'template_partial', entityId: body.partial_id,
          description: 'Updated template partial draft',
          metadata: { partial_id: body.partial_id, state: 'draft' },
          requestId,
        })
        return res.status(200).json({ success: true, partial_id: body.partial_id })
      }

      // ── KT-2b template lifecycle (delegated to RPCs) ──────────────────────────
      case 'activate_template': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) return res.status(400).json({ error: 'invalid_request', field: 'change_note', message: 'Max 2000 characters.' })
        const params = { p_template_id: body.template_id, p_actor_profile_id: auth.profileId }
        if (body.change_note !== undefined) params.p_change_note = body.change_note
        const { data, error } = await db.rpc('governance_activate_template', params)
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, template_id: body.template_id })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'apply_template_revision': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const { data, error } = await db.rpc('governance_apply_template_revision', { p_template_id: body.template_id, p_actor_profile_id: auth.profileId })
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, template_id: body.template_id })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'restore_template_version': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) return res.status(400).json({ error: 'invalid_request', field: 'change_note', message: 'Max 2000 characters.' })
        const params = { p_template_id: body.template_id, p_version_number: body.version_number, p_actor_profile_id: auth.profileId }
        if (body.change_note !== undefined) params.p_change_note = body.change_note
        const { data, error } = await db.rpc('governance_restore_template_version', params)
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, template_id: body.template_id, version_number: body.version_number })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'change_template_state': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        if (typeof body.target_state !== 'string' || !STATES.includes(body.target_state)) return res.status(400).json({ error: 'invalid_request', field: 'target_state' })
        const { data, error } = await db.rpc('governance_change_template_state', { p_template_id: body.template_id, p_target_state: body.target_state, p_actor_profile_id: auth.profileId })
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, template_id: body.template_id, target_state: body.target_state })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      // ── KT-2b template version reads (service-role reads; no RPC) ──────────────
      case 'list_template_versions': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        const { data: tpl, error: pErr } = await db.from('templates').select('id').eq('id', body.template_id).maybeSingle()
        if (pErr) return res.status(500).json({ error: 'internal_error' })
        if (!tpl) return res.status(404).json({ error: 'not_found' })
        const { data, error } = await db.from('template_versions').select(TEMPLATE_VERSION_LIST_COLS).eq('template_id', body.template_id).order('version_number', { ascending: false })
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ versions: data || [] })
      }

      case 'get_template_version': {
        if (!UUID_REGEX.test(String(body.template_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'template_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        const { data, error } = await db.from('template_versions').select('*').eq('template_id', body.template_id).eq('version_number', body.version_number).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ version: data })
      }

      // ── KT-2b partial lifecycle (delegated to RPCs; no apply by design) ───────
      case 'activate_partial': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) return res.status(400).json({ error: 'invalid_request', field: 'change_note', message: 'Max 2000 characters.' })
        const params = { p_partial_id: body.partial_id, p_actor_profile_id: auth.profileId }
        if (body.change_note !== undefined) params.p_change_note = body.change_note
        const { data, error } = await db.rpc('governance_activate_template_partial', params)
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, partial_id: body.partial_id })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'restore_partial_version': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) return res.status(400).json({ error: 'invalid_request', field: 'change_note', message: 'Max 2000 characters.' })
        const params = { p_partial_id: body.partial_id, p_version_number: body.version_number, p_actor_profile_id: auth.profileId }
        if (body.change_note !== undefined) params.p_change_note = body.change_note
        const { data, error } = await db.rpc('governance_restore_template_partial_version', params)
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, partial_id: body.partial_id, version_number: body.version_number })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'change_partial_state': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        if (typeof body.target_state !== 'string' || !STATES.includes(body.target_state)) return res.status(400).json({ error: 'invalid_request', field: 'target_state' })
        const { data, error } = await db.rpc('governance_change_template_partial_state', { p_partial_id: body.partial_id, p_target_state: body.target_state, p_actor_profile_id: auth.profileId })
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, partial_id: body.partial_id, target_state: body.target_state })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      // ── KT-2b partial version reads (service-role reads; no RPC) ──────────────
      case 'list_partial_versions': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        const { data: partial, error: pErr } = await db.from('template_partials').select('id').eq('id', body.partial_id).maybeSingle()
        if (pErr) return res.status(500).json({ error: 'internal_error' })
        if (!partial) return res.status(404).json({ error: 'not_found' })
        const { data, error } = await db.from('template_partial_versions').select(PARTIAL_VERSION_LIST_COLS).eq('partial_id', body.partial_id).order('version_number', { ascending: false })
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ versions: data || [] })
      }

      case 'get_partial_version': {
        if (!UUID_REGEX.test(String(body.partial_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'partial_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        const { data, error } = await db.from('template_partial_versions').select('*').eq('partial_id', body.partial_id).eq('version_number', body.version_number).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ version: data })
      }

      default:
        return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' })
    }
  } catch (e) {
    console.log('[templates-admin] unexpected error', { action, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
