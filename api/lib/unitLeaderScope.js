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
//   4. student -> unit via LIVE student_unit_assignments rows
//      (status planned/active, same cohort). MULTI-UNIT-STUDENT-PLACEMENTS-2:
//      this replaced the single students.matched_unit_id join, so a student
//      rotating in two units is visible to BOTH units' leaders. Only LIVE
//      assignments authorize: ended and removed rows are never queried, so a
//      historical assignment can never grant access - Emi's ended 6 NE row
//      makes her visible to no 6 NE leader today.
//   5. lifecycle bucket, with the 90-day completed window
//
// Deactivation, grant revocation, and scope revocation all take effect on the very
// next request, because every link is re-read from authoritative rows each time.
//
// UNIT IDENTITY: the canonical unit NAME string, matching user_unit_scopes.unit_key.
// Established by 20260712000007: the units table is per cohort, so unit_name is the
// stable identity. student_unit_assignments.unit_key carries that same identity
// directly (snapshotted and trigger-verified against units.unit_name), so the
// roster no longer joins through the deletable units row at all.
// students.unit is a legacy column that no writer ever populates and is never used
// here for authorization.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveUnitScopes, isOwnerAdminProfile } from './portalAuth.js'
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

  // Owner/Admin preview is organization-wide but still server-derived. The
  // browser receives the same unit-safe payload as a Unit Leader and can only
  // narrow this list. No portal role grant or temporary account is created.
  if (isOwnerAdminProfile(caller.profile)) {
    const { data, error } = await db.from('units').select('unit_name').not('unit_name', 'is', null)
    if (error) return { ok: false, status: 500, reason: 'scope_lookup_failed' }
    const unitKeys = [...new Set((data || []).map(row => String(row.unit_name || '').trim()).filter(Boolean))].sort()
    const scopes = unitKeys.map(unit_key => ({ unit_key, cohort_id: null }))
    return { ok: true, db, profile: caller.profile, scopes, unitKeys, staffPreview: true }
  }

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

/** Assignment statuses that AUTHORIZE roster access. Historical rows never do. */
export const LIVE_ASSIGNMENT_STATUSES = Object.freeze(['planned', 'active'])

/**
 * THE authorization query. Resolves every student the given scopes authorize.
 *
 * Scoping runs server side against LIVE student_unit_assignments rows
 * (status planned/active), restricted to the active scope's unit keys and each
 * assignment's own cohort, then filtered to visible lifecycle buckets.
 *
 * A student with live assignments in two scoped units appears ONCE PER UNIT -
 * one entry per (student, unit_key) - with the primary assignment first, so a
 * single-unit consumer that takes the first entry gets the primary context.
 *
 * Returns { students: [{ ...cols, unit_key, bucket }], unitKeys } or throws.
 */
export async function resolveUnitScopedStudents(db, scopes, { unitKey = null, now = new Date() } = {}) {
  const effective = narrowScopes(scopes, unitKey)
  if (effective === null || effective.length === 0) return { students: [], unitKeys: [] }

  const unitKeys = [...new Set(effective.map(s => s.unit_key))]

  // LIVE assignments only. Ended/removed rows are excluded in the query itself,
  // so a historical assignment is never even considered for access.
  const { data: assignmentRows, error: aErr } = await db
    .from('student_unit_assignments')
    .select('student_id, cohort_id, unit_key, role, status')
    .in('unit_key', unitKeys)
    .in('status', LIVE_ASSIGNMENT_STATUSES)
  if (aErr) throw new Error('assignment_lookup_failed')

  // Keep only assignments whose OWN cohort the scope actually covers (the
  // foundation guarantees assignment cohort = student cohort).
  const authorized = (assignmentRows || []).filter(a =>
    effective.some(s => s.unit_key === a.unit_key && scopeCoversCohort(s, a.cohort_id)))
  if (authorized.length === 0) return { students: [], unitKeys }

  const studentIds = [...new Set(authorized.map(a => a.student_id))]
  const { data: students, error: sErr } = await db
    .from('students')
    .select(UL_STUDENT_COLUMNS)
    .in('id', studentIds)
    .in('status', ROSTER_STATUSES)
  if (sErr) throw new Error('student_lookup_failed')

  const studentById = new Map((students || []).map(s => [s.id, s]))

  // One entry per (student, unit_key), primary before additional so first-entry
  // consumers keep the primary context; dedupe defensively on the pair.
  const ordered = [...authorized].sort((a, b) =>
    (a.role === 'primary' ? 0 : 1) - (b.role === 'primary' ? 0 : 1))
  const seen = new Set()
  const visible = []
  for (const a of ordered) {
    const s = studentById.get(a.student_id)
    if (!s) continue
    const pair = `${a.student_id}:${a.unit_key}`
    if (seen.has(pair)) continue
    seen.add(pair)
    const bucket = lifecycleBucket(s, now)
    if (!bucket) continue
    visible.push({ ...s, unit_key: a.unit_key, bucket })
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
