// src/lib/ngrp/hireImportModel.js
//
// HIRE-HISTORY-1 (Owner, 2026-11-04): Record past hires. The team's spreadsheet (the intake
// form export with its Hired / As / Unit / Applied for Cohort columns, or any list of hired
// alumni) becomes hire records on residency cohorts that ran before the app held them. Pure:
// the drawer, the server and the tests read the same rules. No Keith here: this is a one-time
// step over a handful of columns, and the person confirms every column and every row.
import { exactChoice, splitName, toIsoDate, UNIT_NAMES } from '../studentImport/importModel.js'
import { normalizeEmailForLookup } from '../emailUtils.js'
import { HIRED_AS, HIRED_AS_OTHER } from './ngrpResidents.js'

export const IGNORE = '__ignore__'

export const HIRE_FIELDS = Object.freeze([
  { key: 'full_name', label: 'Full name', kind: 'name' },
  { key: 'first_name', label: 'First name', kind: 'text' },
  { key: 'last_name', label: 'Last name', kind: 'text' },
  { key: 'personal_email', label: 'Personal email', kind: 'email' },
  { key: 'school_email', label: 'School email', kind: 'email' },
  { key: 'hired', label: 'Hired (yes or no)', kind: 'flag' },
  { key: 'hired_on', label: 'Hire date', kind: 'date' },
  { key: 'hired_unit', label: 'Hired into unit', kind: 'unit' },
  { key: 'hired_as', label: 'Hired as', kind: 'hired_as' },
  { key: 'residency_cohort', label: 'Residency cohort', kind: 'text' },
  { key: 'current_title', label: 'Current title', kind: 'text' },
  // HIRE-HISTORY-2: one licensure date (the license issue date) and the interim permit.
  { key: 'license_issued_on', label: 'License issued on', kind: 'date' },
  { key: 'interim_permit_issued', label: 'Interim permit issued (yes or no)', kind: 'yesno' },
  { key: 'separated_on', label: 'Separated on', kind: 'date' },
  { key: 'separation_reason', label: 'Separation reason', kind: 'text' },
])
export const HIRE_FIELD_BY_KEY = Object.fromEntries(HIRE_FIELDS.map(f => [f.key, f]))

// Header guesses, first match wins per field. "ASPIRE Cohort" is the internship cohort and
// must not be read as the residency cohort; "Applied for Cohort" is.
const GUESSES = [
  [/^(student'?s? )?(full )?(legal )?name/i, 'full_name'],
  [/^first ?name|given name/i, 'first_name'],
  [/^last ?name|surname|family name/i, 'last_name'],
  [/personal e-?mail|^e-?mail$/i, 'personal_email'],
  [/school e-?mail|\.edu/i, 'school_email'],
  [/^hired\??$/i, 'hired'],
  [/hire date|hired on|date (of )?hire|start date/i, 'hired_on'],
  [/^as$|hired as|^position$/i, 'hired_as'],
  [/^unit$|hired (into )?unit|hiring unit/i, 'hired_unit'],
  [/applied for cohort|residency cohort|ngrp cohort|new.?grad cohort/i, 'residency_cohort'],
  [/current title|current role|^title$|^role$/i, 'current_title'],
  [/interim|permit/i, 'interim_permit_issued'],
  [/licen[cs]e.*(issue|date)|nclex.*(pass|date)|passed nclex/i, 'license_issued_on'],
  [/separat|^left|end date|termination/i, 'separated_on'],
  [/separation reason|reason (for )?(leaving|separation)/i, 'separation_reason'],
]

export function guessHireMapping(headers) {
  const used = new Set()
  const columns = headers.map((h, index) => {
    const hit = GUESSES.find(([re, field]) => re.test(String(h || '')) && !used.has(field))
    if (!hit) return { index, field: IGNORE }
    used.add(hit[1])
    return { index, field: hit[1] }
  })
  const nameCol = headers.find((h, i) => columns[i].field === 'full_name')
  return { columns, nameFormat: nameCol && /last.*first/i.test(nameCol) ? 'last_first' : 'first_last' }
}

// The person's confirmed mapping, closed to the field list; one column per field except that a
// second column for a field is ignored.
export function sanitizeHireMapping(input, headers) {
  const used = new Set()
  const given = Array.isArray(input?.columns) ? input.columns : []
  const byIndex = new Map(given.filter(c => c && Number.isInteger(c.index)).map(c => [c.index, c.field]))
  const columns = headers.map((h, index) => {
    const f = byIndex.get(index)
    if (!f || f === IGNORE || !HIRE_FIELD_BY_KEY[f] || used.has(f)) return { index, field: IGNORE }
    used.add(f)
    return { index, field: f }
  })
  return { columns, nameFormat: input?.nameFormat === 'last_first' ? 'last_first' : 'first_last' }
}

const str = (v, max = 400) => (v == null ? '' : String(v).trim().slice(0, max))
const YES = /^(y|yes|true|hired|x|✓|✔|1)$/i
const NO = /^(n|no|false|not hired|0|-)$/i

export function hiredAsFrom(raw) {
  const s = str(raw, 120)
  if (!s) return null
  if (/\bgnt\b|graduate nurse|nurse (tech|trainee)/i.test(s)) return { hired_as: 'Graduate Nurse Trainee', hired_as_other: null }
  if (/^cn\s*(i|1)$|clinical nurse\s*(i|1)$|^rn$|^cn$|new grad|resident/i.test(s)) return { hired_as: 'Clinical Nurse I', hired_as_other: null }
  const exact = exactChoice(s, HIRED_AS)
  if (exact) return { hired_as: exact, hired_as_other: null }
  return { hired_as: HIRED_AS_OTHER, hired_as_other: s }
}

/** One row's hire facts under a mapping. */
export function hireRowValues(row, mapping) {
  const v = {}
  const problems = []
  for (const c of mapping.columns) {
    const f = HIRE_FIELD_BY_KEY[c.field]
    const raw = str(row[c.index], 1000)
    if (!f || !raw) continue
    switch (f.kind) {
      case 'name': {
        const n = splitName(raw, mapping.nameFormat)
        if (n.first_name && !v.first_name) v.first_name = n.first_name
        if (n.last_name && !v.last_name) v.last_name = n.last_name
        break
      }
      case 'email': {
        const e = normalizeEmailForLookup(raw)
        if (e) v[f.key] = e
        else problems.push(`${f.label} "${raw.slice(0, 40)}" is not an email address`)
        break
      }
      case 'flag': {
        if (YES.test(raw)) v.hired = true
        else if (NO.test(raw)) v.hired = false
        else if (toIsoDate(raw)) { v.hired = true; if (!v.hired_on) v.hired_on = toIsoDate(raw) }
        else { v.hired = true; v.hired_note = raw.slice(0, 120) }
        break
      }
      case 'date': {
        const d = toIsoDate(raw)
        if (d) v[f.key] = d
        else problems.push(`${f.label} "${raw.slice(0, 40)}" is not a date`)
        break
      }
      case 'unit': {
        v.hired_unit = exactChoice(raw, UNIT_NAMES) || exactChoice(raw.replace(/\s*\(.*$/, ''), UNIT_NAMES) || raw.slice(0, 120)
        break
      }
      case 'yesno': {
        if (YES.test(raw)) v[f.key] = true
        else if (NO.test(raw)) v[f.key] = false
        break
      }
      case 'hired_as': {
        Object.assign(v, hiredAsFrom(raw) || {})
        break
      }
      default:
        v[f.key] = raw.slice(0, f.key === 'separation_reason' ? 500 : 120)
    }
  }
  return { values: v, problems }
}

const fold = s => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
const nameKey = (first, last) => `${fold(first)}|${fold(last)}`

/**
 * Plan every row. pool: Completed (and other) students { id, first_name, last_name,
 * preferred_first_name, personal_email, school_email, status, cohort_name }. onRecord: hires
 * already recorded, as "studentId|cohort key" where the cohort key is the residency cohort's
 * folded name; cohortKeyOf turns a file's cohort value into that key (the server maps it through
 * the person's cohort choices). Rows use the sheet's numbering, starting at 2.
 * Each plan row: { row, name, action: 'record' | 'skip', reason, values, match?, cohort }.
 */
export function planHires(rows, mapping, pool, { onRecord = [], cohortKeyOf = fold } = {}) {
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
  const recorded = new Set(onRecord)
  const seen = new Map()
  return rows.map((row, i) => {
    const n = i + 2
    const { values, problems } = hireRowValues(row, mapping)
    const name = [values.first_name, values.last_name].filter(Boolean).join(' ')
    const base = { row: n, name, values, problems, cohort: values.residency_cohort || '', match: null }
    const saysHired = values.hired === true || (values.hired === undefined && Boolean(values.hired_on))
    if (!saysHired) return { ...base, action: 'skip', reason: values.hired === false ? 'not_hired' : 'no_hire_mark' }
    if (!values.first_name || !values.last_name) return { ...base, action: 'skip', reason: 'no_name' }
    const emails = [values.personal_email, values.school_email].filter(Boolean)
    // A row repeats an earlier one by any email OR by name, so a second row for the same person
    // with the email left blank is still a repeat.
    const keys = [...emails, nameKey(values.first_name, values.last_name)]
    const earlier = keys.map(k => seen.get(k)).find(Boolean)
    if (earlier) return { ...base, action: 'skip', reason: 'repeat_in_file', repeatOf: earlier }
    for (const k of keys) seen.set(k, n)
    const emailHits = new Set()
    for (const e of emails) for (const s of byEmail.get(e) || []) emailHits.add(s)
    const hits = emailHits.size ? [...emailHits] : [...(byName.get(nameKey(values.first_name, values.last_name)) || [])]
    if (hits.length > 1) return { ...base, action: 'skip', reason: 'ambiguous', matches: hits.map(brief) }
    const m = hits[0]
    if (!m) return { ...base, action: 'skip', reason: 'no_match' }
    const match = brief(m, emailHits.size ? 'email' : 'name')
    if (m.status !== 'Completed') return { ...base, match, action: 'skip', reason: 'not_completed' }
    if (!base.cohort) return { ...base, match, action: 'skip', reason: 'no_cohort' }
    if (recorded.has(`${m.id}|${cohortKeyOf(base.cohort)}`)) return { ...base, match, action: 'skip', reason: 'already' }
    // HIRE-HISTORY-3: a row with no hire date is still recorded; its cohort's date stands in.
    return { ...base, match, action: 'record', reason: 'record' }
  })
}

const brief = (s, by) => ({ id: s.id, name: [s.preferred_first_name || s.first_name, s.last_name].filter(Boolean).join(' '), cohort: s.cohort_name || null, status: s.status || null, ...(by ? { by } : {}) })

/** The distinct residency cohort values in the plan, with how many hires each carries. */
export function cohortValues(plan) {
  const counts = new Map()
  for (const p of plan) if (p.cohort && p.action !== 'skip') counts.set(p.cohort, (counts.get(p.cohort) || 0) + 1)
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value))
}

/** An existing residency cohort that reads as the file's value, by name. */
export function suggestCycle(value, cycles) {
  const k = fold(value)
  if (!k) return null
  return cycles.find(c => fold(c.name) === k) || cycles.find(c => fold(c.name).includes(k) || k.includes(fold(c.name))) || null
}

export const REASON_WORDS = Object.freeze({
  record: 'Will be recorded',
  not_hired: 'Not hired, per the file',
  no_hire_mark: 'No hire mark in this row',
  no_name: 'No first and last name',
  repeat_in_file: 'Repeated in this file',
  ambiguous: 'More than one possible match',
  no_match: 'Not found among the students here',
  not_completed: 'Has not completed ASPIRE',
  no_cohort: 'No residency cohort in this row',
  already: 'Already recorded for that cohort',
  no_date: 'No hire date: enter one, or skip', // retired by HIRE-HISTORY-3; kept for a plan made before it
})
