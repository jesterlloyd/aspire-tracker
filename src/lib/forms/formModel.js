// src/lib/forms/formModel.js
//
// FORMS-PHASE3 (ASPIRE Catalog Phase 3, 2026-09-24): every rule about a form, pure and
// tested without a browser. The builder, the respondent page, the server and the CSV
// export all read this module, so a question means the same thing everywhere.
//
// Owner decisions (2026-09-23): a form link is the whole identity check (no emailed code);
// the Signature question is a simple typed or drawn signature printed on the form's PDF,
// not a sealed e-signature (anything legally binding goes out as a Signature template).

// ── Question types (brief section 5, in its palette order) ──────────────────────────

export const QUESTION_TYPES = Object.freeze([
  { key: 'short', label: 'Short answer', glyph: 'Aa' },
  { key: 'paragraph', label: 'Paragraph', glyph: '¶' },
  { key: 'choice', label: 'Multiple choice', glyph: '◉', options: true },
  { key: 'checkboxes', label: 'Checkboxes', glyph: '☑', options: true },
  { key: 'dropdown', label: 'Dropdown', glyph: '▾', options: true },
  { key: 'number', label: 'Number', glyph: '#' },
  { key: 'date', label: 'Date', glyph: '31' },
  { key: 'file', label: 'File upload', glyph: '⤒' },
  { key: 'signature', label: 'Signature', glyph: '✍' },
  { key: 'section', label: 'Section heading', glyph: '§', noAnswer: true },
])
export const questionType = (key) => QUESTION_TYPES.find(t => t.key === key)
export const hasOptions = (q) => !!questionType(q?.type)?.options

// FORM-OTHER-1 (2026-09-24, Owner): a choice, checkbox or dropdown question can offer "Other"
// with a text box. Its answer is stored as the text "Other: <what they typed>", so every
// reader (PDF, CSV, Sheet, viewer) shows it as written with no special case.
export const OTHER_PREFIX = 'Other: '
export const isOtherValue = (v) => typeof v === 'string' && /^Other:/.test(v)
export const otherText = (v) => String(v || '').replace(/^Other:\s*/, '')
export const otherValue = (text) => `${OTHER_PREFIX}${String(text || '')}`
export const takesAnswer = (q) => !!q && !questionType(q.type)?.noAnswer

// ── Prefill: answers ASPIRE already has (brief: "Prefill from") ─────────────────────
// Each source names what it reads; the server resolves it for the one respondent the
// link belongs to, and the respondent can still correct it before submitting.

export const PREFILL_SOURCES = Object.freeze([
  { key: 'student.full_name', label: 'Student record · Legal name', group: 'Student record' },
  { key: 'student.preferred_name', label: 'Student record · Preferred name', group: 'Student record' },
  { key: 'student.first_name', label: 'Student record · Legal first name', group: 'Student record' },
  { key: 'student.last_name', label: 'Student record · Last name', group: 'Student record' },
  { key: 'student.email', label: 'Student record · Email', group: 'Student record' },
  { key: 'student.phone', label: 'Student record · Phone', group: 'Student record' },
  { key: 'student.school', label: 'Student record · School', group: 'Student record' },
  { key: 'placement.unit', label: 'Placement · Unit', group: 'Placement' },
  { key: 'placement.start_date', label: 'Placement · Start date', group: 'Placement' },
  { key: 'placement.end_date', label: 'Placement · End date', group: 'Placement' },
  { key: 'placement.preceptor', label: 'Placement · Preceptor', group: 'Placement' },
])
export const prefillSource = (key) => PREFILL_SOURCES.find(s => s.key === key)
// Which question types a source may fill (a date source never fills a checkbox).
export function prefillFits(type, sourceKey) {
  if (!sourceKey) return true
  if (/date$/.test(sourceKey)) return type === 'date' || type === 'short'
  return ['short', 'paragraph', 'dropdown'].includes(type)
}

// ── Settings (brief: Form settings tab) ─────────────────────────────────────────────

export const AUDIENCE_KEYS = Object.freeze(['students', 'preceptors', 'schools'])
export const REMINDER_RULES = Object.freeze([
  { key: 'every_3_days', label: 'Every 3 days until done' },
  { key: 'once_before_due', label: 'Once, 2 days before due' },
  { key: 'off', label: 'Off' },
])
export const DEFAULT_SETTINGS = Object.freeze({
  audience: 'students', filePdf: true, notifyOnSubmit: false, closeAfterDue: true, reminders: 'every_3_days', exportCsv: true,
  // FORM-FORWARD-1: an office that receives every filled PDF by email ('' = none).
  forwardTo: '',
})

// ── Building ────────────────────────────────────────────────────────────────────────

let seq = 0
export function newQuestionId() {
  seq = (seq + 1) % 1e6
  return `q${Date.now().toString(36)}${seq.toString(36)}`
}

export function newQuestion(type, id = newQuestionId()) {
  const t = questionType(type) || QUESTION_TYPES[0]
  const q = { id, type: t.key, label: t.key === 'section' ? 'New section' : `Untitled ${t.label.toLowerCase()} question`, help: '', required: false }
  if (t.options) q.options = ['Option 1', 'Option 2']
  if (t.key === 'number') { q.min = null; q.max = null }
  if (t.key === 'signature') q.required = true
  return q
}

export function moveQuestion(questions, from, to) {
  const list = [...questions]
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const [q] = list.splice(from, 1)
  list.splice(to, 0, q)
  return list
}

export function emptyDefinition(title = 'Untitled form') {
  return { title, description: '', questions: [] }
}

/** Problems that stop a form from being published, in words. Empty = publishable. */
export function definitionIssues(def) {
  const issues = []
  if (!String(def?.title || '').trim()) issues.push('Give the form a title.')
  const qs = def?.questions || []
  if (!qs.some(takesAnswer)) issues.push('Add at least one question.')
  const ids = new Set()
  qs.forEach((q, i) => {
    const n = `Question ${i + 1}`
    if (ids.has(q.id)) issues.push(`${n} repeats an id.`)
    ids.add(q.id)
    if (!questionType(q.type)) issues.push(`${n} has an unknown type.`)
    if (!String(q.label || '').trim()) issues.push(`${n} needs a label.`)
    if (hasOptions(q)) {
      const opts = (q.options || []).map(o => String(o).trim())
      if (opts.length < 2) issues.push(`${n} needs at least two options.`)
      if (opts.some(o => !o)) issues.push(`${n} has an empty option.`)
      if (new Set(opts).size !== opts.length) issues.push(`${n} repeats an option.`)
    }
    if (q.type === 'number' && q.min != null && q.max != null && Number(q.min) > Number(q.max)) issues.push(`${n}: the smallest allowed number is above the largest.`)
    if (q.prefill && !prefillSource(q.prefill)) issues.push(`${n} fills from an unknown source.`)
    if (q.prefill && !prefillFits(q.type, q.prefill)) issues.push(`${n}: ${questionType(q.type)?.label || 'this type'} cannot be filled from ${prefillSource(q.prefill)?.label}.`)
  })
  return issues
}

// ── Answering ───────────────────────────────────────────────────────────────────────

const isBlank = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
    || (typeof v === 'object' && !Array.isArray(v) && v.kind == null && v.path == null && v.name == null)

/** Every problem with a set of answers, keyed by question id. Empty = submittable. */
const otherIssue = (v) => !otherText(v).trim() ? 'Say what "Other" is.' : otherText(v).length > 200 ? 'Keep "Other" under 200 characters.' : null

export function answerIssues(def, answers = {}) {
  const out = {}
  for (const q of def?.questions || []) {
    if (!takesAnswer(q)) continue
    const v = answers[q.id]
    if (isBlank(v)) { if (q.required) out[q.id] = 'This question needs an answer.'; continue }
    switch (q.type) {
      case 'short': if (String(v).length > 500) out[q.id] = 'Keep this under 500 characters.'; break
      case 'paragraph': if (String(v).length > 5000) out[q.id] = 'Keep this under 5,000 characters.'; break
      case 'choice': case 'dropdown': {
        if ((q.options || []).includes(v)) break
        out[q.id] = !isOtherValue(v) || !q.allowOther ? 'Choose one of the options.' : otherIssue(v)
        if (!out[q.id]) delete out[q.id]
        break
      }
      case 'checkboxes': {
        if (!Array.isArray(v)) { out[q.id] = 'Choose from the options.'; break }
        const others = v.filter(x => !(q.options || []).includes(x))
        if (others.some(x => !isOtherValue(x)) || (others.length && !q.allowOther) || others.length > 1) { out[q.id] = 'Choose from the options.'; break }
        if (others.length && otherIssue(others[0])) out[q.id] = otherIssue(others[0])
        break
      }
      case 'number': {
        const n = Number(v)
        if (String(v).trim() === '' || !Number.isFinite(n)) { out[q.id] = 'Enter a number.'; break }
        if (q.min != null && n < Number(q.min)) out[q.id] = `The smallest allowed is ${q.min}.`
        else if (q.max != null && n > Number(q.max)) out[q.id] = `The largest allowed is ${q.max}.`
        break
      }
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) out[q.id] = 'Enter a date.'; break
      case 'file': if (!v?.path || !/^uploads\/[0-9a-f-]{36}\/[\w .()-]{1,120}$/.test(v.path)) out[q.id] = 'Upload the file again.'; break
      case 'signature':
        if (v?.kind === 'type' ? !String(v.text || '').trim() : !(v?.kind === 'draw' && String(v.path || '').length > 10)) out[q.id] = 'Sign here.'
        break
      default: break
    }
  }
  return out
}

/** Keep only answers to this form's questions, in canonical shapes. */
export function cleanAnswers(def, answers = {}) {
  const out = {}
  for (const q of def?.questions || []) {
    if (!takesAnswer(q) || !(q.id in answers)) continue
    const v = answers[q.id]
    if (isBlank(v)) continue
    if (q.type === 'checkboxes') out[q.id] = (Array.isArray(v) ? v : [v]).map(x => (isOtherValue(x) ? otherValue(otherText(x).trim()) : String(x)))
    else if ((q.type === 'choice' || q.type === 'dropdown') && isOtherValue(v)) out[q.id] = otherValue(otherText(v).trim())
    else if (q.type === 'number') out[q.id] = Number(v)
    else if (q.type === 'signature') out[q.id] = v.kind === 'draw'
      ? { kind: 'draw', path: String(v.path).slice(0, 20000).replace(/[^MLQCZmlqcz0-9.,\s-]/g, ''), text: String(v.text || '').slice(0, 120) }
      : { kind: 'type', text: String(v.text || '').trim().slice(0, 120) }
    else if (q.type === 'file') out[q.id] = { path: String(v.path), name: String(v.name || '').slice(0, 120), size: Number(v.size) || null }
    else out[q.id] = String(v).trim()
  }
  return out
}

/** One answer as text, for the PDF, the CSV and the staff viewer. */
export function answerText(q, v) {
  if (isBlank(v)) return ''
  switch (q.type) {
    case 'checkboxes': return (Array.isArray(v) ? v : [v]).join('; ')
    case 'date': return formatDate(v)
    case 'file': return v?.name || 'File uploaded'
    case 'signature': return v?.kind === 'draw' ? `Drawn signature${v.text ? ` (${v.text})` : ''}` : String(v?.text || '')
    default: return String(v)
  }
}

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso || '')
}

// ── Status (computed, never stored beyond the assignment's own facts) ──────────────

export const ASSIGNMENT_STATUS = Object.freeze({ sent: 'Sent', opened: 'Opened', submitted: 'Submitted', closed: 'Closed', voided: 'Voided' })
export function assignmentState(a, now = Date.now()) {
  if (a?.status === 'submitted' || a?.submitted_at) return 'submitted'
  if (a?.status === 'voided') return 'voided'
  if (a?.status === 'closed') return 'closed'
  const due = a?.due_at ? Date.parse(a.due_at) : NaN
  if (Number.isFinite(due) && due < now) return 'overdue'
  return a?.opened_at ? 'opened' : 'sent'
}
/** The shape the Catalog's completion counts read (catalogModel.completionStatus). */
export const toCompletionRow = (a) => ({ due_at: a.due_at, opened_at: a.opened_at, completed_at: a.submitted_at, status: a.status === 'submitted' ? 'done' : a.status })

// ── Export (brief: "CSV for Parking or ScrubEx") ────────────────────────────────────

const csvCell = (v) => {
  const s = String(v ?? '')
  // A cell that starts like a formula is quoted text in every spreadsheet app.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Rows for the CSV: one per submission, columns in question order, answers as text. */
export function csvFor(def, rows) {
  const qs = (def?.questions || []).filter(q => takesAnswer(q) && q.type !== 'signature' && q.type !== 'file')
  const head = ['Submitted', 'Name', 'Email', ...qs.map(q => q.label)]
  const lines = [head.map(csvCell).join(',')]
  for (const r of rows || []) {
    lines.push([r.submitted_at ? new Date(r.submitted_at).toISOString().slice(0, 16).replace('T', ' ') : '', r.name || '', r.email || '',
      ...qs.map(q => answerText(q, r.answers?.[q.id]))].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

// ── Starter forms (brief section 5) ─────────────────────────────────────────────────
// A starter that ships as a draft and is later corrected lists its earlier drafts here.
// installStarters replaces a draft that still equals one of them word for word, so an
// install made before the correction gets it, and a draft someone edited is never touched.

// The size and scrub machine lists exactly as Linen Services' form prints them; the paper
// layout (lib/server/forms/layouts/scrubex.js) finds each one's box by this text.
export const SCRUB_SIZES = Object.freeze(['X-Small', 'Small', 'Medium', 'Large', 'X-Large', '2X-Large', '3X-Large'])
export const SCRUB_MACHINES = Object.freeze([
  "Main OR's: 3rd - 8th", "Pavilion OR's: 4th - 5th", 'Pathology: 8th', 'Endo: 7th', 'GI Lab: 7th', 'Cath Lab: 6th', 'L&D: 3rd', 'South Tower: LL',
])

// The ScrubEx definition as SCRUBEX-PAPER-1 shipped it (a9d894c8); FORM-CONFIRMATION-1 adds the
// Linen Services email to it, and an unedited form made from this one is offered the update.
const SCRUBEX_V2 = Object.freeze({
  title: 'ScrubEx Request Form',
  description: 'Linen Services loads your scrub credits onto your badge. Read the scrubEx policy, then initial it. Takes about 2 minutes.',
  questions: [
    { id: 'policy_h', type: 'section', label: 'Cedars-Sinai scrubEx policy', help: 'Students receive 2 scrub credits. Every garment goes back into a scrubEx unit, never a soiled linen hamper; the unit allows 20 seconds to deposit once your badge is swiped. Machines have cameras and deposits are monitored. Depositing non-Cedars scrubs or anything else (linen, disposables, trash) ends your scrub machine privileges. Linen Services: ext 3-0772, M/W/F 7-10 am and 1-4 pm, T/Th 7-11 am and 1-4 pm.', required: false },
    { id: 'initial', type: 'short', label: 'Initial', help: 'Your initials acknowledge the scrubEx policy above.', required: true },
    { id: 'last_name', type: 'short', label: 'Last name', help: '', required: true, prefill: 'student.last_name' },
    { id: 'first_name', type: 'short', label: 'First name', help: '', required: true, prefill: 'student.first_name' },
    { id: 'department', type: 'short', label: 'Department name', help: 'For example, Nursing Education.', required: true },
    { id: 'occupation', type: 'short', label: 'Occupation', help: 'For example, Nursing Student.', required: true },
    { id: 'barcode', type: 'short', label: 'Barcode number', help: 'The full number on the back of your badge. Leave blank if you do not have your badge yet.', required: false },
    { id: 'badge_exp', type: 'date', label: 'Badge expiration date', help: '', required: false },
    { id: 'size', type: 'choice', label: 'Size', help: 'A unisex combination (shirt and pant).', required: true, options: SCRUB_SIZES },
    { id: 'machines', type: 'checkboxes', label: 'Scrub machine access', help: 'The scrub machines you need access to.', required: true, options: SCRUB_MACHINES },
  ],
})

// FORM-CONFIRMATION-1 (64a0030b): the student emailed their copy to Linen Services.
const SCRUBEX_V3 = Object.freeze({
  ...SCRUBEX_V2,
  description: 'Linen Services loads your scrub credits onto your badge. Read the scrubEx policy, then initial it. When you submit, download your copy and email it to Linen Services at grouplinenservices@cshs.org. Takes about 2 minutes.',
  confirmation: 'Next step: download your copy above and email it to Linen Services at grouplinenservices@cshs.org. Your scrub credits are loaded once they have it.',
})
// FORM-FORWARD-1: ASPIRE sends it for them.
const SCRUBEX_V4 = Object.freeze({
  ...SCRUBEX_V2,
  description: 'Linen Services loads your scrub credits onto your badge. Read the scrubEx policy, then initial it. When you submit, ASPIRE sends your form to Linen Services and copies you. Takes about 2 minutes.',
  confirmation: 'Linen Services loads your scrub credits once they process your form. Questions: grouplinenservices@cshs.org.',
})

export const STARTER_FORMS = Object.freeze([
  {
    // SCRUBEX-PAPER-1 (2026-09-24): the questions are Linen Services' own "Cedars-Sinai scrubEx
    // Policy" form, field for field, so the filed PDF is that form with the answers in its
    // boxes. Department Name is asked: their form's printed "Nursing Education" is whited out.
    // Students receive scrub credits only, so the Lavender Coats machines are not offered.
    slug: 'scrubex-request-form',
    title: 'ScrubEx Request Form',
    catalogDescription: 'Linen Services\' scrubEx policy and request: initials, badge, size and scrub machines.',
    category: 'student_onboarding',
    publish: true,
    // FORM-FORWARD-1 (2026-09-24, Owner): ASPIRE emails the filled form to Linen Services
    // itself, copying the student, so nobody forwards anything.
    definition: SCRUBEX_V4,
    settings: { forwardTo: 'grouplinenservices@cshs.org' },
  },
  {
    // PARKING-FORM-1 (2026-09-24): the questions are Parking Services' own "Students Parking
    // Data (SPD)" form, section by section and field by field, so the CSV is their list. The
    // labels ARE the CSV headers, which is why each vehicle field names its vehicle. Their
    // "Today's Date" is the CSV's Submitted column and the PDF's date; "Parking Office Use
    // Only" is theirs to fill and is not asked.
    slug: 'student-parking-request',
    title: 'Student Parking Request',
    catalogDescription: 'Parking Services\' Students Parking Data form. Answers export as their list.',
    category: 'student_onboarding',
    publish: true,
    definition: {
      title: 'Student Parking Request',
      description: 'Parking Services needs these details to set up your parking for your rotation. An approximate schedule is fine.',
      questions: [
        { id: 'requestor_h', type: 'section', label: 'Requestor information', help: '', required: false },
        { id: 'badge', type: 'short', label: 'Badge number', help: 'Leave blank if you do not have your Cedars-Sinai badge yet.', required: false },
        { id: 'first_name', type: 'short', label: 'First name', help: '', required: true, prefill: 'student.first_name' },
        { id: 'last_name', type: 'short', label: 'Last name', help: '', required: true, prefill: 'student.last_name' },
        { id: 'school', type: 'short', label: 'School name', help: '', required: true, prefill: 'student.school' },
        { id: 'phone', type: 'short', label: 'Telephone', help: '', required: true, prefill: 'student.phone' },
        { id: 'email', type: 'short', label: 'Email', help: '', required: true, prefill: 'student.email' },
        { id: 'building', type: 'short', label: 'Building', help: 'The building your unit is in, if you know it.', required: false },
        { id: 'department', type: 'short', label: 'Department', help: 'Your placement unit.', required: true, prefill: 'placement.unit' },
        { id: 'parking_app', type: 'choice', label: 'Parking App access', help: 'Your cellphone can be added to your parking profile for access to the Parking App. Instructions for the app come separately.', required: true, options: ['Yes', 'No'] },
        { id: 'schedule_h', type: 'section', label: 'Work schedule', help: 'An approximate time is acceptable.', required: false },
        { id: 'shift', type: 'choice', label: 'Shift', help: '', required: true, options: ['Days', 'Evenings', 'Nights'] },
        { id: 'status', type: 'choice', label: 'Status', help: '', required: true, options: ['Full-time (FT)', 'Part-time (PT)', 'Per diem (PD)'] },
        { id: 'start', type: 'date', label: 'Start date', help: '', required: true, prefill: 'placement.start_date' },
        { id: 'end', type: 'date', label: 'End date', help: '', required: true, prefill: 'placement.end_date' },
        { id: 'duration', type: 'short', label: 'Rotation duration', help: 'For example, 12 weeks.', required: true },
        { id: 'days', type: 'checkboxes', label: 'Days of the week', help: 'The days you expect to be on campus.', required: true, options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
        { id: 'vehicle1_h', type: 'section', label: 'Vehicle 1', help: 'The vehicle you will park on campus.', required: false },
        { id: 'v1_make', type: 'short', label: 'Vehicle 1 make and model', help: 'For example, Toyota Corolla.', required: true },
        { id: 'v1_color', type: 'short', label: 'Vehicle 1 color', help: '', required: true },
        { id: 'v1_state', type: 'short', label: 'Vehicle 1 state', help: 'The state on the license plate, for example CA.', required: true },
        { id: 'v1_plate', type: 'short', label: 'Vehicle 1 license plate', help: '', required: true },
        { id: 'vehicle2_h', type: 'section', label: 'Vehicle 2', help: 'Only if you may drive a second vehicle.', required: false },
        { id: 'v2_make', type: 'short', label: 'Vehicle 2 make and model', help: '', required: false },
        { id: 'v2_color', type: 'short', label: 'Vehicle 2 color', help: '', required: false },
        { id: 'v2_state', type: 'short', label: 'Vehicle 2 state', help: '', required: false },
        { id: 'v2_plate', type: 'short', label: 'Vehicle 2 license plate', help: '', required: false },
        { id: 'terms_h', type: 'section', label: 'Parking program agreement', help: 'Parking is a benefit offered to students on a voluntary basis. The Medical Center reserves the right to increase parking rates from time to time; you will be advised of any increase, and continuing to use parking after that notice means you consent to it.', required: false },
        { id: 'sig', type: 'signature', label: 'Signature', help: 'By signing, I confirm I have read, understand, and agree to comply with the Cedars-Sinai Medical Center Parking Program rules and regulations as outlined in the Parking Guide. The date is recorded when you submit.', required: true },
      ],
    },
  },
])

export const RETIRED_STARTER_DRAFTS = Object.freeze({
  // The ScrubEx draft shipped with FORMS-PHASE3 (the mockup's questions), before Linen Services' form.
  'scrubex-request-form': [{
    title: 'ScrubEx Request Form',
    description: 'Tell us your sizes so ScrubEx can load your badge before orientation. Takes about 2 minutes.',
    questions: [
      { id: 'full_name', type: 'short', label: 'Full name', help: '', required: true, prefill: 'student.full_name' },
      { id: 'unit', type: 'short', label: 'Placement unit', help: '', required: true, prefill: 'placement.unit' },
      { id: 'top', type: 'choice', label: 'Scrub top size', help: '', required: true, options: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
      { id: 'pant', type: 'choice', label: 'Scrub pant size', help: 'Pants run one size small.', required: true, options: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
      { id: 'sets', type: 'number', label: 'Sets needed', help: 'Up to 3 sets for the rotation.', required: true, min: 1, max: 3 },
      { id: 'pickup', type: 'date', label: 'Preferred pickup date', help: 'ScrubEx is open weekdays, 7 AM to 3 PM.', required: false },
      { id: 'sig', type: 'signature', label: 'Student signature', help: 'I will return all scrubs by my last shift.', required: true },
    ],
  }, SCRUBEX_V2, SCRUBEX_V3],
  // The draft shipped with FORMS-PHASE3 (1a4d25a1), before Parking Services sent their form.
  'student-parking-request': [{
    title: 'Student Parking Request',
    description: 'Parking Services needs these details to add your vehicle for your rotation dates.',
    questions: [
      { id: 'full_name', type: 'short', label: 'Full name', help: '', required: true, prefill: 'student.full_name' },
      { id: 'email', type: 'short', label: 'Email', help: '', required: true, prefill: 'student.email' },
      { id: 'phone', type: 'short', label: 'Mobile phone', help: '', required: false, prefill: 'student.phone' },
      { id: 'school', type: 'short', label: 'School', help: '', required: true, prefill: 'student.school' },
      { id: 'unit', type: 'short', label: 'Placement unit', help: '', required: true, prefill: 'placement.unit' },
      { id: 'start', type: 'date', label: 'Rotation start date', help: '', required: true, prefill: 'placement.start_date' },
      { id: 'end', type: 'date', label: 'Rotation end date', help: '', required: true, prefill: 'placement.end_date' },
      { id: 'vehicle_h', type: 'section', label: 'Your vehicle', help: 'The vehicle you will park on campus.', required: false },
      { id: 'make', type: 'short', label: 'Vehicle make', help: 'For example, Toyota.', required: true },
      { id: 'model', type: 'short', label: 'Vehicle model', help: 'For example, Corolla.', required: true },
      { id: 'color', type: 'short', label: 'Vehicle color', help: '', required: true },
      { id: 'plate', type: 'short', label: 'License plate', help: '', required: true },
      { id: 'plate_state', type: 'short', label: 'License plate state', help: 'For example, CA.', required: true },
    ],
  }],
})

// Two definitions say the same thing when their title, description and questions match,
// whatever order jsonb stored their keys in and whatever blank fields the builder added.
const stableOf = (v) => Array.isArray(v) ? v.map(stableOf)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined && v[k] !== null && v[k] !== '').map(k => [k, stableOf(v[k])])) : v
const shapeOf = (d) => stableOf({ title: String(d?.title || '').trim(), description: String(d?.description || ''), confirmation: String(d?.confirmation || ''),
  questions: (d?.questions || []).map(q => ({ ...q, required: q.required === true })) })
export const sameDefinition = (a, b) => JSON.stringify(shapeOf(a)) === JSON.stringify(shapeOf(b))

/**
 * STARTER-RESET-1 (2026-09-24): the starter a form came from, when the starter has changed
 * since this draft was made. The builder offers it; nothing replaces a draft without a click.
 */
export function starterUpdateFor(form) {
  const s = STARTER_FORMS.find(x => x.slug === form?.starter_key)
  if (!s || !form?.draft || form.status === 'archived') return null
  return sameDefinition(form.draft, s.definition) ? null : s
}

// ── The thank-you message (FORM-CONFIRMATION-1) ─────────────────────────────────────
// What a form tells people once they submit ("email your copy to ..."). Plain text; the
// page makes each email address in it a link, so this splits it into text and addresses.
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
export function confirmationParts(text) {
  const out = []
  let at = 0
  for (const m of String(text || '').matchAll(EMAIL_IN_TEXT)) {
    const email = m[0].replace(/\.+$/, '')
    if (m.index > at) out.push({ text: text.slice(at, m.index) })
    out.push({ email })
    at = m.index + email.length
  }
  if (at < String(text || '').length) out.push({ text: text.slice(at) })
  return out
}

// ── The Sheet (FORM-SHEET-1) ────────────────────────────────────────────────────────
// Responses > Sheet: one row per submission, one column per question, like a spreadsheet.
// Columns follow the LATEST version's questions; a question that only earlier versions asked
// keeps its column, marked earlier, for the people who answered it, so nothing disappears.
// Every cell is the answer as text, read against the version that person answered.

const SHEET_SKIP = new Set(['section', 'signature'])

/**
 * versions: [{ version, definition }]; rows: [{ id, name, email, school, submittedAt, version, answers }].
 * Returns { columns: [{ key, label, type, options?, earlier? }], rows: [{ ...row, cells: { key: text } }] }.
 */
export function sheetFor(versions, rows) {
  const ordered = [...(versions || [])].sort((a, b) => b.version - a.version)
  const latest = ordered[0]?.definition?.questions || []
  const columns = []
  const seen = new Set()
  const add = (q, earlier) => {
    if (seen.has(q.id) || SHEET_SKIP.has(q.type) || !takesAnswer(q)) return
    seen.add(q.id)
    columns.push({ key: q.id, label: q.label, type: q.type, ...(q.options ? { options: [...q.options, ...(q.allowOther ? ['Other'] : [])] } : {}), ...(earlier ? { earlier: true } : {}) })
  }
  for (const q of latest) add(q, false)
  const answered = new Set(rows.flatMap(r => Object.keys(r.answers || {})))
  for (const v of ordered.slice(1)) for (const q of v.definition?.questions || []) if (answered.has(q.id)) add(q, true)
  const byVersion = new Map(ordered.map(v => [v.version, new Map((v.definition?.questions || []).map(q => [q.id, q]))]))
  return {
    columns,
    rows: rows.map(r => {
      const qs = byVersion.get(r.version) || new Map()
      const cells = {}
      for (const c of columns) {
        const q = qs.get(c.key)
        cells[c.key] = q ? answerText(q, r.answers?.[c.key]) : ''
      }
      return { id: r.id, name: r.name, email: r.email, school: r.school || '', submittedAt: r.submittedAt, version: r.version, cells }
    }),
  }
}

/** Does a Sheet cell match a filter value? A choice matches its option; "Other" matches any Other answer. */
export function cellMatches(column, cell, value) {
  if (!value) return true
  const text = String(cell || '')
  if (column?.options) {
    const parts = column.type === 'checkboxes' ? text.split('; ') : [text]
    return value === 'Other' ? parts.some(isOtherValue) : parts.includes(value)
  }
  return text.toLowerCase().includes(String(value).toLowerCase())
}
