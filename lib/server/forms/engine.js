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
  definitionIssues, answerIssues, cleanAnswers, DEFAULT_SETTINGS, REMINDER_RULES, STARTER_FORMS, RETIRED_STARTER_DRAFTS, AUDIENCE_KEYS, sameDefinition, starterUpdateFor, sheetFor, summaryFor, cleanLayout, cleanFormat, withCorrections, CORRECTABLE_TYPES, SHEET_FILLS, SHEET_INKS, mergeFormat, displayValue, parseNumber, summarize,
  takesAnswer, prefillSource, csvFor,
} from '../../../src/lib/forms/formModel.js'
import { formTokenFor, sha256, FORM_TOKEN_PATTERN } from './tokens.js'
import { invitationEmail, submittedNoticeEmail, forwardEmail, fromLine } from './mail.js'
import { buildSubmissionPdf } from './formPdf.js'
import { fitsParkingSpd, PARKING_SPD_SHA256 } from './layouts/parkingSpd.js'
import { xlsxFor, colLetter } from './xlsx.js'
import { fitsScrubex, SCRUBEX_SHA256 } from './layouts/scrubex.js'
import { PDFDocument } from 'pdf-lib'
import { getOrganizationSettings } from '../organizationSettings.js'
import { buildStudentPortalSummary } from '../../../api/lib/studentPortalSummary.js'

export const ORG_ID = 'a5f1e000-0000-4000-8000-000000000001'
export const FORM_BUCKET = 'form-files'
const RECORD_BUCKET = 'record-documents'
const DAY = 24 * 3600 * 1000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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
  const fwd = String(s.forwardTo || '').trim().toLowerCase()
  if (EMAIL.test(fwd) && fwd.length <= 200) out.forwardTo = fwd
  return out
}

function cleanDefinition(d = {}) {
  const questions = Array.isArray(d.questions) ? d.questions.slice(0, 100).map(q => ({
    id: String(q.id || '').slice(0, 40), type: String(q.type || ''), label: String(q.label || '').slice(0, 300),
    help: String(q.help || '').slice(0, 500), required: q.required === true,
    ...(Array.isArray(q.options) ? { options: q.options.slice(0, 50).map(o => String(o).slice(0, 120)) } : {}),
    ...(q.allowOther === true && ['choice', 'checkboxes', 'dropdown'].includes(q.type) ? { allowOther: true } : {}),
    ...(q.type === 'number' ? { min: q.min == null || q.min === '' ? null : Number(q.min), max: q.max == null || q.max === '' ? null : Number(q.max) } : {}),
    ...(q.prefill ? { prefill: String(q.prefill) } : {}),
  })) : []
  const confirmation = String(d.confirmation || '').trim().slice(0, 500)
  return { title: String(d.title || '').trim().slice(0, 200) || 'Untitled form', description: String(d.description || '').slice(0, 1000), ...(confirmation ? { confirmation } : {}), questions }
}

// jsonb does not keep key order, so definitions are compared through formModel's sameDefinition.
const sameCleanDefinition = (a, b) => sameDefinition(cleanDefinition(a), cleanDefinition(b))

// ── Forms ─────────────────────────────────────────────────────────────────────────

const slugOf = (title, id) => `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${id.slice(0, 6)}`

/** A new form and its Catalog item (kind 'form'; storage_path names the form, not a file). */
export async function createForm(db, { title, category = 'student_onboarding', description = '', starterKey = null, slug = null, definition = null, settings = {} }, profile) {
  const def = cleanDefinition(definition || { title, description: '', questions: [] })
  const form = check(await db.from('catalog_forms').insert({
    org_id: ORG_ID, draft: def, settings: cleanSettings(settings), starter_key: starterKey, created_by: profile.id, updated_by: profile.id,
  }).select('*').single(), 'Could not create the form')
  const { data: item, error } = await db.from('catalog_resources').insert({
    slug: slug || starterKey || slugOf(def.title, form.id), title: def.title, description: description || null, category,
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
  return saveDraft(db, form.id, { draft: starter.definition, settings: { ...(form.settings || {}), ...(starter.settings || {}) } }, profile)
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
async function freeSlug(db, base) {
  for (const candidate of [base, `${base}-form`, `${base}-form-2`, `${base}-form-3`]) {
    const { data } = await db.from('catalog_resources').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
  }
  return `${base}-form-${randomUUID().slice(0, 6)}`
}

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
      const { data: cur } = await db.from('catalog_forms').select('settings').eq('id', have.id).maybeSingle()
      await saveDraft(db, have.id, { draft: s.definition, settings: { ...(cur?.settings || {}), ...(s.settings || {}) } }, profile)
      const republish = s.publish || have.status === 'published'
      if (republish) await publish(db, have.id, profile)
      out.push({ key: s.slug, id: have.id, added: false, refreshed: true, published: republish })
      continue
    }
    // STARTER-SLUG-1 (2026-09-24): the Catalog can already hold a FILE under the starter's slug
    // (the ScrubEx PDF is 'scrubex-request-form', and the preceptor attachment reminder finds it
    // by that slug). The file keeps its slug; the form takes the first free '<slug>-form' name.
    // Until this, the starter was skipped and the Catalog said it was "already" there.
    const slug = await freeSlug(db, s.slug)
    const form = await createForm(db, { title: s.title, category: s.category, description: s.catalogDescription, starterKey: s.slug, slug, definition: s.definition, settings: s.settings || {} }, profile)
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
/** One person's assignment on the form's current version, with its link's hash stored. */
async function createAssignment(db, form, { person: p, batchId, audienceLabel = '', due = null, rule, sender, subject = '', message = '', isDemo = false }) {
  const row = check(await db.from('form_assignments').insert({
    org_id: ORG_ID, form_id: form.id, form_version: form.current_version, catalog_resource_id: form.catalog_resource_id, batch_id: batchId,
    audience_label: String(audienceLabel || '').slice(0, 300) || null, student_id: p.studentId || null, contact_id: p.contactId || null,
    school_name: p.schoolName || null, name: String(p.name || p.email).slice(0, 200), email: p.email, status: 'sent', due_at: due, reminder_rule: rule,
    sender_id: sender.id, sender_name: sender.full_name || null, sender_email: sender.email || null,
    subject: String(subject || '').slice(0, 200) || null, message: String(message || '').slice(0, 5000) || null, is_demo: isDemo,
  }).select('*').single(), 'Could not create the request')
  const token_hash = sha256(formTokenFor(row.id, row.link_version))
  check(await db.from('form_assignments').update({ token_hash }).eq('id', row.id), 'Could not create the link')
  return { ...row, token_hash }
}

// ── Outreach form buttons (OUTREACH-FORM-BUTTON-1) ─────────────────────────────────
// An Outreach email can carry a button that opens a Catalog form. Every link is personal, so
// the button holds the FORM, and each recipient's email gets that recipient's own link at
// send time: their open assignment on the form if they already have one, else a new one. The
// email itself is Outreach's; the form engine only makes the link.

/** The published forms behind these ids, or a FormError naming the first that cannot be sent. */
export async function formsForOutreach(db, formIds) {
  const out = new Map()
  for (const id of formIds) {
    if (!UUID_RE.test(id)) throw new FormError('invalid', 'A form button names a form that does not exist.', 400)
    const form = await loadForm(db, id).catch(() => null)
    if (!form) throw new FormError('not_found', 'A form button names a form that no longer exists. Edit the button and choose the form again.', 404)
    if (form.status !== 'published' || !form.current_version) {
      const v = form.draft?.title || 'A form in this email'
      throw new FormError('not_published', `${v} is not published yet. Publish it in the Catalog before sending.`, 409)
    }
    out.set(id, form)
  }
  return out
}

/**
 * The personal link for one recipient: their open assignment on this form (same email, same
 * population), or a new one on its current version. `created` says whether a row was made,
 * so a failed email can take it back.
 */
export async function outreachLink(db, form, { person, dueAt = null, reminderRule, batchId, subject = '' }, { appUrl, sender, isDemo = false }) {
  const email = String(person.email || '').trim()
  if (!EMAIL.test(email)) throw new FormError('invalid', 'This recipient has no usable email.', 400)
  const { data: open } = await db.from('form_assignments').select('*').eq('form_id', form.id).eq('is_demo', isDemo)
    .in('status', ['sent', 'opened']).eq('email', email).order('created_at', { ascending: false }).limit(1)
  const have = (open || [])[0]
  if (have && linkState(have, (await versionOf(db, form.id, have.form_version)).settings).open) {
    return { url: respondLink(appUrl, have), assignmentId: have.id, created: false }
  }
  const rule = REMINDER_RULES.some(r => r.key === reminderRule) ? reminderRule : (form.settings?.reminders || 'every_3_days')
  const row = await createAssignment(db, form, { person: { ...person, email }, batchId, audienceLabel: 'ASPIRE Connect Outreach', due: endOfDayIn(dueAt), rule, sender, subject, isDemo })
  return { url: respondLink(appUrl, row), assignmentId: row.id, created: true }
}

/** A button's due date (YYYY-MM-DD) as the end of that day in the program's time zone. */
export function endOfDayIn(date, timeZone = 'America/Los_Angeles') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!m) return null
  const noon = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(noon).find(x => x.type === 'timeZoneName')?.value || 'GMT'
  const off = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  const offset = off ? `${off[1]}${off[2]}:${off[3]}` : 'Z'
  return new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:00${offset}`).toISOString()
}

/** After the email: a new assignment records its delivery, and one whose email failed is withdrawn. */
export async function settleOutreachLinks(db, created, ok) {
  if (!created?.length) return
  const now = new Date().toISOString()
  if (ok) await db.from('form_assignments').update({ sent_at: now, delivery_ok: true }).in('id', created)
  else await db.from('form_assignments').update({ status: 'voided', voided_at: now, delivery_ok: false }).in('id', created)
}

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
    const row = await createAssignment(db, form, { person: p, batchId, audienceLabel, due, rule, sender, subject, message, isDemo })
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
  if (form?.starter_key === 'scrubex-request-form' && fitsScrubex(definition)) return 'scrubex'
  return null
}

// ── The paper original (PAPER-ORIGINAL-1) ─────────────────────────────────────────
// A layout's paper original is chosen from the Catalog's own files, like a signature
// template's (Owner, 2026-09-24). It is COPIED into the private form-files bucket at
// paper/<form id>.pdf; the Catalog's copy is never changed. Only the exact file a layout was
// measured on is accepted, so an answer can never land beside its box.

const CATALOG_BUCKET = 'aspire-catalog'
// Exported so the tests can stand in a PDF of their own; the repo never holds Parking's file.
export const PAPER_FILES = {
  'parking-spd': { sha256: PARKING_SPD_SHA256, name: 'Students Parking Data (SPD)', redrawn: true },
  scrubex: { sha256: SCRUBEX_SHA256, name: 'Cedars-Sinai scrubEx Policy', redrawn: false },
}
const PAPER_LAYOUT_BY_STARTER = { 'student-parking-request': 'parking-spd', 'scrubex-request-form': 'scrubex' }
const paperPath = (formId) => `paper/${formId}.pdf`

/** The layout a form's starter prints in, whether or not its current questions fit it yet. */
export const paperLayoutOf = (form) => PAPER_LAYOUT_BY_STARTER[form?.starter_key] || null

/** The paper original's bytes when one is on file and is still the measured file; else null. */
export async function paperOf(db, form) {
  const want = PAPER_FILES[paperLayoutOf(form)]
  if (!want) return null
  try {
    const { data, error } = await db.storage.from(FORM_BUCKET).download(paperPath(form.id))
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return createHash('sha256').update(bytes).digest('hex') === want.sha256 ? bytes : null
  } catch { return null }
}

export async function paperStatus(db, form) {
  const layout = paperLayoutOf(form)
  if (!layout) return null
  return { layout, name: PAPER_FILES[layout].name, redrawn: PAPER_FILES[layout].redrawn, onFile: !!(await paperOf(db, form)) }
}

/** Copy a Catalog PDF in as this form's paper original, if it is the file the layout was measured on. */
export async function setPaperFromCatalog(db, formId, resourceId) {
  const form = await loadForm(db, formId)
  const layout = paperLayoutOf(form)
  if (!layout) throw new FormError('no_layout', 'This form has no paper layout to print on.', 409)
  const { data: r } = await db.from('catalog_resources').select('id, title, storage_path, resource_type, kind, is_active').eq('id', resourceId).maybeSingle()
  if (!r || r.is_active === false || r.resource_type !== 'internal_file' || (r.kind && r.kind !== 'file') || !r.storage_path || /^(sig-template|form):/.test(r.storage_path)) {
    throw new FormError('not_found', 'That Catalog file is not available.', 404)
  }
  const { data: blob, error } = await db.storage.from(CATALOG_BUCKET).download(r.storage_path)
  if (error || !blob) throw new FormError('missing', 'The Catalog file could not be read.', 409)
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new FormError('not_pdf', 'That Catalog file is not a PDF.', 415)
  if (createHash('sha256').update(bytes).digest('hex') !== PAPER_FILES[layout].sha256) {
    throw new FormError('wrong_file', `That PDF is not the ${PAPER_FILES[layout].name} form the answer boxes were measured on. Choose that exact file.`, 422)
  }
  try { await PDFDocument.load(bytes, { updateMetadata: false }) } catch { throw new FormError('not_pdf', 'That PDF could not be read.', 415) }
  const up = await db.storage.from(FORM_BUCKET).upload(paperPath(form.id), bytes, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw new FormError('upload_failed', 'Could not copy the Catalog file.', 502)
  return { ...(await paperStatus(db, form)), title: r.title }
}

export async function clearPaper(db, formId) {
  const form = await loadForm(db, formId)
  await db.storage.from(FORM_BUCKET).remove([paperPath(form.id)])
  return paperStatus(db, form)
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

/**
 * OUTREACH-FORM-BUTTON-1: the respondent's own filed copy, again, from the same personal link
 * (the link is the identity check, as it was for submitting). Only for a submitted request,
 * and never once the sender has withdrawn it.
 */
export async function respondentCopy(db, { assignment, version }) {
  if (assignment.status !== 'submitted') throw new FormError('not_submitted', 'There is no copy until the form is submitted.', 409)
  const sub = check(await db.from('form_submissions').select('pdf_bucket, pdf_path').eq('assignment_id', assignment.id).maybeSingle(), 'Could not read the submission')
  if (!sub?.pdf_path || !sub.pdf_bucket) throw new FormError('no_copy', 'A copy of this form is not available. Contact the sender for one.', 404)
  const { data, error } = await db.storage.from(sub.pdf_bucket).download(sub.pdf_path)
  if (error || !data) throw new FormError('no_copy', 'A copy of this form is not available right now. Try again in a moment.', 502)
  const title = version.definition.title
  return { pdf: Buffer.from(await data.arrayBuffer()).toString('base64'), fileName: `${title.replace(/[^\w .-]+/g, '').slice(0, 80) || 'Form'}.pdf` }
}

export async function respondentState(db, { assignment, form, version }) {
  const gate = linkState(assignment, version.settings)
  if (assignment.status === 'submitted') {
    const sub = check(await db.from('form_submissions').select('id, submitted_at, pdf_path').eq('assignment_id', assignment.id).maybeSingle(), 'Could not read the submission')
    return { state: 'done', title: version.definition.title, name: assignment.name, submittedAt: sub?.submitted_at || assignment.submitted_at, copy: !!sub?.pdf_path, confirmation: version.definition.confirmation || '' }
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

// ── Forwarding the filled PDF (FORM-FORWARD-1) ──────────────────────────────────────
// A form can name an office that receives every filled PDF by email (settings.forwardTo, read
// from the form's CURRENT settings, so changing the address needs no new version). It goes
// from ASPIRE's address under the sender's name, the respondent copied, replies to the sender.
// Each attempt is a notification_log row (type form_pdf_forwarded), which is what Responses
// reads. A demo submission is never forwarded: the office is a real inbox.

export const FORWARD_TYPE = 'form_pdf_forwarded'

async function schoolOf(db, assignment) {
  if (assignment.school_name) return assignment.school_name
  if (!assignment.student_id) return ''
  const { data } = await db.from('students').select('school').eq('id', assignment.student_id).maybeSingle()
  return data?.school || ''
}

export async function forwardSubmission(db, { form, assignment, submissionId, pdf, title }, { mailer }) {
  const to = String(form.settings?.forwardTo || '').trim()
  if (!to || !pdf || assignment.is_demo) return null
  const school = await schoolOf(db, assignment)
  const mail = forwardEmail({ assignment, title, school })
  const fileName = `${title.replace(/[^\w .-]+/g, '').slice(0, 60) || 'Form'} - ${String(assignment.name || '').replace(/[^\w .-]+/g, '').slice(0, 60)}.pdf`
  let ok = false, error, id = null
  try {
    const r = await mailer.emails.send({ from: fromLine(assignment.sender_name), to: [to], cc: [assignment.email], reply_to: assignment.sender_email || undefined,
      subject: mail.subject, html: mail.html, attachments: [{ filename: fileName, content: pdf.toString('base64') }] })
    ok = !r?.error; error = r?.error?.message || null; id = r?.data?.id || null
  } catch (e) { error = e?.message || 'send failed' }
  try {
    await db.from('notification_log').insert({
      notification_type: FORWARD_TYPE, audience: 'contact', recipient_email: to, recipient_name: to, subject: mail.subject,
      status: ok ? 'sent' : 'failed', resend_email_id: id, sent_at: new Date().toISOString(), recipient_type: 'contact',
      student_id: assignment.student_id || null,
      metadata: { form_id: form.id, assignment_id: assignment.id, submission_id: submissionId, cc: assignment.email, error },
    })
  } catch { /* the log is best-effort; the result below is still returned */ }
  return { to, ok }
}

/** The latest forward per assignment of a form: Map(assignmentId -> { to, ok, at }). */
export async function forwardStatus(db, formId) {
  const out = new Map()
  try {
    const { data } = await db.from('notification_log').select('status, recipient_email, sent_at, metadata')
      .eq('notification_type', FORWARD_TYPE).order('sent_at', { ascending: false }).limit(5000)
    for (const r of data || []) {
      const m = r.metadata || {}
      if (m.form_id !== formId || out.has(m.assignment_id)) continue
      out.set(m.assignment_id, { to: r.recipient_email, ok: r.status === 'sent', at: r.sent_at })
    }
  } catch { /* no log, no status */ }
  return out
}

/** Send one submission's filed PDF to the form's office again (Responses > Resend). */
export async function resendForward(db, assignmentId, { mailer }) {
  const a = check(await db.from('form_assignments').select('*').eq('id', assignmentId).eq('org_id', ORG_ID).maybeSingle(), 'Could not read the response')
  if (!a || a.status !== 'submitted') throw new FormError('not_found', 'Nothing has been submitted yet.', 404)
  const form = await loadForm(db, a.form_id)
  if (!form.settings?.forwardTo) throw new FormError('no_forward', 'This form does not send its PDF anywhere. Add an address in the form\'s settings.', 409)
  const sub = check(await db.from('form_submissions').select('id, pdf_bucket, pdf_path').eq('assignment_id', a.id).maybeSingle(), 'Could not read the submission')
  if (!sub?.pdf_path) throw new FormError('no_copy', 'This response has no filed PDF to send.', 409)
  const { data, error } = await db.storage.from(sub.pdf_bucket).download(sub.pdf_path)
  if (error || !data) throw new FormError('no_copy', 'The filed PDF could not be read.', 502)
  const version = await versionOf(db, a.form_id, a.form_version)
  const r = await forwardSubmission(db, { form, assignment: a, submissionId: sub.id, pdf: Buffer.from(await data.arrayBuffer()), title: version.definition.title }, { mailer })
  if (!r?.ok) throw new FormError('send_failed', 'The email service did not accept it. Try again in a moment.', 502)
  return r
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
      layout, logo: layout ? await documentLogo(db) : null, paper: layout ? await paperOf(db, form) : null })
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
  const forwarded = await forwardSubmission(db, { form, assignment, submissionId, pdf, title: def.title }, { mailer })
  if (settings.notifyOnSubmit && assignment.sender_email) {
    await sendMail(mailer, { from: fromLine('ASPIRE'), to: assignment.sender_email,
      ...submittedNoticeEmail({ assignment, title: def.title, url: `${appUrl}/catalog/forms/${form.id}/responses` }) })
  }
  return { submissionId, submittedAt, filed: !!recordId, pdf: pdf ? pdf.toString('base64') : null, forwardedTo: forwarded?.ok ? forwarded.to : null }
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

// ── The Sheet (FORM-SHEET-1) ────────────────────────────────────────────────────────

/** Every submission of a form, one row each, one column per question (formModel.sheetFor). */
export async function sheetData(db, formId, { isDemo = false } = {}) {
  const form = await loadForm(db, formId)
  const versions = check(await db.from('catalog_form_versions').select('version, definition').eq('form_id', form.id), 'Could not read the form versions')
  const subs = check(await db.from('form_submissions').select('assignment_id, answers, submitted_at, form_version').eq('form_id', form.id).eq('is_demo', isDemo).order('submitted_at', { ascending: false }).limit(5000), 'Could not read the answers')
  const ids = subs.map(x => x.assignment_id)
  const people = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const part = check(await db.from('form_assignments').select('id, name, email, school_name, student_id').in('id', ids.slice(i, i + 200)), 'Could not read who answered')
    for (const a of part) people.set(a.id, a)
  }
  const studentIds = [...new Set([...people.values()].map(a => a.student_id).filter(Boolean))]
  const schools = new Map()
  for (let i = 0; i < studentIds.length; i += 200) {
    const { data } = await db.from('students').select('id, school').in('id', studentIds.slice(i, i + 200))
    for (const st of data || []) schools.set(st.id, st.school)
  }
  const raw = subs.map(x => {
    const a = people.get(x.assignment_id) || {}
    return { id: x.assignment_id, name: a.name || '', email: a.email || '', school: a.school_name || schools.get(a.student_id) || '', submittedAt: x.submitted_at, version: x.form_version, answers: x.answers }
  })
  // FORM-SHEET-2: the saved layout, staff values and formats, and corrections, when the
  // migration is in; without it the Sheet is read-only and says so (editable: false).
  const edits = await sheetEdits(db, form.id)
  const rows = withCorrections(raw, edits.corrections)
  const questionKeys = [...new Set(versions.flatMap(v => (v.definition?.questions || []).map(q => q.id)))]
  const layout = cleanLayout(edits.layout, questionKeys)
  return { form, ...sheetFor(versions, rows, { staffColumns: layout.staffColumns, cells: edits.cells }), layout, editable: edits.editable, summary: summaryFor(versions, rows) }
}

async function sheetEdits(db, formId) {
  const none = { editable: false, layout: {}, cells: [], corrections: [] }
  const view = await db.from('form_sheet_views').select('layout').eq('form_id', formId).maybeSingle()
  if (view.error) { if (notEnabled(view.error)) return none; throw new FormError('db_failed', 'Could not read the sheet layout.', 500) }
  const cells = await db.from('form_sheet_cells').select('assignment_id, column_key, value, format').eq('form_id', formId).limit(50000)
  const corrections = await db.from('form_answer_corrections').select('assignment_id, question_id, value, reason, corrected_by_name, corrected_at').eq('form_id', formId).order('corrected_at', { ascending: true }).limit(50000)
  if (cells.error || corrections.error) throw new FormError('db_failed', 'Could not read the sheet edits.', 500)
  return { editable: true, layout: view.data?.layout || {}, cells: cells.data || [], corrections: corrections.data || [] }
}

const needSheet = (e) => { if (notEnabled(e)) throw new FormError('not_enabled', 'Editing the Sheet needs a database update the Owner applies (20260929000000_form_sheet.sql).', 409) }

/** Save the layout: column order, widths, hidden, frozen, group by, and the staff columns. */
export async function saveSheetLayout(db, formId, layout, profile) {
  const form = await loadForm(db, formId)
  const versions = check(await db.from('catalog_form_versions').select('definition').eq('form_id', form.id), 'Could not read the form versions')
  const clean = cleanLayout(layout, [...new Set(versions.flatMap(v => (v.definition?.questions || []).map(q => q.id)))])
  const { error } = await db.from('form_sheet_views').upsert({ form_id: form.id, org_id: ORG_ID, layout: clean, updated_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: 'form_id' })
  if (error) { needSheet(error); throw new FormError('save_failed', 'Could not save the layout.', 500) }
  return clean
}

/**
 * Save staff values and cell formats: [{ assignmentId, key, value?, format? }]. A value is only
 * kept for a staff column; a format for any column. The submission's answers are never touched.
 */
export async function saveSheetCells(db, formId, updates, profile) {
  const form = await loadForm(db, formId)
  const view = await db.from('form_sheet_views').select('layout').eq('form_id', form.id).maybeSingle()
  if (view.error) { needSheet(view.error); throw new FormError('db_failed', 'Could not read the sheet layout.', 500) }
  const staff = new Map(cleanLayout(view.data?.layout || {}, []).staffColumns.map(c => [c.key, c]))
  const list = (Array.isArray(updates) ? updates : []).slice(0, 2000)
  const ids = [...new Set(list.map(u => u.assignmentId).filter(x => UUID_RE.test(String(x))))]
  const mine = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const part = check(await db.from('form_assignments').select('id').eq('form_id', form.id).in('id', ids.slice(i, i + 200)), 'Could not read the responses')
    for (const a of part) mine.add(a.id)
  }
  // A bulk upsert sends every column for every row, so each row carries the value AND the
  // format: what this save changes, and what was already stored for the rest.
  const stored = new Map()
  const idList = [...mine]
  for (let i = 0; i < idList.length; i += 200) {
    const { data, error } = await db.from('form_sheet_cells').select('assignment_id, column_key, value, format').in('assignment_id', idList.slice(i, i + 200))
    if (error) { needSheet(error); throw new FormError('db_failed', 'Could not read the cells.', 500) }
    for (const c of data || []) stored.set(`${c.assignment_id}|${c.column_key}`, c)
  }
  const now = new Date().toISOString()
  const byCell = new Map()
  for (const u of list) {
    const key = String(u.key || '')
    if (!mine.has(u.assignmentId) || !key || key.length > 60) continue
    const id = `${u.assignmentId}|${key}`
    const base = byCell.get(id) || stored.get(id) || {}
    const row = { assignment_id: u.assignmentId, column_key: key, form_id: form.id, org_id: ORG_ID, updated_by: profile.id, updated_at: now,
      value: base.value ?? null, format: base.format ?? null }
    let changed = false
    if ('format' in u) { row.format = cleanFormat(u.format); changed = true }
    if ('value' in u && staff.has(key)) { row.value = u.value == null || u.value === '' ? null : String(u.value).slice(0, 5000); changed = true }
    if (changed) byCell.set(id, row)
  }
  const rows = [...byCell.values()]
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('form_sheet_cells').upsert(rows.slice(i, i + 500), { onConflict: 'assignment_id,column_key' })
    if (error) { needSheet(error); throw new FormError('save_failed', 'Could not save the cells.', 500) }
  }
  return { saved: rows.length }
}

/**
 * Correct one submitted answer in the Sheet. The submission and its filed PDF keep what the
 * person sent; this appends a correction (who, when, the original, optional reason), and the
 * Sheet, Summary and Excel read the latest one. Setting it back to the original ends the tag.
 */
export async function correctAnswer(db, { formId, assignmentId, questionId, value, reason = '' }, profile) {
  const form = await loadForm(db, formId)
  const a = check(await db.from('form_assignments').select('id, form_id, form_version, status').eq('id', assignmentId).eq('form_id', form.id).maybeSingle(), 'Could not read the response')
  if (!a || a.status !== 'submitted') throw new FormError('not_found', 'Only a submitted answer can be corrected.', 404)
  const version = await versionOf(db, a.form_id, a.form_version)
  const q = (version.definition.questions || []).find(x => x.id === questionId)
  if (!q) throw new FormError('invalid', 'That question is not on the version this person answered.', 400)
  if (!CORRECTABLE_TYPES.includes(q.type)) throw new FormError('invalid', 'File uploads and signatures cannot be corrected.', 400)
  const def = { questions: [{ ...q, required: false }] }
  const clean = cleanAnswers(def, { [q.id]: value })
  const issues = answerIssues(def, clean)
  if (issues[q.id]) throw new FormError('invalid_answer', issues[q.id], 422)
  const sub = check(await db.from('form_submissions').select('answers').eq('assignment_id', a.id).maybeSingle(), 'Could not read the submission')
  const { error } = await db.from('form_answer_corrections').insert({
    org_id: ORG_ID, form_id: form.id, assignment_id: a.id, question_id: q.id, original: sub?.answers?.[q.id] ?? null,
    value: clean[q.id] ?? null, reason: String(reason || '').trim().slice(0, 500) || null, corrected_by: profile.id, corrected_by_name: profile.full_name || profile.email || null,
  })
  if (error) { needSheet(error); throw new FormError('save_failed', 'Could not save the correction.', 500) }
  return { value: clean[q.id] ?? null }
}

/**
 * The Sheet as an Excel workbook: the rows and columns the person is looking at, in that order,
 * with their formatting, column widths and grouping (FORM-SHEET-2), and a Corrections column
 * whenever a shown answer was corrected, so the export says what changed, who and when.
 */
export async function sheetXlsx(db, formId, { rowIds = null, columnKeys = null, groupBy = null, isDemo = false } = {}) {
  const { form, columns, rows, staffColumns, layout } = await sheetData(db, formId, { isDemo })
  const byId = new Map(rows.map(r => [r.id, r]))
  const shownRows = Array.isArray(rowIds) ? rowIds.map(id => byId.get(id)).filter(Boolean) : rows
  const all = [{ key: '@email', label: 'Email' }, { key: '@school', label: 'School' }, { key: '@submitted', label: 'Submitted' }, ...columns, ...staffColumns]
  const shownCols = Array.isArray(columnKeys) ? columnKeys.map(k => all.find(c => c.key === k)).filter(Boolean) : all
  const stamp = (iso) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }) : ''
  const fillHex = new Map(SHEET_FILLS.map(f => [f.key, f.hex])), inkHex = new Map(SHEET_INKS.map(f => [f.key, f.hex]))
  const styled = (fmt) => fmt ? { ...(fmt.b ? { b: true } : {}), ...(fmt.i ? { i: true } : {}), ...(fmt.u ? { u: true } : {}), ...(fmt.wrap ? { wrap: true } : {}),
    ...(fmt.align ? { align: fmt.align } : {}), ...(fmt.fill ? { fill: fillHex.get(fmt.fill) } : {}), ...(fmt.ink ? { ink: inkHex.get(fmt.ink) } : {}) } : null
  const valueOf = (r, key) => key === '@email' ? r.email : key === '@school' ? r.school : key === '@submitted' ? stamp(r.submittedAt) : (r.cells[key] ?? '')
  const anyCorrected = shownRows.some(r => shownCols.some(c => r.corrected?.[c.key]))
  const qById = new Map(columns.map(c => [c.key, c]))
  const correctionsText = (r) => shownCols.filter(c => r.corrected?.[c.key]).map(c => {
    const x = r.corrected[c.key]
    const was = x.original == null ? '(blank)' : Array.isArray(x.original) ? x.original.join('; ') : String(x.original)
    return `${qById.get(c.key)?.label || c.key}: was "${was}" (${x.by || 'staff'}, ${stamp(x.at)}${x.reason ? `, ${x.reason}` : ''})`
  }).join(' | ')
  // FORM-SHEET-3: a column that is formatted as a number, asked for numbers, or summed goes
  // out as real numbers with the same $, % or decimal format, so Excel can do sums with it.
  const excelNumFmt = (f) => {
    const dec = Number.isInteger(f?.dec) ? f.dec : (f?.num === 'currency' ? 2 : 0)
    const tail = dec ? `.${'0'.repeat(dec)}` : ''
    if (f?.num === 'currency') return `"$"#,##0${tail}`
    if (f?.num === 'percent') return `0${tail}%`
    return `${f?.comma ? '#,##0' : '0'}${tail}`
  }
  const numericCol = (c) => c.type === 'number' || !!layout.summaries?.[c.key] || !!(layout.colFormats?.[c.key]?.num || Number.isInteger(layout.colFormats?.[c.key]?.dec) || layout.colFormats?.[c.key]?.comma)
  const cellFor = (r, c) => {
    const f = c.key === '@submitted' ? null : mergeFormat(layout.colFormats?.[c.key], r.format?.[c.key])
    const raw = valueOf(r, c.key)
    const n = c.key === '@submitted' ? null : parseNumber(raw)
    const numFmt = f && (f.num || Number.isInteger(f.dec) || f.comma)
    if (n != null && (numFmt || numericCol(c))) return { n, f: { ...(styled(f) || {}), ...(numFmt ? { nf: excelNumFmt(f) } : {}) } }
    return { v: c.key === '@submitted' ? raw : displayValue(raw, f), f: styled(f) }
  }
  const header = ['Name', ...shownCols.map(c => (c.earlier ? `${c.label} (earlier version)` : c.label)), ...(anyCorrected ? ['Corrections'] : [])]
  const line = (r) => [
    { v: r.name, f: styled(mergeFormat(layout.colFormats?.['@name'], r.format?.['@name'])) },
    ...shownCols.map(c => cellFor(r, c)),
    ...(anyCorrected ? [correctionsText(r)] : []),
  ]
  const key = groupBy && shownCols.concat([{ key: '@school' }]).some(c => c.key === groupBy) ? groupBy : null
  let body
  if (key) {
    const groups = new Map()
    for (const r of shownRows) { const g = String(valueOf(r, key) || '').trim() || '(blank)'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r) }
    body = [...groups].flatMap(([g, list]) => [{ group: g, count: list.length }, ...list.map(line)])
  } else body = shownRows.map(line)
  // The summary row: real formulas over the rows above (group rows are empty there, so they
  // never count), with the value already worked out so a viewer that does not recalculate
  // still shows it.
  const FN = { sum: 'SUM', avg: 'AVERAGE', min: 'MIN', max: 'MAX', count: 'COUNT', counta: 'COUNTA' }
  if (shownCols.some(c => layout.summaries?.[c.key]) && body.length) {
    const lastRow = body.length + 1
    const summary = [{ v: 'Summary', f: { b: true } }, ...shownCols.map((c, i) => {
      const fn = layout.summaries?.[c.key]
      if (!fn) return ''
      const col = colLetter(i + 1)
      const cached = summarize(shownRows.map(r => valueOf(r, c.key)), fn)
      const f = layout.colFormats?.[c.key]
      const nf = fn !== 'count' && fn !== 'counta' && f && (f.num || Number.isInteger(f.dec) || f.comma) ? excelNumFmt(f) : null
      return { formula: `${FN[fn]}(${col}2:${col}${lastRow})`, n: cached ?? 0, f: { b: true, ...(nf ? { nf } : {}) } }
    }), ...(anyCorrected ? [''] : [])]
    summary.summary = true
    body.push(summary)
  }
  const px = (k) => layout.widths?.[k] || 0
  const widths = [px('@name'), ...shownCols.map(c => px(c.key)), ...(anyCorrected ? [0] : [])]
  const title = form.draft?.title || 'Form'
  return { bytes: xlsxFor({ sheetName: title, header, rows: body, widths }), fileName: `${title.replace(/[^\w .-]+/g, '').slice(0, 80) || 'Form'} responses.xlsx` }
}
