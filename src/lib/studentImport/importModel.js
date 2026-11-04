// src/lib/studentImport/importModel.js
//
// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): the rules of Keith's spreadsheet import, pure so
// the server, the popup and the tests read one copy.
//
//   1. profileColumns: what Keith is shown about each column. The header, how full it is, and
//      either its category values (a short list, never from a personal column) or a few MASKED
//      samples. Never a whole row, never the SSN column, never a name, email or phone in the clear.
//   2. Keith answers with a mapping (column -> field, with confidence) and value maps for the
//      category fields (school, program type, cohort, units...). sanitizeMapping keeps only fields
//      and values this module knows; anything else is dropped, not trusted.
//   3. questionsFor: what the popup asks before anything is written: a column Keith is not sure
//      of, two columns claiming one field, a category value with no match.
//   4. rowValues + planRows: the APP applies the confirmed mapping to every row and decides, per
//      row, create / update / skip or a question, against the students already in the app. No
//      model reads the rows themselves.

import { SCHOOLS, PROGRAM_TYPES, SHIFT_OPTIONS, ASPIRE_STATUSES } from '../constants.js'
import { UNIT_CATALOG } from '../unitCatalog.js'
import { WEEKDAYS } from '../availability.js'
import { normalizeEmailForLookup } from '../emailUtils.js'

export const IMPORT_TARGETS = Object.freeze(['internship', 'residency'])
export const MAX_FILE_BYTES = 3 * 1024 * 1024
export const CS_AFFILIATIONS = Object.freeze(['Current Employee', 'Former Employee', 'Volunteer', 'No prior affiliation'])
export const GENDERS = Object.freeze(['Male', 'Female', 'Non-binary', 'Prefer not to say', 'Other'])
export const UNIT_NAMES = Object.freeze(UNIT_CATALOG.map(u => u.name))

// kind: name | text | email | phone | date | ssn4 | gpa | choice | list
// `choices` is the closed vocabulary a category field's values are mapped into.
export const IMPORT_FIELDS = Object.freeze([
  { key: 'full_name', label: 'Full name', kind: 'name' },
  { key: 'first_name', label: 'First name', kind: 'text' },
  { key: 'last_name', label: 'Last name', kind: 'text' },
  { key: 'preferred_first_name', label: 'Preferred first name', kind: 'text' },
  { key: 'personal_email', label: 'Personal email', kind: 'email' },
  { key: 'school_email', label: 'School email', kind: 'email' },
  { key: 'phone', label: 'Phone', kind: 'phone' },
  { key: 'date_of_birth', label: 'Date of birth', kind: 'date' },
  { key: 'ssn_last4', label: 'SSN last 4', kind: 'ssn4' },
  { key: 'gender', label: 'Gender', kind: 'choice', choices: GENDERS },
  { key: 'school', label: 'School', kind: 'choice', choices: SCHOOLS },
  { key: 'program_type', label: 'Program type', kind: 'choice', choices: PROGRAM_TYPES },
  { key: 'estimated_graduation_date', label: 'Expected graduation date', kind: 'date' },
  { key: 'cumulative_gpa', label: 'GPA', kind: 'gpa' },
  { key: 'cs_affiliation', label: 'Cedars-Sinai affiliation', kind: 'choice', choices: CS_AFFILIATIONS },
  { key: 'cs_department', label: 'Cedars-Sinai unit or department', kind: 'text' },
  { key: 'cs_role', label: 'Cedars-Sinai role', kind: 'text' },
  { key: 'unit_preferences', label: 'Unit preferences (in order)', kind: 'list', choices: UNIT_NAMES },
  { key: 'interest_statement', label: 'Interest statement', kind: 'text', joins: true },
  { key: 'prior_healthcare_experience', label: 'Prior healthcare experience', kind: 'text', joins: true },
  { key: 'shift_availability', label: 'Shift preference', kind: 'choice', choices: SHIFT_OPTIONS },
  { key: 'preferred_days', label: 'Days available', kind: 'list', choices: WEEKDAYS },
  { key: 'aspire_cohort', label: 'ASPIRE cohort', kind: 'choice', choices: null },
  { key: 'status', label: 'ASPIRE status', kind: 'choice', choices: ASPIRE_STATUSES },
])
export const FIELD_BY_KEY = Object.freeze(Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, f])))
export const IGNORE = 'ignore'

// A column whose header says it holds a person's details or someone's notes is never sent as
// values: only masked samples. The SSN column is never sampled at all.
const PERSONAL_HEADER = /name|e-?mail|phone|mobile|cell|social|ssn|security|birth|dob|address|signature|note|comment|why|describe|explain|statement|tell us|preceptor(?!ships?)/i
const SSN_HEADER = /social|ssn|security number/i
const PERSONAL_VALUE = /@|\d{5,}|\d{3}[-. )]\d{3}/
const MAX_CATEGORY_VALUES = 40
const MAX_LIST_ITEMS = 80
const SAMPLES = 3

const str = (v, max = 4000) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** A value's shape with the person taken out: letters to a, digits to 9, an email keeps its domain. */
export function maskValue(v) {
  const s = str(v, 200)
  if (!s) return ''
  const email = /^[^@\s]+@([^@\s]+)$/.exec(s)
  if (email) return `***@${email[1].toLowerCase()}`
  return s.replace(/\p{L}+/gu, 'a').replace(/\d/g, '9').slice(0, 40)
}

/** Split a multi-choice cell (Microsoft Forms joins choices with ";"). */
export function splitList(v, separator = ';') {
  const sep = separator === ',' ? ',' : ';'
  return String(v ?? '').split(sep).map(x => str(x, 200)).filter(Boolean)
}

/**
 * What Keith is told about one sheet. Returns [{ index, header, filled, distinct, values?, items?,
 * samples? }]. `values` (a category's whole vocabulary) or `items` (a multi-choice column's
 * choices) only for a column that is not personal and holds no email or phone-shaped value.
 */
export function profileColumns(headers, rows) {
  return headers.map((header, index) => {
    const vals = rows.map(r => str(r[index], 2000)).filter(Boolean)
    const distinct = [...new Set(vals)]
    const col = { index, header: str(header, 160), filled: vals.length, distinct: distinct.length }
    if (SSN_HEADER.test(header)) return { ...col, withheld: true }
    const personal = PERSONAL_HEADER.test(header) || distinct.some(v => PERSONAL_VALUE.test(v))
    // A multi-choice column (cells join choices with ";") is described by its choices.
    if (!personal && distinct.some(v => v.includes(';'))) {
      const items = [...new Set(vals.flatMap(v => splitList(v, ';')))]
      if (items.length <= MAX_LIST_ITEMS && items.every(v => v.length <= 140 && !PERSONAL_VALUE.test(v))) return { ...col, items: items.sort() }
    }
    if (!personal && distinct.length && distinct.length <= MAX_CATEGORY_VALUES && distinct.every(v => v.length <= 120)) {
      return { ...col, values: distinct.slice().sort() }
    }
    return { ...col, samples: distinct.slice(0, SAMPLES).map(maskValue) }
  })
}

const CONFIDENCES = new Set(['high', 'medium', 'low'])

/**
 * Keep only what this module can act on. `cohortNames` is the cohort vocabulary for aspire_cohort.
 * Returns { columns: [{ index, field, confidence, note }], values: { field: { from: to|null } },
 * nameFormat, separator, status, summary }.
 */
export function sanitizeMapping(raw, headers, { cohortNames = [] } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const byIndex = new Map()
  for (const c of Array.isArray(r.columns) ? r.columns : []) {
    const index = Number(c?.index)
    if (!Number.isInteger(index) || index < 0 || index >= headers.length || byIndex.has(index)) continue
    const field = FIELD_BY_KEY[c?.field] ? c.field : IGNORE
    byIndex.set(index, {
      index, field,
      confidence: CONFIDENCES.has(c?.confidence) ? c.confidence : 'low',
      note: str(c?.note, 240) || null,
    })
  }
  const columns = headers.map((_, index) => byIndex.get(index) || { index, field: IGNORE, confidence: 'low', note: null })
  for (const c of columns) if (SSN_HEADER.test(headers[c.index]) && c.field !== IGNORE && c.field !== 'ssn_last4') c.field = IGNORE

  const values = {}
  const rv = r.values && typeof r.values === 'object' ? r.values : {}
  for (const f of IMPORT_FIELDS) {
    if (f.kind !== 'choice' && f.kind !== 'list') continue
    const vocab = choicesFor(f.key, cohortNames)
    // Keith answers with [{ from, to }]; the popup echoes the sanitized { from: to } map back.
    const given = rv[f.key]
    const list = Array.isArray(given) ? given
      : given && typeof given === 'object' ? Object.entries(given).map(([from, to]) => ({ from, to })) : []
    const map = {}
    for (const m of list) {
      const from = str(m?.from, 200)
      if (!from) continue
      const to = vocab.find(x => x === m?.to) || null
      map[from] = to
    }
    if (Object.keys(map).length) values[f.key] = map
  }
  const status = ASPIRE_STATUSES.includes(r.status) ? r.status : null
  return {
    columns, values,
    nameFormat: ['last_first', 'first_last'].includes(r.name_format ?? r.nameFormat) ? (r.name_format ?? r.nameFormat) : null,
    separator: (r.list_separator ?? r.separator) === ',' ? ',' : ';',
    status,
    summary: str(r.summary, 600) || null,
  }
}

export function choicesFor(field, cohortNames = []) {
  if (field === 'aspire_cohort') return cohortNames.map(n => str(n, 80)).filter(Boolean)
  return FIELD_BY_KEY[field]?.choices || []
}

const fold = s => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '')

/** A value the app can map without Keith: the same word, case and spacing aside. */
export function exactChoice(value, vocab) {
  const k = fold(value)
  if (!k) return null
  return vocab.find(x => fold(x) === k) || null
}

/** Every distinct value a category column holds (a list column's items), for the value questions. */
export function columnVocabulary(rows, index, field, separator) {
  const kind = FIELD_BY_KEY[field]?.kind
  const vals = rows.map(r => r[index]).filter(Boolean)
  const out = kind === 'list' ? vals.flatMap(v => splitList(v, separator)) : vals.map(v => str(v, 200))
  return [...new Set(out)].filter(Boolean)
}

/**
 * What must be answered before the rows are planned.
 *   column:  Keith is not sure (low), or a non-joining field is claimed by two columns
 *   value:   a category value that maps to nothing (Keith said null and no exact match)
 *   status:  Internship only, the status new students start at
 */
export function questionsFor(mapping, headers, rows, { target, cohortNames = [] } = {}) {
  const qs = []
  const claimed = new Map()
  for (const c of mapping.columns) {
    if (c.field === IGNORE) continue
    const list = claimed.get(c.field) || []
    list.push(c.index)
    claimed.set(c.field, list)
  }
  for (const c of mapping.columns) {
    const clash = c.field !== IGNORE && !FIELD_BY_KEY[c.field]?.joins && (claimed.get(c.field) || []).length > 1
    if (c.confidence === 'low' && c.field === IGNORE && !rows.some(r => r[c.index])) continue
    if (c.confidence === 'low' || clash) {
      qs.push({ kind: 'column', id: `col:${c.index}`, index: c.index, header: headers[c.index], suggested: c.field, note: c.note, reason: clash ? 'clash' : 'unsure' })
    }
  }
  for (const c of mapping.columns) {
    const f = FIELD_BY_KEY[c.field]
    if (!f || (f.kind !== 'choice' && f.kind !== 'list')) continue
    const vocab = choicesFor(f.key, cohortNames)
    const map = mapping.values[f.key] || {}
    for (const v of columnVocabulary(rows, c.index, f.key, mapping.separator)) {
      if (map[v] !== undefined && map[v] !== null) continue
      if (exactChoice(v, vocab)) continue
      if (f.key === 'aspire_cohort' && target === 'internship') continue // the current cohort decides
      qs.push({ kind: 'value', id: `val:${f.key}:${v}`, field: f.key, value: v, keithSaid: map[v] === null ? 'none' : 'unseen', choices: vocab, allowNew: f.key === 'aspire_cohort' })
    }
  }
  if (target === 'internship') qs.push({ kind: 'status', id: 'status', suggested: mapping.status || 'Form Received' })
  return qs
}

/** Apply the popup's answers to a mapping. `answers` is { [question id]: value }. */
export function applyAnswers(mapping, answers = {}) {
  const columns = mapping.columns.map(c => {
    const a = answers[`col:${c.index}`]
    return a !== undefined ? { ...c, field: FIELD_BY_KEY[a] ? a : IGNORE, confidence: 'high' } : c
  })
  const values = Object.fromEntries(Object.entries(mapping.values).map(([k, v]) => [k, { ...v }]))
  const newCohorts = []
  for (const [id, a] of Object.entries(answers)) {
    if (!id.startsWith('val:')) continue
    const [, field, ...rest] = id.split(':')
    const from = rest.join(':')
    values[field] = values[field] || {}
    if (field === 'aspire_cohort' && typeof a === 'string' && a.startsWith('new:')) {
      const name = str(a.slice(4), 80)
      values[field][from] = name || null
      if (name) newCohorts.push(name)
    } else values[field][from] = typeof a === 'string' && a ? a : null
  }
  const status = ASPIRE_STATUSES.includes(answers.status) ? answers.status : mapping.status
  return { ...mapping, columns, values, status, newCohorts: [...new Set(newCohorts)] }
}

// ── values ────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD from an ISO date or date-time, M/D/YYYY, or M/D/YY. Anything else is null. */
export function toIsoDate(v) {
  const s = str(v, 40)
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    const mo = Number(m[1]); const d = Number(m[2])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

/** "Last, First Middle" or "First Middle Last", by the file's format; a comma always means last first. */
export function splitName(v, format) {
  const s = str(v, 160)
  if (!s) return { first_name: '', last_name: '' }
  if (s.includes(',')) {
    const [last, ...rest] = s.split(',')
    return { first_name: str(rest.join(' ')), last_name: str(last) }
  }
  const parts = s.split(' ')
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  if (format === 'last_first') return { first_name: parts.slice(1).join(' '), last_name: parts[0] }
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] }
}

function mapChoice(value, field, mapping, cohortNames) {
  const v = str(value, 200)
  if (!v) return null
  const map = mapping.values[field] || {}
  if (map[v] !== undefined) return map[v]
  return exactChoice(v, choicesFor(field, cohortNames))
}

/**
 * One row's student fields under a confirmed mapping. Returns { values, problems } where values
 * holds only what the row filled and problems names what could not be read ("GPA 7.2 is not on a
 * 4.0 scale"), which is shown, never guessed past.
 */
export function rowValues(row, mapping, { cohortNames = [] } = {}) {
  const values = {}
  const problems = []
  const joins = {}
  for (const c of mapping.columns) {
    const f = FIELD_BY_KEY[c.field]
    const raw = str(row[c.index], 4000)
    if (!f || !raw) continue
    switch (f.kind) {
      case 'name': {
        const n = splitName(raw, mapping.nameFormat)
        if (n.first_name && !values.first_name) values.first_name = n.first_name
        if (n.last_name && !values.last_name) values.last_name = n.last_name
        break
      }
      case 'email': {
        const e = normalizeEmailForLookup(raw)
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) values[f.key] = e
        else problems.push(`${f.label} is not an email address`)
        break
      }
      case 'phone': values.phone = raw.slice(0, 40); break
      case 'date': {
        const d = toIsoDate(raw)
        if (d) values[f.key] = d
        else problems.push(`${f.label} is not a date`)
        break
      }
      case 'ssn4': {
        const digits = raw.replace(/\D/g, '')
        if (digits.length >= 4) values.ssn_last4 = digits.slice(-4)
        else problems.push('SSN last 4 is not four digits')
        break
      }
      case 'gpa': {
        const n = Number(raw.replace(/[^0-9.]/g, ''))
        if (Number.isFinite(n) && n > 0 && n <= 4.5) values.cumulative_gpa = Math.round(n * 100) / 100
        else problems.push(`GPA ${raw.slice(0, 12)} is not on a 4.0 scale`)
        break
      }
      case 'choice': {
        const m = mapChoice(raw, f.key, mapping, cohortNames)
        if (m) values[f.key] = m
        break
      }
      case 'list': {
        const picked = []
        for (const item of splitList(raw, mapping.separator)) {
          const m = mapChoice(item, f.key, mapping, cohortNames)
          if (m && !picked.includes(m)) picked.push(m)
        }
        if (picked.length) values[f.key] = picked
        break
      }
      default: {
        if (f.joins) (joins[f.key] = joins[f.key] || []).push(raw)
        else if (!values[f.key]) values[f.key] = raw.slice(0, 2000)
      }
    }
  }
  for (const [k, parts] of Object.entries(joins)) values[k] = parts.join('\n\n').slice(0, 4000)
  if (values.first_name) values.first_name = values.first_name.slice(0, 80)
  if (values.last_name) values.last_name = values.last_name.slice(0, 80)
  return { values, problems }
}

/** The students columns a row's values become (unit and day lists spread into their columns). */
export function studentColumns(values) {
  const out = {}
  for (const [k, v] of Object.entries(values)) {
    if (k === 'unit_preferences') {
      v.slice(0, 3).forEach((u, i) => { out[`unit_preference_${i + 1}`] = u })
    } else if (k === 'status' || k === 'aspire_cohort') {
      continue // decided by the plan, never copied blindly
    } else out[k] = v
  }
  if (values.first_name || values.last_name) out.name = [values.first_name, values.last_name].filter(Boolean).join(' ')
  return out
}

// ── the plan ──────────────────────────────────────────────────────────────────

const nameKey = (first, last) => `${fold(first)}|${fold(last)}`
const COMPARE_SKIP = new Set(['name'])
const emptyish = v => v == null || v === '' || (Array.isArray(v) && !v.length)
const same = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || [])
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return fold(a) === fold(b)
}

/** What a matched record would gain (empty fields) and where the file disagrees with it. */
export function diffAgainst(existing, cols) {
  const fill = []
  const conflicts = []
  for (const [k, v] of Object.entries(cols)) {
    if (COMPARE_SKIP.has(k) || emptyish(v)) continue
    const cur = existing?.[k]
    if (emptyish(cur)) fill.push(k)
    else if (!same(cur, v)) conflicts.push({ field: k, from: cur, to: v })
  }
  return { fill, conflicts }
}

/**
 * Plan every row. `pool` is the students in the app: { id, first_name, last_name,
 * preferred_first_name, personal_email, school_email, status, cohort_id, cohort_name, ...fields }.
 * Options: target, cohortId (Internship: the cohort the import fills), cohortNames, onRosterIds
 * (Residency), newCohorts (Residency: past cohorts the popup agreed to create).
 *
 * Each plan row: { row, name, action, values, cols, match?, fill, conflicts, problems, reason,
 * options? }. action is create | update | add | skip | ask. `ask` carries `options`, the answers
 * the popup may give for that row, the first being the safe default.
 */
export function planRows(rows, mapping, pool, { target, cohortId = null, cohortNames = [], onRosterIds = [], newCohorts = [] } = {}) {
  const byEmail = new Map()
  const byName = new Map()
  for (const s of pool) {
    for (const e of [s.personal_email, s.school_email].map(normalizeEmailForLookup).filter(Boolean)) {
      if (!byEmail.has(e)) byEmail.set(e, new Set())
      byEmail.get(e).add(s)
    }
    for (const first of [s.first_name, s.preferred_first_name].filter(Boolean)) {
      const k = nameKey(first, s.last_name)
      if (!byName.has(k)) byName.set(k, new Set())
      byName.get(k).add(s)
    }
  }
  const onRoster = new Set(onRosterIds)
  const seenInFile = new Map()
  const known = new Set([...cohortNames, ...newCohorts].map(fold))

  return rows.map((row, i) => {
    const n = i + 2 // the sheet's own row number, header being row 1
    const { values, problems } = rowValues(row, mapping, { cohortNames: [...cohortNames, ...newCohorts] })
    const cols = studentColumns(values)
    const name = [values.first_name, values.last_name].filter(Boolean).join(' ')
    const base = { row: n, name, values, cols, problems, fill: [], conflicts: [] }
    if (!values.first_name || !values.last_name) return { ...base, action: 'skip', reason: 'no_name' }

    const emails = [values.personal_email, values.school_email].filter(Boolean)
    const fileKey = emails[0] || nameKey(values.first_name, values.last_name)
    if (seenInFile.has(fileKey)) return { ...base, action: 'skip', reason: 'repeat_in_file', repeatOf: seenInFile.get(fileKey) }
    seenInFile.set(fileKey, n)

    const emailHits = new Set()
    for (const e of emails) for (const s of byEmail.get(e) || []) emailHits.add(s)
    const nameHits = [...(byName.get(nameKey(values.first_name, values.last_name)) || [])]
    const hits = emailHits.size ? [...emailHits] : nameHits
    const by = emailHits.size ? 'email' : 'name'

    if (target === 'internship') {
      if (hits.length > 1) return { ...base, action: 'ask', reason: 'ambiguous', matches: hits.map(brief), options: ['skip', 'create'] }
      const m = hits[0]
      if (m && m.cohort_id === cohortId) {
        const d = diffAgainst(m, cols)
        const match = brief(m, by)
        if (by === 'name') return { ...base, ...d, match, action: 'ask', reason: 'name_only', options: ['update', 'create', 'skip'] }
        if (d.conflicts.length) return { ...base, ...d, match, action: 'ask', reason: 'conflicts', options: ['update', 'replace', 'skip'] }
        return { ...base, ...d, match, action: d.fill.length ? 'update' : 'skip', reason: d.fill.length ? 'fill' : 'nothing_new' }
      }
      if (m) return { ...base, match: brief(m, by), action: 'ask', reason: 'other_cohort', options: ['skip', 'create'] }
      return { ...base, action: 'create', reason: 'new' }
    }

    // Residency: an alumnus is a Completed student; the row's own ASPIRE cohort says which.
    if (hits.length > 1) return { ...base, action: 'ask', reason: 'ambiguous', matches: hits.map(brief), options: ['skip', 'create'] }
    const m = hits[0]
    if (m) {
      const match = brief(m, by)
      if (m.status !== 'Completed') return { ...base, match, action: 'skip', reason: 'not_completed' }
      const d = diffAgainst(m, cols)
      const add = !onRoster.has(m.id)
      if (by === 'name') return { ...base, ...d, match, add, action: 'ask', reason: 'name_only', options: [add ? 'add' : 'update', 'create', 'skip'] }
      if (d.conflicts.length) return { ...base, ...d, match, add, action: 'ask', reason: 'conflicts', options: [add ? 'add' : 'update', 'replace', 'skip'] }
      if (add) return { ...base, ...d, match, add, action: 'add', reason: 'add' }
      return { ...base, ...d, match, add, action: d.fill.length ? 'update' : 'skip', reason: d.fill.length ? 'fill' : 'on_roster' }
    }
    const cohort = values.aspire_cohort
    if (!cohort || !known.has(fold(cohort))) return { ...base, action: 'skip', reason: 'no_cohort' }
    return { ...base, cohort, action: 'create', reason: 'new' }
  })
}

const brief = (s, by) => ({ id: s.id, name: [s.preferred_first_name || s.first_name, s.last_name].filter(Boolean).join(' '), cohort: s.cohort_name || null, status: s.status || null, ...(by ? { by } : {}) })

/** A plan row with the person's answer applied (an answer not in its options is ignored). */
export function decide(plan, decisions = {}) {
  return plan.map(p => {
    if (p.action !== 'ask') return p
    const a = decisions[p.row]
    const choice = p.options.includes(a) ? a : p.options[0]
    return { ...p, action: choice, decided: true }
  })
}

/** The counts the popup and the toast say. */
export function planCounts(plan) {
  const c = { create: 0, update: 0, replace: 0, add: 0, skip: 0, ask: 0 }
  for (const p of plan) c[p.action] = (c[p.action] || 0) + 1
  return c
}

export const REASON_WORDS = Object.freeze({
  new: 'New student',
  fill: 'Already here: fills empty fields',
  nothing_new: 'Already here, nothing new',
  conflicts: 'Already here, and the file differs',
  name_only: 'Same name, no matching email',
  ambiguous: 'More than one possible match',
  other_cohort: 'Already in another cohort',
  repeat_in_file: 'Repeated in this file',
  no_name: 'No first and last name',
  not_completed: 'Has not completed ASPIRE',
  add: 'Completed alumnus: added to the roster',
  on_roster: 'Already on the roster',
  no_cohort: 'No ASPIRE cohort to file them under',
})

export const OPTION_WORDS = Object.freeze({
  update: 'Update that record',
  replace: 'Update, and replace what differs',
  add: 'Add to the roster',
  create: 'Create a new student',
  skip: 'Skip this row',
})

// When Keith cannot be asked (his Skill is off, or the call failed), the popup still opens with a
// guess from the headers alone. Every guess is "low", so the person confirms each one.
const HEADER_GUESSES = [
  [/^(student'?s? )?full( legal)? name|^name$|student name/i, 'full_name'],
  [/^first( name)?$|given name/i, 'first_name'],
  [/^last( name)?$|surname|family name/i, 'last_name'],
  [/preferred name|preferred first|nickname/i, 'preferred_first_name'],
  [/^personal e-?mail|^e-?mail( address)?$/i, 'personal_email'],
  [/school e-?mail|student e-?mail|edu e-?mail/i, 'school_email'],
  [/^(personal )?(phone|mobile|cell)/i, 'phone'],
  [/birth|dob/i, 'date_of_birth'],
  [/social|ssn/i, 'ssn_last4'],
  [/^gender|^sex$/i, 'gender'],
  [/^school|university|college/i, 'school'],
  [/program type|^program$/i, 'program_type'],
  [/graduat/i, 'estimated_graduation_date'],
  [/gpa/i, 'cumulative_gpa'],
  [/employed at cedars|cedars.?sinai affiliation|affiliation/i, 'cs_affiliation'],
  [/unit preference|preferred (specialty|unit)/i, 'unit_preferences'],
  [/day and\/or night|shift preference|open to day/i, 'shift_availability'],
  [/days (are you )?(typically )?available/i, 'preferred_days'],
  [/aspire cohort|^cohort$/i, 'aspire_cohort'],
]
export function guessMapping(headers) {
  const used = new Set()
  const columns = headers.map((h, index) => {
    const hit = HEADER_GUESSES.find(([re, field]) => re.test(h) && !used.has(field))
    if (!hit) return { index, field: IGNORE, confidence: 'medium', note: null }
    used.add(hit[1])
    return { index, field: hit[1], confidence: 'low', note: null }
  })
  return { columns, values: {}, nameFormat: null, separator: ';', status: null, summary: null }
}
