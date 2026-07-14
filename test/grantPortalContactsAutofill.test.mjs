// ASPIRE-PORTAL-CONTACTS: static-source guards for the Contacts autofill added to
// the Grant Portal Access modal, and for the shared single-source contacts
// search (ContactAutocomplete now reuses it, so there is no duplicate search).
// Run: node --test test/grantPortalContactsAutofill.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const modal = readFileSync(join(here, '../src/components/settings/GrantPortalAccessModal.jsx'), 'utf8')
const autocomplete = readFileSync(join(here, '../src/components/connect/ContactAutocomplete.jsx'), 'utf8')
const shared = readFileSync(join(here, '../src/lib/contactSearch.js'), 'utf8')

test('shared contacts search is the single source of truth', async (t) => {
  await t.test('the Outreach ContactAutocomplete reuses the shared search', () => {
    assert.match(autocomplete, /import \{ searchContacts \} from '\.\.\/\.\.\/lib\/contactSearch'/)
    assert.match(autocomplete, /searchContacts\(debounced/)
    // It no longer defines its own inline contacts .or(ilike) query.
    assert.doesNotMatch(autocomplete, /from\('contacts'\)\s*\n?\s*\.select/)
  })
  await t.test('the shared module runs one authorized contacts query (is_active, .or ilike)', () => {
    assert.match(shared, /from\('contacts'\)/)
    assert.match(shared, /\.eq\('is_active', true\)/)
    assert.match(shared, /full_name\.ilike[\s\S]*email\.ilike/)
    // 250ms debounce mirrors the CC picker.
    assert.match(shared, /setTimeout\(\(\) => setDebounced\(sanitizeContactTerm\(value\)\), 250\)/)
  })
})

test('Grant modal Contacts autofill', async (t) => {
  await t.test('name and email are saved-contact typeaheads', () => {
    assert.match(modal, /import \{ useContactSearch[^}]*\} from '\.\.\/\.\.\/lib\/contactSearch'/)
    assert.match(modal, /function ContactSuggest/)
    assert.match(modal, /<ContactSuggest id="gpa-name"/)
    assert.match(modal, /<ContactSuggest id="gpa-email"/)
    assert.match(modal, /useContactSearch\(value\)/)
  })

  await t.test('selecting a contact fills full name and login email', () => {
    assert.match(modal, /const applyContactSelection = useCallback\(async \(c\) => \{/)
    assert.match(modal, /setFullName\(contactName\(c\)\)/)
    assert.match(modal, /if \(c\.email\) setEmail\(c\.email\)/)
  })

  await t.test('unit leader preselects units from the contact affiliation, editable', () => {
    assert.match(modal, /matchCatalogKeys\(c\.unit_name, UNIT_VALUES\)/)
    // On a manual role change, the suggestion respects manual edits.
    assert.match(modal, /roleArg === 'unit_leader' && !unitTouched/)
    // The unit chips remain editable and edits mark the field touched.
    assert.match(modal, /onChange=\{\(next\) => \{ setUnitTouched\(true\); setUnitKeys\(next\) \}\}/)
  })

  await t.test('academic partner preselects schools from the contact affiliation, editable', () => {
    assert.match(modal, /matchCatalogKeys\(c\.school_name, SCHOOL_VALUES\)/)
    assert.match(modal, /roleArg === 'academic_partner' && !schoolTouched/)
    assert.match(modal, /onChange=\{\(next\) => \{ setSchoolTouched\(true\); setSchoolKeys\(next\) \}\}/)
  })

  await t.test('student is preselected only via a reliable exact-email link, never by name', () => {
    assert.match(modal, /pickReliableStudent\(c\.email, data \|\| \[\]\)/)
    assert.match(modal, /targetRole === 'student' && c\.email/)
    assert.match(modal, /school_email\.ilike\.\$\{em\},personal_email\.ilike\.\$\{em\}/, 'matches by email, not name')
    // The reliable-link helper (tested in contactSearch.test) requires exactly one match.
    assert.doesNotMatch(modal, /full_name.*===.*contact|name match/i)
  })

  await t.test('manual entry works and manual edits are protected on role change', () => {
    // Direct typing updates the field...
    assert.match(modal, /onChange=\{setFullName\}/)
    assert.match(modal, /onChange=\{setEmail\}/)
    // ...and switching roles preserves name/email while re-suggesting scope (guarded).
    assert.match(modal, /const onRoleChange = \(next\) => \{[\s\S]*?if \(selectedContact\) suggestUntouchedScope\(selectedContact, next\)/)
    assert.match(modal, /suggestUntouchedScope = useCallback\(\(c, roleArg\) =>/)
    // The guarded suggestion only writes untouched fields.
    assert.match(modal, /\}, \[unitTouched, schoolTouched\]\)/)
  })

  await t.test('keyboard navigation and Escape work in the contact typeahead', () => {
    assert.match(modal, /e\.key === 'ArrowDown'/)
    assert.match(modal, /e\.key === 'ArrowUp'/)
    assert.match(modal, /e\.key === 'Enter'/)
    assert.match(modal, /e\.key === 'Escape'/)
    assert.match(modal, /role="combobox"/)
    assert.match(modal, /role="listbox"/)
    assert.match(modal, /role="option"/)
  })

  await t.test('no-match state guides manual entry', () => {
    assert.match(modal, /No matching contact found\. You can continue by entering the details manually\./)
  })

  await t.test('duplicate submission remains prevented and writes stay server-side', () => {
    assert.match(modal, /if \(!formValid \|\| loading\) return/)
    assert.match(modal, /disabled=\{loading \|\| !formValid\}/)
    assert.match(modal, /\/api\/invite-portal-user/)
    for (const tbl of ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes']) {
      assert.doesNotMatch(modal, new RegExp(`from\\(\\s*['"\`]${tbl}`), `must not touch ${tbl}`)
    }
    assert.doesNotMatch(modal, /auth_user_id|service_role/i)
  })
})
