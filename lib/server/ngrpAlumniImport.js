// lib/server/ngrpAlumniImport.js
//
// RESIDENCY-PROFILES-TOOLBAR-1 (Owner, 2026-11-03): Residency > Profiles & Interest > Import. A CSV
// of names or emails is MATCHED to students already in the app and those alumni join the roster,
// the same as Add Alumnus one at a time (ngrp_cycle_added_alumni). It never creates a student.
// Owner and Admin only, as Student Profiles' Import is.
//
// A row matches by email first (personal or school, any case), else by first and last name. Only
// a single Completed student is a match; anything else is reported and never written:
//   matched          one Completed alumnus, not on this roster yet
//   on_roster        already on this cohort's roster (participating cohort or added before)
//   not_completed    the only student found has not completed ASPIRE
//   ambiguous        more than one student fits
//   not_found        nobody fits
//   blank            no name and no email
import { readAll } from './sheet/readAll.js'

export const MAX_IMPORT_ROWS = 500

const low = v => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const clip = (v, n = 160) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

// A row as the browser parsed it: { first_name, last_name } or { name }, and { email } or
// { personal_email } / { school_email }. Headers are matched loosely.
export function normalizeImportRow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const get = (...keys) => {
    for (const k of Object.keys(r)) {
      const key = k.toLowerCase().replace(/[^a-z]/g, '')
      if (keys.includes(key) && clip(String(r[k] ?? ''))) return clip(String(r[k]))
    }
    return ''
  }
  let first = get('firstname', 'first', 'legalfirstname', 'givenname')
  let last = get('lastname', 'last', 'legallastname', 'surname', 'familyname')
  const full = get('name', 'fullname', 'student', 'studentname', 'alumnus')
  if ((!first || !last) && full) {
    if (full.includes(',')) {
      const [l, f] = full.split(',').map(x => x.trim())
      first = first || f || ''; last = last || l || ''
    } else {
      const parts = full.split(/\s+/)
      last = last || (parts.length > 1 ? parts.pop() : '')
      first = first || parts.join(' ')
    }
  }
  const emails = [get('email', 'emailaddress'), get('personalemail'), get('schoolemail')]
    .map(low).filter(e => e.includes('@'))
  return { first_name: first, last_name: last, emails: [...new Set(emails)] }
}

const nameOf = s => `${s.last_name || ''}, ${s.preferred_first_name || s.first_name || ''}`.trim()

// Pure. `students` are every student that could match (id, names, emails, status, cohort name).
export function matchImportRows(rawRows, students, onRosterIds) {
  const onRoster = new Set(onRosterIds || [])
  const byEmail = new Map(), byName = new Map()
  const push = (map, key, s) => { if (!key) return; const a = map.get(key) || []; if (!a.includes(s)) a.push(s); map.set(key, a) }
  for (const s of students || []) {
    push(byEmail, low(s.personal_email), s)
    push(byEmail, low(s.school_email), s)
    push(byName, `${low(s.first_name)}|${low(s.last_name)}`, s)
    if (s.preferred_first_name) push(byName, `${low(s.preferred_first_name)}|${low(s.last_name)}`, s)
  }
  const seen = new Set()
  return (rawRows || []).slice(0, MAX_IMPORT_ROWS).map((raw, i) => {
    const row = normalizeImportRow(raw)
    const label = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.emails[0] || ''
    const base = { row: i + 1, input: label }
    if (!row.emails.length && !(row.first_name && row.last_name)) return { ...base, status: 'blank' }
    let found = []
    for (const e of row.emails) for (const s of byEmail.get(e) || []) if (!found.includes(s)) found.push(s)
    if (!found.length && row.first_name && row.last_name) found = byName.get(`${low(row.first_name)}|${low(row.last_name)}`) || []
    if (!found.length) return { ...base, status: 'not_found' }
    if (found.length > 1) {
      const done = found.filter(s => s.status === 'Completed')
      if (done.length !== 1) return { ...base, status: 'ambiguous', count: found.length }
      found = done
    }
    const s = found[0]
    const who = { student_id: s.id, name: nameOf(s), cohort: s.cohort?.name || s.aspire_cohort || null }
    if (s.status !== 'Completed') return { ...base, ...who, status: 'not_completed' }
    if (onRoster.has(s.id) || seen.has(s.id)) return { ...base, ...who, status: 'on_roster' }
    seen.add(s.id)
    return { ...base, ...who, status: 'matched' }
  })
}

export async function loadImportCandidates(db) {
  return readAll(() => db.from('students')
    .select('id, first_name, last_name, preferred_first_name, personal_email, school_email, status, aspire_cohort, cohort:cohort_id ( name )')
    .order('id'))
}
