// test/contactsBook.test.mjs
//
// CONTACTS-BOOK-1 (2026-09-20): ASPIRE Connect > Contacts gains an opt-in Address book.
// What this file holds the build to:
//
//   1. The preference is per USER. It is read from and written to the caller's own
//      user_profiles row through one store, it survives the column being absent (the
//      migration is Owner-gated), and it never writes a value the registry does not
//      allow or erases a key it does not know.
//   2. The book files by last name and says honest things (the pure model).
//   3. The book RENDERS: a real server render, the thumb index, the entries, and the
//      record's sections in the order the brief gives.
//   4. Both layouts read one data hook, the book fetches nothing itself, Classic keeps
//      its three columns, and the SQL adds one column and one grant, nothing else.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  CONTACTS_LAYOUT, USER_PREFERENCES, preferenceValue, isValidPreferenceValue, keysToAdopt,
  createUserPreferenceStore, preferenceCacheKey,
} from '../src/lib/userPreferences.js'
import {
  lastNameOf, letterOf, sortForBook, bookRows, lettersPresent, entryLine, bookCountLine,
  commStatus, studentStatusTone, linkedStudentsHeading, shortDate, initialsOf, OTHER_LETTER,
} from '../src/lib/connect/contactsBookModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const root = new URL('../', import.meta.url).pathname
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

// ── 1. The preference ───────────────────────────────────────────────────────────

test('appearance.contactsLayout is registered with classic as everyone\'s default', () => {
  assert.equal(CONTACTS_LAYOUT, 'appearance.contactsLayout')
  assert.deepEqual([...USER_PREFERENCES[CONTACTS_LAYOUT].values], ['classic', 'book'])
  assert.equal(USER_PREFERENCES[CONTACTS_LAYOUT].fallback, 'classic')
  assert.equal(preferenceValue({}, CONTACTS_LAYOUT), 'classic')
  assert.equal(preferenceValue(null, CONTACTS_LAYOUT), 'classic')
  assert.equal(preferenceValue({ [CONTACTS_LAYOUT]: 'book' }, CONTACTS_LAYOUT), 'book')
  // A stored value this build does not know reads as the default, never as itself.
  assert.equal(preferenceValue({ [CONTACTS_LAYOUT]: 'grid' }, CONTACTS_LAYOUT), 'classic')
  assert.equal(isValidPreferenceValue(CONTACTS_LAYOUT, 'grid'), false)
  assert.equal(isValidPreferenceValue('appearance.unknown', 'book'), false)
  assert.throws(() => preferenceValue({}, 'appearance.unknown'))
})

test('the one-time adoption takes only registered, legal keys the account does not hold', () => {
  assert.deepEqual(keysToAdopt({}, { [CONTACTS_LAYOUT]: 'book' }), { [CONTACTS_LAYOUT]: 'book' })
  assert.deepEqual(keysToAdopt({ [CONTACTS_LAYOUT]: 'classic' }, { [CONTACTS_LAYOUT]: 'book' }), {},
    'a key the account already stores always wins over this browser')
  assert.deepEqual(keysToAdopt({}, { [CONTACTS_LAYOUT]: 'grid', 'appearance.other': 'x' }), {})
  assert.deepEqual(keysToAdopt({}, null), {})
})

// A fake supabase client: records every call, answers from a script.
function fakeClient({ row = {}, readError = null, updateRows = 1 } = {}) {
  const calls = []
  let stored = { ...row }
  const client = {
    from(table) {
      assert.equal(table, 'user_profiles')
      return {
        select(cols) {
          assert.equal(cols, 'ui_preferences')
          return {
            eq(col, uid) {
              assert.equal(col, 'auth_user_id')
              return {
                async maybeSingle() {
                  calls.push({ op: 'read', uid })
                  if (readError) return { data: null, error: readError }
                  return { data: { ui_preferences: { ...stored } }, error: null }
                },
              }
            },
          }
        },
        update(patch) {
          return {
            eq(col, uid) {
              assert.equal(col, 'auth_user_id')
              return {
                async select() {
                  calls.push({ op: 'update', uid, prefs: patch.ui_preferences })
                  if (updateRows > 0) stored = { ...patch.ui_preferences }
                  return { data: Array.from({ length: updateRows }, () => ({ auth_user_id: uid })), error: null }
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, calls, stored: () => stored }
}
function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}

test('before the column exists the choice is kept in the browser, and nothing is written to the account', async () => {
  const { client, calls } = fakeClient({ readError: { code: '42703', message: 'column does not exist' } })
  const storage = memoryStorage()
  const store = createUserPreferenceStore({ client, storage })
  await store.ensure('u1')
  assert.equal(store.getSnapshot().synced, false)
  assert.equal(store.getSnapshot().reason, 'unavailable')
  const result = await store.set(CONTACTS_LAYOUT, 'book')
  assert.deepEqual(result, { saved: 'browser' })
  assert.equal(preferenceValue(store.getSnapshot().prefs, CONTACTS_LAYOUT), 'book', 'the choice shows at once')
  assert.equal(JSON.parse(storage.getItem(preferenceCacheKey('u1')))[CONTACTS_LAYOUT], 'book')
  assert.equal(calls.filter(c => c.op === 'update').length, 0)
})

test('when the column arrives, the browser\'s earlier choice is adopted into the account once', async () => {
  const { client, calls, stored } = fakeClient({ row: {} })
  const storage = memoryStorage({ [preferenceCacheKey('u1')]: JSON.stringify({ [CONTACTS_LAYOUT]: 'book' }) })
  const store = createUserPreferenceStore({ client, storage })
  await store.ensure('u1')
  assert.equal(store.getSnapshot().synced, true)
  assert.equal(preferenceValue(store.getSnapshot().prefs, CONTACTS_LAYOUT), 'book')
  assert.deepEqual(stored(), { [CONTACTS_LAYOUT]: 'book' })
  assert.equal(calls.filter(c => c.op === 'update').length, 1)
})

test('the account wins over this browser once it holds the key (the choice follows the person)', async () => {
  const { client, calls } = fakeClient({ row: { [CONTACTS_LAYOUT]: 'classic' } })
  const storage = memoryStorage({ [preferenceCacheKey('u1')]: JSON.stringify({ [CONTACTS_LAYOUT]: 'book' }) })
  const store = createUserPreferenceStore({ client, storage })
  await store.ensure('u1')
  assert.equal(preferenceValue(store.getSnapshot().prefs, CONTACTS_LAYOUT), 'classic')
  assert.equal(calls.filter(c => c.op === 'update').length, 0)
  assert.equal(JSON.parse(storage.getItem(preferenceCacheKey('u1')))[CONTACTS_LAYOUT], 'classic',
    'the browser copy is refreshed from the account')
})

test('a write re-reads the row and keeps keys another device or a newer build wrote', async () => {
  const { client, calls, stored } = fakeClient({ row: { [CONTACTS_LAYOUT]: 'classic' } })
  const store = createUserPreferenceStore({ client, storage: memoryStorage() })
  await store.ensure('u1')
  // After this tab loaded, another device (or a newer build) writes a key this one does
  // not know. The fake's own update stands in for that write.
  await client.from('user_profiles').update({ ui_preferences: { [CONTACTS_LAYOUT]: 'classic', 'appearance.future': 'x' } }).eq('auth_user_id', 'u1').select('auth_user_id')
  calls.length = 0
  const result = await store.set(CONTACTS_LAYOUT, 'book')
  assert.deepEqual(result, { saved: 'account' })
  assert.deepEqual(calls.map(c => c.op), ['read', 'update'], 'read first, then write')
  assert.deepEqual(stored(), { [CONTACTS_LAYOUT]: 'book', 'appearance.future': 'x' })
})

test('writes are serialized, so the last choice is the one the account keeps', async () => {
  const { client, calls, stored } = fakeClient({ row: {} })
  const store = createUserPreferenceStore({ client, storage: memoryStorage() })
  await store.ensure('u1')
  calls.length = 0
  const a = store.set(CONTACTS_LAYOUT, 'book')
  const b = store.set(CONTACTS_LAYOUT, 'classic')
  await Promise.all([a, b])
  assert.deepEqual(calls.filter(c => c.op === 'update').map(c => c.prefs[CONTACTS_LAYOUT]), ['book', 'classic'])
  assert.equal(stored()[CONTACTS_LAYOUT], 'classic')
})

test('a write the self policy refused (no row came back) is not reported as saved', async () => {
  const { client } = fakeClient({ row: {}, updateRows: 0 })
  const store = createUserPreferenceStore({ client, storage: memoryStorage() })
  await store.ensure('u1')
  const result = await store.set(CONTACTS_LAYOUT, 'book')
  assert.equal(result.saved, 'browser')
})

test('an illegal value is refused before anything changes', async () => {
  const { client, calls } = fakeClient({ row: {} })
  const store = createUserPreferenceStore({ client, storage: memoryStorage() })
  await store.ensure('u1')
  calls.length = 0
  await assert.rejects(() => store.set(CONTACTS_LAYOUT, 'grid'))
  await assert.rejects(() => store.set('appearance.unknown', 'book'))
  assert.equal(calls.length, 0)
  assert.equal(preferenceValue(store.getSnapshot().prefs, CONTACTS_LAYOUT), 'classic')
})

test('another person signing in on the same browser does not inherit the choice', async () => {
  const { client } = fakeClient({ readError: { code: '42703' } })
  const storage = memoryStorage()
  const store = createUserPreferenceStore({ client, storage })
  await store.ensure('u1')
  await store.set(CONTACTS_LAYOUT, 'book')
  await store.ensure('u2')
  assert.equal(store.getSnapshot().uid, 'u2')
  assert.equal(preferenceValue(store.getSnapshot().prefs, CONTACTS_LAYOUT), 'classic')
})

// ── 2. The model ────────────────────────────────────────────────────────────────

test('a contact is filed under the last word of the name, not a credential or a suffix', () => {
  assert.equal(lastNameOf('Marissa Grafil Ramirez'), 'Ramirez')
  assert.equal(lastNameOf('Lucy Van Otterloo'), 'Otterloo')
  assert.equal(lastNameOf('Jane Doe, RN'), 'Doe')
  assert.equal(lastNameOf('John Smith Jr.'), 'Smith')
  assert.equal(lastNameOf('Robert King III'), 'King')
  assert.equal(lastNameOf('Cher'), 'Cher')
  assert.equal(lastNameOf(''), '')
  assert.equal(letterOf('Sofía Álvarez'), 'A', 'accents fold to their letter')
  assert.equal(letterOf('Anna 3rd'), OTHER_LETTER)
  assert.equal(letterOf(''), OTHER_LETTER)
})

const C = (id, full_name, extra = {}) => ({ id, full_name, role: 'Preceptor', organization: 'Cedars-Sinai', ...extra })

test('the book sorts by last name, files the displayed name, and puts # after Z', () => {
  const list = [
    C('1', 'Zoe Adams'), C('2', 'Adam Zimmer'), C('3', 'Jun Bagunu', { preferred_name: 'Jun' }),
    C('4', 'Adolfo Bagunu', { preferred_name: 'Dolf' }), C('5', 'Prince'), C('6', 'Mia 2nd'),
  ]
  const sorted = sortForBook(list)
  assert.deepEqual(sorted.map(c => c.id), ['1', '4', '3', '5', '2', '6'])
  const rows = bookRows(sorted)
  assert.deepEqual(rows.filter(r => r.type === 'letter').map(r => r.letter), ['A', 'B', 'P', 'Z', OTHER_LETTER])
  assert.deepEqual([...lettersPresent(list)].sort(), ['#', 'A', 'B', 'P', 'Z'])
})

test('an entry reads Role · where, and the count line drops its tail under All Contacts', () => {
  assert.equal(entryLine({ role: 'Unit Leader', unit_name: '6 NW', category: 'Unit Leader', organization: 'Cedars-Sinai' }), 'Unit Leader · 6 NW')
  assert.equal(entryLine({ role: '', organization: 'Azusa Pacific University' }), 'Azusa Pacific University')
  assert.equal(bookCountLine({ shown: 12, inCategory: 110, inBook: 231, isAll: false }), '12 of 110 shown · 231 in the full book')
  assert.equal(bookCountLine({ shown: 231, inCategory: 231, inBook: 231, isAll: true }), '231 of 231 shown')
  assert.equal(initialsOf('Gary Mittelberg'), 'GM')
  assert.equal(initialsOf(''), '?')
})

test('status pills: Delivered green, Opened navy, a failure red; Active Rotation green, Placed amber, Completed grey', () => {
  assert.deepEqual(commStatus('delivered'), { tone: 'ok', label: 'Delivered' })
  assert.deepEqual(commStatus('opened'), { tone: 'info', label: 'Opened' })
  assert.equal(commStatus('bounced').tone, 'bad')
  assert.equal(commStatus('queued').tone, 'neutral')
  assert.equal(commStatus(null).label, 'Unknown')
  assert.equal(studentStatusTone('Active Rotation'), 'ok')
  assert.equal(studentStatusTone('Placed'), 'warn')
  assert.equal(studentStatusTone('Completed'), 'neutral')
  assert.equal(studentStatusTone('Interviewed'), 'neutral')
})

test('the linked-students heading counts honestly, including when the list is capped', () => {
  const s = st => ({ status: st })
  const five = [s('Completed'), s('Active Rotation'), s('Active Rotation'), s('Active Rotation'), s('Placed')]
  assert.equal(linkedStudentsHeading(five, 5), '5 assigned · 3 on active rotation')
  assert.equal(linkedStudentsHeading([s('Placed')], 1), '1 assigned')
  assert.equal(linkedStudentsHeading([], 0), 'none')
  const twelve = Array.from({ length: 12 }, () => s('Active Rotation'))
  assert.equal(linkedStudentsHeading(twelve, 30), '30 assigned · first 12 shown',
    'a capped list never claims to have counted the rotations it did not fetch')
})

test('a log date carries its year only when it is not this year\'s', () => {
  const now = new Date('2026-09-20T18:00:00Z')
  assert.equal(shortDate('2026-08-26T18:00:00Z', now), 'Aug 26')
  assert.equal(shortDate('2025-08-26T18:00:00Z', now), 'Aug 26, 2025')
  assert.equal(shortDate(null, now), '')
})

// ── 3. The render ───────────────────────────────────────────────────────────────

let vite
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})
after(async () => { await vite?.close() })

const CONTACTS = [
  C('c1', 'Gary Mittelberg', { role: 'Assistant Professor', role_qualifier: 'ELM', category: 'Academic Partner',
    school_name: 'Azusa Pacific University', organization: 'Azusa Pacific University', email: 'g@apu.edu',
    linkedin_url: 'https://www.linkedin.com/in/example', notes: 'Covers ELMN program.',
    notification_preferences: { weekly_digest: true } }),
  C('c2', 'Susan Hunter', { role: 'Clinical Placement Coordinator', category: 'Academic Partner',
    school_name: 'Azusa Pacific University', email: 's@apu.edu', phone: '(626) 555-0142' }),
  C('c3', 'Ana Lopez-Silva', { email: 'ana@example.org', unit_name: '6 South', category: 'Preceptor' }),
]

function dirFor(overrides = {}) {
  const selected = CONTACTS[0]
  return {
    contacts: CONTACTS, loading: false, error: null,
    search: '', setSearch() {}, categoryFilter: 'All', setCategoryFilter() {},
    selectedId: selected.id, selectContact() {}, selected,
    showInactive: false, setShowInactive() {},
    commHistory: [
      { id: 'l1', subject: 'ASPIRE Orientation', status: 'delivered', sent_at: '2026-08-26T18:00:00Z' },
      { id: 'l2', subject: 'Affiliation Agreement Renewal', status: 'opened', sent_at: '2026-08-12T18:00:00Z' },
    ],
    loadingComm: false,
    linkedStudents: [
      { id: 's1', first_name: 'Dylan', last_name: 'Cline', status: 'Completed' },
      { id: 's2', first_name: 'Eden', preferred_first_name: 'Edie', last_name: 'Delos Santos', status: 'Active Rotation' },
      { id: 's3', first_name: 'Nicole', last_name: 'Khoshkhou', status: 'Active Rotation' },
      { id: 's4', first_name: 'Victoria', last_name: 'Marquez', status: 'Active Rotation' },
      { id: 's5', first_name: 'Allison', last_name: 'Rabanales', status: 'Placed' },
    ],
    linkedStudentsTotal: 5, loadingStudents: false,
    categoryCounts: { 'Academic Partner': 2, Preceptor: 1 }, inactiveCount: 0, activeCount: 3,
    activeCategories: ['All', 'Academic Partner', 'Preceptor'],
    filtered: CONTACTS,
    ...overrides,
  }
}
const ACTIONS = { navigate() {}, toast: {}, onAdd() {}, onEdit() {}, onDeactivate() {}, onRepair() {} }

async function renderBook(dirOverrides) {
  const { default: ContactsBook } = await vite.ssrLoadModule('/src/components/connect/ContactsBook.jsx')
  try {
    return renderToStaticMarkup(React.createElement(ContactsBook, { dir: dirFor(dirOverrides), actions: ACTIONS }))
  } catch (err) {
    assert.fail(`ContactsBook threw while rendering: ${err.constructor.name}: ${err.message}`)
  }
}

test('the book renders: an A-Z thumb index of real buttons, empty letters disabled', async () => {
  const html = await renderBook()
  const tabs = html.match(/<button[^>]*class="ab-thumb-tab"[^>]*>/g) || []
  assert.equal(tabs.length, 26)
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.match(html, new RegExp(`aria-label="Jump to ${L}"`))
  // Present: H (Hunter), L (Lopez-Silva), M (Mittelberg). Everything else is disabled.
  const disabled = tabs.filter(t => / disabled=""/.test(t)).length
  assert.equal(disabled, 23)
  assert.ok(tabs.every(t => /aria-pressed="false"/.test(t)))
})

test('the list files by last name, the open entry carries aria-current, and the count line reads plainly', async () => {
  const html = await renderBook()
  const order = ['Hunter', 'Lopez-Silva', 'Mittelberg'].map(n => html.indexOf(`${n}</span>`))
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'H, then L, then M')
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1)
  assert.match(html, /<button[^>]*class="ab-entry"[^>]*aria-current="true"[^>]*>(?:(?!<\/button>)[\s\S])*Gary Mittelberg/)
  assert.match(html, /3 of 3 shown/)
  assert.match(html, /aria-live="polite"/, 'contact changes and letter jumps are announced')
})

test('the record holds the whole contact, in the brief\'s order, with comms and students inside it', async () => {
  const html = await renderBook()
  const at = s => { const i = html.indexOf(s); assert.ok(i > 0, `missing: ${s}`); return i }
  const sequence = [
    at('<h3 class="ab-name">Gary Mittelberg</h3>'),
    at('aria-label="Contact"'),
    at('aria-label="Notes"'),
    at('aria-label="Notification Preferences"'),
    at('aria-label="Recent Communications"'),
    at('aria-label="Linked Students"'),
  ]
  assert.deepEqual([...sequence].sort((a, b) => a - b), sequence)
  assert.match(html, /5 assigned · 3 on active rotation/)
  assert.match(html, /View all communications for this contact →/)
  assert.match(html, /class="ab-log-st ab-tone-ok">Delivered/)
  assert.match(html, /class="ab-log-st ab-tone-info">Opened/)
  assert.match(html, /ab-stud-st ab-tone-ok">Active Rotation/)
  assert.match(html, /ab-stud-st ab-tone-warn">Placed/)
  assert.match(html, /ab-stud-st ab-tone-neutral">Completed/)
  assert.match(html, /Edie Delos Santos/, 'a student is shown by the preferred full name')
  assert.match(html, /Weekly digest on/)
  assert.doesNotMatch(html, /SMS/, 'only the preferences the system stores')
})

test('the name plate: Email primary, Call disabled without a phone, LinkedIn only when there is one', async () => {
  const noPhone = await renderBook()
  assert.match(noPhone, /class="ab-act ab-act-primary"[^>]*>[\s\S]*?Email/)
  assert.match(noPhone, /<button[^>]*class="ab-act"[^>]*disabled=""[^>]*aria-label="Call \(no phone on file\)"/)
  assert.match(noPhone, /href="https:\/\/www\.linkedin\.com\/in\/example"/)
  const withPhone = await renderBook({ selected: CONTACTS[1], selectedId: 'c2' })
  assert.match(withPhone, /<a class="ab-act" href="tel:\(626\) 555-0142"/)
  assert.doesNotMatch(withPhone, /LinkedIn/)
})

test('a capped linked-student list says so instead of counting what it did not fetch', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, first_name: `S${i}`, last_name: 'X', status: 'Active Rotation' }))
  const html = await renderBook({ linkedStudents: twelve, linkedStudentsTotal: 30 })
  assert.match(html, /30 assigned · first 12 shown/)
})

// ── 4. The guarantees in the brief ─────────────────────────────────────────────

function walk(dir) {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel))
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(rel)
  }
  return out
}

test('both layouts read ONE data hook, called once, and the book fetches nothing itself', () => {
  const callers = walk('src').filter(f => /(?<!function )useContactsDirectory\(/.test(strip(read(f))))
  assert.deepEqual(callers, ['src/components/connect/ContactsView.jsx'])
  const view = strip(read('src/components/connect/ContactsView.jsx'))
  assert.equal((view.match(/useContactsDirectory\(/g) || []).length, 1)
  assert.match(view, /<ContactsBook dir=\{dir\} actions=\{actions\} \/>/)
  assert.match(view, /<ClassicContacts dir=\{dir\} actions=\{actions\} \/>/)
  const book = strip(read('src/components/connect/ContactsBook.jsx'))
  assert.doesNotMatch(book, /supabase|\.from\(|fetch\(/, 'the book draws; it does not query')
  // The contacts, notification_log and students queries live in the hook, once each.
  const hook = strip(read('src/components/connect/useContactsDirectory.js'))
  assert.equal((hook.match(/\.from\('notification_log'\)/g) || []).length, 1)
  assert.equal((view.match(/\.from\('contacts'\)\s*\.select\('\*'\)/g) || []).length, 0,
    'Classic no longer carries its own copy of the contacts query')
})

test('Classic is the default and keeps its three columns; the book is its own chunk', () => {
  const view = strip(read('src/components/connect/ContactsView.jsx'))
  assert.match(view, /layout === 'book' \?/)
  assert.match(view, /className="connect-three-zone"/)
  for (const zone of ['c3-contacts', 'c3-profile', 'c3-context']) assert.match(view, new RegExp(zone))
  assert.match(view, /<ContactContext/, 'Recent Communications and Linked Students stay in Classic\'s third column')
  assert.match(view, /lazyReload\(\(\) => import\('\.\/ContactsBook'\), 'ContactsBook'\)/)
  assert.doesNotMatch(view, /import ContactsBook from/, 'a static import would ship the book to everyone')
})

test('the link beside Refresh and Settings flip the same preference through the same hook', () => {
  const connect = strip(read('src/pages/Connect.jsx'))
  assert.match(connect, /activeSubTab === 'contacts' && <ContactsLayoutLink \/>/)
  const link = strip(read('src/components/connect/ContactsLayoutLink.jsx'))
  assert.match(link, /useUserPreference\(CONTACTS_LAYOUT\)/)
  assert.match(link, /'Switch to classic' : 'Try the address book'/)
  const panel = strip(read('src/components/settings/AppearancePanel.jsx'))
  assert.match(panel, /useUserPreference\(CONTACTS_LAYOUT\)/)
  assert.match(panel, /role="radiogroup" aria-labelledby=\{titleId\}/)
  assert.match(panel, /type="radio"/)
  assert.match(panel, />Contacts Layout</)
  assert.match(panel, /label: 'Classic'/)
  assert.match(panel, /label: 'Address Book'/)
  // Nothing else writes the column.
  const writers = walk('src').filter(f => /ui_preferences/.test(strip(read(f))))
  assert.deepEqual(writers, ['src/lib/userPreferences.js'])
})

test('the book\'s sheet reads tokens, and every state rule is paired with :hover', () => {
  const css = read('src/components/connect/contactsBook.css')
  assert.doesNotMatch(css, /border-radius:\s*[0-9.]+px/, 'no literal radii')
  assert.match(css, /@import '\.\.\/\.\.\/styles\/aspireMaterials\.css'/)
  assert.match(css, /\.ab-thumb-tab\[aria-pressed='true'\],\s*\.ab-thumb-tab\[aria-pressed='true'\]:hover/)
  assert.match(css, /\.ab-entry\[aria-current='true'\],\s*\.ab-entry\[aria-current='true'\]:hover/)
  assert.match(css, /\.ab-cat\[aria-pressed='true'\],\s*\.ab-cat\[aria-pressed='true'\]:hover/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  // The narrow query comes after the rules it changes: a media query has no specificity.
  assert.ok(css.indexOf('@media (max-width: 980px)') > css.indexOf('.ab-record-scroll {'))
  const brand = read('src/styles/aspireBrand.css')
  for (const t of ['--aspire-leather-oxblood:', '--aspire-leather-oxblood-lift:', '--aspire-leather-oxblood-deep:',
    '--aspire-gilt:', '--aspire-radius-address-book:', '--aspire-noise-oxblood:']) assert.ok(brand.includes(t), t)
  assert.match(read('src/styles/aspireMaterials.css'), /\.material-leather-oxblood \{/)
})

test('the SQL adds one column, one check and one column grant, and nothing else', () => {
  const sql = read('supabase/migrations/20260924000000_user_ui_preferences.sql')
  const code = sql.replace(/--.*$/gm, '')
  assert.match(code, /ADD COLUMN IF NOT EXISTS ui_preferences jsonb NOT NULL DEFAULT '\{\}'::jsonb/)
  assert.match(code, /CHECK \(jsonb_typeof\(ui_preferences\) = 'object'/)
  assert.deepEqual(code.match(/GRANT[^;]+;/g), ['GRANT UPDATE (ui_preferences) ON public.user_profiles TO authenticated;'])
  assert.doesNotMatch(code, /CREATE TABLE|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|anon|DROP /i)
  const checks = read('db/audit/user_ui_preferences_checks.sql')
  for (const s of ['PRE 1', 'PRE 2', 'POST 1', 'POST 2', 'POST 3', 'POST 4', 'POST 5']) assert.ok(checks.includes(s), s)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /\| 20260924000000_user_ui_preferences\.sql \|[^\n]*NOT APPLIED/)
})
