// ACCOUNTS-ACCESS-DIRECTORY-2: static-source guards for the UI/presence half
// of the feature. Confirms useOnlinePresence tracks profile_id and derives
// onlineProfileIds from the presence payload metas without ever exposing
// auth_user_id anywhere new, PresenceContext exposes both id sets,
// PORTAL_STATUS_STYLES carries a labelled 'pending' entry, and
// AccountsDirectory's KPI-card wiring, query key, and client-side
// expiring_soon filter match the spec.
// Run: node --test test/accountsAccessDirectory2Ui.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const hook = read('src/hooks/useOnlinePresence.js')
const ctx = read('src/contexts/PresenceContext.jsx')
const status = read('src/lib/portalAccessStatus.js')
const dir = read('src/components/settings/AccountsDirectory.jsx')

test('useOnlinePresence tracks and derives profile_id', async (t) => {
  await t.test('the channel key stays auth_user_id (unchanged)', () => {
    assert.match(hook, /config: \{ presence: \{ key: userProfile\.auth_user_id \} \}/)
  })

  await t.test('track payload gains profile_id without dropping auth_user_id tracking', () => {
    assert.match(hook, /channel\.track\(\{/)
    assert.match(hook, /profile_id: userProfile\.id/)
  })

  await t.test('sync derives onlineProfileIds from presence state metas', () => {
    assert.match(hook, /const \[onlineProfileIds, setOnlineProfileIds\] = useState\(new Set\(\)\)/)
    assert.match(hook, /Object\.values\(state\)\s*\.flat\(\)\s*\.map\(m => m\.profile_id\)\s*\.filter\(Boolean\)/)
    assert.match(hook, /setOnlineProfileIds\(new Set\(profileIds\)\)/)
  })

  await t.test('onlineUserIds derivation from Object.keys(state) is untouched', () => {
    assert.match(hook, /setOnlineUserIds\(new Set\(Object\.keys\(state\)\)\)/)
  })

  await t.test('the hook returns both sets', () => {
    assert.match(hook, /return \{ onlineUserIds, onlineProfileIds \}/)
  })
})

test('PresenceContext exposes both id sets with a stable memoized value', async (t) => {
  await t.test('default context value carries both empty sets', () => {
    assert.match(ctx, /createContext\(\{ onlineUserIds: new Set\(\), onlineProfileIds: new Set\(\) \}\)/)
  })

  await t.test('provider destructures both from the hook and memoizes them together', () => {
    assert.match(ctx, /const \{ onlineUserIds, onlineProfileIds \} = useOnlinePresence\(\)/)
    assert.match(ctx, /useMemo\(\(\) => \(\{ onlineUserIds, onlineProfileIds \}\), \[onlineUserIds, onlineProfileIds\]\)/)
  })
})

test('PORTAL_STATUS_STYLES has a labelled pending entry', async (t) => {
  await t.test('pending exists alongside the four lifecycle statuses', () => {
    assert.match(status, /pending:\s*\{ label: 'Pending',\s*bg: '#FCEFD4', color: '#7C5A1F', dot: '#d08700' \}/)
  })

  await t.test('derivePortalStatus is untouched - pending is server-derived, not client lifecycle', () => {
    // The pure lifecycle function must still only ever return revoked/scheduled/expired/active.
    assert.doesNotMatch(status, /return 'pending'/)
  })
})

test('AccountsDirectory KPI card wiring', async (t) => {
  await t.test('Staff card just switches tab, active only on the staff tab', () => {
    assert.match(dir, /value=\{counts\.staff\}[^]*?active=\{tab === 'staff'\}[^]*?onClick=\{\(\) => switchTab\('staff'\)\}/)
  })

  await t.test('Portal Users card clears the pending/expiring card filters and is active only when neither is engaged', () => {
    assert.match(dir, /value=\{counts\.portal\}[^]*?active=\{tab === 'portal' && statusFilter !== 'pending' && !expiringOnly\}[^]*?onClick=\{\(\) => switchTab\('portal'\)\}/)
  })

  await t.test('Pending card toggles statusFilter to/from pending and clears expiringOnly', () => {
    assert.match(dir, /value=\{counts\.pending\}[^]*?active=\{tab === 'portal' && statusFilter === 'pending'\}/)
    assert.match(dir, /onClick=\{\(\) => \{ setTab\('portal'\); setExpiringOnly\(false\); setStatusFilter\(f => f === 'pending' \? '' : 'pending'\) \}\}/)
  })

  await t.test('Expiring Soon card toggles expiringOnly and clears statusFilter', () => {
    assert.match(dir, /value=\{counts\.expiring\}[^]*?active=\{tab === 'portal' && expiringOnly\}/)
    assert.match(dir, /onClick=\{\(\) => \{ setTab\('portal'\); setStatusFilter\(''\); setExpiringOnly\(e => !e\) \}\}/)
  })

  await t.test('switching tabs via the segmented control resets role, status, and expiring filters', () => {
    assert.match(dir, /const switchTab = \(t\) => \{ setTab\(t\); setRoleFilter\(''\); setStatusFilter\(''\); setExpiringOnly\(false\) \}/)
  })
})

test('AccountsDirectory portal query and expiring_soon client filter', async (t) => {
  await t.test('the query key includes every value the queryFn reads', () => {
    assert.match(dir, /queryKey: \['portal_access_list', search, roleFilter, statusFilter, tab\]/)
  })

  await t.test('status=pending passes through the existing param plumbing', () => {
    assert.match(dir, /if \(tab === 'portal' && statusFilter\) params\.set\('status', statusFilter\)/)
    assert.match(dir, /\{ value: 'pending', label: 'Pending' \}/)
  })

  await t.test('expiringOnly filters accounts client-side on the server-computed expiring_soon flag', () => {
    assert.match(dir, /const portalAccounts = \(portalData\.accounts \|\| \[\]\)\.filter\(r => !expiringOnly \|\| r\.expiring_soon === true\)/)
  })

  await t.test('counts.pending reads the server contract counts.pending, not a client pending array', () => {
    assert.match(dir, /pending: portalData\.counts\?\.pending \?\? 0/)
  })
})

test('AccountsDirectory never renders auth_user_id and wires presence by profile_id', async (t) => {
  await t.test('imports usePresence and destructures onlineProfileIds', () => {
    assert.match(dir, /import \{ usePresence \} from '\.\.\/\.\.\/contexts\/PresenceContext'/)
    assert.match(dir, /const \{ onlineProfileIds \} = usePresence\(\)/)
  })

  await t.test('staff rows key presence off the profile id, portal rows off user_profile_id', () => {
    assert.match(dir, /onlineProfileIds\.has\(u\.id\)/)
    assert.match(dir, /onlineProfileIds\.has\(r\.user_profile_id\)/)
  })

  await t.test('auth_user_id never appears in this file', () => {
    assert.doesNotMatch(dir, /auth_user_id/)
  })

  await t.test('PresenceAvatar renders an online dot that is aria-hidden with a title', () => {
    assert.match(dir, /function PresenceAvatar/)
    assert.match(dir, /aria-hidden="true" title="Online now"/)
  })
})
