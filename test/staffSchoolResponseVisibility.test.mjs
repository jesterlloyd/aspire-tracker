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

// SCOPE-PICKER-1: the ASPIRE cohort rows and this bounded query moved out of
// CohortPicker into the Scope picker's Internship pane. Same query, same columns, same
// display-only rule; only the file changed.
test('the cohort list uses the derived range with a bounded date-only query and never writes cohorts', () => {
  const src = read('src/components/Header/scope/InternshipCohortList.jsx')
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

test('Placement Requests school row exposes View response as a button separate from the row\'s expand control', () => {
  // HOME-1 (2026-09-24): requests by school is a DataSheet plain sheet (table canon section 8).
  // A row's expand chevron is the sheet's own button; View response is its own button in
  // its own cell, and it stops propagation, so it never expands the row.
  // Owner, 2026-09-25: the two Placement sheets mirror each other, so View response moved
  // from its own column into the school's expanded row, above its students.
  const card = read('src/components/home/PlacementCard.jsx')
  assert.match(card, /<div className="hm-pl-detail-head">\s*<button type="button" className="hm-link hm-link-sm" onClick=\{\(\) => onViewResponse\?\.\(r\.school\)\}>\s*View response/)
  const src = read('src/components/OverviewTab.jsx')
  assert.match(src, /onViewResponse=\{\(school\) => setResponseDrawerSchool\(school\)\}/)
})

test('the school row keeps its expand and collapse, and what it opens is the school\'s students', () => {
  const card = read('src/components/home/PlacementCard.jsx')
  assert.match(card, /level="plain"[\s\S]*?expandable=\{!!renderRequestDetail\}/)
  assert.match(card, /expandLabel=\{r => `\$\{r\.school\} students`\}/)
  const src = read('src/components/OverviewTab.jsx')
  assert.match(src, /const renderRequestDetail = \(row\) => <SchoolStudents school=\{row\.school\} sStudents=\{row\.list\} \/>/)
  // The batch and single Send Form actions still open Connect and write nothing here.
  assert.match(src, /handleSendSchool\(school, sStudents\)/)
  assert.match(src, /handleSendStudent\(s\)/)
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
  // The header must never write derived dates back to the cohorts table. Checked
  // across the whole Scope picker now, not just the one file that used to hold it.
  for (const f of [
    'src/components/Header/scope/InternshipCohortList.jsx',
    'src/components/Header/scope/ScopePicker.jsx',
    'src/components/Header/Header.jsx',
  ]) {
    assert.doesNotMatch(read(f), /from\('cohorts'\)/, f)
  }
})
