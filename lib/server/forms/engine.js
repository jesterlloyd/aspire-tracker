// lib/server/forms/engine.js
//
// FORMS-PHASE3: every state change a form, an assignment or a submission goes through,
// on the service-role client. /api/form-staff (Owner/Admin), /api/form-respond (the
// public link) and the form-maintenance cron are thin: they authenticate, then call this.
//
// Rules this file keeps, from the brief (section 5) and the Owner's decisions:
//   - Publishing freezes a new version. New links use the latest; a submission keeps the
//     version it was answered on (catalog_form_versions rows cannot be updated).
//   - A personal link is the whole identity check; only its hash is stored.
//   - Prefilled answers come from ASPIRE and the respondent may still correct them.
//   - On submit: validate, write a PDF, file it to the student's or school's record, mark
//     the assignment done, and (if the form asks) tell the sender.
//   - Overdue is computed from due_at, never stored. "Close after the due date" stops a
//     link from being answered once the date has passed.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import {
  definitionIssues, answerIssues, cleanAnswers, DEFAULT_SETTINGS, REMINDER_RULES, STARTER_FORMS, RETIRED_STARTER_DRAFTS, AUDIENCE_KEYS, sameDefinition, starterUpdateFor,
  takesAnswer, prefillSource, csvFor,
} from '../../../src/lib/forms/formModel.js'
import { formTokenFor, sha256, FORM_TOKEN_PATTERN } from './tokens.js'
import { invitationEmail, submittedNoticeEmail, fromLine } from './mail.js'
import { buildSubmissionPdf } from './formPdf.js'
import { fitsParkingSpd } from './layouts/parkingSpd.js'
import { getOrganizationSettings } from '../organizationSettings.js'
import { buildStudentPortalSummary } from '../../../api/lib/studentPortalSummary.js'

export const ORG_ID = 'a5f1e000-0000-4000-8000-000000000001'
export const FORM_BUCKET = 'form-files'
const RECORD_BUCKET = 'record-documents'
const DAY = 24 * 3600 * 1000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const notEnabled = (e) => !!e && (e.code === '42P01' || e.code === '42703' || e.code === 'PGRST205' || e.code === 'PGRST204')

export class FormError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

const check = (res, what) => {
  if (notEnabled(res.error)) throw new FormError('not_enabled', 'Forms are not enabled yet. The Forms update to the database has not been applied.', 409)
  if (res.error) throw new FormError('db_failed', `${what}: ${res.error.message}`, 500)
  return res.data
}

export function cleanSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS }
  if (AUDIENCE_KEYS.includes(s.audience)) out.audience = s.audience
  for (const k of ['filePdf', 'notifyOnSubmit', 'closeAfterDue', 'exportCsv']) if (typeof s[k] === 'boolean') out[k] = s[k]
  if (REMINDER_RULES.some(r => r.key === s.reminders)) out.reminders = s.reminders
  return out
}

function cleanDefinition(d = {}) {
  const questions = Array.isArray(d.questions) ? d.questions.slice(0, 100).map(q => ({
    id: String(q.id || '').slice(0, 40), type: String(q.type || ''), label: String(q.label || '').slice(0, 300),
    help: String(q.help || '').slice(0, 500), required: q.required === true,
    ...(Array.isArray(q.options) ? { options: q.options.slice(0, 50).map(o => String(o).slice(0, 120)) } : {}),
    ...(q.type === 'number' ? { min: q.min == null || q.min === '' ? null : Number(q.min), max: q.max == null || q.max === '' ? null : Number(q.max) } : {}),
    ...(q.prefill ? { prefill: String(q.prefill) } : {}),
  })) : []
  return { title: String(d.title || '').trim().slice(0, 200) || 'Untitled form', description: String(d.description || '').slice(0, 1000), questions }
}

// jsonb does not keep key order, so definitions are compared through formModel's sameDefinition.
const sameCleanDefinition = (a, b) => sameDefinition(cleanDefinition(a), cleanDefinition(b))

// ── Forms ─────────────────────────────────────────────────────────────────────────

const slugOf = (title, id) => `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${id.slice(0, 6)}`

/** A new form and its Catalog item (kind 'form'; storage_path names the form, not a file). */
export async function createForm(db, { title, category = 'student_onboarding', description = '', starterKey = null, definition = null, settings = {} }, profile) {
  const def = cleanDefinition(definition || { title, description: '', questions: [] })
  const form = check(await db.from('catalog_forms').insert({
    org_id: ORG_ID, draft: def, settings: cleanSettings(settings), starter_key: starterKey, created_by: profile.id, updated_by: profile.id,
  }).select('*').single(), 'Could not create the form')
  const { data: item, error } = await db.from('catalog_resources').insert({
    slug: starterKey || slugOf(def.title, form.id), title: def.title, description: description || null, category,
    resource_type: 'internal_file', storage_path: `form:${form.id}`, file_type_label: 'FORM', kind: 'form',
    audience: ['students'], tags: [], is_pinned: false, is_active: true, created_by: profile.id, updated_by: profile.id,
  }).select('id').single()
  if (error || !item) {
    await db.from('catalog_forms').delete().eq('id', form.id)
    throw new FormError('save_failed', `Could not add the form to the Catalog: ${error?.message || 'no row returned'}`, 500)
  }
  check(await db.from('catalog_forms').update({ catalog_resource_id: item.id }).eq('id', form.id), 'Could not link the form')
  return { ...form, catalog_resource_id: item.id }
}

export async function loadForm(db, formId) {
  const form = check(await db.from('catalog_forms').select('*').eq('id', formId).eq('org_id', ORG_ID).maybeSingle(), 'Could not read the form')
  if (!form) throw new FormError('not_found', 'Form not found.', 404)
  return form
}

export async function formForItem(db, catalogResourceId) {
  const form = check(await db.from('catalog_forms').select('*').eq('catalog_resource_id', catalogResourceId).eq('org_id', ORG_ID).maybeSingle(), 'Could not read the form')
  if (!form) throw new FormError('not_found', 'This Catalog item has no form.', 404)
  return form
}

export async function saveDraft(db, formId, { draft, settings }, profile) {
  const form = await loadForm(db, formId)
  const patch = { updated_by: profile.id, updated_at: new Date().toISOString(), draft_dirty: true }
  if (draft) patch.draft = cleanDefinition(draft)
  if (settings) patch.settings = cleanSettings(settings)
  const saved = check(await db.from('catalog_forms').update(patch).eq('id', form.id).select('*').single(), 'Could not save the form')
  if (patch.draft && form.catalog_resource_id) await db.from('catalog_resources').update({ title: patch.draft.title, updated_at: patch.updated_at, updated_by: profile.id }).eq('id', form.catalog_resource_id)
  return saved
}

/** STARTER-RESET-1: replace a starter form's draft with the starter as it ships now. Not published. */
export async function applyStarter(db, formId, profile) {
  const form = await loadForm(db, formId)
  const starter = starterUpdateFor(form)
  if (!starter) throw new FormError('no_update', 'This form already matches its starter.', 409)
  return saveDraft(db, form.id, { draft: starter.definition }, profile)
}

export async function publish(db, formId, profile) {
  const form = await loadForm(db, formId)
  const issues = definitionIssues(form.draft)
  if (issues.length) throw new FormError('not_ready', issues[0], 422)
  const version = (form.current_version || 0) + 1
  check(await db.from('catalog_form_versions').insert({
    form_id: form.id, version, org_id: ORG_ID, definition: form.draft, settings: form.settings, published_by: profile.id,
  }), 'Could not publish')
  return check(await db.from('catalog_forms').update({
    status: 'published', current_version: version, draft_dirty: false, updated_by: profile.id, updated_at: new Date().toISOString(),
  }).eq('id', form.id).select('*').single(), 'Could not publish')
}

export async function versionOf(db, formId, version) {
  const v = check(await db.from('catalog_form_versions').select('*').eq('form_id', formId).eq('version', version).maybeSingle(), 'Could not read the form version')
  if (!v) throw new FormError('not_found', 'That version of the form is missing.', 404)
  return v
}

/** Adds the brief's starter forms that are not in the Catalog yet. Safe to run twice. */
export async function installStarters(db, profile) {
  const out = []
  for (const s of STARTER_FORMS) {
    const { data: have } = await db.from('catalog_forms').select('id, status, draft').eq('starter_key', s.slug).maybeSingle()
    if (have) {
      // A starter whose draft is still word for word as an earlier release shipped it gets the
      // corrected starter, published as a new version when it was published before (links
      // already sent keep the version they were sent with). Anything someone edited is left alone.
      const stale = have.status !== 'archived' && (RETIRED_STARTER_DRAFTS[s.slug] || []).some(d => sameCleanDefinition(d, have.draft))
      if (!stale) { out.push({ key: s.slug, id: have.id, added: false }); continue }
      await saveDraft(db, have.id, { draft: s.definition }, profile)
      const republish = s.publish || have.status === 'published'
      if (republish) await publish(db, have.id, profile)
      out.push({ key: s.slug, id: have.id, added: false, refreshed: true, published: republish })
      continue
    }
    const { data: clash } = await db.from('catalog_resources').select('id').eq('slug', s.slug).maybeSingle()
    if (clash) { out.push({ key: s.slug, added: false, reason: 'A Catalog item already uses this name.' }); continue }
    const form = await createForm(db, { title: s.title, category: s.category, description: s.catalogDescription, starterKey: s.slug, definition: s.definition }, profile)
    if (s.publish) await publish(db, form.id, profile)
    out.push({ key: s.slug, id: form.id, added: true, published: !!s.publish })
  }
  return out
}

// ── Sending ───────────────────────────────────────────────────────────────────────

export function respondLink(appUrl, assignment) {
  return `${appUrl}/form#t=${formTokenFor(assignment.id, assignment.link_version || 1)}`
}

async function sendMail(mailer, msg) {
  try {
    const { error } = await mailer.emails.send({ ...msg, to: [msg.to] })
    return !error
  } catch { return false }
}

/**
 * One assignment per person on the latest published version, each emailed its own link.
 * people: [{ name, email, studentId?, contactId?, schoolName? }] (the Catalog's To field).
 */
export async function sendForm(db, input, { appUrl, mailer, sender, isDemo = false }) {
  const { formId, people = [], dueAt = null, reminderRule, subject = '', message = '', audienceLabel = '' } = input
  const form = await loadForm(db, formId)
  if (form.status !== 'published' || !form.current_version) throw new FormError('not_published', 'Publish the form before sending it.', 409)
  const seen = new Set()
  const list = people.map(p => ({ ...p, email: String(p.email || '').trim() })).filter(p => {
    const k = p.email.toLowerCase()
    if (!EMAIL.test(p.email) || seen.has(k)) return false
    seen.add(k); return true
  })
  if (!list.length) throw new FormError('invalid', 'Add at least one person with an email.')
  if (list.length > 500) throw new FormError('invalid', 'Send to 500 people or fewer at a time.')
  const rule = REMINDER_RULES.some(r => r.key === reminderRule) ? reminderRule : (form.settings?.reminders || 'every_3_days')
  const due = dueAt && !Number.isNaN(Date.parse(dueAt)) ? new Date(dueAt).toISOString() : null
  const batchId = randomUUID()
  const version = await versionOf(db, form.id, form.current_version)
  const title = version.definition.title
  let sent = 0
  const failed = []
  for (const p of list) {
    const row = check(await db.from('form_assignments').insert({
      org_id: ORG_ID, form_id: form.id, form_version: form.current_version, catalog_resource_id: form.catalog_resource_id, batch_id: batchId,
      audience_label: String(audienceLabel || '').slice(0, 300) || null, student_id: p.studentId || null, contact_id: p.contactId || null,
      school_name: p.schoolName || null, name: String(p.name || p.email).slice(0, 200), email: p.email, status: 'sent', due_at: due, reminder_rule: rule,
      sender_id: sender.id, sender_name: sender.full_name || null, sender_email: sender.email || null,
      subject: String(subject || '').slice(0, 200) || null, message: String(message || '').slice(0, 5000) || null, is_demo: isDemo,
    }).select('*').single(), 'Could not create the request')
    check(await db.from('form_assignments').update({ token_hash: sha256(formTokenFor(row.id, row.link_version)) }).eq('id', row.id), 'Could not create the link')
    const ok = await sendMail(mailer, { from: fromLine(row.sender_name), to: row.email, reply_to: row.sender_email || undefined,
      ...invitationEmail({ assignment: row, title, url: respondLink(appUrl, row) }) })
    await db.from('form_assignments').update({ sent_at: new Date().toISOString(), delivery_ok: ok }).eq('id', row.id)
    if (ok) sent++; else failed.push(row.email)
  }
  return { batchId, created: list.length, sent, failed }
}

export async function remind(db, assignmentIds, { appUrl, mailer, auto = false }) {
  const rows = check(await db.from('form_assignments').select('*').in('id', assignmentIds), 'Could not read the requests')
  const titles = {}
  let reminded = 0
  for (const a of rows) {
    if (!['sent', 'opened'].includes(a.status)) continue
    const key = `${a.form_id}:${a.form_version}`
    titles[key] ||= (await versionOf(db, a.form_id, a.form_version)).definition.title
    const ok = await sendMail(mailer, { from: fromLine(a.sender_name), to: a.email, reply_to: a.sender_email || undefined,
      ...invitationEmail({ assignment: a, title: titles[key], url: respondLink(appUrl, a), reminder: true }) })
    await db.from('form_assignments').update({ last_reminded_at: new Date().toISOString(), reminder_count: (a.reminder_count || 0) + 1, delivery_ok: ok }).eq('id', a.id)
    if (ok) reminded++
  }
  return { reminded, auto }
}

export async function voidAssignments(db, assignmentIds) {
  const now = new Date().toISOString()
  check(await db.from('form_assignments').update({ status: 'voided', voided_at: now }).in('id', assignmentIds).in('status', ['sent', 'opened']), 'Could not void')
  return { voided: assignmentIds.length }
}

// ── The respondent's link ───────────────────────────────────────────────────────────

export async function resolveLink(db, token) {
  if (!FORM_TOKEN_PATTERN.test(String(token || ''))) throw new FormError('bad_link', 'This link is not valid.', 404)
  const a = check(await db.from('form_assignments').select('*').eq('token_hash', sha256(token)).maybeSingle(), 'Could not read the link')
  if (!a) throw new FormError('bad_link', 'This link is not valid. Use the most recent email you received.', 404)
  const form = await loadForm(db, a.form_id)
  const version = await versionOf(db, a.form_id, a.form_version)
  return { assignment: a, form, version }
}

export function linkState(assignment, settings = {}, now = Date.now()) {
  if (assignment.status === 'submitted') return { open: false, reason: 'submitted' }
  if (assignment.status === 'voided') return { open: false, reason: 'voided', message: 'This form was withdrawn by the sender.' }
  if (assignment.status === 'closed') return { open: false, reason: 'closed', message: 'This form is closed. Contact the sender if you still need to answer it.' }
  const due = assignment.due_at ? Date.parse(assignment.due_at) : NaN
  if (settings.closeAfterDue && Number.isFinite(due) && due < now) return { open: false, reason: 'closed', message: 'The due date for this form has passed, so it is closed. Contact the sender if you still need to answer it.' }
  return { open: true }
}

// ── The filed PDF's look (PARKING-PDF-1) ───────────────────────────────────────────

/** A starter whose paper original an office knows is filed in that layout, while its questions still fit it. */
export function layoutFor(form, definition) {
  if (form?.starter_key === 'student-parking-request' && fitsParkingSpd(definition)) return 'parking-spd'
  return null
}

async function documentBrand(db) {
  try { return { orgName: (await getOrganizationSettings(db))?.display_name || '' } } catch { return {} }
}

/** The organization's document logo (PNG or JPEG), else the Cedars-Sinai logo the app ships. */
export async function documentLogo(db) {
  try {
    const org = await getOrganizationSettings(db)
    if (org?.document_logo_path && /\.(png|jpe?g)$/i.test(org.document_logo_path)) {
      const { data } = await db.storage.from('organization-branding').download(org.document_logo_path)
      if (data) return Buffer.from(await data.arrayBuffer())
    }
  } catch { /* fall through to the shipped logo */ }
  try { return readFileSync(new URL('../../../public/Cedars-Sinai.png', import.meta.url)) } catch { return null }
}

/** What ASPIRE already knows about this respondent, keyed by prefill source. */
export async function prefillFor(db, assignment) {
  const out = { 'student.email': assignment.email }
  if (!assignment.student_id) return out
  try {
    const { students } = await buildStudentPortalSummary(db, [assignment.student_id])
    const s = students?.[0]
    if (!s) return out
    Object.assign(out, {
      'student.full_name': [s.first_name, s.last_name].filter(Boolean).join(' '),
      'student.preferred_name': [s.preferred_first_name || s.first_name, s.last_name].filter(Boolean).join(' '),
      'student.first_name': s.first_name || '',
      'student.last_name': s.last_name || '',
      'student.phone': s.phone || '',
      'student.school': s.school || '',
      'placement.unit': s.unit_name || '',
      'placement.start_date': s.rotation?.start || '',
      'placement.end_date': s.rotation?.end || '',
      'placement.preceptor': s.preceptor_name || '',
    })
  } catch { /* a prefill that cannot be read is simply blank; the respondent fills it */ }
  return out
}

export async function respondentState(db, { assignment, form, version }) {
  const gate = linkState(assignment, version.settings)
  if (assignment.status === 'submitted') {
    const sub = check(await db.from('form_submissions').select('id, submitted_at').eq('assignment_id', assignment.id).maybeSingle(), 'Could not read the submission')
    return { state: 'done', title: version.definition.title, name: assignment.name, submittedAt: sub?.submitted_at || assignment.submitted_at }
  }
  if (!gate.open) return { state: 'closed', title: version.definition.title, message: gate.message }
  if (!assignment.opened_at) await db.from('form_assignments').update({ opened_at: new Date().toISOString(), status: 'opened' }).eq('id', assignment.id).eq('status', 'sent')
  const known = await prefillFor(db, assignment)
  const prefill = {}
  for (const q of version.definition.questions) {
    if (!takesAnswer(q) || !q.prefill || !prefillSource(q.prefill)) continue
    const v = known[q.prefill]
    if (v) prefill[q.id] = v
  }
  return {
    state: 'open', definition: version.definition, prefill, name: assignment.name, email: assignment.email,
    dueAt: assignment.due_at, sender: assignment.sender_name, formId: form.id, version: assignment.form_version,
  }
}

export async function uploadSlot(db, assignment, { name, size }) {
  const gate = linkState(assignment, (await versionOf(db, assignment.form_id, assignment.form_version)).settings)
  if (!gate.open) throw new FormError('closed', gate.message || 'This form is closed.', 409)
  if (!(Number(size) > 0) || Number(size) > 10 * 1024 * 1024) throw new FormError('too_big', 'Files can be up to 10 MB.', 413)
  const clean = String(name || 'file').replace(/[^\w .()-]+/g, '_').slice(-100) || 'file'
  const path = `uploads/${assignment.id}/${Date.now().toString(36)}-${clean}`.slice(0, 180)
  const { data, error } = await db.storage.from(FORM_BUCKET).createSignedUploadUrl(path)
  if (error || !data?.token) throw new FormError('upload_failed', 'Could not start the upload.', 502)
  return { path, token: data.token, name: clean }
}

export async function submit(db, { assignment, form, version, answers, ctx = {} }, { mailer, appUrl, timeZone = 'America/Los_Angeles' }) {
  const gate = linkState(assignment, version.settings)
  if (!gate.open) throw new FormError(gate.reason === 'submitted' ? 'already_submitted' : 'closed', gate.message || 'This form was already submitted.', 409)
  const def = version.definition
  const clean = cleanAnswers(def, answers || {})
  // An upload must be this respondent's own, in this assignment's folder.
  for (const q of def.questions) {
    if (q.type !== 'file' || !clean[q.id]) continue
    if (!String(clean[q.id].path).startsWith(`uploads/${assignment.id}/`)) delete clean[q.id]
  }
  const issues = answerIssues(def, clean)
  const firstBad = def.questions.find(q => issues[q.id])
  if (firstBad) throw new FormError('invalid_answers', `${firstBad.label}: ${issues[firstBad.id]}`, 422)

  const submittedAt = new Date().toISOString()
  // Claim the assignment first, so a double tap cannot file two copies.
  const claimed = check(await db.from('form_assignments').update({ status: 'submitted', submitted_at: submittedAt })
    .eq('id', assignment.id).in('status', ['sent', 'opened']).select('id'), 'Could not submit')
  if (!claimed?.length) throw new FormError('already_submitted', 'This form was already submitted.', 409)

  const submissionId = randomUUID()
  const settings = version.settings || {}
  let pdf = null, pdfBucket = null, pdfPath = null, recordId = null
  try {
    const layout = layoutFor(form, def)
    pdf = await buildSubmissionPdf({ definition: def, answers: clean, who: { name: assignment.name, email: assignment.email },
      meta: { submittedAt, submissionId, version: assignment.form_version, timeZone, ...(layout ? await documentBrand(db) : {}) },
      layout, logo: layout ? await documentLogo(db) : null })
    if (settings.filePdf !== false && (assignment.student_id || assignment.school_name)) {
      const sub = assignment.student_id
        ? { subject_type: 'student', student_id: assignment.student_id, school_name: null }
        : { subject_type: 'school', student_id: null, school_name: assignment.school_name }
      const path = `${sub.subject_type}/${sub.student_id || createHash('sha256').update(sub.school_name).digest('hex').slice(0, 16)}/${randomUUID()}.pdf`
      const up = await db.storage.from(RECORD_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
      if (!up.error) {
        const { data: rec } = await db.from('record_documents').insert({
          ...sub, title: def.title, file_name: `${def.title.replace(/[^\w .-]+/g, '').slice(0, 80) || 'Form'}.pdf`, storage_path: path,
          content_type: 'application/pdf', size_bytes: pdf.length, source: 'form_submission', source_ref: submissionId, is_demo: assignment.is_demo === true,
        }).select('id').single()
        if (rec) { recordId = rec.id; pdfBucket = RECORD_BUCKET; pdfPath = path }
      }
    }
    if (!pdfPath) {
      const path = `submissions/${submissionId}.pdf`
      const up = await db.storage.from(FORM_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
      if (!up.error) { pdfBucket = FORM_BUCKET; pdfPath = path }
    }
  } catch (e) {
    // The answers are the record and are saved below; a PDF that failed can be rebuilt from them.
    console.error('[forms] submission PDF failed:', e?.message || e)
  }

  const saved = await db.from('form_submissions').insert({
    id: submissionId, org_id: ORG_ID, assignment_id: assignment.id, form_id: form.id, form_version: assignment.form_version,
    answers: clean, pdf_bucket: pdfBucket, pdf_path: pdfPath, record_document_id: recordId, submitted_at: submittedAt,
    ip: ctx.ip || null, user_agent: ctx.userAgent || null, is_demo: assignment.is_demo === true,
  })
  if (saved.error) {
    // Put the assignment back so the respondent can try again; nothing was recorded.
    await db.from('form_assignments').update({ status: assignment.opened_at ? 'opened' : 'sent', submitted_at: null }).eq('id', assignment.id)
    throw new FormError('save_failed', 'Your answers could not be saved. Please try again.', 500)
  }
  if (settings.notifyOnSubmit && assignment.sender_email) {
    await sendMail(mailer, { from: fromLine('ASPIRE'), to: assignment.sender_email,
      ...submittedNoticeEmail({ assignment, title: def.title, url: `${appUrl}/catalog/forms/${form.id}/responses` }) })
  }
  return { submissionId, submittedAt, filed: !!recordId, pdf: pdf ? pdf.toString('base64') : null }
}

// ── Reminders and closing (the cron) ───────────────────────────────────────────────

export function reminderDue(a, now = Date.now()) {
  if (!['sent', 'opened'].includes(a.status) || a.reminder_rule === 'off') return false
  const last = Date.parse(a.last_reminded_at || a.sent_at || a.created_at)
  const due = a.due_at ? Date.parse(a.due_at) : NaN
  if (a.reminder_rule === 'every_3_days') return Number.isFinite(last) && now - last >= 3 * DAY && (!Number.isFinite(due) || now < due + 14 * DAY)
  if (a.reminder_rule === 'once_before_due') return (a.reminder_count || 0) === 0 && Number.isFinite(due) && due - now <= 2 * DAY && due > now
  return false
}

export async function maintenance(db, { appUrl, mailer, now = Date.now() }) {
  const { data: open, error } = await db.from('form_assignments').select('*').in('status', ['sent', 'opened']).eq('is_demo', false).limit(2000)
  if (notEnabled(error)) return { enabled: false }
  if (error) throw error
  const out = { enabled: true, reminded: 0, closed: 0 }
  const settingsByVersion = {}
  for (const a of open || []) {
    const key = `${a.form_id}:${a.form_version}`
    settingsByVersion[key] ||= (await versionOf(db, a.form_id, a.form_version)).settings || {}
    const s = settingsByVersion[key]
    const due = a.due_at ? Date.parse(a.due_at) : NaN
    if (s.closeAfterDue && Number.isFinite(due) && due < now) {
      await db.from('form_assignments').update({ status: 'closed', closed_at: new Date(now).toISOString() }).eq('id', a.id).in('status', ['sent', 'opened'])
      out.closed++
      continue
    }
    if (reminderDue(a, now)) out.reminded += (await remind(db, [a.id], { appUrl, mailer, auto: true })).reminded
  }
  return out
}

// ── Export ─────────────────────────────────────────────────────────────────────────

/** The CSV of one version's answers (brief: "CSV for Parking or ScrubEx"). */
export async function exportCsv(db, formId, { version = null, isDemo = false } = {}) {
  const form = await loadForm(db, formId)
  const v = version || form.current_version
  const def = (await versionOf(db, form.id, v)).definition
  const subs = check(await db.from('form_submissions').select('answers, submitted_at, assignment_id, form_version')
    .eq('form_id', form.id).eq('form_version', v).eq('is_demo', isDemo).order('submitted_at'), 'Could not read the answers')
  const ids = (subs || []).map(s => s.assignment_id)
  const people = ids.length ? check(await db.from('form_assignments').select('id, name, email').in('id', ids), 'Could not read the people') : []
  const byId = Object.fromEntries((people || []).map(p => [p.id, p]))
  const csv = csvFor(def, (subs || []).map(s => ({ ...s, name: byId[s.assignment_id]?.name, email: byId[s.assignment_id]?.email })))
  return { csv, filename: `${def.title.replace(/[^\w .-]+/g, '').slice(0, 80) || 'Form'} v${v}.csv` }
}
