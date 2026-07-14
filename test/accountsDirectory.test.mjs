// ASPIRE-PORTAL-ACCESS-UI: static-source guards for the Accounts & Access
// directory. Confirms the old role-grouped card board is replaced, the three
// tabs and dual invite actions exist, summary counts and search/filters render,
// staff and portal roles stay separated, and the browser never reads or writes
// the authorization tables directly.
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

  await t.test('three access tabs render with tablist semantics', () => {
    assert.match(dir, /role="tablist"/)
    for (const label of ['Staff Access', 'Portal Access', 'Pending Invitations']) {
      assert.match(dir, new RegExp(label), `missing tab ${label}`)
    }
    assert.match(dir, /role="tab"/)
    assert.match(dir, /role="tabpanel"/)
  })

  await t.test('Invite Staff User and Grant Portal Access are distinct actions', () => {
    assert.match(dir, /Invite Staff User/)
    assert.match(dir, /Grant Portal Access/)
    assert.match(dir, /setInviteStaffOpen\(true\)/, 'staff invite opens InviteUserModal path')
    assert.match(dir, /openGrant\(null\)/, 'portal grant opens the grant modal path')
    assert.match(dir, /import InviteUserModal/)
    assert.match(dir, /import GrantPortalAccessModal/)
  })

  await t.test('summary indicators render the four counts', () => {
    for (const label of ['Staff', 'Portal Users', 'Pending Invitations', 'Expiring Soon']) {
      assert.match(dir, new RegExp(`label="${label}"`), `missing summary ${label}`)
    }
  })

  await t.test('search and role/status filters render', () => {
    assert.match(dir, /aria-label="Search accounts"/)
    assert.match(dir, /aria-label="Filter by role"/)
    assert.match(dir, /aria-label="Filter by status"/)
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

  await t.test('no auth_user_id or service-role secret is rendered', () => {
    assert.doesNotMatch(dir, /auth_user_id/, 'directory must never render auth_user_id')
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
