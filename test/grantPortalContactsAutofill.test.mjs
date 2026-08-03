// ASPIRE-PORTAL-CONTACTS / ASPIRE-PORTAL-STUDENT-PICKER: static-source guards for
// the Contacts + student autofill in the Grant Portal Access modal, and for the
// shared single-source contacts search (ContactAutocomplete reuses it).
// Run: node --test test/grantPortalContactsAutofill.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const modal = readFileSync(join(here, '../src/components/settings/GrantPortalAccessModal.jsx'), 'utf8')
const suggest = readFileSync(join(here, '../src/components/settings/ContactSuggest.jsx'), 'utf8')
const autocomplete = readFileSync(join(here, '../src/components/connect/ContactAutocomplete.jsx'), 'utf8')
const shared = readFileSync(join(here, '../src/lib/contactSearch.js'), 'utf8')

test('shared contacts search is the single source of truth', async (t) => {
  await t.test('the Outreach ContactAutocomplete reuses the shared search', () => {
    assert.match(autocomplete, /import \{ searchContacts \} from '\.\.\/\.\.\/lib\/contactSearch'/)
    assert.match(autocomplete, /searchContacts\(debounced/)
    assert.doesNotMatch(autocomplete, /from\('contacts'\)\s*\n?\s*\.select/)
  })
  await t.test('the shared module runs one authorized contacts query', () => {
    assert.match(shared, /from\('contacts'\)/)
    assert.match(shared, /\.eq\('is_active', true\)/)
    assert.match(shared, /full_name\.ilike[\s\S]*email\.ilike/)
    assert.match(shared, /setTimeout\(\(\) => setDebounced\(sanitizeContactTerm\(value\)\), 250\)/)
  })
})

test('Grant modal identity + scope autofill', async (t) => {
  await t.test('name/email use the shared contacts search; Student uses a unified picker', () => {
    assert.match(modal, /import \{ useContactSearch[^}]*\} from '\.\.\/\.\.\/lib\/contactSearch'/)
    assert.match(modal, /function IdentityPicker/)
    // STAFF-INVITE-CONTACTS-1: ContactSuggest moved VERBATIM to its own module
    // so the staff invite shares the identical component; the Grant modal now
    // imports it. Behavior is unchanged.
    assert.match(modal, /import ContactSuggest from '\.\/ContactSuggest'/)
    assert.match(suggest, /export default function ContactSuggest/)
    assert.match(modal, /useContactSearch\(value\)/)
    assert.match(suggest, /useContactSearch\(value\)/)
  })

  await t.test('unit leader preselects units from the contact affiliation, editable', () => {
    assert.match(modal, /matchCatalogKeys\(c\.unit_name, UNIT_VALUES\)/)
    assert.match(modal, /roleArg === 'unit_leader' && !unitTouched/)
    assert.match(modal, /onChange=\{\(next\) => \{ setUnitTouched\(true\); setUnitKeys\(next\) \}\}/)
  })

  await t.test('academic partner school autofill is alias-aware over ALL affiliation fields', () => {
    assert.match(modal, /matchSchoolKeys\(\[c\.school_name, c\.organization\], SCHOOL_SCOPE_OPTIONS\)/)
    assert.match(modal, /roleArg === 'academic_partner' && !schoolTouched/)
    assert.match(modal, /onChange=\{\(next\) => \{ setSchoolTouched\(true\); setSchoolKeys\(next\) \}\}/)
    // The old canonical-only school matching is gone.
    assert.doesNotMatch(modal, /matchCatalogKeys\(c\.school_name/)
  })

  await t.test('a saved student contact links a student only via a reliable exact-email match', () => {
    assert.match(modal, /pickReliableStudent\(c\.email, data \|\| \[\]\)/)
    assert.match(modal, /targetRole === 'student' && c\.email/)
    assert.match(modal, /school_email\.ilike\.\$\{em\},personal_email\.ilike\.\$\{em\}/, 'matches by email, not name')
    assert.doesNotMatch(modal, /full_name.*===.*contact|name match/i)
  })

  await t.test('manual entry works and manual edits are protected on role change', () => {
    assert.match(modal, /onChange=\{setFullName\}/, 'name field is directly editable')
    assert.match(modal, /onChange=\{e => setEmail\(e\.target\.value\)\}/, 'login email is directly editable')
    assert.match(modal, /const onRoleChange = \(next\) => \{[\s\S]*?if \(selectedContact\) suggestUntouchedScope\(selectedContact, next\)/)
    assert.match(modal, /suggestUntouchedScope = useCallback\(\(c, roleArg\) =>/)
    assert.match(modal, /\}, \[unitTouched, schoolTouched\]\)/)
  })

  await t.test('keyboard navigation and Escape work in the pickers', () => {
    assert.match(modal, /e\.key === 'ArrowDown'/)
    assert.match(modal, /e\.key === 'ArrowUp'/)
    assert.match(modal, /e\.key === 'Enter'/)
    assert.match(modal, /e\.key === 'Escape'/)
    assert.match(modal, /role="combobox"/)
    assert.match(modal, /role="listbox"/)
    assert.match(modal, /role="option"/)
  })

  await t.test('no-match state guides manual entry', () => {
    // The contacts-only no-match copy now lives in the extracted component.
    assert.match(suggest, /No matching contact found\. You can continue by entering the details manually\./)
    assert.match(modal, /No matching student or contact found\. You can continue by entering the details manually\./)
  })

  await t.test('duplicate submission prevented and writes stay server-side', () => {
    assert.match(modal, /if \(!formValid \|\| loading\) return/)
    assert.match(modal, /disabled=\{loading \|\| !formValid\}/)
    assert.match(modal, /\/api\/invite-portal-user/)
    for (const tbl of ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes']) {
      assert.doesNotMatch(modal, new RegExp(`from\\(\\s*['"\`]${tbl}`), `must not touch ${tbl}`)
    }
    assert.doesNotMatch(modal, /auth_user_id|service_role/i)
  })
})
