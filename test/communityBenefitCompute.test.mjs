// NURSING-ACADEMICS-1: the community-benefit compute module.
// Pure unit tests. No network, no live database, no email.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fiscalYearOfDate,
  fiscalYearRange,
  currentFiscalYear,
  tripleMatchedRotation,
  summarizeShiftHours,
  estimateBenefit,
  activeRatesForFiscalYear,
  buildCommunityBenefit,
  buildAggregateRows,
  buildAggregateCsv,
  AGGREGATE_CSV_HEADERS,
  COUNTED_SHIFT_STATUSES,
  PLACEMENT_STATUSES,
  EXITED_STATUSES,
  REPORT_CANDIDATE_STATUSES,
} from '../lib/server/communityBenefit/compute.js'

// ── Fiscal-year math ─────────────────────────────────────────────────────────

test('fiscal year boundary: June 30 closes the year, July 1 opens the next', () => {
  assert.equal(fiscalYearOfDate('2026-06-30'), 2026)
  assert.equal(fiscalYearOfDate('2026-07-01'), 2027)
  assert.equal(fiscalYearOfDate('2027-06-30'), 2027)
  assert.equal(fiscalYearOfDate('2026-12-31'), 2027)
  assert.equal(fiscalYearOfDate('2026-01-01'), 2026)
})

test('sentinel and malformed dates never resolve to a fiscal year', () => {
  assert.equal(fiscalYearOfDate('1900-01-01'), null)
  assert.equal(fiscalYearOfDate(null), null)
  assert.equal(fiscalYearOfDate(''), null)
  assert.equal(fiscalYearOfDate('not-a-date'), null)
  assert.equal(fiscalYearOfDate('2026-13-01'), null)
})

test('FY 2027 spans 2026-07-01 through 2027-06-30 (labeled by ending year)', () => {
  assert.deepEqual(fiscalYearRange(2027), { start: '2026-07-01', end: '2027-06-30' })
  assert.equal(fiscalYearRange('junk'), null)
})

test('currentFiscalYear derives from the Pacific day', () => {
  // 2027-07-01T12:00Z is 2027-07-01 in Los Angeles -> FY 2028.
  assert.equal(currentFiscalYear(new Date('2027-07-01T12:00:00Z')), 2028)
  // 2027-07-01T03:00Z is still 2027-06-30 in Los Angeles -> FY 2027.
  assert.equal(currentFiscalYear(new Date('2027-07-01T03:00:00Z')), 2027)
})

// ── Rotation linkage ─────────────────────────────────────────────────────────

const ROT = { id: 'r1', cohort_id: 'c1', school_name: 'UCLA', rotation_start_date: '2026-08-01', rotation_end_date: '2026-11-15' }
const rotMap = new Map([[ROT.id, ROT]])
const student = (over = {}) => ({
  id: 's1', first_name: 'Ann', last_name: 'Lee', school: 'UCLA', status: 'Completed',
  cohort_id: 'c1', cohort_school_rotation_id: 'r1', program_type: 'MECN',
  course_type: null, hours_required: 144, approved_hours: 60, matched_preceptor: '', ...over,
})

test('the triple match requires FK, cohort agreement, and exact school agreement', () => {
  assert.equal(tripleMatchedRotation(student(), rotMap), ROT)
  assert.equal(tripleMatchedRotation(student({ cohort_id: 'c2' }), rotMap), null)
  assert.equal(tripleMatchedRotation(student({ school: 'Cal State LA' }), rotMap), null)
  assert.equal(tripleMatchedRotation(student({ cohort_school_rotation_id: null }), rotMap), null)
})

// ── Hour buckets ─────────────────────────────────────────────────────────────

test('only completed Auto-Accepted and Approved hours count; every other bucket is tracked, not counted', () => {
  assert.deepEqual(COUNTED_SHIFT_STATUSES, ['Auto-Accepted', 'Approved'])
  const hours = summarizeShiftHours([
    { student_id: 's1', total_hours: 12, status: 'Auto-Accepted', lifecycle_state: 'completed' },
    { student_id: 's1', total_hours: 8, status: 'Approved', lifecycle_state: 'completed' },
    { student_id: 's1', total_hours: 10, status: 'Pending Review', lifecycle_state: 'completed' },
    { student_id: 's1', total_hours: 6, status: 'Rejected', lifecycle_state: 'completed' },
    { student_id: 's1', total_hours: 12, status: 'Approved', lifecycle_state: 'voided' },
    { student_id: 's1', total_hours: null, status: 'Approved', lifecycle_state: 'in_progress' },
    { student_id: 's1', total_hours: null, status: 'Approved', lifecycle_state: 'completed' },
  ]).get('s1')
  assert.equal(hours.approved, 20)
  assert.equal(hours.pending, 10)
  assert.equal(hours.rejected, 6)
  assert.equal(hours.voided, 12)
  assert.equal(hours.inProgress, 1)
})

// ── Benefit math ─────────────────────────────────────────────────────────────

test('standard benefit is approved hours x rate; a missing rate is null, never a guess', () => {
  assert.equal(estimateBenefit(60, 65), 3900)
  assert.equal(estimateBenefit(600, 65), 39000)
  assert.equal(estimateBenefit(60, null), null)
})

test('active rates resolve per fiscal year and category; superseded rows are ignored', () => {
  const rates = activeRatesForFiscalYear([
    { fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, superseded_at: null },
    { fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 60, superseded_at: '2026-08-01T00:00:00Z' },
    { fiscal_year: 2027, category: 'management', hourly_rate: 90, superseded_at: null },
    { fiscal_year: 2026, category: 'rn_preceptor', hourly_rate: 55, superseded_at: null },
  ], 2027)
  assert.equal(rates.rn_preceptor.hourly_rate, 65)
  assert.equal(rates.management.hourly_rate, 90)
})

// ── The full report ──────────────────────────────────────────────────────────

function buildFixture(over = {}) {
  return buildCommunityBenefit({
    fiscalYear: 2027,
    students: [student()],
    rotations: [ROT],
    cohortNamesById: new Map([['c1', 'Fall 2026']]),
    shiftHoursById: new Map([['s1', { approved: 60, pending: 0, rejected: 0, voided: 0, inProgress: 0 }]]),
    preceptorNameById: new Map([['s1', { name: 'Pat Preceptor, RN', source: 'assignment' }]]),
    rateRows: [
      { fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, superseded_at: null },
      { fiscal_year: 2027, category: 'management', hourly_rate: 90, superseded_at: null },
    ],
    capstoneRows: [{ id: 'cap1', fiscal_year: 2027, school_name: 'UCLA', hours: 100, voided_at: null }],
    ...over,
  })
}

test('the rotation is assigned WHOLE to the fiscal year containing rotation_end_date', () => {
  // Start date in FY 2027, end date in FY 2027 -> the whole rotation is FY 2027.
  const report = buildFixture()
  assert.equal(report.totals.students, 1)
  assert.equal(report.detail_rows[0].rotation_end, '2026-11-15')
  // The same data asked for FY 2026 contains nothing (no proration).
  const other = buildFixture({ fiscalYear: 2026 })
  assert.equal(other.totals.students, 0)
})

test('standard and capstone benefits compute independently and never mix hours', () => {
  const report = buildFixture()
  assert.equal(report.totals.approved_hours, 60)
  assert.equal(report.totals.standard_benefit, 3900)      // 60 x $65
  assert.equal(report.totals.capstone_hours, 100)
  assert.equal(report.totals.capstone_benefit, 9000)      // 100 x $90
  assert.equal(report.totals.total_benefit, 12900)
  // Capstone hours are NOT allocated to the student row.
  assert.equal(report.detail_rows[0].approved_hours, 60)
})

test('hours beyond the requirement count in full; benefit never multiplies required hours', () => {
  const report = buildFixture({
    shiftHoursById: new Map([['s1', { approved: 200, pending: 0, rejected: 0, voided: 0, inProgress: 0 }]]),
  })
  assert.equal(report.detail_rows[0].required_hours, 144)
  assert.equal(report.detail_rows[0].approved_hours, 200)
  assert.equal(report.detail_rows[0].estimated_benefit, 13000) // 200 x 65, not 144 x 65
})

test('a missing rate renders null benefits everywhere, never invented numbers', () => {
  const report = buildFixture({ rateRows: [] })
  assert.equal(report.rates.rn_preceptor, null)
  assert.equal(report.totals.standard_benefit, null)
  assert.equal(report.totals.total_benefit, null)
  assert.equal(report.detail_rows[0].estimated_benefit, null)
})

test('the total stays unavailable until every category with hours has its rate', () => {
  const missingManagement = buildFixture({
    rateRows: [{ fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, superseded_at: null }],
  })
  assert.equal(missingManagement.totals.standard_benefit, 3900)
  assert.equal(missingManagement.totals.capstone_benefit, null)
  assert.equal(missingManagement.totals.total_benefit, null)

  const capstoneOnly = buildFixture({
    students: [],
    shiftHoursById: new Map(),
    rateRows: [{ fiscal_year: 2027, category: 'management', hourly_rate: 90, superseded_at: null }],
  })
  assert.equal(capstoneOnly.totals.standard_benefit, 0)
  assert.equal(capstoneOnly.totals.capstone_benefit, 9000)
  assert.equal(capstoneOnly.totals.total_benefit, 9000)
  assert.ok(capstoneOnly.available_fiscal_years.includes(2027))
})

test('sentinel end dates land in needs_data and are excluded from totals', () => {
  const sentinelRot = { ...ROT, rotation_end_date: '1900-01-01' }
  const report = buildFixture({ rotations: [sentinelRot] })
  assert.equal(report.totals.students, 0)
  assert.equal(report.needs_data.length, 1)
  assert.equal(report.needs_data[0].reason, 'missing_rotation_end_date')
})

test('a drifted rotation link (cohort/school mismatch) is surfaced, not reported against stale dates', () => {
  const report = buildFixture({ students: [student({ school: 'Cal State LA' })] })
  assert.equal(report.totals.students, 0)
  assert.equal(report.needs_data[0].reason, 'rotation_link_mismatch')
})

test('a placement with no rotation link at all is surfaced too', () => {
  const report = buildFixture({ students: [student({ cohort_school_rotation_id: null })] })
  assert.equal(report.needs_data[0].reason, 'missing_rotation_link')
})

test('rejected/voided hours surface in review_records instead of silently disappearing', () => {
  const report = buildFixture({
    shiftHoursById: new Map([['s1', { approved: 40, pending: 4, rejected: 8, voided: 12, inProgress: 0 }]]),
  })
  assert.equal(report.review_records.length, 1)
  assert.equal(report.review_records[0].rejected_hours, 8)
  assert.equal(report.review_records[0].voided_hours, 12)
  // Approved totals still exclude them.
  assert.equal(report.totals.approved_hours, 40)
})

test('review records are limited to the selected fiscal year', () => {
  const oldRotation = { ...ROT, id: 'r2', rotation_start_date: '2025-08-01', rotation_end_date: '2025-11-15' }
  const report = buildFixture({
    students: [student(), student({ id: 's2', cohort_school_rotation_id: 'r2' })],
    rotations: [ROT, oldRotation],
    shiftHoursById: new Map([
      ['s1', { approved: 40, pending: 0, rejected: 8, voided: 0, inProgress: 0 }],
      ['s2', { approved: 30, pending: 0, rejected: 6, voided: 0, inProgress: 0 }],
    ]),
  })
  assert.equal(report.review_records.length, 1)
  assert.equal(report.review_records[0].student_name, 'Ann Lee')
})

test('Not Proceeding students count only when they completed approved hours', () => {
  assert.deepEqual(EXITED_STATUSES, ['Not Proceeding', 'Declined'])
  assert.deepEqual(REPORT_CANDIDATE_STATUSES, [
    'Placed', 'Active Rotation', 'Completed', 'Not Proceeding', 'Declined',
  ])
  const report = buildFixture({
    students: [
      student({ id: 's0', first_name: 'Zero', status: 'Not Proceeding', approved_hours: 0 }),
      student({ id: 's1', first_name: 'Partial', status: 'Not Proceeding', approved_hours: 12 }),
    ],
    shiftHoursById: new Map([
      ['s0', { approved: 0, pending: 0, rejected: 0, voided: 0, inProgress: 0 }],
      ['s1', { approved: 12, pending: 0, rejected: 0, voided: 0, inProgress: 0 }],
    ]),
    capstoneRows: [],
  })
  assert.equal(report.totals.students, 1)
  assert.equal(report.totals.approved_hours, 12)
  assert.equal(report.totals.standard_benefit, 780)
  assert.equal(report.detail_rows[0].student_name, 'Partial Lee')
  assert.equal(report.detail_rows[0].status, 'Not Proceeding')
})

test('students are counted DISTINCT by student record, and excluded statuses never enter', () => {
  assert.deepEqual(PLACEMENT_STATUSES, ['Placed', 'Active Rotation', 'Completed'])
  const report = buildFixture({
    students: [
      student(),
      student({ id: 's2', first_name: 'Bo', status: 'Declined' }),
      student({ id: 's3', first_name: 'Cy', status: 'Form Sent' }),
    ],
    shiftHoursById: new Map([['s1', { approved: 60, pending: 0, rejected: 0, voided: 0, inProgress: 0 }]]),
  })
  assert.equal(report.totals.students, 1)
})

test('unclassified course types render as Unclassified; real values pass through', () => {
  const report = buildFixture({
    students: [student(), student({ id: 's2', first_name: 'Bo', course_type: 'Capstone / Preceptorship' })],
  })
  const courses = report.detail_rows.map(r => r.course_type).sort()
  assert.deepEqual(courses, ['Capstone / Preceptorship', 'Unclassified'])
})

test('the projection cross-check flags a mismatch instead of trusting either number silently', () => {
  const matching = buildFixture()
  assert.equal(matching.detail_rows[0].projection_matches, true)
  const drifted = buildFixture({ students: [student({ approved_hours: 12 })] })
  assert.equal(drifted.detail_rows[0].projection_matches, false)
  assert.equal(drifted.detail_rows[0].approved_hours, 60) // authoritative shift-log total shown
})

test('legacy preceptor text is a labeled fallback, never silently blended', () => {
  const report = buildFixture({ preceptorNameById: new Map([['s1', { name: 'Old Text Name', source: 'legacy' }]]) })
  assert.equal(report.detail_rows[0].preceptor_source, 'legacy')
})

// ── Aggregate CSV privacy contract ───────────────────────────────────────────

test('aggregate rows: one per school+program+course type per category, with Management capstone rows', () => {
  const report = buildFixture({
    students: [
      student(),
      student({ id: 's2', first_name: 'Bo', course_type: 'Capstone / Preceptorship' }),
      student({ id: 's3', first_name: 'Cy' }),
    ],
    shiftHoursById: new Map([
      ['s1', { approved: 60, pending: 0, rejected: 0, voided: 0, inProgress: 0 }],
      ['s2', { approved: 30, pending: 0, rejected: 0, voided: 0, inProgress: 0 }],
      ['s3', { approved: 10, pending: 0, rejected: 0, voided: 0, inProgress: 0 }],
    ]),
  })
  const rows = buildAggregateRows(report)
  const rn = rows.filter(r => r.benefit_category === 'RN Preceptor')
  const mgmt = rows.filter(r => r.benefit_category === 'Management')
  assert.equal(rn.length, 2)   // Unclassified group (2 students) + Capstone group (1 student)
  assert.equal(mgmt.length, 1) // one capstone school
  const unclassified = rn.find(r => r.course_type === 'Unclassified')
  assert.equal(unclassified.student_count, 2)
  assert.equal(unclassified.approved_hours, 70)
  assert.equal(unclassified.benefit, 4550) // 70 x 65
  assert.equal(mgmt[0].preceptor_type, 'Management')
  assert.equal(mgmt[0].student_count, 0)
  assert.equal(mgmt[0].capstone_hours, 100)
  assert.equal(mgmt[0].benefit, 9000)
})

test('the CSV carries exactly the recommended headers and NO identifying data', () => {
  const report = buildFixture({
    students: [student({ first_name: 'Zephyrine', last_name: 'Quixote' })],
    preceptorNameById: new Map([['s1', { name: 'Perpetua Nightwatch, RN', source: 'assignment' }]]),
  })
  const csv = buildAggregateCsv(report)
  const lines = csv.trim().split('\n')
  assert.equal(lines[0], AGGREGATE_CSV_HEADERS.join(','))
  assert.deepEqual(AGGREGATE_CSV_HEADERS, [
    'Fiscal Year', 'School', 'Program', 'Course Type', 'Benefit Category', 'Preceptor Type',
    'Student Count', 'Required Hours', 'Approved Actual Hours', 'Additional Capstone Hours',
    'Applied Hourly Rate', 'Estimated Nursing Benefit',
  ])
  // No student name, no preceptor name, no emails, no uuids, no shift rows.
  assert.ok(!csv.includes('Zephyrine'))
  assert.ok(!csv.includes('Quixote'))
  assert.ok(!csv.includes('Nightwatch'))
  assert.ok(!csv.includes('@'))
  assert.doesNotMatch(csv, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  assert.ok(!/shift/i.test(csv))
  // One RN Preceptor row for the single school/program/course group + 1 Management row.
  assert.equal(lines.length, 3)
})

test('the CSV neutralizes spreadsheet formula prefixes in text cells', () => {
  const csv = buildAggregateCsv({
    fiscal_year_label: 'FY 2027',
    rates: { rn_preceptor: { hourly_rate: 65 }, management: null },
    detail_rows: [{
      school: '=HYPERLINK("https://example.com")', program: '+BSN', course_type: '@Course',
      required_hours: 60, approved_hours: 60,
    }],
    by_school: [],
  })
  assert.match(csv, /'=/)
  assert.match(csv, /'\+BSN/)
  assert.match(csv, /'@Course/)
})

test('a missing rate leaves the rate and benefit CSV cells blank instead of zero', () => {
  const report = buildFixture({ rateRows: [] })
  const csv = buildAggregateCsv(report)
  const dataLine = csv.trim().split('\n')[1]
  assert.ok(dataLine.endsWith(',,'), 'rate and benefit cells must be empty')
})
