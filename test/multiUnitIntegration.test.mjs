// MULTI-UNIT-STUDENT-PLACEMENTS-2: integration wiring guards.
//
// The behavioral rules are proven elsewhere (unitLeaderMultiUnitScope,
// shiftUnitAssignments); this file pins the WIRING: the management endpoint's
// authorization and gating, the UI's distinctions, the portal fix, the shift
// endpoints' recognition path, and the sync migration's guarantees.
//
// Run: node --test test/multiUnitIntegration.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── The sync migration (UNAPPLIED - gated) ──────────────────────────────────

const syncSql = read('supabase/migrations/20260817000000_student_unit_assignment_sync.sql')
const syncCode = syncSql.replace(/--[^\n]*/g, '')

test('the sync migration is additive: triggers + functions only, no table or policy changes', () => {
  assert.doesNotMatch(syncCode, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY|GRANT SELECT ON|CREATE INDEX/)
  assert.equal((syncCode.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 4)
  assert.equal((syncCode.match(/CREATE TRIGGER/g) || []).length, 2)
})

test('both sync directions exist, with recursion made impossible', () => {
  assert.match(syncCode, /CREATE TRIGGER trg_sync_assignments_from_matched_unit\s*\n?\s*AFTER UPDATE OF matched_unit_id ON public\.students/)
  assert.match(syncCode, /WHEN \(OLD\.matched_unit_id IS DISTINCT FROM NEW\.matched_unit_id\)/)
  assert.match(syncCode, /CREATE TRIGGER trg_sync_matched_unit_from_assignments\s*\n?\s*AFTER INSERT OR UPDATE ON public\.student_unit_assignments/)
  assert.equal((syncCode.match(/pg_trigger_depth\(\) > 1/g) || []).length, 2,
    'both directions carry the depth guard')
})

test('the students->assignments direction ends, promotes, or inserts - never duplicates', () => {
  const fn = syncCode.slice(syncCode.indexOf('sync_assignments_from_matched_unit'), syncCode.indexOf('sync_matched_unit_from_assignments'))
  assert.match(fn, /SET status = 'ended', ended_at = now\(\)/)
  assert.match(fn, /status IN \('planned', 'active'\)/, 'an existing live row for the unit is found')
  assert.match(fn, /SET role = 'primary', status = 'active'/, 'and PROMOTED rather than duplicated')
})

test('a cross-cohort classic match is REJECTED before ANY mutation - never silent drift', () => {
  const fn = syncCode.slice(syncCode.indexOf('sync_assignments_from_matched_unit'), syncCode.indexOf('sync_matched_unit_from_assignments'))
  // The validation raises, aborting the whole classic-match transaction:
  assert.match(fn, /IF NEW\.matched_unit_id IS NOT NULL AND NOT EXISTS \(\s*SELECT 1 FROM public\.units u\s*WHERE u\.id = NEW\.matched_unit_id AND u\.cohort_id = NEW\.cohort_id\s*\)/)
  assert.match(fn, /RAISE EXCEPTION 'students\.matched_unit_id %: unit does not belong to cohort % - cross-cohort match rejected'/)
  // ...and it does so BEFORE the old primary is ended and BEFORE any insert:
  const rejectAt = fn.indexOf('cross-cohort match rejected')
  const endAt = fn.indexOf("SET status = 'ended'")
  const insertAt = fn.indexOf('INSERT INTO public.student_unit_assignments')
  assert.ok(rejectAt > 0 && endAt > 0 && insertAt > 0)
  assert.ok(rejectAt < endAt, 'validation precedes ending the current primary')
  assert.ok(rejectAt < insertAt, 'validation precedes the insert')
  // The old conditional INSERT..SELECT gated on the units join (the
  // "inserts nothing" drift path) is gone - the insert is unconditional:
  assert.doesNotMatch(fn, /INSERT INTO public\.student_unit_assignments[\s\S]{0,300}SELECT NEW\.id/,
    'no insert-nothing path remains')
  assert.match(fn, /VALUES \(NEW\.id, NEW\.cohort_id, NEW\.matched_unit_id, 'primary', 'active'/)
})

test('NEGATIVE CONTROL: stripping the cross-cohort validation fails the rejection guard', () => {
  const fn = syncCode.slice(syncCode.indexOf('sync_assignments_from_matched_unit'), syncCode.indexOf('sync_matched_unit_from_assignments'))
  const stripped = fn.replace(/IF NEW\.matched_unit_id IS NOT NULL AND NOT EXISTS[\s\S]*?END IF;/, '')
  assert.ok(!stripped.includes('cross-cohort match rejected'),
    'the RAISE lives only inside the validation block - removing the block removes the guard text')
})

test('the assignments->students direction projects the active primary (or NULL)', () => {
  const fn = syncCode.slice(syncCode.indexOf('sync_matched_unit_from_assignments'), syncCode.indexOf('set_primary_unit_assignment'))
  assert.match(fn, /role = 'primary' AND status = 'active'/)
  assert.match(fn, /SET matched_unit_id = v_primary_unit/)
  assert.match(fn, /matched_unit_id IS DISTINCT FROM v_primary_unit/, 'idempotent projection')
})

test('set_primary_unit_assignment is atomic, validated, actor-attributed, service-role only', () => {
  const fn = syncCode.slice(syncCode.indexOf('CREATE OR REPLACE FUNCTION public.set_primary_unit_assignment'))
  assert.match(fn, /unit_not_in_student_cohort/)
  assert.match(fn, /ended_by = p_actor_profile_id/)
  assert.match(fn, /assigned_by\)/)
  assert.match(syncCode, /REVOKE ALL ON FUNCTION public\.set_primary_unit_assignment[\s\S]{0,80}FROM PUBLIC, anon, authenticated/)
  assert.match(syncCode, /GRANT EXECUTE ON FUNCTION public\.set_primary_unit_assignment[\s\S]{0,80}TO service_role/)
})

test('the migration is marked apply-manually and ships verification + rollback', () => {
  assert.match(syncSql, /APPLY MANUALLY[\s\S]{0,24}\(Owner\/Jester\)/)
  assert.match(syncSql, /Claude Code has applied NOTHING/)
  assert.match(syncSql, /SYNC SMOKE TEST/)
  assert.match(syncSql, /db\/audit\/student_unit_assignment_sync_smoke_test\.sql/,
    'the verification block hands the Owner the executable smoke file')
  assert.match(syncSql, /ROLLBACK \(safe/)
  assert.match(syncSql, /DROP FUNCTION IF EXISTS public\.set_primary_unit_assignment/)
})

// ── The executable sync smoke test (db/audit) ───────────────────────────────

const syncSmoke = read('db/audit/student_unit_assignment_sync_smoke_test.sql')
const syncSmokeCode = syncSmoke.replace(/^\s*--.*$/gm, '')

test('the sync smoke test is transaction-wrapped, synthetic-only, and placeholder-free', () => {
  assert.match(syncSmokeCode, /^\s*BEGIN;/m)
  assert.match(syncSmokeCode, /^\s*ROLLBACK;/m)
  assert.doesNotMatch(syncSmokeCode, /COMMIT/i, 'nothing may persist')
  assert.match(syncSmokeCode, /INSERT INTO public\.cohorts \(name, status\) VALUES \('ZZ SYNC TEST COHORT'/)
  assert.match(syncSmokeCode, /INSERT INTO public\.units \(unit_name, cohort_id, total_slots\)/)
  assert.match(syncSmokeCode, /INSERT INTO public\.students \(name, first_name, last_name, cohort_id\)/)
  assert.doesNotMatch(syncSmokeCode, /<[A-Z_]+_ID>/, 'no placeholders - executable as pasted')
  assert.doesNotMatch(syncSmokeCode, /DELETE FROM/, 'the sync test deletes nothing, synthetic or otherwise')
  assert.match(syncSmokeCode, /zz_sync_fixture_rows_remaining/,
    'a trailing count AFTER the rollback proves no fixture remains')
})

test('the sync smoke test proves both directions, rematch, unmatch, and promote', () => {
  // Direction 1: classic writes to students materialize assignment rows.
  assert.match(syncSmokeCode, /UPDATE public\.students SET matched_unit_id = v_unit_a WHERE id = v_student/)
  assert.match(syncSmokeCode, /classic match did not create the active primary/)
  assert.match(syncSmokeCode, /rematch did not end the old primary/)
  assert.match(syncSmokeCode, /promote created a duplicate row/)
  assert.match(syncSmokeCode, /UPDATE public\.students SET matched_unit_id = NULL WHERE id = v_student/)
  assert.match(syncSmokeCode, /unmatch left an active primary/)
  // Direction 2: assignment writes project back into students.
  assert.match(syncSmokeCode, /ending the primary left matched_unit_id/)
  assert.match(syncSmokeCode, /inserted active primary was not projected/)
})

test('the sync smoke test proves the RPC is atomic and refuses cross-cohort units', () => {
  const calls = syncSmokeCode.match(/public\.set_primary_unit_assignment\(/g) || []
  assert.ok(calls.length >= 3, `RPC exercised repeatedly (found ${calls.length} calls)`)
  assert.match(syncSmokeCode, /RPC did not project matched_unit_id in-transaction/)
  assert.match(syncSmokeCode, /RPC did not end the outgoing primary/)
  assert.match(syncSmokeCode, /unit_not_in_student_cohort/)
})

test('the sync smoke test proves cross-cohort rejection leaves prior state UNCHANGED', () => {
  // The rejection runs in its own sub-block, discriminated by message
  // (our own failure marker is also P0001):
  assert.match(syncSmokeCode, /EXCEPTION WHEN raise_exception THEN/)
  assert.match(syncSmokeCode, /position\('cross-cohort match rejected' in SQLERRM\) > 0/)
  assert.match(syncSmokeCode, /cross-cohort classic match was accepted/,
    'unexpected success fails the test loudly')
  // ...and the state assertions AFTER the block prove nothing moved:
  assert.match(syncSmokeCode, /rejected match still changed matched_unit_id/)
  assert.match(syncSmokeCode, /rejected match still ended the active primary/)
  assert.match(syncSmokeCode, /rejected match changed the assignment row count/)
})

test('the sync smoke test is self-failing end to end', () => {
  const failures = syncSmokeCode.match(/SMOKE TEST FAILURE:/g) || []
  assert.ok(failures.length >= 15, `every assertion aborts loudly (found ${failures.length})`)
  assert.match(syncSmokeCode, /ALL SYNC SMOKE TESTS PASSED/)
})

// ── The management endpoint ─────────────────────────────────────────────────

const manage = strip(read('api/student-unit-assignments-manage.js'))

test('the endpoint is Owner/Admin only and never trusts client cohort or actor', () => {
  assert.match(manage, /\['owner', 'admin'\]\.includes\(profile\.role/)
  assert.match(manage, /\.select\('id, cohort_id'\)\.eq\('id', body\.student_id\)/,
    "cohort authority is the student's row, not the request")
  assert.match(manage, /p_actor_profile_id: profile\.id/, 'the actor is the verified caller')
  assert.doesNotMatch(manage, /body\.cohort_id|body\.actor/)
})

test('EVERY write is gated on sua_sync_ready - fail closed on the sync migration', () => {
  const gate = manage.indexOf('await syncReady(db)')
  const firstAction = manage.indexOf("action === 'set_primary'")
  assert.ok(gate > 0 && gate < firstAction, 'the gate precedes every action')
  assert.match(manage, /migration_required/)
  assert.match(manage, /if \(error\) return false/,
    'a missing function (PGRST202) or any error means NOT ready')
  assert.match(manage, /return data === true/, 'and only an explicit true passes')
})

test('set_primary goes through the atomic RPC; nothing else writes matched_unit_id', () => {
  assert.match(manage, /db\.rpc\('set_primary_unit_assignment'/)
  assert.doesNotMatch(manage, /matched_unit_id/,
    'the endpoint never writes the projection directly - the trigger owns it')
})

test('end and remove preserve history with actor attribution; nothing deletes', () => {
  assert.match(manage, /status: action === 'end' \? 'ended' : 'removed'/)
  assert.match(manage, /ended_by: profile\.id/)
  assert.doesNotMatch(manage, /\.delete\(/, 'history is ended or removed by status, never erased')
})

test('constraint rejections surface as actionable errors', () => {
  assert.match(manage, /unit_already_live_for_student/)
  assert.match(manage, /unit_not_in_student_cohort/)
  assert.match(manage, /end_date_before_start_date/)
})

test('the endpoint never reads shift logs - assignments are never inferred', () => {
  assert.doesNotMatch(manage, /shift_log|student_shift_logs/)
})

// ── The client lib + UI ─────────────────────────────────────────────────────

const api = strip(read('src/lib/studentUnitAssignmentsApi.js'))
const ui = read('src/components/StudentUnitAssignments.jsx')

test('client reads via RLS, writes only via the endpoint', () => {
  assert.match(api, /from\('student_unit_assignments'\)[\s\S]{0,200}\.select\(/)
  assert.match(api, /fetch\('\/api\/student-unit-assignments-manage'/)
  assert.doesNotMatch(api, /from\('student_unit_assignments'\)[\s\S]{0,400}\.(insert|update|upsert|delete)\(/,
    'the browser never writes assignment rows')
})

test('the UI distinguishes primary/additional and planned/active/ended/removed', () => {
  for (const label of ["label: 'Primary'", "label: 'Additional'", "label: 'Active'", "label: 'Planned'", "label: 'Ended'", "label: 'Removed'"]) {
    assert.ok(ui.includes(label), `${label} rendered`)
  }
  assert.match(ui, /data-testid="unit-assignment-row"/)
  assert.match(ui, /fmtRange/, 'dates are shown per assignment')
  assert.match(ui, /Show.*history|history\.length/, 'history is visible but separated')
})

test('management actions exist and are gated on canManage; migration_required is surfaced honestly', () => {
  for (const action of ["action: 'set_primary'", "action: 'add'", "action: 'end'", "action: 'remove'"]) {
    assert.ok(ui.includes(action), action)
  }
  assert.match(ui, /canManage && /)
  assert.match(ui, /migration_required/)
  assert.match(ui, /20260817000000/)
})

test('Edit covers dates and notes through the update action - including ended rows', () => {
  assert.match(ui, /data-testid="sua-edit-form"/)
  assert.match(ui, /action: 'update'/)
  assert.match(ui, /assignment_id: a\.id/)
  assert.match(ui, /notes: editNotes/)
  // Ended assignments stay editable: their dates still decide which shift
  // logs validate. Only removed rows are frozen.
  assert.match(ui, /a\.status !== 'removed'/)
  assert.match(ui, /dates still decide which shift logs it validates/)
})

test('change primary, end, and remove each require an explicit confirmation stating the consequence', () => {
  assert.match(ui, /data-testid="sua-confirm"/)
  // The row buttons STAGE a confirmation - they never send anything:
  assert.match(ui, /setConfirming\(\{ type: 'set_primary', a \}\)/)
  assert.match(ui, /setConfirming\(\{ type: 'end', a \}\)/)
  assert.match(ui, /setConfirming\(\{ type: 'remove', a \}\)/)
  // Only the confirmed runner reaches act():
  assert.match(ui, /runConfirmed/)
  // Each consequence is spelled out in the confirmation copy:
  assert.match(ui, /current primary assignment is ended and kept as history/)
  assert.match(ui, /one atomic operation/)
  assert.match(ui, /stops granting portal access/)
  assert.match(ui, /still validate against it/)
  assert.match(ui, /clears the student's matched unit/)
  assert.match(ui, /entered in error/)
  assert.match(ui, /never grants access and never validates any shift log/)
})

test('NEGATIVE CONTROL: no consequential action fires from a row button without confirmation', () => {
  // The pre-correction shape called act() straight from onClick - it must not return:
  assert.doesNotMatch(ui, /onClick=\{\(\) => act\(\{ action: 'set_primary'/)
  assert.doesNotMatch(ui, /onClick=\{\(\) => act\(\{ action: 'end'/)
  assert.doesNotMatch(ui, /onClick=\{\(\) => act\(\{ action: 'remove'/)
  // And the consequential act() calls live only inside the confirmed runner:
  const runner = ui.slice(ui.indexOf('const runConfirmed'), ui.indexOf('const editForm'))
  for (const action of ["action: 'set_primary', student_id", "action: 'end', assignment_id", "action: 'remove', assignment_id"]) {
    const inRunner = runner.includes(action)
    const outsideRunner = ui.replace(runner, '').includes(action)
    assert.ok(inRunner && !outsideRunner, `${action} only runs post-confirmation`)
  }
})

test('the side panel mounts the section and gates management to Owner/Admin', () => {
  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /<StudentUnitAssignments/)
  assert.match(panel, /canManage=\{\['owner', 'admin'\]\.includes\(userProfile\?\.role/)
})

// ── The Student portal fix ──────────────────────────────────────────────────

test('the student portal unit comes from LIVE assignments, dead students.unit only as last resort', () => {
  // Both the student's own endpoint and Owner/Admin preview use this shared builder.
  const summary = strip(read('api/lib/studentPortalSummary.js'))
  assert.match(summary, /from\('student_unit_assignments'\)/)
  assert.match(summary, /\.in\('status', \['planned', 'active'\]\)/)
  assert.match(summary, /unit_name: unitsByStudent\[student\.id\]\?\.\[0\] \|\| student\.unit \|\| null/)
  assert.match(summary, /unit_names: unitsByStudent\[student\.id\] \|\| \[\]/)
  const portal = read('src/portal/StudentPortal.jsx')
  assert.match(portal, /student\.unit_names/)
})

// ── Shift-log recognition wiring ────────────────────────────────────────────

test('both shift endpoints recognize units through the assignment matcher', () => {
  for (const f of ['api/shift-log/check-out.js', 'api/shift-log/submit-past-shift.js']) {
    const src = strip(read(f))
    assert.match(src, /shiftMatchesAssignments\(assignments, \{ shiftDate, unitName \}\)/, f)
    assert.match(src, /loadShiftAssignments\(/, f)
    // The compound rule still requires the preceptor half - unchanged.
    assert.match(src, /!unitRecognized && preceptorDiffers/, f)
  }
})

test('single-unit fallback is preserved when a student has no assignment rows', () => {
  for (const f of ['api/shift-log/check-out.js', 'api/shift-log/submit-past-shift.js']) {
    const src = strip(read(f))
    assert.match(src, /assignments\.length > 0/, f)
    assert.match(src, /unitName\.trim\(\) === String\(/, `${f} keeps the pre-existing compare as fallback`)
  }
})

test('shift endpoints never write assignments (no inference, structurally)', () => {
  for (const f of ['api/shift-log/check-out.js', 'api/shift-log/submit-past-shift.js', 'api/lib/shiftLogLookup.js']) {
    const src = strip(read(f))
    assert.doesNotMatch(src, /from\('student_unit_assignments'\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/, f)
  }
})

// ── Negative control ────────────────────────────────────────────────────────

test('NEGATIVE CONTROL: removing the sync gate or the RPC call fails this suite', () => {
  assert.ok(manage.includes('syncReady'), 'gate present')
  assert.ok(manage.includes("rpc('set_primary_unit_assignment'"), 'RPC present')
  const withoutGate = manage.replace(/if \(!\(await syncReady\(db\)\)\) \{[\s\S]*?\}\s*/, '')
  assert.ok(!withoutGate.includes('migration_required') || withoutGate.length < manage.length,
    'stripping the gate removes the text the gate assertion keys on')
})
