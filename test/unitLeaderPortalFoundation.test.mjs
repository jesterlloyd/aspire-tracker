// UL-PORTAL: guards for the Unit Leader authorization foundation.
//
// Two layers are covered:
//   1. the pure scope logic in api/lib/unitLeaderScope.js, exercised directly
//   2. the security-relevant shape of the committed migration and the corrected
//      roster endpoint, asserted against source
//
// The migration is not applied here, so DB-backed behavior is asserted through the
// SQL text and through the pure functions that implement the same rules.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  COMPLETED_VISIBILITY_DAYS,
  ROSTER_STATUSES,
  UL_STUDENT_COLUMNS,
  narrowScopes,
  completedStillVisible,
  lifecycleBucket,
  onboardingSummary,
} from '../api/lib/unitLeaderScopeRules.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260720000000_unit_leader_portal_foundation.sql')
const preflight = read('db/audit/unit_leader_portal_preflight_and_verification.sql')
const scope     = read('api/lib/unitLeaderScope.js')
const rules     = read('api/lib/unitLeaderScopeRules.js')
const roster    = read('api/portal/unit-roster.js')

// Executable body: the rollback block comment removed.
const migrationLive = migration.replace(/\/\*[\s\S]*?\*\//g, '')
// Executable STATEMENTS only: line comments removed too, so assertions about what
// the SQL does are never satisfied or broken by explanatory prose.
const migrationSql = migrationLive.replace(/^\s*--.*$/gm, '')
const NOW = new Date('2026-07-20T12:00:00Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()

// ── Scope narrowing: a request may narrow, never widen ───────────────────────
test('narrowScopes returns the full set when no unit is requested', () => {
  const scopes = [{ unit_key: 'A', cohort_id: null }, { unit_key: 'B', cohort_id: null }]
  assert.deepEqual(narrowScopes(scopes, null), scopes)
})

test('narrowScopes narrows to a single entitled unit', () => {
  const scopes = [{ unit_key: 'A', cohort_id: null }, { unit_key: 'B', cohort_id: null }]
  assert.deepEqual(narrowScopes(scopes, 'B'), [{ unit_key: 'B', cohort_id: null }])
})

test('narrowScopes returns null for an unentitled unit, never an unscoped set', () => {
  const scopes = [{ unit_key: 'A', cohort_id: null }]
  assert.equal(narrowScopes(scopes, 'C'), null)
  // A Unit Leader with no assignment cannot widen by asking for a unit.
  assert.equal(narrowScopes([], 'A'), null)
})

// ── The 90-day completed window, fail closed ─────────────────────────────────
test('completed student inside the 90-day window is visible', () => {
  assert.equal(completedStillVisible({ rotation_end_date: daysAgo(30) }, NOW), true)
  assert.equal(completedStillVisible({ rotation_end_date: daysAgo(89) }, NOW), true)
})

test('completed student past the 90-day window is not visible', () => {
  assert.equal(completedStillVisible({ rotation_end_date: daysAgo(91) }, NOW), false)
  assert.equal(completedStillVisible({ rotation_end_date: daysAgo(400) }, NOW), false)
})

test('completed student with NO usable date is never visible (fail closed)', () => {
  assert.equal(completedStillVisible({}, NOW), false)
  assert.equal(completedStillVisible({ rotation_end_date: null }, NOW), false)
  assert.equal(completedStillVisible({ rotation_end_date: '' }, NOW), false)
  // Free-text term_dates is never parsed as a fallback.
  assert.equal(completedStillVisible({ term_dates: 'Fall 2026' }, NOW), false)
  // An unparseable value fails closed rather than throwing or passing.
  assert.equal(completedStillVisible({ rotation_end_date: 'not a date' }, NOW), false)
})

test('rotation_completed_at takes precedence over rotation_end_date', () => {
  const s = { rotation_completed_at: daysAgo(10), rotation_end_date: daysAgo(400) }
  assert.equal(completedStillVisible(s, NOW), true)
})

test('the visibility window is exactly 90 days', () => {
  assert.equal(COMPLETED_VISIBILITY_DAYS, 90)
})

// ── Lifecycle buckets ────────────────────────────────────────────────────────
test('lifecycle buckets map the three unit-visible statuses', () => {
  assert.equal(lifecycleBucket({ status: 'Placed' }, NOW), 'upcoming')
  assert.equal(lifecycleBucket({ status: 'Active Rotation' }, NOW), 'active')
  assert.equal(lifecycleBucket({ status: 'Completed', rotation_end_date: daysAgo(5) }, NOW), 'completed')
})

test('an expired completed student has no bucket and is dropped', () => {
  assert.equal(lifecycleBucket({ status: 'Completed', rotation_end_date: daysAgo(120) }, NOW), null)
  assert.equal(lifecycleBucket({ status: 'Completed' }, NOW), null)
})

test('statuses outside unit oversight never produce a bucket', () => {
  for (const status of ['Pending Outreach', 'Form Sent', 'Form Received',
    'Interview Scheduled', 'Interviewed', 'Declined', 'Not Proceeding', '', null]) {
    assert.equal(lifecycleBucket({ status }, NOW), null, `${status} must not be visible`)
  }
})

test('the roster status set is exactly the three unit-visible statuses', () => {
  assert.deepEqual(ROSTER_STATUSES, ['Placed', 'Active Rotation', 'Completed'])
})

// ── Excluded data never enters the column allowlist ──────────────────────────
test('the student column allowlist excludes every prohibited field', () => {
  for (const forbidden of [
    'support_needed', 'learning_highlight', 'admin_notes', 'review_reason',
    'gpa_verified', 'bls_current', 'health_cleared', 'background_check',
    'interview_notes', 'rubric', 'survey',
  ]) {
    assert.ok(!UL_STUDENT_COLUMNS.includes(forbidden),
      `Unit Leader column allowlist must not include ${forbidden}`)
  }
})

test('the roster never selects the support note text, only a count', () => {
  assert.match(roster, /\.select\('student_id'\)/)
  assert.doesNotMatch(roster, /select\([^)]*support_needed/)
})

// ── Onboarding rollup: category and outstanding keys only ────────────────────
test('onboarding summary reports ready when every item is done', () => {
  const r = onboardingSummary({
    badge_created: true, cs_link_complete: true, student_form_privacy_ack_at: daysAgo(1),
  })
  assert.equal(r.state, 'ready')
  assert.deepEqual(r.outstanding, [])
})

test('onboarding summary reports not_started and in_progress correctly', () => {
  assert.equal(onboardingSummary({}).state, 'not_started')
  assert.equal(onboardingSummary({ badge_created: true }).state, 'in_progress')
})

test('onboarding summary exposes only general category keys, never documents', () => {
  const r = onboardingSummary({ badge_created: false, cs_link_complete: false })
  assert.deepEqual(r.outstanding, ['badge', 'access', 'acknowledgment'])
  for (const k of r.outstanding) {
    assert.ok(['badge', 'access', 'orientation', 'acknowledgment', 'other'].includes(k))
  }
})

test('clearance and health attributes are absent from the onboarding rollup', () => {
  assert.doesNotMatch(rules, /'gpa_verified'|'bls_current'|'health_cleared'|'background_check'/)
})

// ── The roster scope correction ──────────────────────────────────────────────
test('the roster scopes through matched_unit_id, never the legacy unit column', () => {
  assert.match(scope, /\.in\('matched_unit_id'/)
  // The dead legacy filter is gone.
  assert.doesNotMatch(roster, /\.in\('unit', unitKeys\)/)
  assert.doesNotMatch(scope, /\.in\('unit', /)
})

test('the roster authorizes through the single source of truth', () => {
  assert.match(roster, /verifyPortalUnitLeaderCaller/)
  assert.match(roster, /resolveUnitScopedStudents/)
  // It no longer open-codes the grant and scope lookups.
  assert.doesNotMatch(roster, /hasActiveRoleGrant\(/)
  assert.doesNotMatch(roster, /getActiveUnitScopes\(/)
})

test('an empty scope set yields an empty authorized set, never an unscoped query', () => {
  assert.match(roster, /scopes\.length === 0\) return res\.status\(200\)/)
  assert.match(scope, /if \(effective === null \|\| effective\.length === 0\) return \{ students: \[\], unitKeys: \[\] \}/)
})

test('single-student authorization does not leak existence', () => {
  assert.match(scope, /Never leaks whether the student exists/)
  assert.match(scope, /if \(!match\) return \{ allowed: false \}/)
})

// ── Migration: authorization model reuse ─────────────────────────────────────
test('the migration reuses user_unit_scopes and never writes to it', () => {
  assert.match(migration, /user_unit_scopes/)
  assert.doesNotMatch(migrationLive, /INSERT INTO public\.user_unit_scopes/i)
  assert.doesNotMatch(migrationLive, /UPDATE public\.user_unit_scopes/i)
  assert.doesNotMatch(migrationLive, /ALTER TABLE public\.user_unit_scopes/i)
  assert.doesNotMatch(migrationLive, /DROP TABLE[\s\S]{0,40}user_unit_scopes/i)
})

test('the migration creates no new authorization table', () => {
  // Authorization stays in user_unit_scopes + user_role_grants.
  assert.doesNotMatch(migrationLive, /CREATE TABLE[^;]*unit_leader_assignments/i)
  assert.doesNotMatch(migrationLive, /CREATE TABLE[^;]*user_unit_/i)
})

test('the migration never authorizes by name, email, title, or free text', () => {
  assert.doesNotMatch(migrationSql, /is_staff\(\)/)
  assert.doesNotMatch(migrationSql, /\bunit_leaders\b/)
  assert.doesNotMatch(migrationSql, /USING \([^)]*email/i)
})

// ── Migration: new tables are server mediated only ───────────────────────────
test('every new table has RLS enabled, anon revoked, and no client write policy', () => {
  assert.match(migrationLive, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migrationLive, /REVOKE ALL ON public\.%I FROM PUBLIC, anon, authenticated/)
  assert.match(migrationLive, /GRANT ALL PRIVILEGES ON public\.%I TO service_role/)
  // The only policy created is a SELECT policy for active Owner/Admin.
  assert.match(migrationLive, /FOR SELECT TO authenticated USING \(public\.is_active_owner_or_admin\(\)\)/)
  assert.doesNotMatch(migrationLive, /FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/)
  assert.doesNotMatch(migrationLive, /TO anon\b/)
})

test('the six MVP tables are all created', () => {
  for (const t of [
    'unit_placement_requests', 'unit_placement_request_events',
    'unit_capacity_submissions', 'unit_student_milestones',
    'unit_preceptor_nominations', 'unit_leader_notification_prefs',
  ]) {
    assert.match(migrationLive, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`), t)
  }
})

// ── Migration: ASPIRE retains final authority ────────────────────────────────
test('a Unit Leader response can never become an ASPIRE approval', () => {
  // Separate columns, separate CHECKs.
  assert.match(migrationLive, /unit_response\s+text\s+NOT NULL DEFAULT 'pending'/)
  assert.match(migrationLive, /aspire_status\s+text\s+NOT NULL DEFAULT 'open'/)
  assert.match(migrationLive, /chk_upr_unit_response CHECK \(unit_response IN \(\s*'pending', 'accepted', 'declined', 'changes_requested'\)\)/)
  assert.match(migrationLive, /chk_upr_aspire_status CHECK \(aspire_status IN \(\s*'open', 'confirmed', 'withdrawn', 'reassigned'\)\)/)
})

test('placement responses and milestones are attributed and timestamped', () => {
  assert.match(migrationLive, /chk_upr_response_attribution/)
  assert.match(migrationLive, /responded_by_profile_id IS NOT NULL AND responded_at IS NOT NULL/)
  assert.match(migrationLive, /confirmed_by_profile_id uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\)/)
})

test('capacity supersedes rather than overwrites, and carries ASPIRE review', () => {
  assert.match(migrationLive, /supersedes_id/)
  assert.match(migrationLive, /superseded_at/)
  assert.match(migrationLive, /uq_ucs_live[\s\S]{0,200}WHERE superseded_at IS NULL/)
  assert.match(migrationLive, /chk_ucs_review_status/)
})

test('milestones are correctable, never hard deleted', () => {
  assert.match(migrationLive, /corrected_by_profile_id/)
  assert.match(migrationLive, /chk_usm_correction_consistent/)
  assert.doesNotMatch(migrationLive, /DELETE FROM public\.unit_student_milestones/i)
})

test('a preceptor nomination cannot masquerade as an assignment', () => {
  assert.match(migrationLive, /CREATE TABLE IF NOT EXISTS public\.unit_preceptor_nominations/)
  // Nominations never write the authoritative assignment table.
  assert.doesNotMatch(migrationLive, /INSERT INTO public\.student_preceptor_assignments/i)
  assert.doesNotMatch(migrationLive, /UPDATE public\.student_preceptor_assignments/i)
})

// ── Migration: the 90-day backfill fails closed ──────────────────────────────
test('the backfill copies only non-sentinel rotation dates', () => {
  assert.match(migrationLive, /rotation_end_date <> DATE '1900-01-01'/)
  assert.match(migrationLive, /ADD COLUMN IF NOT EXISTS rotation_end_date date/)
  assert.match(migrationLive, /ADD COLUMN IF NOT EXISTS rotation_completed_at timestamptz/)
})

test('the migration never parses free-text dates', () => {
  assert.doesNotMatch(migrationSql, /term_dates/)
  assert.doesNotMatch(migrationSql, /cohorts\.start_date|cohorts\.end_date/)
})

// ── Migration: messages widening ─────────────────────────────────────────────
test('the participant index is widened to allow exactly two portal parties', () => {
  assert.match(migrationLive, /CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_participants_active\s*\n\s*ON public\.conversation_participants \(conversation_id, participant_profile_id\)\s*\n\s*WHERE removed_at IS NULL/)
  // And the cap is enforced, so the thread cannot grow without bound.
  assert.match(migrationLive, /IF v_active > 2 THEN/)
  assert.match(migrationLive, /CREATE CONSTRAINT TRIGGER trg_conversation_participant_limit/)
})

test('a unit_leader participant may name its student; other branches unchanged', () => {
  const chk = migrationLive.slice(
    migrationLive.indexOf('ADD CONSTRAINT chk_participant_role_scope'),
    migrationLive.indexOf('-- 7d.'))
  // The unit_leader branch no longer forces scope_student_id NULL.
  assert.match(chk, /participant_role = 'unit_leader'[\s\S]*?scope_unit_key IS NOT NULL/)
  const ulBranch = chk.slice(chk.indexOf("participant_role = 'unit_leader'"))
  const ulOnly = ulBranch.slice(0, ulBranch.indexOf('OR'))
  assert.doesNotMatch(ulOnly, /scope_student_id IS NULL/)
  // Student and academic_partner branches still constrain their scopes.
  assert.match(chk, /participant_role = 'student'[\s\S]*?scope_unit_key IS NULL/)
  assert.match(chk, /participant_role = 'academic_partner'[\s\S]*?scope_unit_key IS NULL/)
})

test('delivery event types are widened, not replaced', () => {
  const chk = migrationLive.slice(migrationLive.indexOf('ADD CONSTRAINT chk_mnd_event_type'))
  for (const v of ['new_conversation', 'portal_reply', 'staff_reply',
    'unit_leader_message', 'student_to_unit_leader_message']) {
    assert.ok(chk.includes(`'${v}'`), `event type ${v}`)
  }
})

// ── Migration: messages authorization functions ──────────────────────────────
test('unit leader READ requires an active grant and a live account, not a scope', () => {
  // History survives the end of an assignment, so read must NOT require a scope.
  const fn = migrationSql.slice(
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_read'),
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send'))
  assert.match(fn, /g\.role = 'unit_leader'/)
  assert.match(fn, /public\.message_profile_is_active\(p_profile_id\)/)
  assert.doesNotMatch(fn, /user_unit_scopes/)
  // The student branch is preserved verbatim in behavior.
  assert.match(fn, /g\.role = 'student'/)
  assert.match(fn, /user_student_links/)
})

test('unit leader SEND requires a current ACTIVE unit scope', () => {
  const fn = migrationSql.slice(
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.message_participant_can_send'),
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.my_message_conversation_ids'))
  assert.match(fn, /FROM public\.user_unit_scopes s/)
  assert.match(fn, /s\.unit_key = cp\.scope_unit_key/)
  assert.match(fn, /s\.revoked_at IS NULL/)
  assert.match(fn, /s\.expires_at IS NULL OR s\.expires_at > now\(\)/)
})

test('AUTHORIZATION is never derived from a related_ context column', () => {
  // related_student_id is legitimately WRITTEN as staff context metadata by
  // messages_start_conversation (unchanged Phase 3 behavior). What must never
  // happen is a gate reading it. Assert on the authorization predicates only.
  for (const fnName of [
    'message_participant_can_read',
    'message_participant_can_send',
    'my_message_conversation_ids',
    'message_recipient_has_active_access',
  ]) {
    const start = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}`)
    assert.ok(start > -1, fnName)
    const body = migrationSql.slice(start, migrationSql.indexOf('$$;', start))
    assert.doesNotMatch(
      body,
      /related_student_id|related_unit_key|related_school_key|related_cohort_id|assigned_staff_profile_id/,
      `${fnName} must not authorize from a related_ context column`)
  }
})

test('portal unread now counts messages from anyone other than the caller', () => {
  assert.match(migrationLive, /m\.author_profile_id <> public\.portal_profile_id\(\)/)
  const fn = migrationLive.slice(migrationLive.indexOf('CREATE OR REPLACE FUNCTION public.messages_portal_unread_count'))
  assert.doesNotMatch(fn.slice(0, fn.indexOf('COMMIT')), /author_role = 'staff'/)
})

test('replaced functions stay SECURITY DEFINER with a pinned search_path', () => {
  const count = (migrationLive.match(/SECURITY DEFINER/g) || []).length
  assert.ok(count >= 4, `expected at least 4 SECURITY DEFINER functions, saw ${count}`)
  const paths = (migrationLive.match(/SET search_path = public, pg_catalog/g) || []).length
  assert.ok(paths >= 4, `expected pinned search_path on each, saw ${paths}`)
})

// ── Migration hygiene ────────────────────────────────────────────────────────
test('the migration is transactional and ships a reviewed rollback', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/)
  assert.match(migration, /── Rollback ─/)
  // The rollback restores the Phase 1 single-participant index.
  assert.match(migration, /CREATE UNIQUE INDEX uq_conversation_participants_active\s*\n\s*ON public\.conversation_participants \(conversation_id\) WHERE removed_at IS NULL/)
})

test('Wave F-2 privacy is untouched by this migration', () => {
  assert.doesNotMatch(migrationSql, /storage\.buckets/)
  assert.doesNotMatch(migrationSql, /storage\.objects/)
  assert.doesNotMatch(migrationSql, /student-files/)
  assert.doesNotMatch(migrationSql, /resume_url\s*=|headshot_url\s*=/)
})

test('preflight is read only and states its stop conditions', () => {
  assert.doesNotMatch(preflight, /^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.match(preflight, /STOP CONDITIONS/)
  for (let i = 1; i <= 9; i++) {
    assert.match(preflight, new RegExp(`PREFLIGHT ${i}:`), `preflight ${i}`)
  }
  // Verification proves the authorization model was not modified, and that Wave
  // F-2 privacy did not regress.
  assert.match(preflight, /VERIFY 6: the authorization model was NOT modified/)
  assert.match(preflight, /VERIFY 8: Wave F-2 privacy is untouched/)
})

test('no em dash in the Unit Leader SQL or scope module', () => {
  assert.doesNotMatch(migration, /—/)
  assert.doesNotMatch(preflight, /—/)
  assert.doesNotMatch(scope, /—/)
  assert.doesNotMatch(rules, /—/)
  assert.doesNotMatch(roster, /—/)
})
