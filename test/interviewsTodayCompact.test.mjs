// INTERVIEWS-TODAY-COMPACT-1: canonical profile-ID scoping, prompt-specified
// sorting, and reuse of the existing OnCampusNow row contract.
//
// The approved decision is that "my interviews" resolves
// slot -> parent availability block -> interviewer_profile_id. Display-name
// matching is never used: interview_slots carries only interviewer_name (TEXT),
// and name matching is the drift this app removed in the preceptor and
// staff-invite canonicalization work.
//
// Run: node --test test/interviewsTodayCompact.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  slotInterviewerProfileId, scopeInterviewsForViewer, interviewState,
  sortInterviews, buildInterviewRows, formatSlotTime,
} from '../src/lib/interviewsToday.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const lib = read('src/lib/interviewsToday.js')

const NOW = new Date('2026-08-04T10:15:00')
const DATE = '2026-08-04'
const slot = (id, time, extra = {}) => ({
  id, slot_date: DATE, slot_time: time, duration_minutes: 30,
  students: { first_name: 'Ava', last_name: 'Cruz', school: 'CSUN', headshot_url: null },
  ...extra,
})
const BLOCKS = {
  'blk-jen': { id: 'blk-jen', interviewer_profile_id: 'p-jen' },
  'blk-me':  { id: 'blk-me',  interviewer_profile_id: 'p-me' },
}

// ── Canonical profile-ID scoping ─────────────────────────────────────────────

test('the interviewer resolves through the parent block, by profile id', () => {
  assert.equal(slotInterviewerProfileId(slot('a', '10:00', { block_id: 'blk-me' }), BLOCKS), 'p-me')
  // A Map works too (the component builds one).
  const asMap = new Map(Object.entries(BLOCKS))
  assert.equal(slotInterviewerProfileId(slot('a', '10:00', { block_id: 'blk-jen' }), asMap), 'p-jen')
  // No block, or an unknown block, resolves to null - NEVER to a name.
  assert.equal(slotInterviewerProfileId(slot('a', '10:00'), BLOCKS), null)
  assert.equal(slotInterviewerProfileId(slot('a', '10:00', { block_id: 'nope' }), BLOCKS), null)
})

test('an interviewer sees only their own interviews', () => {
  const rows = [
    slot('mine', '10:00', { block_id: 'blk-me' }),
    slot('theirs', '11:00', { block_id: 'blk-jen' }),
    slot('orphan', '12:00'),
  ]
  const scoped = scopeInterviewsForViewer(rows, { blocksById: BLOCKS, viewerProfileId: 'p-me', isAdmin: false })
  assert.deepEqual(scoped.map(s => s.id), ['mine'])
})

test('Owner/Admin see everything the caller already fetched', () => {
  const rows = [slot('a', '10:00', { block_id: 'blk-me' }), slot('b', '11:00', { block_id: 'blk-jen' })]
  const scoped = scopeInterviewsForViewer(rows, { blocksById: BLOCKS, viewerProfileId: 'p-me', isAdmin: true })
  assert.deepEqual(scoped.map(s => s.id), ['a', 'b'])
})

test('an unidentified viewer sees nothing rather than everything', () => {
  const rows = [slot('a', '10:00', { block_id: 'blk-me' })]
  assert.deepEqual(scopeInterviewsForViewer(rows, { blocksById: BLOCKS, viewerProfileId: null, isAdmin: false }), [])
})

test('NO display-name matching anywhere in the module', () => {
  assert.doesNotMatch(lib, /interviewer_name\s*===/)
  assert.doesNotMatch(lib, /full_name\s*===/)
  assert.doesNotMatch(lib, /toLowerCase\(\)\s*===/)
  // interviewer_name may only be READ for display text, never compared.
  assert.match(lib, /interviewer_profile_id/)
  assert.match(lib, /slot -> block \(slot\.block_id\) -> interviewer_profile_id/)
})

// ── States and sorting ───────────────────────────────────────────────────────

test('state comes from the clock, with an explicit canceled flag honored first', () => {
  assert.equal(interviewState(slot('a', '09:00'), NOW), 'completed')   // 9:00-9:30, past
  assert.equal(interviewState(slot('b', '10:00'), NOW), 'in_progress') // 10:00-10:30, now
  assert.equal(interviewState(slot('c', '11:00'), NOW), 'upcoming')
  assert.equal(interviewState(slot('d', '11:00', { status: 'canceled' }), NOW), 'canceled')
  assert.equal(interviewState(slot('e', '11:00', { canceled_at: '2026-08-04T08:00:00Z' }), NOW), 'canceled')
})

test('sorting: in progress, upcoming earliest first, completed most recent first, canceled last', () => {
  const rows = [
    slot('done-early', '08:00'), slot('up-late', '15:00'), slot('cancel', '13:00', { status: 'canceled' }),
    slot('live', '10:00'), slot('up-soon', '11:00'), slot('done-late', '09:00'),
  ]
  assert.deepEqual(
    sortInterviews(rows, NOW).map(s => s.id),
    ['live', 'up-soon', 'up-late', 'done-late', 'done-early', 'cancel'])
})

test('simultaneous interviews stay deterministic via the immutable id', () => {
  const a = slot('bbb', '11:00'); const b = slot('aaa', '11:00')
  assert.deepEqual(sortInterviews([a, b], NOW).map(s => s.id), ['aaa', 'bbb'])
})

// ── Row contract reuse ───────────────────────────────────────────────────────

test('rows match the EXISTING OnCampusNow contract, with no new card component', () => {
  const [row] = buildInterviewRows([slot('a', '11:00', { interviewer_name: 'Jennifer Gidaya' })], { now: NOW })
  for (const k of ['key', 'avatar', 'name', 'subLabel', 'badge', 'statusText', 'statusWarn', 'onClick', 'ariaLabel']) {
    assert.ok(k in row, `row must carry ${k}`)
  }
  assert.equal(row.name, 'Ava Cruz')
  assert.equal(row.subLabel, 'CSUN · Jennifer Gidaya')
  assert.equal(row.badge.label, 'Upcoming')
  assert.equal(row.statusText, formatSlotTime(slot('a', '11:00')))
  // The renderer itself is untouched and still generic.
  const occ = read('src/components/oncampus/OnCampusNow.jsx')
  assert.match(occ, /export default function OnCampusNow\(\{\n\s+title = 'On Campus Now'/)
})

test('completed rows are marked subdued and keep their place in the day', () => {
  const [row] = buildInterviewRows([slot('a', '09:00')], { now: NOW })
  assert.equal(row.badge.label, 'Completed')
  assert.equal(row.subdued, true)
})

test('missing school, program, or interviewer degrades without a dangling separator', () => {
  const bare = { id: 'x', slot_date: DATE, slot_time: '11:00', duration_minutes: 30,
    students: { first_name: 'Ava', last_name: 'Cruz' } }
  const [row] = buildInterviewRows([bare], { now: NOW })
  assert.equal(row.subLabel, '', 'no leading or trailing separator')
  assert.doesNotMatch(row.subLabel, /·/)
  // A student-less slot is dropped rather than rendering an empty card.
  assert.equal(buildInterviewRows([{ id: 'y', slot_date: DATE, slot_time: '11:00' }], { now: NOW }).length, 0)
})

test('clicking a row calls the caller-supplied opener with the original slot', () => {
  const opened = []
  const [row] = buildInterviewRows([slot('a', '11:00')], { now: NOW, onOpen: s => opened.push(s.id) })
  row.onClick()
  assert.deepEqual(opened, ['a'], 'reuses the existing detail entry point, no new implementation')
})

test('each row carries an accessible label naming person, state and time', () => {
  const [row] = buildInterviewRows([slot('a', '11:00', { interviewer_name: 'Jennifer Gidaya' })], { now: NOW })
  assert.match(row.ariaLabel, /^Ava Cruz, Upcoming at .+, with Jennifer Gidaya$/)
})

test('the module performs no data access and no authorization of its own', () => {
  assert.doesNotMatch(lib, /supabase|fetch\(|from\('/)
})

// ── One shared header treatment on both surfaces ────────────────────────────

test('INTERVIEWS-TODAY-HEADER-1: the Interviews tab uses the shared green-dot header', () => {
  const ws = read('src/components/TodaysInterviews.jsx')
  // The shared header (dot + title + same-line summary) IS the heading now...
  assert.match(ws, /<OnCampusNow\n\s+title="Interviews Today"\n\s+sub=\{`\$\{todayShort\} · \$\{rows\.length\} scheduled`\}/)
  assert.match(ws, /flush\n\s+\/>/)
  // ...and the older outer eyebrow heading + separate summary line is gone.
  assert.doesNotMatch(ws, /textTransform: 'uppercase'/)
  assert.doesNotMatch(ws, /title=\{null\}/)
})

test('the header renders unconditionally again; flush only drops the inset', () => {
  const occ = read('src/components/oncampus/OnCampusNow.jsx')
  assert.match(occ, /<div className="mast-live-head">/)
  assert.doesNotMatch(occ, /\{title && \(/, 'the header is no longer conditional')
  assert.match(occ, /flush = false,/)
  assert.match(occ, /flush \? 'mast-live mast-live-flush' : 'mast-live'/)
  // flush also restores the bottom breathing room the old wrapper provided, so
  // the cards do not butt against the calendar controls below.
  assert.match(read('src/index.css'), /\.mast-live-flush \{ margin-left: 0; margin-right: 0; margin-bottom: 16px; \}/)
  assert.doesNotMatch(read('src/index.css'), /mast-live-headless/)
})

test('both surfaces present the identical header pattern', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /<OnCampusNow title="Interviews Today" sub=\{sub\} rows=\{rows\} \/>/)
  assert.match(ov, /<OnCampusNow title="On Campus Now" sub=\{sub\} onViewAll=\{onOpenActivity\} rows=\{rows\} \/>/)
})

// ── Each caller owns its own navigation ──────────────────────────────────────

test('At a Glance interview cards open the Interview Rubric, NOT Rotation > Activity', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /onOpenInterview\?\.\(\{ slotId: slot\.id, sessionId: session\?\.id, student, slot, cohortId \}\)/)
  // Opens THAT student's rubric, not just the tab: InterviewRubricTab seeds its
  // selection from ?student=, the same param its own selectStudent writes.
  assert.match(ov, /navigate\(`\/interviews\?student=\$\{encodeURIComponent\(student\.id\)\}`\)/)
  assert.match(read('src/components/InterviewRubricTab.jsx'), /useState\(\(\) => searchParams\.get\('student'\) \|\| null\)/)
  // The interview strip must not carry On Campus Now's activity destination.
  const strip = ov.slice(ov.indexOf('function InterviewsTodayStrip'), ov.indexOf('function OnCampusStrip'))
  assert.doesNotMatch(strip, /rotation\/activity/)
  assert.doesNotMatch(strip, /onViewAll/)
})

test('On Campus Now still opens Rotation > Activity, unchanged', () => {
  const ov = read('src/components/OverviewTab.jsx')
  assert.match(ov, /onOpenActivity=\{\(\) => navigate\('\/rotation\/activity'\)\}/)
})

test('the shared renderer imposes no navigation of its own', () => {
  const occ = read('src/components/oncampus/OnCampusNow.jsx')
  assert.doesNotMatch(occ, /navigate|rotation|interviews/i)
  assert.match(occ, /onClick=\{r\.onClick\}/, 'each row supplies its own handler')
})
