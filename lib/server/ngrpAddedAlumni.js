// lib/server/ngrpAddedAlumni.js
//
// ADD-ALUMNUS-1 (Owner, 2026-10-29): Residency > Profiles & Interest > Add alumnus, for the
// Owner and Admins. An alumnus outside a residency cohort's participating ASPIRE cohorts joins
// its roster through ngrp_cycle_added_alumni (20261116000000):
//
//   - already in the app: a Completed student from any cohort, found by search;
//   - new to the app: a Completed student record created in the ASPIRE cohort the Owner picks,
//     or in a past cohort created here by name (Owner: "I can specify which cohort").
//
// The record holds the APPLICATION profile only (Owner, 2026-10-29): legal and preferred name,
// personal email, mobile phone, school, program, graduation date, ASPIRE cohort and the unit
// they precepted on. Nothing from ASPIRE intake. The Transition Form asks the rest.
// The precepted unit goes to students.unit, an old text column nothing else reads (87 of 88
// rows blank on 2026-10-29); the roster falls back to it when there is no ASPIRE placement.
//
// Removing someone sets removed_at; nothing is deleted. Every step is logged in Settings >
// Residency Activity (alumnus_added, alumnus_removed, alumnus_invited).

export const PROFILE_KEYS = Object.freeze([
  'first_name', 'last_name', 'preferred_first_name', 'personal_email', 'phone',
  'school', 'program_type', 'estimated_graduation_date', 'precepted_unit',
])

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// The profile as stored: trimmed, bounded, blanks as null. Errors name the field.
export function validateProfile(input, { requireEmail = true } = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const p = {
    first_name: str(src.first_name, 80),
    last_name: str(src.last_name, 80),
    preferred_first_name: str(src.preferred_first_name, 80),
    personal_email: str(src.personal_email, 160).toLowerCase(),
    phone: str(src.phone, 40),
    school: str(src.school, 160),
    program_type: str(src.program_type, 120),
    estimated_graduation_date: str(src.estimated_graduation_date, 10),
    precepted_unit: str(src.precepted_unit, 120),
  }
  const errors = []
  if (!p.first_name) errors.push({ field: 'first_name', message: 'First name is required.' })
  if (!p.last_name) errors.push({ field: 'last_name', message: 'Last name is required.' })
  if (requireEmail && !p.personal_email) errors.push({ field: 'personal_email', message: 'A personal email is required: the form and its code go there.' })
  if (p.personal_email && !EMAIL.test(p.personal_email)) errors.push({ field: 'personal_email', message: 'That email address does not look right.' })
  if (p.estimated_graduation_date && !DATE.test(p.estimated_graduation_date)) errors.push({ field: 'estimated_graduation_date', message: 'Use a full date.' })
  return { ok: errors.length === 0, profile: p, errors }
}

// The students columns a profile writes. `name` stays the full legal name, as elsewhere.
export function studentColumnsFrom(profile) {
  const out = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    name: `${profile.first_name} ${profile.last_name}`.trim(),
    preferred_first_name: profile.preferred_first_name || null,
    personal_email: profile.personal_email || null,
    phone: profile.phone || null,
    school: profile.school || null,
    program_type: profile.program_type || null,
    estimated_graduation_date: profile.estimated_graduation_date || null,
    unit: profile.precepted_unit || '',
  }
  return out
}

// Search Completed alumni NOT already on this roster, by name or email. Owner/Admin only, so
// the result carries the personal email to tell two people with one name apart.
export async function searchAlumni(db, { query, excludeIds = [] }) {
  const q = str(query, 80).replace(/[%,()]/g, ' ').trim()
  if (q.length < 2) return { results: [] }
  const like = `%${q}%`
  const r = await db.from('students')
    .select('id, first_name, last_name, preferred_first_name, school, program_type, aspire_cohort, personal_email, cohort_id, cohort:cohort_id ( name )')
    .eq('status', 'Completed')
    .or(['first_name', 'last_name', 'name', 'personal_email', 'school_email'].map(c => `${c}.ilike."${like}"`).join(','))
    .order('last_name').limit(25)
  if (r.error) return { error: r.error }
  const skip = new Set(excludeIds)
  return {
    results: (r.data || []).filter(s => !skip.has(s.id)).slice(0, 15).map(s => ({
      id: s.id, first_name: s.first_name, last_name: s.last_name, preferred_first_name: s.preferred_first_name,
      school: s.school, program_type: s.program_type, personal_email: s.personal_email,
      cohort: s.cohort?.name || s.aspire_cohort || null,
    })),
  }
}

// Possible matches for a new person: the same personal or school email, or the same full name.
export async function findMatches(db, profile) {
  const out = new Map()
  if (profile.personal_email) {
    const e = profile.personal_email
    const r = await db.from('students').select('id, first_name, last_name, preferred_first_name, status, personal_email, cohort:cohort_id ( name )')
      .or(`personal_email.ilike."${e}",school_email.ilike."${e}"`).limit(5)
    if (r.error) return { error: r.error }
    for (const s of r.data || []) out.set(s.id, s)
  }
  const n = await db.from('students').select('id, first_name, last_name, preferred_first_name, status, personal_email, cohort:cohort_id ( name )')
    .ilike('first_name', profile.first_name).ilike('last_name', profile.last_name).limit(5)
  if (n.error) return { error: n.error }
  for (const s of n.data || []) out.set(s.id, s)
  return {
    matches: [...out.values()].map(s => ({
      id: s.id, first_name: s.first_name, last_name: s.last_name, status: s.status,
      personal_email: s.personal_email, cohort: s.cohort?.name || null,
    })),
  }
}

// A cohort the Owner names for alumni from before the app (e.g. "Fall 2025"), Completed. A name
// that already exists is reused rather than duplicated.
export async function ensurePastCohort(db, { name, isDemo }) {
  const n = str(name, 80)
  if (n.length < 3) return { invalid: true }
  const found = await db.from('cohorts').select('id, name, status').ilike('name', n).limit(1)
  if (found.error) return { error: found.error }
  if (found.data?.[0]) return { cohort: found.data[0], created: false }
  const row = { name: n, status: 'Completed' }
  if (isDemo) row.is_demo = true
  const ins = await db.from('cohorts').insert(row).select('id, name, status').single()
  if (ins.error) return { error: ins.error }
  return { cohort: ins.data, created: true }
}

export async function addToRoster(db, { cycleId, studentId, actorId }) {
  const ins = await db.from('ngrp_cycle_added_alumni')
    .insert({ cycle_id: cycleId, student_id: studentId, added_by_profile_id: actorId })
    .select('id').single()
  if (ins.error) return ins.error.code === '23505' ? { already: true } : { error: ins.error }
  return { ok: true, id: ins.data.id }
}

export async function removeFromRoster(db, { cycleId, studentId, actorId, nowIso }) {
  const upd = await db.from('ngrp_cycle_added_alumni')
    .update({ removed_at: nowIso, removed_by_profile_id: actorId })
    .eq('cycle_id', cycleId).eq('student_id', studentId).is('removed_at', null)
    .select('id')
  if (upd.error) return { error: upd.error }
  return { ok: true, removed: (upd.data || []).length }
}
