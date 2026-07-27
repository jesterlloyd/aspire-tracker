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
