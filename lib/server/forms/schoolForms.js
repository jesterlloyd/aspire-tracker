// lib/server/forms/schoolForms.js
//
// AP-SCHOOL-FORMS-1 (Owner, 2026-11-08): an Academic Partner builds its own forms and sends
// them to its own students. A school form is an ordinary Catalog form (the same engine, the
// same frozen versions, the same respondent page, the same filing to the student's record)
// with two differences:
//
//   - catalog_forms.owner_school_key names the school that owns it, and
//   - it has NO catalog_resources row, so it never appears in ASPIRE's Catalog.
//
// The school endpoint (api/portal/school-forms.js) hands every action to the staff action
// switch (api/form-staff.js `act`) only after `gateSchoolAction` has proved that every form
// and every response the request touches belongs to one of the caller's schools. A student
// to send to is resolved here from the caller's scopes; the browser never supplies an email.
// The staff endpoint, in turn, refuses to WRITE to a school's form (`refuseSchoolFormWrite`):
// the ASPIRE team reads a school's forms through the Academic Partner portal's staff preview.
import { cleanDefinition, cleanSettings, ORG_ID, FormError, notEnabled } from './engine.js'
import { matchSchoolCohortScope, resolveSchoolScopedStudents } from '../../../api/lib/schoolScope.js'
import { scopeKeyFor } from '../schoolStudentRecords.js'
import { getStudentPreferredFullName } from '../../../src/lib/studentNameFormatters.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a school may ask for. Everything else (paper originals, starters, CSV, the tracker) is ASPIRE's. */
export const SCHOOL_READS = new Set(['status', 'list', 'students', 'get', 'assignments', 'submission', 'sheet', 'sheet_xlsx', 'file_url'])
export const SCHOOL_WRITES = new Set(['create', 'save', 'publish', 'send', 'remind', 'remind_overdue', 'void', 'sheet_layout', 'sheet_cells', 'sheet_correct'])

/** Staff actions that change a form or its responses; refused on a school's form. */
export const STAFF_WRITES = new Set(['save', 'publish', 'send', 'remind', 'remind_overdue', 'void', 'sheet_layout', 'sheet_cells', 'sheet_correct', 'forward', 'paper_set', 'paper_clear', 'use_starter'])

export const schoolKeysOf = (scopes) => [...new Set((scopes || []).map(s => s.school_key).filter(Boolean))]

const ids = (v) => (Array.isArray(v) ? v : []).map(String).filter(x => UUID.test(x))

/** The form ids a request names directly, and the response ids it names. */
export function namedIds(body = {}) {
  const forms = new Set()
  const responses = new Set()
  if (UUID.test(String(body.id || ''))) forms.add(String(body.id))
  if (UUID.test(String(body.send?.formId || ''))) forms.add(String(body.send.formId))
  if (UUID.test(String(body.assignment_id || ''))) responses.add(String(body.assignment_id))
  for (const x of ids(body.ids)) responses.add(x)
  return { forms: [...forms], responses: [...responses] }
}

/**
 * The owner of every form the request touches: Map(formId -> school_key | null).
 * A response id is read back to its form. `missingColumn` is true before the migration,
 * when no form can have an owner.
 */
export async function ownersOf(db, body) {
  const { forms, responses } = namedIds(body)
  const formIds = new Set(forms)
  const unknownResponses = []
  if (responses.length) {
    const r = await db.from('form_assignments').select('id, form_id').in('id', responses)
    if (r.error) throw new FormError('db_failed', 'Could not read the responses.', 500)
    const found = new Set()
    for (const a of r.data || []) { formIds.add(a.form_id); found.add(a.id) }
    for (const id of responses) if (!found.has(id)) unknownResponses.push(id)
  }
  const owners = new Map()
  if (!formIds.size) return { owners, unknownResponses, missingColumn: false }
  const f = await db.from('catalog_forms').select('id, owner_school_key').in('id', [...formIds])
  if (f.error) {
    if (notEnabled(f.error)) { for (const id of formIds) owners.set(id, null); return { owners, unknownResponses, missingColumn: true } }
    throw new FormError('db_failed', 'Could not read the form.', 500)
  }
  const found = new Set()
  for (const row of f.data || []) { owners.set(row.id, row.owner_school_key ?? null); found.add(row.id) }
  for (const id of formIds) if (!found.has(id)) owners.set(id, undefined)
  return { owners, unknownResponses, missingColumn: false }
}

/** The staff endpoint never writes to a school's form. Throws 403 when it would. */
export async function refuseSchoolFormWrite(db, body) {
  if (!STAFF_WRITES.has(body?.action)) return
  const { owners } = await ownersOf(db, body)
  if ([...owners.values()].some(k => k != null)) {
    throw new FormError('school_form', "This form belongs to a school. Open it in the Academic Partner Portal to read it; only the school can change it.", 403)
  }
}

/**
 * The school side's gate. Resolves to nothing when the request may go on, throws otherwise.
 * A read in staff preview may open any school's form; everything else must be the caller's.
 */
export async function gateSchoolAction(db, body, { scopes, staffPreview = false }) {
  const action = body?.action
  if (!SCHOOL_READS.has(action) && !SCHOOL_WRITES.has(action)) throw new FormError('invalid', 'Unknown action.', 400)
  if (staffPreview && SCHOOL_WRITES.has(action)) throw new FormError('preview_read_only', 'Preview is read-only.', 403)
  if (['status', 'list', 'students', 'create'].includes(action)) return
  const { owners, unknownResponses, missingColumn } = await ownersOf(db, body)
  if (missingColumn) throw new FormError('not_enabled', 'School forms are not set up yet.', 409)
  if (unknownResponses.length || !owners.size) throw new FormError('not_found', 'Form not found.', 404)
  const keys = new Set(schoolKeysOf(scopes))
  for (const key of owners.values()) {
    // An ASPIRE form (null) or a form that does not exist (undefined) reads as not found.
    if (key == null) throw new FormError('not_found', 'Form not found.', 404)
    if (!staffPreview && !keys.has(key)) throw new FormError('not_found', 'Form not found.', 404)
  }
}

/** Whether the owner column exists (the migration has been applied). */
export async function schoolFormsEnabled(db) {
  const r = await db.from('catalog_forms').select('id, owner_school_key', { head: true, count: 'exact' }).limit(1)
  return !r.error
}

/** The caller's schools' forms, newest first, with a count of where each one stands. */
export async function listSchoolForms(db, { scopes, staffPreview = false, isDemo = false }) {
  const keys = schoolKeysOf(scopes)
  let q = db.from('catalog_forms').select('id, owner_school_key, status, draft, current_version, draft_dirty, created_at, updated_at').eq('org_id', ORG_ID).neq('status', 'archived')
  q = staffPreview ? q.not('owner_school_key', 'is', null) : q.in('owner_school_key', keys.length ? keys : ['\u0000'])
  const r = await q.order('updated_at', { ascending: false }).limit(500)
  if (r.error) throw new FormError('db_failed', 'Could not read the forms.', 500)
  const forms = r.data || []
  const counts = new Map(forms.map(f => [f.id, { total: 0, submitted: 0 }]))
  if (forms.length) {
    const a = await db.from('form_assignments').select('form_id, status').in('form_id', forms.map(f => f.id)).eq('is_demo', isDemo).neq('status', 'voided').limit(10000)
    for (const row of a.data || []) {
      const c = counts.get(row.form_id); if (!c) continue
      c.total++; if (row.status === 'submitted') c.submitted++
    }
  }
  return forms.map(f => ({
    id: f.id, schoolKey: f.owner_school_key, title: f.draft?.title || 'Untitled form', status: f.status,
    version: f.current_version, unpublishedChanges: f.status === 'published' && f.draft_dirty === true,
    updatedAt: f.updated_at, ...counts.get(f.id),
  }))
}

/** A new draft owned by one of the caller's schools. No Catalog item: it is the school's, not ASPIRE's. */
export async function createSchoolForm(db, { scopes, schoolKey, title, description = '' }, profile) {
  if (!schoolKeysOf(scopes).includes(schoolKey)) throw new FormError('forbidden', 'Choose one of your schools.', 403)
  const t = String(title || '').trim()
  if (!t) throw new FormError('invalid', 'Name the form.')
  const r = await db.from('catalog_forms').insert({
    org_id: ORG_ID, owner_school_key: schoolKey, catalog_resource_id: null,
    draft: cleanDefinition({ title: t, description: String(description || '').slice(0, 1000), questions: [] }),
    settings: cleanSettings({ audience: 'students' }), created_by: profile.id, updated_by: profile.id,
  }).select('*').single()
  if (r.error) {
    if (notEnabled(r.error)) throw new FormError('not_enabled', 'School forms are not set up yet.', 409)
    throw new FormError('save_failed', 'Could not create the form.', 500)
  }
  return r.data
}

const STUDENT_COLS = ['id', 'first_name', 'last_name', 'preferred_first_name', 'school', 'cohort_id', 'status', 'school_email', 'personal_email', 'is_demo']

/** Where a school form goes: the school address, else the personal one. */
export const sendAddress = (s) => String(s?.school_email || '').trim() || String(s?.personal_email || '').trim() || ''

/** The students a school may send this form to: its own, in its scopes, with an address. No emails leave. */
export async function schoolStudentsFor(db, { scopes, schoolKey = null }) {
  const { matches } = await resolveSchoolScopedStudents(db, scopes, STUDENT_COLS.join(', '))
  return matches
    .filter(m => !schoolKey || m.school_key === schoolKey)
    .map(({ student: s, school_key }) => ({
      id: s.id, name: getStudentPreferredFullName(s), cohortId: s.cohort_id, status: s.status || null,
      schoolKey: school_key, hasEmail: Boolean(sendAddress(s)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The people for a send, resolved on the server: each id must be a student of the form's
 * own school inside the caller's scopes. Returns { people, skipped }.
 */
export async function peopleForSend(db, { scopes, schoolKey, studentIds }) {
  const wanted = [...new Set(ids(studentIds))].slice(0, 500)
  if (!wanted.length) throw new FormError('invalid', 'Choose at least one student.')
  const r = await db.from('students').select(STUDENT_COLS.join(', ')).in('id', wanted)
  if (r.error) throw new FormError('db_failed', 'Could not read the students.', 500)
  const people = []
  const skipped = []
  const byId = new Map((r.data || []).map(s => [s.id, s]))
  for (const id of wanted) {
    const s = byId.get(id)
    if (!s || !matchSchoolCohortScope(scopes, s.school, s.cohort_id) || scopeKeyFor(scopes, s) !== schoolKey) { skipped.push({ id, reason: 'not_yours' }); continue }
    const email = sendAddress(s)
    if (!email) { skipped.push({ id, reason: 'no_email', name: getStudentPreferredFullName(s) }); continue }
    people.push({ studentId: s.id, name: getStudentPreferredFullName(s), email, schoolName: s.school })
  }
  return { people, skipped }
}

/**
 * The whole school-side request: gate, then either answer here (list, students, create, send's
 * people) or hand the request to the staff action switch. `act` is api/form-staff.js's.
 */
export async function schoolFormAction(db, body, { scopes, staffPreview = false, profile, isDemo = false, act }) {
  await gateSchoolAction(db, body, { scopes, staffPreview })
  switch (body.action) {
    case 'status': return { enabled: await schoolFormsEnabled(db), schools: schoolKeysOf(scopes), readOnly: staffPreview }
    case 'list': return { forms: await listSchoolForms(db, { scopes, staffPreview, isDemo }), readOnly: staffPreview }
    case 'students': {
      const key = body.school_key ? String(body.school_key) : null
      if (key && !staffPreview && !schoolKeysOf(scopes).includes(key)) throw new FormError('forbidden', 'Choose one of your schools.', 403)
      return { students: await schoolStudentsFor(db, { scopes, schoolKey: key }) }
    }
    case 'create': return { form: await createSchoolForm(db, { scopes, schoolKey: String(body.school_key || ''), title: body.title, description: body.description }, profile) }
    case 'send': {
      const s = body.send || {}
      const { owners } = await ownersOf(db, { id: s.formId })
      const schoolKey = owners.get(String(s.formId))
      const { people, skipped } = await peopleForSend(db, { scopes, schoolKey, studentIds: s.studentIds })
      if (!people.length) throw new FormError('invalid', skipped.some(x => x.reason === 'no_email') ? 'None of those students has an email on file.' : 'Choose at least one of your students.')
      const out = await act(db, {
        action: 'send',
        send: { formId: s.formId, people, dueAt: s.dueAt || null, reminderRule: s.reminderRule, subject: s.subject, message: s.message, audienceLabel: schoolKey },
      }, { profile, isDemo })
      return { ...out, skipped }
    }
    case 'get': {
      const out = await act(db, body, { profile, isDemo })
      // Paper originals are ASPIRE's starter forms only; a school form never has one.
      return { ...out, paper: null, readOnly: staffPreview }
    }
    default: return act(db, body, { profile, isDemo })
  }
}
