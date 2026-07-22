// UL-PORTAL: guards for the final MVP pass.
//   1. notification delivery
//   2. the direct student messaging entry point
//   3. the first-capacity-submission fix
//   4. dense mobile actions
//   5. integration quality

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const alerts = read('lib/server/notifications/unitLeaderAlerts.js')
const feed   = read('api/portal/unit-notifications.js')
const start  = read('api/portal/unit-messages-start.js')
const portal = read('src/portal/UnitLeaderPortal.jsx')
const api    = read('src/portal/unit/unitLeaderApi.js')
const css    = read('src/portal/portal.css')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const alertsCode = stripJs(alerts)
const feedCode = stripJs(feed)
const portalCode = stripJs(portal)

const ALERT_TYPES = [
  'placement_request', 'response_deadline', 'onboarding_issue', 'schedule_change',
  'new_message', 'capacity_review_outcome', 'preceptor_assignment_update', 'concern_follow_up',
]

// ── 1. Notifications ────────────────────────────────────────────────────────
test('all eight approved alert types are defined', () => {
  for (const t of ALERT_TYPES) {
    assert.ok(alerts.includes(`'${t}'`), `alert type ${t}`)
  }
  assert.match(alerts, /export const ALERT_TYPES = \[/)
})

test('every alert type has a human label', () => {
  const labels = alerts.slice(alerts.indexOf('export const ALERT_LABEL'))
  for (const t of ALERT_TYPES) assert.ok(labels.includes(`${t}:`), `label for ${t}`)
})

test('EMAIL is restricted to the approved subset, so not every state change emails', () => {
  assert.match(alerts, /export const EMAIL_ELIGIBLE = new Set\(\[/)
  const set = alerts.slice(alerts.indexOf('EMAIL_ELIGIBLE'), alerts.indexOf('export const DEFAULT_EMAIL_ENABLED'))
  for (const t of ['placement_request', 'response_deadline', 'onboarding_issue', 'schedule_change', 'new_message']) {
    assert.ok(set.includes(`'${t}'`), `${t} may email`)
  }
  for (const t of ['capacity_review_outcome', 'preceptor_assignment_update', 'concern_follow_up']) {
    assert.ok(!set.includes(`'${t}'`), `${t} must be in-app only`)
  }
})

test('preferences have a stable default and fail CLOSED on error', () => {
  assert.match(alerts, /export const DEFAULT_EMAIL_ENABLED = true/)
  const fn = alertsCode.slice(alertsCode.indexOf('export async function emailEnabledFor'),
                              alertsCode.indexOf('export async function unitLeaderAudience'))
  // Absent row means the default.
  assert.match(fn, /if \(!data\) return DEFAULT_EMAIL_ENABLED/)
  // An error or an ineligible type means no email.
  assert.match(fn, /if \(!EMAIL_ELIGIBLE\.has\(alertType\)\) return false/)
  assert.match(fn, /if \(error\) return false/)
  assert.match(fn, /catch \{\s*return false\s*\}/)
})

test('AUDIENCE IS SCOPE: derived from an active grant and an active unit scope', () => {
  const fn = alertsCode.slice(alertsCode.indexOf('export async function unitLeaderAudience'))
  assert.match(fn, /from\('user_unit_scopes'\)/)
  assert.match(fn, /\.eq\('unit_key', unitKey\)/)
  assert.match(fn, /\.is\('revoked_at', null\)/)
  assert.match(fn, /\.eq\('role', 'unit_leader'\)/)
  // Inactive accounts and missing emails are excluded.
  assert.match(fn, /p\.is_active !== false && p\.email/)
  // Never addressed by name or title.
  assert.doesNotMatch(fn, /\.eq\('full_name'|unit_leaders/)
})

test('the audience respects a cohort-restricted scope', () => {
  const fn = alertsCode.slice(alertsCode.indexOf('export async function unitLeaderAudience'))
  assert.match(fn, /s\.cohort_id === null \|\| cohortId === null \|\| s\.cohort_id === cohortId/)
})

test('email is deduplicated by a deterministic idempotency key', () => {
  assert.match(alerts, /export function alertIdempotencyKey/)
  assert.match(alerts, /`ul:\$\{alertType\}:\$\{subjectId \|\| 'none'\}:\$\{profileId\}`/)
  assert.match(alertsCode, /async function alreadySent/)
  assert.match(alertsCode, /contains\('metadata', \{ idempotency_key: key \}\)/)
  assert.match(alertsCode, /reason: 'duplicate'/)
})

test('a send failure leaves no log row, so a retry is still possible', () => {
  assert.match(alerts, /A send failure leaves no log row/)
  assert.match(alertsCode, /reason: 'send_failed'/)
})

test('NOTIFICATION FAILURE NEVER BREAKS THE ACTION', () => {
  // The emitter returns a result and never rethrows.
  assert.match(alertsCode, /return \{ ok: false, reason: 'emit_failed', outcomes \}/)
  assert.match(alerts, /never rethrows/)
  // And the caller emits AFTER the authoritative write.
  assert.ok(
    start.indexOf('if (out.rpcError)') < start.indexOf('await emitUnitLeaderAlert(db, {'),
    'the alert must be emitted after the write succeeds')
})

test('an invalid alert type is refused, never mismapped', () => {
  assert.match(alertsCode, /if \(!isAlertType\(alertType\)\) \{[\s\S]{0,120}invalid_alert_type/)
  assert.match(feedCode, /if \(!isAlertType\(alertType\)\) return res\.status\(400\)/)
})

test('the in-app feed is DERIVED and scope-checked, not stored', () => {
  assert.match(feed, /THE FEED IS DERIVED, NOT STORED/)
  assert.match(feedCode, /verifyPortalUnitLeaderCaller\(req\)/)
  assert.match(feedCode, /narrowScopes\(scopes, requestedUnit\)/)
  assert.match(feedCode, /if \(effective === null\) return res\.status\(403\)/)
  // The scope cohort rule is reapplied after each fetch.
  assert.match(feedCode, /function inScope\(rows, effective\)/)
  assert.match(feedCode, /s\.cohort_id === null \|\| s\.cohort_id === r\.cohort_id/)
})

test('the feed covers the alert types it can derive', () => {
  for (const t of ['placement_request', 'response_deadline', 'capacity_review_outcome',
    'preceptor_assignment_update', 'onboarding_issue']) {
    assert.ok(feedCode.includes(`'${t}'`), `feed derives ${t}`)
  }
})

test('preferences govern EMAIL only, never the in-app feed', () => {
  assert.match(feed, /In-app items are NOT filtered by email preference/)
  // The feed never consults emailEnabledFor.
  assert.doesNotMatch(feedCode, /emailEnabledFor/)
})

test('unsubscribe is a real, validated control', () => {
  assert.match(feedCode, /async function setPreference/)
  assert.match(feedCode, /typeof emailEnabled !== 'boolean'/)
  assert.match(feedCode, /alert_type_is_in_app_only/)
  assert.match(feedCode, /onConflict: 'user_profile_id,alert_type'/)
  // Strict allowlist.
  assert.match(feedCode, /unexpected_field/)
})

test('the preferences UI exposes every type and explains the scope of the setting', () => {
  assert.match(portal, /Notification preferences/)
  assert.match(portal, /toggle\(p\.alert_type, e\.target\.checked\)/)
  assert.match(portal, /await setNotificationPreference\(alertType, next\)/)
  assert.match(portal, /These settings control email only/)
  // In-app-only types are shown but not togglable.
  assert.match(portal, /\(in portal only\)/)
})

// ── 2. Direct student messaging ─────────────────────────────────────────────
test('Message student calls the endpoint with destination student', () => {
  assert.match(portal, /const messageStudent = async \(student\) => \{/)
  assert.match(portal, /destination: 'student'/)
  assert.match(portal, /Message student/)
})

test('the action never sends actor identity, kind, or unit scope', () => {
  const fn = portal.slice(portal.indexOf('const messageStudent'), portal.indexOf('return (\n    <>\n      <SectionHeading focusKey="students"'))
  assert.doesNotMatch(fn, /actor|profile_id|unit_key:|actorKind/)
  assert.match(fn, /studentId: student\.id/)
})

test('the action has loading, duplicate-click, success, and error states', () => {
  const fn = portal.slice(portal.indexOf('const messageStudent'))
  assert.match(fn.slice(0, 1800), /if \(busy\) return/)
  assert.match(fn.slice(0, 1800), /setBusy\(`\$\{student\.id\}:message`\)/)
  assert.match(fn.slice(0, 1800), /tone: 'ok'/)
  assert.match(fn.slice(0, 1800), /tone: 'error'/)
  assert.match(fn.slice(0, 1800), /student_has_no_portal_account/)
  assert.match(fn.slice(0, 1800), /res\.status === 429/)
})

test('a created thread opens in Messages', () => {
  assert.match(portal, /if \(res\.data\?\.conversation_id\) onOpenThread\?\.\(res\.data\.conversation_id\)/)
  assert.match(portal, /else onNavigate\?\.\('messages'\)/)
})

test('Report a Concern remains a SEPARATE flow to the ASPIRE Team', () => {
  const con = portal.slice(portal.indexOf('function ConcernScreen'))
  assert.match(con.slice(0, 3000), /destination: 'aspire'/)
  assert.match(con.slice(0, 3000), /The student is not part of it/)
  // And the concern path emits its own follow-up alert.
  assert.match(start, /alertType: 'concern_follow_up'/)
})

// ── 3. First capacity submission ────────────────────────────────────────────
test('the cohort comes from the server, NOT from prior capacity rows', () => {
  assert.match(portal, /const acceptingCohort = roster\.data\?\.accepting_cohort \|\| null/)
  assert.match(portal, /const cohortId = acceptingCohort\?\.id \|\| null/)
  // The old inference is gone.
  assert.doesNotMatch(portalCode, /rows\[0\]\?\.cohort_id/)
  assert.match(portal, /so the FIRST submission for a unit works/)
})

test('the form states the cohort and disables submission when none is open', () => {
  assert.match(portal, /Cohort: \{acceptingCohort\?\.name \? acceptingCohort\.name : EMPTY\}/)
  assert.match(portal, /disabled=\{saving \|\| !cohortId\}/)
  assert.match(portal, /ASPIRE has not opened a cohort for submissions yet/)
})

// ── 4. Dense mobile actions ─────────────────────────────────────────────────
test('row actions are a single kebab menu, not cramped side-by-side buttons', () => {
  // The visual redesign replaced the disclosure with one overflow kebab. The
  // property is unchanged: actions are behind a single accessible control per row.
  assert.match(portal, /function StudentKebab/)
  assert.match(portal, /aria-haspopup="menu"/)
  assert.match(portal, /aria-expanded=\{open\}/)
  assert.match(portal, /role="menu" aria-label=\{label\}/)
  assert.ok(!portal.includes('function StudentActions'), 'the old stacked disclosure is gone')
})

test('the kebab preserves Message Student with a clear per-student label', () => {
  // SUPERSEDED: the milestone confirmations were removed until Phase 2, so the kebab now
  // holds only Message Student. It stays labelled per student.
  const fn = portal.slice(portal.indexOf('function StudentKebab'))
  assert.match(fn, /Message student/)
  assert.ok(!fn.includes('MILESTONES'))
  assert.match(fn, /const label = `Actions for \$\{studentName\(student\)\}`/)
  assert.match(fn, /aria-label=\{label\}/)
})

test('kebab actions are real buttons with visible focus and touch targets', () => {
  const fn = portal.slice(portal.indexOf('function StudentKebab'), portal.indexOf('function StudentKebab') + 1400)
  // Real buttons, never divs with click handlers.
  assert.doesNotMatch(fn, /<div[^>]*onClick/)
  assert.match(fn, /role="menuitem"/)
  assert.match(css, /\.ptl-stu-menu \{/)
  assert.match(css, /\.ptl-stu-menuitem:focus-visible \{/)
})

test('responsive data-label behavior is preserved for every cell', () => {
  const tds = (portal.match(/<td/g) || []).length
  const labelled = (portal.match(/data-label="/g) || []).length
  assert.equal(tds, labelled)
})

// ── 5. Integration quality ──────────────────────────────────────────────────
test('the notification endpoints are reachable only through the api layer', () => {
  assert.match(api, /export const getNotifications/)
  assert.match(api, /export const setNotificationPreference/)
  // Still narrowing only, never widening.
  assert.match(api, /unitQuery\(unitKey\)/)
})

test('excluded data is still absent from the notification paths', () => {
  for (const forbidden of ['support_needed', 'learning_highlight', 'admin_notes',
    'gpa_verified', 'bls_current', 'health_cleared', 'background_check', 'rubric']) {
    assert.ok(!feedCode.includes(forbidden), `feed must not read ${forbidden}`)
    assert.ok(!alertsCode.includes(forbidden), `alerts must not read ${forbidden}`)
  }
})

test('no em dash in the final pass files', () => {
  for (const [n, s] of Object.entries({ alerts, feed, start, portal, api, css })) {
    assert.doesNotMatch(s, new RegExp(String.fromCharCode(0x2014)), n)
  }
})
