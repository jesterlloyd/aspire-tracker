// NURSING-ACADEMICS-1: the fourth portal role's foundation - migration source
// assertions plus the full lifecycle surface sweep (grant, renewal,
// expiration, revocation, labels, invitation copy, and the deliberate
// non-enablement of messaging and feedback).
// Pure unit and source assertions. No network, no live database, no email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const MIGRATION = 'supabase/migrations/20260824000000_nursing_academics_portal_foundation.sql'
const migration = read(MIGRATION)
const CONTACTS_EDITOR_MIGRATION = read('supabase/migrations/20260825000000_nursing_academic_contacts_editor.sql')

// ── The migration ────────────────────────────────────────────────────────────

test('the role CHECK is widened to exactly four roles, by verified constraint name', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS user_role_grants_role_check/)
  assert.match(migration, /ADD CONSTRAINT user_role_grants_role_check\s*\n?\s*CHECK \(role IN \('student', 'unit_leader', 'academic_partner', 'nursing_academic'\)\)/)
})

test('both lifecycle functions accept nursing_academic and require NO scope payload for it', () => {
  assert.match(migration, /IF p_role NOT IN \('student', 'unit_leader', 'academic_partner', 'nursing_academic'\) THEN[\s\S]{0,120}PT400/)
  // The four-role allowlist appears in BOTH functions (provision + revoke).
  const occurrences = (migration.match(/NOT IN \('student', 'unit_leader', 'academic_partner', 'nursing_academic'\)/g) || []).length
  assert.equal(occurrences, 2)
  // No scope validation branch exists for the new role.
  assert.doesNotMatch(migration, /required for a nursing_academic grant/)
  // Privileges stay service_role-only.
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.provision_portal_access[\s\S]{0,200}TO service_role/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.revoke_portal_access[\s\S]{0,200}TO service_role/)
})

test('community-benefit storage is append-only, constrained, and locked away from client roles', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.community_benefit_rates/)
  assert.match(migration, /chk_cbr_category CHECK \(category IN \('rn_preceptor', 'management'\)\)/)
  assert.match(migration, /chk_cbr_rate_nonnegative CHECK \(hourly_rate >= 0\)/)
  assert.match(migration, /uq_cbr_one_active_rate_per_fy_category/)
  assert.match(migration, /WHERE superseded_at IS NULL/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.community_benefit_capstone_hours/)
  assert.match(migration, /chk_cbch_hours_nonnegative CHECK \(hours >= 0\)/)
  assert.match(migration, /chk_cbch_fiscal_year CHECK \(fiscal_year BETWEEN 2020 AND 2100\)/)
  assert.match(migration, /ALTER TABLE public\.community_benefit_rates\s+ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.community_benefit_rates\s+FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /REVOKE ALL ON public\.community_benefit_capstone_hours FROM PUBLIC, anon, authenticated/)
})

test('rate replacement is atomic and executable only by the service role', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_community_benefit_rate\(/)
  const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.set_community_benefit_rate'))
  assert.match(fn, /SECURITY DEFINER/)
  assert.match(fn, /SET search_path = public, pg_catalog/)
  assert.match(fn, /UPDATE public\.community_benefit_rates/)
  assert.match(fn, /INSERT INTO public\.community_benefit_rates/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_community_benefit_rate\(integer, text, numeric, text, uuid\)[\s\S]{0,80}FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_community_benefit_rate\(integer, text, numeric, text, uuid\)[\s\S]{0,80}TO service_role/)
})

test('students.course_type is additive and nullable, and the migration carries preflight, verification, and rollback', () => {
  assert.match(migration, /ALTER TABLE public\.students\s+ADD COLUMN IF NOT EXISTS course_type text/)
  assert.match(migration, /PREFLIGHT/)
  assert.match(migration, /VERIFICATION/)
  assert.match(migration, /ROLLBACK/)
  assert.match(migration, /APPLY MANUALLY \(Owner\/Jester\)/)
})

test('the migration touches NO messaging, feedback, or conversation role constraint', () => {
  // The header COMMENT may name the rule; no constraint or table may be touched.
  for (const forbidden of [
    'chk_portal_feedback_role', 'chk_participant_role', 'chk_messages_author_role',
    'chk_conversations_created_by_role', 'portal_feedback_submissions',
    'conversation_participants', 'messages_conversations',
  ]) {
    assert.ok(!migration.includes(forbidden), `migration must not touch ${forbidden}`)
  }
})

test('Contacts Editor is a narrow, default-view grant capability with no delete privilege', () => {
  assert.match(CONTACTS_EDITOR_MIGRATION, /ADD COLUMN IF NOT EXISTS contacts_access text NOT NULL DEFAULT 'view'/)
  assert.match(CONTACTS_EDITOR_MIGRATION, /contacts_access IN \('view', 'manage'\)/)
  assert.match(CONTACTS_EDITOR_MIGRATION, /role = 'nursing_academic' OR contacts_access = 'view'/)
  assert.match(CONTACTS_EDITOR_MIGRATION, /REVOKE INSERT, UPDATE, DELETE ON public\.user_role_grants FROM anon, authenticated/)
  assert.doesNotMatch(CONTACTS_EDITOR_MIGRATION, /GRANT DELETE ON public\.contacts/)
})

// ── Lifecycle surfaces ───────────────────────────────────────────────────────

test('the three access endpoints allow-list the fourth role', () => {
  const FOUR = /const PORTAL_ROLES = \['student', 'unit_leader', 'academic_partner', 'nursing_academic'\]/
  assert.match(read('api/invite-portal-user.js'), FOUR)
  assert.match(read('api/revoke-portal-access.js'), FOUR)
  assert.match(read('api/list-portal-access.js'), FOUR)
  assert.match(read('api/list-portal-access.js'), /by_role: \{ student: 0, unit_leader: 0, academic_partner: 0, nursing_academic: 0 \}/)
})

test('invite requires NO scope for nursing_academic and passes null scopes to the RPC', () => {
  const src = read('api/invite-portal-user.js')
  // Gate 7 has no nursing_academic branch (no scope requirement) ...
  const scopeValidation = src.slice(src.indexOf('Gate 7:'), src.indexOf('Locate any existing profile'))
  assert.doesNotMatch(scopeValidation, /portalRole === 'nursing_academic'\) \{/)
  // ... and the RPC scope params are role-conditional, so they resolve to null for it.
  assert.match(src, /p_student_id: portalRole === 'student' \? studentId : null/)
  assert.match(src, /p_unit_keys: portalRole === 'unit_leader' \? unitKeys : null/)
  assert.match(src, /p_school_keys: portalRole === 'academic_partner' \? schoolKeys : null/)
})

test('client role vocabulary: labels, options, and the org-wide scope summary', async () => {
  const { PORTAL_ROLE_LABELS, PORTAL_ROLE_OPTIONS, summarizeScope } = await import('../src/lib/portalAccessStatus.js')
  assert.equal(PORTAL_ROLE_LABELS.nursing_academic, 'Nursing Education & Leadership')
  assert.ok(PORTAL_ROLE_OPTIONS.some(o => o.value === 'nursing_academic' && o.label === 'Nursing Education & Leadership'))
  assert.equal(
    summarizeScope({ portal_role: 'nursing_academic', scope: { students: [], units: [], schools: [] } }),
    'ASPIRE-wide (view only)',
  )
  assert.equal(
    summarizeScope({ portal_role: 'nursing_academic', contacts_access: 'manage', scope: { students: [], units: [], schools: [] } }),
    'ASPIRE-wide · Contacts Editor',
  )
})

test('grant lifecycle status math is role-agnostic and covers renewal, expiration, and revocation for the new role', async () => {
  const { derivePortalStatus, isExpiringSoon } = await import('../src/lib/portalAccessStatus.js')
  const now = Date.parse('2026-08-24T00:00:00Z')
  const grant = (over = {}) => ({ role: 'nursing_academic', starts_at: '2026-08-01T00:00:00Z', expires_at: null, revoked_at: null, ...over })
  assert.equal(derivePortalStatus(grant(), now), 'active')
  assert.equal(derivePortalStatus(grant({ starts_at: '2026-09-01T00:00:00Z' }), now), 'scheduled')
  assert.equal(derivePortalStatus(grant({ expires_at: '2026-08-20T00:00:00Z' }), now), 'expired')
  assert.equal(derivePortalStatus(grant({ revoked_at: '2026-08-22T00:00:00Z' }), now), 'revoked')
  assert.equal(isExpiringSoon(grant({ expires_at: '2026-09-10T00:00:00Z' }), now), true)
})

test('the grant modal treats nursing_academic as valid with no scope pickers', () => {
  const modal = read('src/components/settings/GrantPortalAccessModal.jsx')
  assert.match(modal, /role === 'nursing_academic' \? true : false/)
  assert.match(modal, /ASPIRE-wide \(view only\)/)
  assert.match(modal, /Contacts Editor/)
  assert.match(modal, /add, edit, deactivate, and reactivate contacts/i)
})

test('the invitation email carries dedicated Nursing Education & Leadership copy', async () => {
  const { inviteCopyForRole, portalInvitationEmail } = await import('../lib/server/email/portalInvitation.js')
  const copy = inviteCopyForRole('nursing_academic')
  assert.equal(copy.portalName, 'ASPIRE Nursing Education & Leadership Portal')
  const out = portalInvitationEmail({ firstName: 'Margo', role: 'nursing_academic', activationLink: 'https://x/auth/activate?token=T' })
  assert.match(out.subject, /Nursing Education & Leadership Portal/)
  assert.ok(!out.html.includes('log shifts'), 'must not receive student copy')
})

test('PortalApp appends the experience LAST in precedence and mounts the capability-gated utilities', () => {
  // NA-PORTAL-UTILITIES-1 reversed the original no-utilities decision: the
  // Nursing Education & Leadership portal now mounts the same utility layer as
  // every other portal, gated on the SERVER capabilities (fail-closed until the
  // Owner SQL gate is applied).
  const app = read('src/portal/PortalApp.jsx')
  assert.match(app, /const isNursingAcademic = !isStudent && !isUnitLeader && !isAcademicPartner && \(access\?\.roles \|\| \[\]\)\.includes\('nursing_academic'\)/)
  assert.match(app, /roles\.includes\('nursing_academic'\)/)
  const branch = app.slice(app.indexOf("roles.includes('nursing_academic')"))
  const branchEnd = branch.indexOf('PortalAccessNotice')
  const naBranch = branch.slice(0, branchEnd)
  assert.match(naBranch, /<PortalUtilityLayer/)
  assert.match(naBranch, /messagesAuthorized=\{naMessagesEnabled\}/)
  assert.match(naBranch, /feedbackAuthorized=\{naFeedbackEnabled\}/)
  assert.match(naBranch, /onOpenMessages=\{\(\) => goNaSection\('messages'\)\}/)
  assert.match(naBranch, /NursingAcademicsNav/)
  assert.match(naBranch, /NursingAcademicsPortal/)
  // The unread poll includes the capability-gated NA flag.
  assert.match(app, /enabled: !staffPreview && \(isStudent \|\| isUnitLeader \|\| apMessagesEnabled \|\| naMessagesEnabled\)/)
})

test('feedback and messaging recognize the role, fail-closed behind the Owner SQL gate', async () => {
  const { PORTAL_FEEDBACK_ROLES } = await import('../lib/server/portalFeedback/config.js')
  assert.ok(PORTAL_FEEDBACK_ROLES.includes('nursing_academic'), 'feedback covers the fourth portal role')
  const auth = read('api/lib/messagesAuth.js')
  // NA is admitted LAST, with empty scope arrays, so no existing kind's behavior changes.
  assert.match(auth, /verifyPortalNursingAcademicCaller/)
  const fn = auth.slice(auth.indexOf('export async function verifyPortalMessagesCaller'))
  assert.ok(fn.indexOf("actorKind: 'academic_partner'") < fn.indexOf("actorKind: 'nursing_academic'"))
})

test('the tour registry serves the new experience', async () => {
  const { TOUR_EXPERIENCES, getTourSteps } = await import('../src/lib/onboardingTours.js')
  assert.equal(TOUR_EXPERIENCES.nursing_academic, 'v2')
  const steps = getTourSteps('nursing_academic', { userProfile: { full_name: 'Michael M' } })
  assert.ok(steps.length >= 4)
  assert.ok(steps.some(s => s.target === '[data-tour="portal-nav-calendar"]'))
  assert.ok(steps.some(s => s.target === '[data-tour="portal-nav-community-benefit"]'))
})

test('the NE&L masthead context is the fiscal year, from the canonical FY clock', async () => {
  // Owner decision: the other portals name their cohort (Fall 2026); NE&L is
  // not cohort-scoped, so its masthead context is the spanning fiscal year
  // ("FY 2026-2027"). The value MUST come from the Community Benefit engine's
  // currentFiscalYear (Pacific Jul-Jun boundary) - never a second definition.
  const { readFileSync } = await import('node:fs')
  const portal = readFileSync(new URL('../src/portal/na/NursingAcademicsPortal.jsx', import.meta.url), 'utf8')
  assert.match(portal, /import \{ currentFiscalYear \} from '\.\.\/\.\.\/\.\.\/lib\/server\/communityBenefit\/compute'/)
  assert.match(portal, /`FY \$\{fy - 1\}-\$\{fy\}`/)
  assert.match(portal, /contextLabel=\{fyLabel\}/)
  assert.doesNotMatch(portal, /contextLabel="Nursing Education & Leadership"/)
  // The masthead greets ONCE, inside the At A Glance section - never above the
  // section switch, where it repeated on Community Benefit / Contacts /
  // Messages and could contradict the FY selected inside the benefit report.
  assert.equal((portal.match(/<GreetingMasthead/g) || []).length, 1)
  const glance = portal.slice(
    portal.indexOf("view === 'calendar' ? 'flex'"),
    portal.indexOf('<AcademicsCalendarView'),
  )
  assert.match(glance, /<GreetingMasthead/, 'the masthead must live inside the At A Glance section')
  // The canonical clock itself: FY is the ENDING year, flipping on July 1 (Pacific).
  const { currentFiscalYear } = await import('../lib/server/communityBenefit/compute.js')
  assert.equal(currentFiscalYear(new Date('2026-06-30T12:00:00-07:00')), 2026)
  assert.equal(currentFiscalYear(new Date('2026-07-01T12:00:00-07:00')), 2027)
})
