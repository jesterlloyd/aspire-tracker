// lib/server/studio/resolveAudience.js
//
// STUDIO-2 (Owner, 2026-11-05): a Studio audience RULE (src/lib/studio/audienceCatalog.js) turned
// into people and addresses, on the server, through the request's population (populationDb), so a
// demo session resolves demo people and a real one real people.
//
// Every address here is decided by an existing rule, never a new one:
//   students  resolveStudentEmail (their usual address) or the school / personal address picked;
//   alumni    residencyRecipient over the residency roster the workspace already shows;
//   contacts  the contact's own email, active contacts only.
//
// Each person comes back as an Outreach bulk recipient entry (the shape the bulk endpoint's
// allowlist verifies), plus `route`, which is how the frozen list remembers that an alumnus was
// addressed by the residency rule. What is left out comes back with a reason, never silently.
//
// The shaping is pure (shapeStudents, shapeAlumni, shapeContacts, finishAudience) and tested without
// a database; the loaders around it only fetch.

import { sanitizeRule, NOT_PROCEEDING, MAX_AUDIENCE } from '../../../src/lib/studio/audienceCatalog.js'
import { resolveStudentEmail } from '../../../src/lib/notifications/studentEmailLifecycle.js'
import { isValidEmail } from '../../../src/lib/notifications/studentRecipient.js'
import { normalizeEmailForLookup } from '../../../src/lib/emailUtils.js'
import { getStudentPreferredFullName, getStudentPreferredFirstName } from '../../../src/lib/studentNameFormatters.js'
import { canonicalCategory } from '../../../src/lib/contactCategories.js'
import { residencyRecipient, isHired } from '../ngrpResidencyRecipient.js'
import { hasSubmittedForm } from '../ngrpTalentAcquisition.js'

export const STUDENT_COLS = 'id, first_name, preferred_first_name, last_name, school, status, personal_email, school_email, ' +
  'rotation:cohort_school_rotation_id ( rotation_end_date ), residency_outcomes:ngrp_residency_outcomes ( hired_at, separated_at, cs_email )'
const CONTACT_COLS = 'id, full_name, preferred_name, email, category, is_active'

const norm = (e) => normalizeEmailForLookup(String(e || '').trim())
const schoolKey = (s) => String(s || '').trim().toLowerCase()

// ── Pure shaping ───────────────────────────────────────────────────────────────────────────────

/** Students of the chosen cohorts, filtered by the rule. Not Proceeding never passes. */
export function shapeStudents(rows, rule) {
  const r = sanitizeRule(rule)
  const statuses = new Set(r.statuses)
  const schools = new Set(r.schools.map(schoolKey))
  const people = []
  const excluded = []
  for (const s of rows || []) {
    if (statuses.size && !statuses.has(s.status)) continue
    if (schools.size && !schools.has(schoolKey(s.school))) continue
    const name = getStudentPreferredFullName(s) || 'Student'
    if (s.status === NOT_PROCEEDING) { excluded.push({ name, email: null, reason: 'not_proceeding' }); continue }
    const automatic = r.emailRoute === 'automatic'
    const route = automatic ? resolveStudentEmail(s) : resolveStudentEmail(s, null, { emailSource: r.emailRoute })
    if (!route?.email || !isValidEmail(route.email)) { excluded.push({ name, email: null, reason: 'no_email' }); continue }
    people.push({
      source: 'student', studentId: s.id, email: route.email.trim(),
      ...(automatic ? { automaticEmail: true } : { emailType: r.emailRoute }),
      name, firstName: getStudentPreferredFirstName(s) || null, school: s.school || null, route: automatic ? 'automatic' : r.emailRoute,
    })
  }
  return { people, excluded }
}

/**
 * One residency cohort's roster, filtered by the rule. `payload` is loadApplicantsPayload's;
 * `emails` maps student id to { personal_email }; `preferred` maps assignment id to the form's
 * preferred email.
 */
export function shapeAlumni(payload, rule, { emails, preferred }) {
  const r = sanitizeRule(rule)
  const license = new Set(r.license)
  const candOf = new Map((payload?.candidates || []).map(c => [c.student_id, c]))
  const people = []
  const excluded = []
  for (const st of payload?.students || []) {
    const cand = candOf.get(st.id) || null
    const submitted = hasSubmittedForm(cand?.form_status)
    if (r.form === 'submitted' && !submitted) continue
    if (r.form === 'not_submitted' && submitted) continue
    if (license.size && !license.has(cand?.form_rn_status || 'none')) continue
    const hired = isHired(cand?.outcome)
    if (r.hired === 'yes' && !hired) continue
    if (r.hired === 'no' && hired) continue
    const name = getStudentPreferredFullName(st) || 'Alumnus'
    const student = { ...st, personal_email: emails.get(st.id)?.personal_email || null }
    const to = residencyRecipient({ outcome: cand?.outcome || null, formPreferredEmail: cand?.assignment_id ? preferred.get(cand.assignment_id) : null, student })
    if (!to.email) { excluded.push({ name, email: null, reason: 'no_email' }); continue }
    people.push({
      source: 'student', studentId: st.id, email: to.email, emailType: 'residency',
      name, firstName: getStudentPreferredFirstName(st) || null, school: st.school || null, route: 'residency',
    })
  }
  return { people, excluded }
}

/** Active contacts in the chosen categories (every category when none is chosen). */
export function shapeContacts(rows, rule) {
  const r = sanitizeRule(rule)
  const cats = new Set(r.categories)
  const people = []
  const excluded = []
  for (const c of rows || []) {
    if (c.is_active === false) continue
    if (cats.size && !cats.has(canonicalCategory(c.category))) continue
    const name = c.preferred_name || c.full_name || 'Contact'
    if (!c.email || !isValidEmail(c.email)) { excluded.push({ name, email: null, reason: 'no_email' }); continue }
    people.push({
      source: 'contact', contactId: c.id, email: String(c.email).trim(), name,
      firstName: String(c.preferred_name || c.full_name || '').trim().split(/\s+/)[0] || null, route: 'contact',
    })
  }
  return { people, excluded }
}

/**
 * The last pass every list takes, a rule's or a hand-picked one's: one person per address (the first
 * wins), opted-out addresses out, the ceiling held. `optedOut` is a Set of normalized emails.
 * Every person gains `normEmail`. Order is kept.
 */
export function finishAudience({ people, excluded = [] }, { optedOut = new Set(), max = MAX_AUDIENCE } = {}) {
  const seen = new Set()
  const out = []
  const left = [...excluded]
  for (const p of people || []) {
    const normEmail = norm(p.email)
    if (!normEmail) { left.push({ name: p.name, email: null, reason: 'no_email' }); continue }
    if (seen.has(normEmail)) { left.push({ name: p.name, email: p.email, reason: 'duplicate' }); continue }
    seen.add(normEmail)
    if (optedOut.has(normEmail)) { left.push({ name: p.name, email: p.email, reason: 'opted_out' }); continue }
    if (out.length >= max) { left.push({ name: p.name, email: p.email, reason: 'over_limit' }); continue }
    out.push({ ...p, normEmail })
  }
  return { recipients: out, excluded: left }
}

// ── Loaders ────────────────────────────────────────────────────────────────────────────────────

/** Opted-out addresses among `emails` (normalized). A missing table means nobody has opted out. */
export async function loadOptedOut(db, emails) {
  const list = [...new Set((emails || []).map(norm).filter(Boolean))]
  const out = new Set()
  for (let i = 0; i < list.length; i += 300) {
    const { data, error } = await db.from('program_news_optouts').select('email_norm').eq('opted_out', true).in('email_norm', list.slice(i, i + 300))
    if (error) {
      if (['42P01', 'PGRST205'].includes(error.code) || /does not exist|schema cache/i.test(error.message || '')) return out
      throw error
    }
    for (const r of data || []) out.add(r.email_norm)
  }
  return out
}

async function loadStudents(db, rule) {
  const rows = []
  for (const cohortId of rule.cohortIds) {
    const { data, error } = await db.from('students').select(STUDENT_COLS).eq('cohort_id', cohortId).order('last_name').order('first_name')
    if (error) throw error
    rows.push(...(data || []))
  }
  return shapeStudents(rows, rule)
}

async function loadAlumni(db, rule, deps) {
  const payload = await deps.loadApplicantsPayload(db, rule.cycleId)
  if (payload.state === 'cycle_not_found') throw Object.assign(new Error('That residency cohort is not here.'), { status: 404 })
  if (payload.state !== 'ok') throw Object.assign(new Error('The residency roster could not be read.'), { status: payload.state === 'unprovisioned' ? 409 : 500 })
  const ids = (payload.students || []).map(s => s.id)
  const emails = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('students').select('id, personal_email').in('id', ids.slice(i, i + 200))
    if (error) throw error
    for (const s of data || []) emails.set(s.id, s)
  }
  const revisions = await deps.fetchLatestRevisions(db, (payload.candidates || []).filter(c => c.assignment_id))
  if (revisions.error) throw revisions.error
  const preferred = new Map()
  for (const [assignmentId, rev] of revisions.byAssignment || []) {
    if (rev?.identity?.preferred_email) preferred.set(assignmentId, rev.identity.preferred_email)
  }
  return shapeAlumni(payload, rule, { emails, preferred })
}

async function loadContacts(db, rule) {
  const { data, error } = await db.from('contacts').select(CONTACT_COLS).eq('is_active', true).order('full_name')
  if (error) throw error
  return shapeContacts(data || [], rule)
}

/**
 * Resolve a rule to { recipients, excluded }. `db` must already be the request's population.
 * `deps` carries the residency loaders (injected so this file does not load the residency stack
 * for a student or contact rule, and so a test can substitute them).
 */
export async function resolveAudience(db, rawRule, deps = {}) {
  const rule = sanitizeRule(rawRule)
  let found
  if (rule.population === 'students') {
    if (!rule.cohortIds.length) throw Object.assign(new Error('Choose at least one ASPIRE cohort.'), { status: 400 })
    found = await loadStudents(db, rule)
  } else if (rule.population === 'alumni') {
    if (!rule.cycleId) throw Object.assign(new Error('Choose a residency cohort.'), { status: 400 })
    const loaders = deps.loadApplicantsPayload ? deps : {
      loadApplicantsPayload: (await import('../ngrpApplicants.js')).loadApplicantsPayload,
      fetchLatestRevisions: (await import('../ngrpResidencyExport.js')).fetchLatestRevisions,
    }
    found = await loadAlumni(db, rule, loaders)
  } else {
    found = await loadContacts(db, rule)
  }
  const optedOut = await loadOptedOut(db, found.people.map(p => p.email))
  return { rule, ...finishAudience(found, { optedOut }) }
}
