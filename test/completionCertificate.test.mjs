// ASPIRE-CERT-COMPLETION-TEMPLATE-1: the Certificate of Completion template replacement.
// Field mapping, approved-hours sourcing, date formatting, ID stability, issued-date
// correctness, long-text handling, and static eligibility/access guards on all three
// download endpoints. Run: node --test test/completionCertificate.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  ROTATION_DATE_SENTINEL,
  formatRotationDateRange,
  formatHoursCompleted,
  formatIssuedDate,
} from '../lib/server/certificates/certificateFields.js'
import { loadCertificateDisplayFields } from '../lib/server/certificates/loadCertificateDisplayFields.js'
import { generateCompletionCertificate } from '../lib/server/certificates/generateCompletionCertificate.js'
import { PDFDocument } from 'pdf-lib'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const TEMPLATE = readFileSync(join(here, '..', 'public/certificates/templates/aspire-certificate-of-completion.pdf'))

// ── rotation date formatting ──────────────────────────────────────────────────
test('rotation range formats as a readable range', () => {
  assert.equal(formatRotationDateRange('2026-06-08', '2026-08-18'), 'Jun 8 - Aug 18, 2026')
  assert.equal(formatRotationDateRange('2026-12-08', '2027-01-18'), 'Dec 8, 2026 - Jan 18, 2027')
})

test('rotation range fails closed on sentinel, half-known, and malformed windows', () => {
  assert.equal(formatRotationDateRange(ROTATION_DATE_SENTINEL, ROTATION_DATE_SENTINEL), null)
  assert.equal(formatRotationDateRange('1900-01-01', '2026-08-18'), null)
  assert.equal(formatRotationDateRange(null, '2026-08-18'), null)
  assert.equal(formatRotationDateRange('2026-06-08', null), null)
  assert.equal(formatRotationDateRange('June 8', 'Aug 18'), null)
})

// ── approved hours formatting ─────────────────────────────────────────────────
test('hours preserve decimals and drop trailing zeros; invalid values fail closed', () => {
  assert.equal(formatHoursCompleted(120), '120')
  assert.equal(formatHoursCompleted('120.50'), '120.5')
  assert.equal(formatHoursCompleted(137.75), '137.75')
  assert.equal(formatHoursCompleted(0), '0')
  assert.equal(formatHoursCompleted(null), null)
  assert.equal(formatHoursCompleted(undefined), null)
  assert.equal(formatHoursCompleted(''), null)
  assert.equal(formatHoursCompleted(-4), null)
  assert.equal(formatHoursCompleted('abc'), null)
})

// ── issued date ───────────────────────────────────────────────────────────────
test('issued date renders the unlock timestamp in program time, never today', () => {
  // 05:30 UTC on Aug 5 is still Aug 4 in Los Angeles (PDT).
  assert.equal(formatIssuedDate('2026-08-05T05:30:00Z'), 'Aug 4, 2026')
  assert.equal(formatIssuedDate('2026-01-15T20:00:00Z'), 'Jan 15, 2026')
  assert.equal(formatIssuedDate(null), null)
  assert.equal(formatIssuedDate('not-a-date'), null)
})

// ── canonical field loading (mocked service-role client) ─────────────────────
const STUDENT_ID = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const UNIT_ID = '33333333-3333-4333-8333-333333333333'
const ROTATION_ID = '44444444-4444-4444-8444-444444444444'

function mockDb(rows) {
  return {
    from(table) {
      return {
        select() {
          return {
            eq(_col, id) {
              const data = rows[table]?.[id] ?? null
              return {
                single: async () => ({ data, error: data ? null : { message: 'not found' } }),
                maybeSingle: async () => ({ data, error: null }),
              }
            },
          }
        },
      }
    },
  }
}

const baseRows = () => ({
  students: {
    [STUDENT_ID]: {
      first_name: 'Avery', preferred_first_name: 'Ave', last_name: 'Chen',
      matched_unit_id: UNIT_ID, cohort_school_rotation_id: ROTATION_ID, approved_hours: 150,
    },
  },
  units: { [UNIT_ID]: { unit_name: '6 Southwest Medical-Surgical' } },
  cohort_school_rotations: {
    [ROTATION_ID]: { rotation_start_date: '2026-06-08', rotation_end_date: '2026-08-18' },
  },
  evaluation_assignments: { [ASSIGNMENT_ID]: { approved_hours_at_completion: '142.50' } },
})

const CERT = {
  student_id: STUDENT_ID,
  evaluation_assignment_id: ASSIGNMENT_ID,
  certificate_number: 'ASPIRE-2026-052',
  certificate_unlocked_at: '2026-08-04T18:00:00Z',
}

test('loader maps every field from its canonical source', async () => {
  const fields = await loadCertificateDisplayFields(mockDb(baseRows()), CERT)
  assert.deepEqual(fields, {
    studentName: 'Ave Chen',                       // preferred-or-legal, shared resolver
    lastName: 'Chen',
    certificateNumber: 'ASPIRE-2026-052',          // verbatim from the certificates row
    clinicalUnit: '6 Southwest Medical-Surgical',  // units.unit_name via matched_unit_id
    rotationDates: 'Jun 8 - Aug 18, 2026',         // canonical cohort_school_rotations window
    hoursCompleted: '142.5',                       // approved-hours snapshot, NOT live 150
    issuedDate: 'Aug 4, 2026',                     // certificate_unlocked_at, program time
  })
})

test('hours prefer the completion snapshot and fall back to live approved hours', async () => {
  const rows = baseRows()
  rows.evaluation_assignments[ASSIGNMENT_ID] = { approved_hours_at_completion: null }
  const fields = await loadCertificateDisplayFields(mockDb(rows), CERT)
  assert.equal(fields.hoursCompleted, '150')

  const noAssignment = await loadCertificateDisplayFields(
    mockDb(rows), { ...CERT, evaluation_assignment_id: null })
  assert.equal(noAssignment.hoursCompleted, '150')
})

test('loader fails soft on missing unit/rotation and fails closed on missing student', async () => {
  const rows = baseRows()
  rows.students[STUDENT_ID] = {
    ...rows.students[STUDENT_ID], matched_unit_id: null, cohort_school_rotation_id: null,
  }
  const fields = await loadCertificateDisplayFields(mockDb(rows), CERT)
  assert.equal(fields.clinicalUnit, null)
  assert.equal(fields.rotationDates, null)

  const empty = await loadCertificateDisplayFields(mockDb({}), CERT)
  assert.equal(empty, null)
})

test('repeat loads reproduce the same Certificate ID and field data', async () => {
  const first = await loadCertificateDisplayFields(mockDb(baseRows()), CERT)
  const second = await loadCertificateDisplayFields(mockDb(baseRows()), CERT)
  assert.deepEqual(first, second)
  assert.equal(first.certificateNumber, second.certificateNumber)
})

// ── PDF generation ────────────────────────────────────────────────────────────
async function renderable(fields) {
  const bytes = await generateCompletionCertificate({ templateBytes: TEMPLATE, ...fields })
  const pdf = await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(), 1)
  const { width, height } = pdf.getPages()[0].getSize()
  assert.equal(width, 792)   // landscape US Letter preserved
  assert.equal(height, 612)
  return bytes
}

test('generator produces a valid one-page landscape PDF with all fields', async () => {
  await renderable({
    studentName: 'Ave Chen', certificateNumber: 'ASPIRE-2026-052',
    clinicalUnit: '6 Southwest Medical-Surgical', rotationDates: 'Jun 8 - Aug 18, 2026',
    hoursCompleted: '142.5', issuedDate: 'Aug 4, 2026',
  })
})

test('generator never clips or throws on extreme long text or missing values', async () => {
  await renderable({
    studentName: 'Alexandria Montgomery-Villanueva de la Rosa y Castellanos-Whitworth',
    certificateNumber: 'ASPIRE-2026-999',
    clinicalUnit: 'Cardiac Surgery Intensive Care Unit (CSICU) - 6 North Tower Advanced Heart Program',
    rotationDates: 'Dec 8, 2026 - Jan 18, 2027',
    hoursCompleted: '137.75', issuedDate: 'Dec 31, 2026',
  })
  await renderable({
    studentName: null, certificateNumber: null,
    clinicalUnit: null, rotationDates: null, hoursCompleted: null, issuedDate: null,
  })
})

test('the static template is flattened (no interactive form fields remain)', async () => {
  const pdf = await PDFDocument.load(TEMPLATE)
  assert.equal(pdf.getForm().getFields().length, 0)
})

// ── endpoint guards: eligibility and access unchanged, template swapped ──────
const portal = read('api/portal/download-certificate.js')
const tokenEp = read('api/certificate-participation-download.js')
const adminEp = read('api/certificate-participation-admin-download.js')

test('all three endpoints render the new template through the shared resolver', () => {
  for (const src of [portal, tokenEp, adminEp]) {
    assert.match(src, /aspire-certificate-of-completion\.pdf/)
    assert.doesNotMatch(src, /aspire-certificate-of-participation\.pdf/)
    assert.match(src, /loadCertificateDisplayFields\(/)
    assert.match(src, /generateCompletionCertificate\(\{ templateBytes, \.\.\.fields \}\)/)
    assert.match(src, /ASPIRE-Certificate-of-Completion-/)
    // Read-only render path: never issues, numbers, or mutates certificates.
    assert.doesNotMatch(src, /issue_participation_certificate/)
    assert.doesNotMatch(src, /\.insert\(|\.upsert\(|\.update\(/)
  }
})

test('student portal endpoint keeps its unlock + linked-student gates', () => {
  assert.match(portal, /c\.certificate_unlocked_at && c\.certificate_number/)
  assert.match(portal, /\.in\('student_id', studentIds\)/)
  assert.match(portal, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
})

test('tokenized endpoint keeps its gating-instrument and completion gates', () => {
  assert.match(tokenEp, /GATING_SLUGS = new Set\(\['casey_fink_readiness_2024', 'post_rotation_evaluation'\]\)/)
  assert.match(tokenEp, /!GATING_SLUGS\.has\(instrument\.slug\)/)
  assert.match(tokenEp, /if \(!assignment\.completed_at\)/)
  assert.match(tokenEp, /consume_evaluation_rate_limit/)
})

test('admin endpoint keeps its Owner/Admin gate and student-match check', () => {
  assert.match(adminEp, /\['owner', 'admin'\]\.includes\(profile\.role\)/)
  assert.match(adminEp, /cert\.student_id !== studentId/)
})
