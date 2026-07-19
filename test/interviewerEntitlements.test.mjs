// WAVE F-2 (interviewer file access): entitlement table, server authorization,
// management API, and staff-UI guards. A pure unit test covers the entitlement
// resolver; the rest are static-source guards in the repository's style (no live
// database), asserting the security-relevant shape of the migration and endpoints.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { activeEntitledCohortIds } from '../lib/server/interviewerEntitlements.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260719000000_interviewer_cohort_entitlements.sql')
const access    = read('api/student-file-access.js')
const manage    = read('api/interviewer-entitlements.js')
const mine      = read('api/my-interviewer-cohorts.js')
const auth      = read('src/contexts/AuthContext.jsx')
const sidePanel = read('src/components/StudentSidePanel.jsx')
const rubric    = read('src/components/RubricSession.jsx')

// ── Pure resolver ────────────────────────────────────────────────────────────
test('activeEntitledCohortIds returns a deduped set and fails closed on error', async () => {
  const rows = [{ cohort_id: 'c1' }, { cohort_id: 'c2' }, { cohort_id: 'c1' }, { cohort_id: null }]
  const dbOk = { from: () => dbOk, select: () => dbOk, eq: () => dbOk, is: () => Promise.resolve({ data: rows, error: null }) }
  const set = await activeEntitledCohortIds(dbOk, 'p1')
  assert.deepEqual([...set].sort(), ['c1', 'c2'])

  const dbEmpty = { from: () => dbEmpty, select: () => dbEmpty, eq: () => dbEmpty, is: () => Promise.resolve({ data: [], error: null }) }
  assert.equal((await activeEntitledCohortIds(dbEmpty, 'p1')).size, 0)

  const dbErr = { from: () => dbErr, select: () => dbErr, eq: () => dbErr, is: () => Promise.resolve({ data: null, error: { message: 'x' } }) }
  await assert.rejects(() => activeEntitledCohortIds(dbErr, 'p1'))
})

test('resolver filters by revoked_at IS NULL and keys on the interviewer profile id', () => {
  const src = read('lib/server/interviewerEntitlements.js')
  assert.match(src, /\.eq\('interviewer_profile_id', interviewerProfileId\)/)
  assert.match(src, /\.is\('revoked_at', null\)/)
  // No name/email column is used for authorization (comments may explain the rule).
  assert.doesNotMatch(src, /'(email|full_name|interviewer_name)'/)
})

// ── Migration ────────────────────────────────────────────────────────────────
test('migration: table shape, identity FKs, and audit fields', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.interviewer_cohort_entitlements/)
  assert.match(migration, /interviewer_profile_id uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\)/)
  assert.match(migration, /cohort_id\s+uuid\s+NOT NULL REFERENCES public\.cohorts\(id\)/)
  assert.match(migration, /granted_by_profile_id\s+uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\)/)
  assert.match(migration, /granted_at\s+timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(migration, /revoked_at\s+timestamptz/)
  assert.match(migration, /revoked_by_profile_id\s+uuid\s+REFERENCES public\.user_profiles\(id\)/)
  // Identity model: FKs use user_profiles.id; no FK references auth.users.
  assert.doesNotMatch(migration, /REFERENCES\s+auth\.users/)
})

test('migration: one active entitlement per (interviewer, cohort)', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_ice_active[\s\S]*?\(interviewer_profile_id, cohort_id\)[\s\S]*?WHERE revoked_at IS NULL/)
})

test('migration: RLS on, server-mediated only, no is_staff / anon / authenticated grant', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.interviewer_cohort_entitlements FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.interviewer_cohort_entitlements TO service_role/)
  // No policy at all (server-mediated), so no is_staff predicate and no browser grant.
  assert.doesNotMatch(migration, /CREATE POLICY/)
  assert.doesNotMatch(migration, /USING \([^)]*is_staff/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO authenticated/)
  // No storage / bucket work in this migration.
  assert.doesNotMatch(migration, /storage\.|updateBucket/i)
})

test('migration: guarded backfill refuses to guess', () => {
  // Exactly one active cohort by status, else abort.
  assert.match(migration, /status = 'Active'/)
  assert.match(migration, /IF n_cohorts <> 1 THEN[\s\S]*?RAISE EXCEPTION/)
  // Deterministic single active Owner as the actor, else abort (no invented actor).
  assert.match(migration, /is_owner = true[\s\S]*?COALESCE\(is_active, true\) = true/)
  assert.match(migration, /IF n_owners <> 1 THEN[\s\S]*?RAISE EXCEPTION/)
  // Only active interviewers, idempotent via NOT EXISTS.
  assert.match(migration, /p\.role = 'interviewer'[\s\S]*?COALESCE\(p\.is_active, true\) = true/)
  assert.match(migration, /NOT EXISTS \([\s\S]*?revoked_at IS NULL/)
  // No name/email/roster matching in the backfill.
  assert.doesNotMatch(migration, /interviewer_name|ilike|full_name|\.email/)
})

test('migration: documents that the prior proposal is superseded and unapplied', () => {
  assert.match(migration, /20260718000002_interviewer_assignment_identity\.sql/)
  assert.match(migration, /Supersedes|superseded/i)
  assert.match(migration, /APPLY MANUALLY/)
})

// ── File-access authorization ────────────────────────────────────────────────
test('file access: interviewer gated by active entitlement; owner/admin unchanged; viewer/others denied', () => {
  assert.match(access, /verifyPortalCaller\(req\)/)
  assert.match(access, /activeEntitledCohortIds\(supabaseAdmin, caller\.profile\.id\)/)
  // Owner/Admin have no cohort restriction; interviewer is gated per cohort.
  assert.match(access, /const cohortOk = isOwnerAdmin \|\| entitledCohorts\.has\(row\.cohort_id\)/)
  // Viewer and every other role keep the prior 403 (staff_role_required).
  assert.match(access, /if \(!isOwnerAdmin && !isInterviewer\) \{[\s\S]*?staff_role_required/)
  // No name/email/roster/free-text authorization; no browser-supplied cohort trust.
  assert.doesNotMatch(access, /interviewer_name|full_name|\.email|interview_assigned/)
  // A denied item yields a null url, never an error that leaks existence.
  assert.match(access, /signed_url: null/)
})

// ── Management API ───────────────────────────────────────────────────────────
test('management API: active Owner/Admin only, identity actor, safe validation', () => {
  assert.match(manage, /verifyStaffCaller\(req\)/)          // active owner/admin
  assert.match(manage, /const actorId = caller\.profile\.id/) // audit actor from JWT, never body
  assert.match(manage, /target_not_interviewer/)            // target must be interviewer
  assert.match(manage, /cohort_not_found|cohortExists/)      // cohort must exist
  // Idempotent grant/restore: an existing active row is returned as idempotent.
  assert.match(manage, /idempotent: true/)
  // Revoke records the acting owner/admin + timestamp.
  assert.match(manage, /revoked_at: new Date\(\)\.toISOString\(\)[\s\S]*?revoked_by_profile_id: actorId/)
  // No name/email/roster authorization.
  assert.doesNotMatch(manage, /interviewer_name|full_name|\.ilike/)
})

test('my-interviewer-cohorts: own-only, GET, non-interviewer empty', () => {
  assert.match(mine, /req\.method !== 'GET'/)
  assert.match(mine, /verifyPortalCaller\(req\)/)
  assert.match(mine, /!== 'interviewer'\) \{[\s\S]*?cohort_ids: \[\]/)
  assert.match(mine, /activeEntitledCohortIds\(getServiceDb\(\), caller\.profile\.id\)/)
})

// ── Staff UI ─────────────────────────────────────────────────────────────────
test('AuthContext: canViewStudentFilesInCohort covers owner/admin + entitled interviewer', () => {
  assert.match(auth, /interviewerCohortIds/)
  assert.match(auth, /canViewStudentFilesInCohort: \(cohortId\) =>/)
  assert.match(auth, /\/api\/my-interviewer-cohorts/)
  // Manage/badge stay Owner/Admin-only (unchanged).
  assert.match(auth, /canManageStudentFiles:\s*userProfile\?\.is_active !== false && \['owner', 'admin'\]/)
  assert.match(auth, /canGenerateBadge:\s*userProfile\?\.is_active !== false && \['owner', 'admin'\]/)
})

test('StudentSidePanel: entitled-interviewer view, no manage/badge, exact restriction text, no leak', () => {
  assert.match(sidePanel, /const canViewFiles = canViewStudentFilesInCohort\(data\?\.cohort_id\)/)
  // Resume View/Download shown on canViewFiles; upload/replace on canManageStudentFiles.
  assert.match(sidePanel, /\(data\.resume_url && \(canViewFiles \|\| canManageStudentFiles\)\) \?/)
  assert.match(sidePanel, /\{canViewFiles && \(/)
  // Exact badge restriction message for an entitled interviewer.
  assert.match(sidePanel, /Badge generation\/view restricted to Owner\/Admin\./)
  assert.match(sidePanel, /canGenerateBadge \? \([\s\S]*?\) : canViewFiles \? \(/)
  // Headshot area is also leak-safe (only renders when viewable or manageable).
  assert.match(sidePanel, /\(data\.headshot_url && \(canViewFiles \|\| canManageStudentFiles\)\) \?/)
})

test('RubricSession: resume gated by cohort entitlement, opens via the endpoint', () => {
  assert.match(rubric, /canViewStudentFilesInCohort\(cohortId\) && student\.resume_url/)
  assert.match(rubric, /openStudentFile\(\{ studentId: student\.id, kind: 'resume' \}\)/)
  assert.doesNotMatch(rubric, /href=\{student\.resume_url\}/)
})

// ── Regression hygiene ───────────────────────────────────────────────────────
test('no service-role secret or em dash in the new server files', () => {
  for (const src of [access, manage, mine, read('lib/server/interviewerEntitlements.js')]) {
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/)
    assert.doesNotMatch(src, /—/)
  }
  assert.doesNotMatch(migration, /—/)
})
