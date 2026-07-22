import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreceptorRequestIdController } from '../src/lib/preceptorRequestId.js'
import {
  assignmentErrorMessage,
  assignmentSuccessMessage,
  assignmentWindowIsClosed,
  buildAssignmentMutationPayload,
  collectStudentAssignments,
  createUnitAssignmentMutationController,
  mutationIntentKey,
} from '../src/portal/unit/unitPreceptorAssignments.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const portal = strip(read('src/portal/UnitLeaderPortal.jsx'))
const drawer = strip(read('src/portal/unit/StudentDetailDrawer.jsx'))
const workspace = strip(read('src/portal/unit/UnitPreceptorsWorkspace.jsx'))
const manager = strip(read('src/portal/unit/UnitLeaderPreceptorManager.jsx'))
const assignmentModule = strip(read('src/portal/unit/unitPreceptorAssignments.js'))
const unitApi = strip(read('src/portal/unit/unitLeaderApi.js'))
const endpoint = strip(read('api/portal/unit-preceptor-manage.js'))
const migration = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')

const roster = [
  {
    id: 'preceptor-primary', full_name: 'Pat Primary', home_unit: { id: 'u1', name: '5N' }, shift: 'Day',
    assignments: [{
      id: 'assignment-primary', student_id: 'student-1', student_name: 'Ana Lee', student_unit: '5N',
      role: 'Primary', start_date: '2026-07-01', end_date: null, status: 'active',
    }],
  },
  {
    id: 'preceptor-secondary', full_name: 'Sam Secondary', home_unit: { id: 'u2', name: '6N' }, shift: 'Night',
    assignments: [{
      id: 'assignment-secondary-a', student_id: 'student-1', student_name: 'Ana Lee', student_unit: '5N',
      role: 'Secondary', start_date: '2026-07-02', end_date: null, status: 'active',
    }, {
      id: 'assignment-out', student_id: 'student-2', student_name: 'Other', student_unit: '6N',
      role: 'Coverage', start_date: '2026-07-02', end_date: null, status: 'active',
    }],
  },
  {
    id: 'preceptor-coverage', full_name: 'Casey Coverage', home_unit: { id: 'u3', name: '7N' }, shift: 'Mid',
    assignments: [{
      id: 'assignment-coverage-a', student_id: 'student-1', student_name: 'Ana Lee', student_unit: '5N',
      role: 'Coverage', start_date: '2026-07-03', end_date: null, status: 'active',
    }],
  },
]

test('student kebab has the exact locked action order and no ambiguous Replace or End action', () => {
  const start = portal.indexOf('items={[')
  const menu = portal.slice(start, portal.indexOf(']}', start) + 2)
  const labels = [
    'Message student', 'Change Primary preceptor', 'Add Secondary preceptor', 'Add Coverage preceptor',
  ]
  let prior = -1
  for (const label of labels) {
    const index = menu.indexOf(label)
    assert.ok(index > prior, `${label} must follow the prior action`)
    prior = index
  }
  assert.doesNotMatch(menu, /Replace|End assignment/)
})

test('every entry point mounts the same portal-specific manager', () => {
  assert.match(portal, /<UnitLeaderPreceptorManager/)
  assert.match(drawer, />\s*Manage assignments\s*</)
  assert.match(workspace, /Manage student assignments/)
  assert.match(workspace, /<UnitLeaderPreceptorManager/)
  assert.doesNotMatch(manager, /PreceptorAssignmentModal|api\/preceptor-primary-assign/)
})

test('focused menu actions map to one shared manager implementation', () => {
  assert.match(portal, /'change_primary'/)
  assert.match(portal, /'add_secondary'/)
  assert.match(portal, /'add_coverage'/)
  assert.match(manager, /function initialIntent\(action\)/)
})

test('student assignments retain exact ids and all Primary, Secondary, and Coverage rows', () => {
  const rows = collectStudentAssignments(roster, 'student-1')
  assert.deepEqual(rows.map(row => [row.id, row.role, row.preceptor.id]), [
    ['assignment-primary', 'primary', 'preceptor-primary'],
    ['assignment-secondary-a', 'secondary', 'preceptor-secondary'],
    ['assignment-coverage-a', 'coverage', 'preceptor-coverage'],
  ])
  assert.doesNotMatch(JSON.stringify(rows), /assignment-out/)
})

test('Primary assignment payload is exact and contains no override authority', () => {
  const payload = buildAssignmentMutationPayload({
    action: 'change_primary', studentId: 'student-1', preceptorId: 'preceptor-new',
  }, 'request-primary')
  assert.deepEqual(payload, {
    action: 'change_primary', student_id: 'student-1', preceptor_id: 'preceptor-new', request_id: 'request-primary',
  })
  assert.doesNotMatch(JSON.stringify(payload), /force|confirm_override|actor|cohort/)
})

test('Secondary and Coverage Add payloads create one role-specific assignment', () => {
  for (const role of ['secondary', 'coverage']) {
    assert.deepEqual(buildAssignmentMutationPayload({
      action: 'set_secondary', op: 'add', role, studentId: 'student-1', preceptorId: `preceptor-${role}`,
    }, `request-${role}`), {
      action: 'set_secondary', op: 'add', role, student_id: 'student-1',
      request_id: `request-${role}`, preceptor_id: `preceptor-${role}`,
    })
  }
})

test('Replace sends the selected exact assignment id and role', () => {
  const payload = buildAssignmentMutationPayload({
    action: 'set_secondary', op: 'replace', role: 'secondary', studentId: 'student-1',
    assignmentId: 'assignment-secondary-a', preceptorId: 'preceptor-new',
  }, 'request-replace')
  assert.equal(payload.assignment_id, 'assignment-secondary-a')
  assert.equal(payload.role, 'secondary')
  assert.equal(payload.op, 'replace')
  assert.equal(payload.preceptor_id, 'preceptor-new')
})

test('End sends the selected exact assignment id and no replacement preceptor', () => {
  const payload = buildAssignmentMutationPayload({
    action: 'set_secondary', op: 'end', role: 'coverage', studentId: 'student-1',
    assignmentId: 'assignment-coverage-a', preceptorId: null,
  }, 'request-end')
  assert.deepEqual(payload, {
    action: 'set_secondary', op: 'end', role: 'coverage', student_id: 'student-1',
    request_id: 'request-end', assignment_id: 'assignment-coverage-a',
  })
})

test('failed retry keeps one request id and a rapid duplicate is blocked', async () => {
  const calls = []
  let release
  const pending = new Promise(resolve => { release = resolve })
  const controller = createUnitAssignmentMutationController({
    requestIdsFactory: () => createPreceptorRequestIdController(() => 'stable-request'),
    mutate: payload => { calls.push(payload); return pending },
  })
  const intent = { action: 'change_primary', studentId: 'student-1', preceptorId: 'preceptor-new' }
  const key = mutationIntentKey(intent)
  const first = controller.submit(key, requestId => buildAssignmentMutationPayload(intent, requestId))
  const duplicate = await controller.submit(key, requestId => buildAssignmentMutationPayload(intent, requestId))
  assert.deepEqual(duplicate, { ok: false, error: 'submission_in_progress' })
  release({ ok: false, status: 500, error: 'internal_error' })
  await first
  await controller.submit(key, requestId => buildAssignmentMutationPayload(intent, requestId))
  assert.deepEqual(calls.map(call => call.request_id), ['stable-request', 'stable-request'])
})

test('a different operation, assignment, or selected preceptor gets a new request id', async () => {
  let created = 0
  const calls = []
  const controller = createUnitAssignmentMutationController({
    requestIdsFactory: () => createPreceptorRequestIdController(() => `request-${++created}`),
    mutate: async payload => { calls.push(payload); return { ok: true } },
  })
  const first = { action: 'set_secondary', op: 'replace', role: 'secondary', studentId: 'student-1', assignmentId: 'a', preceptorId: 'p1' }
  const second = { ...first, assignmentId: 'b', preceptorId: 'p2' }
  await controller.submit(mutationIntentKey(first), requestId => buildAssignmentMutationPayload(first, requestId))
  await controller.submit(mutationIntentKey(second), requestId => buildAssignmentMutationPayload(second, requestId))
  assert.deepEqual(calls.map(call => call.request_id), ['request-1', 'request-2'])
})

test('candidate choices are safe, active-feed based, searchable, and cross-unit labeled', () => {
  assert.match(manager, /const candidates = useMemo\(\(\) => resource\.data\?\.candidates/)
  assert.match(manager, /assignedPreceptorIds\.has\(candidate\.id\)/)
  assert.match(manager, /full_name[\s\S]*toLowerCase\(\)\.includes\(query\)/)
  assert.match(manager, /Cross-unit choice/)
  assert.doesNotMatch(manager, /candidate\.assignments|candidate\.student/)
})

test('the established MS400, MS403, MS404, and MS409 classes have non-enumerating UI messages', () => {
  assert.match(assignmentErrorMessage({ status: 400 }), /incomplete|no longer active/)
  assert.match(assignmentErrorMessage({ status: 403 }), /90-day/)
  assert.match(assignmentErrorMessage({ status: 404 }), /authorized scope/)
  assert.match(assignmentErrorMessage({ status: 409 }), /conflicts|already active/)
  assert.doesNotMatch(assignmentModule, /error\.message|database|table|constraint/)
})

test('actual backend old and new values drive success copy', () => {
  assert.equal(assignmentSuccessMessage({
    action: 'replace_secondary', old_preceptor_name: 'Old Nurse', new_preceptor_name: 'New Nurse',
  }, 'secondary'), 'Secondary changed from Old Nurse to New Nurse.')
  assert.equal(assignmentSuccessMessage({
    action: 'end_coverage', old_preceptor_name: 'Coverage Nurse', new_preceptor_name: null,
  }, 'coverage'), 'Coverage assignment for Coverage Nurse ended.')
})

test('successful mutation refreshes both manager and calling surfaces without optimistic assignment edits', () => {
  assert.match(manager, /const refreshed = await load\(\)/)
  assert.match(manager, /onCommitted\?\.\(committed, message\)/)
  assert.match(portal, /refreshRoster\?\.\(\)/)
  assert.match(workspace, /preceptors\.refresh\(\)[\s\S]*onAssignmentsChanged\?\.\(\)/)
  assert.doesNotMatch(manager, /setAssignments|splice\(|\.push\(/)
})

test('refresh failure preserves committed success and offers read-only Retry refresh', () => {
  assert.match(manager, /The assignment changed, but the current assignment list could not be refreshed/)
  assert.match(manager, />Retry refresh</)
  const retry = manager.slice(manager.indexOf('const refresh = async'), manager.indexOf('const submit = async'))
  assert.doesNotMatch(retry, /mutateUnitPreceptorAssignment|controller\.submit/)
})

test('End requires an exact-role confirmation before the mutation button', () => {
  assert.match(manager, /End the \{ROLE_LABEL\[intent\.role\]\} assignment/)
  assert.match(manager, /Only assignment <code>\{intent\.assignmentId\}<\/code> will end/)
  assert.match(manager, /intent\.op === 'end'/)
})

test('the manager traps focus, supports safe Escape, and restores the initiating control', () => {
  assert.match(manager, /role="dialog" aria-modal="true"/)
  assert.match(manager, /event\.key === 'Escape'/)
  assert.match(manager, /event\.key !== 'Tab'/)
  assert.match(manager, /returnTo\?\.focus\?\.\(\)/)
  assert.match(manager, /if \(saving\) return/)
})

test('completed-window UI locks only on an explicit reliable server flag and still maps backend MS403', () => {
  assert.equal(assignmentWindowIsClosed({ assignment_window_closed: true }), true)
  assert.equal(assignmentWindowIsClosed({ bucket: 'completed', rotation: { end: '2020-01-01' } }), false)
  assert.match(manager, /Assignments are read-only because this completed rotation is outside the 90-day/)
  assert.match(manager, /disabled=\{readOnly\}/)
})

test('security boundary: no direct assignment writes, staff surface reuse, override, actor, or cohort authority', () => {
  const portalAssignmentSurface = manager + assignmentModule + unitApi
  assert.doesNotMatch(portalAssignmentSurface, /\.from\('student_preceptor_assignments'\)/)
  assert.doesNotMatch(manager, /PreceptorAssignmentModal|usePreceptors|api\/preceptor-primary-assign/)
  assert.doesNotMatch(assignmentModule, /force|confirm_override|actor_profile|cohort_id/)
  assert.match(unitApi, /mutateUnitPreceptorAssignment[\s\S]*unit-preceptor-manage/)
  assert.match(endpoint, /verifyPortalUnitLeaderCaller/)
})

test('Phase 2C targeted-row preservation and Owner/Admin notifications remain unchanged', () => {
  const secondary = migration.slice(
    migration.indexOf('FUNCTION public.set_secondary_coverage_preceptor'),
    migration.indexOf('FUNCTION public.create_unit_preceptor'))
  assert.match(secondary, /WHERE id = p_assignment_id/)
  assert.match(secondary, /Add and Replace both insert exactly ONE new active assignment/)
  assert.match(secondary, /_emit_staff_notifications/)
  assert.match(secondary, /old_preceptor_name/)
  assert.match(secondary, /new_preceptor_name/)
})
