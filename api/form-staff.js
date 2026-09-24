// api/form-staff.js
//
// FORMS-PHASE3: the staff side of Catalog forms. Owner and Admin only (the Catalog's
// manage roles). Every write goes through lib/server/forms/engine.js on the service role.
//
// Actions (POST { action, ... }):
//   status          -> { enabled } (false until the Forms migration is applied)
//   tracker         -> { rows } one completion row per person, for forms AND signature
//                      requests, keyed by Catalog item: the Catalog's Out for completion and
//                      Overdue people counts read these
//   create          -> { form } a new draft form and its Catalog item
//   get             -> { form, versions, counts }   (id | catalog_resource_id)
//   save            -> { form } the draft and settings (publishing is separate)
//   publish         -> { form } freezes the draft as the next version
//   use_starter     -> { form } replaces a starter form's draft with the starter as it ships now (not published)
//   starters        -> { results } adds the brief's starter forms that are missing
//   send            -> { created, sent, failed } one personal link per person
//   assignments     -> { assignments, definitions } the responses screen
//   submission      -> { answers, definition, pdfUrl }
//   remind | void   -> by assignment ids;  remind_overdue -> every overdue on a form
//   csv             -> text/csv of one version's answers

import { createClient } from '@supabase/supabase-js'
import process from 'node:process'
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { createMailer } from '../lib/server/email/mailer.js'
import { appBaseUrl } from '../lib/server/appUrl.js'
import { populationOf } from '../lib/server/demoScope.js'
import {
  FormError, ORG_ID, FORM_BUCKET, notEnabled, createForm, loadForm, formForItem, saveDraft, publish, installStarters, applyStarter,
  sendForm, remind, voidAssignments, exportCsv, versionOf,
} from '../lib/server/forms/engine.js'
import { assignableCategorySlugs } from './lib/catalogCategories.js'
import { assignmentState } from '../src/lib/forms/formModel.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSIGNMENT_COLS = 'id, form_id, form_version, catalog_resource_id, batch_id, audience_label, student_id, contact_id, school_name, name, email, status, due_at, reminder_rule, sender_name, sent_at, opened_at, submitted_at, closed_at, voided_at, last_reminded_at, reminder_count, delivery_ok, created_at'

async function caller(req, db) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new FormError('unauthorized', 'Unauthorized', 401)
  const userClient = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data?.user) throw new FormError('unauthorized', 'Unauthorized', 401)
  const { data: profile } = await db.from('user_profiles').select('id, role, is_owner, is_active, email, full_name').eq('auth_user_id', data.user.id).maybeSingle()
  if (!profile || profile.is_active === false) throw new FormError('forbidden', 'Forbidden', 403)
  if (!(profile.is_owner === true || ['owner', 'admin'].includes(profile.role))) throw new FormError('forbidden', 'Forbidden', 403)
  return profile
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const db = supabaseAdmin
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  try {
    const profile = await caller(req, db)
    const out = await act(db, body, { profile, isDemo: populationOf(req) })
    if (out && out.__csv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename.replace(/"/g, '')}"`)
      return res.status(200).send(`\uFEFF${out.csv}`)
    }
    return res.status(200).json(out)
  } catch (err) {
    if (err instanceof FormError) return res.status(err.status).json({ error: err.message, code: err.code })
    if (err?.code === 'token_secret_missing') return res.status(503).json({ error: 'Form links are not configured yet (FORM_TOKEN_SECRET or SIG_TOKEN_SECRET).', code: err.code })
    console.error('[form-staff] unhandled:', err?.message || err)
    return res.status(500).json({ error: 'Server error' })
  }
}

const needUuid = (v, what = 'id') => { if (!UUID.test(String(v || ''))) throw new FormError('invalid', `Missing ${what}.`) }
const idList = (v) => (Array.isArray(v) ? v : []).filter(x => UUID.test(String(x))).slice(0, 500)

async function act(db, body, { profile, isDemo }) {
  const appUrl = appBaseUrl()
  switch (body.action) {
    case 'status': {
      const { error } = await db.from('catalog_forms').select('id', { head: true, count: 'exact' }).limit(1)
      return { enabled: !notEnabled(error) && !error }
    }
    case 'tracker': return tracker(db, isDemo)
    case 'create': {
      const title = String(body.title || '').trim()
      if (!title) throw new FormError('invalid', 'Name the form.')
      let category = 'student_onboarding'
      if (body.category) {
        const cats = await assignableCategorySlugs(db)
        if (!cats.ok || !cats.slugs.has(body.category)) throw new FormError('invalid', 'Choose a Catalog category.')
        category = body.category
      }
      return { form: await createForm(db, { title, category, description: String(body.description || '').slice(0, 1000) }, profile) }
    }
    case 'get': {
      const form = UUID.test(body.id || '') ? await loadForm(db, body.id) : (needUuid(body.catalog_resource_id, 'form'), await formForItem(db, body.catalog_resource_id))
      const { data: versions } = await db.from('catalog_form_versions').select('version, published_at, published_by').eq('form_id', form.id).order('version', { ascending: false })
      const { data: rows } = await db.from('form_assignments').select('status, due_at, opened_at, submitted_at').eq('form_id', form.id).eq('is_demo', isDemo)
      const counts = { total: 0, submitted: 0, overdue: 0, opened: 0, sent: 0, closed: 0, voided: 0 }
      for (const a of rows || []) { counts.total++; counts[assignmentState(a)]++ }
      return { form, versions: versions || [], counts }
    }
    case 'save': needUuid(body.id); return { form: await saveDraft(db, body.id, { draft: body.draft, settings: body.settings }, profile) }
    case 'publish': needUuid(body.id); return { form: await publish(db, body.id, profile) }
    case 'use_starter': needUuid(body.id); return { form: await applyStarter(db, body.id, profile) }
    case 'starters': return { results: await installStarters(db, profile) }
    case 'send': {
      const s = body.send || {}
      let formId = s.formId
      if (!UUID.test(formId || '') && UUID.test(s.catalogResourceId || '')) formId = (await formForItem(db, s.catalogResourceId)).id
      needUuid(formId, 'form')
      return sendForm(db, { ...s, formId }, { appUrl, mailer: createMailer(), sender: profile, isDemo })
    }
    case 'assignments': {
      needUuid(body.id)
      const form = await loadForm(db, body.id)
      const { data: rows, error } = await db.from('form_assignments').select(ASSIGNMENT_COLS).eq('form_id', form.id).eq('is_demo', isDemo).order('created_at', { ascending: false }).limit(2000)
      if (error) throw new FormError('db_failed', error.message, 500)
      return { form, assignments: rows || [] }
    }
    case 'submission': {
      needUuid(body.assignment_id, 'response')
      const { data: a } = await db.from('form_assignments').select(ASSIGNMENT_COLS).eq('id', body.assignment_id).eq('org_id', ORG_ID).maybeSingle()
      if (!a) throw new FormError('not_found', 'Response not found.', 404)
      const { data: sub } = await db.from('form_submissions').select('id, answers, pdf_bucket, pdf_path, record_document_id, submitted_at').eq('assignment_id', a.id).maybeSingle()
      if (!sub) throw new FormError('not_found', 'Nothing has been submitted yet.', 404)
      const version = await versionOf(db, a.form_id, a.form_version)
      let pdfUrl = null
      if (sub.pdf_bucket && sub.pdf_path) {
        const { data } = await db.storage.from(sub.pdf_bucket).createSignedUrl(sub.pdf_path, 300)
        pdfUrl = data?.signedUrl || null
      }
      return { assignment: a, answers: sub.answers, submittedAt: sub.submitted_at, filed: !!sub.record_document_id, definition: version.definition, pdfUrl }
    }
    case 'file_url': {
      // A File upload answer, for staff to open.
      needUuid(body.assignment_id, 'response')
      const path = String(body.path || '')
      if (!path.startsWith(`uploads/${body.assignment_id}/`)) throw new FormError('invalid', 'That file is not part of this response.')
      const { data } = await db.storage.from(FORM_BUCKET).createSignedUrl(path, 300)
      return { url: data?.signedUrl || null }
    }
    case 'remind': return remind(db, idList(body.ids), { appUrl, mailer: createMailer() })
    case 'remind_overdue': {
      needUuid(body.id)
      const { data: rows } = await db.from('form_assignments').select('id, status, due_at, opened_at, submitted_at').eq('form_id', body.id).eq('is_demo', isDemo).in('status', ['sent', 'opened'])
      const overdue = (rows || []).filter(a => assignmentState(a) === 'overdue').map(a => a.id)
      if (!overdue.length) return { reminded: 0 }
      return remind(db, overdue, { appUrl, mailer: createMailer() })
    }
    case 'void': return voidAssignments(db, idList(body.ids))
    case 'csv': {
      needUuid(body.id)
      const { csv, filename } = await exportCsv(db, body.id, { version: Number(body.version) || null, isDemo })
      return { __csv: true, csv, filename }
    }
    default: throw new FormError('invalid', 'Unknown action.')
  }
}

/**
 * One completion row per person for every Catalog item that collects something: form
 * assignments and signature requests. The Catalog's counts are computed from these in
 * the browser (catalogModel.completionStats), so there is one rule for "overdue".
 */
async function tracker(db, isDemo) {
  const rows = []
  const forms = await db.from('form_assignments').select('catalog_resource_id, status, due_at, opened_at, submitted_at').eq('is_demo', isDemo).neq('status', 'voided').limit(10000)
  if (!forms.error) {
    for (const a of forms.data || []) {
      if (!a.catalog_resource_id || a.status === 'closed') continue
      rows.push({ id: a.catalog_resource_id, due_at: a.due_at, opened_at: a.opened_at, completed_at: a.submitted_at })
    }
  }
  const sigs = await db.from('sig_requests').select('id, catalog_resource_id, status, due_at, completed_at, template_id').eq('is_demo', isDemo).not('catalog_resource_id', 'is', null).in('status', ['sent', 'progress', 'opened', 'completed']).limit(10000)
  if (!sigs.error && sigs.data?.length) {
    const ids = sigs.data.map(r => r.id)
    const { data: opened } = await db.from('sig_request_signers').select('request_id').in('request_id', ids).not('opened_at', 'is', null)
    const wasOpened = new Set((opened || []).map(o => o.request_id))
    for (const r of sigs.data) rows.push({ id: r.catalog_resource_id, due_at: r.due_at, opened_at: wasOpened.has(r.id) ? 'opened' : null, completed_at: r.completed_at })
  }
  return { rows, formsEnabled: !notEnabled(forms.error) }
}
