// STAFF-SCHOOL-RESPONSE-VISIBILITY-1: regression coverage for (1) the header cohort picker
// preferring the derived school-response range over the manual cohort dates, and (2) the read-only
// School Form Response drawer on At a Glance > Placement Requests. Pure-helper unit tests drive the
// derivation/matching/notes logic; source assertions prove the wiring (distinct query key, bounded
// header query, separate accordion vs View response buttons, honest error state, no writes).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  groupRotationRowsByCohort,
  resolveCohortPickerRange,
  matchSchoolResponse,
  collectAdditionalNotes,
} from '../src/lib/schoolResponseDisplay.js'
import { ROTATION_SENTINEL } from '../src/lib/rotationWindow.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const COHORT = { id: 'c1', name: 'Fall 2026', start_date: '2026-08-01', end_date: '2026-12-01' }

// ── Part 1: derived cohort picker range ──────────────────────────────────────

test('picker range prefers the derived school-response range over cohort dates', () => {
  const rows = [{ cohort_id: 'c1', rotation_start_date: '2026-05-04', rotation_end_date: '2026-08-18' }]
  const range = resolveCohortPickerRange(COHORT, rows)
  assert.deepEqual(range, { start: '2026-05-04', end: '2026-08-18' })  // NOT the cohort's 08-01/12-01
})

test('earliest start and latest end are used across multiple schools', () => {
  const rows = [
    { rotation_start_date: '2026-06-01', rotation_end_date: '2026-07-15' },
    { rotation_start_date: '2026-05-04', rotation_end_date: '2026-06-30' },
    { rotation_start_date: '2026-05-20', rotation_end_date: '2026-08-18' },
  ]
  assert.deepEqual(resolveCohortPickerRange(COHORT, rows), { start: '2026-05-04', end: '2026-08-18' })
})

test('sentinel and invalid rows are excluded from the derivation', () => {
  const rows = [
    { rotation_start_date: ROTATION_SENTINEL, rotation_end_date: ROTATION_SENTINEL }, // pending review
    { rotation_start_date: '2026-05-04', rotation_end_date: null },                   // missing end
    { rotation_start_date: null, rotation_end_date: '2026-09-30' },                   // missing start
    { rotation_start_date: '2026-06-01', rotation_end_date: '2026-08-01' },           // the only valid row
  ]
  assert.deepEqual(resolveCohortPickerRange(COHORT, rows), { start: '2026-06-01', end: '2026-08-01' })
})

test('existing cohort dates remain the fallback when no valid school response exists', () => {
  const sentinelOnly = [{ rotation_start_date: ROTATION_SENTINEL, rotation_end_date: ROTATION_SENTINEL }]
  assert.deepEqual(resolveCohortPickerRange(COHORT, sentinelOnly), { start: '2026-08-01', end: '2026-12-01' })
  assert.deepEqual(resolveCohortPickerRange(COHORT, []), { start: '2026-08-01', end: '2026-12-01' })
  // Neither source has dates -> null, so the picker keeps its existing blank behavior.
  assert.equal(resolveCohortPickerRange({ id: 'c2' }, []), null)
})

test('rotation rows group by cohort id and dropped rows never leak between cohorts', () => {
  const grouped = groupRotationRowsByCohort([
    { cohort_id: 'c1', rotation_start_date: '2026-05-04', rotation_end_date: '2026-08-18' },
    { cohort_id: 'c2', rotation_start_date: '2026-01-05', rotation_end_date: '2026-03-27' },
    { cohort_id: 'c1', rotation_start_date: '2026-06-01', rotation_end_date: '2026-07-01' },
    { rotation_start_date: '2026-06-01', rotation_end_date: '2026-07-01' },  // no cohort_id -> dropped
  ])
  assert.equal(grouped.c1.length, 2)
  assert.equal(grouped.c2.length, 1)
  assert.equal(Object.keys(grouped).length, 2)
})

test('CohortPicker uses the derived range with a bounded date-only query and never writes cohorts', () => {
  const src = read('src/components/Header/CohortPicker.jsx')
  assert.match(src, /resolveCohortPickerRange/)
  assert.match(src, /groupRotationRowsByCohort/)
  assert.match(src, /from\('cohort_school_rotations'\)/)
  // Bounded: exactly the three columns, no coordinator or student data in the header query.
  assert.match(src, /select\('cohort_id, rotation_start_date, rotation_end_date'\)/)
  assert.doesNotMatch(src, /coordinator_name|coordinator_email|from\('students'\)/)
  // Display-only: the picker must not write derived dates back to the cohorts table.
  assert.doesNotMatch(src, /\.update\(|\.upsert\(|\.insert\(|\.delete\(/)
})

// ── Part 2: response association + notes helpers ─────────────────────────────

const RESPONSES = [
  { id: 'rot1', school_name: 'West Coast University', scheduling_notes: 'x' },
  { id: 'rot2', school_name: 'Mount Saint Mary\'s University' },
]

test('matchSchoolResponse prefers the students\' shared cohort_school_rotation_id', () => {
  const students = [
    { cohort_school_rotation_id: 'rot2' },
    { cohort_school_rotation_id: 'rot2' },
    { cohort_school_rotation_id: null },
  ]
  // Name says WCU but the canonical shared link says rot2: the link wins.
  assert.equal(matchSchoolResponse('West Coast University', students, RESPONSES), RESPONSES[1])
})

test('matchSchoolResponse falls back to careful school-name matching', () => {
  const students = [{ cohort_school_rotation_id: null }]
  assert.equal(matchSchoolResponse('  west coast university ', students, RESPONSES), RESPONSES[0])
  assert.equal(matchSchoolResponse('Unknown School', students, RESPONSES), null)
  assert.equal(matchSchoolResponse('', students, RESPONSES), null)
})

test('additional notes are deduplicated without discarding distinct stored values', () => {
  const students = [
    { coordinators: ' Please schedule around finals week. ' },
    { coordinators: 'Please schedule around finals week.' },   // identical after trim -> deduped
    { coordinators: 'Second submission: two students added late.' },
    { coordinators: '' },
    { coordinators: null },
  ]
  assert.deepEqual(collectAdditionalNotes(students), [
    'Please schedule around finals week.',
    'Second submission: two students added late.',
  ])
  assert.deepEqual(collectAdditionalNotes([]), [])
  assert.deepEqual(collectAdditionalNotes([{ coordinators: '' }]), [])
})

// ── Part 2: wiring, drawer content, and preservation (source assertions) ─────

test('Placement Requests school row exposes View response as a button separate from the accordion toggle', () => {
  const src = read('src/components/OverviewTab.jsx')
  // Two SEPARATE controls: the toggle button and the View response button, inside a div wrapper
  // (no nested buttons, so clicking View response cannot expand/collapse the group).
  assert.match(src, /className="ov-group-row ov-school-row"/)
  assert.match(src, /className="ov-school-toggle" onClick=\{\(\) => toggleSchoolGroup\(school\)\} aria-expanded/)
  assert.match(src, /className="ov-view-response-btn"[\s\S]{0,120}setResponseDrawerSchool\(school\)/)
  assert.match(src, /e\.stopPropagation\(\); setResponseDrawerSchool\(school\)/)
  // The wrapper is a div, not a button-in-button.
  assert.doesNotMatch(src, /<button[^>]*ov-group-row ov-school-row/)
})

test('the accordion toggle keeps the original full-row hit area (badges inside, View response outside)', () => {
  const src = read('src/components/OverviewTab.jsx')
  const toggleStart = src.indexOf('className="ov-school-toggle"')
  assert.ok(toggleStart > -1, 'school toggle button exists')
  const toggleEnd = src.indexOf('</button>', toggleStart)
  const toggleJsx = src.slice(toggleStart, toggleEnd)
  // School info, coordinator line, placement badge, and student-count badge all live INSIDE the
  // toggle, so clicking any of them expands/collapses the group exactly as before this feature.
  assert.match(toggleJsx, /ov-chevron/)
  assert.match(toggleJsx, /ov-group-name/)
  assert.match(toggleJsx, /ov-coord-line/)
  assert.match(toggleJsx, /placed/)
  assert.match(toggleJsx, /ov-group-badge/)
  // View response is NOT inside the toggle - it is the next sibling button in the wrapper.
  assert.doesNotMatch(toggleJsx, /ov-view-response-btn/)
  const afterToggle = src.slice(toggleEnd, toggleEnd + 400)
  assert.match(afterToggle, /ov-view-response-btn/)
})

test('full-detail query uses its own key and does not collide with the date-only consumers', () => {
  const src = read('src/components/OverviewTab.jsx')
  assert.match(src, /queryKey: \['cohort_school_responses', cohortId\]/)
  assert.doesNotMatch(src, /queryKey: \['cohort_rotation_range'/)
  // The date-only consumers keep their key untouched.
  assert.match(read('src/components/CohortBar.jsx'), /queryKey: \['cohort_rotation_range', activeCohortId\]/)
  assert.match(read('src/components/ManageCohortModal.jsx'), /queryKey: \['cohort_rotation_range', cohort\?\.id\]/)
})

test('full-detail query selects an explicit allowlist, never * and never audit columns', () => {
  const src = read('src/components/OverviewTab.jsx')
  // The exact slice of the school-responses query: from the allowlist constant through the queryFn.
  const start = src.indexOf('SCHOOL_RESPONSE_FIELDS')
  assert.ok(start > -1, 'allowlist constant exists')
  const slice = src.slice(start, src.indexOf("['unit_leaders_all']"))
  // Every field the association + drawer require is allowlisted.
  for (const field of [
    "'id'", "'cohort_id'", "'school_name'", "'coordinator_name'", "'coordinator_email'",
    "'rotation_start_date'", "'rotation_end_date'",
    "'unavailable_weekdays'", "'min_days_per_week'", "'weekends_allowed'", "'nights_allowed'",
    "'blackout_dates'", "'scheduling_notes'", "'created_at'", "'updated_at'",
  ]) {
    assert.ok(slice.includes(field), `allowlist includes ${field}`)
  }
  // The query uses the allowlist - never select('*') and never the audit columns.
  assert.match(slice, /\.select\(SCHOOL_RESPONSE_FIELDS\)/)
  assert.doesNotMatch(slice, /\.select\('\*'\)/)
  assert.doesNotMatch(slice, /created_by|updated_by/)
})

test('drawer renders every school-level section and all student submission fields', () => {
  const src = read('src/components/SchoolResponseDrawer.jsx')
  for (const section of ['Submission Details', 'Rotation Window', 'Rotation Availability', 'Students Submitted', 'Additional Notes']) {
    assert.match(src, new RegExp(section))
  }
  for (const label of [
    'School / University', 'Placement coordinator', 'Coordinator email', 'First submitted', 'Last updated',
    'Rotation start date', 'Rotation end date',
    'Generally unavailable weekdays', 'Minimum clinical days per week', 'Weekend rotations allowed',
    'Night shifts allowed', 'Blackout dates / academic breaks', 'Scheduling notes',
    'School email', 'Phone', 'Program type', 'Hours required', 'Estimated graduation',
  ]) {
    assert.match(src, new RegExp(label.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')))
  }
  // created_at / updated_at are the submission timestamps.
  assert.match(src, /response\.created_at/)
  assert.match(src, /response\.updated_at/)
})

test('drawer renders missing values honestly and never shows the 1900-01-01 sentinel', () => {
  const src = read('src/components/SchoolResponseDrawer.jsx')
  assert.match(src, /Not provided/)
  assert.match(src, /Pending coordinator\/admin review/)
  assert.match(src, /canonicalRotationWindow/)   // sentinel/invalid windows -> null -> pending message
  assert.doesNotMatch(src, /1900-01-01/)
  // Null-safe display helpers are reused, not reimplemented.
  assert.match(src, /formatWeekdays.*formatMinDays.*formatBooleanYesNo.*formatDates.*formatText|from '\.\.\/lib\/availability'/s)
})

test('drawer has an honest non-blocking error state with Retry and is keyboard dismissible', () => {
  const drawer = read('src/components/SchoolResponseDrawer.jsx')
  assert.match(drawer, /role="alert"/)
  assert.match(drawer, /Retry/)
  assert.match(drawer, /could not load/)
  assert.match(drawer, /e\.key === 'Escape'/)
  // OverviewTab keeps the list usable: the drawer opens by school NAME, with error + retry passed in.
  const overview = read('src/components/OverviewTab.jsx')
  assert.match(overview, /error=\{schoolResponsesError\}/)
  assert.match(overview, /onRetry=\{refetchSchoolResponses\}/)
})

test('no write, edit, authorization, or schema behavior was added', () => {
  const drawer = read('src/components/SchoolResponseDrawer.jsx')
  // Pure presentational: no supabase client, no mutations, no placement/status controls.
  assert.doesNotMatch(drawer, /supabase|\.update\(|\.insert\(|\.upsert\(|\.delete\(|useMutation/)
  const overview = read('src/components/OverviewTab.jsx')
  // The new query is a read-only select on cohort_school_rotations.
  const newQuery = overview.slice(overview.indexOf("['cohort_school_responses'"), overview.indexOf("['cohort_school_responses'") + 600)
  assert.match(newQuery, /from\('cohort_school_rotations'\)/)
  assert.doesNotMatch(newQuery, /\.update\(|\.insert\(|\.upsert\(|\.delete\(/)
  const picker = read('src/components/Header/CohortPicker.jsx')
  assert.doesNotMatch(picker, /from\('cohorts'\)/)  // never writes derived dates back
})
