// COMMUNITY-BENEFIT-1: pure fiscal-year community-benefit computation.
//
// The ONE place the Nursing Academics fiscal-year report is computed. The
// portal endpoint, the aggregate CSV export, and the unit tests all consume
// these helpers; nothing else re-derives fiscal years, hour buckets, or
// benefit math. Pure functions, no I/O.
//
// LOCKED RULES this module enforces:
//   - Fiscal year runs July 1 to June 30 and is labeled by its ENDING year
//     (FY 2027 = 2026-07-01 through 2027-06-30).
//   - A student's entire rotation is assigned to the fiscal year containing
//     the triple-matched cohort_school_rotations row's rotation_end_date.
//     Never prorated across fiscal years.
//   - The 1900-01-01 sentinel and missing dates mean UNAVAILABLE: those
//     records land in the needs-reporting-data panel and are excluded from
//     fiscal totals until corrected, never silently omitted.
//   - Actual hours are the authoritative shift-log recomputation (lifecycle
//     completed, status Auto-Accepted or Approved, non-null hours), the same
//     formula the database RPCs use for students.approved_hours. Pending
//     Review, in-progress, and voided hours never count. Hours beyond the
//     requirement count in full; benefit is NEVER multiplied by required
//     hours.
//   - Students are counted DISTINCT by student id (unit assignments are
//     never joined, so multi-unit students cannot double-count).
//   - Placed, Active Rotation, and Completed students are reportable.
//     Not Proceeding and legacy Declined students are reportable only when
//     they have approved actual hours; zero-hour exits do not contribute.
//   - Capstone hours are an owner-entered aggregate per fiscal year + school,
//     never allocated to students and never combined with shift logs.
//   - A missing rate means "rate not set": benefit renders as unavailable,
//     never invented.

export const ROTATION_SENTINEL = '1900-01-01'
export const COUNTED_SHIFT_STATUSES = Object.freeze(['Auto-Accepted', 'Approved'])
export const PLACEMENT_STATUSES = Object.freeze(['Placed', 'Active Rotation', 'Completed'])
export const EXITED_STATUSES = Object.freeze(['Not Proceeding', 'Declined'])
export const REPORT_CANDIDATE_STATUSES = Object.freeze([
  ...PLACEMENT_STATUSES,
  ...EXITED_STATUSES,
])
export const RATE_CATEGORIES = Object.freeze(['rn_preceptor', 'management'])
export const BENEFIT_CATEGORY_LABELS = Object.freeze({
  rn_preceptor: 'RN Preceptor',
  management: 'Management',
})
export const UNCLASSIFIED_COURSE = 'Unclassified'

// ── Fiscal-year math ─────────────────────────────────────────────────────────

// 'YYYY-MM-DD' (real, non-sentinel) -> fiscal year ENDING-year integer, else null.
export function fiscalYearOfDate(ymd) {
  if (!ymd || typeof ymd !== 'string' || ymd === ROTATION_SENTINEL) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!year || !month || month < 1 || month > 12) return null
  return month >= 7 ? year + 1 : year
}

// FY ending-year integer -> inclusive { start, end } in YYYY-MM-DD.
export function fiscalYearRange(fiscalYear) {
  const fy = Number(fiscalYear)
  if (!Number.isInteger(fy)) return null
  return { start: `${fy - 1}-07-01`, end: `${fy}-06-30` }
}

export function fiscalYearLabel(fiscalYear) {
  return `FY ${fiscalYear}`
}

// Today's fiscal year on the Pacific day boundary (the house precedent from
// 20260821130000_automatic_student_completion.sql).
export function currentFiscalYear(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  return fiscalYearOfDate(ymd)
}

// ── Rotation linkage ─────────────────────────────────────────────────────────

// The canonical triple match (FK + cohort agreement + exact school-string
// agreement), mirroring 20260821130000_automatic_student_completion.sql. A
// drifted link (student moved cohorts/schools after the FK was set) does NOT
// match; the student then surfaces in the needs-data panel instead of being
// reported against stale dates.
export function tripleMatchedRotation(student, rotationById) {
  if (!student?.cohort_school_rotation_id) return null
  const r = rotationById.get(student.cohort_school_rotation_id)
  if (!r) return null
  if (!student.cohort_id || r.cohort_id !== student.cohort_id) return null
  if (String(r.school_name || '') !== String(student.school || '')) return null
  return r
}

// ── Hour buckets ─────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const round2 = (v) => Math.round(v * 100) / 100

// Per-student hour buckets from raw shift-log rows. `approved` follows the
// canonical database formula exactly; the other buckets exist so hours that
// were worked and later changed status stay VISIBLE (review panel) instead of
// silently disappearing.
export function summarizeShiftHours(shiftLogs) {
  const byStudent = new Map()
  for (const log of shiftLogs || []) {
    const sid = log?.student_id
    if (!sid) continue
    let bucket = byStudent.get(sid)
    if (!bucket) {
      bucket = { approved: 0, pending: 0, rejected: 0, voided: 0, inProgress: 0 }
      byStudent.set(sid, bucket)
    }
    const hours = log.total_hours == null ? null : num(log.total_hours)
    const lifecycle = log.lifecycle_state || 'completed'
    if (lifecycle === 'voided') {
      if (hours != null) bucket.voided = round2(bucket.voided + hours)
      continue
    }
    if (lifecycle === 'in_progress') {
      bucket.inProgress += 1
      continue
    }
    if (lifecycle !== 'completed' || hours == null) continue
    if (COUNTED_SHIFT_STATUSES.includes(log.status)) {
      bucket.approved = round2(bucket.approved + hours)
    } else if (log.status === 'Pending Review') {
      bucket.pending = round2(bucket.pending + hours)
    } else if (log.status === 'Rejected') {
      bucket.rejected = round2(bucket.rejected + hours)
    }
  }
  return byStudent
}

// ── Benefit math ─────────────────────────────────────────────────────────────

// hours x rate, or null when the rate is not set (never invent a number).
export function estimateBenefit(hours, hourlyRate) {
  if (hourlyRate == null) return null
  return round2(num(hours) * num(hourlyRate))
}

// Active-rate lookup: { rn_preceptor: rateRow|null, management: rateRow|null }
// for one fiscal year, from community_benefit_rates rows (active = not
// superseded).
export function activeRatesForFiscalYear(rateRows, fiscalYear) {
  const out = { rn_preceptor: null, management: null }
  for (const row of rateRows || []) {
    if (row?.superseded_at) continue
    if (Number(row?.fiscal_year) !== Number(fiscalYear)) continue
    if (!RATE_CATEGORIES.includes(row.category)) continue
    out[row.category] = row
  }
  return out
}

const displayName = (student) => {
  const first = String(student?.first_name || '').trim()
  const last = String(student?.last_name || '').trim()
  const joined = `${first} ${last}`.trim()
  return joined || String(student?.name || '').trim() || 'Unnamed student'
}

const courseTypeOf = (student) =>
  String(student?.course_type || '').trim() || UNCLASSIFIED_COURSE

// ── The report ───────────────────────────────────────────────────────────────

/**
 * Build the complete fiscal-year community-benefit payload.
 *
 * Inputs are plain rows (already fetched, already allowlisted by the caller):
 *   students          students rows (REPORT_CANDIDATE_STATUSES only)
 *   rotations         cohort_school_rotations rows
 *   cohortNamesById   Map cohort_id -> cohort name
 *   shiftHoursById    Map student_id -> summarizeShiftHours bucket
 *   preceptorNameById Map student_id -> { name, source: 'assignment'|'legacy' }
 *   rateRows          community_benefit_rates rows (all fiscal years)
 *   capstoneRows      community_benefit_capstone_hours rows (unvoided)
 *   fiscalYear        the requested FY ending year (integer)
 */
export function buildCommunityBenefit({
  students = [],
  rotations = [],
  cohortNamesById = new Map(),
  shiftHoursById = new Map(),
  preceptorNameById = new Map(),
  rateRows = [],
  capstoneRows = [],
  fiscalYear,
}) {
  const rotationById = new Map(rotations.map(r => [r.id, r]))
  const fy = Number(fiscalYear)
  const rates = activeRatesForFiscalYear(rateRows, fy)
  const rnRate = rates.rn_preceptor ? num(rates.rn_preceptor.hourly_rate) : null
  const mgmtRate = rates.management ? num(rates.management.hourly_rate) : null

  const detailRows = []
  const needsData = []
  const reviewRecords = []
  const fiscalYearsSeen = new Set()
  for (const row of rateRows || []) {
    const rateFy = Number(row?.fiscal_year)
    if (Number.isInteger(rateFy)) fiscalYearsSeen.add(rateFy)
  }
  for (const row of capstoneRows || []) {
    const capstoneFy = Number(row?.fiscal_year)
    if (Number.isInteger(capstoneFy) && !row?.voided_at) fiscalYearsSeen.add(capstoneFy)
  }

  for (const student of students) {
    const hours = shiftHoursById.get(student.id) ||
      { approved: 0, pending: 0, rejected: 0, voided: 0, inProgress: 0 }
    const isCurrentPlacement = PLACEMENT_STATUSES.includes(student.status)
    const isExitedWithApprovedHours = EXITED_STATUSES.includes(student.status) && hours.approved > 0
    if (!isCurrentPlacement && !isExitedWithApprovedHours) continue

    const rotation = tripleMatchedRotation(student, rotationById)

    if (!rotation) {
      needsData.push({
        student_name: displayName(student),
        school: student.school || '',
        cohort: cohortNamesById.get(student.cohort_id) || '',
        reason: student.cohort_school_rotation_id ? 'rotation_link_mismatch' : 'missing_rotation_link',
      })
      continue
    }

    const rowFy = fiscalYearOfDate(rotation.rotation_end_date)
    if (rowFy == null) {
      needsData.push({
        student_name: displayName(student),
        school: student.school || '',
        cohort: cohortNamesById.get(student.cohort_id) || '',
        reason: 'missing_rotation_end_date',
      })
      continue
    }
    fiscalYearsSeen.add(rowFy)
    if (rowFy !== fy) continue

    if (hours.rejected > 0 || hours.voided > 0) {
      reviewRecords.push({
        student_name: displayName(student),
        school: student.school || '',
        cohort: cohortNamesById.get(student.cohort_id) || '',
        approved_hours: hours.approved,
        pending_hours: hours.pending,
        rejected_hours: hours.rejected,
        voided_hours: hours.voided,
      })
    }

    const preceptor = preceptorNameById.get(student.id) || null
    const projection = student.approved_hours == null ? null : round2(num(student.approved_hours))
    detailRows.push({
      student_name: displayName(student),
      school: student.school || '',
      program: student.program_type || '',
      course_type: courseTypeOf(student),
      cohort: cohortNamesById.get(student.cohort_id) || '',
      status: student.status,
      rotation_start: rotation.rotation_start_date === ROTATION_SENTINEL ? null : rotation.rotation_start_date,
      rotation_end: rotation.rotation_end_date,
      required_hours: round2(num(student.hours_required)),
      approved_hours: hours.approved,
      pending_hours: hours.pending,
      preceptor_name: preceptor?.name || null,
      preceptor_source: preceptor?.source || null,
      benefit_category: BENEFIT_CATEGORY_LABELS.rn_preceptor,
      estimated_benefit: estimateBenefit(hours.approved, rnRate),
      projection_matches: projection == null ? null : projection === hours.approved,
    })
  }

  // School-level rollup for the visuals (required vs actual, contribution).
  const bySchool = new Map()
  for (const row of detailRows) {
    const key = row.school || 'Unknown school'
    let agg = bySchool.get(key)
    if (!agg) {
      agg = { school: key, students: 0, required_hours: 0, approved_hours: 0, capstone_hours: 0 }
      bySchool.set(key, agg)
    }
    agg.students += 1
    agg.required_hours = round2(agg.required_hours + row.required_hours)
    agg.approved_hours = round2(agg.approved_hours + row.approved_hours)
  }

  const capstoneForFy = (capstoneRows || []).filter(c =>
    !c.voided_at && Number(c.fiscal_year) === fy && num(c.hours) > 0)
  for (const entry of capstoneForFy) {
    const key = entry.school_name || 'Unknown school'
    let agg = bySchool.get(key)
    if (!agg) {
      agg = { school: key, students: 0, required_hours: 0, approved_hours: 0, capstone_hours: 0 }
      bySchool.set(key, agg)
    }
    agg.capstone_hours = round2(agg.capstone_hours + num(entry.hours))
  }

  const schools = [...bySchool.values()]
    .map(agg => ({
      ...agg,
      standard_benefit: estimateBenefit(agg.approved_hours, rnRate),
      capstone_benefit: agg.capstone_hours > 0 ? estimateBenefit(agg.capstone_hours, mgmtRate) : null,
    }))
    .sort((a, b) => b.approved_hours - a.approved_hours || a.school.localeCompare(b.school))

  const totalApproved = round2(detailRows.reduce((s, r) => s + r.approved_hours, 0))
  const totalRequired = round2(detailRows.reduce((s, r) => s + r.required_hours, 0))
  const totalCapstone = round2(capstoneForFy.reduce((s, c) => s + num(c.hours), 0))
  const standardBenefit = totalApproved === 0 ? 0 : estimateBenefit(totalApproved, rnRate)
  const capstoneBenefit = totalCapstone === 0 ? 0 : estimateBenefit(totalCapstone, mgmtRate)
  const hasEveryRequiredRate =
    (totalApproved === 0 || rnRate != null) &&
    (totalCapstone === 0 || mgmtRate != null)
  const totalBenefit = hasEveryRequiredRate
    ? round2((standardBenefit || 0) + (capstoneBenefit || 0))
    : null

  return {
    fiscal_year: fy,
    fiscal_year_label: fiscalYearLabel(fy),
    range: fiscalYearRange(fy),
    rates: {
      rn_preceptor: rates.rn_preceptor
        ? { hourly_rate: num(rates.rn_preceptor.hourly_rate) }
        : null,
      management: rates.management
        ? { hourly_rate: num(rates.management.hourly_rate) }
        : null,
    },
    totals: {
      students: detailRows.length,
      required_hours: totalRequired,
      approved_hours: totalApproved,
      capstone_hours: totalCapstone,
      standard_benefit: standardBenefit,
      capstone_benefit: capstoneBenefit,
      total_benefit: totalBenefit,
    },
    by_school: schools,
    detail_rows: detailRows.sort((a, b) =>
      a.school.localeCompare(b.school) || a.student_name.localeCompare(b.student_name)),
    needs_data: needsData.sort((a, b) => a.student_name.localeCompare(b.student_name)),
    review_records: reviewRecords.sort((a, b) => a.student_name.localeCompare(b.student_name)),
    available_fiscal_years: [...fiscalYearsSeen].sort((a, b) => b - a),
  }
}

// ── Aggregate CSV (privacy contract) ─────────────────────────────────────────
//
// One row per fiscal year + school + program + course type + benefit
// category. NO names, emails, phones, database identifiers, shift rows, or
// narrative text: the row shape below is the entire vocabulary, and the
// privacy test asserts nothing else can appear.

export const AGGREGATE_CSV_HEADERS = Object.freeze([
  'Fiscal Year',
  'School',
  'Program',
  'Course Type',
  'Benefit Category',
  'Preceptor Type',
  'Student Count',
  'Required Hours',
  'Approved Actual Hours',
  'Additional Capstone Hours',
  'Applied Hourly Rate',
  'Estimated Nursing Benefit',
])

export function buildAggregateRows(report) {
  const rnRate = report.rates?.rn_preceptor?.hourly_rate ?? null
  const mgmtRate = report.rates?.management?.hourly_rate ?? null
  const label = report.fiscal_year_label

  const groups = new Map()
  for (const row of report.detail_rows) {
    const key = JSON.stringify([row.school, row.program, row.course_type])
    let g = groups.get(key)
    if (!g) {
      g = {
        school: row.school, program: row.program, course_type: row.course_type,
        student_count: 0, required_hours: 0, approved_hours: 0,
      }
      groups.set(key, g)
    }
    g.student_count += 1
    g.required_hours = round2(g.required_hours + row.required_hours)
    g.approved_hours = round2(g.approved_hours + row.approved_hours)
  }

  const rows = [...groups.values()]
    .sort((a, b) => a.school.localeCompare(b.school) ||
      a.program.localeCompare(b.program) || a.course_type.localeCompare(b.course_type))
    .map(g => ({
      fiscal_year: label,
      school: g.school,
      program: g.program || '-',
      course_type: g.course_type,
      benefit_category: BENEFIT_CATEGORY_LABELS.rn_preceptor,
      preceptor_type: BENEFIT_CATEGORY_LABELS.rn_preceptor,
      student_count: g.student_count,
      required_hours: g.required_hours,
      approved_hours: g.approved_hours,
      capstone_hours: 0,
      hourly_rate: rnRate,
      benefit: estimateBenefit(g.approved_hours, rnRate),
    }))

  // Management (capstone) rows: school-level aggregates by design; program and
  // course type do not apply and the student count is 0.
  const capstoneBySchool = new Map()
  for (const s of report.by_school) {
    if (s.capstone_hours > 0) capstoneBySchool.set(s.school, s.capstone_hours)
  }
  for (const [school, hours] of [...capstoneBySchool.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({
      fiscal_year: label,
      school,
      program: '-',
      course_type: '-',
      benefit_category: BENEFIT_CATEGORY_LABELS.management,
      preceptor_type: BENEFIT_CATEGORY_LABELS.management,
      student_count: 0,
      required_hours: 0,
      approved_hours: 0,
      capstone_hours: hours,
      hourly_rate: mgmtRate,
      benefit: estimateBenefit(hours, mgmtRate),
    })
  }

  return rows
}

const csvEscape = (value) => {
  const raw = value == null ? '' : String(value)
  // Prevent spreadsheet applications from evaluating database text as a
  // formula when the aggregate CSV is opened. Numeric report values remain
  // numeric because none begins with these formula markers.
  const s = /^[=+\-@\t]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildAggregateCsv(report) {
  const rows = buildAggregateRows(report)
  const lines = [AGGREGATE_CSV_HEADERS.join(',')]
  for (const r of rows) {
    lines.push([
      r.fiscal_year, r.school, r.program, r.course_type,
      r.benefit_category, r.preceptor_type,
      r.student_count, r.required_hours, r.approved_hours, r.capstone_hours,
      r.hourly_rate == null ? '' : r.hourly_rate,
      r.benefit == null ? '' : r.benefit,
    ].map(csvEscape).join(','))
  }
  return lines.join('\n') + '\n'
}
