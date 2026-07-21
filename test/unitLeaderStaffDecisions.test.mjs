// UL-PORTAL: guards for the ASPIRE staff decision path and the email delivery
// completion. Closes two launch blockers: workflows actionable only by direct
// database edit, and an alert path with no registered template.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const decisions = read('api/unit-leader-decisions.js')
const tmpl      = read('src/lib/notifications/templates/unitLeaderAlert.js')
const registry  = read('src/lib/notifications/templates/index.js')
const recips    = read('src/lib/notifications/recipients.js')
const alerts    = read('lib/server/notifications/unitLeaderAlerts.js')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const decisionsCode = stripJs(decisions)
const tmplCode = stripJs(tmpl)

// ── 1. Email delivery is now complete ───────────────────────────────────────
test('unit_leader_alert is registered in the template registry', () => {
  assert.match(registry, /import \{ unitLeaderAlert \} from '\.\/unitLeaderAlert\.js';/)
  assert.match(registry, /unit_leader_alert:\s+unitLeaderAlert,/)
})

test('the recipient resolver is wired into the dispatch', () => {
  assert.match(recips, /case 'unit_leader_alert':\s*\n\s*return resolveUnitLeaderAlert\(context\);/)
  assert.match(recips, /function resolveUnitLeaderAlert\(context\)/)
})

test('the resolver VALIDATES a pre-resolved recipient and never expands a unit', () => {
  const fn = recips.slice(recips.indexOf('function resolveUnitLeaderAlert'))
  const body = fn.slice(0, fn.indexOf('function resolveInterviewReminder'))
  assert.match(body, /if \(!r \|\| !r\.email\)/)
  assert.match(body, /if \(r\.audience !== 'unit_leader'\)/)
  // No database access, no name list, no default address.
  assert.doesNotMatch(body, /from\(|select\(|user_unit_scopes|unit_leaders/)
  assert.doesNotMatch(body, /@cshs\.org|@aspire/)
})

test('the template uses the shared ASPIRE shell with the correct signature', () => {
  assert.match(tmplCode, /aspireEmailShell\(\{ body: body\(ctx\), preheader: preheaderFor\(ctx\) \}\)/)
  assert.match(tmplCode, /getGreetingName\(\{ full_name: ctx\.recipient\?\.name \}\)/)
  assert.match(tmpl, /unit_leader: \(ctx\)/)
})

test('PRIVACY: the email carries no student information', () => {
  for (const forbidden of [
    'student_name', 'studentName', 'first_name', 'last_name', 'personal_email',
    'phone', 'support_needed', 'admin_notes', 'resume', 'headshot',
  ]) {
    assert.ok(!tmplCode.includes(forbidden), `email must not carry ${forbidden}`)
  }
  assert.match(tmpl, /does not include student information/)
})

test('the email names the exact unsubscribe path', () => {
  assert.match(tmpl, /Profile, and turn off/)
  assert.match(tmpl, /Notification preferences/)
  assert.match(tmpl, /still appears in the portal/)
})

test('only email-eligible alerts can reach the sender', () => {
  // emailEnabledFor short-circuits before any send for an in-app-only type.
  assert.match(alerts, /if \(!EMAIL_ELIGIBLE\.has\(alertType\)\) return false/)
  const emit = alerts.slice(alerts.indexOf('export async function emitUnitLeaderAlert'))
  assert.match(emit, /const wantsEmail = await emailEnabledFor\(db, person\.profileId, alertType\)/)
  assert.match(emit, /if \(!wantsEmail\) \{[\s\S]{0,200}continue/)
})

// ── 3. The ASPIRE decision path ─────────────────────────────────────────────
test('the decision endpoint requires an ACTIVE owner or admin', () => {
  assert.match(decisions, /verifyStaffCaller\(req\)/)
  assert.match(decisions, /if \(!caller\.ok\) return res\.status\(caller\.status\)/)
  // is_staff() is never used: it also returns true for interviewer and viewer.
  assert.doesNotMatch(decisionsCode, /is_staff/)
})

test('it is a STAFF route, not reachable from the portal surface', () => {
  // Living outside api/portal/ is the structural half of that guarantee.
  assert.doesNotMatch(decisionsCode, /verifyPortalUnitLeaderCaller|verifyPortalCaller|verifyPortalMessagesCaller/)
})

test('UNIT LEADER PERMISSIONS ARE NOT WIDENED by this endpoint', () => {
  assert.match(decisions, /UNIT LEADER PERMISSIONS ARE NOT WIDENED/)
  // It never writes a Unit Leader response column.
  assert.doesNotMatch(decisionsCode, /unit_response:/)
  assert.doesNotMatch(decisionsCode, /responded_by_profile_id:/)
  assert.doesNotMatch(decisionsCode, /submitted_by_profile_id:/)
  assert.doesNotMatch(decisionsCode, /nominated_by_profile_id:/)
})

test('all three decision kinds are supported with validated vocabularies', () => {
  for (const [set, values] of Object.entries({
    PLACEMENT_DECISIONS: ['confirmed', 'withdrawn', 'reassigned'],
    CAPACITY_DECISIONS: ['under_review', 'accepted', 'adjusted', 'declined'],
    NOMINATION_DECISIONS: ['confirmed', 'declined', 'withdrawn'],
  })) {
    const line = decisions.slice(decisions.indexOf(`const ${set}`))
    for (const v of values) assert.ok(line.slice(0, 200).includes(`'${v}'`), `${set} allows ${v}`)
  }
  assert.match(decisionsCode, /invalid_decision/)
  assert.match(decisionsCode, /invalid_kind/)
})

test('every decision is guarded against a concurrent second decision', () => {
  // Load, check, then a guarded update so two staff cannot both win.
  assert.match(decisionsCode, /\.eq\('aspire_status', 'open'\)/)
  assert.match(decisionsCode, /\.is\('superseded_at', null\)/)
  assert.match(decisionsCode, /\.eq\('status', 'nominated'\)/)
  const conflicts = (decisionsCode.match(/already_decided|already_superseded/g) || []).length
  assert.ok(conflicts >= 5, `expected conflict handling on each path, saw ${conflicts}`)
})

test('AUDIT: a placement decision appends to the append-only event log', () => {
  assert.match(decisionsCode, /from\('unit_placement_request_events'\)\.insert\(\{/)
  assert.match(decisionsCode, /event_type: 'aspire_decision'/)
  assert.match(decisionsCode, /actor_role: 'staff'/)
  assert.match(decisionsCode, /actor_profile_id: profile\.id/)
  assert.match(decisionsCode, /from_value: 'open'/)
  assert.match(decisionsCode, /to_value: decision/)
  // A failed audit write fails the request rather than silently succeeding.
  assert.match(decisionsCode, /if \(evErr\) return res\.status\(500\)/)
})

test('capacity and nomination carry attribution on the row itself', () => {
  assert.match(decisionsCode, /reviewed_by_profile_id: profile\.id/)
  assert.match(decisionsCode, /reviewed_at: now/)
  assert.match(decisionsCode, /decided_by_profile_id: profile\.id/)
  assert.match(decisionsCode, /decided_at: now/)
})

test('confirming a nomination does NOT create an assignment as a side effect', () => {
  assert.doesNotMatch(decisionsCode, /student_preceptor_assignments/)
  assert.match(decisions, /stays the authoritative assignment record/)
})

test('each decision notifies the unit through the scope-derived audience', () => {
  assert.match(decisionsCode, /alertType: 'placement_request'/)
  assert.match(decisionsCode, /alertType: 'capacity_review_outcome'/)
  assert.match(decisionsCode, /alertType: 'preceptor_assignment_update'/)
  // A distinct idempotency subject per decision, so a re-decision can notify again.
  assert.match(decisionsCode, /subjectId: `\$\{id\}:\$\{decision\}`/)
})

test('the endpoint uses a strict allowlist and validates its id', () => {
  assert.match(decisionsCode, /const allowed = new Set\(\['kind', 'id', 'decision', 'note'\]\)/)
  assert.match(decisionsCode, /unexpected_field/)
  assert.match(decisionsCode, /if \(!isUuid\(id\)\) return res\.status\(400\)/)
  assert.match(decisionsCode, /note_too_long/)
})

test('no em dash in the decision path or the alert template', () => {
  for (const [n, s] of Object.entries({ decisions, tmpl, registry, recips })) {
    assert.doesNotMatch(s, /—/, n)
  }
})
