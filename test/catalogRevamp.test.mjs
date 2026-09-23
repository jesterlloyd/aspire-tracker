// test/catalogRevamp.test.mjs
//
// CATALOG-REVAMP-1 (Phase 1). What this pins:
//   1. the model (src/lib/catalog/catalogModel.js): counts, filters, sort, sections,
//      recipients, personal-file matching. Behaviour, not source text.
//   2. the send log writer against a substituted database.
//   3. the contracts a later edit could quietly break: Send goes through Outreach and
//      never Messages; the tiles and side panels are gone; unbuilt kinds have no entry
//      point; the stylesheet keeps the canon; the migration stays additive.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  AUDIENCES, audienceOf, kindOf, fileBadge, CATALOG_FEATURES, completionStatus, completionStats, progressLabel,
  catalogSummary, railCounts, filterItems, sortItems, listSections, shelfOrder, shelfRows, viewTitle,
  expandTokens, suggestTokens, defaultTokens, searchPeople, chunkRecipients, personalFileMatches,
  toOutreachMerge, messageForSend, defaultMessage, sendAsFor, fmtShortDate, fmtBytes,
} from '../src/lib/catalog/catalogModel.js'
import { recordCatalogSend, isCatalogResourceId } from '../api/lib/catalogSendLog.js'
import { cleanAudience } from '../api/lib/catalogCategories.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const row = (o) => ({ id: o.id, slug: o.id, title: o.title || o.id, description: o.description || '', category: o.category || 'orientation',
  resource_type: 'internal_file', file_type_label: 'PDF', audience: [], is_active: true, is_pinned: false,
  updated_at: '2026-09-01T12:00:00Z', ...o })

// ── 1. The model ───────────────────────────────────────────────────────────────────

test('audience is one of five values and reads Everyone when unset or unknown', () => {
  assert.deepEqual(AUDIENCES.map(a => a.label), ['Everyone', 'Students', 'Preceptors', 'Schools', 'Staff only'])
  assert.equal(audienceOf({ audience: ['staff'] }), 'staff')
  assert.equal(audienceOf({ audience: [] }), 'everyone')
  assert.equal(audienceOf({ audience: ['faculty'] }), 'everyone')
  assert.equal(audienceOf({}), 'everyone')
  assert.deepEqual(cleanAudience('schools'), ['schools'])
  assert.deepEqual(cleanAudience(['students']), ['students'])
  assert.deepEqual(cleanAudience(null), [])
  assert.equal(cleanAudience(['students', 'staff']), null)
  assert.equal(cleanAudience('everybody'), null)
})

test('a row from before the migration is a file; badges name the real format', () => {
  assert.equal(kindOf({}), 'file')
  assert.equal(kindOf({ kind: 'form' }), 'form')
  assert.equal(fileBadge({ file_type_label: 'DOC' }).label, 'DOCX')
  assert.equal(fileBadge({ file_type_label: 'XLS' }).tone, 'xls')
  assert.equal(fileBadge({ resource_type: 'external_link' }).label, 'LINK')
})

test('forms ship in Phase 2 and signatures stay behind a flag that is off', () => {
  assert.equal(CATALOG_FEATURES.forms, false)
  assert.equal(CATALOG_FEATURES.signatures, false)
})

test('overdue is computed from the due date, never stored', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  assert.equal(completionStatus({ due_at: '2026-09-20', opened_at: '2026-09-19' }, now), 'overdue')
  assert.equal(completionStatus({ due_at: '2026-09-30', opened_at: '2026-09-19' }, now), 'opened')
  assert.equal(completionStatus({ due_at: '2026-09-20', completed_at: '2026-09-21' }, now), 'done')
  assert.equal(completionStatus({ status: 'overdue' }, now), 'not_opened', 'a stored "overdue" means nothing')
  const s = completionStats([{ completed_at: 'x' }, { due_at: '2026-09-01' }, { opened_at: 'x', due_at: '2026-10-01' }, {}], now)
  assert.deepEqual(s, { total: 4, done: 1, overdue: 1, opened: 1, not_opened: 1 })
  assert.equal(progressLabel('signature', s), '1 signed, 1 overdue, 1 opened, 1 not opened')
})

test('the summary and the left list count active items only; Phase 1 tracks nothing', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b', category: 'policies' }), row({ id: 'c', is_active: false })]
  const active = rows.filter(r => r.is_active !== false)
  assert.deepEqual(catalogSummary(active), { items: 2, out: 0, overduePeople: 0 })
  const c = railCounts(active, {}, [{ key: 'orientation' }, { key: 'policies' }, { key: 'school_documents' }])
  assert.equal(c.byKind.all, 2)
  assert.equal(c.byKind.file, 2)
  assert.equal(c.byCategory.school_documents, 0)
  assert.equal(c.byCategory.policies, 1)
})

test('a form counts as out until everyone is done, and its overdue people add up', () => {
  const rows = [row({ id: 'f1', kind: 'form' }), row({ id: 'f2', kind: 'form' }), row({ id: 'x' })]
  const stats = { f1: { total: 5, done: 3, overdue: 2, opened: 0, not_opened: 0 }, f2: { total: 2, done: 2, overdue: 0, opened: 0, not_opened: 0 } }
  assert.deepEqual(catalogSummary(rows, stats), { items: 3, out: 1, overduePeople: 2 })
  assert.deepEqual(filterItems(rows, { view: { track: 'overdue' }, statsById: stats }).map(r => r.id), ['f1'])
  assert.deepEqual(filterItems(rows, { view: { track: 'out' }, statsById: stats }).map(r => r.id), ['f1'])
})

test('search matches title, description and category; removed rows need Show removed', () => {
  const rows = [row({ id: 'map', title: 'CSMC Campus Map' }), row({ id: 'g', title: 'Guidelines', description: 'dress code' }),
    row({ id: 'u', title: 'Unit Brochure', category: 'unit_guides' }), row({ id: 'old', title: 'Old Map', is_active: false })]
  const catLabel = (s) => ({ unit_guides: 'Unit Guides' }[s] || s)
  assert.deepEqual(filterItems(rows, { q: 'map' }).map(r => r.id), ['map'])
  assert.deepEqual(filterItems(rows, { q: 'map', showRemoved: true }).map(r => r.id), ['map', 'old'])
  assert.deepEqual(filterItems(rows, { q: 'DRESS' }).map(r => r.id), ['g'])
  assert.deepEqual(filterItems(rows, { q: 'unit guides', catLabel }).map(r => r.id), ['u'])
  assert.deepEqual(filterItems(rows, { view: { category: 'unit_guides' } }).map(r => r.id), ['u'])
})

test('sort: recently updated by default, most used from the send log, A to Z', () => {
  const rows = [row({ id: 'b', title: 'Beta', updated_at: '2026-09-01' }), row({ id: 'a', title: 'Alpha', updated_at: '2026-09-10' }), row({ id: 'c', title: 'Gamma', updated_at: '2026-08-01' })]
  assert.deepEqual(sortItems(rows).map(r => r.id), ['a', 'b', 'c'])
  assert.deepEqual(sortItems(rows, 'az').map(r => r.id), ['a', 'b', 'c'])
  assert.deepEqual(sortItems(rows, 'used', { c: 5, b: 1 }).map(r => r.id), ['c', 'b', 'a'])
})

test('Pinned leads only when no filter is on; the bookcase stands pinned covers first', () => {
  const rows = [row({ id: 'a' }), row({ id: 'p', is_pinned: true }), row({ id: 'b' })]
  assert.deepEqual(listSections(rows).map(s => [s.label, s.rows.map(r => r.id)]), [['Pinned', ['p']], ['Everything else', ['a', 'b']]])
  assert.deepEqual(listSections(rows, { q: 'x' }).map(s => s.label), [null])
  assert.deepEqual(listSections(rows, { view: { category: 'policies' } }).map(s => s.label), [null])
  assert.deepEqual(listSections([row({ id: 'a' })]).map(s => s.label), [null], 'no empty Pinned section')
  assert.deepEqual(shelfOrder(rows).map(r => r.id), ['p', 'a', 'b'])
  assert.equal(shelfRows(2, 5), 3, 'empty shelves show below the covers')
  assert.equal(shelfRows(16, 5), 4)
  assert.equal(viewTitle({ type: 'file' }), 'Files')
  assert.equal(viewTitle({ track: 'overdue' }), 'Items with overdue people')
})

// ── Recipients ──

const ctx = {
  cohortName: 'Fall 2026',
  students: [
    { id: 's1', first_name: 'Ava', last_name: 'Nguyen', school_email: 'ava@school.edu', school: 'UCLA', status: 'Placed' },
    { id: 's2', first_name: 'Diego', preferred_first_name: 'Dee', last_name: 'Ramos', school_email: '', personal_email: 'dee@mail.com', status: 'Placed' },
    { id: 's3', first_name: 'Priya', last_name: 'Shah', school_email: 'priya@school.edu', status: 'Not Proceeding' },
    { id: 's4', first_name: 'Jo', last_name: 'Lee', status: 'Placed' },
  ],
  units: [{ id: 'u1', unit_name: '4 South' }, { id: 'u2', unit_name: '5 North' }],
  matches: [{ student_id: 's1', unit_id: 'u1' }, { student_id: 's3', unit_id: 'u1' }],
  contacts: [
    { id: 'c1', full_name: 'Elena Ruiz', email: 'eruiz@pcu.edu', category: 'Academic Partner', school_name: 'UCLA', is_active: true },
    { id: 'c2', full_name: 'Mark Tanaka', email: 'mt@wcn.edu', category: 'Academic Partners', school_name: 'Cal State LA', is_active: true },
    { id: 'c3', full_name: 'Gone Person', email: 'gone@x.edu', category: 'Academic Partner', school_name: 'UCLA', is_active: false },
    { id: 'c4', full_name: 'Pat Preceptor', email: 'pat@cshs.org', category: 'Preceptor', is_active: true },
    { id: 'c5', full_name: 'Ava Nguyen', email: 'AVA@school.edu', category: 'Other', is_active: true },
  ],
}

test('a cohort token reaches every student with an email, never a Not Proceeding one', () => {
  const people = expandTokens([{ type: 'cohort' }], ctx)
  assert.deepEqual(people.map(p => p.studentId), ['s1', 's2'])
  const dee = people.find(p => p.studentId === 's2')
  assert.equal(dee.emailType, 'personal')
  assert.equal(dee.firstName, 'Dee', 'the preferred first name greets')
  assert.equal(dee.name, 'Dee Ramos')
})

test('a unit token follows placements; partner tokens follow Connect, active contacts only', () => {
  assert.deepEqual(expandTokens([{ type: 'unit', unitId: 'u1' }], ctx).map(p => p.studentId), ['s1'])
  assert.deepEqual(expandTokens([{ type: 'partners' }], ctx).map(p => p.contactId), ['c1', 'c2'])
  assert.deepEqual(expandTokens([{ type: 'school', school: 'UCLA' }], ctx).map(p => p.contactId), ['c1'])
  assert.deepEqual(expandTokens([{ type: 'category', category: 'Preceptor' }], ctx).map(p => p.contactId), ['c4'])
})

test('recipients are deduplicated by email, first occurrence wins (the Outreach server rule)', () => {
  const people = expandTokens([{ type: 'cohort' }, { type: 'contact', id: 'c5' }], ctx)
  assert.equal(people.filter(p => p.email.toLowerCase() === 'ava@school.edu').length, 1)
  assert.equal(people[0].source, 'student')
})

test('default recipients: partner schools for a school item, the current cohort otherwise', () => {
  assert.deepEqual(defaultTokens(row({ id: 'x', audience: ['schools'] }), ctx).map(t => t.type), ['partners'])
  const cohort = defaultTokens(row({ id: 'y', audience: ['students'] }), ctx)
  assert.equal(cohort[0].label, 'Fall 2026 cohort')
  assert.equal(cohort[0].count, 2)
  const sugg = suggestTokens(row({ id: 'y', audience: ['students'] }), ctx)
  assert.ok(sugg.some(t => t.label === '4 South students' && t.count === 1))
  assert.ok(!sugg.some(t => t.label === '5 North students'), 'a suggestion that reaches no one is not offered')
  assert.equal(searchPeople('ruiz', ctx)[0].id, 'c1')
  assert.deepEqual(searchPeople('a', ctx), [], 'two characters before searching')
})

test('a large send goes in batches of at most 75', () => {
  const list = Array.from({ length: 160 }, (_, i) => i)
  assert.deepEqual(chunkRecipients(list).map(c => c.length), [75, 75, 10])
})

test('the message: {first name} becomes Outreach\'s token; a link rides at the end', () => {
  assert.equal(toOutreachMerge('Hi {first name}, and { First Name }'), 'Hi [First Name], and [First Name]')
  const link = row({ id: 'l', resource_type: 'external_link', external_url: 'https://example.org/x' })
  assert.match(messageForSend(link, 'Hi {first name},'), /\[First Name\],\n\nhttps:\/\/example\.org\/x$/)
  assert.equal(messageForSend(row({ id: 'f' }), 'Hi'), 'Hi')
  assert.match(defaultMessage(row({ id: 'f', title: 'ASPIRE Brochure' })), /attached the ASPIRE Brochure/)
  assert.equal(sendAsFor(row({ id: 'f' })).title, 'Attachment')
  assert.equal(sendAsFor(link).title, 'Link')
})

test('personal files: first and last name both in the name, or no match', () => {
  const students = [
    { id: 'r', first_name: 'Reena', last_name: 'Witkin' },
    { id: 'm', first_name: 'Maya', last_name: 'Chen' },
    { id: 'p', first_name: 'Robert', preferred_first_name: 'Bo', last_name: 'Van Dyke' },
  ]
  assert.deepEqual(personalFileMatches({ title: 'Schedule_Witkin_Reena' }, students).map(s => s.id), ['r'])
  assert.deepEqual(personalFileMatches({ title: 'Schedule', storage_path: 'forms/schedule-witkin-reena.pdf' }, students).map(s => s.id), ['r'])
  assert.deepEqual(personalFileMatches({ title: 'Bo Van Dyke availability' }, students).map(s => s.id), ['p'])
  assert.deepEqual(personalFileMatches({ title: 'Chen Family Guide' }, students), [], 'a last name alone is not a match')
  assert.deepEqual(personalFileMatches({ title: 'Unit Brochure (4 South)' }, students), [])
})

test('dates and sizes read the way the mockup writes them', () => {
  assert.equal(fmtShortDate('2026-09-18T12:00:00Z', new Date('2026-09-23')), 'Sep 18')
  assert.equal(fmtShortDate('2025-09-18T12:00:00Z', new Date('2026-09-23')), 'Sep 18, 2025')
  assert.equal(fmtBytes(2.4 * 1024 * 1024), '2.4 MB')
  assert.equal(fmtBytes(96 * 1024), '96 KB')
})

// ── 2. The send log ────────────────────────────────────────────────────────────────

function fakeDb({ missing = false } = {}) {
  const writes = []
  const q = (table) => {
    const state = { table, op: 'select', payload: null }
    const api = {
      select() { return api }, eq() { return api }, in() { return api },
      insert(p) { state.op = 'insert'; state.payload = p; writes.push({ table, payload: p }); return api },
      async maybeSingle() {
        if (table === 'catalog_resources') return missing ? { data: null, error: { code: '42703' } } : { data: { id: RID, version: 3 }, error: null }
        return { data: null, error: null }
      },
      async single() { return { data: { id: 'send-1' }, error: null } },
      then(res) {
        if (state.op === 'insert') return Promise.resolve({ error: null }).then(res)
        if (table === 'students') return Promise.resolve({ data: [{ id: SID, school: 'CSULB' }], error: null }).then(res)
        if (table === 'contacts') return Promise.resolve({ data: [], error: null }).then(res)
        return Promise.resolve({ data: [], error: null }).then(res)
      },
    }
    return api
  }
  return { from: q, writes }
}
const RID = '11111111-1111-4111-8111-111111111111'
const SID = '22222222-2222-4222-8222-222222222222'

test('the log records what happened to each recipient, with the version sent and the operative school', async () => {
  const db = fakeDb()
  const out = await recordCatalogSend({
    db, resourceId: RID, batchId: '33333333-3333-4333-8333-333333333333', subject: 'Brochure',
    audienceLabels: ['Fall 2026 cohort'],
    recipients: [{ source: 'student', studentId: SID, email: 'a@x.edu', name: 'Ava' }, { source: 'manual', email: 'b@x.edu' }],
    sent: [{ index: 0, email: 'a@x.edu', notification_log_id: 'nl-1', resend_message_id: 're-1' }],
    skipped: [{ index: 1, email: 'b@x.edu', reason: 'duplicate' }], failed: [], sentBy: 'u1', isDemo: false,
  })
  assert.equal(out.status, 'logged')
  const send = db.writes.find(w => w.table === 'catalog_sends').payload
  assert.equal(send.resource_version, 3)
  assert.equal(send.sent_count, 1)
  assert.equal(send.skipped_count, 1)
  assert.deepEqual(send.audience_labels, ['Fall 2026 cohort'])
  const rows = db.writes.find(w => w.table === 'catalog_send_recipients').payload
  assert.deepEqual(rows.map(r => [r.status, r.recipient_type, r.school_name]), [['sent', 'student', 'Cal State Long Beach'], ['skipped', 'manual', null]])
  assert.equal(rows[0].resend_message_id, 're-1')
})

test('before the migration the log reports not_enabled and writes nothing', async () => {
  const db = fakeDb({ missing: true })
  const out = await recordCatalogSend({ db, resourceId: RID, batchId: 'b', sent: [], skipped: [], failed: [] })
  assert.equal(out.status, 'error', 'a resource that cannot be found at all is an error')
  assert.equal(db.writes.length, 0)
  assert.equal(isCatalogResourceId('not-a-uuid'), false)
})

// ── 3. Contracts ───────────────────────────────────────────────────────────────────

test('Send goes through Outreach with the file attached by slug, never through Messages', () => {
  const modal = read('src/components/catalog/CatalogSendModal.jsx')
  assert.match(modal, /const SEND_ENDPOINT = '\/api\/connect-send-bulk-message'/)
  assert.match(modal, /attachment_slugs: item\.resource_type === 'internal_file' \? \[item\.slug\] : \[\]/)
  assert.match(modal, /catalog_resource_id: item\.id/)
  assert.match(modal, /buildPayloadRecipients\(chunk\)/)
  assert.doesNotMatch(modal, /messages-staff|\/api\/messages/)
  assert.match(modal, /Goes out through ASPIRE Connect and is logged\./)
  assert.match(modal, /Logged on this item and on each recipient's record\./)
  const bulk = read('api/connect-send-bulk-message.js')
  assert.match(bulk, /if \(isCatalogResourceId\(body\.catalog_resource_id\)\) \{/)
  // The log runs after the batch, never before a provider call.
  assert.ok(bulk.indexOf('recordCatalogSend({') > bulk.indexOf("console.log('[connect-send-bulk-message] batch_complete:'"))
})

test('the tiles and the three side panels are gone; the page reads the model', () => {
  const page = read('src/components/catalog/CatalogPage.jsx')
  for (const gone of ['FilterKPICard', 'Featured Collections', 'Recent Updates', 'Pinned Resources', 'Recently Updated', 'onToggleFeatured']) {
    assert.ok(!page.includes(gone), `${gone} should be gone`)
  }
  assert.match(page, /Find a resource, then send it, collect it or get it signed\./)
  assert.match(page, /className="rr-nav ctl-rail"/)
  assert.match(page, /aria-current=\{isCur\(k, v\) \? 'true' : undefined\}/)
  assert.match(page, /\{CATALOG_FEATURES\.signatures && railRow/)
  assert.match(page, /\{CATALOG_FEATURES\.forms && \(/)
  assert.match(page, /const canManage = isOwner \|\| isAdmin /)
  assert.match(page, /role="option" tabIndex=\{0\} aria-selected=\{r\.id === selectedId\}/)
  assert.match(page, /<button type="button" role="option" aria-selected=\{selected\}/, 'covers are buttons with aria-selected')
})

test('the stylesheet keeps the canon: token radii, Classic as a class, dark by attribute, reduced motion', () => {
  const css = read('src/components/catalog/catalog.css')
  assert.doesNotMatch(css, /border-radius:\s*[0-9.]+px/)
  assert.doesNotMatch(css, /prefers-color-scheme/)
  assert.match(css, /\[data-theme="dark"\] \.ctl \{/)
  assert.match(css, /\.ctl-classic \.ctl-detail-wrap \{ filter: drop-shadow/)
  assert.match(css, /mask: url\("data:image\/svg\+xml/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /\.rr-row-select\.ctl-rail-row \{/, 'a rail override carries one class more than the canon')
  // A url() is a data URI or a reference inside one (url(%23n) is the SVG's own filter).
  assert.doesNotMatch(css, /url\((?!["']?(?:data:|%23))/, 'no image files: every texture is inline SVG')
  const page = read('src/components/catalog/CatalogPage.jsx')
  assert.match(page, /const classic = style !== 'modern'/)
})

test('the Catalog is a Style surface whose Modern is built', () => {
  const ap = read('src/lib/appearance.js')
  assert.match(ap, /\{ key: 'catalog', label: 'ASPIRE Catalog', material: 'Bookcase', modern: true \}/)
})

test('categories come from the table, less retired ones, in every Catalog writer', () => {
  for (const f of ['api/catalog-resource-upload.js', 'api/catalog-resource-update.js']) {
    const s = read(f)
    assert.doesNotMatch(s, /'forms', 'clinical_resources'/, `${f} still hardcodes the old category list`)
    assert.match(s, /assignableCategorySlugs\(supabaseAdmin\)/)
  }
})

test('a personal file moves only on an explicit confirm, to a student the review offered', () => {
  const s = read('api/catalog-personal-files.js')
  assert.match(s, /if \(body\.confirm !== true\) return res\.status\(400\)/)
  assert.match(s, /personalFileMatches\(r, st\.students\)\.find\(s => s\.id === body\.student_id\)/)
  assert.match(s, /\.eq\('is_demo', populationOf\(req\)\)/)
  // The Catalog copy is deleted only after the record's copy is confirmed at the same size.
  assert.ok(s.indexOf("from(CATALOG_BUCKET).remove") > s.indexOf('Number(landed.metadata?.size) === bytes.length'))
})

test('the migration is additive, retires Forms, keeps slugs, and adds a private bucket', () => {
  const sql = read('supabase/migrations/20260926000000_catalog_revamp_1.sql')
  const live = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(live, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
  assert.doesNotMatch(live, /UPDATE catalog_categories SET slug/i)
  assert.match(live, /UPDATE catalog_categories SET retired_at = now\(\) WHERE slug = 'forms'/)
  assert.match(live, /\('student_onboarding', 'Student Onboarding'/)
  assert.match(live, /\('school_documents',\s+'School Documents'/)
  assert.match(live, /UPDATE catalog_resources SET is_pinned = true WHERE is_featured = true/)
  assert.match(live, /VALUES \('record-documents', 'record-documents', false/)
  assert.match(live, /\) NOT VALID;/)
  assert.doesNotMatch(live, /overdue/i, 'overdue is computed, never stored')
})
