// api/sig-staff.js
//
// SIGNATURES-PHASE2: every staff action on signatures, one endpoint. Owner or Admin
// (catalogAuth), and the catalog.signatures flag must admit the caller: 'on' admits Owner
// and Admin, 'owner' admits the Owner only, 'off' admits nobody (every action but `flag`
// answers 404, so the feature is invisible, not merely disabled).
//
// POST { action, ... }
//   flag                         -> { state, allowed }
//   list                         -> requests, their signers (no secrets), bulk parents
//   get { id }                   -> one request with signers, values and events
//   upload_sign { size }         -> one-time upload URL for a PDF
//   upload_commit { path }       -> checks it is a PDF; returns sha256, pages, sizes
//   doc_url { path | id, sealed }-> short-lived URL to render or download
//   template_save { template }   -> creates/updates the template and its Catalog item
//   template_get { id }
//   send { ... }                 -> createAndSend
//   draft_save / draft_delete
//   remind { id } / remind_bulk { bulk_id } / void { id, reason }
//   delegation { id, signer_id, approve }
//   self_sign { id, password, values, typed_name, agree }
//   zip_bulk { bulk_id } / csv_bulk { bulk_id } / verify_seal { id }

import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { createMailer } from '../lib/server/email/mailer.js'
import { appBaseUrl } from '../lib/server/appUrl.js'
import { populationOf } from '../lib/server/demoScope.js'
import { clientContext } from '../lib/server/signatures/tokens.js'
import {
  EngineError, flagState, flagAllows, loadSettings, loadBundle, createAndSend, remind, voidRequest,
  decideDelegation, staffSign, DOC_BUCKET, ORG_ID,
} from '../lib/server/signatures/engine.js'
import { verifySealedPdf } from '../lib/server/signatures/verifySeal.js'
import { zipStored } from '../lib/server/signatures/zip.js'
import { isExcludedType, bulkCounts, REQUEST_STATUS } from '../src/lib/signatures/sigModel.js'

const MAX_PDF_BYTES = 25 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNER_COLS = 'id, request_id, role_key, order_index, recipient_type, name, email, student_id, contact_id, school_name, user_profile_id, color, status, verified_at, verify_method, consent_version, consented_at, opened_at, signed_at, declined_at, decline_reason, completed_copy_sent_at, notified_at, last_reminded_at, reminder_count, delegation, paper_copy_requested_at, adopted_signature, code_sent_to'

async function caller(req, db) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new EngineError('unauthorized', 'Unauthorized', 401)
  const userClient = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data?.user) throw new EngineError('unauthorized', 'Unauthorized', 401)
  const { data: profile } = await db.from('user_profiles').select('id, role, is_owner, is_active, email, full_name').eq('auth_user_id', data.user.id).maybeSingle()
  if (!profile || profile.is_active === false) throw new EngineError('forbidden', 'Forbidden', 403)
  if (!(profile.is_owner === true || ['owner', 'admin'].includes(profile.role))) throw new EngineError('forbidden', 'Forbidden', 403)
  return profile
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const db = supabaseAdmin
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  const ctx = clientContext(req)
  try {
    const profile = await caller(req, db)
    const state = await flagState(db)
    const allowed = flagAllows(state, profile)
    if (body.action === 'flag') return res.status(200).json({ state, allowed })
    if (!allowed) throw new EngineError('off', 'Not found', 404)
    const out = await act(db, body, { profile, ctx, isDemo: populationOf(req) })
    if (out && out.__raw) {
      res.setHeader('Content-Type', out.contentType)
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename.replace(/"/g, '')}"`)
      return res.status(200).send(out.bytes)
    }
    return res.status(200).json(out)
  } catch (err) {
    if (err instanceof EngineError) return res.status(err.status).json({ error: err.message, code: err.code })
    if (err?.code === 'token_secret_missing') return res.status(503).json({ error: 'Signing is not configured yet (SIG_TOKEN_SECRET).', code: err.code })
    if (err?.code === 'seal_not_configured') return res.status(503).json({ error: err.message, code: err.code })
    console.error('[sig-staff] unhandled:', err?.message || err)
    return res.status(500).json({ error: 'Server error' })
  }
}

async function act(db, body, { profile, ctx, isDemo }) {
  const appUrl = appBaseUrl()
  const mailer = createMailer()
  const id = body.id
  const needId = () => { if (!UUID.test(id || '')) throw new EngineError('invalid', 'Missing id.') }

  switch (body.action) {
    case 'list': {
      const { data: requests } = await db.from('sig_requests')
        .select('id, title, status, envelope_code, parent_bulk_id, mode, signing_order, sender_id, sender_name, sent_at, expires_at, due_at, completed_at, voided_at, created_at, sealed_sha256, document_type, catalog_resource_id, draft_state')
        .eq('org_id', ORG_ID).eq('is_demo', isDemo).order('created_at', { ascending: false }).limit(1000)
      const ids = (requests || []).map(r => r.id)
      const { data: signers } = ids.length ? await db.from('sig_request_signers').select(SIGNER_COLS).in('request_id', ids) : { data: [] }
      const { data: bulks } = await db.from('sig_bulk_sends').select('*').eq('org_id', ORG_ID).eq('is_demo', isDemo).order('sent_at', { ascending: false })
      return { requests: requests || [], signers: signers || [], bulks: bulks || [], me: { id: profile.id, email: profile.email } }
    }
    case 'get': {
      needId()
      const b = await loadBundle(db, id)
      const settings = await loadSettings(db)
      return { ...b, signers: b.signers, time_zone: settings.time_zone }
    }
    case 'upload_sign': {
      if (Number(body.size) > MAX_PDF_BYTES) throw new EngineError('too_big', 'PDF files can be up to 25 MB.', 413)
      const path = `uploads/${randomUUID()}.pdf`
      const { data, error } = await db.storage.from(DOC_BUCKET).createSignedUploadUrl(path)
      if (error || !data?.token) throw new EngineError('upload_failed', 'Could not start the upload.', 502)
      return { path, token: data.token }
    }
    case 'upload_commit': {
      const path = String(body.path || '')
      if (!/^uploads\/[0-9a-f-]{36}\.pdf$/.test(path)) throw new EngineError('invalid', 'Bad upload path.')
      const { data: blob, error } = await db.storage.from(DOC_BUCKET).download(path)
      if (error || !blob) throw new EngineError('missing', 'The file was not uploaded.', 409)
      const bytes = Buffer.from(await blob.arrayBuffer())
      if (bytes.length > MAX_PDF_BYTES) throw new EngineError('too_big', 'PDF files can be up to 25 MB.', 413)
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new EngineError('not_pdf', 'That file is not a PDF. Save Word files as PDF first.', 415)
      let doc
      try { doc = await PDFDocument.load(bytes, { updateMetadata: false }) } catch { throw new EngineError('not_pdf', 'That PDF could not be read. It may be encrypted or damaged.', 415) }
      const pageSizes = doc.getPages().map(p => ({ w: Math.round(p.getWidth()), h: Math.round(p.getHeight()) }))
      return { path, sha256: createHash('sha256').update(bytes).digest('hex'), page_count: pageSizes.length, page_sizes: pageSizes }
    }
    case 'doc_url': {
      let path = body.path
      if (id) { needId(); const { data: r } = await db.from('sig_requests').select('document_path, sealed_path, title').eq('id', id).maybeSingle(); path = body.sealed ? r?.sealed_path : r?.document_path }
      if (body.template_id && UUID.test(body.template_id)) { const { data: t } = await db.from('sig_templates').select('source_path').eq('id', body.template_id).maybeSingle(); path = t?.source_path }
      if (!path || !/^(uploads|sealed)\//.test(path)) throw new EngineError('invalid', 'No document.')
      const { data } = await db.storage.from(DOC_BUCKET).createSignedUrl(path, 300, body.download ? { download: true } : undefined)
      return { url: data?.signedUrl }
    }
    case 'template_save': return saveTemplate(db, body.template || {}, profile)
    case 'template_get': {
      if (!UUID.test(body.template_id || '')) throw new EngineError('invalid', 'Missing template.')
      const { data } = await db.from('sig_templates').select('*').eq('id', body.template_id).eq('org_id', ORG_ID).maybeSingle()
      if (!data) throw new EngineError('not_found', 'Template not found.', 404)
      return { template: data }
    }
    case 'templates': {
      const { data } = await db.from('sig_templates').select('id, name, document_type, page_count, signer_roles, fields, version, status, catalog_resource_id, updated_at').eq('org_id', ORG_ID).neq('status', 'archived').order('updated_at', { ascending: false })
      return { templates: data || [] }
    }
    case 'send': {
      const s = body.send || {}
      if (isExcludedType(s.documentType) && s.excludedConfirmed && !(profile.is_owner || profile.role === 'owner' || profile.role === 'admin')) throw new EngineError('forbidden', 'Only an admin can confirm an excluded document type.', 403)
      const out = await createAndSend(db, s, { appUrl, mailer, sender: profile, ctx, isDemo })
      if (UUID.test(s.draftId || '')) await db.from('sig_requests').delete().eq('id', s.draftId).eq('status', 'draft')
      return out
    }
    case 'draft_save': {
      const st = body.draft || {}
      const row = { org_id: ORG_ID, title: String(st.title || 'Untitled document').slice(0, 200), document_type: st.documentType || 'acknowledgment', status: 'draft', sender_id: profile.id, sender_name: profile.full_name, sender_email: profile.email, draft_state: st, is_demo: isDemo, envelope_code: `DRAFT-${randomUUID().slice(0, 8)}` }
      if (UUID.test(body.draft_id || '')) {
        const { error } = await db.from('sig_requests').update({ title: row.title, document_type: row.document_type, draft_state: st }).eq('id', body.draft_id).eq('status', 'draft')
        if (error) throw new EngineError('save_failed', error.message, 500)
        return { id: body.draft_id }
      }
      const { data, error } = await db.from('sig_requests').insert(row).select('id').single()
      if (error) throw new EngineError('save_failed', error.message, 500)
      return { id: data.id }
    }
    case 'draft_delete': {
      needId()
      const { error } = await db.from('sig_requests').delete().eq('id', id).eq('status', 'draft')
      if (error) throw new EngineError('delete_failed', error.message, 500)
      return { ok: true }
    }
    case 'remind': needId(); return { reminded: await remind(db, { requestId: id, actor: profile.full_name, ctx, appUrl, mailer }) }
    case 'remind_bulk': {
      const { data } = await db.from('sig_requests').select('id, status').eq('parent_bulk_id', body.bulk_id)
      let n = 0
      for (const r of (data || []).filter(x => ['sent', 'opened', 'progress'].includes(x.status))) n += await remind(db, { requestId: r.id, actor: profile.full_name, ctx, appUrl, mailer })
      return { reminded: n }
    }
    case 'void': needId(); await voidRequest(db, { requestId: id, reason: body.reason, actor: profile.full_name, ctx, mailer }); return { ok: true }
    case 'delegation': needId(); await decideDelegation(db, { requestId: id, signerId: body.signer_id, approve: body.approve === true, actor: profile.full_name, ctx, appUrl, mailer }); return { ok: true }
    case 'self_sign': {
      needId()
      const passwordVerified = await checkPassword(profile.email, body.password)
      const settings = await loadSettings(db)
      const out = await staffSign(db, { requestId: id, profile, passwordVerified, values: body.values || {}, typedName: body.typed_name, agree: body.agree === true, ctx, appUrl, mailer, settings })
      return { ok: true, completed: !!out.completed, seal_pending: !!out.sealPending }
    }
    case 'zip_bulk': {
      const { data } = await db.from('sig_requests').select('id, title, envelope_code, sealed_path').eq('parent_bulk_id', body.bulk_id).not('sealed_path', 'is', null)
      const { data: signers } = await db.from('sig_request_signers').select('request_id, name, order_index').in('request_id', (data || []).map(r => r.id))
      const files = []
      for (const r of data || []) {
        const { data: blob } = await db.storage.from(DOC_BUCKET).download(r.sealed_path)
        if (!blob) continue
        const who = (signers || []).filter(s => s.request_id === r.id).sort((a, b) => a.order_index - b.order_index)[0]?.name || r.envelope_code
        files.push({ name: `${who} - ${r.title}.pdf`, data: Buffer.from(await blob.arrayBuffer()) })
      }
      if (!files.length) throw new EngineError('none', 'No signed copies yet.', 404)
      return { __raw: true, bytes: zipStored(files), contentType: 'application/zip', filename: 'Signed copies.zip' }
    }
    case 'csv_bulk': {
      const { data } = await db.from('sig_requests').select('id, status, sent_at, completed_at, due_at').eq('parent_bulk_id', body.bulk_id)
      const { data: signers } = await db.from('sig_request_signers').select('request_id, name, email, opened_at, signed_at, declined_at, recipient_type').in('request_id', (data || []).map(r => r.id))
      const counts = bulkCounts(data || [])
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const lines = [['Name', 'Email', 'Status', 'Sent', 'Opened', 'Signed', 'Declined'].map(q).join(',')]
      for (const r of data || []) {
        for (const s of (signers || []).filter(x => x.request_id === r.id && x.recipient_type === 'signer')) {
          lines.push([s.name, s.email, REQUEST_STATUS[r.status] || r.status, r.sent_at, s.opened_at, s.signed_at, s.declined_at].map(q).join(','))
        }
      }
      lines.push('', q(`${counts.signed} signed, ${counts.overdue} overdue, ${counts.opened} opened, ${counts.notOpened} not opened`))
      return { __raw: true, bytes: Buffer.from(lines.join('\r\n'), 'utf8'), contentType: 'text/csv; charset=utf-8', filename: 'Signature status.csv' }
    }
    case 'verify_seal': {
      needId()
      const { data: r } = await db.from('sig_requests').select('sealed_path, sealed_sha256').eq('id', id).maybeSingle()
      if (!r?.sealed_path) throw new EngineError('not_sealed', 'Not sealed yet.', 409)
      const { data: blob } = await db.storage.from(DOC_BUCKET).download(r.sealed_path)
      const bytes = Buffer.from(await blob.arrayBuffer())
      return { ...verifySealedPdf(bytes), stored_sha256_matches: createHash('sha256').update(bytes).digest('hex') === r.sealed_sha256 }
    }
    default: throw new EngineError('bad_action', 'Unknown action.', 400)
  }
}

async function checkPassword(email, password) {
  if (!email || !password) return false
  const client = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (!error && data?.session) { await client.auth.signOut().catch(() => {}); return true }
  return false
}

async function saveTemplate(db, t, profile) {
  const name = String(t.name || '').trim()
  if (!name) throw new EngineError('invalid', 'Name the document.')
  if (!t.documentType) throw new EngineError('invalid', 'Choose a document type.')
  if (!/^uploads\/[0-9a-f-]{36}\.pdf$/.test(t.sourcePath || '')) throw new EngineError('invalid', 'Upload the PDF first.')
  const row = {
    org_id: ORG_ID, name: name.slice(0, 200), document_type: t.documentType, source_path: t.sourcePath, source_sha256: t.sourceSha256,
    page_count: t.pageCount, page_sizes: t.pageSizes || [], fields: t.fields || [], signer_roles: t.roles || [],
    signing_order: t.signingOrder === 'parallel' ? 'parallel' : 'sequential', status: 'active', updated_at: new Date().toISOString(),
    excluded_type_confirmed_by: isExcludedType(t.documentType) && t.excludedConfirmed ? profile.id : null,
  }
  if (UUID.test(t.id || '')) {
    const { data: prev } = await db.from('sig_templates').select('version, catalog_resource_id').eq('id', t.id).maybeSingle()
    const { data, error } = await db.from('sig_templates').update({ ...row, version: (prev?.version || 1) + 1 }).eq('id', t.id).select('id, version, catalog_resource_id').single()
    if (error) throw new EngineError('save_failed', error.message, 500)
    if (prev?.catalog_resource_id) await db.from('catalog_resources').update({ title: row.name, updated_at: row.updated_at, updated_by: profile.id }).eq('id', prev.catalog_resource_id)
    return { template: data }
  }
  const { data, error } = await db.from('sig_templates').insert({ ...row, created_by: profile.id }).select('id, version').single()
  if (error) throw new EngineError('save_failed', error.message, 500)
  // Its Catalog item: kind 'signature', no file in the Catalog bucket (the storage_path
  // names the template, and nothing opens it as a file; the Catalog routes it here).
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${data.id.slice(0, 6)}`
  const { data: item } = await db.from('catalog_resources').insert({
    slug, title: row.name, description: t.description || null, category: t.category || 'student_onboarding',
    resource_type: 'internal_file', storage_path: `sig-template:${data.id}`, file_type_label: 'PDF', kind: 'signature',
    audience: t.audience ? [t.audience] : [], is_active: true, created_by: profile.id, updated_by: profile.id,
  }).select('id').single()
  if (item) await db.from('sig_templates').update({ catalog_resource_id: item.id }).eq('id', data.id)
  return { template: { ...data, catalog_resource_id: item?.id || null } }
}
