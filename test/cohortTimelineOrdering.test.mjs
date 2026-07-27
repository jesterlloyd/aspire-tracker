// Portal cohort polish, Commit 1: the canonical cohort timeline ordering helper, shared by the
// Academic Partner and Unit Leader portals. Proves Summer 2026 precedes Fall 2026 by timeline, active
// precedes upcoming, upcoming ascends by start date, historical descends, aggregate options come after
// real cohorts, and there is no alphabetical regression. Also proves AP + UL consume the shared helper.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { orderCohortsByTimeline, cohortLifecycle, currentCohorts } from '../src/lib/derivations/cohortOrder.js'
import { cohortOptions, submissionCohortOptions, AP_ALL, AP_ALL_CURRENT } from '../src/portal/ap/academicPartnerRoster.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const SUMMER = { id: 'summer', name: 'Summer 2026', status: 'Active', start_date: '2026-06-01', accepting_submissions: false, created_at: '2026-02-01' }
const FALL = { id: 'fall', name: 'Fall 2026', status: 'Planning', start_date: '2026-09-01', accepting_submissions: true, created_at: '2026-05-01' }
const FALL25 = { id: 'fall25', name: 'Fall 2025', status: 'Completed', start_date: '2025-09-01', accepting_submissions: false, created_at: '2025-05-01' }
const SPRING25 = { id: 'spring25', name: 'Spring 2025', status: 'Completed', start_date: '2025-01-15', accepting_submissions: false, created_at: '2024-11-01' }

test('Summer 2026 sorts before Fall 2026 by timeline, not alphabetically', () => {
  // Alphabetical would put Fall first; timeline (Active before Planning) puts Summer first.
  const ordered = orderCohortsByTimeline([FALL, SUMMER])
  assert.deepEqual(ordered.map(c => c.id), ['summer', 'fall'])
})

test('active cohorts precede upcoming cohorts', () => {
  const ordered = orderCohortsByTimeline([FALL, SUMMER, FALL25])
  assert.equal(ordered[0].id, 'summer')            // Active first
  assert.equal(cohortLifecycle(ordered[0]), 'current')
  assert.equal(cohortLifecycle(ordered[1]), 'upcoming')
})

test('upcoming cohorts are ordered by ASCENDING start date (soonest first)', () => {
  const early = { id: 'e', name: 'B early', status: 'Planning', start_date: '2026-08-01' }
  const late = { id: 'l', name: 'A late', status: 'Planning', start_date: '2026-11-01' }
  const ordered = orderCohortsByTimeline([late, early])
  assert.deepEqual(ordered.map(c => c.id), ['e', 'l'])   // by date, not by name ('A late' would win alpha)
})

test('historical cohorts are ordered by DESCENDING start date (most recent first)', () => {
  const ordered = orderCohortsByTimeline([SPRING25, FALL25])
  assert.deepEqual(ordered.map(c => c.id), ['fall25', 'spring25'])
})

test('full timeline: current -> upcoming -> historical(desc)', () => {
  const ordered = orderCohortsByTimeline([FALL25, FALL, SPRING25, SUMMER])
  assert.deepEqual(ordered.map(c => c.id), ['summer', 'fall', 'fall25', 'spring25'])
})

test('missing start dates sort last within their group, deterministically', () => {
  const dated = { id: 'd', name: 'Planning Dated', status: 'Planning', start_date: '2026-08-01', created_at: '2026-01-01' }
  const undated = { id: 'u', name: 'Planning Undated', status: 'Planning', start_date: '', created_at: '2026-01-01' }
  const ordered = orderCohortsByTimeline([undated, dated])
  assert.deepEqual(ordered.map(c => c.id), ['d', 'u'])
})

test('currentCohorts returns only Active cohorts in timeline order', () => {
  const active2 = { id: 'a2', name: 'Active Two', status: 'Active', start_date: '2026-07-01' }
  const current = currentCohorts([FALL, SUMMER, active2, FALL25])
  assert.deepEqual(current.map(c => c.id), ['summer', 'a2'])   // both Active, start ASC
})

test('AP Students options: aggregates come after real cohorts; default is the newest Active cohort', () => {
  const active2 = { id: 'a2', name: 'Active Two', status: 'Active', start_date: '2026-07-01' }
  const { options, defaultId } = cohortOptions([FALL, SUMMER, active2, FALL25])
  // With >1 Active, "All Current Cohorts" leads; real cohorts in timeline order; "All Cohorts" last.
  assert.equal(options[0].id, AP_ALL_CURRENT)
  assert.deepEqual(options.slice(1).map(o => o.id), ['summer', 'a2', 'fall', 'fall25', AP_ALL])
  // Newest Active by start date is 'a2' (2026-07 > 2026-06), even though it appears second in the list.
  assert.equal(defaultId, 'a2')
})

test('AP Students options with a single Active cohort: no All-Current aggregate, default is that cohort', () => {
  const { options, defaultId } = cohortOptions([SUMMER, FALL, FALL25])
  assert.ok(!options.some(o => o.id === AP_ALL_CURRENT))
  assert.equal(defaultId, 'summer')
  assert.equal(options[options.length - 1].id, AP_ALL)
})

test('AP submission options are accepting-only, timeline-ordered, and never include an All target', () => {
  const { options, defaultId } = submissionCohortOptions([FALL, SUMMER, FALL25])
  assert.deepEqual(options.map(o => o.id), ['fall'])   // only Fall is accepting_submissions
  assert.equal(defaultId, 'fall')
  assert.ok(!options.some(o => o.id === AP_ALL || o.id === AP_ALL_CURRENT))
})

test('the Academic Partner roster and the Unit Leader cohort scope both consume the shared helper', () => {
  const roster = read('src/portal/ap/academicPartnerRoster.js')
  assert.match(roster, /import \{ orderCohortsByTimeline \} from '\.\.\/\.\.\/lib\/derivations\/cohortOrder\.js'/)
  const ulScope = read('src/portal/unit/unitCohortScope.js')
  assert.match(ulScope, /from '\.\.\/\.\.\/lib\/derivations\/cohortOrder\.js'/)
})
