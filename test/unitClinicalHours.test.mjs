// Commit 3: the Unit Leader Clinical Hours section + role-safe logged-shifts endpoint.
// Canonical-calc reuse, status-chip reuse, endpoint field allowlist + server authorization,
// and drawer wiring. Guards that no prohibited field can reach a Unit Leader.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { deriveClinicalHours } from '../src/lib/portalProgress.js'
import { shiftStatusChip, isPendingReview, SHIFT_STATUS_STYLES } from '../src/lib/shiftStatusChips.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

// ── canonical calc reuse ──────────────────────────────────────────────────────
test('the section reuses deriveClinicalHours (remaining floors at zero; pct clamps)', () => {
  const d = deriveClinicalHours({ required: 120, approved: 140, pending: 4 })
  assert.equal(d.remaining, 0)          // over-target floors at zero
  assert.equal(d.pct, 100)              // clamps at 100
  const u = deriveClinicalHours({ required: null, approved: 10, pending: 0 })
  assert.equal(u.reliable, false)       // no required hours -> no bar
})

// ── canonical status chips (single source, shared with staff) ─────────────────
test('status chips are the shared canonical vocabulary', () => {
  assert.equal(shiftStatusChip('Auto-Accepted').label, 'Auto-Accepted')
  assert.equal(shiftStatusChip('needs_review').label, 'Pending Review')   // legacy maps forward
  assert.equal(shiftStatusChip('weird').label, 'weird')                   // fallback echoes raw
  assert.ok(isPendingReview('Pending Review') && isPendingReview('needs_review'))
  assert.equal(Object.keys(SHIFT_STATUS_STYLES).length, 8)
  // The staff panel now imports the shared chips (no duplicated map).
  const panel = read('src/components/ClinicalHoursPanel.jsx')
  assert.match(panel, /import \{ shiftStatusChip, isPendingReview \} from '\.\.\/lib\/shiftStatusChips'/)
  assert.ok(!panel.includes("'Auto-Accepted':  { bg:"), 'the inline STATUS_STYLES map is gone')
})

// ── the role-safe section exposes nothing prohibited ──────────────────────────
test('UnitClinicalHours renders only role-safe fields and no support surfaces', () => {
  const c = code('src/portal/unit/UnitClinicalHours.jsx')
  for (const bad of ['support_needed', 'learning_highlight', 'review_reason', 'ShiftDetailsModal',
    'useSupportRequestReads', 'isShiftSupportUnread', 'admin_notes', 'reviewed_by', 'exception_flags',
    'checked_in_at', 'checked_out_at', 'student_id']) {
    assert.ok(!c.includes(bad), `must not reference ${bad}`)
  }
  assert.match(c, /deriveClinicalHours/)
  assert.match(c, /shiftStatusChip/)
  // The required columns. SHIFT-SEQUENCE-1 added the leading "Shift #" so this
  // table matches the staff and student surfaces; the original seven follow it
  // unchanged, and the sequence is derived from the shared comparator without
  // touching any identifying field (see the role-safety loop above).
  assert.match(c, /\['Shift #', 'Date', 'Hrs', 'Unit', 'Preceptor', 'Type', 'Status', 'Details'\]/)
  assert.match(c, /compareShiftChronological/)
})

// ── the endpoint: server authorization + field allowlist ──────────────────────
test('unit-student-shifts re-checks scope and returns only allowlisted fields', () => {
  const ep = read('api/portal/unit-student-shifts.js')
  assert.match(ep, /verifyPortalUnitLeaderCaller/)
  assert.match(ep, /authorizeStudentForUnitLeader\(db, scopes, studentId\)/)
  assert.match(ep, /if \(!decision\.allowed\) return res\.status\(404\)/)   // fail-closed, non-enumerating
  assert.match(ep, /Cache-Control', 'no-store, private/)
  const safe = ep.match(/const SAFE_COLUMNS = \[([\s\S]*?)\]/)[1]
  for (const bad of ['support_needed', 'learning_highlight', 'review_reason', 'admin_notes',
    'reviewed_by', 'exception_flags', 'unit_override_reason', 'preceptor_override_note', 'checked_in_at']) {
    assert.ok(!safe.includes(bad), `SAFE_COLUMNS must not include ${bad}`)
  }
  // Only quantitative + status columns.
  assert.match(safe, /'id', 'shift_date', 'total_hours', 'unit_name', 'preceptor_name', 'shift_type', 'status'/)
})

// ── the drawer wires the section from the authorized endpoint ─────────────────
test('the profile drawer renders Clinical hours from the scoped shifts endpoint', () => {
  const drawer = read('src/portal/unit/StudentDetailDrawer.jsx')
  assert.match(drawer, /import UnitClinicalHours from '\.\/UnitClinicalHours'/)
  assert.match(drawer, /getStudentShifts/)
  assert.match(drawer, /<h3 className="ptl-detail-heading">Clinical hours<\/h3>/)
  assert.match(drawer, /<UnitClinicalHours/)
  // The staff editable profile panel is never mounted here.
  assert.ok(!drawer.includes('StudentSidePanel'))
})
