import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isFullMessagesPath } from '../src/lib/messages/messagesRoutes.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const launcher = read('src/components/MainMessagesLauncher.jsx')
const utilityLayer = read('src/portal/PortalUtilityLayer.jsx')
const portalApp = read('src/portal/PortalApp.jsx')
const staffApp = read('src/staff/StaffApp.jsx')

test('full staff and portal Messages routes suppress the shortcut', () => {
  for (const pathname of [
    '/connect/messages',
    '/connect/messages/thread-1',
    '/portal/messages',
    '/portal/messages/thread-1',
    '/portal/student/messages',
    '/portal/unit/messages',
    '/portal/ap/messages',
    '/portal/ap/messages/thread-1',
    '/portal/academics/messages',
    '/portal/academics/messages/thread-1',
  ]) {
    assert.equal(isFullMessagesPath(pathname), true, pathname)
  }
})

test('the shortcut returns outside full Messages workspaces', () => {
  for (const pathname of [
    '/connect/contacts',
    '/connect/outreach',
    '/portal',
    '/portal/placement',
    '/portal/student',
    '/portal/unit/home',
    '/portal/ap/students',
    '/portal/academics/calendar',
    '/portal/residency/overview',
  ]) {
    assert.equal(isFullMessagesPath(pathname), false, pathname)
  }
})

test('staff and portal launchers use the same route rule without hiding Feedback or Keith', () => {
  // BUDGET-V2 item 10 (Owner, 2026-09-29, commit budget-v2-p4): Program Budget also hides Messages and
  // Feedback (keithOnly); the Keith orb stays.
  assert.match(staffApp, /!isFullMessagesPath\(location\.pathname\) && <MainMessagesLauncher hidden=\{keithOnly\} keepLauncherVisible/)
  assert.match(portalApp, /!isFullMessagesPath\(location\.pathname\) && \([\s\S]{0,120}<MainMessagesLauncher[\s\S]{0,80}portalPreview/)
  assert.match(utilityLayer, /const onMessagesRoute = isFullMessagesPath\(pathname\)/)
  assert.match(utilityLayer, /const messagesLauncherVisible = messagesEnabled/)
  assert.match(utilityLayer, /<PortalUtilityLayerContent key=\{props\.pathname\}/)
  assert.match(utilityLayer, /feedbackEnabled && \(/)
  assert.match(portalApp, /const onMessagesRoute = isFullMessagesPath\(location\.pathname\)/)
  assert.match(staffApp, /<Keith[\s\S]*?hideLauncher=\{false\}/)
  assert.match(staffApp, /<FeedbackPanel[\s\S]*?hidden=\{keithOnly\}/)
})
