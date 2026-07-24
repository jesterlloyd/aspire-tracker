// UL-PERF: guards for evidence-backed portal performance fixes.
//
// These static checks protect the request/bundle shape that made the Unit Leader
// portal feel slower: route-only or interaction-only code must not ride along with
// every Unit Leader tab before it can render useful content.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const portal = read('src/portal/UnitLeaderPortal.jsx')
const portalCode = stripJs(portal)
const api = read('src/portal/unit/unitLeaderApi.js')

test('Unit Leader route-only surfaces are lazy-loaded behind Suspense', () => {
  assert.match(portal, /import \{ lazy, Suspense,[^}]+ \} from 'react'/)
  assert.match(portal, /const UnitRotationCalendar = lazy\(\(\) => import\('\.\/unit\/UnitRotationCalendar'\)\)/)
  assert.match(portal, /const UnitPreceptorsWorkspace = lazy\(\(\) => import\('\.\/unit\/UnitPreceptorsWorkspace'\)\)/)
  assert.match(portal, /const UnitLeaderPreceptorManager = lazy\(\(\) => import\('\.\/unit\/UnitLeaderPreceptorManager'\)\)/)
  assert.doesNotMatch(portal, /import UnitRotationCalendar from '\.\/unit\/UnitRotationCalendar'/)
  assert.doesNotMatch(portal, /import UnitPreceptorsWorkspace from '\.\/unit\/UnitPreceptorsWorkspace'/)
  assert.doesNotMatch(portal, /import UnitLeaderPreceptorManager from '\.\/unit\/UnitLeaderPreceptorManager'/)
})

test('lazy boundaries keep truthful loading states', () => {
  assert.match(portal, /<Suspense fallback=\{<LoadingState label="Loading rotation activity" \/>\}>[\s\S]*?<UnitRotationCalendar/)
  assert.match(portal, /<Suspense fallback=\{<TableSkeleton label="Loading preceptors" \/>\}>[\s\S]*?<UnitPreceptorsWorkspace/)
  assert.match(portal, /<Suspense fallback=\{<LoadingState label="Loading assignment manager" \/>\}>[\s\S]*?<UnitLeaderPreceptorManager/)
})

test('Home still makes one bootstrap request and only its independent Home reads', () => {
  assert.equal((portalCode.match(/useEndpoint\(getRoster/g) || []).length, 1)
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'), portalCode.indexOf('function PlacementScreen'))
  assert.match(home, /useEndpoint\(s => getNotifications\(unitKey, s\), \[unitKey\]\)/)
  assert.match(home, /useEndpoint\(s => getShiftActivity\(\{\}, s\), \[\]\)/)
  assert.ok(!home.includes('getPlacementRequests'), 'Placement data waits for the Placement route')
  assert.ok(!home.includes('getPreceptors'), 'Preceptors data waits for the Preceptors route')
  assert.ok(!home.includes('getCapacity'), 'Capacity data waits for the Capacity route')
})

test('authorization remains server-derived through the existing endpoints', () => {
  assert.match(api, /apiFetch\('\/api\/portal\/unit-roster'/)
  assert.match(api, /apiFetch\(`\/api\/portal\/unit-notifications/)
  assert.match(api, /apiFetch\(`\/api\/portal\/unit-shift-activity/)
  assert.doesNotMatch(portalCode, /supabase\.from|service_role|localStorage/)
})
