// ACCOUNTS-PERF-AVATARS-1: Accounts & Access tab-switch latency + student avatars.
//
// Latency: the portal query key is stable across tab switches and role/status
// filter changes (['portal_access_list', search]); role/status narrowing happens
// client-side over the cached set, so KPI-card clicks and Staff<->Portal switches
// never refire the heavy endpoint. The endpoint's reads are grouped into
// dependency waves (grants + contacts + auth listUsers concurrently, then the
// three scope tables concurrently) instead of nine sequential roundtrips.
//
// Avatars: student portal rows resolve their private headshot as a signed URL
// through the WAVE F-2 /api/student-file-access flow (useStudentFileUrl,
// dedupe-cached); staff-profile and contact avatar_url behavior is unchanged,
// raw storage paths never reach the browser, and initials remain the fallback.
//
// Run: node --test test/accountsPerfAvatars.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const dir = read('src/components/settings/AccountsDirectory.jsx')
const api = read('api/list-portal-access.js')

// ── Latency: stable query key + client-side filtering ────────────────────────

test('portal query key is stable across tabs and role/status filters', () => {
  assert.match(dir, /queryKey: \['portal_access_list', search\]/)
  // The queryFn no longer reads tab, roleFilter, or statusFilter.
  assert.doesNotMatch(dir, /queryKey: \['portal_access_list'[^\]]*tab\]/)
  assert.doesNotMatch(dir, /params\.set\('role'/)
  assert.doesNotMatch(dir, /params\.set\('status'/)
})

test('role and status narrow the cached set client-side, before sort and pagination', () => {
  assert.match(dir, /\.filter\(r => !roleFilter \|\| r\.portal_role === roleFilter\)/)
  assert.match(dir, /\.filter\(r => !statusFilter \|\| r\.status === statusFilter\)/)
  assert.match(dir, /\.filter\(r => !expiringOnly \|\| r\.expiring_soon === true\)/)
  // The chain still feeds the pure sorter (ACCOUNTS-KPI-SORT-1 contract).
  assert.match(dir, /const portalAccounts = sortPortalAccounts\(/)
})

test('tab switching still resets every filter, so no stale narrowing leaks across tabs', () => {
  assert.match(dir, /const switchTab = \(t\) => \{ setTab\(t\); setRoleFilter\(''\); setStatusFilter\(''\); setExpiringOnly\(false\); setInterviewerOnly\(false\) \}/)
})

test('KPI counts still come from the server contract over the unfiltered set', () => {
  assert.match(dir, /allGrants: portalData\.counts\?\.all_grants \?\? 0/)
  assert.match(dir, /pending: portalData\.counts\?\.pending \?\? 0/)
  assert.match(api, /all_grants: records\.length/)
})

// ── Latency: endpoint dependency waves ───────────────────────────────────────

test('wave 1 starts contacts and auth listUsers before awaiting grants', () => {
  const pendingIdx = api.indexOf('const pendingPromise = (async () =>')
  const contactsIdx = api.indexOf('const contactsPromise = db')
  const grantsIdx = api.indexOf("from('user_role_grants')")
  assert.ok(pendingIdx > -1, 'pendingPromise wave exists')
  assert.ok(contactsIdx > -1, 'contactsPromise wave exists')
  assert.ok(pendingIdx < grantsIdx && contactsIdx < grantsIdx, 'independent reads start before the grants await')
  // Both side reads are joined later, before record building.
  assert.match(api, /const \{ data: avatarContacts \} = await contactsPromise/)
  assert.match(api, /const \{ pendingAvailable, pendingEmails, pendingInvitedAtByEmail \} = await pendingPromise/)
})

test('wave 3 reads the three scope tables concurrently', () => {
  assert.match(api, /await Promise\.all\(\[\s*\n\s*db\.from\('user_student_links'\)/)
  assert.match(api, /db\.from\('user_unit_scopes'\)/)
  assert.match(api, /db\.from\('user_school_scopes'\)/)
})

test('grant/profile error handling is unchanged: hard 500s stay hard', () => {
  assert.match(api, /grant read failed[^\n]*\n?[^\n]*internal_error/)
  assert.match(api, /profile read failed[^\n]*\n?[^\n]*internal_error/)
})

test('endpoint authorization is untouched: verified JWT, active Owner/Admin only', () => {
  assert.match(api, /const auth = await verifyCaller\(req\)/)
  assert.match(api, /if \(!\(auth\.isOwner \|\| auth\.role === 'admin'\)\)/)
  assert.match(api, /if \(profile\.is_active === false\) return \{ authenticated: false, status: 403, reason: 'inactive' \}/)
})

test('the endpoint still supports role/status params for compatibility', () => {
  // Client-side filtering did not remove the server contract - other callers
  // (and direct API use) keep the documented params.
  assert.match(api, /const roleFilter = PORTAL_ROLES\.includes\(str\(q\.role\)\) \? str\(q\.role\) : ''/)
  assert.match(api, /const statusFilter = STATUSES\.includes\(str\(q\.status\)\) \? str\(q\.status\) : ''/)
})

// ── Avatars: student headshots via the signed-access flow ────────────────────

test('PortalAccountAvatar resolves student headshots through useStudentFileUrl', () => {
  assert.match(dir, /import \{ useStudentFileUrl \} from '\.\.\/\.\.\/lib\/useStudentFile'/)
  assert.match(dir, /function PortalAccountAvatar\(\{ record, size = 32, online \}\)/)
  // Only student rows without an endpoint-resolved avatar ask for a signed URL.
  assert.match(dir, /record\.portal_role === 'student' \? \(record\.scope\?\.students\?\.\[0\]\?\.student_id \|\| null\) : null/)
  assert.match(dir, /useStudentFileUrl\(\{ studentId, kind: 'headshot', enabled: !!studentId && !record\.avatar_url \}\)/)
  // An endpoint avatar_url always wins; the signed URL only fills the gap.
  assert.match(dir, /const user = !record\.avatar_url && url \? \{ \.\.\.record, avatar_url: url \} : record/)
})

test('both portal surfaces (table row + narrow card) render PortalAccountAvatar', () => {
  const uses = dir.match(/<PortalAccountAvatar record=\{r\}/g) || []
  assert.equal(uses.length, 2, 'table row and AccountCard both use the portal avatar')
  // Staff surfaces keep the plain PresenceAvatar (their avatar_url is complete).
  assert.match(dir, /<PresenceAvatar user=\{u\} size=\{40\}/)
  assert.match(dir, /<PresenceAvatar user=\{u\} size=\{32\}/)
})

test('no raw storage path is ever rendered: avatars come from avatar_url or a signed URL', () => {
  assert.doesNotMatch(dir, /headshot_url/, 'the private storage column never reaches the directory')
  assert.doesNotMatch(api, /headshot_url/, 'the endpoint does not expose the storage path')
  // The scope payload still carries student_id, which is what the client signs with.
  assert.match(api, /student_id: l\.student_id/)
})
