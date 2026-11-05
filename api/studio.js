// api/studio.js
//
// STUDIO-1 (2026-11-05): ASPIRE Connect > Studio's own records. Owner and Admin only, like
// Outreach. Sending is NOT here: a Studio send goes through /api/connect-send-bulk-message with
// body_format 'studio', so every Outreach guard (the reviewed allowlist, Not Proceeding, the demo
// mailer, the log and the archive) applies unchanged.
//
// POST { action, ... }
//   status                         -> { provisioned, images }
//   list                           -> { designs: [{ id, name, status, updated_at, last_sent_at, sends, subject, theme }] }
//   get        { id }              -> { design row }
//   save       { id?, name, design } -> { design row }     (design passes sanitizeDesign)
//   duplicate  { id }              -> { design row }
//   archive    { id }              -> { ok }               (never deleted)
//   mark_sent  { id, batch_ids, sent, skipped, failed } -> { ok }
//   blocks_list                    -> { blocks }
//   block_save { name, block }     -> { block }
//   block_delete { id }            -> { ok }
//   image_upload { filename, type, size } -> { path, token, publicUrl }   (signed upload URL)
//   audience_options, audience_resolve, send_freeze, send_finish
//        STUDIO-2: who gets it (lib/server/studio/studioAudience.js). A rule is resolved through
//        the request's population (populationDb), so a demo session sees demo people only.
//
// Before 20261128000000_studio_designs.sql every action but status answers 409 not_enabled, and
// the screen keeps designs in the browser instead.

import { randomUUID } from 'crypto'
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyOwnerAdmin } from './lib/catalogAuth.js'
import { demoScopeFromRequest, populationDb } from '../lib/server/demoScope.js'
import { getServiceDb } from './lib/portalAuth.js'
import { sanitizeDesign, NAME_MAX } from '../src/lib/studio/studioBlocks.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING = (e) => e && (['42P01', 'PGRST205', '42703'].includes(e.code) || /does not exist|schema cache/i.test(e.message || ''))
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
const IMAGE_MAX = 5 * 1024 * 1024
const BUCKET = 'studio-images'
const MAX_SENDS_KEPT = 25

class StudioError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code }
}
const fail = (status, message, code) => { throw new StudioError(status, message, code) }
const needId = (v) => { if (!UUID.test(String(v || ''))) fail(400, 'A design id is required.') }
const notEnabled = () => fail(409, 'Studio storage is not enabled yet. Designs are kept in this browser until it is.', 'not_enabled')

const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Untitled design'
const LIST_COLS = 'id, name, status, updated_at, created_at, last_sent_at, sends, design'

function summarize(row) {
  if (!row) return row
  return {
    id: row.id, name: row.name, status: row.status, updated_at: row.updated_at, created_at: row.created_at,
    last_sent_at: row.last_sent_at, sends: Array.isArray(row.sends) ? row.sends : [],
    subject: row.design?.subject || '', theme: row.design?.theme || 'navy',
    blockCount: Array.isArray(row.design?.blocks) ? row.design.blocks.length : 0,
  }
}

async function provisioned(db) {
  const { error } = await db.from('studio_designs').select('id').limit(1)
  if (!error) return true
  if (MISSING(error)) return false
  throw error
}

async function run(db, body, ctx) {
  const { profileId, isDemo } = ctx
  const action = String(body.action || '')
  if (action === 'status') {
    const ok = await provisioned(db)
    let audiences = false
    if (ok) {
      const { audiencesProvisioned } = await import('../lib/server/studio/studioAudience.js')
      audiences = await audiencesProvisioned(db)
    }
    return { provisioned: ok, images: ok, audiences }
  }
  if (action.startsWith('audience_') || action.startsWith('send_')) {
    const { runAudienceAction, AUDIENCE_ACTIONS } = await import('../lib/server/studio/studioAudience.js')
    if (!AUDIENCE_ACTIONS.has(action)) fail(400, 'Unknown action.')
    try {
      return await runAudienceAction(action, body, { admin: db, pop: ctx.population(), profileId, isDemo })
    } catch (e) {
      if (e && e.status && e.message) fail(e.status, e.message, e.code)
      throw e
    }
  }

  const guard = (error) => { if (error) { if (MISSING(error)) notEnabled(); throw error } }

  switch (action) {
    case 'list': {
      const { data, error } = await db.from('studio_designs').select(LIST_COLS)
        .eq('is_demo', isDemo).neq('status', 'archived').order('updated_at', { ascending: false }).limit(100)
      guard(error)
      return { designs: (data || []).map(summarize) }
    }
    case 'get': {
      needId(body.id)
      const { data, error } = await db.from('studio_designs').select('*').eq('id', body.id).eq('is_demo', isDemo).maybeSingle()
      guard(error)
      if (!data) fail(404, 'That design is not here.')
      return { design: { ...summarize(data), design: sanitizeDesign(data.design) } }
    }
    case 'save': {
      const design = sanitizeDesign(body.design)
      const name = cleanName(body.name)
      const now = new Date().toISOString()
      if (body.id) {
        needId(body.id)
        const { data, error } = await db.from('studio_designs')
          .update({ name, design, updated_by: profileId, updated_at: now })
          .eq('id', body.id).eq('is_demo', isDemo).neq('status', 'archived').select(LIST_COLS).maybeSingle()
        guard(error)
        if (!data) fail(404, 'That design is not here any more.')
        return { design: { ...summarize(data), design } }
      }
      const { data, error } = await db.from('studio_designs')
        .insert({ name, design, is_demo: isDemo, created_by: profileId, updated_by: profileId })
        .select(LIST_COLS).single()
      guard(error)
      return { design: { ...summarize(data), design } }
    }
    case 'duplicate': {
      needId(body.id)
      const { data: src, error } = await db.from('studio_designs').select('name, design').eq('id', body.id).eq('is_demo', isDemo).maybeSingle()
      guard(error)
      if (!src) fail(404, 'That design is not here.')
      const design = sanitizeDesign(src.design)
      const { data, error: e2 } = await db.from('studio_designs')
        .insert({ name: cleanName(`${src.name} (copy)`), design, is_demo: isDemo, created_by: profileId, updated_by: profileId })
        .select(LIST_COLS).single()
      guard(e2)
      return { design: { ...summarize(data), design } }
    }
    case 'archive': {
      needId(body.id)
      const { error } = await db.from('studio_designs').update({ status: 'archived', updated_by: profileId, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('is_demo', isDemo)
      guard(error)
      return { ok: true }
    }
    case 'mark_sent': {
      needId(body.id)
      const ids = (Array.isArray(body.batch_ids) ? body.batch_ids : []).filter(v => UUID.test(String(v))).slice(0, 40)
      if (!ids.length) fail(400, 'batch_ids are required.')
      const n = (v) => Math.max(0, Math.min(100000, Number.parseInt(v, 10) || 0))
      const { data: row, error } = await db.from('studio_designs').select('sends').eq('id', body.id).eq('is_demo', isDemo).maybeSingle()
      guard(error)
      if (!row) fail(404, 'That design is not here.')
      const at = new Date().toISOString()
      const entry = { at, by: profileId, batch_ids: ids, sent: n(body.sent), skipped: n(body.skipped), failed: n(body.failed) }
      const sends = [entry, ...(Array.isArray(row.sends) ? row.sends : [])].slice(0, MAX_SENDS_KEPT)
      const { error: e2 } = await db.from('studio_designs').update({ sends, status: 'sent', last_sent_at: at, updated_at: at }).eq('id', body.id).eq('is_demo', isDemo)
      guard(e2)
      return { ok: true }
    }
    case 'blocks_list': {
      const { data, error } = await db.from('studio_saved_blocks').select('id, name, block, created_at').eq('is_demo', isDemo).order('name')
      guard(error)
      return { blocks: (data || []).map(r => ({ id: r.id, name: r.name, block: sanitizeDesign({ blocks: [r.block] }).blocks[0] || null })).filter(r => r.block) }
    }
    case 'block_save': {
      const block = sanitizeDesign({ blocks: [body.block] }).blocks[0]
      if (!block) fail(400, 'That block cannot be saved.')
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!name) fail(400, 'Give the block a name.')
      const { data, error } = await db.from('studio_saved_blocks')
        .insert({ name, block, is_demo: isDemo, created_by: profileId }).select('id, name, block').single()
      guard(error)
      return { block: data }
    }
    case 'block_delete': {
      needId(body.id)
      const { error } = await db.from('studio_saved_blocks').delete().eq('id', body.id).eq('is_demo', isDemo)
      guard(error)
      return { ok: true }
    }
    case 'image_upload': {
      if (!(await provisioned(db))) notEnabled()
      const ext = IMAGE_TYPES[String(body.type || '').toLowerCase()]
      if (!ext) fail(400, 'Use a JPEG, PNG, GIF or WebP image.')
      const size = Number(body.size) || 0
      if (size <= 0 || size > IMAGE_MAX) fail(400, 'Images must be 5 MB or smaller.')
      const path = `${isDemo ? 'demo' : 'real'}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) fail(409, 'Image upload is not available yet.', 'not_enabled')
      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
      return { path, token: data.token, publicUrl: pub?.publicUrl || '' }
    }
    default:
      fail(400, 'Unknown action.')
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await verifyOwnerAdmin(req, supabaseAdmin)
  if (!auth.ok) return res.status(auth.status).json(auth.body)
  let body = req.body
  try { body = typeof body === 'string' ? JSON.parse(body) : (body || {}) } catch { return res.status(400).json({ error: 'Invalid request body' }) }
  try {
    const out = await run(supabaseAdmin, body, {
      profileId: auth.profileId, isDemo: demoScopeFromRequest(req) === true,
      // A client of its own, built for this request: populationDb changes the client it wraps.
      population: () => populationDb(getServiceDb(), req),
    })
    return res.status(200).json(out)
  } catch (e) {
    if (e instanceof StudioError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) })
    console.error('[studio] failed:', e?.message || e)
    return res.status(500).json({ error: 'Studio could not do that. Try again.' })
  }
}

export { run as runStudioAction, StudioError }
