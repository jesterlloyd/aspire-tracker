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
import { resolveBodyLinks } from '../lib/server/keith/knowledgeLinks.js'
import { serializeEntryFile, parseEntryFile, entryFilename } from '../lib/server/keith/knowledgeFrontmatter.js'

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

// KNOWLEDGE-VAULT-1 additions. Vocabularies must match the CHECK constraints in
// 20260807000001_knowledge_vault_markdown.sql.
const BODY_FORMATS = ['plain', 'markdown']
const CONFIDENCE = ['verified', 'provisional']
const MAX_ALIASES = 12
const MAX_TAGS = 16
const MAX_TERM = 60          // one alias or tag
const MAX_IMPORT_CHARS = 60000 // one .md file at the import boundary
// Export is bounded so a vault export can never become an unbounded dump.
const MAX_EXPORT_ENTRIES = 500

// Exact top-level key allow-list per action (anything else → 400). Note: slug,
// state, management, current_version, and every actor field are intentionally
// absent from every list, so the client can never supply them.
// KNOWLEDGE-VAULT-1 extends the content-bearing actions with the vault fields.
// slug, state, current_version and every actor field remain absent from every
// list, so the client still cannot supply them.
const VAULT_FIELDS = ['body_format', 'aliases', 'tags', 'review_date', 'confidence']

const ACTION_SCHEMAS = {
  list_entries:           ['action', 'state', 'category', 'tag'],
  get_entry:              ['action', 'entry_id'],
  create_entry_draft:     ['action', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'effective_date', 'expires_at', ...VAULT_FIELDS],
  update_entry_draft:     ['action', 'entry_id', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'effective_date', 'expires_at', ...VAULT_FIELDS],
  submit_entry_revision:  ['action', 'entry_id', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'change_note', ...VAULT_FIELDS],
  get_entry_revision:     ['action', 'entry_id'],
  update_entry_revision:  ['action', 'entry_id', 'title', 'category', 'body', 'source_attribution', 'precedence_rank', 'change_note', ...VAULT_FIELDS],
  discard_entry_revision: ['action', 'entry_id'],

  // KT-2b lifecycle (delegated to RPCs) + version reads (service-role reads)
  activate_entry:         ['action', 'entry_id', 'change_note'],
  apply_entry_revision:   ['action', 'entry_id'],
  restore_entry_version:  ['action', 'entry_id', 'version_number', 'change_note'],
  change_entry_state:     ['action', 'entry_id', 'target_state'],
  list_entry_versions:    ['action', 'entry_id'],
  get_entry_version:      ['action', 'entry_id', 'version_number'],

  // KNOWLEDGE-VAULT-1: link graph + Obsidian-compatible portability.
  // All reads except import_entry_file, which creates a DRAFT and nothing more.
  get_entry_links:        ['action', 'entry_id'],
  link_report:            ['action'],
  export_vault:           ['action', 'state'],
  import_entry_file:      ['action', 'source'],
}

// KT-2b: lifecycle actions are Owner-only (Admin is denied lifecycle but may read
// versions). Version-read actions inherit the KT-2a Owner/Admin read posture.
const LIFECYCLE_ACTIONS = new Set([
  'activate_entry', 'apply_entry_revision', 'restore_entry_version', 'change_entry_state',
])

// Version list projection: metadata only (NO body/content). get returns the full snapshot.
const ENTRY_VERSION_LIST_COLS = 'version_number, change_note, editor_id, created_at'

// List/get projections. Body is omitted from list payloads (lean); full row on get.
// KNOWLEDGE-VAULT-1 adds the vault metadata the table and review queue need.
const ENTRY_LIST_COLS = 'id, title, slug, category, state, precedence_rank, current_version, effective_date, expires_at, created_by, updated_by, created_at, updated_at, body_format, aliases, tags, review_date, confidence, superseded_by'

// The catalog wikilink resolution runs against: every entry, any state, with
// just the fields the resolver needs.
const LINK_CATALOG_COLS = 'id, slug, title, aliases, state'

// ── Helpers ──────────────────────────────────────────────────────────────────
function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(key => !allowedKeys.includes(key))
}

function isNonEmptyString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}
// Present string (may be empty) within cap - used for full revision snapshots.
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
    // user_profiles), so P0107 means that profile id no longer resolves in-RPC -
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
// `mode`: 'create'   - title+category required; body/source/precedence optional
//         'patch'    - every field optional, validated when present (draft update)
//         'snapshot' - full proposed revision; title+category+body+source+rank required
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

// KNOWLEDGE-VAULT-1: validate and NORMALIZE the vault fields.
//
// Normalization matters as much as validation here: aliases and tags are
// matched case-insensitively by retrieval and by wikilink resolution, so
// storing "CS-Link" and "cs-link" as two different aliases would be a silent
// duplicate that inflates nothing and confuses the author. Terms are trimmed,
// de-duplicated case-insensitively, and empties dropped.
//
// Returns { error } or { value } where value carries ONLY the keys the caller
// actually supplied, so a patch never overwrites a field the client omitted.
function validateVaultFields(body) {
  const value = {}

  if (body.body_format !== undefined) {
    if (!BODY_FORMATS.includes(body.body_format)) {
      return { error: { field: 'body_format', message: 'Expected plain or markdown.' } }
    }
    value.body_format = body.body_format
  }

  for (const [key, max] of [['aliases', MAX_ALIASES], ['tags', MAX_TAGS]]) {
    if (body[key] === undefined) continue
    if (!Array.isArray(body[key])) return { error: { field: key, message: 'Expected an array.' } }
    if (body[key].length > max) return { error: { field: key, message: `At most ${max}.` } }
    const seen = new Set()
    const out = []
    for (const raw of body[key]) {
      if (typeof raw !== 'string') return { error: { field: key, message: 'Entries must be strings.' } }
      const term = raw.trim()
      if (!term) continue
      if (term.length > MAX_TERM) return { error: { field: key, message: `Each entry max ${MAX_TERM} characters.` } }
      const norm = term.toLowerCase()
      if (seen.has(norm)) continue
      seen.add(norm)
      out.push(term)
    }
    value[key] = out
  }

  if (body.review_date !== undefined) {
    if (body.review_date !== null && !isValidDateStr(body.review_date)) {
      return { error: { field: 'review_date', message: 'Expected YYYY-MM-DD.' } }
    }
    value.review_date = body.review_date === null ? null : body.review_date
  }

  if (body.confidence !== undefined) {
    if (body.confidence !== null && !CONFIDENCE.includes(body.confidence)) {
      return { error: { field: 'confidence', message: 'Expected verified or provisional.' } }
    }
    value.confidence = body.confidence === null ? null : body.confidence
  }

  return { value }
}

/**
 * KNOWLEDGE-VAULT-1: rebuild the wikilink index for ONE source entry.
 *
 * Delete-then-insert for that source only. This is deliberately not a diff: the
 * link set for one page is a handful of rows, and a full replace cannot leave a
 * stale row behind the way a partial update can.
 *
 * Best-effort by design. A link-index failure must never fail the save that
 * produced it - the body is the governed artifact and is already committed;
 * links are a derived convenience that the next save will rebuild anyway.
 */
async function rebuildEntryLinks(db, entryId, bodyText, requestId) {
  try {
    const { data: catalog, error: cErr } = await db.from('knowledge_entries').select(LINK_CATALOG_COLS)
    if (cErr) throw new Error('catalog_failed')

    const resolved = resolveBodyLinks(bodyText || '', catalog || [], entryId)
    const { error: dErr } = await db.from('knowledge_links').delete().eq('source_entry_id', entryId)
    if (dErr) throw new Error('delete_failed')
    if (!resolved.length) return { ok: true, count: 0 }

    const rows = resolved.map(l => ({
      source_entry_id: entryId,
      target_entry_id: l.targetEntryId,
      target_text: l.target,
      link_label: l.label,
      status: l.status,
      matched_on: l.matchedOn,
    }))
    const { error: iErr } = await db.from('knowledge_links').insert(rows)
    if (iErr) throw new Error('insert_failed')
    return { ok: true, count: rows.length }
  } catch (e) {
    console.warn('[knowledge-admin] link index rebuild failed', { entry_id: entryId, reason: e?.message, request_id: requestId })
    return { ok: false, count: 0 }
  }
}

/** Reindex an entry's links from whatever body is currently stored. */
async function reindexFromStoredBody(db, entryId, requestId) {
  const { data } = await db.from('knowledge_entries').select('body').eq('id', entryId).maybeSingle()
  return rebuildEntryLinks(db, entryId, data?.body || '', requestId)
}

/** Resolve editor/author profile ids to display names for a set of rows. */
async function resolveProfileNames(db, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const map = new Map()
  if (!unique.length) return map
  const { data } = await db.from('user_profiles').select('id, full_name').in('id', unique)
  for (const p of data || []) map.set(p.id, p.full_name || null)
  return map
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

  // (5) role authorization - Owner/Admin for every action (denies co-lead/co_lead/
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
        if (body.tag !== undefined && !isNonEmptyString(body.tag, MAX_TERM)) return res.status(400).json({ error: 'invalid_request', field: 'tag' })
        let q = db.from('knowledge_entries').select(ENTRY_LIST_COLS).order('updated_at', { ascending: false })
        if (body.state !== undefined) q = q.eq('state', body.state)
        if (body.category !== undefined) q = q.eq('category', body.category)
        if (body.tag !== undefined) q = q.contains('tags', [body.tag])
        const { data, error } = await q
        if (error) return res.status(500).json({ error: 'internal_error' })

        // KNOWLEDGE-VAULT-1: the review signal. `expires_at` is reported, NOT
        // enforced - an expired entry still answers in Keith exactly as it did
        // before. Surfacing it here is what makes the later decision to start
        // excluding expired entries an evidence-based one.
        const today = new Date().toISOString().slice(0, 10)
        const entries = (data || []).map(e => ({
          ...e,
          expired: !!(e.expires_at && String(e.expires_at) < today),
          due_for_review: !!(e.review_date && String(e.review_date) <= today),
        }))
        return res.status(200).json({
          entries,
          needs_review_count: entries.filter(e => e.expired || e.due_for_review).length,
        })
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
        const vault = validateVaultFields(body)
        if (vault.error) return res.status(400).json({ error: 'invalid_request', ...vault.error })

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
          // New pages are authored as Markdown unless the caller says otherwise.
          // Existing pages are untouched and stay 'plain' (see the migration).
          body_format: 'markdown',
          ...vault.value,
        }
        const { data, error } = await db.from('knowledge_entries').insert(row).select('id, slug, state, category').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'conflict', message: 'Slug already exists; retry.' })
          console.log('[knowledge-admin] create_entry_draft failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        const linkRes = await rebuildEntryLinks(db, data.id, row.body, requestId)
        await emitAudit(db, auth, {
          actionType: 'knowledge_entry_created', entityId: data.id,
          description: 'Created knowledge entry draft',
          metadata: { entry_id: data.id, state: data.state, category: data.category },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: data.id, slug: data.slug, state: data.state, links_indexed: linkRes.count })
      }

      case 'update_entry_draft': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const vErr = validateKnowledgeFields(body, 'patch') // draft update: all fields optional
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })
        const dErr = validateDates(body)
        if (dErr) return res.status(400).json({ error: 'invalid_request', ...dErr })
        const vault = validateVaultFields(body)
        if (vault.error) return res.status(400).json({ error: 'invalid_request', ...vault.error })

        const { data: entry, error: fErr } = await db.from('knowledge_entries').select('id, state, body').eq('id', body.entry_id).maybeSingle()
        if (fErr) return res.status(500).json({ error: 'internal_error' })
        if (!entry) return res.status(404).json({ error: 'not_found' })
        if (entry.state !== 'draft') return res.status(409).json({ error: 'conflict', message: 'Entry is not in draft state.' })

        // Slug is immutable: title may change but slug is never regenerated. Only
        // the provided draft fields are updated; state/current_version untouched.
        const patch = { updated_by: auth.profileId, updated_at: new Date().toISOString(), ...vault.value }
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
        // Reindex against whatever the body is NOW: the patched text when the
        // caller sent one, otherwise the text already stored. Reindexing an
        // unchanged body is cheap and keeps the index correct if a link's
        // TARGET was renamed since the last save.
        const linkRes = await rebuildEntryLinks(db, body.entry_id, body.body !== undefined ? body.body : entry.body, requestId)
        await emitAudit(db, auth, {
          actionType: 'knowledge_entry_updated', entityId: body.entry_id,
          description: 'Updated knowledge entry draft',
          metadata: { entry_id: body.entry_id, state: 'draft' },
          requestId,
        })
        return res.status(200).json({ success: true, entry_id: body.entry_id, links_indexed: linkRes.count })
      }

      // ── Revisions (against ACTIVE entries) ───────────────────────────────
      case 'submit_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const vErr = validateKnowledgeFields(body, 'snapshot')
        if (vErr) return res.status(400).json({ error: 'invalid_request', ...vErr })
        const vault = validateVaultFields(body)
        if (vault.error) return res.status(400).json({ error: 'invalid_request', ...vault.error })

        const { data: entry, error: fErr } = await db.from('knowledge_entries').select('id, state, body_format, aliases, tags, review_date, confidence').eq('id', body.entry_id).maybeSingle()
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
          // A revision is a FULL snapshot of the proposed next state. Any vault
          // field the author did not touch inherits the live entry's value, so
          // applying the revision cannot blank a field the author never saw.
          body_format: entry.body_format,
          aliases: entry.aliases,
          tags: entry.tags,
          review_date: entry.review_date,
          confidence: entry.confidence,
          ...vault.value,
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
        const vault = validateVaultFields(body)
        if (vault.error) return res.status(400).json({ error: 'invalid_request', ...vault.error })

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
          ...vault.value,
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
        // Activation changes no body, but it changes this entry's STATE, which
        // is what the link checker reports on. Reindex so links that point at a
        // now-active page stop being flagged as pointing at a draft.
        await reindexFromStoredBody(db, body.entry_id, requestId)
        return res.status(200).json({ success: true, ...(data || {}) })
      }

      case 'apply_entry_revision': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        const { data, error } = await db.rpc('governance_apply_knowledge_revision', { p_entry_id: body.entry_id, p_actor_profile_id: auth.profileId })
        if (error) return mapGovernanceRpcError(error, res, requestId, { action, entry_id: body.entry_id })
        // The RPC replaced the body, so the link index is now stale. Reindex
        // AFTER the governed transaction committed - never inside it, so a link
        // failure can never roll back an applied revision.
        await reindexFromStoredBody(db, body.entry_id, requestId)
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
        // Restoring replaced the body with an older one, whose links may differ.
        await reindexFromStoredBody(db, body.entry_id, requestId)
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
        // KNOWLEDGE-VAULT-1: resolve the editor to a NAME. History previously
        // showed a raw profile id, which told a reviewer nothing about who made
        // a change. editor_id is still returned so nothing that reads it breaks.
        const names = await resolveProfileNames(db, (data || []).map(v => v.editor_id))
        return res.status(200).json({
          versions: (data || []).map(v => ({ ...v, editor_name: names.get(v.editor_id) || null })),
        })
      }

      case 'get_entry_version': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })
        if (!isPositiveInt(body.version_number)) return res.status(400).json({ error: 'invalid_request', field: 'version_number', message: 'Positive integer required.' })
        const { data, error } = await db.from('knowledge_entry_versions').select('*').eq('entry_id', body.entry_id).eq('version_number', body.version_number).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        const names = await resolveProfileNames(db, [data.editor_id])
        return res.status(200).json({ version: { ...data, editor_name: names.get(data.editor_id) || null } })
      }

      // ── KNOWLEDGE-VAULT-1: link graph ────────────────────────────────────
      case 'get_entry_links': {
        if (!UUID_REGEX.test(String(body.entry_id || ''))) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })

        // Outgoing: what this page points at, with the target's live title and
        // state so the checker can flag a link into a draft or archived page.
        const { data: out, error: oErr } = await db.from('knowledge_links')
          .select('target_text, link_label, status, matched_on, target_entry_id')
          .eq('source_entry_id', body.entry_id)
        if (oErr) return res.status(500).json({ error: 'internal_error' })

        // Incoming: what points AT this page.
        const { data: incoming, error: iErr } = await db.from('knowledge_links')
          .select('source_entry_id, target_text')
          .eq('target_entry_id', body.entry_id)
        if (iErr) return res.status(500).json({ error: 'internal_error' })

        const ids = [
          ...(out || []).map(l => l.target_entry_id),
          ...(incoming || []).map(l => l.source_entry_id),
        ].filter(Boolean)
        const meta = new Map()
        if (ids.length) {
          const { data: rows } = await db.from('knowledge_entries').select('id, title, slug, state').in('id', [...new Set(ids)])
          for (const r of rows || []) meta.set(r.id, r)
        }

        return res.status(200).json({
          outgoing: (out || []).map(l => ({
            target_text: l.target_text, label: l.link_label, status: l.status, matched_on: l.matched_on,
            target: l.target_entry_id ? (meta.get(l.target_entry_id) || null) : null,
          })),
          // Self-links are excluded so a page does not list itself as a backlink.
          backlinks: (incoming || [])
            .filter(l => l.source_entry_id !== body.entry_id)
            .map(l => ({ source: meta.get(l.source_entry_id) || null, target_text: l.target_text }))
            .filter(b => b.source),
        })
      }

      case 'link_report': {
        // Vault-wide health: every unresolved link, plus orphan pages.
        const { data: broken, error: bErr } = await db.from('knowledge_links')
          .select('source_entry_id, target_text, status')
          .neq('status', 'resolved')
        if (bErr) return res.status(500).json({ error: 'internal_error' })

        const { data: entries, error: eErr } = await db.from('knowledge_entries').select('id, title, slug, state')
        if (eErr) return res.status(500).json({ error: 'internal_error' })
        const byId = new Map((entries || []).map(e => [e.id, e]))

        const { data: allLinks, error: lErr } = await db.from('knowledge_links').select('source_entry_id, target_entry_id')
        if (lErr) return res.status(500).json({ error: 'internal_error' })
        const linked = new Set()
        for (const l of allLinks || []) {
          if (l.target_entry_id && l.target_entry_id !== l.source_entry_id) linked.add(l.target_entry_id)
        }

        return res.status(200).json({
          broken: (broken || []).map(l => ({
            source: byId.get(l.source_entry_id) || null, target_text: l.target_text, status: l.status,
          })).filter(b => b.source),
          // An orphan has nothing pointing at it. Draft pages are excluded:
          // a page nobody links to yet is the normal state of a new draft.
          orphans: (entries || []).filter(e => e.state === 'active' && !linked.has(e.id))
            .map(e => ({ id: e.id, title: e.title, slug: e.slug })),
        })
      }

      // ── KNOWLEDGE-VAULT-1: Obsidian-compatible portability ───────────────
      case 'export_vault': {
        if (body.state !== undefined && !STATES.includes(body.state)) return res.status(400).json({ error: 'invalid_request', field: 'state' })
        let q = db.from('knowledge_entries')
          .select('title, slug, category, state, body, body_format, aliases, tags, precedence_rank, source_attribution, effective_date, expires_at, review_date, confidence, current_version')
          .order('slug').limit(MAX_EXPORT_ENTRIES)
        if (body.state !== undefined) q = q.eq('state', body.state)
        const { data, error } = await q
        if (error) return res.status(500).json({ error: 'internal_error' })

        const rows = data || []
        const files = rows.map(e => ({
          filename: entryFilename(e),
          content: serializeEntryFile({ ...e, version: e.current_version }),
        }))
        // Export is a READ. It writes nothing and changes no state, so it is
        // Owner/Admin like every other read here, not a lifecycle action.
        return res.status(200).json({
          files,
          count: files.length,
          truncated: rows.length >= MAX_EXPORT_ENTRIES,
        })
      }

      case 'import_entry_file': {
        if (typeof body.source !== 'string' || !body.source.trim()) {
          return res.status(400).json({ error: 'invalid_request', field: 'source', message: 'Required.' })
        }
        if (body.source.length > MAX_IMPORT_CHARS) {
          return res.status(400).json({ error: 'invalid_request', field: 'source', message: `Max ${MAX_IMPORT_CHARS} characters.` })
        }
        const parsed = parseEntryFile(body.source)
        const title = String(parsed.data.title || '').trim()
        if (!isNonEmptyString(title, MAX_TITLE)) {
          return res.status(400).json({ error: 'invalid_request', field: 'title', message: 'Frontmatter must supply a title.' })
        }
        if (!isCappedString(parsed.body, MAX_BODY)) {
          return res.status(400).json({ error: 'invalid_request', field: 'body', message: 'Max 50000 characters.' })
        }
        const category = CATEGORIES.includes(parsed.data.category) ? parsed.data.category : null
        if (!category) {
          return res.status(400).json({ error: 'invalid_request', field: 'category', message: 'Frontmatter must supply a known category.' })
        }
        // An imported file ALWAYS lands as a DRAFT, whatever its frontmatter
        // claims about state or version. Activation is an act taken in the app,
        // by an Owner, after review - never a property of a file someone sent.
        const candidate = {
          body_format: BODY_FORMATS.includes(parsed.data.body_format) ? parsed.data.body_format : 'markdown',
          aliases: parsed.data.aliases, tags: parsed.data.tags,
          review_date: parsed.data.review_date, confidence: parsed.data.confidence,
        }
        const vault = validateVaultFields(candidate)
        if (vault.error) return res.status(400).json({ error: 'invalid_request', ...vault.error })

        const rank = Number.parseInt(parsed.data.precedence_rank, 10)
        const slugRes = await nextAvailableSlug(db, slugify(title))
        if (slugRes.error) return res.status(500).json({ error: 'internal_error' })

        const row = {
          title, slug: slugRes.slug, category, body: parsed.body,
          source_attribution: isCappedString(parsed.data.source_attribution, MAX_SOURCE) ? parsed.data.source_attribution : '',
          precedence_rank: Number.isInteger(rank) && rank >= 0 ? rank : 100,
          state: 'draft',
          effective_date: isValidDateStr(parsed.data.effective_date) ? parsed.data.effective_date : null,
          expires_at: isValidDateStr(parsed.data.expires_at) ? parsed.data.expires_at : null,
          created_by: auth.profileId, updated_by: auth.profileId,
          ...vault.value,
        }
        const { data, error } = await db.from('knowledge_entries').insert(row).select('id, slug').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'conflict', message: 'Slug already exists; retry.' })
          console.log('[knowledge-admin] import_entry_file failed', { request_id: requestId, errorCode: error.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        await rebuildEntryLinks(db, data.id, row.body, requestId)
        await emitAudit(db, auth, {
          actionType: 'knowledge_entry_created', entityId: data.id,
          description: 'Imported knowledge entry draft from Markdown',
          metadata: { entry_id: data.id, state: 'draft', category, imported: true },
          requestId,
        })
        return res.status(200).json({
          success: true, entry_id: data.id, slug: data.slug, state: 'draft',
          warnings: parsed.warnings,
        })
      }

      default:
        return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' })
    }
  } catch (e) {
    console.log('[knowledge-admin] unexpected error', { action, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
