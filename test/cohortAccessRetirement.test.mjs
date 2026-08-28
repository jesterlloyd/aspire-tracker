// test/cohortAccessRetirement.test.mjs
//
// COHORT-ACCESS-RETIREMENT-1 guards:
//   1. Business-day math: weekends, US federal holidays (observed shifts,
//      year-boundary spill), and the strictly-after send-date rule.
//   2. Cohort dueness: stamp required, due date honored, one send per
//      completion via the sent_at >= completed_at ledger rule, and
//      re-completion notifying again.
//   3. The retirement list: ✓ CS-Link Active holders only, Active Rotation
//      excluded, name/school/status shape.
//   4. Source assertions: the migration's trigger contract, the cron's
//      fail-closed postures, and every registration point.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  usFederalHolidays, isBusinessDay, firstBusinessDayAfter, weekdayOf,
  pacificDateOf, selectDueCohorts, selectRetirementStudents,
} from '../src/lib/accessRetirement.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ── 1. Business-day math ────────────────────────────────────────────────────

test('2026 federal holidays land on the documented observed dates', () => {
  const h = usFederalHolidays(2026)
  assert.ok(h.has('2026-01-01'), "New Year's Day (Thursday, no shift)")
  assert.ok(h.has('2026-01-19'), 'MLK Day: 3rd Monday of January')
  assert.ok(h.has('2026-02-16'), "Washington's Birthday: 3rd Monday of February")
  assert.ok(h.has('2026-05-25'), 'Memorial Day: last Monday of May')
  assert.ok(h.has('2026-06-19'), 'Juneteenth (Friday, no shift)')
  assert.ok(h.has('2026-07-03'), 'Independence Day 2026 falls on Saturday; observed Friday Jul 3')
  assert.ok(!h.has('2026-07-04'), 'the Saturday itself is not the observed date')
  assert.ok(h.has('2026-09-07'), 'Labor Day: 1st Monday of September')
  assert.ok(h.has('2026-10-12'), 'Columbus Day: 2nd Monday of October')
  assert.ok(h.has('2026-11-11'), 'Veterans Day (Wednesday, no shift)')
  assert.ok(h.has('2026-11-26'), 'Thanksgiving: 4th Thursday of November')
  assert.ok(h.has('2026-12-25'), 'Christmas (Friday, no shift)')
})

test('weekends and holidays are not business days; observed spill crosses years', () => {
  assert.equal(weekdayOf('2026-10-24'), 6, 'Oct 24 2026 is a Saturday')
  assert.equal(isBusinessDay('2026-10-24'), false)
  assert.equal(isBusinessDay('2026-10-25'), false, 'Sunday')
  assert.equal(isBusinessDay('2026-10-26'), true, 'Monday')
  assert.equal(isBusinessDay('2026-07-03'), false, 'observed Independence Day')
  // New Year's Day 2028 is a Saturday -> observed Friday 2027-12-31; the
  // neighbor-year check catches the spill into 2027.
  assert.equal(isBusinessDay('2027-12-31'), false, "observed New Year's spills into the prior year")
})

test('the send date is the first business day STRICTLY AFTER completion', () => {
  // Mark on a weekday -> the next morning.
  assert.equal(firstBusinessDayAfter('2026-10-27'), '2026-10-28')
  // Mark on Friday -> Monday.
  assert.equal(firstBusinessDayAfter('2026-10-23'), '2026-10-26')
  // Mark on Saturday (his example date) -> Monday.
  assert.equal(firstBusinessDayAfter('2026-10-24'), '2026-10-26')
  // Mark the Wednesday before Thanksgiving -> Friday (Thursday is the holiday).
  assert.equal(firstBusinessDayAfter('2026-11-25'), '2026-11-27')
  // Mark Thursday Jul 2 2026 -> Monday Jul 6 (observed holiday Fri + weekend).
  assert.equal(firstBusinessDayAfter('2026-07-02'), '2026-07-06')
  // Chained: Christmas Friday -> mark Thursday Dec 24 2026, send Monday Dec 28.
  assert.equal(firstBusinessDayAfter('2026-12-24'), '2026-12-28')
})

test('pacificDateOf maps a UTC timestamp to the Pacific calendar day', () => {
  // 05:30 UTC on Oct 24 is 22:30 on Oct 23 PDT.
  assert.equal(pacificDateOf('2026-10-24T05:30:00Z'), '2026-10-23')
  assert.equal(pacificDateOf('2026-10-24T17:00:00Z'), '2026-10-24')
})

// ── 2. Cohort dueness ───────────────────────────────────────────────────────

const COHORT = { id: 'c1', name: 'Fall 2026', status: 'Completed', completed_at: '2026-10-23T20:00:00Z' } // Fri 1pm PT

test('a stamped Completed cohort becomes due on its send date and stays due after', () => {
  const before = selectDueCohorts({ cohorts: [COHORT], todayPacific: '2026-10-24', ledger: [] })
  assert.equal(before.due.length, 0)
  assert.equal(before.skipped[0].reason, 'not_due_yet')
  assert.equal(before.skipped[0].due_date, '2026-10-26')
  const onDay = selectDueCohorts({ cohorts: [COHORT], todayPacific: '2026-10-26', ledger: [] })
  assert.equal(onDay.due.length, 1)
  // A missed day is caught later - dueness is today >= due date.
  const after = selectDueCohorts({ cohorts: [COHORT], todayPacific: '2026-10-29', ledger: [] })
  assert.equal(after.due.length, 1)
})

test('unstamped and non-Completed cohorts never send (no retroactive emails)', () => {
  const { due, skipped } = selectDueCohorts({
    cohorts: [
      { id: 'a', status: 'Completed', completed_at: null },
      { id: 'b', status: 'Active', completed_at: '2026-10-01T00:00:00Z' },
    ],
    todayPacific: '2026-12-01', ledger: [],
  })
  assert.equal(due.length, 0)
  assert.deepEqual(skipped.map(s => s.reason).sort(), ['no_completed_at', 'not_completed'])
})

test('one send per completion; a re-completion after the send notifies again', () => {
  const sentAfter = [{ cohort_id: 'c1', sent_at: '2026-10-26T16:05:00Z' }]
  const dedup = selectDueCohorts({ cohorts: [COHORT], todayPacific: '2026-10-27', ledger: sentAfter })
  assert.equal(dedup.due.length, 0)
  assert.equal(dedup.skipped[0].reason, 'already_sent')
  // The cohort is reverted and re-completed in November: completed_at moves
  // PAST the old send, so it is due again.
  const recompleted = { ...COHORT, completed_at: '2026-11-03T20:00:00Z' }
  const again = selectDueCohorts({ cohorts: [recompleted], todayPacific: '2026-11-04', ledger: sentAfter })
  assert.equal(again.due.length, 1)
})

// ── 3. The retirement list ──────────────────────────────────────────────────

test('only ✓ CS-Link Active holders outside Active Rotation are listed', () => {
  const students = [
    { id: 1, first_name: 'Ava', last_name: 'Adams', school: 'Cal State LA', status: 'Completed',
      cs_cedars_status: 'student', cs_link_complete: true },
    { id: 2, first_name: 'Ben', last_name: 'Baker', school: 'APU', status: 'Active Rotation',
      cs_cedars_status: 'student', cs_link_complete: true },              // still rotating: keep access
    { id: 3, first_name: 'Cara', last_name: 'Cruz', school: 'CSULB', status: 'Completed',
      cs_cedars_status: 'student', cs_stage1_complete: true },            // Account Active, not CS-Link Active
    { id: 4, first_name: 'Dan', last_name: 'Diaz', school: 'CSUN', status: 'Not Proceeding',
      cs_cedars_status: 'student', cs_link_complete: true },              // early exit WITH access: listed
    { id: 5, first_name: 'Eve', last_name: 'Egan', school: 'WCU', status: 'Completed' }, // no account at all
  ]
  const list = selectRetirementStudents(students)
  assert.deepEqual(list.map(s => s.name), ['Ava Adams', 'Dan Diaz'])
  assert.deepEqual(list[0], { id: 1, name: 'Ava Adams', school: 'Cal State LA', status: 'Completed' })
})

// ── 4. Source assertions ────────────────────────────────────────────────────

test('the migration stamps on the transition, clears on revert, and never backfills', () => {
  const sql = read('supabase/migrations/20260827000000_cohort_completed_at.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS completed_at timestamptz/)
  assert.match(sql, /IF NEW\.status = 'Completed' AND OLD\.status IS DISTINCT FROM 'Completed' THEN\s*\n\s*NEW\.completed_at := now\(\);/)
  assert.match(sql, /ELSIF NEW\.status IS DISTINCT FROM 'Completed' AND OLD\.status = 'Completed' THEN\s*\n\s*NEW\.completed_at := NULL;/)
  assert.match(sql, /BEFORE UPDATE OF status ON public\.cohorts/)
  const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(body, /UPDATE public\.cohorts SET completed_at/i, 'no backfill of pre-existing Completed cohorts')
})

test('the cron fails closed and resolves its recipient from the contact record', () => {
  const cron = read('api/cron/cohort-access-retirement.js')
  // S-12: the inline `Bearer ${process.env.CRON_SECRET}` comparison was replaced
  // by the shared fail-closed helper. Same property, one implementation.
  assert.match(cron, /isAuthorizedCronRequest\(req\)/)
  assert.match(cron, /withinSendWindow\(now\)/)
  assert.match(cron, /reason: 'schema_not_ready'/)
  // Ledger failure is a run error (duplicate-prevention cannot be skipped).
  assert.match(cron, /notification_log query error[\s\S]{0,200}?finishCronRunError/)
  // Recipient comes from the ACTIVE BNI Team contact; unresolvable = run error.
  assert.match(cron, /RECIPIENT_CONTACT_CATEGORY = 'BNI Team'/)
  assert.match(cron, /ilike\('full_name', `%\$\{RECIPIENT_CONTACT_MATCH\}%`\)/)
  assert.match(cron, /recipientErr[\s\S]{0,200}?finishCronRunError/)
  assert.match(cron, /ambiguous recipient/)
  // The cc rides along, and the list carries name/school/status only.
  assert.match(cron, /JesterLloyd\.Bautista@cshs\.org/)
  assert.match(cron, /\(\{ name, school, status \}\) => \(\{ name, school, status \}\)/)
})

test('every registration point carries the new automation', () => {
  assert.match(read('vercel.json'), /"path": "\/api\/cron\/cohort-access-retirement",\s*\n\s*"schedule": "0 16,17,18 \* \* \*"/)
  assert.match(read('src/lib/automationCatalog.js'), /id: 'cohort_access_retirement',\s*\n\s*cronName: 'cohort-access-retirement'/)
  assert.match(read('src/components/connect/AutomationView.jsx'), /id: 'cohort_access_retirement', title: 'CS-Link Access Retirement'/)
  assert.match(read('api/automation-settings.js'), /key: 'cohort_access_retirement'/)
  assert.match(read('src/lib/notifications/templates/index.js'), /cohort_access_retirement:\s+accessRetirement/)
  assert.match(read('src/lib/notifications/recipients.js'), /case 'cohort_access_retirement':/)
  assert.match(read('src/lib/notifications/previewFixtures.js'), /cohort_access_retirement: \{/)
})

test('the template renders the table and the empty-cohort variant', async () => {
  const { buildAccessRetirementEmail } = await import('../src/lib/notifications/templates/accessRetirement.js')
  const full = buildAccessRetirementEmail({
    cohortName: 'Fall 2026', recipientName: 'Arturo',
    students: [{ name: 'Ava Adams', school: 'Cal State LA', status: 'Completed' }],
  })
  assert.match(full.subject, /CS-Link access retirement - Fall 2026 \(1 student\)/)
  assert.match(full.html, /Ava Adams/)
  assert.match(full.html, /Cal State LA/)
  assert.match(full.html, /active rotation are not listed/)
  const empty = buildAccessRetirementEmail({ cohortName: 'Fall 2026', recipientName: 'Arturo', students: [] })
  assert.match(empty.subject, /no CS-Link accesses to retire/)
  assert.match(empty.html, /nothing to retire/)
  // Escaping: a name with markup renders inert.
  const hostile = buildAccessRetirementEmail({
    cohortName: 'Fall 2026', students: [{ name: '<img src=x>', school: 'X', status: 'Completed' }],
  })
  assert.doesNotMatch(hostile.html, /<img src=x>/)
})

// ── SIGNATURE-PARITY-1: every shared-path template signs with the GIF ───────

test('every notification template uses the handwritten signature (no typed holdouts)', async () => {
  const { readdirSync } = await import('node:fs')
  const dir = new URL('../src/lib/notifications/templates/', import.meta.url)
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js') || file === 'index.js' || file === 'signatures.js') continue
    const src = stripComments(read(`src/lib/notifications/templates/${file}`))
    // midpointCheckin renders its own inline GIF block; every other template
    // imports the shared helper. Either way, none may use the typed-only
    // aspireSystemSignature (that belongs to invitations/messages, not crons).
    assert.doesNotMatch(src, /aspireSystemSignature/, `${file} must not use the typed signature`)
    if (file !== 'midpointCheckin.js') {
      assert.match(src, /aspireHandwrittenSignature/, `${file} must use the handwritten signature`)
    }
  }
})
