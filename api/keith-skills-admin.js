// KEITH-P1: the ONLY write path to keith_skills.
//
// Deliberately the same shape as api/knowledge-admin.js, because that endpoint
// is the house's proven governance pattern: one POST, an { action, ...params }
// body, a strict per-action key allow-list, server-verified identity, Owner/Admin
// for management and Owner-only for lifecycle. Anything not on an action's list
// is a 400, so a client can never smuggle `status`, `enabled`, `version`, or an
// actor id into a request.
//
// Nothing here trusts the client for authorization. `allowed_roles`,
// `required_data`, `model_route`, and the instruction body are governed content:
// they are validated here and are only ever changed on a DRAFT skill.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { isKnownRoute } from '../lib/server/keith/modelRouting.js'
import {
  VALID_ROLES, VALID_DATA_GRANTS, parseSkillPackage, serializeSkillPackage,
  normalizeExternalPackage, composeInstructionBody, splitInstructionBody,
  isValidReferenceName, MAX_REFERENCES,
} from '../lib/server/keith/skillPackage.js'

const INVOCATION_WINDOW_DAYS = 30

// Exact top-level keys each action accepts. Absent from every list, and
// therefore unsettable by any caller: status, enabled, version, slug (after
// create), created_by, updated_by, reviewed_by.
const ACTION_SCHEMAS = {
  list_skills:        [],
  get_skill:          ['skill_id'],
  create_skill_draft: ['slug', 'display_name', 'description', 'allowed_roles', 'required_tools', 'required_data', 'trigger_phrases', 'data_classification', 'model_route', 'instruction_body'],
  update_skill_draft: ['skill_id', 'display_name', 'description', 'allowed_roles', 'required_tools', 'required_data', 'trigger_phrases', 'data_classification', 'model_route', 'instruction_body'],
  import_skill_package: ['source', 'references', 'update_existing'],
  preview_skill_package: ['source', 'references'],
  export_skill_package: ['skill_id'],
  list_skill_versions: ['skill_id'],
  activate_skill:      ['skill_id', 'change_note'],
  change_skill_state:  ['skill_id', 'target_state'],
  set_skill_enabled:   ['skill_id', 'enabled'],
  restore_skill_version: ['skill_id', 'version_number', 'change_note'],
}

// Lifecycle + the kill switch are Owner-only. An Admin may author a draft; only
// an Owner may make one live or take one down.
const OWNER_ONLY_ACTIONS = new Set([
  'activate_skill', 'change_skill_state', 'set_skill_enabled', 'restore_skill_version',
])

const CAPS = { display_name: 120, description: 500, slug: 80, instruction_body: 50000, change_note: 2000 }
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VALID_STATES = ['draft', 'active', 'deprecated', 'archived']
const VALID_CLASSIFICATIONS = ['internal', 'confidential']

// Tool names a skill may declare. Kept in step with KEITH_TOOLS in api/keith.js;
// an undeclarable tool cannot be granted by a skill row.
const VALID_TOOLS = ['search_students', 'get_student_detail', 'get_unit_details', 'get_cohort_summary']

const LIST_COLUMNS = 'id, slug, display_name, description, version, status, enabled, allowed_roles, required_tools, required_data, trigger_phrases, data_classification, model_route, provenance, updated_at'

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

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
    const admin = serviceClient()
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, full_name, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'deactivated' }
    return {
      authenticated: true,
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

function strArray(value, { field, valid, max = 20 }) {
  if (value === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(value)) return { ok: false, error: `${field}_must_be_array` }
  if (value.length > max) return { ok: false, error: `${field}_too_many` }
  const out = []
  for (const raw of value) {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) continue
    if (valid && !valid.includes(v)) return { ok: false, error: `${field}_invalid_value` }
    if (!out.includes(v)) out.push(v)
  }
  return { ok: true, value: out }
}

/** Validate the governed fields shared by create and update. */
function validateSkillFields(body, { requireCore }) {
  const out = {}

  if (requireCore || body.display_name !== undefined) {
    const v = String(body.display_name || '').trim()
    if (!v) return { ok: false, error: 'display_name_required' }
    if (v.length > CAPS.display_name) return { ok: false, error: 'display_name_too_long' }
    out.display_name = v
  }
  if (requireCore || body.description !== undefined) {
    const v = String(body.description || '').trim()
    if (v.length > CAPS.description) return { ok: false, error: 'description_too_long' }
    out.description = v
  }
  if (requireCore || body.instruction_body !== undefined) {
    const v = String(body.instruction_body || '')
    if (v.length > CAPS.instruction_body) return { ok: false, error: 'instruction_body_too_long' }
    out.instruction_body = v
  }

  const roles = strArray(body.allowed_roles, { field: 'allowed_roles', valid: VALID_ROLES })
  if (!roles.ok) return roles
  if (roles.value !== undefined) {
    // Viewer can never hold a skill grant. The DB has the same constraint; this
    // is the friendlier of the two errors.
    if (roles.value.includes('viewer')) return { ok: false, error: 'viewer_not_permitted' }
    out.allowed_roles = roles.value
  }

  const tools = strArray(body.required_tools, { field: 'required_tools', valid: VALID_TOOLS })
  if (!tools.ok) return tools
  if (tools.value !== undefined) out.required_tools = tools.value

  const grants = strArray(body.required_data, { field: 'required_data', valid: VALID_DATA_GRANTS })
  if (!grants.ok) return grants
  if (grants.value !== undefined) out.required_data = grants.value

  const phrases = strArray(body.trigger_phrases, { field: 'trigger_phrases' })
  if (!phrases.ok) return phrases
  if (phrases.value !== undefined) out.trigger_phrases = phrases.value

  if (requireCore || body.data_classification !== undefined) {
    const v = String(body.data_classification || 'internal')
    if (!VALID_CLASSIFICATIONS.includes(v)) return { ok: false, error: 'invalid_data_classification' }
    out.data_classification = v
  }
  if (requireCore || body.model_route !== undefined) {
    const v = String(body.model_route || 'default')
    if (!isKnownRoute(v)) return { ok: false, error: 'invalid_model_route' }
    out.model_route = v
  }

  // A confidential skill that declares no data grant is a configuration error;
  // so is a skill that reads resumes without saying it is confidential.
  const cls = out.data_classification
  const grantList = out.required_data
  if (cls && grantList && grantList.includes('student_resume_read') && cls !== 'confidential') {
    return { ok: false, error: 'resume_access_requires_confidential' }
  }

  return { ok: true, value: out }
}

/** 30-day invocation rollup per skill. Metadata aggregation only. */
async function invocationStats(db, skillIds) {
  const empty = { total: 0, completed: 0, denied: 0, missing_data: 0, error: 0, last_invoked_at: null }
  const byId = new Map(skillIds.map(id => [id, { ...empty }]))
  if (!skillIds.length) return byId
  const since = new Date(Date.now() - INVOCATION_WINDOW_DAYS * 86400000).toISOString()
  const { data, error } = await db
    .from('keith_skill_invocations')
    .select('skill_id, outcome, created_at')
    .in('skill_id', skillIds)
    .gte('created_at', since)
  if (error) return byId
  for (const row of data || []) {
    const s = byId.get(row.skill_id)
    if (!s) continue
    s.total++
    if (Object.prototype.hasOwnProperty.call(s, row.outcome)) s[row.outcome]++
    if (!s.last_invoked_at || row.created_at > s.last_invoked_at) s.last_invoked_at = row.created_at
  }
  return byId
}

function mapRpcError(err) {
  const code = err?.code || ''
  if (code === 'P0101' || code === 'P0103') return { status: 404, error: 'not_found' }
  if (code === 'P0104' || code === 'P0105' || code === 'P0109') return { status: 409, error: 'invalid_transition' }
  if (code === 'P0107') return { status: 403, error: 'invalid_actor' }
  return { status: 500, error: 'internal_error' }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const requestId = `ksa_${randomUUID().slice(0, 8)}`
  const auth = await verifyCaller(req)
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: auth.reason || 'unauthorized' })
  if (!canGovern(auth.role, auth.isOwner)) return res.status(403).json({ error: 'forbidden' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = String(body.action || '')
  const schema = ACTION_SCHEMAS[action]
  if (!schema) return res.status(400).json({ error: 'unknown_action' })

  const extra = Object.keys(body).filter(k => k !== 'action' && !schema.includes(k))
  if (extra.length) return res.status(400).json({ error: 'unexpected_field', field: extra[0] })

  if (OWNER_ONLY_ACTIONS.has(action) && !auth.isOwner) {
    return res.status(403).json({ error: 'owner_required' })
  }

  const db = serviceClient()

  try {
    switch (action) {
      case 'list_skills': {
        const { data, error } = await db.from('keith_skills').select(LIST_COLUMNS).order('display_name')
        if (error) return res.status(500).json({ error: 'internal_error' })
        const stats = await invocationStats(db, (data || []).map(s => s.id))
        return res.status(200).json({
          skills: (data || []).map(s => ({ ...s, stats: stats.get(s.id) })),
        })
      }

      case 'get_skill': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const { data, error } = await db
          .from('keith_skills')
          .select(`${LIST_COLUMNS}, instruction_body, io_contract, owner_label, provenance, created_at, reviewed_at`)
          .eq('id', body.skill_id)
          .maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        const stats = await invocationStats(db, [data.id])
        return res.status(200).json({ skill: { ...data, stats: stats.get(data.id) } })
      }

      case 'create_skill_draft': {
        const slug = String(body.slug || '').trim().toLowerCase()
        if (!slug || !SLUG_RE.test(slug) || slug.length > CAPS.slug) {
          return res.status(400).json({ error: 'invalid_slug' })
        }
        const fields = validateSkillFields(body, { requireCore: true })
        if (!fields.ok) return res.status(400).json({ error: fields.error })
        const { data, error } = await db.from('keith_skills').insert({
          slug, ...fields.value,
          status: 'draft', enabled: false, version: 0,
          created_by: auth.profileId, updated_by: auth.profileId,
          provenance: 'authored in Settings',
        }).select('id, slug').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'slug_taken' })
          return res.status(500).json({ error: 'internal_error' })
        }
        return res.status(200).json({ ok: true, skill: data })
      }

      case 'update_skill_draft': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const { data: current, error: readErr } = await db
          .from('keith_skills').select('id, status').eq('id', body.skill_id).maybeSingle()
        if (readErr) return res.status(500).json({ error: 'internal_error' })
        if (!current) return res.status(404).json({ error: 'not_found' })
        // Governed content changes only on a draft. A live skill changes by
        // authoring a new draft version, never by editing what is running.
        if (current.status !== 'draft') return res.status(409).json({ error: 'not_draft' })

        const fields = validateSkillFields(body, { requireCore: false })
        if (!fields.ok) return res.status(400).json({ error: fields.error })
        const { error } = await db.from('keith_skills')
          .update({ ...fields.value, updated_by: auth.profileId })
          .eq('id', body.skill_id)
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ ok: true })
      }

      // KEITH-SKILL-INSTALL-1: shared parse for preview and import. The client
      // sends TEXT ONLY (SKILL.md source + markdown/text references extracted
      // client-side); binaries and scripts never reach this endpoint. The
      // external-compat pass maps what Keith understands and NAMES what it
      // does not - an unsupported frontmatter key is a warning, never a
      // silently honored capability.
      case 'preview_skill_package':
      case 'import_skill_package': {
        const compat = normalizeExternalPackage(String(body.source || ''))
        const parsed = parseSkillPackage(compat.source)
        if (!parsed.ok) return res.status(400).json({ error: 'invalid_package', details: parsed.errors })

        const rawRefs = Array.isArray(body.references) ? body.references : []
        if (rawRefs.length > MAX_REFERENCES) {
          return res.status(400).json({ error: 'invalid_package', details: [`too many reference files (max ${MAX_REFERENCES})`] })
        }
        const references = []
        const refProblems = []
        for (const r of rawRefs) {
          const name = String(r?.name || '')
          if (!isValidReferenceName(name)) { refProblems.push(`unsupported reference file: ${name || '(unnamed)'}`); continue }
          references.push({ name, content: String(r?.content || '') })
        }
        const s = parsed.skill
        const instructionBody = composeInstructionBody(s.instruction_body, references)
        if (instructionBody.length > CAPS.instruction_body) {
          return res.status(400).json({ error: 'invalid_package', details: [`instructions + references exceed ${CAPS.instruction_body} characters`] })
        }

        // Slug conflict inspection. A built-in skill (anything not previously
        // imported) can NEVER be updated by a package that reuses its slug.
        const { data: existing, error: exErr } = await db.from('keith_skills')
          .select('id, slug, display_name, status, enabled, version, provenance')
          .eq('slug', s.slug).maybeSingle()
        if (exErr) return res.status(500).json({ error: 'internal_error' })
        const existingIsImported = existing ? String(existing.provenance || '').startsWith('imported') : false
        const conflict = existing ? {
          slug: existing.slug, display_name: existing.display_name,
          status: existing.status, enabled: existing.enabled, version: existing.version,
          kind: existingIsImported ? 'imported' : 'builtin',
          updatable: existingIsImported,
        } : null

        const warnings = [
          ...parsed.warnings,
          ...compat.unsupported.map(k => `unsupported frontmatter "${k}" ignored (not a Keith capability)`),
          ...compat.mapped.map(m => `compat: ${m}`),
          ...refProblems,
        ]

        if (action === 'preview_skill_package') {
          return res.status(200).json({
            ok: true,
            preview: {
              slug: s.slug, display_name: s.display_name, description: s.description,
              trigger_phrases: s.trigger_phrases, allowed_roles: s.allowed_roles,
              required_tools: s.required_tools, required_data: s.required_data,
              data_classification: s.data_classification, model_route: s.model_route,
              source_label: s.provenance, owner_label: s.owner_label,
              instruction_chars: s.instruction_body.length,
              references: references.map(r => ({ name: r.name, chars: r.content.length })),
            },
            warnings,
            conflict,
          })
        }

        // IMPORT. Update path: only an explicitly requested update, and only
        // onto a previously IMPORTED skill - never a built-in. Every import
        // lands as a DISABLED DRAFT (the safest existing non-live state),
        // whatever the package or the previous row said.
        const row = {
          display_name: s.display_name, description: s.description,
          allowed_roles: s.allowed_roles, required_tools: s.required_tools,
          required_data: s.required_data, trigger_phrases: s.trigger_phrases,
          data_classification: s.data_classification, model_route: s.model_route,
          instruction_body: instructionBody, owner_label: s.owner_label,
          provenance: `imported: ${s.provenance}`,
          status: 'draft', enabled: false,
          updated_by: auth.profileId,
        }
        if (existing) {
          if (body.update_existing !== true) {
            return res.status(409).json({ error: 'slug_taken', conflict })
          }
          if (!existingIsImported) {
            return res.status(409).json({ error: 'builtin_protected', conflict })
          }
          const { error: upErr } = await db.from('keith_skills').update(row).eq('id', existing.id)
          if (upErr) return res.status(500).json({ error: 'internal_error' })
          return res.status(200).json({ ok: true, skill: { id: existing.id, slug: s.slug }, updated: true, warnings })
        }
        const { data, error } = await db.from('keith_skills').insert({
          ...row, slug: s.slug, version: 0, created_by: auth.profileId,
        }).select('id, slug').maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'slug_taken', conflict })
          return res.status(500).json({ error: 'internal_error' })
        }
        return res.status(200).json({ ok: true, skill: data, updated: false, warnings })
      }

      case 'export_skill_package': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const { data, error } = await db.from('keith_skills')
          .select(`${LIST_COLUMNS}, instruction_body, owner_label, provenance`)
          .eq('id', body.skill_id).maybeSingle()
        if (error) return res.status(500).json({ error: 'internal_error' })
        if (!data) return res.status(404).json({ error: 'not_found' })
        // KEITH-SKILL-INSTALL-1: references leave the same way they arrived -
        // as files beside SKILL.md. The serialized SKILL.md carries only the
        // instructions; splitInstructionBody reconstructs the reference files.
        const parts = splitInstructionBody(data.instruction_body)
        const skillMd = serializeSkillPackage({ ...data, instruction_body: parts.instructions })
        return res.status(200).json({
          ok: true,
          filename: `${data.slug}/SKILL.md`,
          source: skillMd,
          files: [
            { name: `${data.slug}/SKILL.md`, content: skillMd },
            ...parts.references.map(r => ({ name: `${data.slug}/references/${r.name}`, content: r.content })),
          ],
        })
      }

      case 'list_skill_versions': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const { data, error } = await db
          .from('keith_skill_versions')
          .select('version_number, change_note, editor_id, created_at')
          .eq('skill_id', body.skill_id)
          .order('version_number', { ascending: false })
        if (error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ versions: data || [] })
      }

      case 'activate_skill': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const note = String(body.change_note || '').slice(0, CAPS.change_note)
        const { data, error } = await db.rpc('keith_activate_skill', {
          p_skill_id: body.skill_id, p_actor_profile_id: auth.profileId, p_change_note: note,
        })
        if (error) { const m = mapRpcError(error); return res.status(m.status).json({ error: m.error }) }
        const row = Array.isArray(data) ? data[0] : data
        console.log('[keith-skills] activate', { request_id: requestId, skill_id: body.skill_id, version: row?.new_version })
        return res.status(200).json({ ok: true, version: row?.new_version })
      }

      case 'change_skill_state': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const target = String(body.target_state || '')
        if (!VALID_STATES.includes(target)) return res.status(400).json({ error: 'invalid_target_state' })
        const { data, error } = await db.rpc('keith_change_skill_state', {
          p_skill_id: body.skill_id, p_target_state: target, p_actor_profile_id: auth.profileId,
        })
        if (error) { const m = mapRpcError(error); return res.status(m.status).json({ error: m.error }) }
        const row = Array.isArray(data) ? data[0] : data
        console.log('[keith-skills] state', { request_id: requestId, skill_id: body.skill_id, state: row?.new_state })
        return res.status(200).json({ ok: true, state: row?.new_state })
      }

      case 'set_skill_enabled': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled_must_be_boolean' })
        const { data: current, error: readErr } = await db
          .from('keith_skills').select('id, status, slug').eq('id', body.skill_id).maybeSingle()
        if (readErr) return res.status(500).json({ error: 'internal_error' })
        if (!current) return res.status(404).json({ error: 'not_found' })
        // Only an ACTIVE skill can be switched on. Enabling a draft would run
        // unreviewed instructions.
        if (body.enabled && current.status !== 'active') return res.status(409).json({ error: 'not_active' })

        const { error } = await db.from('keith_skills')
          .update({ enabled: body.enabled, updated_by: auth.profileId })
          .eq('id', body.skill_id)
        if (error) return res.status(500).json({ error: 'internal_error' })

        try {
          await db.from('activity_logs').insert({
            user_id: auth.profileId, user_name: auth.userName, user_role: auth.role,
            action_type: body.enabled ? 'keith_skill_enable' : 'keith_skill_disable',
            entity_type: 'keith_skill', entity_id: String(body.skill_id),
            description: `${body.enabled ? 'Enabled' : 'Disabled'} Keith skill ${current.slug}`,
            metadata: { slug: current.slug, enabled: body.enabled },
          })
        } catch { /* audit is best-effort; the state change already succeeded */ }

        return res.status(200).json({ ok: true, enabled: body.enabled })
      }

      case 'restore_skill_version': {
        if (!body.skill_id) return res.status(400).json({ error: 'skill_id_required' })
        const version = Number(body.version_number)
        if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'invalid_version_number' })
        const { data, error } = await db.rpc('keith_restore_skill_version', {
          p_skill_id: body.skill_id, p_version_number: version,
          p_actor_profile_id: auth.profileId, p_change_note: String(body.change_note || '').slice(0, CAPS.change_note),
        })
        if (error) { const m = mapRpcError(error); return res.status(m.status).json({ error: m.error }) }
        const row = Array.isArray(data) ? data[0] : data
        return res.status(200).json({ ok: true, version: row?.new_version })
      }

      default:
        return res.status(400).json({ error: 'unknown_action' })
    }
  } catch (err) {
    console.error('[keith-skills] unhandled', { request_id: requestId, action, reason: err?.message })
    return res.status(500).json({ error: 'internal_error' })
  }
}
