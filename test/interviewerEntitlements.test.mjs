// WAVE F-2 (interviewer file access): entitlement table, scheduling identity,
// server authorization (including Viewer photo access), management API, and staff-UI
// guards. A pure unit test covers the entitlement resolver; the rest are static-source
// guards in the repository's style (no live database).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { activeEntitledCohortIds } from '../lib/server/interviewerEntitlements.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260719000000_interviewer_cohort_entitlements.sql')
const backfill  = read('supabase/migrations/20260719000001_interviewer_cohort_entitlements_backfill.sql')
const access    = read('api/student-file-access.js')
const manage    = read('api/interviewer-entitlements.js')
const mine      = read('api/my-interviewer-cohorts.js')
const availability = read('api/availability.js')
const modal     = read('src/components/AvailabilityManagerModal.jsx')
const auth      = read('src/contexts/AuthContext.jsx')
const sidePanel = read('src/components/StudentSidePanel.jsx')
const rubric    = read('src/components/RubricSession.jsx')

// ── Pure resolver ────────────────────────────────────────────────────────────
test('activeEntitledCohortIds returns a deduped set and fails closed on error', async () => {
  const rows = [{ cohort_id: 'c1' }, { cohort_id: 'c2' }, { cohort_id: 'c1' }, { cohort_id: null }]
  const dbOk = { from: () => dbOk, select: () => dbOk, eq: () => dbOk, is: () => Promise.resolve({ data: rows, error: null }) }
  assert.deepEqual([...(await activeEntitledCohortIds(dbOk, 'p1'))].sort(), ['c1', 'c2'])
  const dbErr = { from: () => dbErr, select: () => dbErr, eq: () => dbErr, is: () => Promise.resolve({ data: null, error: { message: 'x' } }) }
  await assert.rejects(() => activeEntitledCohortIds(dbErr, 'p1'))
})

// ── Migration (schema + scheduling identity, NO backfill) ────────────────────
test('migration: entitlement table shape, identity FKs, audit fields, non-null actor', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.interviewer_cohort_entitlements/)
  assert.match(migration, /interviewer_profile_id uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\)/)
  assert.match(migration, /cohort_id\s+uuid\s+NOT NULL REFERENCES public\.cohorts\(id\)/)
  assert.match(migration, /granted_by_profile_id\s+uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\)/)
  assert.match(migration, /revoked_at\s+timestamptz/)
  assert.match(migration, /revoked_by_profile_id\s+uuid\s+REFERENCES public\.user_profiles\(id\)/)
  assert.doesNotMatch(migration, /REFERENCES\s+auth\.users/)
})

test('migration: one active entitlement per (interviewer, cohort), server-mediated RLS', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_ice_active[\s\S]*?\(interviewer_profile_id, cohort_id\)[\s\S]*?WHERE revoked_at IS NULL/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.interviewer_cohort_entitlements FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.interviewer_cohort_entitlements TO service_role/)
  assert.doesNotMatch(migration, /CREATE POLICY/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO authenticated/)
})

test('migration: scheduling identity column (operational, not authorization); no backfill here', () => {
  assert.match(migration, /ALTER TABLE public\.interview_availability_blocks[\s\S]*?ADD COLUMN IF NOT EXISTS interviewer_profile_id uuid[\s\S]*?REFERENCES public\.user_profiles\(id\)/)
  // The initial backfill is a SEPARATE file, not in this migration.
  assert.doesNotMatch(migration, /INSERT INTO public\.interviewer_cohort_entitlements/)
})

// ── Separate backfill (explicit actor, no exactly-one-Owner rule) ────────────
test('backfill: read-only owner/admin listing, explicit validated actor, one-cohort guard', () => {
  // STEP 1 lists Owner/Admin profiles for the human to choose from.
  assert.match(backfill, /FROM public\.user_profiles\s*\n\s*WHERE role IN \('owner', 'admin'\)/)
  // The actor is an explicit id the human sets, validated as an active Owner/Admin.
  assert.match(backfill, /v_actor\s+uuid := '00000000-0000-0000-0000-000000000000'/)
  assert.match(backfill, /id = v_actor AND role IN \('owner', 'admin'\)[\s\S]*?RAISE EXCEPTION/)
  // Exactly-one-active-cohort guard remains (do not guess); exactly-one-OWNER rule is gone.
  assert.match(backfill, /IF n_cohorts <> 1 THEN[\s\S]*?RAISE EXCEPTION/)
  assert.doesNotMatch(backfill, /IF n_owners <> 1/)
  // Only active interviewers, idempotent; no name/email inference of the actor.
  assert.match(backfill, /p\.role = 'interviewer'[\s\S]*?COALESCE\(p\.is_active, true\) = true/)
  assert.doesNotMatch(backfill, /ilike|\.email\b/)
})

// ── File-access authorization (Owner/Admin, Viewer photo, Interviewer, deny) ──
test('file access: Owner/Admin both; Viewer headshot only; Interviewer entitled; others 403', () => {
  assert.match(access, /verifyPortalCaller\(req\)/)
  assert.match(access, /const isViewer = role === 'viewer'/)
  assert.match(access, /if \(!isOwnerAdmin && !isViewer && !isInterviewer\) \{[\s\S]*?staff_role_required/)
  // Viewer role kinds = headshot only (no resume).
  assert.match(access, /isViewer\s*\n?\s*\?\s*new Set\(\['headshot'\]\)/)
  // Per-item kind gate + cohort gate (interviewer entitled; owner/admin/viewer unrestricted).
  assert.match(access, /if \(!roleKinds\.has\(n\.kind\)\) return nullResult/)
  assert.match(access, /const cohortOk = isOwnerAdmin \|\| isViewer \|\| entitledCohorts\.has\(row\.cohort_id\)/)
  assert.match(access, /activeEntitledCohortIds\(supabaseAdmin, caller\.profile\.id\)/)
  // Identity only; a denied item is a null url, never an error.
  assert.doesNotMatch(access, /interviewer_name|interview_assigned|\.email/)
  assert.match(access, /signed_url: null/)
})

test('file access: a Viewer requesting a resume gets nothing (headshot-only role kinds)', () => {
  // roleKinds for viewer excludes resume, so the per-item kind gate nulls a resume.
  assert.match(access, /const roleKinds = isOwnerAdmin[\s\S]*?isViewer[\s\S]*?new Set\(\['headshot'\]\)/)
})

// ── Management API (no restore; history immutable) ───────────────────────────
test('management API: active Owner/Admin only; grant/revoke; no restore; audited', () => {
  assert.match(manage, /verifyStaffCaller\(req\)/)
  assert.match(manage, /const ACTIONS = new Set\(\['list', 'grant', 'revoke'\]\)/)
  assert.doesNotMatch(manage, /'restore'/)
  assert.match(manage, /const actorId = caller\.profile\.id/)
  assert.match(manage, /target_not_interviewer/)
  // Revoke timestamps the current active row with the acting id; a re-grant inserts a NEW row.
  assert.match(manage, /revoked_at: new Date\(\)\.toISOString\(\)[\s\S]*?revoked_by_profile_id: actorId/)
  assert.match(manage, /\.insert\(\{ interviewer_profile_id: interviewerProfileId, cohort_id: cohortId, granted_by_profile_id: actorId \}\)/)
  assert.match(manage, /idempotent: true/)
})

test('my-interviewer-cohorts: own-only, GET, non-interviewer empty', () => {
  assert.match(mine, /req\.method !== 'GET'/)
  assert.match(mine, /verifyPortalCaller\(req\)/)
  assert.match(mine, /!== 'interviewer'\) \{[\s\S]*?cohort_ids: \[\]/)
})

// ── Identity-backed scheduling + auto-entitlement ────────────────────────────
test('scheduling: create_block selects an interviewer account and auto-ensures entitlement', () => {
  // Identity-backed selection, name derived for presentation only.
  assert.match(availability, /const interviewerProfileId = adminLevel[\s\S]*?body\.interviewer_profile_id[\s\S]*?auth\.profileId/)
  assert.match(availability, /\.eq\('id', interviewerProfileId\)/)
  assert.match(availability, /interviewer_profile_id: interviewerProfileId/)
  // Auto-ensure an active entitlement when the assignee is an interviewer (idempotent).
  assert.match(availability, /role \|\| ''\)\.toLowerCase\(\) === 'interviewer'/)
  assert.match(availability, /\.insert\(\{ interviewer_profile_id: interviewerProfileId, cohort_id, granted_by_profile_id: auth\.profileId \}\)/)
  // The modal sends an account id, not a free-text name.
  assert.match(modal, /interviewer_profile_id: interviewerProfileId/)
  assert.match(modal, /<option key=\{i\.id\} value=\{i\.id\}>/)
})

// ── Staff UI ─────────────────────────────────────────────────────────────────
test('AuthContext: split resume/photo cohort-view checks (Viewer photo included)', () => {
  assert.match(auth, /canViewStudentResumeInCohort: \(cohortId\) =>/)
  assert.match(auth, /canViewStudentPhotoInCohort: \(cohortId\) =>/)
  // Photo view includes an active Viewer; resume view does not.
  assert.match(auth, /canViewStudentPhotoInCohort: \(cohortId\) =>\s*\n\s*\(userProfile\?\.is_active !== false && \['owner', 'admin', 'viewer'\]/)
  assert.match(auth, /canViewStudentResumeInCohort: \(cohortId\) =>\s*\n\s*\(userProfile\?\.is_active !== false && \['owner', 'admin'\]/)
})

test('StudentSidePanel: resume by canViewResume, photo by canViewPhoto, badge message, no leak', () => {
  assert.match(sidePanel, /const canViewResume = canViewStudentResumeInCohort\(data\?\.cohort_id\)/)
  assert.match(sidePanel, /const canViewPhoto  = canViewStudentPhotoInCohort\(data\?\.cohort_id\)/)
  assert.match(sidePanel, /\(data\.resume_url && \(canViewResume \|\| canManageStudentFiles\)\) \?/)
  assert.match(sidePanel, /\(data\.headshot_url && \(canViewPhoto \|\| canManageStudentFiles\)\) \?/)
  assert.match(sidePanel, /Badge generation\/view restricted to Owner\/Admin\./)
  assert.match(sidePanel, /canGenerateBadge \? \([\s\S]*?\) : canViewPhoto \? \(/)
})

test('RubricSession: resume gated by cohort resume-view, opens via the endpoint', () => {
  assert.match(rubric, /canViewStudentResumeInCohort\(cohortId\) && student\.resume_url && \(/)
  assert.match(rubric, /openStudentFile\(\{ studentId: student\.id, kind: 'resume' \}\)/)
  assert.doesNotMatch(rubric, /href=\{student\.resume_url\}/)
})

// ── Regression hygiene ───────────────────────────────────────────────────────
test('no service-role secret literal or em dash in the new server/migration files', () => {
  for (const src of [access, manage, mine, read('lib/server/interviewerEntitlements.js')]) {
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/)
    assert.doesNotMatch(src, /—/)
  }
  assert.doesNotMatch(migration, /—/)
  assert.doesNotMatch(backfill, /—/)
})
