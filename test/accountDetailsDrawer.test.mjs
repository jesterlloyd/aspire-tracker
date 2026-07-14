// ASPIRE-PORTAL-ACCESS-UI: static-source guards for the account details drawer.
// Confirms accessible dialog semantics, focus-in/trap/return, safe Escape,
// role-specific revoke payloads with confirmation, and that sensitive
// identifiers are never rendered and the auth user is never deleted client-side.
// Run: node --test test/accountDetailsDrawer.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../src/components/settings/AccountDetailsDrawer.jsx'), 'utf8')

test('Account details drawer', async (t) => {
  await t.test('is an accessible dialog with a title', () => {
    assert.match(src, /role="dialog"/)
    assert.match(src, /aria-modal="true"/)
    assert.match(src, /aria-label=\{`Account details for /)
  })

  await t.test('manages focus: moves in, traps Tab, returns on close', () => {
    assert.match(src, /data-drawer-initial/, 'an initial focus target exists')
    assert.match(src, /e\.key !== 'Tab'/, 'Tab handling is present (focus trap)')
    assert.match(src, /focusables/, 'the trap enumerates focusable elements')
    assert.match(src, /prevActive\?\.focus/, 'focus returns to the opener on unmount')
  })

  await t.test('Escape closes only when no destructive confirmation is pending', () => {
    assert.match(src, /if \(e\.key === 'Escape'\) \{ if \(!confirmRevoke && !busy\) onClose/)
  })

  await t.test('revoke requires confirmation with the four assurances', () => {
    assert.match(src, /Revoke portal access\?/)
    assert.match(src, /sign-in identity will not be deleted/)
    assert.match(src, /user profile will not be deleted/)
    assert.match(src, /history will remain preserved/)
    assert.match(src, /selected role and scope will close/)
    assert.match(src, /confirmRevoke/)
  })

  await t.test('revoke sends the role-specific payload to the revoke endpoint', () => {
    assert.match(src, /\/api\/revoke-portal-access/)
    assert.match(src, /role: record\.portal_role, user_profile_id: record\.user_profile_id, cascade: true/)
    assert.match(src, /body\.student_id = record\.scope\?\.students\?\.\[0\]\?\.student_id/)
    assert.match(src, /body\.unit_keys = \(record\.scope\?\.units \|\| \[\]\)\.map/)
    assert.match(src, /body\.school_keys = \(record\.scope\?\.schools \|\| \[\]\)\.map/)
    assert.match(src, /already_revoked/, 'idempotent already-revoked is treated as success')
  })

  await t.test('never renders sensitive identifiers and never deletes the auth user', () => {
    assert.doesNotMatch(src, /auth_user_id/)
    assert.doesNotMatch(src, /revoked_by/)
    assert.doesNotMatch(src, /deleteUser/)
    assert.doesNotMatch(src, /SERVICE_ROLE|service_role/i)
  })

  await t.test('retains user_profile_id only to submit the revoke request', () => {
    // It appears in the revoke body but is not shown to the user.
    assert.match(src, /user_profile_id: record\.user_profile_id/)
    assert.doesNotMatch(src, /<dd[^>]*>\{record\.user_profile_id\}/)
  })
})
