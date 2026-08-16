// STUDENT-SHIFT-LOG-MANAGEMENT-1: proofs for student self-service on shift logs.
//
// Behavioral where a pure module allows it (status vocabulary, exception
// re-classification against a substituted db), structural where the guarantee
// lives in SQL or in wiring. Every correction carries a negative control.
//
// Run: node --test test/studentShiftLogManagement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/migrations/20260819000000_student_shift_log_self_service.sql')
const sqlCode = sql.replace(/--[^\n]*/g, '')
const endpoint = strip(read('api/portal/my-shift-log-manage.js'))

// ── A student may reach only their own logs ─────────────────────────────────

test('identity comes from the JWT and the student link - never from the request', () => {
  assert.match(endpoint, /verifyPortalCaller\(req\)/)
  assert.match(endpoint, /hasActiveRoleGrant\(db, profileId, 'student'\)/)
  assert.match(endpoint, /getActiveStudentLinks\(db, profileId\)/)
  assert.match(endpoint, /const studentId = shiftRow\.student_id/,
    'the acting student is the resolved row inside the allowlist')
  // NEGATIVE CONTROL: a client-supplied student id or school email must never
  // appear anywhere in this endpoint.
  assert.doesNotMatch(endpoint, /body\.student_id|body\.school_email|body\.email/)
  assert.doesNotMatch(endpoint, /school_email/, 'the email-identity flow is not reused here')
  // The body allowlist cannot carry authority fields.
  const allow = endpoint.slice(endpoint.indexOf('const ALLOWED_KEYS'), endpoint.indexOf('async function editReady'))
  for (const forbidden of ['student_id', 'cohort_id', 'status', 'exception_flags', 'lifecycle_state', 'review_reason', 'admin_notes', 'reviewed_by', 'attestation']) {
    assert.ok(!allow.includes(`'${forbidden}'`), `${forbidden} is not client-supplyable`)
  }
})

test('F2: a multi-linked account is fully supported; the allowlist decides ownership', () => {
  // NEGATIVE CONTROL: the single-link restriction must be gone.
  assert.doesNotMatch(endpoint, /studentIds\.length !== 1/,
    'an account with several student records is no longer refused')
  assert.match(endpoint, /if \(studentIds\.length === 0\) return res\.status\(403\)/)
  // The shift is resolved FIRST, then authorized against the complete allowlist.
  const resolveAt = endpoint.indexOf(".from('student_shift_logs')")
  const authorizeAt = endpoint.indexOf('studentIds.includes(shiftRow.student_id)')
  assert.ok(resolveAt > 0 && authorizeAt > resolveAt, 'resolve, then authorize')
  assert.match(endpoint, /if \(!shiftRow \|\| !studentIds\.includes\(shiftRow\.student_id\)\) \{\s*\n?\s*return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/,
    'unknown and unauthorized are the same 404')
  assert.match(endpoint, /const studentId = shiftRow\.student_id/,
    'the acting student comes from the resolved row, never the body')
})

test('cross-student and unknown ids are indistinguishable (no enumeration)', () => {
  // SQL: both cases return the same verdict reason.
  const fn = sqlCode.slice(sqlCode.indexOf('student_shift_edit_eligibility'), sqlCode.indexOf('student_edit_shift_log'))
  assert.match(fn, /WHERE id = p_shift_id AND student_id = p_student_id/,
    'ownership is part of the lookup, not a separate check')
  assert.match(fn, /IF v_shift\.id IS NULL THEN\s*\n?\s*RETURN jsonb_build_object\('editable', false, 'reason', 'not_found'\)/)
  // Endpoint: that verdict becomes a plain 404 with no detail.
  assert.match(endpoint, /verdict\.reason === 'not_found'\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  assert.match(endpoint, /if \(code === 'P0002'\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  // ...and both RPCs raise the SAME code for "not mine" as for "does not exist".
  const edit = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_edit_shift_log'), sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_void_shift_log'))
  assert.equal((edit.match(/RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002'/g) || []).length, 3)
  assert.match(edit, /WHERE id = p_shift_id AND student_id = p_student_id\s*\n?\s*FOR UPDATE/)
})

// ── Atomicity: same lock, both totals, every path ──────────────────────────

test('both RPCs take the SAME per-student lock and recompute BOTH totals', () => {
  for (const name of ['student_edit_shift_log', 'student_void_shift_log']) {
    const start = sqlCode.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
    const fn = sqlCode.slice(start, start + 6000)
    assert.match(fn, /PERFORM 1 FROM public\.students WHERE id = p_student_id FOR UPDATE/, `${name} locks the student`)
    assert.match(fn, /status IN \('Auto-Accepted', 'Approved'\)\s*\n?\s*AND total_hours IS NOT NULL/, `${name} approved bucket`)
    assert.match(fn, /status IN \('Pending Review'\)\s*\n?\s*AND total_hours IS NOT NULL/, `${name} pending bucket`)
    assert.match(fn, /SET approved_hours = v_recomputed_approved,\s*\n?\s*pending_hours\s*=\s*v_recomputed_pending/, `${name} writes both`)
    assert.doesNotMatch(fn, /approved_hours \+|pending_hours -/, `${name} never does delta arithmetic`)
    assert.match(fn, /INSERT INTO public\.student_shift_log_edits/, `${name} appends an audit row`)
  }
  // Each RPC pins the shift too, so a concurrent staff decision loses cleanly.
  assert.equal((sqlCode.match(/FOR UPDATE;/g) || []).length, 4,
    'student + shift lock in each of the two RPCs')
})

test('the recompute formula is byte-identical to the canonical one', () => {
  const canonical = read('supabase/migrations/20260607000002_shift_log_check_out_rpc.sql')
  const norm = (s) => s.replace(/\s+/g, ' ')
  const approvedClause = "lifecycle_state = 'completed' AND status IN ('Auto-Accepted', 'Approved') AND total_hours IS NOT NULL"
  assert.ok(norm(canonical).includes(approvedClause), 'canonical source still reads this way')
  assert.ok(norm(sqlCode).includes(approvedClause), 'the student RPCs use the same clause')
})

// ── Void is a lifecycle state, never a delete ──────────────────────────────

test('withdraw sets lifecycle_state and deletes nothing, anywhere', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_void_shift_log'))
  assert.match(fn, /SET lifecycle_state = 'voided'/)
  // The row's submitted values are untouched by the void.
  assert.doesNotMatch(fn.slice(0, fn.indexOf('INSERT INTO')), /SET lifecycle_state = 'voided',/,
    'the void UPDATE changes lifecycle ONLY')
  assert.doesNotMatch(sqlCode, /DELETE FROM public\.student_shift_logs/)
  assert.doesNotMatch(endpoint, /\.delete\(/)
  // NEGATIVE CONTROL: service_role no longer even holds DELETE on the table
  // (20260818000000), so a delete-based void could not work if attempted.
  const lockdown = read('supabase/migrations/20260818000000_shift_log_review.sql')
  assert.match(lockdown, /REVOKE DELETE ON public\.student_shift_logs FROM service_role/)
})

test('a voided row leaves BOTH buckets purely by inheriting the lifecycle filter', () => {
  // Both bucket queries filter lifecycle_state = 'completed', so 'voided' is
  // excluded with no formula change. This is the whole design.
  const voidFn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_void_shift_log'))
  assert.equal((voidFn.match(/lifecycle_state = 'completed'/g) || []).length >= 3, true)
  // Staff review's decidability gate carries the same filter, so a withdrawn
  // shift also stops being reviewable - proven executably in the smoke test.
  const review = read('supabase/migrations/20260818000000_shift_log_review.sql')
  assert.match(review, /IF v_before\.lifecycle_state IS DISTINCT FROM 'completed'[\s\S]{0,220}P0001/)
})

// ── Reviewed history cannot be overwritten or erased ───────────────────────

test('staff-decided shifts are refused, and the review ledger is never touched', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('student_shift_edit_eligibility'), sqlCode.indexOf('student_edit_shift_log'))
  assert.match(fn, /IF v_shift\.status NOT IN \('Auto-Accepted', 'Pending Review'\) THEN[\s\S]{0,160}'staff_decided'/)
  // NEGATIVE CONTROL: nothing in this migration or endpoint may write, update,
  // or delete the staff ledger.
  assert.doesNotMatch(sqlCode, /INSERT INTO public\.shift_log_reviews/)
  assert.doesNotMatch(sqlCode, /UPDATE public\.shift_log_reviews/)
  assert.doesNotMatch(sqlCode, /DELETE FROM public\.shift_log_reviews/)
  assert.doesNotMatch(endpoint, /shift_log_reviews/)
  // The student ledger is a SEPARATE table (the staff ledger is one-decision-
  // per-shift; a student action must never consume that slot).
  assert.match(sqlCode, /CREATE TABLE IF NOT EXISTS public\.student_shift_log_edits/)
})

test('the student ledger is append-only and immutably identified', () => {
  assert.match(sqlCode, /original_shift_log_id\s+uuid NOT NULL,/)
  assert.match(sqlCode, /original_student_id\s+uuid NOT NULL,/)
  assert.doesNotMatch(sqlCode, /original_shift_log_id\s+uuid[^,]*REFERENCES/)
  assert.match(sqlCode, /GRANT SELECT, INSERT ON public\.student_shift_log_edits TO service_role/)
  assert.doesNotMatch(sqlCode, /GRANT[^;]*UPDATE[^;]*ON public\.student_shift_log_edits/)
  assert.doesNotMatch(sqlCode, /GRANT[^;]*DELETE[^;]*ON public\.student_shift_log_edits/)
  assert.match(sqlCode, /is_active_owner_or_admin\(\)/, 'Owner/Admin read the trail')
  // Before AND after snapshots, so a decision is explicable without the source.
  for (const col of ['before_status', 'before_total_hours', 'before_lifecycle_state',
    'after_status', 'after_lifecycle_state', 'approved_hours_after', 'pending_hours_after']) {
    assert.ok(sqlCode.includes(col), `${col} present`)
  }
})

// ── Downstream-artifact behavior ───────────────────────────────────────────

test('certificate, concluded rotation, and terminal status each stop self-service', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('student_shift_edit_eligibility'), sqlCode.indexOf('student_edit_shift_log'))
  assert.match(fn, /FROM public\.certificates WHERE student_id = p_student_id[\s\S]{0,200}'certificate_issued'/)
  assert.match(fn, /rotation_completed_at IS NOT NULL[\s\S]{0,120}'rotation_concluded'/)
  assert.match(fn, /status IN \('Completed', 'Not Proceeding'\)[\s\S]{0,120}'student_status_terminal'/)
  // Both RPCs consult the SAME rule - the lock path cannot diverge from the
  // read path (NEGATIVE CONTROL: inlining a different rule fails this).
  assert.equal((sqlCode.match(/public\.student_shift_edit_eligibility\(p_shift_id, p_student_id\)/g) || []).length, 2)
})

test('the portal explains each lock and offers a correction request instead', () => {
  const api = read('src/lib/myShiftLogApi.js')
  for (const reason of ['staff_decided', 'certificate_issued', 'rotation_concluded', 'student_status_terminal', 'already_voided', 'shift_in_progress']) {
    assert.match(api, new RegExp(`${reason}:`), `${reason} has student-facing copy`)
  }
  const drawer = read('src/portal/ShiftLogHistoryDrawer.jsx')
  assert.match(drawer, /data-testid="shift-correction-btn"/)
  assert.match(drawer, /Request a correction/)
})

// ── Re-classification (behavioral, real module) ────────────────────────────

// The JS classifier still serves the SUBMISSION path; the student edit path
// now classifies in SQL. Both must agree, so the JS rules stay under test.
const { buildExceptionFlags, statusFromFlags, reviewReasonFromFlags } =
  await import('../api/lib/shiftExceptionFlags.js')

function fakeDb(sameDayRows, opts = {}) {
  const seen = {}
  const db = {
    from(table) {
      const q = {
        _t: table, _filters: {}, _neq: null,
        select() { return q },
        eq(k, v) { q._filters[k] = v; return q },
        in() { return q },
        neq(k, v) { q._neq = { k, v }; seen.neq = { k, v }; return q },
        maybeSingle: async () => ({ data: opts.unit || null }),
        then(resolve) { return Promise.resolve({ data: sameDayRows }).then(resolve) },
      }
      return q
    },
  }
  return { db, seen }
}

test('an edit EXCLUDES its own row from the same-day sum (insert does not)', async () => {
  // 20h of other same-day hours + a 6h edit = 26 > 24 would flag; but if the
  // row being edited (14h of that 20) were counted twice the verdict changes.
  const withExclusion = fakeDb([{ total_hours: 6 }])
  const flags = await buildExceptionFlags(withExclusion.db, {
    totalHours: 6, preceptorName: 'P', unitName: 'PACU', isAssignedUnit: true,
    shiftDate: '2026-07-06', student: { id: 's', status: 'Active Rotation' },
    excludeShiftId: 'shift-1',
  })
  assert.deepEqual(withExclusion.seen.neq, { k: 'id', v: 'shift-1' }, 'the edited row is excluded')
  assert.deepEqual(flags, [], '6 + 6 is under the daily cap')

  const noExclusion = fakeDb([{ total_hours: 20 }])
  const flags2 = await buildExceptionFlags(noExclusion.db, {
    totalHours: 6, preceptorName: 'P', unitName: 'PACU', isAssignedUnit: true,
    shiftDate: '2026-07-06', student: { id: 's', status: 'Active Rotation' },
  })
  assert.equal(noExclusion.seen.neq, undefined, 'a submission excludes nothing')
  assert.deepEqual(flags2, ['daily_hours_exceed_24'])
})

test('re-classification reproduces the canonical rules and status derivation', async () => {
  const under = await buildExceptionFlags(fakeDb([]).db, {
    totalHours: 1, preceptorName: 'P', unitName: 'PACU', isAssignedUnit: true,
    shiftDate: '2026-07-06', student: { id: 's', status: 'Active Rotation' },
  })
  assert.deepEqual(under, ['hours_under_2'])
  assert.equal(statusFromFlags(under), 'Pending Review')
  assert.equal(reviewReasonFromFlags(under), 'hours_under_2')

  const missingPrec = await buildExceptionFlags(fakeDb([]).db, {
    totalHours: 8, preceptorName: '   ', unitName: 'PACU', isAssignedUnit: true,
    shiftDate: '2026-07-06', student: { id: 's', status: 'Active Rotation' },
  })
  assert.deepEqual(missingPrec, ['missing_preceptor'])

  const prePlacement = await buildExceptionFlags(fakeDb([]).db, {
    totalHours: 8, preceptorName: 'P', unitName: 'PACU', isAssignedUnit: true,
    shiftDate: '2026-07-06', student: { id: 's', status: 'Matched' },
  })
  assert.deepEqual(prePlacement, ['pre_placement_log'])

  const clean = await buildExceptionFlags(fakeDb([]).db, {
    totalHours: 8, preceptorName: 'P', unitName: 'PACU', isAssignedUnit: true,
    shiftDate: '2026-07-06', student: { id: 's', status: 'Active Rotation' },
  })
  assert.deepEqual(clean, [])
  assert.equal(statusFromFlags(clean), 'Auto-Accepted')
  assert.equal(reviewReasonFromFlags(clean), null)
})

test('F3: classification happens in the DATABASE, under the lock - never from the caller', () => {
  // NEGATIVE CONTROL: the endpoint must not compute or send status/flags at all.
  assert.doesNotMatch(endpoint, /buildExceptionFlags|statusFromFlags|reviewReasonFromFlags/,
    'the endpoint no longer classifies')
  assert.doesNotMatch(endpoint, /p_status:|p_exception_flags:|p_review_reason:/,
    'and cannot pass a status, flags, or a review reason')
  // The edit RPC takes no such parameters...
  const sig = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_edit_shift_log'),
                            sqlCode.indexOf('RETURNS jsonb', sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_edit_shift_log')))
  assert.doesNotMatch(sig, /p_status|p_exception_flags|p_review_reason/)
  // ...it derives them itself, AFTER the lock.
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_edit_shift_log'),
                           sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_void_shift_log'))
  const lockAt = fn.indexOf('FOR UPDATE')
  const classifyAt = fn.indexOf('public.student_shift_classify(')
  const updateAt = fn.indexOf('UPDATE public.student_shift_logs')
  assert.ok(lockAt > 0 && classifyAt > lockAt && updateAt > classifyAt,
    'lock -> classify -> write, in that order')
  assert.match(fn, /status\s+= v_status/)
  assert.match(fn, /exception_flags\s+= v_flags/)
  assert.match(fn, /review_reason\s+= v_review_reason/)
  // FAIL CLOSED: a classifier that cannot produce a valid verdict aborts.
  assert.match(fn, /RAISE EXCEPTION 'classification_failed' USING ERRCODE = 'P0006'/)
})

test('F3: the SQL classifier reproduces every canonical rule, in canonical order', () => {
  const c = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_shift_classify'),
                          sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_edit_shift_log'))
  const order = ['hours_over_13', 'hours_under_2', 'outside_rotation_dates',
    'daily_hours_exceed_24', 'missing_preceptor', 'pre_placement_log', 'unit_and_preceptor_mismatch']
  let last = -1
  for (const flag of order) {
    const at = c.indexOf(`'${flag}'`)
    assert.ok(at > last, `${flag} appended in canonical order (review_reason depends on it)`)
    last = at
  }
  // The rules themselves, ported faithfully:
  assert.match(c, /p_total_hours > 13/)
  assert.match(c, /p_total_hours < 2/)
  assert.match(c, /'1900-01-01'/, 'the sentinel window never flags')
  assert.match(c, /cohort_school_rotations/, 'canonical window, not legacy term_dates')
  assert.match(c, /p_exclude_shift_id IS NULL OR l\.id <> p_exclude_shift_id/,
    'the edited row is excluded from its own daily sum')
  assert.match(c, /status NOT IN \('Placed', 'Active Rotation'\)/)
  assert.match(c, /public\.unit_name_key\(a\.unit_key\) = public\.unit_name_key\(p_unit_name\)/,
    'canonical unit identity, 6NE = 6 NE')
  assert.match(c, /a\.status IN \('planned', 'active', 'ended'\)/, "'removed' validates nothing")
  assert.match(c, /RAISE EXCEPTION 'student_not_found'/, 'a missing student fails closed')
  // Its output drives the status - nothing else does.
  assert.match(c, /CASE WHEN array_length\(v_flags, 1\) > 0 THEN 'Pending Review' ELSE 'Auto-Accepted' END/)
})

// ── Portal displays every canonical status correctly ───────────────────────

const { portalShiftStatus, isVoided, countsTowardTotals, countAwaitingReview } =
  await import('../src/lib/portalShiftStatus.js')

test('every canonical status maps to a correct student-facing label', () => {
  assert.deepEqual(portalShiftStatus({ status: 'Auto-Accepted' }), { label: 'Accepted', tone: 'ok' })
  assert.deepEqual(portalShiftStatus({ status: 'Approved' }), { label: 'Approved', tone: 'ok' })
  assert.deepEqual(portalShiftStatus({ status: 'Pending Review' }), { label: 'Awaiting review', tone: 'wait' })
  assert.deepEqual(portalShiftStatus({ status: 'Rejected' }), { label: 'Not counted', tone: 'soft' })
  // legacy lowercase rows still read correctly
  assert.deepEqual(portalShiftStatus({ status: 'approved' }), { label: 'Accepted', tone: 'ok' })
  assert.deepEqual(portalShiftStatus({ status: 'needs_review' }), { label: 'Awaiting review', tone: 'wait' })
  // lifecycle outranks status
  assert.deepEqual(portalShiftStatus({ status: 'Auto-Accepted', lifecycle_state: 'voided' }),
    { label: 'Withdrawn', tone: 'soft' })
  assert.deepEqual(portalShiftStatus({ status: 'Pending Review', lifecycle_state: 'in_progress' }),
    { label: 'In progress', tone: 'wait' })
})

test('NEGATIVE CONTROL: the old lowercase comparison is gone from both surfaces', () => {
  const portal = read('src/portal/StudentPortal.jsx')
  assert.doesNotMatch(portal, /l\.status === 'approved' \? 'Approved' : 'Awaiting review'/,
    'the broken chip comparison is removed')
  assert.match(portal, /portalShiftStatus\(l\)/)
  // The pre-fix expression would have mislabelled an Approved shift; prove the
  // replacement does not.
  assert.notEqual(portalShiftStatus({ status: 'Approved' }).label, 'Awaiting review')
  assert.notEqual(portalShiftStatus({ status: 'Auto-Accepted' }).label, 'Awaiting review')
})

test('counting helpers exclude withdrawn entries', () => {
  const logs = [
    { status: 'Pending Review' },
    { status: 'Pending Review', lifecycle_state: 'voided' },
    { status: 'Auto-Accepted' },
  ]
  assert.equal(countAwaitingReview(logs), 1)
  assert.equal(isVoided(logs[1]), true)
  assert.equal(countsTowardTotals(logs[1]), false)
  assert.equal(countsTowardTotals(logs[0]), true)
})

// ── Full history surface + immediate refresh ───────────────────────────────

test('the portal exposes a complete history, not four entries', () => {
  const portal = read('src/portal/StudentPortal.jsx')
  assert.match(portal, /data-testid="open-shift-history"/)
  assert.match(portal, /View all \$\{shiftCount\} shifts/)
  assert.match(portal, /<ShiftLogHistoryDrawer/)
  // The drawer receives the WHOLE list; only the home card slices.
  assert.match(portal, /logs=\{myLogs\}/)
  const drawer = read('src/portal/ShiftLogHistoryDrawer.jsx')
  assert.doesNotMatch(drawer, /\.slice\(0, 4\)/, 'the drawer never truncates')
  assert.match(drawer, /logs\.map\(log =>/)
})

test('a successful change refreshes the student surface immediately', () => {
  const portal = read('src/portal/StudentPortal.jsx')
  assert.match(portal, /onChanged=\{\(\) => \{ load\(\) \}\}/,
    'the portal re-reads its own data after any change')
  const drawer = read('src/portal/ShiftLogHistoryDrawer.jsx')
  assert.match(drawer, /onChanged\?\.\(r\.result\)/)
  // Staff surfaces read the same authoritative row/totals the RPC wrote, so no
  // second source of truth exists to go stale.
  assert.match(sqlCode, /'approved_hours', v_recomputed_approved/)
  assert.match(sqlCode, /'pending_hours', v_recomputed_pending/)
})

// ── No direct browser write, fail-closed, and staff internals hidden ───────

test('F1 VIEW SHAPE: the original 15 columns keep their order; new ones are APPENDED', () => {
  // Parse the SELECT list out of the view definition and compare it semantically
  // (whitespace/newline independent), so a reorder or an insertion in the middle
  // fails even though the SQL would still be valid.
  const viewSql = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE VIEW public.portal_my_shift_logs'))
  const selectList = viewSql.slice(viewSql.indexOf('SELECT') + 6, viewSql.indexOf('FROM public.student_shift_logs'))
  const cols = selectList.split(',').map(c => c.trim()).filter(Boolean).map(c => c.replace(/^l\./, ''))

  const ORIGINAL = ['id', 'student_id', 'cohort_id', 'shift_date', 'total_hours',
    'unit_name', 'is_assigned_unit', 'preceptor_name', 'is_assigned_preceptor',
    'shift_type', 'learning_highlight', 'support_needed',
    'status', 'submitted_at', 'reviewed_at']
  const APPENDED = ['lifecycle_state', 'unit_override_reason', 'preceptor_override_note']

  assert.deepEqual(cols.slice(0, 15), ORIGINAL,
    'the pre-existing prefix must be byte-for-byte the same columns in the same order')
  assert.deepEqual(cols.slice(15), APPENDED, 'new columns are appended, never interleaved')
  assert.equal(cols.length, 18)

  // The prefix is also checked against the ORIGINAL migration, so this cannot
  // silently drift if someone edits the older file.
  const originalView = read('supabase/migrations/20260712000008_phase2_student_portal_views.sql')
  const ov = originalView.slice(originalView.indexOf('CREATE OR REPLACE VIEW public.portal_my_shift_logs'))
  const ovList = ov.slice(ov.indexOf('SELECT') + 6, ov.indexOf('FROM public.student_shift_logs'))
  const ovCols = ovList.split(',').map(c => c.trim()).filter(Boolean).map(c => c.replace(/^l\./, ''))
  assert.deepEqual(ovCols, ORIGINAL, 'the baseline shape this guard protects is still what shipped')

  // NEGATIVE CONTROL: an interleaved column would break the prefix compare.
  const interleaved = [...ORIGINAL.slice(0, 13), 'lifecycle_state', ...ORIGINAL.slice(13)]
  assert.notDeepEqual(interleaved.slice(0, 15), ORIGINAL,
    'the guard genuinely detects a middle insertion')
})

test('the browser never writes shift logs and never sees staff internals', () => {
  const api = strip(read('src/lib/myShiftLogApi.js'))
  assert.match(api, /fetch\('\/api\/portal\/my-shift-log-manage'/)
  assert.doesNotMatch(api, /from\('student_shift_logs'\)/)
  const drawer = strip(read('src/portal/ShiftLogHistoryDrawer.jsx'))
  assert.doesNotMatch(drawer, /from\('student_shift_logs'\)/)
  assert.doesNotMatch(drawer, /exception_flags|admin_notes|reviewed_by|review_reason/,
    'staff internals are not rendered')
  // The portal view still excludes them at the database layer; the migration
  // adds ONLY lifecycle_state.
  const viewBlock = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE VIEW public.portal_my_shift_logs'))
  assert.match(viewBlock, /l\.lifecycle_state/)
  assert.doesNotMatch(viewBlock.slice(0, viewBlock.indexOf('WHERE')),
    /exception_flags|admin_notes|reviewed_by|school_email|review_reason/)
})

test('every write is gated on the readiness probe - fail closed pre-migration', () => {
  const gate = endpoint.indexOf('await editReady(db)')
  const firstRpc = endpoint.indexOf("rpc('student_void_shift_log'")
  assert.ok(gate > 0 && gate < firstRpc, 'the gate precedes every mutation')
  assert.match(endpoint, /migration_required/)
  assert.match(endpoint, /if \(error\) return false/)
  assert.match(endpoint, /return data === true/)
  assert.match(sqlCode, /CREATE OR REPLACE FUNCTION public\.student_shift_edit_ready/)
})

test('the RPCs are service-role only and the migration is gated', () => {
  for (const fn of ['student_edit_shift_log', 'student_void_shift_log', 'student_shift_edit_eligibility']) {
    assert.match(sqlCode, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]{0,400}FROM PUBLIC, anon, authenticated`), fn)
    assert.match(sqlCode, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]{0,400}TO service_role`), fn)
  }
  assert.match(sql, /APPLY MANUALLY[\s\S]{0,24}\(Owner\/Jester\)/)
  assert.match(sql, /Claude Code has applied NOTHING/)
  assert.match(sql, /db\/audit\/student_shift_self_service_smoke_test\.sql/)
  assert.match(sql, /ROLLBACK \(safe/)
  // students is untouched entirely; student_shift_logs is altered ONLY to close
  // the lifecycle_state vocabulary (F8) - no other column, and no policy.
  assert.doesNotMatch(sqlCode, /ALTER TABLE public\.students\b/)
  const alters = (sqlCode.match(/ALTER TABLE public\.student_shift_logs[\s\S]*?;/g) || [])
  assert.ok(alters.length > 0)
  for (const a of alters) {
    assert.match(a, /lifecycle_state|chk_ssl_lifecycle_state/,
      'every ALTER on the shift table concerns lifecycle_state only')
  }
  assert.doesNotMatch(sqlCode, /CREATE POLICY[^;]*ON public\.(students|student_shift_logs)\b/)
})

// ── The executable smoke test ──────────────────────────────────────────────

const smoke = read('db/audit/student_shift_self_service_smoke_test.sql')
const smokeCode = smoke.replace(/^\s*--.*$/gm, '')

test('the smoke test is transaction-wrapped, synthetic, self-failing, and complete', () => {
  assert.match(smokeCode, /^\s*BEGIN;/m)
  assert.match(smokeCode, /^\s*ROLLBACK;/m)
  assert.doesNotMatch(smokeCode, /COMMIT/i)
  assert.match(smokeCode, /'ZZ SELF TEST COHORT'/)
  assert.doesNotMatch(smokeCode, /<[A-Z_]+_ID>/, 'no placeholders')
  assert.match(smokeCode, /zz_self_fixture_rows_remaining/)
  const failures = smokeCode.match(/SMOKE TEST FAILURE:/g) || []
  assert.ok(failures.length >= 20, `every assertion aborts loudly (found ${failures.length})`)
  assert.match(smokeCode, /ALL SELF-SERVICE SMOKE TESTS PASSED/)
  for (const proof of [
    'another student\'\'s shift is not found, exactly like a nonexistent id',
    'recomputed both totals atomically',
    're-classified Pending Review -> Auto-Accepted',
    'void removed 4h from approved while the row kept every submitted value',
    'a withdrawn shift cannot be withdrawn or edited again',
    'no longer staff-reviewable',
    'stopped it raising duplicate/same-day warnings',
    'cannot be edited by the student',
    'staff review ledger and the decision itself are untouched',
    'concluded rotation stops student self-service',
    'terminal student status stops student self-service',
    'immutable before/after audit row',
  ]) assert.ok(smoke.includes(proof), `smoke proves: ${proof}`)
})

// ── F4 / F5 / F6 / F7 / F8 ─────────────────────────────────────────────────

test('F4: the drawer shows the SERVER eligibility verdict, never a local guess', () => {
  const drawer = read('src/portal/ShiftLogHistoryDrawer.jsx')
  assert.match(drawer, /fetchMyShiftEligibility/)
  assert.match(drawer, /const \[verdicts, setVerdicts\] = useState\(\{\}\)/)
  assert.match(drawer, /const v = verdicts\[log\.id\]/)
  // NEGATIVE CONTROL: the old local status guess must be gone - it could never
  // have known about a certificate, a concluded rotation, or a terminal status.
  assert.doesNotMatch(drawer, /\['Auto-Accepted', 'Pending Review', 'approved', 'needs_review'\]\.includes/,
    'the local eligibility guess is removed')
  // Until the verdict lands, NO action is offered (never a control that fails).
  assert.match(drawer, /if \(v === undefined\) return \{ ok: false, reason: null, ready: false \}/)
  assert.match(drawer, /!voided && can\.ready && can\.ok/)
  assert.match(drawer, /!voided && can\.ready && !can\.ok/)
  // The endpoint serves that verdict without mutating anything.
  assert.match(endpoint, /if \(action === 'eligibility'\) \{\s*\n?\s*return res\.status\(200\)\.json\(\{ success: true, eligibility: verdict \}\)/)
  const eligAt = endpoint.indexOf("action === 'eligibility'")
  const voidAt = endpoint.indexOf("rpc('student_void_shift_log'")
  assert.ok(eligAt > 0 && eligAt < voidAt, 'the read-only branch returns before any writer')
})

test('F5: student-authored fields are exposed, prefilled, editable, and never erased', () => {
  // Exposed (appended) in the student's own scoped view:
  const viewSql = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE VIEW public.portal_my_shift_logs'))
  assert.match(viewSql, /l\.unit_override_reason, l\.preceptor_override_note/)
  // Prefilled from the row rather than blanked:
  const drawer = read('src/portal/ShiftLogHistoryDrawer.jsx')
  assert.match(drawer, /unit_override_reason: log\.unit_override_reason \|\| ''/)
  assert.match(drawer, /preceptor_override_note: log\.preceptor_override_note \|\| ''/)
  // NEGATIVE CONTROL: blanking them on open would silently erase on save.
  assert.doesNotMatch(drawer, /unit_override_reason: '',/)
  assert.doesNotMatch(drawer, /preceptor_override_note: '',/)
  // Controls exist for all four student-authored fields:
  for (const tid of ['edit-unit-reason', 'edit-preceptor-note', 'edit-learning', 'edit-support']) {
    assert.ok(drawer.includes(`data-testid="${tid}"`), `${tid} control present`)
  }
  // The endpoint keeps the preceptor note independent of the checkbox, so
  // toggling one field cannot wipe another.
  assert.match(endpoint, /const preceptorOverrideNote = String\(body\.preceptor_override_note \|\| ''\)\.trim\(\)/)
  assert.doesNotMatch(endpoint, /is_assigned_preceptor === false\s*\n?\s*\? String\(body\.preceptor_override_note/)
  // All four are written by the RPC.
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.student_edit_shift_log'))
  for (const col of ['unit_override_reason', 'preceptor_override_note', 'learning_highlight', 'support_needed']) {
    assert.match(fn, new RegExp(`${col}\\s*=\\s*COALESCE\\(p_${col}`), col)
  }
})

test('F6: a withdrawn entry drives nothing, on every consumer that reads shift rows', () => {
  const lifecycle = read('src/lib/shiftLifecycle.js')
  assert.match(lifecycle, /export function shiftDrivesState/)
  // Support alerts + "last log" (staff Rotation board):
  const rot = read('src/components/RotationActivity.jsx')
  assert.match(rot, /if \(!shiftDrivesState\(l\)\) continue/)
  // Evaluation last-shift / support metadata (both automation panels):
  for (const f of ['src/components/evaluation/PostRotationAutomationPanel.jsx',
                   'src/components/evaluation/CaseyFinkPostRotationAutomationPanel.jsx']) {
    const panel = read(f)
    assert.match(panel, /if \(!shiftDrivesState\(log\)\) continue/, f)
    assert.match(panel, /support_needed, lifecycle_state/, `${f} selects the lifecycle it filters on`)
  }
  // On-campus fallback (a withdrawn row keeps its Auto-Accepted status):
  const campus = read('src/lib/onCampusNow.js')
  assert.match(campus, /shiftDrivesState\(log\) && isShiftCurrentlyActive/)
  // Unit-leader activity + rosters (server-side):
  for (const f of ['api/portal/unit-shift-activity.js', 'api/portal/unit-student-shifts.js',
                   'api/portal/unit-student-detail.js']) {
    assert.match(read(f), /\.neq\('lifecycle_state', 'voided'\)/, f)
  }
  // Student portal support notes + the attention count:
  const portal = read('src/portal/StudentPortal.jsx')
  assert.match(portal, /shiftDrivesState\(l\) && \(l\.support_needed \|\| ''\)\.trim\(\)\.length > 0/)
  const home = read('src/lib/portalHome.js')
  assert.match(home, /countAwaitingReview\(shiftLogs\)/)
  assert.doesNotMatch(home, /status !== 'approved'/, 'NEGATIVE CONTROL: the broken count is gone')
  // The attention engine already excluded voided via VALID_LIFECYCLE - pin it
  // so a future edit cannot widen that set without failing here.
  const att = read('src/lib/attention.js')
  assert.match(att, /VALID_LIFECYCLE = new Set\(\['completed', 'in_progress'\]\)/)
})

test('F6: withdrawn entries stay VISIBLE and labelled on history surfaces', () => {
  const drawer = read('src/portal/ShiftLogHistoryDrawer.jsx')
  assert.match(drawer, /label: 'Withdrawn'/.source ? /Withdrawn/ : /Withdrawn/)
  assert.match(drawer, /These hours do not count toward your totals; the entry is kept in your history/)
  const status = read('src/lib/portalShiftStatus.js')
  assert.match(status, /if \(isVoided\(log\)\) return \{ label: 'Withdrawn', tone: 'soft' \}/)
  // The drawer does NOT filter them out - history stays complete.
  assert.doesNotMatch(drawer, /logs\.filter\([^)]*voided[^)]*\)\.map/)
})

test('F7: acceptance parity reuses the approval semantics and never re-fires', async () => {
  const effects = strip(read('api/lib/studentShiftEffects.js'))
  assert.match(effects, /import \{ applyApprovalDownstream \} from '\.\/shiftReviewEffects\.js'/,
    'the submission/approval semantics are reused, not re-implemented')
  const { applyEditAcceptanceDownstream, recordHoursThresholdCorrection, HOURS_CORRECTION_EVENT } =
    await import('../api/lib/studentShiftEffects.js')

  // Only a genuine transition fires it.
  let fired = 0
  const spyDb = { from() { fired++; return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) } } }
  await applyEditAcceptanceDownstream(spyDb, { id: 's', cohort_id: 'c' }, { unit_name: 'U' },
    { status: 'Pending Review', previous_status: 'Pending Review', approved_hours: 8 })
  assert.equal(fired, 0, 'a still-pending edit fires nothing')
  await applyEditAcceptanceDownstream(spyDb, { id: 's', cohort_id: 'c' }, { unit_name: 'U' },
    { status: 'Auto-Accepted', previous_status: 'Auto-Accepted', approved_hours: 8 })
  assert.equal(fired, 0, 'an already-accepted re-save fires nothing')
  assert.equal(HOURS_CORRECTION_EVENT, 'rotation_hours_correction')
  assert.equal(typeof recordHoursThresholdCorrection, 'function')
})

test('F7: a threshold drop appends a correction and never rewrites history', async () => {
  const { recordHoursThresholdCorrection } = await import('../api/lib/studentShiftEffects.js')
  const writes = []
  const mkDb = (hasLatch, priorNotes) => ({
    from(table) {
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => {
          if (table !== 'program_events') return { data: null }
          if (q._type === 'rotation_end') return { data: hasLatch ? { id: 'e' } : null }
          return { data: priorNotes ? { id: 'p', notes: priorNotes } : null }
        },
        insert: async (row) => { writes.push(row); return { data: null, error: null } },
      }
      const origEq = q.eq
      q.eq = (k, v) => { if (k === 'event_type') q._type = v; return origEq() }
      return q
    },
  })
  const student = { id: 's', cohort_id: 'c', hours_required: 144 }

  // No latch -> nothing to correct.
  await recordHoursThresholdCorrection(mkDb(false), student, { approved_hours: 100 })
  assert.equal(writes.length, 0)
  // Still at/above the requirement -> nothing.
  await recordHoursThresholdCorrection(mkDb(true), student, { approved_hours: 150 })
  assert.equal(writes.length, 0)
  // Dropped below after the latch -> ONE appended event, nothing deleted.
  await recordHoursThresholdCorrection(mkDb(true), student, { approved_hours: 100 })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].event_type, 'rotation_hours_correction')
  assert.match(writes[0].notes, /100\/144/)
  // Repeating at the same numbers does not spam the timeline.
  await recordHoursThresholdCorrection(mkDb(true, writes[0].notes), student, { approved_hours: 100 })
  assert.equal(writes.length, 1)
  // NEGATIVE CONTROL: the correction is append-only - it never deletes or
  // updates the rotation_end latch.
  const effects = strip(read('api/lib/studentShiftEffects.js'))
  assert.doesNotMatch(effects, /\.delete\(|\.update\(/)
})

test('F8: lifecycle_state is a closed vocabulary, proven conformant before constraining', () => {
  const conformAt = sqlCode.indexOf('lifecycle_state conformance failed')
  const constraintAt = sqlCode.indexOf('ADD CONSTRAINT chk_ssl_lifecycle_state')
  assert.ok(conformAt > 0 && conformAt < constraintAt,
    'existing rows are proven conformant BEFORE the constraint is added')
  assert.match(sqlCode, /CHECK \(lifecycle_state IN \('completed', 'in_progress', 'voided'\)\)/)
  assert.match(sqlCode, /ALTER COLUMN lifecycle_state SET NOT NULL/,
    'NULL can no longer behave like anything')
  assert.match(sqlCode, /ALTER COLUMN lifecycle_state SET DEFAULT 'completed'/)
  // The conformance probe reports rather than rewrites.
  const probe = sqlCode.slice(conformAt - 900, conformAt + 400)
  assert.doesNotMatch(probe, /UPDATE public\.student_shift_logs SET lifecycle_state = 'completed' WHERE lifecycle_state NOT IN/,
    'it never silently rewrites an unexpected value')
})

// ── F3: the correction event is a first-class catalog entry ────────────────

test('F3: rotation_hours_correction is registered, labelled, and never manually selectable', async () => {
  const { EVENT_TYPES, EVENT_TYPE_LABELS, getEventColor } =
    await import('../src/lib/eventTypes.js')
  const { HOURS_CORRECTION_EVENT } = await import('../api/lib/studentShiftEffects.js')

  const entry = EVENT_TYPES.find(e => e.value === HOURS_CORRECTION_EVENT)
  assert.ok(entry, 'the event the writer emits is registered in the canonical catalog')
  assert.equal(entry.label, 'Clinical Hours Corrected', 'a human-readable staff label')
  assert.match(entry.color, /^#[0-9a-f]{6}$/i, 'it carries styling like every other entry')
  assert.equal(entry.manual, false,
    'system-generated: it must never appear in the staff "add event" picker')

  // The picker renders EVENT_TYPES.filter(t => t.manual), so manual:false is
  // what keeps it out - pin that wiring too.
  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /EVENT_TYPES\.filter\(t => t\.manual\)\.map/)
  assert.ok(!EVENT_TYPES.filter(t => t.manual).some(t => t.value === HOURS_CORRECTION_EVENT),
    'it is absent from the manual option list')

  // THE REGRESSION: the timeline renders `EVENT_TYPE_LABELS[type] || type`, so
  // an unregistered type leaks its raw identifier to staff. Registration is
  // what prevents that.
  assert.match(panel, /EVENT_TYPE_LABELS\[ev\.event_type\] \|\| ev\.event_type/,
    'the fallback that would leak a raw identifier still exists...')
  const rendered = EVENT_TYPE_LABELS[HOURS_CORRECTION_EVENT] || HOURS_CORRECTION_EVENT
  assert.equal(rendered, 'Clinical Hours Corrected')
  assert.notEqual(rendered, HOURS_CORRECTION_EVENT,
    '...and staff never see the raw snake_case value')
  assert.doesNotMatch(rendered, /_/, 'no underscores reach the staff timeline')
  assert.equal(getEventColor(HOURS_CORRECTION_EVENT), entry.color,
    'it is styled, not left on the grey default')
})

// ── Proof-integrity guards on the smoke test ──────────────────────────────

test('GUARD: no required smoke proof can hide behind a catch-all handler', () => {
  // A `WHEN OTHERS` (or `WHEN others`) branch would swallow a fixture failure
  // and let a skipped proof read as a passing one. The certificate lock was
  // previously lost exactly this way.
  assert.doesNotMatch(smokeCode, /WHEN\s+OTHERS/i,
    'no catch-all exception handler anywhere in the smoke test')
  // Every handler must name the specific SQLSTATE it expects...
  const handlers = smokeCode.match(/EXCEPTION WHEN [^\n]+/g) || []
  assert.ok(handlers.length >= 6, `expected several typed handlers, found ${handlers.length}`)
  for (const h of handlers) {
    assert.match(h, /SQLSTATE '(P000\d)'/,
      `every handler names its SQLSTATE: ${h}`)
  }
  // ...and no handler may reduce a failure to a NOTICE-only "skipped" outcome.
  assert.doesNotMatch(smoke, /skipped|SKIPPED/,
    'no proof reports itself as skipped')
})

test('GUARD: the certificate lock is proven with a REAL dependency chain', () => {
  // The fixture must build instrument -> assignment -> certificate, satisfying
  // the NOT NULL evaluation_assignment_id, the NOT NULL completion timestamp,
  // and the 1..999 sequence range that made the earlier attempt fail.
  assert.match(smokeCode, /INSERT INTO public\.evaluation_instruments/)
  assert.match(smokeCode, /INSERT INTO public\.evaluation_assignments/)
  assert.match(smokeCode, /INSERT INTO public\.certificates/)
  assert.match(smokeCode, /evaluation_assignment_id, certificate_number/)
  assert.match(smokeCode, /post_rotation_evaluation_completed_at/)
  assert.match(smokeCode, /certificate_sequence[\s\S]{0,200}999/)
  // It must FAIL if the fixture does not materialize...
  assert.match(smokeCode, /IF v_certificate IS NULL THEN[\s\S]{0,140}SMOKE TEST FAILURE/)
  // ...and it must assert the lock on BOTH the read path and a writer.
  assert.match(smokeCode, /'certificate_issued'/)
  assert.match(smokeCode, /voided after a certificate was issued/)
})

test("GUARD: the smoke test does not claim to prove portal multi-link authorization", () => {
  // That layer is above these functions; overstating it is what this guard
  // prevents. The endpoint boundary is proven in studentShiftLogEndpointAuthz.
  assert.doesNotMatch(smoke, /a multi-linked account acts on each of its own records/,
    'the overstated claim is gone')
  assert.match(smoke, /portal link resolution is proven at the endpoint|does NOT prove portal link resolution/,
    'the scope note names where the real proof lives')
  const authzSuite = read('test/studentShiftLogEndpointAuthz.test.mjs')
  assert.match(authzSuite, /getActiveStudentLinks/, 'the link layer is genuinely exercised there')
  assert.match(authzSuite, /linked to TWO students/)
})
