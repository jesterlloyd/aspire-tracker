// api/lib/schoolScope.js
//
// AP-PORTAL: the single source of truth for Academic Partner school-scope authorization, shared by
// the roster endpoint (api/portal/school-students.js) and the school-scoped photo endpoint
// (api/portal/school-student-file-access.js). Keeping ONE implementation means a photo can never be
// authorized on a different rule than the roster it appears in.
//
// The model mirrors the Unit Leader side (verifyPortalUnitLeaderCaller + resolveUnitScopedStudents):
// a verified JWT, an ACTIVE academic_partner role grant, and ACTIVE user_school_scopes. School scope
// is ALWAYS derived server-side from user_school_scopes; no request parameter is ever accepted as
// authorization input. Matching is alias-aware but uses EXACT normalized term membership (never a
// substring), so the WCU campuses (Anaheim vs North Hollywood) cannot cross.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant } from './portalAuth.js'
import { resolveSchoolAliases } from './schoolAliases.js'

const norm = (s) => String(s || '').toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim()

// Verify the caller and load their ACTIVE academic_partner school scopes. Fails closed: an
// unauthenticated caller is 401, a non-partner is 403. An empty scope array is a valid "sees
// nothing" result, not an error.
export async function verifyPortalAcademicPartnerCaller(req) {
  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    return { ok: false, status: auth.status === 403 ? 403 : 401, reason: auth.status === 403 ? 'forbidden' : 'unauthorized' }
  }
  let db
  try { db = getServiceDb() } catch { return { ok: false, status: 500, reason: 'internal_error' } }

  const isPartner = await hasActiveRoleGrant(db, auth.profile.id, 'academic_partner')
  if (!isPartner) return { ok: false, status: 403, reason: 'forbidden' }

  const { data: scopeRows, error } = await db
    .from('user_school_scopes')
    .select('school_key, cohort_id, starts_at, expires_at, revoked_at')
    .eq('user_profile_id', auth.profile.id)
  if (error) return { ok: false, status: 500, reason: 'internal_error' }

  const now = new Date()
  const scopes = (scopeRows || []).filter(r =>
    r.revoked_at === null &&
    new Date(r.starts_at) <= now &&
    (r.expires_at == null || new Date(r.expires_at) > now)
  )
  return { ok: true, db, profile: auth.profile, scopes }
}

// Alias-aware, cohort-aware normalized term sets for a set of active scopes.
export function schoolScopeTerms(scopes) {
  return (scopes || []).map(s => ({
    school_key: s.school_key,
    cohort_id: s.cohort_id,
    terms: new Set([...resolveSchoolAliases(s.school_key), norm(s.school_key)]),
  }))
}

// Is the (school, cohortId) pair within these active scopes? EXACT normalized-term membership
// (never substring, so WCU campuses stay isolated), cohort-aware (a cohort-scoped grant matches only
// that cohort; a null-cohort grant matches any). Used to authorize an authenticated placement
// submission: the caller may submit ONLY for a school+cohort they are actually scoped to, and the
// school is validated here rather than trusted from the browser.
export function matchSchoolCohortScope(scopes, school, cohortId) {
  const n = norm(school)
  return schoolScopeTerms(scopes).some(t => t.terms.has(n) && (t.cohort_id === null || t.cohort_id === cohortId))
}

// The authorized students for these scopes, selecting `columns`. Uses EXACT normalized term
// membership (never substring), so a campus scope resolves only to its own students; a cohort-scoped
// row is honored. Returns { scopeTerms, matches: [{ student, school_key }] }.
export async function resolveSchoolScopedStudents(db, scopes, columns) {
  const scopeTerms = schoolScopeTerms(scopes)
  if (scopeTerms.length === 0) return { scopeTerms, matches: [] }

  const { data: students, error } = await db
    .from('students')
    .select(columns)
    .not('school', 'is', null)
  if (error) throw new Error('students_query_failed')

  const matches = []
  for (const s of students || []) {
    const n = norm(s.school)
    const scope = scopeTerms.find(t =>
      t.terms.has(n) && (t.cohort_id === null || t.cohort_id === s.cohort_id)
    )
    if (scope) matches.push({ student: s, school_key: scope.school_key })
  }
  return { scopeTerms, matches }
}

// The canonical cohorts available to each authorized school, INDEPENDENT of whether the cohort has
// any student rows yet. This is the fix for the roster-only inference that hid open-but-empty cohorts
// (e.g. a Planning + Accepting Fall cohort) from the portal while the main app showed them.
//
// Source of truth = the cohorts table (same as the main app's picker), scoped per school:
//   - an UNRESTRICTED scope for a school (a user_school_scopes row with cohort_id NULL) sees the
//     union of: cohorts its students are in, cohorts the school participates in via
//     cohort_school_rotations (matched by EXACT normalized school name, so WCU campuses stay
//     isolated), and any cohort currently accepting_submissions (a valid submission target).
//   - a COHORT-RESTRICTED scope (specific cohort_id) sees only that cohort.
// Returns Map(school_key -> cohort[]), each cohort { id, name, status, start_date, end_date,
// accepting_submissions }, ordered newest-first (created_at desc), matching the main app.
export async function resolveSchoolScopedCohorts(db, scopes, matches) {
  const scopeTerms = schoolScopeTerms(scopes)
  if (scopeTerms.length === 0) return new Map()

  // Per school_key: union of alias terms; unrestricted if any scope row is cohort_id NULL, else the
  // set of specific cohort ids.
  const perSchool = new Map()
  for (const t of scopeTerms) {
    const cur = perSchool.get(t.school_key) || { terms: new Set(), unrestricted: false, cohortIds: new Set() }
    for (const term of t.terms) cur.terms.add(term)
    if (t.cohort_id === null || t.cohort_id === undefined) cur.unrestricted = true
    else cur.cohortIds.add(t.cohort_id)
    perSchool.set(t.school_key, cur)
  }

  const { data: allCohorts, error } = await db
    .from('cohorts')
    .select('id, name, status, start_date, end_date, accepting_submissions, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error('cohorts_query_failed')
  const cohorts = allCohorts || []
  const acceptingIds = cohorts.filter(c => c.accepting_submissions).map(c => c.id)

  const { data: rotations } = await db.from('cohort_school_rotations').select('cohort_id, school_name')

  const studentCohortsBySchool = new Map()
  for (const { student, school_key } of matches || []) {
    if (student?.cohort_id) {
      const set = studentCohortsBySchool.get(school_key) || new Set()
      set.add(student.cohort_id)
      studentCohortsBySchool.set(school_key, set)
    }
  }

  const result = new Map()
  for (const [school_key, info] of perSchool) {
    const ids = new Set()
    if (info.unrestricted) {
      for (const id of (studentCohortsBySchool.get(school_key) || [])) ids.add(id)
      for (const r of rotations || []) {
        if (r.cohort_id && info.terms.has(norm(r.school_name))) ids.add(r.cohort_id)
      }
      for (const id of acceptingIds) ids.add(id)
    } else {
      for (const id of info.cohortIds) ids.add(id)
    }
    // Preserve the canonical newest-first order.
    result.set(school_key, cohorts.filter(c => ids.has(c.id))
      .map(c => ({ id: c.id, name: c.name, status: c.status, start_date: c.start_date, end_date: c.end_date, accepting_submissions: c.accepting_submissions })))
  }
  return result
}
