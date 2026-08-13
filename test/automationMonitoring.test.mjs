// AUTOMATION-MONITORING-1: the Automations dashboard must describe production,
// not a subset of it.
//
// THE PRODUCTION DEFECT
// Coordinator Weekly Digest read "Never run" on a Thursday despite having run
// the previous Friday. /api/automation-runs took the 150 newest cron_runs rows
// across EVERY cron; three delivery workers run every 10 minutes and the
// clock-out sweep hourly, so those 150 rows covered roughly the last eight
// hours. Any automation older than that fell off the end and its card claimed
// it had never run. Every daily automation went dark each evening for the same
// reason. Nothing was wrong with the recording - the read was truncating.
//
// Two further problems this pins: health had no cadence, so a silently-stopped
// automation read Healthy forever off a stale run; and the run counters were
// unlabelled, so "Sent: 0" looked like "never sent anything" when it meant "the
// most recent run sent zero".
//
// Run: node --test test/automationMonitoring.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  AUTOMATION_CATALOG, MONITORED_CRON_NAMES, automationById, isRunStale, isNeverRunOverdue,
} from '../src/lib/automationCatalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const viewSrc = read('src/components/connect/AutomationView.jsx')
const runsSrc = read('api/automation-runs.js')

const cardBlock = viewSrc.slice(viewSrc.indexOf('const AUTOMATION_CARDS'), viewSrc.indexOf('\n]', viewSrc.indexOf('const AUTOMATION_CARDS')))
const cardIds = [...cardBlock.matchAll(/\{ id: '([a-z0-9_]+)'/g)].map(m => m[1])
const cardCronNames = [...cardBlock.matchAll(/cron_name: '([a-z0-9-]+)'/g)].map(m => m[1])

// ── The read path: the actual root cause ────────────────────────────────────

test('the runs query is scoped to monitored crons', () => {
  assert.match(runsSrc, /\.in\('cron_name', MONITORED_CRON_NAMES\)/,
    'unfiltered, the 10-minute workers crowd every other automation out of the window')
  assert.match(runsSrc, /from '\.\.\/src\/lib\/automationCatalog\.js'/)
})

test('the high-frequency workers are NOT monitored crons', () => {
  // These are what truncated the window. They are infrastructure, not cards.
  for (const worker of ['messages-delivery-worker', 'portal-feedback-delivery-worker', 'staff-notification-worker']) {
    assert.ok(!MONITORED_CRON_NAMES.includes(worker), `${worker} must stay out of the dashboard query`)
  }
})

test('every card cron name is monitored, and every monitored name has a card', () => {
  const missing = cardCronNames.filter(n => !MONITORED_CRON_NAMES.includes(n))
  assert.deepEqual(missing, [], `cards whose runs would never be fetched: ${missing.join(', ')}`)
  const orphans = MONITORED_CRON_NAMES.filter(n => !cardCronNames.includes(n))
  assert.deepEqual(orphans, [], `monitored crons with no card: ${orphans.join(', ')}`)
})

test('every card id has a catalog entry with a cadence', () => {
  for (const id of cardIds) {
    const entry = automationById(id)
    assert.ok(entry, `${id} has no catalog entry, so it can never be judged stale`)
    assert.ok(entry.maxAgeHours > 0, `${id} needs a freshness budget`)
  }
})

test('the cron each card names is the cron that records that name', () => {
  // A card pointing at a cron_name nothing writes is permanently "Never run".
  const recorded = {
    'teams-invite-reminders': 'api/cron/teams-invite-reminders.js',
    'interview-reminders': 'api/cron/interview-reminders.js',
    'student-birthday-greetings': 'api/cron/student-birthday-greetings.js',
    'midpoint-checkin': 'api/cron/midpoint-checkin.js',
    'coordinator-weekly-digest': 'api/cron/coordinator-weekly-digest.js',
  }
  for (const [cronName, file] of Object.entries(recorded)) {
    const src = read(file)
    assert.match(src, /startCronRun\(/, `${file} must record runs at all`)
    const namesIt = src.includes(`'${cronName}'`) || /startCronRun\([a-zA-Z]+, CRON_NAME\)/.test(src)
    assert.ok(namesIt, `${file} must record under '${cronName}'`)
  }
})

// ── Cadence-aware freshness ─────────────────────────────────────────────────

test('cadences are per-automation, not one universal timeout', () => {
  const byId = Object.fromEntries(AUTOMATION_CATALOG.map(a => [a.id, a.maxAgeHours]))
  assert.ok(byId.clockout_reminders < byId.interview_reminders, 'hourly is tighter than daily')
  assert.ok(byId.interview_reminders < byId.teams_invite_reminders, 'daily is tighter than weekdays-only')
  assert.ok(byId.teams_invite_reminders < byId.coordinator_weekly_digest, 'weekdays is tighter than weekly')
})

test('a weekly automation stays fresh across its whole week', () => {
  const weekly = automationById('coordinator_weekly_digest')
  const friday = '2026-08-07T16:00:00Z'
  // Thursday, six days later: still within budget, must NOT read stale.
  assert.equal(isRunStale({ lastRunIso: friday, maxAgeHours: weekly.maxAgeHours, nowIso: '2026-08-13T20:00:00Z' }), false)
  // Two weeks later: a Friday was genuinely missed.
  assert.equal(isRunStale({ lastRunIso: friday, maxAgeHours: weekly.maxAgeHours, nowIso: '2026-08-21T20:00:00Z' }), true)
})

test('an hourly automation goes stale in hours, not days', () => {
  const hourly = automationById('clockout_reminders')
  const at = '2026-08-13T12:00:00Z'
  assert.equal(isRunStale({ lastRunIso: at, maxAgeHours: hourly.maxAgeHours, nowIso: '2026-08-13T14:00:00Z' }), false)
  assert.equal(isRunStale({ lastRunIso: at, maxAgeHours: hourly.maxAgeHours, nowIso: '2026-08-13T20:00:00Z' }), true)
})

test("a weekday automation's Friday run is still fresh on Monday", () => {
  const teams = automationById('teams_invite_reminders')
  assert.equal(isRunStale({
    lastRunIso: '2026-08-07T15:00:00Z',                 // Friday
    maxAgeHours: teams.maxAgeHours, nowIso: '2026-08-10T16:00:00Z', // Monday
  }), false, 'the weekend must not make it look broken')
})

test('never-run is only a problem once a full cadence has passed', () => {
  const daily = automationById('student_birthday_greetings')
  // Deployed this afternoon, first window is tomorrow: Never run is CORRECT.
  assert.equal(isNeverRunOverdue({
    firstSeenIso: '2026-08-13T20:00:00Z', maxAgeHours: daily.maxAgeHours, nowIso: '2026-08-13T23:00:00Z',
  }), false)
  // Three days later with still nothing recorded: that is silence, not newness.
  assert.equal(isNeverRunOverdue({
    firstSeenIso: '2026-08-13T20:00:00Z', maxAgeHours: daily.maxAgeHours, nowIso: '2026-08-16T23:00:00Z',
  }), true)
})

test('unknown timestamps never manufacture a missed run', () => {
  assert.equal(isRunStale({ lastRunIso: null, maxAgeHours: 24, nowIso: '2026-08-13T00:00:00Z' }), false)
  assert.equal(isNeverRunOverdue({ firstSeenIso: null, maxAgeHours: 24, nowIso: '2026-08-13T00:00:00Z' }), false)
  assert.equal(isRunStale({ lastRunIso: 'nonsense', maxAgeHours: 24, nowIso: '2026-08-13T00:00:00Z' }), false)
})

// ── Health semantics in the card ────────────────────────────────────────────

test('health consults cadence and has a distinct stale state', () => {
  assert.match(viewSrc, /function resolveHealth\(run, nowIso, paused, cadence\)/)
  assert.match(viewSrc, /isRunStale\(\{ lastRunIso: started_at/)
  assert.match(viewSrc, /label: 'No recent runs'/)
  assert.match(viewSrc, /warn:\s*\{/, 'the stale state needs its own tone')
})

test('a paused automation is never called stale', () => {
  // Paused returns before any cadence check, so not running cannot read as a
  // monitoring failure - not running is what paused means.
  const body = viewSrc.slice(viewSrc.indexOf('function resolveHealth'), viewSrc.indexOf('function chipsFromDetails'))
  const pausedAt = body.indexOf("label: 'Paused'")
  const staleAt = body.indexOf("label: 'No recent runs'")
  assert.ok(pausedAt > -1 && staleAt > -1 && pausedAt < staleAt, 'paused must short-circuit first')
})

test('a successful zero-send run is still Healthy', () => {
  const body = viewSrc.slice(viewSrc.indexOf('function resolveHealth'), viewSrc.indexOf('function chipsFromDetails'))
  assert.match(body, /sent === 0[\s\S]{0,200}label: 'Healthy'/,
    'nothing to send is a healthy outcome, not a warning')
})

// ── Counter labelling ───────────────────────────────────────────────────────

test('run counters are labelled as latest-run metrics', () => {
  assert.match(viewSrc, /Last run metrics/,
    '"Sent: 0" must not read as an all-time total')
})

test('no cumulative totals are invented', () => {
  // Every chip comes from ONE run's details. Nothing sums across runs, because
  // cron_runs history is truncated and partial and could not support it.
  assert.match(viewSrc, /chipsFromDetails\(run\?\.details\)/)
  assert.doesNotMatch(viewSrc, /total_sent|cumulative|allTime|sumBy/i)
})
