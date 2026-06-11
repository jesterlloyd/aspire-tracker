// api/knowledge-admin.js
//
// KT-2a: Governance endpoint foundation for the Keith Knowledge Center.
//
// SAFE draft + revision management against the KT-1 governance tables
// (knowledge_entries, knowledge_revisions). Owner/Admin only. Authorization is
// SERVER-VERIFIED (WS1 pattern: inline verifyCaller). All table access is via
// the service-role client; RLS on the KT-1 tables denies client roles by design.
//
// SCOPE (KT-2a): list/get reads, create/update DRAFTS, and submit/update/discard
// PENDING REVISIONS against ACTIVE entries. Every action performs a SINGLE core
// write (one insert OR one update OR one delete). NO lifecycle/versioning here:
// no activate, apply, deprecate, archive, restore, and NO writes to
// knowledge_entry_versions. Those are deferred to KT-2b (which needs a
// transaction/RPC decision). A revision is a FULL proposed snapshot, never a
// partial diff.
//
// POST body: { action, ...params }. See ACTION_SCHEMAS for the exact allow-list
// per action; any unexpected top-level or nested key is rejected (400).

import { createClient } from '@supabase/supabase-js'

// ── Constants (must match KT-1 CHECK constraints) ────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const STATES     = ['draft', 'active', 'deprecated', 'archived']
const CATEGORIES = [
  'program_overview', 'eligibility_placement', 'interview_selection',
  'rotations_matching', 'student_requirements', 'communication_guidance',
  'terminology_navigation', 'faq',
]

// Field caps
const MAX_TITLE = 200
const MAX_BODY = 50000
const MAX_SOURCE = 2000
const MAX_CHANGE_NOTE = 2000

// Exact top-level key allow-list per action (anything else → 400). Note: slug,
// state, management, current_version, and every actor field are intentionally
// absent from every list, so the client can never supply them.
const ACTION_SCHEMAS = {
  list_entries:           ['action', 'state', 'category'],
  get_entry:              ['action', 'entry_id'],
  create_entry_draft:     ['action', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'effective_date', 'expires_at'],
  update_entry_draft:     ['action', 'entry_id', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'effective_date', 'expires_at'],
  submit_entry_revision:  ['action', 'entry_id', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'change_note'],
  get_entry_revision:     ['action', 'entry_id'],
  update_entry_revision:  ['action', 'entry_id', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'change_note'],
  discard_entry_revision: ['action', 'entry_id'],

  // KT-2b lifecycle (delegated to RPCs) + version reads (service-role reads)
  activate_entry:         ['action', 'entry_id', 'change_note'],
  apply_entry_revision:   ['action', 'entry_id'],
  restore_entry_version:  ['action', 'entry_id', 'version_number', 'change_note'],
  change_entry_state:     ['action', 'entry_id', 'target_state'],
  list_entry_versions:    ['action', 'entry_id'],
  get_entry_version:      ['action', 'entry_id', 'version_number'],
}

// KT-2b: lifecycle actions are Owner-only (Admin is denied lifecycle but may read
// versions). Version-read actions inherit the KT-2a Owner/Admin read posture.
const LIFECYCLE_ACTIONS = new Set([
  'activate_entry', 'apply_entry_revision', 'restore_entry_version', 'change_entry_state',
])

// Version list projection: metadata only (NO body/content). get returns the full snapshot.
const ENTRY_VERSION_LIST_COLS = 'version_number, change_note, editor_id, created_at'

// List/get projections. Body is omitted from list payloads (lean); full row on get.
const ENTRY_LIST_COLS = 'id, title, slug, category, state, precedence_rank, current_version, effective_date, expires_at, created_by, updated_by, created_at, updated_at'

// ── Helpers ──────────────────────────────────────────────────────────────────
function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(key => !allowedKeys.includes(key))
}

function isNonEmptyString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}
// Present string (may be empty) within cap — used for full revision snapshots.
function isCappedString(v, max) {
  return typeof v === 'string' && v.length <= max
}
function isValidDateStr(v) {
  if (typeof v !== 'string' || !DATE_REGEX.test(v)) return false
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t)
}
function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0
}

// KT-2b: map a governance RPC's typed exception to a normalized HTTP response.
// Detection mirrors the house pattern (api/shift-log/check-out.js handleRpcError):
// primary on rpcError.code (SQLSTATE), fallback on rpcError.message token. Response
// bodies are sanitized (no SQLSTATE, function names, or SQL text). Full detail goes
// to the server log only.
function mapGovernanceRpcError(rpcError, res, requestId, ctx) {
  const code = rpcError.code
  const msg = rpcError.message || ''
  const is = (c, token) => code === c || msg.includes(token)

  if (is('P0101', 'governance_target_not_found') ||
      is('P0102', 'governance_revision_not_found') ||
      is('P0103', 'governance_version_not_found')) {
    console.log('[knowledge-admin] rpc not_found', { ...ctx, code, request_id: requestId })
    return res.status(404).json({ error: 'not_found' })
  }
  if (is('P0104', 'governance_invalid_transition')) {
    console.log('[knowledge-admin] rpc invalid_transition', { ...ctx, code, request_id: requestId })
    return res.status(409).json({ error: 'conflict', message: 'Invalid state transition.' })
  }
  if (is('P0105', 'governance_archived_terminal')) {
    console.log('[knowledge-admin] rpc archived_terminal', { ...ctx, code, request_id: requestId })
    return res.status(409).json({ error: 'conflict', message: 'Archived records cannot change state.' })
  }
  if (is('P0106', 'governance_invalid_version_sequence')) {
    console.log('[knowledge-admin] rpc invalid_version_sequence', { ...ctx, code, request_id: requestId })
    return res.status(409).json({ error: 'conflict', message: 'Version sequence conflict; please retry.' })
  }
  if (is('P0107', 'governance_invalid_actor')) {
    // The endpoint always passes auth.profileId (resolved by verifyCaller from
    // user_profiles), so P0107 means that profile id no longer resolves in-RPC —
    // a data-integrity anomaly (e.g. orphaned/removed profile), not a normal client
    // error. Loud server log; sanitized 403 to the client (consistent with the
    // KT-2a no_profile → 403 convention for an invalid principal).
    console.error('[knowledge-admin] governance_invalid_actor: actor profileId did not resolve in user_profiles (data-integrity anomaly)', { ...ctx, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'Access denied.' })
  }
  console.error('[knowledge-admin] rpc unexpected error', { ...ctx, code, msg, request_id: requestId })
  return res.status(500).json({ error: 'internal_error' })
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

// Governance v1: Owner/Admin only (default deny). Co-lead/co_lead/interviewer/
// viewer/unknown are denied at the action gate.
function canGovern(role, isOwner) {
  if (isOwner) return true
  return role === 'admin'
}

// Best-effort audit. Mirrors the activity_logs shape used by src/lib/logActivity.js.
// Actor is the caller's user_profiles.id (profileId), NEVER auth.users.id. If the
// audit insert fails after the core write succeeded, we warn and continue (house
// pattern: no transaction/RPC). Metadata is PII-free and never contains body text.
async function emitAudit(db, auth, { actionType, entityId, description, metadata, requestId }) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: auth.profileId,
      user_name: auth.userName,
      user_role: auth.role,
      action_type: actionType,
      entity_type: 'knowledge_entry',
      entity_id: String(entityId || ''),
      cohort_id: null,
      description,
      metadata: metadata || {},
    })
    if (error) console.warn('[knowledge-admin] audit insert error', { request_id: requestId, actionType, errorCode: error.code })
  } catch {
    console.warn('[knowledge-admin] audit insert threw', { request_id: requestId, actionType })
  }
}

// slug: lowercase, hyphenated, [a-z0-9-] only; collapse + trim hyphens.
function slugify(title) {
  const base = String(title || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
  return base || 'entry'
}

// Race-safe-enough slug dedup for v1: read existing slugs sharing the base,
// pick the lowest unused numeric suffix. A concurrent insert may still collide
// on the UNIQUE(slug) constraint; the caller maps that 23505 to 409.
async function nextAvailableSlug(db, base) {
  const { data, error } = await db
    .from('knowledge_entries')
    .select('slug')
    .or(`slug.eq.${base},slug.like.${base}-%`)
  if (error) return { error }
  const taken = new Set((data || []).map(r => r.slug))
  if (!taken.has(base)) return { slug: base }
  for (let i = 2; i < 10000; i++) {
    const cand = `${base}-${i}`
    if (!taken.has(cand)) return { slug: cand }
  }
  return { error: { code: 'slug_exhausted' } }
}

// Validate the shared knowledge content fields.
// `mode`: 'create'   — title+category required; body/source/precedence optional
//         'patch'    — every field optional, validated when present (draft update)
//         'snapshot' — full proposed revision; title+category+body+source+rank required
function validateKnowledgeFields(body, mode) {
  // title
  if (mode === 'patch') {
    if (body.title !== undefined && !isNonEmptyString(body.title, MAX_TITLE)) {
      return { field: 'title', message: 'Non-empty, max 200 characters.' }
    }
  } else if (!isNonEmptyString(body.title, MAX_TITLE)) {
    return { field: 'title', message: 'Required, non-empty, max 200 characters.' }
  }
  // category
  if (mode === 'patch') {
    if (body.category !== undefined && !CATEGORIES.includes(body.category)) {
      return { field: 'category', message: 'Invalid category.' }
    }
  } else if (typeof body.category !== 'string' || !CATEGORIES.includes(body.category)) {
    return { field: 'category', message: 'Invalid category.' }
  }
  if (mode === 'snapshot') {
    // Full snapshot: body + source_attribution + precedence_rank must be present.
    if (!isCappedString(body.body, MAX_BODY)) return { field: 'body', message: 'Required string, max 50000 characters.' }
    if (!isCappedString(body.source_attribution, MAX_SOURCE)) return { field: 'source_attribution', message: 'Required string, max 2000 characters.' }
    if (!Number.isInteger(body.precedence_rank) || body.precedence_rank < 0) return { field: 'precedence_rank', message: 'Required integer >= 0.' }
  } else {
    // Draft: optional fields, validated when present.
    if (body.body !== undefined && !isCappedString(body.body, MAX_BODY)) return { field: 'body', message: 'Max 50000 characters.' }
    if (body.source_attribution !== undefined && !isCappedString(body.source_attribution, MAX_SOURCE)) return { field: 'source_attribution', message: 'Max 2000 characters.' }
    if (body.precedence_rank !== undefined && (!Number.isInteger(body.precedence_rank) || body.precedence_rank < 0)) return { field: 'precedence_rank', message: 'Integer >= 0.' }
  }
  if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) {
    return { field: 'change_note', message: 'Max 2000 characters.' }
  }
  return null
}

// effective_date / expires_at validation (knowledge_entries drafts only).
function validateDates(body) {
  if (body.effective_date !== undefined && !isValidDateStr(body.effective_date)) {
    return { field: 'effective_date', message: 'Expected YYYY-MM-DD.' }
  }
  if (body.expires_at !== undefined && !isValidDateStr(body.expires_at)) {
    return { field: 'expires_at', message: 'Expected YYYY-MM-DD.' }
  }
  if (body.effective_date && body.expires_at && body.expires_at < body.effective_date) {
    return { field: 'expires_at', message: 'expires_at must be on or after effective_date.' }
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
    console.log('[knowledge-admin] auth rejected', { reason: auth.reason, request_id: requestId })
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' })
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
  }

  // (3) body present + action present
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action) return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Missing action.' })

  // (4) action allow-list + exact top-level schema for that action
  const allowed = ACTION_SCHEMAS[action]
  if (!allowed) return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' })
  const unexpected = findUnexpectedKeys(body, allowed)
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected request field.' })
  }

  // (5) role authorization — Owner/Admin for every action (denies co-lead/co_lead/
  // interviewer/viewer/no-profile). KT-2b lifecycle actions tighten to Owner-only.
  if (!canGovern(auth.role, auth.isOwner)) {
    console.log('[knowledge-admin] insufficient authority', { action, callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to perform this action.' })
  }
  if (LIFECYCLE_ACTIONS.has(action) && !auth.isOwner) {
    console.log('[knowledge-admin] lifecycle requires owner', { action, callerRole: auth.role, request_id: requestId })
    return res.status(403).json({ error: 'forbidden', message: 'Only the Owner may perform lifecycle actions.' })
  }

  const db = getDb()

  try {
    switch (action) {
      // ── Reads ────────────────────────────────────────────────────────────
      case 'list_entries': {
        if (body.state !== undefined && !STATES.includes(body.state)) return res.status(400).json({ error: 'invalid_request', field: 'state' })
        if (body.category !== undefined && !CATEGORIES.includes(body.category)) return res.status(400).json({ error: 'invalid_request', field: 'category' })
        let q = db.from('knowledge_entries').select(ENTRY_LIST_COLS).order('updated_at', { ascending: false })
        if (body.state !== undefined) q = q.eq('state', body.state)
        if (body.category !== undefined) q = q.eq('category', body.category)
        const { data, error } = await q
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ entries: data || [] })
      }

      case 'get_entry': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const { data, error } = await db.from('knowledge_entries').select('*').eq('id', body.entry_id).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ entry: data })
      }

      // ── Draft create/update ──────────────────────────────────────────────
      case 'create_entry_draft': {
        const vErr = validateKnowledgeFields(body, 'create')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })
        const dErr = validateDates(body)
        if (dErr) return res.status(400).json({ error: 'invalid_request', ...dErr })

        const base = slugify(body.title)
        const slugRes = await nextAvailableSlug(db, base)
        if (slugRes.error) return res.status(500).json({ error: 'internal_error' })

        const row = {
          title: body.title,
          slug: slugRes.slug,
          category: body.category,
          body: body.body !== undefined ? body.body : '',
          source_attribution: body.source_attribution !== undefined ? body.source_attribution : '',
          precedence_rank: body.precedence_rank !== undefined ? body.precedence_rank : 100,
          state: 'draft',
          effective_date: body.effective_date !== undefined ? body.effective_date : null,
          expires_at: body.expires_at !== undefined ? body.expires_at : null,
          created_by: auth.profileId,
          updated_by: auth.profileId,
        }
        const { data, error } = await db.from('knowledge_entries').insert(row).select('id, slug, state, category').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'conflict', message: 'Slug already exists; retry.' })
          console.log('[knowledge-admin] create_entry_draft failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'knowledge_entry_created', entityId: data.id,
          description: 'Created knowledge entry draft',
          metadata: { entry_id: data.id, state: data.state, category: data.category },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: data.id, slug: data.slug, state: data.state })
      }

      case 'update_entry_draft': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const vErr = validateKnowledgeFields(body, 'patch') // draft update: all fields optional
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })
        const dErr = validateDates(body)
        if (dErr) return res.status(400).json({ error: 'invalid_request', ...dErr })

        const { data: entry, error: fErr } = await db.from('knowledge_entries').select('id, state').eq('id', body.entry_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!entry) return res.status(404).json({ error: 'not_found' })
        if (entry.state !== 'draft') return res.status(409).json({ error: 'conflict', message: 'Entry is not in draft state.' })

        // Slug is immutable: title may change but slug is never regenerated. Only
        // the provided draft fields are updated; state/current_version untouched.
        const patch = { updated_by: auth.profileId, updated_at: new Date().toISOString() }
        if (body.title !== undefined) patch.title = body.title
        if (body.category !== undefined) patch.category = body.category
        if (body.body !== undefined) patch.body = body.body
        if (body.source_attribution !== undefined) patch.source_attribution = body.source_attribution
        if (body.precedence_rank !== undefined) patch.precedence_rank = body.precedence_rank
        if (body.effective_date !== undefined) patch.effective_date = body.effective_date
        if (body.expires_at !== undefined) patch.expires_at = body.expires_at

        const { error: uErr } = await db.from('knowledge_entries').update(patch).eq('id', body.entry_id).eq('state', 'draft')
        if (uErr) {
          console.log('[knowledge-admin] update_entry_draft failed', { request_id: requestId, errorCode: uErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'knowledge_entry_updated', entityId: body.entry_id,
          description: 'Updated knowledge entry draft',
          metadata: { entry_id: body.entry_id, state: 'draft' },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: body.entry_id })
      }

      // ── Revisions (against ACTIVE entries) ───────────────────────────────
      case 'submit_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const vErr = validateKnowledgeFields(body, 'snapshot')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })

        const { data: entry, error: fErr } = await db.from('knowledge_entries').select('id, state').eq('id', body.entry_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!entry) return res.status(404).json({ error: 'not_found' })
        if (entry.state !== 'active') return res.status(409).json({ error: 'conflict', message: 'Revisions may only be submitted against an active entry.' })

        const row = {
          entry_id: body.entry_id,
          title: body.title,
          category: body.category,
          body: body.body,
          source_attribution: body.source_attribution,
          precedence_rank: body.precedence_rank,
          change_note: body.change_note !== undefined ? body.change_note : '',
          author_id: auth.profileId,
          submitted_at: new Date().toISOString(),
        }
        const { data, error } = await db.from('knowledge_revisions').insert(row).select('id').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'conflict', message: 'A pending revision already exists for this entry.' })
          console.log('[knowledge-admin] submit_entry_revision failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'knowledge_revision_submitted', entityId: body.entry_id,
          description: 'Submitted knowledge revision',
          metadata: { entry_id: body.entry_id, revision_id: data.id, ...(body.change_note ? { change_note: body.change_note } : {}) },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: body.entry_id, revision_id: data.id })
      }

      case 'get_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const { data, error } = await db.from('knowledge_revisions').select('*').eq('entry_id', body.entry_id).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ revision: data })
      }

      case 'update_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const vErr = validateKnowledgeFields(body, 'snapshot')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })

        const { data: rev, error: fErr } = await db.from('knowledge_revisions').select('id, author_id').eq('entry_id', body.entry_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!rev) return res.status(404).json({ error: 'not_found' })
        // Owner may update any; Admin only their own authored revision.
        if (!auth.isOwner && rev.author_id !== auth.profileId) {
          return res.status(403).json({ error: 'forbidden', message: 'You may only modify a revision you authored.' })
        }
        // Full snapshot replacement (NOT a partial diff). author_id is NOT changed.
        const patch = {
          title: body.title,
          category: body.category,
          body: body.body,
          source_attribution: body.source_attribution,
          precedence_rank: body.precedence_rank,
          change_note: body.change_note !== undefined ? body.change_note : '',
          updated_at: new Date().toISOString(),
        }
        const { error: uErr } = await db.from('knowledge_revisions').update(patch).eq('id', rev.id)
        if (uErr) {
          console.log('[knowledge-admin] update_entry_revision failed', { request_id: requestId, errorCode: uErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'knowledge_revision_updated', entityId: body.entry_id,
          description: 'Updated knowledge revision',
          metadata: { entry_id: body.entry_id, revision_id: rev.id, ...(body.change_note ? { change_note: body.change_note } : {}) },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: body.entry_id, revision_id: rev.id })
      }

      case 'discard_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const { data: rev, error: fErr } = await db.from('knowledge_revisions').select('id, author_id').eq('entry_id', body.entry_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!rev) return res.status(404).json({ error: 'not_found' })
        if (!auth.isOwner && rev.author_id !== auth.profileId) {
          return res.status(403).json({ error: 'forbidden', message: 'You may only discard a revision you authored.' })
        }
        // Deletes ONLY the pending revision row. No parent update, no version write.
        const { error: dErr } = await db.from('knowledge_revisions').delete().eq('id', rev.id)
        if (dErr) {
          console.log('[knowledge-admin] discard_entry_revision failed', { request_id: requestId, errorCode: dErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await emitAudit(db, auth, {
          actionType: 'knowledge_revision_discarded', entityId: body.entry_id,
          description: 'Discarded knowledge revision',
          metadata: { entry_id: body.entry_id, revision_id: rev.id },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: body.entry_id })
      }

      // ── KT-2b lifecycle (delegated to RPCs; endpoint performs NO version write,
      //    parent update, revision delete, or activity_logs insert) ──────────────
      case 'activate_entry': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) return res.status(400).json({ error: 'invalid_request', field: 'change_note', message: 'Max 2000 characters.' })
        const params = { p_entry_id: body.entry_id, p_actor_profile_id: auth.profileId }
        if (body.change_note !== undefined) params.p_change_note = body.change_note
        const { data, error } = await db.rpc('governance_activate_knowledge_entry', params)
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, entry_id: body.entry_id })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'apply_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const { data, error } = await db.rpc('governance_apply_knowledge_revision', { p_entry_id: body.entry_id, p_actor_profile_id: auth.profileId })
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, entry_id: body.entry_id })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'restore_entry_version': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        if (body.change_note !== undefined && !isCappedString(body.change_note, MAX_CHANGE_NOTE)) return res.status(400).json({ error: 'invalid_request', field: 'change_note', message: 'Max 2000 characters.' })
        const params = { p_entry_id: body.entry_id, p_version_number: body.version_number, p_actor_profile_id: auth.profileId }
        if (body.change_note !== undefined) params.p_change_note = body.change_note
        const { data, error } = await db.rpc('governance_restore_knowledge_version', params)
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, entry_id: body.entry_id, version_number: body.version_number })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'change_entry_state': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        // Vocabulary check only; transition legality is the RPC's authority.
        if (typeof body.target_state !== 'string' || !STATES.includes(body.target_state)) return res.status(400).json({ error: 'invalid_request', field: 'target_state' })
        const { data, error } = await db.rpc('governance_change_knowledge_state', { p_entry_id: body.entry_id, p_target_state: body.target_state, p_actor_profile_id: auth.profileId })
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, entry_id: body.entry_id, target_state: body.target_state })
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      // ── KT-2b version reads (service-role reads; no RPC) ──────────────────────
      case 'list_entry_versions': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const { data: entry, error: pErr } = await db.from('knowledge_entries').select('id').eq('id', body.entry_id).maybeSingle()
        if (pErr) return res.status(500).json({ error: 'internal_error' })
        if (!entry) return res.status(404).json({ error: 'not_found' })
        const { data, error } = await db.from('knowledge_entry_versions').select(ENTRY_VERSION_LIST_COLS).eq('entry_id', body.entry_id).order('version_number', { ascending: false })
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ versions: data || [] })
      }

      case 'get_entry_version': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        const { data, error } = await db.from('knowledge_entry_versions').select('*').eq('entry_id', body.entry_id).eq('version_number', body.version_number).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        return res.status(200).json({ version: data })
      }

      default:
        return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' })
    }
  } catch (e) {
    console.log('[knowledge-admin] unexpected error', { action, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
