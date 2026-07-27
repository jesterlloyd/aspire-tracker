// Commit 3: the redundant page-level unit switcher is removed from Placement Requests
// and Capacity, while Home, Students, and Preceptors keep it. Scope stays server-derived
// in both cases, and neither page gains a hidden dependency on the removed control.

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
const chrome = read('src/portal/unit/UnitLeaderChrome.jsx')

const sliceFn = (name, next) =>
  portalCode.slice(portalCode.indexOf(`function ${name}`), portalCode.indexOf(`function ${next}`))

test('the unit selector renders only on Home, Students, and Preceptors', () => {
  assert.match(portalCode, /const UNIT_SCOPED_VIEWS = \['home', 'students', 'preceptors'\]/)
  // The multi-unit selector now lives in the Nightfall header, gated to the scoped views.
  assert.match(portalCode, /unitKeys\.length > 1 && UNIT_SCOPED_VIEWS\.includes\(view\)/)
  assert.match(portalCode, /<PortalHeaderControls>/)
  // Placement Requests and Capacity are explicitly not in the scoped-views list.
  assert.ok(!/const UNIT_SCOPED_VIEWS = \[[^\]]*'placements'/.test(portalCode))
  assert.ok(!/const UNIT_SCOPED_VIEWS = \[[^\]]*'capacity'/.test(portalCode))
})

test('the nav still exposes Placement Requests and Capacity as destinations', () => {
  // Removing the switcher must not remove the tabs themselves.
  assert.match(chrome, /const DESKTOP_KEYS = \['home', 'preceptors', 'messages', 'evaluations', 'placements', 'capacity'\]/)
  assert.match(portalCode, /view === 'placements'\s+&& <PlacementScreen/)
  assert.match(portalCode, /view === 'capacity'\s+&& <CapacityScreen/)
})

test('Placement Requests shows the full authorized set and keeps its per-row Unit column', () => {
  const placement = sliceFn('PlacementScreen', 'PlacementRow')
  // No page-level unit narrowing: fetches ALL_UNITS with no unitKey dependency.
  assert.match(placement, /useEndpoint\(s => getPlacementRequests\(ALL_UNITS, s\), \[\]\)/)
  assert.ok(!/getPlacementRequests\(unitKey/.test(placement), 'must not fetch by a page-level unitKey')
  // The Unit column and per-row unit value remain, carrying the context the selector used to.
  assert.match(placement, /<th scope="col">Unit<\/th>/)
  const row = sliceFn('PlacementRow', 'CapacityScreen')
  assert.match(row, /data-label="Unit">\{orDash\(r\.unit_key\)\}/)
})

test('Capacity depends only on its own in-form unit picker, not a page-level selector', () => {
  const cap = sliceFn('CapacityScreen', 'HoursCell')
  // refreshRoster is the shared-Refresh refetch callback, not a scope input; scope still comes only
  // from the in-form unit picker (asserted below).
  assert.match(cap, /function CapacityScreen\(\{ unitKeys, acceptingCohort, refreshRoster \}\)/)
  // \b guards against a false positive on "unitKeys" (the authorized list, which is fine).
  assert.ok(!/\bunitKey\b/.test(cap), 'Capacity must not read a page-level unitKey')
  assert.match(cap, /const initialUnit = singleUnit \? assignedUnits\[0\] : ''/)
  // The form's own unit choices remain limited to the authorized assigned units.
  assert.match(cap, /assignedUnits\.map\(k => <option key=\{k\} value=\{k\}>\{k\}<\/option>\)/)
})

test('scope stays server-derived; the browser holds no unit authority', () => {
  assert.doesNotMatch(portalCode, /supabase\.from|service_role|localStorage/)
  // Capacity submit still lets the server reject an out-of-scope unit (403 handling intact).
  assert.match(portalCode, /That unit is not in your access scope\./)
})
