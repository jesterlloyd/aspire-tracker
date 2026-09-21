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
  nearestLetter,
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

test('a drag over an empty letter lands on the nearest letter that has entries', () => {
  const present = new Set(['C', 'H', 'M', '#'])
  assert.equal(nearestLetter('H', present), 'H')
  assert.equal(nearestLetter('D', present), 'H', 'forward first')
  assert.equal(nearestLetter('N', present), '#', 'past Z is the # section')
  assert.equal(nearestLetter('A', new Set(['C'])), 'C')
  assert.equal(nearestLetter('Z', new Set(['C', 'M'])), 'M', 'then backward')
  assert.equal(nearestLetter('M', new Set()), null)
  assert.equal(nearestLetter(null, present), null)
})

test('an entry reads Role · where, and the count line drops its tail under All Contacts', () => {
  assert.equal(entryLine({ role: 'Unit Leader', unit_name: '6 NW', category: 'Unit Leader', organization: 'Cedars-Sinai' }), 'Unit Leader · 6 NW')
  assert.equal(entryLine({ role: '', organization: 'Azusa Pacific University' }), 'Azusa Pacific University')
  // CONTACTS-BOOK-3: the Owner's mockup form, "42 of 231".
  assert.equal(bookCountLine({ shown: 42, inCategory: 231 }), '42 of 231')
  assert.equal(bookCountLine({ shown: 0, inCategory: 12 }), '0 of 12')
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
const ACTIONS = { navigate() {}, toast: {}, onAdd() {}, onEdit() {}, onDeactivate() {} }

async function renderBook(dirOverrides, actions = ACTIONS) {
  const { default: ContactsBook } = await vite.ssrLoadModule('/src/components/connect/ContactsBook.jsx')
  try {
    return renderToStaticMarkup(React.createElement(ContactsBook, { dir: dirFor(dirOverrides), actions }))
  } catch (err) {
    assert.fail(`ContactsBook threw while rendering: ${err.constructor.name}: ${err.message}`)
  }
}

test('the book renders: an A-Z thumb index of real buttons that jump, empty letters disabled', async () => {
  const html = await renderBook()
  const tabs = html.match(/<button[^>]*class="ab-thumb-tab"[^>]*>/g) || []
  assert.equal(tabs.length, 26)
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.match(html, new RegExp(`aria-label="Jump to ${L}"`))
  // Present: H (Hunter), L (Lopez-Silva), M (Mittelberg). Everything else is disabled.
  const disabled = tabs.filter(t => / disabled=""/.test(t)).length
  assert.equal(disabled, 23)
  // CONTACTS-BOOK-2: a letter is a jump, not a filter, so it has no pressed state.
  assert.ok(tabs.every(t => !/aria-pressed/.test(t)), 'a jump is not a toggle')
  assert.ok(tabs.every(t => /data-letter="[A-Z]"/.test(t)))
  // Every letter header in the list is a jump target, and the bubble is decoration.
  assert.deepEqual((html.match(/class="ab-sep" data-letter="([A-Z#])"/g) || []).map(m => m.slice(-2, -1)), ['H', 'L', 'M'])
  assert.match(html, /<div class="ab-bubble" aria-hidden="true">/)
})

test('the letter index never filters: every contact in the category stays in the list', async () => {
  const html = await renderBook()
  for (const name of ['Susan Hunter', 'Ana Lopez-Silva', 'Gary Mittelberg']) assert.match(html, new RegExp(name))
  const src = strip(read('src/components/connect/ContactsBook.jsx'))
  assert.doesNotMatch(src, /setLetter|\.filter\(c => contactLetter/, 'no letter filter survives')
  assert.match(src, /box\.scrollTop = header\.offsetTop/, 'a jump scrolls the list to the letter header')
  assert.match(src, /setPointerCapture/, 'a drag keeps the column')
})

test('the list files by last name, the open entry carries aria-current, and the count line reads plainly', async () => {
  const html = await renderBook()
  const order = ['Hunter', 'Lopez-Silva', 'Mittelberg'].map(n => html.indexOf(`${n}</span>`))
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'H, then L, then M')
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1)
  assert.match(html, /<button[^>]*class="ab-entry"[^>]*aria-current="true"[^>]*>(?:(?!<\/button>)[\s\S])*Gary Mittelberg/)
  assert.match(html, />3 of 3</)
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

test('on the Address book the page scrolls, the picker pins, and the book gets the rest of the window', () => {
  const connect = strip(read('src/pages/Connect.jsx'))
  assert.match(connect, /const bookPage = activeSubTab === 'contacts' && contactsLayout === 'book'/)
  assert.match(connect, /useChartViewport\(\)/, 'the student chart\'s measurement, not a second copy')
  assert.match(connect, /ref=\{pickerRef\}/)
  assert.match(connect, /position: 'sticky', top: chromeHeight/)
  assert.match(connect, /'--connect-book-h': bookPage && bookHeight/)
  // Classic and every other tab keep the fixed page.
  assert.match(connect, /height: 'calc\(100dvh - 128px\)'/)
})

test('Repair Preceptor Contacts is gone from both layouts, and its modal with it', () => {
  const hits = walk('src').filter(f => /Repair Preceptor Contacts|SyncPreceptorsModal|onRepair/.test(strip(read(f))))
  assert.deepEqual(hits, [])
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
  assert.match(css, /\.ab-thumb-tab\[data-active='true'\],\s*\.ab-thumb-tab\[data-active='true'\]:hover/)
  assert.match(css, /\.ab-thumb \{[^}]*touch-action: none/, 'a finger on the index scrubs, never scrolls the page')
  assert.match(css, /\.ab-thumb-tab:disabled,[^{]*\{[^}]*pointer-events: none/, 'a drag passes over an empty letter')
  assert.match(css, /\.ab-shell \{[^}]*height: var\(--connect-book-h, 100%\)/)
  assert.match(css, /\.ab-bubble \{[^}]*pointer-events: none/)
  assert.match(css, /\.ab-entry\[aria-current='true'\],\s*\.ab-entry\[aria-current='true'\]:hover/)
  assert.match(css, /\.ab-cat\[aria-pressed='true'\],\s*\.ab-cat\[aria-pressed='true'\]:hover/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  // The narrow query comes after the rules it changes: a media query has no specificity.
  assert.ok(css.indexOf('@media (max-width: 980px)') > css.indexOf('.ab-record-scroll {'))
  const brand = read('src/styles/aspireBrand.css')
  for (const t of ['--aspire-leather-cognac:', '--aspire-leather-cognac-lift:', '--aspire-leather-cognac-deep:',
    '--aspire-gilt-hairline:', '--aspire-radius-book:', '--aspire-book-board:', '--aspire-book-board-x:',
    '--aspire-book-stack-w:', '--aspire-noise-cognac:']) assert.ok(brand.includes(t), t)
  assert.match(read('src/styles/aspireMaterials.css'), /\.material-leather-cognac \{/)
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
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /\| 20260924000000_user_ui_preferences\.sql \|[^\n]*APPLIED[^\n]*user_ui_preferences_checks\.sql/)
})

// ── 5. CONTACTS-BOOK-3: the Owner's refinements ────────────────────────────────

const { contactMatches, countCategories } = await import('../src/lib/connect/contactsDirectoryFilter.js')
const { isContactFlagged, contactFlagAvailable, setContactFollowUpFlag } = await import('../src/lib/contactFollowUpFlag.js')
const { isContactStatusUpdate, applyContactStatusUpdate } = await import('../api/lib/contactStatusUpdate.js')

const FLAGGABLE = CONTACTS.map((c, i) => ({ ...c, flagged_for_followup: i === 1 }))
const WITH_INACTIVE = [...FLAGGABLE, C('c4', 'Priya Natarajan', { category: 'Preceptor', unit_name: '7 West', is_active: false, flagged_for_followup: false })]
const FLAG_ACTIONS = { ...ACTIONS, onFlag() {} }

test('the address book lists inactive contacts, marked, and has no Show inactive toggle', async () => {
  const html = await renderBook({ contacts: WITH_INACTIVE }, FLAG_ACTIONS)
  assert.match(html, /Priya Natarajan<span class="ab-quiet"> · inactive<\/span>/)
  assert.doesNotMatch(html, /Show inactive/)
  assert.match(html, />4 of 4</, 'the inactive contact counts too')
  // Classic still hides them behind its toggle: the shared filter takes the rule as an argument.
  const inactive = WITH_INACTIVE[3]
  assert.equal(contactMatches(inactive, { search: '', categoryFilter: 'All', showInactive: false }), false)
  assert.equal(contactMatches(inactive, { search: '', categoryFilter: 'All', showInactive: true }), true)
  assert.equal(countCategories(WITH_INACTIVE, { showInactive: false }).Preceptor, 1)
  assert.equal(countCategories(WITH_INACTIVE, { showInactive: true }).Preceptor, 2)
})

test('the list header is search and Add contact, the categories, then the count with its two tools', async () => {
  const html = await renderBook({ contacts: FLAGGABLE }, FLAG_ACTIONS)
  const at = (needle) => { const i = html.indexOf(needle); assert.ok(i > 0, needle); return i }
  const order = [at('class="ab-search"'), at('+ Add contact'), at('class="ab-cats"'), at('class="ab-count"'), at('Flagged only'), at('Copy visible emails')]
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  assert.match(html, /<h2 class="sr-only">Contacts<\/h2>/, 'the page keeps a heading for a screen reader')
  assert.doesNotMatch(html, /class="ab-title"/)
})

test('the canonical ribbon flags a contact: enabled once the column exists, a mark on the entry, a filter', async () => {
  const off = await renderBook({ contacts: FLAGGABLE, selected: FLAGGABLE[0], selectedId: 'c1' }, FLAG_ACTIONS)
  assert.match(off, /<button[^>]*data-testid="flag-ribbon"[^>]*class="ab-ribbon"[^>]*aria-pressed="false"/)
  assert.doesNotMatch(off, /data-testid="flag-ribbon"[^>]*disabled=""/)
  assert.match(off, /Not flagged\. Pull the ribbon down to flag for follow-up\./)
  assert.match(off, /class="ab-flagfilter" aria-pressed="false"/)
  // Susan Hunter is flagged: her entry carries the mark and says so in words.
  assert.match(off, /Susan Hunter[\s\S]*?<span class="ab-flagmark" aria-hidden="true"><\/span><span class="sr-only">, flagged for follow-up<\/span>/)
  const on = await renderBook({ contacts: FLAGGABLE, selected: FLAGGABLE[1], selectedId: 'c2' }, FLAG_ACTIONS)
  assert.match(on, /class="ab-ribbon ab-ribbon-on"[^>]*aria-pressed="true"/)
  assert.match(on, /<b>Flagged for follow-up\.<\/b> Pull the ribbon up to clear\./)
})

test('before the column exists the ribbon is inert and says so, and there is no filter to offer', async () => {
  const html = await renderBook({}, FLAG_ACTIONS)
  assert.match(html, /<button[^>]*data-testid="flag-ribbon"[^>]*disabled=""/)
  assert.match(html, /Follow-up flags are not enabled yet\./)
  assert.doesNotMatch(html, /Flagged only/)
  assert.equal(contactFlagAvailable(CONTACTS[0]), false)
  assert.equal(contactFlagAvailable(FLAGGABLE[0]), true)
  assert.equal(isContactFlagged(FLAGGABLE[1]), true)
  assert.equal(isContactFlagged({}), false)
})

test('the flag is the address book\'s alone: Classic renders no ribbon', () => {
  const view = strip(read('src/components/connect/ContactsView.jsx'))
  const classic = view.slice(view.indexOf('function ClassicContacts('), view.indexOf('const ContactsBook = lazyReload'))
  assert.ok(classic.length > 1000)
  assert.doesNotMatch(classic, /FlagRibbon|flagged_for_followup/)
  assert.doesNotMatch(strip(read('src/components/connect/ContactsBook.jsx')), /supabase|fetch\(/, 'the book still draws and does not fetch')
})

test('the book\'s ribbon is the Student Chart\'s ribbon, value for value, except where it hangs', () => {
  const block = (css, sel) => {
    const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, sel)
    return css.slice(i, css.indexOf('\n}', i)).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').slice(1).map(l => l.trim())
      .filter(l => l && !/^(position|top|right|left|z-index):/.test(l))
  }
  const chart = read('src/components/student/studentChart.css')
  const book = read('src/components/connect/contactsBook.css')
  const decl = (lines) => lines
  assert.deepEqual(decl(block(book, '.ab-ribbon')), decl(block(chart, '.sc-ribbon')))
  assert.deepEqual(decl(block(book, '.ab-ribbon[aria-pressed="false"]')), decl(block(chart, '.sc-ribbon[aria-pressed="false"]')))
})

test('a status update (Deactivate, Reactivate, the flag) skips the record validation that refused it', async () => {
  assert.equal(isContactStatusUpdate({ id: 'x', is_active: false }), true)
  assert.equal(isContactStatusUpdate({ id: 'x', flagged_for_followup: true }), true)
  assert.equal(isContactStatusUpdate({ id: 'x', is_active: true, full_name: 'A' }), false, 'a record edit is not a status update')
  assert.equal(isContactStatusUpdate({ is_active: false }), false, 'an insert is never a status update')
  assert.equal(isContactStatusUpdate({ id: 'x' }), false)
  // The handler routes to it BEFORE the full_name check that refused every Deactivate.
  const api = read('api/contacts-upsert.js')
  assert.ok(api.indexOf('isContactStatusUpdate(body)') > 0)
  assert.ok(api.indexOf('isContactStatusUpdate(body)') < api.indexOf('// 7. Validate full_name'))
  // The guard itself, exactly: a status update on an existing row goes to the status path
  // and returns what it says, with nothing standing in front of it.
  assert.match(api, /\n  if \(isUpdate && isContactStatusUpdate\(body\)\) \{\n    const result = await applyContactStatusUpdate\(supabaseAdmin, body\);[\s\S]{0,200}?return res\.status\(result\.status\)\.json\(result\.body\);/)
  const db = (result) => {
    const calls = []
    return { calls, from(t) { assert.equal(t, 'contacts'); return { update(patch) { calls.push(patch); return { eq() { return { select() { return { maybeSingle: async () => result } } } } } } } } }
  }
  let d = db({ data: { id: 'x', is_active: false }, error: null })
  assert.deepEqual(await applyContactStatusUpdate(d, { id: 'x', is_active: false }), { status: 200, body: { contact: { id: 'x', is_active: false } } })
  assert.deepEqual(d.calls, [{ is_active: false }], 'writes only the status it was given')
  assert.equal((await applyContactStatusUpdate(db({ data: null, error: null }), { id: 'x', is_active: 'no' })).status, 400)
  for (const code of ['42703', 'PGRST204']) {
    const r = await applyContactStatusUpdate(db({ data: null, error: { code } }), { id: 'x', flagged_for_followup: true })
    assert.equal(r.status, 409); assert.equal(r.body.error, 'not_enabled')
  }
  assert.equal((await applyContactStatusUpdate(db({ data: null, error: { code: '42703' } }), { id: 'x', is_active: true })).status, 500,
    'only the flag has a column that may not exist yet')
  assert.equal((await applyContactStatusUpdate(db({ data: null, error: null }), { id: 'x', is_active: true })).status, 400)
})

test('the flag writer turns not_enabled into a result, and every other failure into an error', async () => {
  const fake = (status, body) => async (url, init) => {
    assert.equal(url, '/api/contacts-upsert')
    assert.deepEqual(JSON.parse(init.body), { id: 'c1', flagged_for_followup: true })
    assert.equal(init.headers.Authorization, 'Bearer tok')
    return { status, ok: status < 300, json: async () => body }
  }
  assert.deepEqual(await setContactFollowUpFlag('c1', true, { accessToken: 'tok', fetchImpl: fake(200, { contact: { id: 'c1' } }) }), { ok: true, contact: { id: 'c1' } })
  const ne = await setContactFollowUpFlag('c1', true, { accessToken: 'tok', fetchImpl: fake(409, { error: 'not_enabled', message: 'm' }) })
  assert.equal(ne.notEnabled, true)
  await assert.rejects(() => setContactFollowUpFlag('c1', true, { accessToken: 'tok', fetchImpl: fake(403, { error: 'Forbidden' }) }), /Forbidden/)
  await assert.rejects(() => setContactFollowUpFlag('c1', true, { fetchImpl: fake(200, {}) }), /Session expired/)
})

test('the plate wears Student Profiles\' icons and the LinkedIn wordmark', async () => {
  const src = strip(read('src/components/connect/ContactsBook.jsx'))
  for (const icon of ['Mail', 'Phone', 'Pencil']) assert.match(src, new RegExp(`<${icon} size=\\{15\\} aria-hidden="true" />`))
  const profile = read('src/components/StudentSidePanel.jsx')
  for (const icon of ['Mail', 'Phone', 'Pencil']) assert.match(profile, new RegExp(`<${icon} size=\\{15\\}`), `Student Profiles no longer uses ${icon} at 15`)
  const html = await renderBook()
  assert.match(html, /<img src="\/linkedin-logo\.svg" alt="LinkedIn" height="17"\/>/)
  assert.doesNotMatch(html, />in<\/span> LinkedIn/, 'the letters "in" are not the LinkedIn logo')
})

test('hover lifts a letter on paper and a shadow; only a press, a drag or a key shows the bubble', () => {
  const css = read('src/components/connect/contactsBook.css')
  const hover = css.slice(css.indexOf('.ab-thumb-tab:hover {'), css.indexOf('}', css.indexOf('.ab-thumb-tab:hover {')))
  assert.match(hover, /background: var\(--ab-page\)/)
  assert.match(hover, /box-shadow:/)
  assert.doesNotMatch(hover, /--ab-fill/, 'hover must never go dark')
  const src = strip(read('src/components/connect/ContactsBook.jsx'))
  assert.match(src, /onPointerMove=\{e => \{ if \(dragging\.current\) point\(letterAt\(e\.clientY\)\) \}\}/, 'a move without a press does nothing')
  assert.doesNotMatch(src, /onPointerLeave|pointerType === 'mouse'\) point/, 'no hover preview survives')
})

test('the stack either side of the pages is the rubric\'s own fore edge, and the gilt strips are gone', () => {
  const css = read('src/components/connect/contactsBook.css')
  assert.match(strip(read('src/components/connect/ContactsBook.jsx')), /className="ab-book material-leather-cognac material-forestack"/)
  assert.match(css, /\.ab-book\.material-forestack \{[\s\S]*?--fore-w: var\(--ab-stack-w\);/)
  assert.match(css, /\.ab-spread \{[\s\S]*?z-index: 1;/, 'the right-hand block would draw over the pages')
  assert.doesNotMatch(css, /\.ab-page-left::after|\.ab-page-right::after/)
  assert.doesNotMatch(css, /\.ab-book::before/, 'the cover\'s pseudo-elements belong to the stack')
  // The gilt rule is the shared cover's own element (BOOK-COVER-1), not a copy here.
  assert.match(strip(read('src/components/connect/ContactsBook.jsx')), /<span className="material-cover-tooling" aria-hidden="true" \/>/)
  assert.doesNotMatch(css, /\.ab-tooling/)
  // Owner, 2026-09-21: the rubric's stack, not a tinted copy of it. The book sets only
  // where the block sits and how thick it is; the page edges themselves are pageStack.css.
  assert.doesNotMatch(css, /\.material-forestack::(before|after)|--ab-fore-/, 'the book is repainting the stack')
  assert.match(read('src/components/rubric/rubricBook.css'), /--rb-stack-w: var\(--aspire-book-stack-w\);/)
  assert.match(css, /--ab-stack-w: var\(--aspire-book-stack-w\);/, 'the same thickness as the rubric')
})

test('the rubric is bound in the same cognac, and both darken together', () => {
  // BOOK-COVER-1 (Owner, 2026-09-21): the same leather class, not a second grain of it.
  assert.match(read('src/components/RubricSession.jsx'), /className="rb-cover material-leather-cognac material-forestack"/)
  const materials = read('src/styles/aspireMaterials.css')
  assert.ok(!materials.includes('cognac-hide'), 'the rubric has its own grain again')
  const block = materials.slice(materials.indexOf('.material-leather-cognac {'), materials.indexOf('\n}', materials.indexOf('.material-leather-cognac {')))
  assert.match(block, /background-color: var\(--aspire-leather-cognac\)/)
  assert.match(materials, /:root\[data-theme='dark'\] \{[\s\S]*?--aspire-leather-cognac: #442C18;/)
  // The spine is a translucent crease both books share (BOOK-COVER-2), so it darkens with
  // the cognac under it rather than keeping dark values of its own.
  assert.match(read('src/components/rubric/rubricBook.css'), /\.rb-spine \{/)
  assert.match(strip(read('src/components/connect/ContactsBook.jsx')), /className="ab-spine material-book-spine"/)
  assert.doesNotMatch(read('src/components/connect/contactsBook.css'), /--aspire-leather-cognac(-lift|-deep)?:/, 'the book does not keep its own copy of the leather')
})

test('the flag migration adds one column and nothing else', () => {
  const code = read('supabase/migrations/20260925000000_contact_followup_flag.sql').replace(/--.*$/gm, '')
  assert.match(code, /ADD COLUMN IF NOT EXISTS flagged_for_followup boolean NOT NULL DEFAULT false/)
  assert.doesNotMatch(code, /CREATE TABLE|CREATE POLICY|GRANT|CREATE (OR REPLACE )?FUNCTION|DROP /i)
  const checks = read('db/audit/contact_followup_flag_checks.sql').split(/^-- ── /m).slice(1)
  assert.equal(checks.length, 4)
  for (const section of checks) assert.equal((section.replace(/--.*$/gm, '').match(/;/g) || []).length, 1, 'one query per section')
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /\| 20260925000000_contact_followup_flag\.sql \|[^\n]*APPLIED[^\n]*contact_followup_flag_checks\.sql/)
})

test('the pages are square: a page with a rounded corner reads as a card (Owner, 2026-09-21)', () => {
  const css = read('src/components/connect/contactsBook.css')
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/\.ab-(page|page-left|page-right|spread)\b/.test(m[1])) {
      assert.doesNotMatch(m[2], /border-radius/, `${m[1].trim()} rounds a page corner`)
    }
  }
  assert.ok(!css.includes('--aspire-radius-sheet'), 'the paper is reading the sheet corner again')
})
