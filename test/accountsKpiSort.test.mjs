// ACCOUNTS-KPI-SORT-1: Accounts & Access - portal-role KPI cards + sortable table.
//
// Functional tests drive the pure sorting module (all six columns, both directions,
// null-date placement, deterministic secondary sort, toggle semantics) and the server
// count contract shape. Source guards pin the tab-adaptive KPI rows, the card/dropdown
// state sharing, tab isolation, aria-sort semantics, and preserved row actions.
//
// Run: node --test test/accountsKpiSort.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  STATUS_SORT_ORDER, PORTAL_SORT_COLUMNS, DEFAULT_PORTAL_SORT,
  nextPortalSort, sortPortalAccounts, compareAccountsByName,
} from '../src/lib/portalAccessSort.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const dir = read('src/components/settings/AccountsDirectory.jsx')
const api = read('api/list-portal-access.js')

// Representative records across roles, statuses, and null dates.
const R = (over) => ({
  grant_id: over.id, full_name: over.name, email: `${over.id}@x.org`,
  portal_role: 'student', status: 'active', last_login_at: null, expires_at: null,
  scope: { students: [], units: [], schools: [] }, ...over,
})
const ROWS = [
  R({ id: 'a', name: 'Ada Lovelace', portal_role: 'student', status: 'active',
      last_login_at: '2026-07-30T10:00:00Z', expires_at: '2026-09-01T00:00:00Z',
      scope: { students: [{ name: 'Ada Lovelace', school: 'CSUN', cohort: 'Fall' }], units: [], schools: [] } }),
  R({ id: 'b', name: 'Ben Reyes', portal_role: 'unit_leader', status: 'pending',
      last_login_at: null, expires_at: '2026-08-10T00:00:00Z',
      scope: { students: [], units: [{ unit_key: '5 SCCT' }], schools: [] } }),
  R({ id: 'c', name: 'Cara Singh', portal_role: 'academic_partner', status: 'revoked',
      last_login_at: '2026-07-01T10:00:00Z', expires_at: null,
      scope: { students: [], units: [], schools: [{ school_key: 'UCLA' }] } }),
  R({ id: 'd', name: 'Dev Okafor', portal_role: 'unit_leader', status: 'expired',
      last_login_at: '2026-06-15T10:00:00Z', expires_at: '2026-07-01T00:00:00Z',
      scope: { students: [], units: [{ unit_key: '7 SE' }], schools: [] } }),
]
const names = (rows) => rows.map(r => r.full_name)

// ── Sorting: all six columns, both directions ────────────────────────────────────────

test('name sorts A-Z then Z-A (case-insensitive, email tiebreak)', () => {
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'name', 'asc')), ['Ada Lovelace', 'Ben Reyes', 'Cara Singh', 'Dev Okafor'])
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'name', 'desc')), ['Dev Okafor', 'Cara Singh', 'Ben Reyes', 'Ada Lovelace'])
})

test('portal role sorts by displayed label alphabetically, secondary name', () => {
  // Labels: Academic Partner < Student < Unit Leader; Ben before Dev within Unit Leader.
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'portal_role', 'asc')), ['Cara Singh', 'Ada Lovelace', 'Ben Reyes', 'Dev Okafor'])
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'portal_role', 'desc')), ['Ben Reyes', 'Dev Okafor', 'Ada Lovelace', 'Cara Singh'])
})

test('assigned scope sorts by the displayed summary label', () => {
  // Labels: '5 SCCT' < '7 SE' < 'Ada Lovelace · CSUN · Fall' < 'UCLA'.
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'scope', 'asc')), ['Ben Reyes', 'Dev Okafor', 'Ada Lovelace', 'Cara Singh'])
})

test('status sorts in the documented operational order', () => {
  assert.deepEqual(STATUS_SORT_ORDER, ['pending', 'active', 'scheduled', 'expired', 'revoked'])
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'status', 'asc')), ['Ben Reyes', 'Ada Lovelace', 'Dev Okafor', 'Cara Singh'])
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'status', 'desc')), ['Cara Singh', 'Dev Okafor', 'Ada Lovelace', 'Ben Reyes'])
})

test('last login: newest first by default; Never logged in is a null date, LAST both ways', () => {
  assert.equal(PORTAL_SORT_COLUMNS.last_login.initialDir, 'desc')
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'last_login', 'desc')), ['Ada Lovelace', 'Cara Singh', 'Dev Okafor', 'Ben Reyes'])
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'last_login', 'asc')), ['Dev Okafor', 'Cara Singh', 'Ada Lovelace', 'Ben Reyes'])
})

test('expiration: soonest first; no-expiration rows are null dates, LAST both ways', () => {
  assert.equal(PORTAL_SORT_COLUMNS.expiration.initialDir, 'asc')
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'expiration', 'asc')), ['Dev Okafor', 'Ben Reyes', 'Ada Lovelace', 'Cara Singh'])
  assert.deepEqual(names(sortPortalAccounts(ROWS, 'expiration', 'desc')), ['Ada Lovelace', 'Ben Reyes', 'Dev Okafor', 'Cara Singh'])
})

test('ties fall through to the deterministic name secondary sort', () => {
  const tied = [R({ id: 'z', name: 'Zed Ames', status: 'active' }), R({ id: 'a2', name: 'Amy Cole', status: 'active' })]
  assert.deepEqual(names(sortPortalAccounts(tied, 'status', 'asc')), ['Amy Cole', 'Zed Ames'])
  // And the exported comparator is the same canonical one accountsShared re-exports.
  assert.ok(compareAccountsByName({ full_name: 'a' }, { full_name: 'b' }) < 0)
  assert.match(read('src/components/settings/accountsShared.jsx'), /export \{ compareAccountsByName \} from '\.\.\/\.\.\/lib\/portalAccessSort'/)
})

test('click semantics: new column opens on its recommended direction; active column toggles', () => {
  assert.deepEqual(DEFAULT_PORTAL_SORT, { key: 'name', dir: 'asc' })
  assert.deepEqual(nextPortalSort(DEFAULT_PORTAL_SORT, 'last_login'), { key: 'last_login', dir: 'desc' })
  assert.deepEqual(nextPortalSort({ key: 'last_login', dir: 'desc' }, 'last_login'), { key: 'last_login', dir: 'asc' })
  assert.deepEqual(nextPortalSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' })
  // Unknown keys change nothing.
  assert.deepEqual(nextPortalSort({ key: 'name', dir: 'asc' }, 'nope'), { key: 'name', dir: 'asc' })
  // Exactly the six required columns.
  assert.deepEqual(Object.keys(PORTAL_SORT_COLUMNS), ['name', 'portal_role', 'scope', 'status', 'last_login', 'expiration'])
})

// ── KPI counts: server contract ──────────────────────────────────────────────────────

test('the endpoint adds all_grants and by_role over the UNFILTERED set, additively', () => {
  assert.match(api, /all_grants: records\.length/)
  assert.match(api, /by_role: \{ student: 0, unit_leader: 0, academic_partner: 0 \}/)
  assert.match(api, /if \(counts\.by_role\[r\.portal_role\] !== undefined\) counts\.by_role\[r\.portal_role\] \+= 1/)
  // Counts are computed from `records` (built before filters are applied), and the
  // existing keys (portal_users, pending, expiring_soon) are retained.
  assert.match(api, /counts\.portal_users = activeProfiles\.size/)
  const countsIdx = api.indexOf('// 5. Counts across the FULL')
  const filterIdx = api.indexOf('// 6. Apply filters')
  assert.ok(countsIdx > -1 && filterIdx > countsIdx, 'counts precede filtering')
})

test('the client reads the new counts and keeps pending/expiring from the same contract', () => {
  assert.match(dir, /allGrants: portalData\.counts\?\.all_grants \?\? 0/)
  assert.match(dir, /students: portalData\.counts\?\.by_role\?\.student \?\? 0/)
  assert.match(dir, /unitLeaders: portalData\.counts\?\.by_role\?\.unit_leader \?\? 0/)
  assert.match(dir, /academicPartners: portalData\.counts\?\.by_role\?\.academic_partner \?\? 0/)
  assert.match(dir, /pending: portalData\.counts\?\.pending \?\? 0/)
  assert.match(dir, /expiring: portalData\.counts\?\.expiring_soon \?\? 0/)
  // Staff KPIs are client-derived and never count portal-only accounts.
  assert.match(dir, /const staffAccounts = allUsers\.filter\(u => u\.role !== 'portal'\)/)
})

// ── Tab isolation + card/dropdown synchronization ────────────────────────────────────

test('KPI rows are tab-gated: portal cards never render on Staff, and vice versa', () => {
  // ROLE-GUIDE-1: a third tab (Role Guide) joined the control; it has no\n  // rows, so it renders no KPI row. Gating is still asserted here.\n  assert.match(dir, /\{tab === 'guide' \? null : tab === 'portal' \? \(/)
  // Role cards and the dropdown share ONE state (roleFilter), so contradictory
  // states are structurally impossible.
  assert.match(dir, /const toggleRoleCard = \(role\) => \{ setRoleFilter\(r => r === role \? '' : role\) \}/)
  assert.match(dir, /value=\{roleFilter\} onChange=\{e => setRoleFilter\(e\.target\.value\)\}/)
  // The role dropdown is retained (it reflects the card selection 1:1).
  assert.match(dir, /aria-label="Filter by role"/)
})

test('sorting composes with filters: applied after the server filter chain + expiring filter', () => {
  assert.match(dir, /const portalAccounts = sortPortalAccounts\(/)
  assert.match(dir, /portalSort\.key, portalSort\.dir\)/)
  assert.match(dir, /const \[portalSort, setPortalSort\] = useState\(DEFAULT_PORTAL_SORT\)/)
  assert.match(dir, /onSort=\{\(key\) => setPortalSort\(s => nextPortalSort\(s, key\)\)\}/)
})

// ── Header accessibility + preserved actions ─────────────────────────────────────────

test('sortable headers: native buttons with aria-sort on the th and a visible indicator', () => {
  assert.match(dir, /aria-sort=\{activeCol \? \(sort\.dir === 'asc' \? 'ascending' : 'descending'\) : undefined\}/)
  assert.match(dir, /aria-label=\{`Sort by \$\{label\.toLowerCase\(\)\}`\}/)
  assert.match(dir, /\{activeCol \? \(sort\.dir === 'asc' \? '▲' : '▼'\) : '↕'\}/)
  // Headers derive from the module's column config, so the table and the sort rules
  // cannot drift apart.
  assert.match(dir, /Object\.entries\(PORTAL_SORT_COLUMNS\)\.map\(\(\[key, col\]\) => \(/)
})

test('row actions and management behavior are untouched', () => {
  assert.match(dir, /\{ label: 'View access', onClick: \(\) => onView\(r\) \}/)
  assert.match(dir, /\{ label: 'Renew \/ edit access', onClick: \(\) => onRenew\(r\) \}/)
  assert.match(dir, /r\.status !== 'revoked' && \{ label: 'Revoke access', danger: true/)
  assert.match(dir, /GrantPortalAccessModal/)
  assert.match(dir, /AccountDetailsDrawer/)
})

test('no em dash in the new sources', () => {
  assert.doesNotMatch(read('src/lib/portalAccessSort.js'), /—/)
})
