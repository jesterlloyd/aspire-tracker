// src/lib/studio/studioClient.js
//
// STUDIO-1: the browser's calls to /api/studio, and the one place that decides where a design is
// kept. Once 20261128000000_studio_designs.sql is applied, designs live on the server for the whole
// team. Before it, they are kept in THIS browser (localStorage) and the screen says so, so Studio
// is usable on both sides of the migration and nothing is lost when it is applied: the first
// server load offers to copy the browser's designs up.
import { supabase } from '../supabase'
import { sanitizeDesign } from './studioBlocks.js'

export class StudioApiError extends Error {
  constructor(status, code, message) { super(message || 'Studio request failed'); this.status = status; this.code = code }
}

async function bearer() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || ''
}

export async function studioApi(action, params = {}) {
  const token = await bearer()
  const res = await fetch('/api/studio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...params }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new StudioApiError(res.status, json?.code, json?.error)
  return json
}

// ── Browser store (before the migration) ────────────────────────────────────────
// Keyed by the signed-in account (S-17 class 'keyed'): unsent drafts must survive a sign-out, and
// another account in the same browser must not read them.
const designsKey = (userKey) => `aspire.studio.designs.v1.${userKey || 'anon'}`
const blocksKey = (userKey) => `aspire.studio.blocks.v1.${userKey || 'anon'}`

function readLocal(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeLocal(key, rows) {
  try { localStorage.setItem(key, JSON.stringify(rows)); return true } catch { return false }
}
const localId = () => `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
export const isLocalId = (id) => String(id || '').startsWith('local-')

function summarizeLocal(r) {
  return {
    id: r.id, name: r.name, status: r.status || 'draft', updated_at: r.updated_at, created_at: r.created_at,
    last_sent_at: r.last_sent_at || null, sends: r.sends || [], subject: r.design?.subject || '',
    theme: r.design?.theme || 'navy', blockCount: r.design?.blocks?.length || 0,
  }
}

/** One interface for both stores. `mode` is 'server' or 'local'. */
export function studioStore(mode, userKey = '') {
  const LOCAL_KEY = designsKey(userKey)
  const LOCAL_BLOCKS_KEY = blocksKey(userKey)
  if (mode === 'server') {
    return {
      mode,
      list: async () => (await studioApi('list')).designs,
      get: async (id) => (await studioApi('get', { id })).design,
      save: async ({ id, name, design }) => (await studioApi('save', { id: id || undefined, name, design })).design,
      duplicate: async (id) => (await studioApi('duplicate', { id })).design,
      archive: async (id) => studioApi('archive', { id }),
      markSent: async (id, result) => studioApi('mark_sent', { id, ...result }),
      blocks: async () => (await studioApi('blocks_list')).blocks,
      saveBlock: async (name, block) => (await studioApi('block_save', { name, block })).block,
      deleteBlock: async (id) => studioApi('block_delete', { id }),
    }
  }
  return {
    mode,
    list: async () => readLocal(LOCAL_KEY).filter(r => r.status !== 'archived')
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map(summarizeLocal),
    get: async (id) => {
      const r = readLocal(LOCAL_KEY).find(x => x.id === id)
      if (!r) throw new StudioApiError(404, null, 'That design is not in this browser.')
      return { ...summarizeLocal(r), design: sanitizeDesign(r.design) }
    },
    save: async ({ id, name, design }) => {
      const rows = readLocal(LOCAL_KEY)
      const now = new Date().toISOString()
      const clean = sanitizeDesign(design)
      const nm = String(name || '').trim().slice(0, 120) || 'Untitled design'
      let row = id ? rows.find(r => r.id === id) : null
      if (row) Object.assign(row, { name: nm, design: clean, updated_at: now })
      else { row = { id: localId(), name: nm, design: clean, status: 'draft', created_at: now, updated_at: now, sends: [] }; rows.push(row) }
      if (!writeLocal(LOCAL_KEY, rows)) throw new StudioApiError(507, null, 'This browser is out of room for designs.')
      return { ...summarizeLocal(row), design: clean }
    },
    duplicate: async (id) => {
      const r = readLocal(LOCAL_KEY).find(x => x.id === id)
      if (!r) throw new StudioApiError(404, null, 'That design is not in this browser.')
      return studioStore('local', userKey).save({ name: `${r.name} (copy)`, design: r.design })
    },
    archive: async (id) => {
      const rows = readLocal(LOCAL_KEY).map(r => r.id === id ? { ...r, status: 'archived' } : r)
      writeLocal(LOCAL_KEY, rows)
      return { ok: true }
    },
    markSent: async (id, result) => {
      const at = new Date().toISOString()
      const rows = readLocal(LOCAL_KEY).map(r => r.id === id
        ? { ...r, status: 'sent', last_sent_at: at, sends: [{ at, ...result }, ...(r.sends || [])].slice(0, 25) } : r)
      writeLocal(LOCAL_KEY, rows)
      return { ok: true }
    },
    blocks: async () => readLocal(LOCAL_BLOCKS_KEY),
    saveBlock: async (name, block) => {
      const rows = readLocal(LOCAL_BLOCKS_KEY)
      const row = { id: localId(), name: String(name).trim().slice(0, 80), block: sanitizeDesign({ blocks: [block] }).blocks[0] }
      writeLocal(LOCAL_BLOCKS_KEY, [...rows, row])
      return row
    },
    deleteBlock: async (id) => { writeLocal(LOCAL_BLOCKS_KEY, readLocal(LOCAL_BLOCKS_KEY).filter(r => r.id !== id)); return { ok: true } },
  }
}

/** Designs kept in this browser, for the one-time copy to the server after the migration. */
export function localDesignsToCopy(userKey) {
  return readLocal(designsKey(userKey)).filter(r => r.status !== 'archived')
}
export function clearLocalDesigns(userKey, ids) {
  const set = new Set(ids)
  writeLocal(designsKey(userKey), readLocal(designsKey(userKey)).filter(r => !set.has(r.id)))
}

/** Upload an image to the public studio-images bucket; resolves to its public https URL. */
export async function uploadStudioImage(file) {
  const { path, token, publicUrl } = await studioApi('image_upload', { filename: file.name, type: file.type, size: file.size })
  const { error } = await supabase.storage.from('studio-images').uploadToSignedUrl(path, token, file, { contentType: file.type })
  if (error) throw new StudioApiError(500, null, 'The image did not upload. Try again.')
  return publicUrl
}

/** The send endpoint, in Studio's format. */
export async function studioSend(payload) {
  const token = await bearer()
  const res = await fetch('/api/connect-send-bulk-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...payload, body_format: 'studio' }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new StudioApiError(res.status, json?.code, json?.error || `Request failed (HTTP ${res.status}).`)
  return json
}
