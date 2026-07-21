// api/lib/unitLeaderScope.js
//
// UL-PORTAL: the SINGLE server-side source of truth for whether an active Unit
// Leader may access a student.
//
// The visibility RULES live in api/lib/unitLeaderScopeRules.js, which is
// dependency free and directly unit tested. This module supplies only the IO:
// caller verification and the authorized queries.
//
// Every Unit Leader endpoint authorizes through here. Client-side filtering is
// never an authorization control: a caller supplies at most a unit key to NARROW
// an already-authorized set, never to widen it.
//
// Authorization chain, fail closed at every link:
//   1. verified JWT                          -> user_profiles row (active only)
//   2. ACTIVE user_role_grants 'unit_leader'  -> otherwise 403
//   3. ACTIVE user_unit_scopes rows           -> the authorized unit_key set
//   4. student -> unit via students.matched_unit_id -> units.unit_name
//   5. lifecycle bucket, with the 90-day completed window
//
// Deactivation, grant revocation, and scope revocation all take effect on the very
// next request, because every link is re-read from authoritative rows each time.
//
// UNIT IDENTITY: the canonical unit NAME string, matching user_unit_scopes.unit_key.
// Established by 20260712000007: the units table is per cohort, so unit_name is the
// stable identity. The link is students.matched_unit_id -> units.id -> units.unit_name.
// students.unit is a legacy column that no writer ever populates and is never used
// here for authorization.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveUnitScopes } from './portalAuth.js'
import {
  UL_STUDENT_COLUMNS,
  ROSTER_STATUSES,
  narrowScopes,
  scopeCoversCohort,
  lifecycleBucket,
} from './unitLeaderScopeRules.js'

export { getServiceDb }
export {
  COMPLETED_VISIBILITY_DAYS,
  ROSTER_STATUSES,
  UL_STUDENT_COLUMNS,
  narrowScopes,
  completedStillVisible,
  lifecycleBucket,
  onboardingSummary,
} from './unitLeaderScopeRules.js'

/**
 * Verify the caller is an ACTIVE Unit Leader and resolve their authorized scopes.
 * Returns { ok: true, db, profile, scopes, unitKeys } or { ok: false, status, reason }.
 *
 * An empty scope set is NOT an error: it is a Unit Leader with no assignment, who
 * legitimately sees nothing. Callers must treat unitKeys.length === 0 as an empty
 * authorized set and never as "unrestricted".
 */
export async function verifyPortalUnitLeaderCaller(req) {
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' }
  }

  let db
  try { db = getServiceDb() } catch { return { ok: false, status: 500, reason: 'server_misconfigured' } }

  let isUnitLeader
  try {
    isUnitLeader = await hasActiveRoleGrant(db, caller.profile.id, 'unit_leader')
  } catch {
    return { ok: false, status: 500, reason: 'grant_lookup_failed' }
  }
  if (!isUnitLeader) return { ok: false, status: 403, reason: 'unit_leader_role_required' }

  let scopes
  try {
    scopes = await getActiveUnitScopes(db, caller.profile.id)
  } catch {
    return { ok: false, status: 500, reason: 'scope_lookup_failed' }
  }

  return {
    ok: true,
    db,
    profile: caller.profile,
    scopes,
    unitKeys: [...new Set(scopes.map(s => s.unit_key))],
  }
}

/**
 * THE authorization query. Resolves every student the given scopes authorize.
 *
 * Scoping runs server side against students.matched_unit_id joined to
 * units.unit_name, restricted to the active scope's unit keys and cohort rules,
 * then filtered to visible lifecycle buckets.
 *
 * Returns { students: [{ ...cols, unit_key, bucket }], unitKeys } or throws.
 */
export async function resolveUnitScopedStudents(db, scopes, { unitKey = null, now = new Date() } = {}) {
  const effective = narrowScopes(scopes, unitKey)
  if (effective === null || effective.length === 0) return { students: [], unitKeys: [] }

  const unitKeys = [...new Set(effective.map(s => s.unit_key))]

  // Resolve the authorized unit rows first. A unit_key that matches no units row
  // simply yields nothing, which is the correct fail-closed outcome.
  const { data: unitRows, error: uErr } = await db
    .from('units')
    .select('id, unit_name, cohort_id')
    .in('unit_name', unitKeys)
  if (uErr) throw new Error('unit_lookup_failed')

  // Keep only unit rows whose cohort the scope actually covers.
  const allowedUnits = (unitRows || []).filter(u =>
    effective.some(s => s.unit_key === u.unit_name && scopeCoversCohort(s, u.cohort_id)))
  if (allowedUnits.length === 0) return { students: [], unitKeys }

  const unitNameById = new Map(allowedUnits.map(u => [u.id, u.unit_name]))

  const { data: students, error: sErr } = await db
    .from('students')
    .select(UL_STUDENT_COLUMNS)
    .in('matched_unit_id', [...unitNameById.keys()])
    .in('status', ROSTER_STATUSES)
  if (sErr) throw new Error('student_lookup_failed')

  const visible = []
  for (const s of students || []) {
    const key = unitNameById.get(s.matched_unit_id)
    if (!key) continue
    const bucket = lifecycleBucket(s, now)
    if (!bucket) continue
    visible.push({ ...s, unit_key: key, bucket })
  }
  return { students: visible, unitKeys }
}

/**
 * Fail-closed single-student authorization.
 * Returns { allowed: true, student, unitKey, bucket } or { allowed: false }.
 * Never leaks whether the student exists: an out-of-scope student and a missing
 * student are indistinguishable to the caller.
 */
export async function authorizeStudentForUnitLeader(db, scopes, studentId, { now = new Date() } = {}) {
  if (!studentId || typeof studentId !== 'string') return { allowed: false }
  const { students } = await resolveUnitScopedStudents(db, scopes, { now })
  const match = students.find(s => s.id === studentId)
  if (!match) return { allowed: false }
  return { allowed: true, student: match, unitKey: match.unit_key, bucket: match.bucket }
}
