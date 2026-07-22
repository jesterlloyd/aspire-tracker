import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreceptorRequestIdController } from '../src/lib/preceptorRequestId.js'
import { createUnitPreceptorCreationController } from '../src/portal/unit/unitPreceptorCreation.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const chrome = strip(read('src/portal/unit/UnitLeaderChrome.jsx'))
const app = strip(read('src/portal/PortalApp.jsx'))
const portal = strip(read('src/portal/UnitLeaderPortal.jsx'))
const workspace = strip(read('src/portal/unit/UnitPreceptorsWorkspace.jsx'))
const modal = strip(read('src/portal/unit/UnitPreceptorCreateModal.jsx'))
const api = strip(read('src/portal/unit/unitLeaderApi.js'))
const migration = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')

test('desktop and mobile navigation match the locked Preceptors workspace order', () => {
  assert.match(chrome, /const DESKTOP_KEYS = \['home', 'preceptors', 'messages', 'evaluations', 'placements', 'capacity'\]/)
  assert.match(chrome, /const MOBILE_PRIMARY_KEYS = \['home', 'preceptors', 'messages'\]/)
  assert.match(chrome, /const MOBILE_MORE_KEYS = \['evaluations', 'placements', 'capacity'\]/)
  assert.match(chrome, /label: 'Preceptors'/)
  assert.doesNotMatch(chrome, /Preceptor Assignments/)
})

test('students deep link remains while stale notifications route metadata is removed', () => {
  const sections = /const UNIT_SECTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(app)?.[1] || ''
  assert.match(sections, /'students'/)
  assert.match(sections, /'profile'/)
  assert.doesNotMatch(sections, /'notifications'/)
  assert.match(portal, /Notification preferences/)
})

test('workspace supplies the complete roster table, filters, states, and legacy history', () => {
  for (const heading of [
    'Name', 'Contact', 'Home unit', 'Shift', 'Status', 'Current students', 'Assignments', 'Association',
  ]) assert.ok(workspace.includes(`>${heading}<`), heading)
  for (const control of ['Name or email', 'All shifts', 'All statuses', 'Cross-unit only', 'Assignment count']) {
    assert.ok(workspace.includes(control), control)
  }
  for (const state of ['TableSkeleton', 'ErrorState', 'No associated preceptors', 'No matching preceptors']) {
    assert.ok(workspace.includes(state), state)
  }
  assert.match(workspace, /Legacy nomination history/)
  assert.match(workspace, /getNominations\(unitKey, signal\)/)
  assert.doesNotMatch(workspace, /nominatePreceptor|proposed_name|Nominate/)
  assert.doesNotMatch(api, /export const nominatePreceptor/)
})

test('portal creation form exposes only scoped unit options and the approved fields', () => {
  assert.match(modal, /unitKeys\.map\(unit =>/)
  assert.doesNotMatch(modal, /from\('units'\)|PreceptorFormModal|usePreceptors/)
  for (const field of ['full_name', 'email', 'phone', 'unit_key', 'shift']) {
    assert.ok(modal.includes(field), field)
  }
  assert.match(api, /action: 'create_preceptor'/)
  assert.match(api, /request_id: requestId/)
})

test('successful creation completes an intent and the next action gets a new request id', async () => {
  let created = 0
  const calls = []
  const controller = createUnitPreceptorCreationController({
    requestIds: createPreceptorRequestIdController(() => `intent-${++created}`),
    create: async payload => { calls.push(payload); return { ok: true, data: { result: { ok: true } } } },
  })
  assert.equal((await controller.submit({ full_name: 'A' })).ok, true)
  assert.equal((await controller.submit({ full_name: 'B' })).ok, true)
  assert.deepEqual(calls.map(call => call.requestId), ['intent-1', 'intent-2'])
})

test('rapid double submission is blocked while the first request is in flight', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const controller = createUnitPreceptorCreationController({
    requestIds: createPreceptorRequestIdController(() => 'stable-intent'),
    create: async () => pending,
  })
  const first = controller.submit({ full_name: 'A' })
  const second = await controller.submit({ full_name: 'A' })
  assert.deepEqual(second, { ok: false, error: 'submission_in_progress' })
  release({ ok: true })
  await first
})

test('failed creation retry replays the same request id', async () => {
  const calls = []
  let attempt = 0
  const controller = createUnitPreceptorCreationController({
    requestIds: createPreceptorRequestIdController(() => 'retry-intent'),
    create: async payload => {
      calls.push(payload)
      attempt += 1
      return attempt === 1 ? { ok: false, status: 500, error: 'internal_error' } : { ok: true }
    },
  })
  assert.equal((await controller.submit({ full_name: 'A' })).ok, false)
  assert.equal((await controller.submit({ full_name: 'A' })).ok, true)
  assert.deepEqual(calls.map(call => call.requestId), ['retry-intent', 'retry-intent'])
})

test('creation errors are mapped and success refreshes the roster without approval wording', () => {
  assert.match(modal, /result\.status === 409/)
  assert.match(modal, /result\.status === 403 \|\| result\.status === 404/)
  assert.match(workspace, /preceptors\.refresh\(\)/)
  assert.match(workspace, /Preceptor created and active\. Owner\/Admin reviewers were notified/)
  assert.doesNotMatch(workspace, /pending approval|awaiting approval|must approve/i)
})

test('Owner/Admin review notification contract remains generated by create_unit_preceptor', () => {
  const createFn = migration.slice(
    migration.indexOf('FUNCTION public.create_unit_preceptor'),
    migration.indexOf('FUNCTION public.claim_due_staff_notifications'))
  assert.match(createFn, /New preceptor created' \|\| \(CASE WHEN v_role = 'unit_leader' THEN ' by a Unit Leader \(review\)'/)
  assert.match(createFn, /_emit_staff_notifications/)
  assert.match(createFn, /'\/rotation\/preceptors'/)
})

test('assignment controls and assignment mutation payloads remain absent', () => {
  const surface = workspace + modal + portal + api
  for (const label of [
    'Change Primary preceptor', 'Add Secondary preceptor', 'Add Coverage preceptor',
    'Replace assignment', 'End assignment', 'Manage assignments',
  ]) assert.doesNotMatch(surface, new RegExp(label))
  assert.doesNotMatch(api, /action: 'change_primary'|action: 'set_secondary'/)
  assert.doesNotMatch(api, /op: 'add'|op: 'replace'|op: 'end'/)
})
