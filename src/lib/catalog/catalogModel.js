// src/lib/catalog/catalogModel.js
//
// CATALOG-REVAMP-1 (Phase 1, 2026-09-23). The ASPIRE Catalog's rules, in one pure module:
// what an item is, how the left list counts, how search, sort and the Pinned section work,
// who a Send goes to by default, and how a recipient token becomes people. The page
// renders these answers and computes nothing in JSX; the server imports the personal-file
// matcher. No React, no I/O, so node --test reads it directly.
//
// Both styles (Classic bookcase, Modern list) read the same answers. A style switch
// changes the drawing, never a count, an order or a recipient.

import { getStudentPreferredFirstName, getStudentPreferredFullName } from '../studentNameFormatters.js'

// ── Vocabulary ──────────────────────────────────────────────────────────────────

// One audience per item, stored as a one-element text[] (catalog_resources.audience).
export const AUDIENCES = Object.freeze([
  { key: 'everyone',   label: 'Everyone' },
  { key: 'students',   label: 'Students' },
  { key: 'preceptors', label: 'Preceptors' },
  { key: 'schools',    label: 'Schools' },
  { key: 'staff',      label: 'Staff only' },
])
const AUDIENCE_KEYS = new Set(AUDIENCES.map(a => a.key))
export const audienceOf = (row) => {
  const v = Array.isArray(row?.audience) ? row.audience[0] : null
  return AUDIENCE_KEYS.has(v) ? v : 'everyone'
}
export const audienceLabel = (key) => AUDIENCES.find(a => a.key === key)?.label || 'Everyone'

// Item kinds. Phase 1 stores 'file' only; forms arrive in Phase 2 and signature documents
// in Phase 3 behind catalog.signatures. A row from before the migration has no kind.
export const KINDS = Object.freeze({ file: 'file', form: 'form', signature: 'signature' })
export const kindOf = (row) => (row?.kind === 'form' || row?.kind === 'signature') ? row.kind : 'file'

export const KIND_LABEL = Object.freeze({ file: 'File', form: 'Form', signature: 'Signature template' })

// Phase gates. Signature templates are Phase 2 and forms Phase 3 (Owner, 2026-09-23: the
// order is intentional). These are the BUILD defaults; signatures are then admitted per
// caller by the server's catalog.signatures flag (useSignaturesFlag), OFF by default until
// Legal and IT approve in-app e-signature. An entry point for an unbuilt or unadmitted
// kind is not shown: a control that does nothing is a broken promise.
export const CATALOG_FEATURES = Object.freeze({ forms: false, signatures: false })

// The badge a file shows: the stored label for an uploaded file, LINK for an external one.
// tone picks the badge's ink (red PDF, navy Word, green Excel), never its meaning.
export function fileBadge(row) {
  if (row?.resource_type === 'external_link') return { label: 'LINK', tone: 'link' }
  const l = String(row?.file_type_label || '').toUpperCase()
  if (l === 'PDF') return { label: 'PDF', tone: 'pdf' }
  if (l === 'DOC' || l === 'DOCX') return { label: 'DOCX', tone: 'doc' }
  if (l === 'XLS' || l === 'XLSX') return { label: 'XLSX', tone: 'xls' }
  if (l === 'PPT' || l === 'PPTX') return { label: 'PPTX', tone: 'ppt' }
  if (l === 'IMG') return { label: 'IMG', tone: 'img' }
  return { label: l || 'FILE', tone: 'file' }
}

// ── Dates and sizes ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "Sep 18". A different year adds it: "Sep 18, 2025".
export function fmtShortDate(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── Completion (forms and signature documents) ──────────────────────────────────
//
// A completion request is one person's copy of a form or signature request. Overdue is
// computed, never stored: past due and not done. Phase 1 has no requests, so every file
// reads as having none and every count below is honestly zero.

export const COMPLETION_STATUSES = Object.freeze(['done', 'overdue', 'opened', 'not_opened'])

export function completionStatus(req, now = Date.now()) {
  if (req?.completed_at || req?.status === 'done') return 'done'
  const due = req?.due_at ? new Date(req.due_at).getTime() : NaN
  if (Number.isFinite(due) && due < now) return 'overdue'
  if (req?.opened_at || req?.status === 'opened') return 'opened'
  return 'not_opened'
}

export function completionStats(requests = [], now = Date.now()) {
  const s = { total: 0, done: 0, overdue: 0, opened: 0, not_opened: 0 }
  for (const r of requests) { s.total++; s[completionStatus(r, now)]++ }
  return s
}

// "19 signed, 2 overdue, 2 opened, 1 not opened": the progress bar's text label.
export function progressLabel(kind, s) {
  const doneWord = kind === 'signature' ? 'signed' : 'done'
  return `${s.done} ${doneWord}, ${s.overdue} overdue, ${s.opened} opened, ${s.not_opened} not opened`
}

const hasTracker = (row) => kindOf(row) !== 'file'
const isOut = (row, stats) => hasTracker(row) && stats && stats.total > 0 && stats.done < stats.total

// ── Header summary and left list counts ─────────────────────────────────────────

// items: every ACTIVE item. statsById: { [id]: completionStats } (empty in Phase 1).
export function catalogSummary(items, statsById = {}) {
  let out = 0, overduePeople = 0
  for (const r of items) {
    const s = statsById[r.id]
    if (isOut(r, s)) out++
    if (hasTracker(r) && s) overduePeople += s.overdue
  }
  return { items: items.length, out, overduePeople }
}

export function railCounts(items, statsById = {}, categories = []) {
  const byKind = { all: items.length, file: 0, form: 0, signature: 0 }
  for (const r of items) byKind[kindOf(r)]++
  const summary = catalogSummary(items, statsById)
  const byCategory = {}
  for (const c of categories) byCategory[c.key] = 0
  for (const r of items) byCategory[r.category] = (byCategory[r.category] || 0) + 1
  return { byKind, out: summary.out, overduePeople: summary.overduePeople, byCategory }
}

// ── The list: filter, sort, sections ────────────────────────────────────────────

// view: { type: 'all'|'file'|'form'|'signature', category: slug|null, track: 'out'|'overdue'|null }
export function filterItems(rows, { view = {}, q = '', showRemoved = false, catLabel = s => s, statsById = {} } = {}) {
  const query = String(q || '').trim().toLowerCase()
  return rows.filter(r => {
    if (!showRemoved && r.is_active === false) return false
    if (view.type && view.type !== 'all' && kindOf(r) !== view.type) return false
    if (view.category && r.category !== view.category) return false
    if (view.track === 'out' && !isOut(r, statsById[r.id])) return false
    if (view.track === 'overdue' && !(hasTracker(r) && (statsById[r.id]?.overdue || 0) > 0)) return false
    if (!query) return true
    return [r.title, r.description, catLabel(r.category)].filter(Boolean).join(' ').toLowerCase().includes(query)
  })
}

export const SORTS = Object.freeze([
  { key: 'recent', label: 'Recently updated' },
  { key: 'used',   label: 'Most used' },
  { key: 'az',     label: 'A to Z' },
])

// usage: { [id]: number of sends } from the send log; a form's reach counts too.
export function sortItems(rows, sort = 'recent', usage = {}) {
  const arr = [...rows]
  const title = (r) => String(r.title || '')
  if (sort === 'az') arr.sort((a, b) => title(a).localeCompare(title(b)))
  else if (sort === 'used') arr.sort((a, b) => ((usage[b.id] || 0) - (usage[a.id] || 0)) || title(a).localeCompare(title(b)))
  else arr.sort((a, b) => (new Date(b.updated_at || 0) - new Date(a.updated_at || 0)) || title(a).localeCompare(title(b)))
  return arr
}

// With no filter on, Pinned comes first and the rest is Everything else. Any filter or a
// search turns the list into one plain section, because "Pinned" inside a search result
// is a second ordering the reader did not ask for.
export function isUnfiltered(view = {}, q = '') {
  return (!view.type || view.type === 'all') && !view.category && !view.track && !String(q || '').trim()
}

export function listSections(rows, { view = {}, q = '' } = {}) {
  if (!isUnfiltered(view, q)) return [{ key: 'all', label: null, rows }]
  const pinned = rows.filter(r => r.is_pinned)
  if (!pinned.length) return [{ key: 'all', label: null, rows }]
  return [
    { key: 'pinned', label: 'Pinned', rows: pinned },
    { key: 'rest', label: 'Everything else', rows: rows.filter(r => !r.is_pinned) },
  ]
}

// The bookcase stands pinned covers first on the top shelf, in the list's own order.
export const shelfOrder = (rows) => [...rows.filter(r => r.is_pinned), ...rows.filter(r => !r.is_pinned)]

// Empty shelves below the covers, as in iBooks: at least three shelves are always drawn.
export function shelfRows(count, perShelf) {
  const per = Math.max(1, perShelf || 1)
  return Math.max(3, Math.ceil(count / per))
}

export function viewTitle(view = {}, catLabel = s => s) {
  if (view.category) return catLabel(view.category)
  if (view.track === 'out') return 'Out for completion'
  if (view.track === 'overdue') return 'Items with overdue people'
  return { all: 'All items', file: 'Files', form: 'Forms', signature: 'Signature templates' }[view.type || 'all']
}

// ── Send ────────────────────────────────────────────────────────────────────────

export const SEND_AS = Object.freeze({
  file: { title: 'Attachment', line: 'The file travels with the email. Recipients open it without signing in.' },
  link: { title: 'Link', line: 'The link is added to the end of the message.' },
  form: { title: 'Fillable form link', line: 'Each person gets a personal link. Answers they already gave ASPIRE are filled in.' },
  signature: { title: 'Signature request', line: 'Signers go in order, and you are notified when all sign.' },
})
export const sendAsFor = (row) => (row?.resource_type === 'external_link' ? SEND_AS.link : SEND_AS[kindOf(row)])

// A cover holds about four lines of title at its normal size. A title longer than this is
// set a step smaller (Classic covers), so it is read whole rather than cut off.
export const COVER_LONG_TITLE = 44
export const isLongCoverTitle = (title) => String(title || '').trim().length > COVER_LONG_TITLE

export const sendButtonLabel = (row) => ({ file: 'Send', form: 'Send form', signature: 'Send for signature' }[kindOf(row)])

// The message a Send opens with. {first name} is Outreach's own merge field, so the
// server fills it per recipient. The sender's name is the signature Outreach appends.
export function defaultMessage(row, { dueLabel = '' } = {}) {
  const t = row?.title || 'this resource'
  const by = dueLabel ? ` by ${dueLabel}` : ''
  if (kindOf(row) === 'signature') return `Hi {first name},\n\nPlease review and sign the ${t}${by}. It takes about 2 minutes. Reply to this email if anything is unclear.\n\nThank you.`
  if (kindOf(row) === 'form') return `Hi {first name},\n\nPlease complete the ${t}${by}. The answers ASPIRE already has are filled in for you.\n\nThank you.`
  if (row?.resource_type === 'external_link') return `Hi {first name},\n\nHere is the ${t} for your reference.\n\nThank you.`
  return `Hi {first name},\n\nI've attached the ${t} for your reference.\n\nThank you.`
}

export const defaultSubject = (row) => String(row?.title || 'ASPIRE resource').slice(0, 200)

// The modal writes {first name}; Outreach's server merges [First Name] (src/lib/recipientParse.js)
// and always has a fallback, so a sent email never shows a raw token.
export const toOutreachMerge = (text) => String(text || '').replace(/\{\s*first\s+name\s*\}/gi, '[First Name]')

// A link item travels as a line at the end of the message, not as an attachment.
export function messageForSend(row, text) {
  const body = toOutreachMerge(text).trim()
  if (row?.resource_type === 'external_link' && row.external_url && !body.includes(row.external_url)) {
    return `${body}\n\n${row.external_url}`
  }
  return body
}

// ── Recipients ──────────────────────────────────────────────────────────────────
//
// A token is what the sender picked ("Fall 2026 cohort (24)"). expandTokens turns tokens
// into the exact people list Outreach sends to. The Outreach server never expands an
// audience (BULK-EXACT-RECIPIENTS-1): it only verifies the list it is handed, so the list
// is built here and shown in the modal before it is sent.

export const NOT_PROCEEDING = 'Not Proceeding'
export const PARTNER_CATEGORY = 'Academic Partner'
export const PRECEPTOR_CATEGORY = 'Preceptor'
export const STAFF_CATEGORY = 'BNI Team'

const studentEmail = (s) => {
  const school = String(s?.school_email || '').trim()
  if (school) return { email: school, emailType: 'school' }
  const personal = String(s?.personal_email || '').trim()
  if (personal) return { email: personal, emailType: 'personal' }
  return null
}
// Students a group token reaches: not Not Proceeding, and holding an email.
const reachableStudent = (s) => s && s.status !== NOT_PROCEEDING && !!studentEmail(s)
const reachableContact = (c) => c && c.is_active !== false && !!String(c.email || '').trim()

const contactCategory = (c) => {
  const v = String(c?.category || '').trim()
  return { 'Academic Partners': 'Academic Partner', 'Preceptors': 'Preceptor', 'Unit Leadership': 'Unit Leader' }[v] || v
}

export function studentRecipient(s) {
  const e = studentEmail(s)
  if (!e) return null
  return {
    source: 'student', studentId: s.id, email: e.email, emailType: e.emailType,
    name: getStudentPreferredFullName(s), firstName: getStudentPreferredFirstName(s),
    school: s.school || '',
  }
}

export function contactRecipient(c) {
  if (!reachableContact(c)) return null
  const first = String(c.preferred_name || '').trim() || String(c.full_name || '').trim().split(/\s+/)[0] || ''
  return {
    source: 'contact', contactId: c.id, email: String(c.email).trim(),
    name: String(c.full_name || '').trim(), firstName: first, school: c.school_name || '',
  }
}

// ctx: { students, units, matches, contacts, cohortName }
function studentsOnUnit(ctx, unitId) {
  const ids = new Set((ctx.matches || []).filter(m => m.unit_id === unitId).map(m => m.student_id))
  return (ctx.students || []).filter(s => ids.has(s.id) || s.unit_id === unitId)
}

export function tokenPeople(token, ctx) {
  const students = ctx.students || []
  const contacts = ctx.contacts || []
  switch (token?.type) {
    case 'cohort':   return students.filter(reachableStudent).map(studentRecipient)
    case 'unit':     return studentsOnUnit(ctx, token.unitId).filter(reachableStudent).map(studentRecipient)
    case 'student':  { const s = students.find(x => x.id === token.id); return s && studentEmail(s) ? [studentRecipient(s)] : [] }
    case 'contact':  { const c = contacts.find(x => x.id === token.id); return reachableContact(c) ? [contactRecipient(c)] : [] }
    case 'partners': return contacts.filter(c => reachableContact(c) && contactCategory(c) === PARTNER_CATEGORY).map(contactRecipient)
    case 'school':   return contacts.filter(c => reachableContact(c) && contactCategory(c) === PARTNER_CATEGORY && c.school_name === token.school).map(contactRecipient)
    case 'category': return contacts.filter(c => reachableContact(c) && contactCategory(c) === token.category).map(contactRecipient)
    default:         return []
  }
}

// Every token's people, deduplicated by email (first occurrence wins, the same rule the
// Outreach server applies), in token order.
export function expandTokens(tokens, ctx) {
  const seen = new Set()
  const out = []
  for (const t of tokens || []) {
    for (const p of tokenPeople(t, ctx)) {
      const k = p.email.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  }
  return out
}

const withCount = (token, ctx) => ({ ...token, count: tokenPeople(token, ctx).length })

// The suggestions under the To field, from the item's audience. A suggestion that would
// reach no one is not offered.
export function suggestTokens(row, ctx) {
  const aud = audienceOf(row)
  const cohort = ctx.cohortName ? `${ctx.cohortName} cohort` : 'Current cohort'
  const out = []
  if (aud === 'schools') {
    const schools = [...new Set((ctx.contacts || [])
      .filter(c => reachableContact(c) && contactCategory(c) === PARTNER_CATEGORY && c.school_name)
      .map(c => c.school_name))].sort((a, b) => a.localeCompare(b))
    out.push(withCount({ type: 'partners', key: 'partners', label: `All ${schools.length} partner schools` }, ctx))
    for (const s of schools.slice(0, 4)) out.push(withCount({ type: 'school', key: `school:${s}`, school: s, label: s }, ctx))
  } else if (aud === 'preceptors') {
    out.push(withCount({ type: 'category', key: 'cat:Preceptor', category: PRECEPTOR_CATEGORY, label: 'All preceptors' }, ctx))
  } else if (aud === 'staff') {
    out.push(withCount({ type: 'category', key: `cat:${STAFF_CATEGORY}`, category: STAFF_CATEGORY, label: 'BNI Team' }, ctx))
  } else {
    out.push(withCount({ type: 'cohort', key: 'cohort', label: cohort }, ctx))
    const units = (ctx.units || [])
      .map(u => ({ u, n: studentsOnUnit(ctx, u.id).filter(reachableStudent).length }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n || String(a.u.unit_name).localeCompare(String(b.u.unit_name)))
      .slice(0, 3)
    for (const { u } of units) out.push(withCount({ type: 'unit', key: `unit:${u.id}`, unitId: u.id, label: `${u.unit_name} students` }, ctx))
    if (aud === 'everyone') {
      const partners = withCount({ type: 'partners', key: 'partners', label: 'All partner schools' }, ctx)
      out.push(partners)
    }
  }
  return out.filter(t => t.count > 0)
}

// Default recipients: all partner schools for a school item, the current cohort otherwise.
// ("Not yet completed" joins in Phase 2, when a form can be partly done.)
export function defaultTokens(row, ctx) {
  const sugg = suggestTokens(row, ctx)
  return sugg.length ? [sugg[0]] : []
}

// Free-text search in the To field: students and contacts whose name or email matches.
export function searchPeople(q, ctx, limit = 8) {
  const query = String(q || '').trim().toLowerCase()
  if (query.length < 2) return []
  const hits = []
  for (const s of ctx.students || []) {
    if (!studentEmail(s)) continue
    const name = getStudentPreferredFullName(s)
    if (`${name} ${s.first_name || ''} ${s.last_name || ''} ${s.school_email || ''}`.toLowerCase().includes(query)) {
      hits.push({ type: 'student', key: `student:${s.id}`, id: s.id, label: name, sub: s.school || 'Student', count: 1 })
    }
  }
  for (const c of ctx.contacts || []) {
    if (!reachableContact(c)) continue
    if (`${c.full_name || ''} ${c.email || ''}`.toLowerCase().includes(query)) {
      hits.push({ type: 'contact', key: `contact:${c.id}`, id: c.id, label: c.full_name || c.email, sub: contactCategory(c) || 'Contact', count: 1 })
    }
  }
  return hits.slice(0, limit)
}

// Outreach accepts at most 75 recipients per request; a larger send goes as several
// batches, each its own logged send.
export const OUTREACH_BATCH_MAX = 75
export function chunkRecipients(list, size = OUTREACH_BATCH_MAX) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── Personal files ──────────────────────────────────────────────────────────────
//
// The Catalog holds shared resources only. A file whose name carries a student's first
// and last name (Schedule_Witkin_Reena) is probably one person's. This only SUGGESTS: a
// staff member confirms every move, and nothing moves on a match alone.

const nameTokens = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(t => t.length >= 2)

export function personalFileMatches(row, students) {
  const tokens = new Set([...nameTokens(row?.title), ...nameTokens(row?.storage_path?.split('/').pop())])
  if (!tokens.size) return []
  const hits = []
  for (const s of students || []) {
    const last = nameTokens(s.last_name)
    const firsts = [...nameTokens(s.first_name), ...nameTokens(s.preferred_first_name)]
    if (!last.length || !firsts.length) continue
    if (last.every(t => tokens.has(t)) && firsts.some(t => tokens.has(t))) hits.push(s)
  }
  return hits
}
