import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  clearPortalCohortHintSession,
  hasSeenPortalCohortHint,
  markPortalCohortHintSeen,
  portalCohortHintKey,
} from '../src/lib/portalCohortHint.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

function storageStub() {
  const values = new Map()
  return {
    get length() { return values.size },
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
  }
}

test('the hint is scoped by portal experience and user for one signed-in session', () => {
  globalThis.sessionStorage = storageStub()
  assert.equal(portalCohortHintKey('user-1', 'unit_leader'), 'aspire:portal:cohort-hint:unit_leader:user-1')
  assert.equal(hasSeenPortalCohortHint('user-1', 'unit_leader'), false)
  markPortalCohortHintSeen('user-1', 'unit_leader')
  assert.equal(hasSeenPortalCohortHint('user-1', 'unit_leader'), true)
  assert.equal(hasSeenPortalCohortHint('user-1', 'academic_partner'), false)
})

test('sign-out clears only portal cohort hint markers so the next login shows the hint again', () => {
  globalThis.sessionStorage = storageStub()
  sessionStorage.setItem('unrelated', 'keep')
  markPortalCohortHintSeen('user-1', 'unit_leader')
  markPortalCohortHintSeen('user-2', 'academic_partner')
  clearPortalCohortHintSession()
  assert.equal(sessionStorage.getItem('unrelated'), 'keep')
  assert.equal(hasSeenPortalCohortHint('user-1', 'unit_leader'), false)
  assert.equal(hasSeenPortalCohortHint('user-2', 'academic_partner'), false)
})

test('the login hint targets cohort pickers, uses the requested copy, and yields to the Welcome Tour', () => {
  const hint = read('src/portal/PortalCohortLoginHint.jsx')
  const app = read('src/portal/PortalApp.jsx')
  const auth = read('src/contexts/AuthContext.jsx')
  const ap = read('src/portal/AcademicPartnerPortal.jsx')
  const ul = read('src/portal/UnitLeaderPortal.jsx')

  assert.match(hint, /Switch cohort view here/)
  assert.match(hint, /\[data-portal-cohort-picker="true"\]/)
  assert.match(ap, /data-portal-cohort-picker="true"/)
  assert.match(ul, /data-portal-cohort-picker="true"/)
  assert.match(app, /isUnitLeader \|\| isAcademicPartner/)
  assert.match(app, /portalTourDecisionReady && !welcomeTourWillAutoStart && !tourRunning/)
  assert.match(app, /markPortalCohortHintSeen\(userProfile\.id, experience\)/)
  assert.match(auth, /clearPortalCohortHintSession\(\)/)
})
