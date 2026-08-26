// PORTAL-ROLE-GUIDE-1: keeps the Role Guide aligned with the portal grant
// vocabulary and the Contacts Editor boundary.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PORTAL_ROLE_ORDER,
  PORTAL_ROLE_SUMMARY,
  PORTAL_CAPABILITY_MATRIX,
  PORTAL_LEVELS,
  PORTAL_MODEL_NOTES,
} from '../src/lib/portalRoleGuide.js'
import { PORTAL_ROLE_OPTIONS } from '../src/lib/portalAccessStatus.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

test('the portal guide uses the exact grant-role vocabulary', () => {
  assert.deepEqual(
    [...PORTAL_ROLE_ORDER],
    PORTAL_ROLE_OPTIONS.map(option => option.value),
  )
  for (const option of PORTAL_ROLE_OPTIONS) {
    assert.equal(PORTAL_ROLE_SUMMARY[option.value].label, option.label)
  }
  assert.ok(!PORTAL_ROLE_ORDER.includes('contacts_editor'))
})

test('every portal matrix cell has a known level', () => {
  for (const row of PORTAL_CAPABILITY_MATRIX) {
    assert.deepEqual(Object.keys(row.levels).sort(), [...PORTAL_ROLE_ORDER].sort())
    for (const role of PORTAL_ROLE_ORDER) {
      assert.ok(PORTAL_LEVELS.includes(row.levels[role]), `${row.key}/${role}`)
    }
  }
})

test('Contacts Editor stays an optional permission with no permanent delete', () => {
  const contacts = PORTAL_CAPABILITY_MATRIX.find(row => row.key === 'contacts')
  const permanentDelete = PORTAL_CAPABILITY_MATRIX.find(row => row.key === 'permanentContactDeletion')
  assert.equal(contacts.levels.nursing_academic, 'View or edit')
  assert.match(contacts.note, /optional permission within Nursing Education & Leadership/i)
  assert.deepEqual(
    Object.values(permanentDelete.levels),
    PORTAL_ROLE_ORDER.map(() => 'No access'),
  )
  assert.match(PORTAL_ROLE_SUMMARY.nursing_academic.detail, /deactivating, and reactivating contacts/i)
  assert.match(PORTAL_ROLE_SUMMARY.nursing_academic.detail, /never permanent deletion/i)
})

test('no portal role receives staff application access', () => {
  const staffApplication = PORTAL_CAPABILITY_MATRIX.find(row => row.key === 'staffApplication')
  assert.ok(staffApplication)
  assert.ok(Object.values(staffApplication.levels).every(level => level === 'No access'))
  assert.ok(PORTAL_MODEL_NOTES.some(note => /never creates a staff role/i.test(note)))
})

test('Role Guide defaults to Staff Roles and provides an accessible portal toggle', () => {
  const panel = read('src/components/settings/RoleGuidePanel.jsx')
  assert.match(panel, /useState\('staff'\)/)
  assert.match(panel, /aria-label="Role guide type"/)
  assert.match(panel, /aria-pressed=\{active\}/)
  assert.match(panel, /label: 'Staff Roles'/)
  assert.match(panel, /label: 'Portal Roles'/)
})
