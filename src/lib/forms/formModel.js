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
export const takesAnswer = (q) => !!q && !questionType(q.type)?.noAnswer

// ── Prefill: answers ASPIRE already has (brief: "Prefill from") ─────────────────────
// Each source names what it reads; the server resolves it for the one respondent the
// link belongs to, and the respondent can still correct it before submitting.

export const PREFILL_SOURCES = Object.freeze([
  { key: 'student.full_name', label: 'Student record · Legal name', group: 'Student record' },
  { key: 'student.preferred_name', label: 'Student record · Preferred name', group: 'Student record' },
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
export function answerIssues(def, answers = {}) {
  const out = {}
  for (const q of def?.questions || []) {
    if (!takesAnswer(q)) continue
    const v = answers[q.id]
    if (isBlank(v)) { if (q.required) out[q.id] = 'This question needs an answer.'; continue }
    switch (q.type) {
      case 'short': if (String(v).length > 500) out[q.id] = 'Keep this under 500 characters.'; break
      case 'paragraph': if (String(v).length > 5000) out[q.id] = 'Keep this under 5,000 characters.'; break
      case 'choice': case 'dropdown': if (!(q.options || []).includes(v)) out[q.id] = 'Choose one of the options.'; break
      case 'checkboxes': if (!Array.isArray(v) || v.some(x => !(q.options || []).includes(x))) out[q.id] = 'Choose from the options.'; break
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
    if (q.type === 'checkboxes') out[q.id] = (Array.isArray(v) ? v : [v]).map(String)
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

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
export const STARTER_FORMS = Object.freeze([
  {
    slug: 'scrubex-request-form',
    title: 'ScrubEx Request Form',
    catalogDescription: 'Scrub sizes and pickup date for badge-linked ScrubEx access.',
    category: 'student_onboarding',
    publish: true,
    definition: {
      title: 'ScrubEx Request Form',
      description: 'Tell us your sizes so ScrubEx can load your badge before orientation. Takes about 2 minutes.',
      questions: [
        { id: 'full_name', type: 'short', label: 'Full name', help: '', required: true, prefill: 'student.full_name' },
        { id: 'unit', type: 'short', label: 'Placement unit', help: '', required: true, prefill: 'placement.unit' },
        { id: 'top', type: 'choice', label: 'Scrub top size', help: '', required: true, options: SIZES },
        { id: 'pant', type: 'choice', label: 'Scrub pant size', help: 'Pants run one size small.', required: true, options: SIZES },
        { id: 'sets', type: 'number', label: 'Sets needed', help: 'Up to 3 sets for the rotation.', required: true, min: 1, max: 3 },
        { id: 'pickup', type: 'date', label: 'Preferred pickup date', help: 'ScrubEx is open weekdays, 7 AM to 3 PM.', required: false },
        { id: 'sig', type: 'signature', label: 'Student signature', help: 'I will return all scrubs by my last shift.', required: true },
      ],
    },
  },
  {
    // The Owner has not supplied the Parking Services column list yet (2026-09-24), so this
    // ships as a DRAFT with the columns a parking permit list usually needs; publish it once
    // the columns match what Parking Services asks for.
    slug: 'student-parking-request',
    title: 'Student Parking Request',
    catalogDescription: 'Replaces the Students Parking Data spreadsheet. Answers build the list for Parking Services.',
    category: 'student_onboarding',
    publish: false,
    definition: {
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
    },
  },
])
