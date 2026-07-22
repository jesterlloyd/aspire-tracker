import test from 'node:test'
import assert from 'node:assert/strict'

import {
  allowedStaffNotificationDestination,
  createStaffNotificationActivation,
} from '../src/lib/staffNotificationNavigation.js'

const STUDENT_ID = '11111111-1111-4111-8111-111111111111'

function callbacks() {
  const marked = []
  const navigated = []
  return {
    marked,
    navigated,
    handlers: {
      onMarkRead: ids => marked.push(ids),
      onNavigate: destination => navigated.push(destination),
    },
  }
}

test('student notification uses its allowed durable destination and marks only its own row read', () => {
  const cb = callbacks()
  const row = {
    id: 'notification-1', student_id: STUDENT_ID,
    dest_url: `/students?student=${STUDENT_ID}`, in_app_read_at: null,
  }
  const behavior = createStaffNotificationActivation(row, cb.handlers)

  assert.equal(behavior.destination, `/students?student=${STUDENT_ID}`)
  assert.equal(behavior.interactive, true)
  behavior.activate()
  assert.deepEqual(cb.marked, [['notification-1']])
  assert.deepEqual(cb.navigated, [`/students?student=${STUDENT_ID}`])
})

test('preceptor-created notification routes to the allowlisted Preceptor Directory', () => {
  const cb = callbacks()
  const behavior = createStaffNotificationActivation({
    id: 'notification-2', student_id: null, dest_url: '/rotation/preceptors', in_app_read_at: null,
  }, cb.handlers)

  behavior.activate()
  assert.equal(behavior.destination, '/rotation/preceptors')
  assert.deepEqual(cb.marked, [['notification-2']])
  assert.deepEqual(cb.navigated, ['/rotation/preceptors'])
})

test('external, protocol-relative, javascript, mismatched-student, and arbitrary destinations fail closed', () => {
  for (const destination of [
    'https://example.org/students',
    '//example.org/students',
    'javascript:alert(1)',
    '/admin',
    `/students?student=22222222-2222-4222-8222-222222222222`,
    `/students?student=${STUDENT_ID}&next=/admin`,
  ]) {
    assert.equal(allowedStaffNotificationDestination(destination, STUDENT_ID), null, destination)
  }
})

test('an unread row with an invalid destination marks only itself read and never navigates', () => {
  const cb = callbacks()
  const behavior = createStaffNotificationActivation({
    id: 'notification-3', student_id: null, dest_url: 'https://example.org', in_app_read_at: null,
  }, cb.handlers)

  assert.equal(behavior.destination, null)
  assert.equal(behavior.interactive, true)
  behavior.activate()
  assert.deepEqual(cb.marked, [['notification-3']])
  assert.deepEqual(cb.navigated, [])
})

test('keyboard Enter and Space activate an allowed row; other keys do nothing', () => {
  for (const key of ['Enter', ' ']) {
    const cb = callbacks()
    let prevented = 0
    const behavior = createStaffNotificationActivation({
      id: `notification-${key}`, student_id: null, dest_url: '/rotation/preceptors', in_app_read_at: null,
    }, cb.handlers)
    behavior.onKeyDown({ key, preventDefault: () => { prevented += 1 } })
    assert.equal(prevented, 1)
    assert.deepEqual(cb.marked, [[`notification-${key}`]])
    assert.deepEqual(cb.navigated, ['/rotation/preceptors'])
  }

  const cb = callbacks()
  const behavior = createStaffNotificationActivation({
    id: 'notification-tab', student_id: null, dest_url: '/rotation/preceptors', in_app_read_at: null,
  }, cb.handlers)
  behavior.onKeyDown({ key: 'Tab', preventDefault: () => assert.fail('Tab must not be prevented') })
  assert.deepEqual(cb.marked, [])
  assert.deepEqual(cb.navigated, [])
})

test('a legacy student row with no destination retains the safe student route fallback', () => {
  assert.equal(allowedStaffNotificationDestination(null, STUDENT_ID), `/students?student=${STUDENT_ID}`)
})
