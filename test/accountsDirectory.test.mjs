// ASPIRE-PORTAL-ACCESS-UI: static-source guards for the Accounts & Access
// directory. Confirms the old role-grouped card board is replaced, the
// segmented control and dual invite actions exist, filter KPI cards and
// search/filters render, staff and portal roles stay separated, and the
// browser never reads or writes the authorization tables directly.
//
// ACCOUNTS-ACCESS-DIRECTORY-2: the old three-tab tablist (Staff Access /
// Portal Access / Pending Invitations) was replaced by a two-way segmented
// control (Staff Access | Portal Access); "pending" is now a portal grant
// status, surfaced via the KPI row and the status select instead of a
// dedicated tab/panel.
// Run: node --test test/accountsDirectory.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const panel = read('src/components/settings/AccountsAccessPanel.jsx')
const dir = read('src/components/settings/AccountsDirectory.jsx')

const AUTHZ_TABLES = ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes']

test('Accounts & Access directory replaces the card board', async (t) => {
  await t.test('the panel renders the directory, not the old people board', () => {
    assert.match(panel, /import AccountsDirectory/, 'panel must import the directory')
    assert.match(panel, /<AccountsDirectory\s*\/>/, 'panel must render AccountsDirectory')
    assert.doesNotMatch(panel, /UserManagementContent/, 'old role-grouped board must not be rendered')
    assert.doesNotMatch(panel, /columnizeUsers|ProfileCard/, 'no card-board layout in the panel')
  })

  await t.test('a two-way segmented control replaces the old three-tab tablist', () => {
    assert.doesNotMatch(dir, /role="tablist"/, 'the old ARIA tablist must be gone')
    assert.doesNotMatch(dir, /role="tab"/, 'no role="tab" buttons remain')
    assert.doesNotMatch(dir, /Pending Invitations['"]?\s*\}/, 'no Pending Invitations tab label object')
    assert.match(dir, /Staff Access/)
    assert.match(dir, /Portal Access/)
    assert.match(dir, /switchTab\('staff'\)/)
    assert.match(dir, /switchTab\('portal'\)/)
  })

  await t.test('the old PendingPanel and SummaryStat are removed', () => {
    assert.doesNotMatch(dir, /function PendingPanel/, 'PendingPanel must be deleted')
    assert.doesNotMatch(dir, /PendingPanel/, 'PendingPanel must not be referenced anywhere')
    assert.doesNotMatch(dir, /function SummaryStat/, 'SummaryStat must be deleted')
    assert.doesNotMatch(dir, /<SummaryStat/, 'SummaryStat must not be rendered')
    assert.doesNotMatch(dir, /AlertCircle/, 'AlertCircle icon was only used by PendingPanel')
  })

  await t.test('Invite Staff User and Grant Portal Access are distinct actions', () => {
    assert.match(dir, /Invite Staff User/)
    assert.match(dir, /Grant Portal Access/)
    assert.match(dir, /setInviteStaffOpen\(true\)/, 'staff invite opens InviteUserModal path')
    assert.match(dir, /openGrant\(null\)/, 'portal grant opens the grant modal path')
    assert.match(dir, /import InviteUserModal/)
    assert.match(dir, /import GrantPortalAccessModal/)
  })

  await t.test('tab-adaptive FilterKPICard rows render, imported from KPIBand', () => {
    // ACCOUNTS-KPI-SORT-1: six portal-access cards + four staff cards, tab-gated.
    assert.match(dir, /import \{ FilterKPICard \} from '\.\.\/KPIBand'/)
    for (const label of ['All Portal Users', 'Students', 'Unit Leaders', 'Academic Partners', 'Pending Invitations', 'Expiring Soon', 'All Staff', 'Interviewers']) {
      assert.match(dir, new RegExp(`label="${label}"`), `missing KPI card ${label}`)
    }
    assert.match(dir, /<FilterKPICard/)
  })

  await t.test('KPI card wiring matches the click/active spec', () => {
    // ACCOUNTS-KPI-SORT-1: the KPI row is tab-adaptive; cards only filter within the
    // current tab (the segmented control owns tab switching). Portal row: six cards
    // including the three role cards driving the shared roleFilter state.
    assert.match(dir, /value=\{counts\.allGrants\}[^]*?active=\{!roleFilter && !statusFilter && !expiringOnly\}/)
    assert.match(dir, /value=\{counts\.students\}[^]*?onClick=\{\(\) => toggleRoleCard\('student'\)\}/)
    // Pending card: toggles statusFilter to/from 'pending', clears expiringOnly.
    assert.match(dir, /value=\{counts\.pending\}[^]*?statusFilter === 'pending'/)
    assert.match(dir, /setStatusFilter\(f => f === 'pending' \? '' : 'pending'\)/)
    // Expiring card: toggles expiringOnly, clears statusFilter.
    assert.match(dir, /value=\{counts\.expiring\}[^]*?active=\{expiringOnly\}/)
    assert.match(dir, /setExpiringOnly\(e => !e\)/)
  })

  await t.test('counts.pending comes from the server contract, not a client array length', () => {
    assert.match(dir, /pending: portalData\.counts\?\.pending \?\? 0/)
    assert.doesNotMatch(dir, /pending: pending\.length/)
  })

  await t.test('search and role/status filters render in one unified toolbar', () => {
    assert.match(dir, /aria-label="Search accounts"/)
    assert.match(dir, /aria-label="Filter by role"/)
    assert.match(dir, /aria-label="Filter by status"/)
  })

  await t.test("portal status filter offers 'pending' first", () => {
    assert.match(dir, /\{ value: 'pending', label: 'Pending' \}/)
  })

  await t.test('expiringOnly is a client-side filter on expiring_soon', () => {
    assert.match(dir, /const \[expiringOnly, setExpiringOnly\] = useState\(false\)/)
    assert.match(dir, /r\.expiring_soon === true/)
  })

  await t.test('tab switching clears role, status, expiring, and interviewer filters', () => {
    // ACCOUNTS-KPI-SORT-1: interviewerOnly (the staff Interviewers KPI) resets too.
    assert.match(dir, /const switchTab = \(t\) => \{ setTab\(t\); setRoleFilter\(''\); setStatusFilter\(''\); setExpiringOnly\(false\); setInterviewerOnly\(false\) \}/)
  })

  await t.test('the portal query key includes everything the queryFn reads', () => {
    assert.match(dir, /queryKey: \['portal_access_list', search, roleFilter, statusFilter, tab\]/)
  })

  await t.test('pagination via Load more exists', () => {
    assert.match(dir, /Load more/)
    assert.match(dir, /PAGE_SIZE = 25/)
  })

  await t.test('staff and portal role selectors are separated (no portal roles in staff)', () => {
    // Staff filter draws from ROLE_OPTIONS (admin/co-lead/interviewer/viewer) + owner; portal from PORTAL_ROLE_OPTIONS.
    assert.match(dir, /import \{[^}]*ROLE_OPTIONS[^}]*\} from '\.\/accountsShared'/)
    assert.match(dir, /PORTAL_ROLE_OPTIONS/)
    // The staff role-filter branch must not reference portal role values.
    assert.doesNotMatch(dir, /ROLE_OPTIONS[^\n]*(student|unit_leader|academic_partner)/)
  })

  await t.test('rows open a right-side details drawer', () => {
    assert.match(dir, /import AccountDetailsDrawer/)
    assert.match(dir, /openDrawer\(/)
    assert.match(dir, /<AccountDetailsDrawer/)
  })

  await t.test('responsive: narrow screens use compact account cards', () => {
    assert.match(dir, /useIsNarrow/)
    assert.match(dir, /isNarrow \?/)
    assert.match(dir, /function AccountCard/)
  })

  await t.test('portal table shows one identity cell (avatar + name + email) and a Last login column', () => {
    assert.doesNotMatch(dir, /<th style=\{th\}>Email<\/th>/, 'the separate Email column must be gone from the portal table')
    assert.match(dir, /<th style=\{th\}>Last login<\/th>/)
    assert.match(dir, /formatLoginDate\(r\.last_login_at\)/)
  })

  await t.test('online presence is wired from onlineProfileIds, never auth_user_id', () => {
    assert.match(dir, /import \{ usePresence \} from '\.\.\/\.\.\/contexts\/PresenceContext'/)
    assert.match(dir, /const \{ onlineProfileIds \} = usePresence\(\)/)
    assert.match(dir, /onlineProfileIds\.has\(u\.id\)/)
    assert.match(dir, /onlineProfileIds\.has\(r\.user_profile_id\)/)
    assert.match(dir, /function PresenceAvatar/)
    assert.doesNotMatch(dir, /auth_user_id/, 'directory must never render or key on auth_user_id')
  })

  await t.test('no service-role secret is rendered', () => {
    assert.doesNotMatch(dir, /SERVICE_ROLE|service_role/i)
  })

  await t.test('no direct browser reads or writes of the authorization tables', () => {
    for (const tbl of AUTHZ_TABLES) {
      assert.doesNotMatch(dir, new RegExp(`from\\(\\s*['"\`]${tbl}['"\`]\\s*\\)`), `must not touch ${tbl} from the browser`)
    }
    // Portal data comes only from the secure listing endpoint.
    assert.match(dir, /\/api\/list-portal-access/)
  })
})
