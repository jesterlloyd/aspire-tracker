// OUTREACH-ANALYTICS-1: Sent History analytics.
//
// The contract these tests defend: the analytics and the list tell the SAME
// story. One notification_log row is one communication, audiences come from
// canonical relationships (never free text), an unclassifiable row lands in
// Other rather than being guessed at, and a delivery rate appears only when
// the underlying delivery events actually cover the population.
//
// Run: node --test test/outreachAnalytics.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  aggregateOutreach, classifyAudience, deliveryHealth, localDayKey, dayRange,
  AUDIENCES, AUDIENCE_LABELS, DELIVERY_CONFIDENCE_MIN,
} from '../lib/server/outreachAnalytics.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const endpoint = read('api/notification-log-query.js')

// A contacts table shaped like the real one: two mapped categories, the rest
// deliberately unmapped.
const CATS = new Map([
  ['c-ap', 'Academic Partners'],
  ['c-ul', 'Unit Leadership'],
  ['c-prec', 'Preceptors'],
  ['c-bni', 'BNI Team'],
  ['c-exec', 'Nursing Executives'],
  ['c-other', 'Other'],
])
const row = (over = {}) => ({ sent_at: '2026-08-05T18:00:00.000Z', recipient_type: 'student', contact_id: null, status: 'sent', ...over })
const WINDOW = { startIso: '2026-08-01T07:00:00.000Z', endIso: '2026-08-06T07:00:00.000Z', tzOffsetMinutes: 420 } // Pacific

// ── Classification ───────────────────────────────────────────────────────────

test('audiences come from canonical relationships, never from free text', () => {
  assert.equal(classifyAudience({ recipient_type: 'student' }, CATS), 'students')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c-ap' }, CATS), 'academic_partners')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c-ul' }, CATS), 'unit_leaders')
  // Every other contact category is Other BY DESIGN, not by omission.
  for (const id of ['c-prec', 'c-bni', 'c-exec', 'c-other']) {
    assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: id }, CATS), 'other', id)
  }
  // Internal/system rows carry no recipient_type.
  assert.equal(classifyAudience({ recipient_type: null }, CATS), 'other')
  // A contact that no longer resolves is Other - counted, never guessed.
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c-deleted' }, CATS), 'other')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: null }, CATS), 'other')
  // A subject line that says "academic partner" changes nothing.
  assert.equal(classifyAudience({ recipient_type: null, subject: 'Academic Partners update' }, CATS), 'other')
})

// ── Totals reconcile with the list ───────────────────────────────────────────

test('audience buckets sum exactly to the total - the number the list shows', () => {
  const rows = [
    ...Array.from({ length: 7 }, () => row()),
    ...Array.from({ length: 3 }, () => row({ recipient_type: 'contact', contact_id: 'c-ap' })),
    ...Array.from({ length: 2 }, () => row({ recipient_type: 'contact', contact_id: 'c-ul' })),
    row({ recipient_type: null }),
    row({ recipient_type: 'contact', contact_id: 'c-prec' }),
  ]
  const { totals } = aggregateOutreach(rows, { contactCategories: CATS, ...WINDOW })
  assert.equal(totals.total, 14, 'one row per recipient delivery')
  assert.equal(totals.students, 7)
  assert.equal(totals.academic_partners, 3)
  assert.equal(totals.unit_leaders, 2)
  assert.equal(totals.other, 2)
  assert.equal(AUDIENCES.reduce((s, a) => s + totals[a], 0), totals.total, 'buckets must sum to the total')
})

test('a campaign to 20 people is 20 communications, not 1', () => {
  // The list counts notification_log rows; so does this. No re-definition.
  const rows = Array.from({ length: 20 }, (_, i) => row({ contact_id: null, recipient_type: 'student', sent_at: `2026-08-0${(i % 5) + 1}T18:00:00.000Z` }))
  const { totals } = aggregateOutreach(rows, { contactCategories: CATS, ...WINDOW })
  assert.equal(totals.total, 20)
})

// ── Single-audience and empty populations ────────────────────────────────────

test('single-audience periods report cleanly', () => {
  const only = (over, n = 4) => aggregateOutreach(Array.from({ length: n }, () => row(over)), { contactCategories: CATS, ...WINDOW }).totals
  const s = only({})
  assert.deepEqual([s.students, s.academic_partners, s.unit_leaders, s.other], [4, 0, 0, 0])
  const ap = only({ recipient_type: 'contact', contact_id: 'c-ap' })
  assert.deepEqual([ap.students, ap.academic_partners, ap.unit_leaders, ap.other], [0, 4, 0, 0])
  const ul = only({ recipient_type: 'contact', contact_id: 'c-ul' })
  assert.deepEqual([ul.students, ul.academic_partners, ul.unit_leaders, ul.other], [0, 0, 4, 0])
  const other = only({ recipient_type: null })
  assert.deepEqual([other.students, other.academic_partners, other.unit_leaders, other.other], [0, 0, 0, 4])
})

test('an empty period yields zeros and a zero-filled series, not an error', () => {
  const { totals, daily, delivery } = aggregateOutreach([], { contactCategories: CATS, ...WINDOW })
  assert.equal(totals.total, 0)
  assert.equal(daily.length, 5, 'the window is still drawn')
  assert.ok(daily.every(d => d.total === 0))
  assert.equal(delivery.trustworthy, false, 'no rows cannot support a rate')
  assert.equal(delivery.rate, null)
})

// ── Daily series ─────────────────────────────────────────────────────────────

test('a mixed-audience day stacks correctly and quiet days are zero-filled', () => {
  const rows = [
    row({ sent_at: '2026-08-03T18:00:00.000Z' }),
    row({ sent_at: '2026-08-03T19:00:00.000Z', recipient_type: 'contact', contact_id: 'c-ap' }),
    row({ sent_at: '2026-08-03T20:00:00.000Z', recipient_type: 'contact', contact_id: 'c-ul' }),
    row({ sent_at: '2026-08-03T21:00:00.000Z', recipient_type: null }),
    row({ sent_at: '2026-08-05T18:00:00.000Z' }),
  ]
  const { daily } = aggregateOutreach(rows, { contactCategories: CATS, ...WINDOW })
  const d3 = daily.find(d => d.date === '2026-08-03')
  assert.deepEqual(
    [d3.students, d3.academic_partners, d3.unit_leaders, d3.other, d3.total],
    [1, 1, 1, 1, 4],
  )
  assert.equal(daily.find(d => d.date === '2026-08-04').total, 0, 'quiet day present as a gap')
  assert.equal(daily.reduce((s, d) => s + d.total, 0), 5, 'the series sums to the total')
})

test('daily buckets follow the viewer local day, matching the date filters', () => {
  // 2026-08-04T02:00Z is still Aug 3 in Pacific (UTC-7). Sent History's range
  // filters are local-day boundaries, so the bars must agree.
  assert.equal(localDayKey('2026-08-04T02:00:00.000Z', 420), '2026-08-03')
  assert.equal(localDayKey('2026-08-04T02:00:00.000Z', 0), '2026-08-04')
  assert.equal(localDayKey('not-a-date', 0), null)
  assert.deepEqual(dayRange('2026-08-01T07:00:00.000Z', '2026-08-04T07:00:00.000Z', 420),
    ['2026-08-01', '2026-08-02', '2026-08-03'])
})

// ── Delivery health ──────────────────────────────────────────────────────────

test('delivery counts opened and clicked as reached - status is monotonic', () => {
  // The Resend webhook advances queued→sent→delivered→opened→clicked, so a
  // delivered-and-opened row reads "opened". Counting only "delivered" would
  // understate delivery badly.
  const rows = [
    row({ status: 'delivered' }), row({ status: 'opened' }), row({ status: 'clicked' }),
    row({ status: 'bounced' }), row({ status: 'failed' }),
  ]
  const { delivery } = aggregateOutreach(rows, { contactCategories: CATS, ...WINDOW })
  assert.equal(delivery.reached, 3)
  assert.equal(delivery.failed, 2)
  assert.equal(delivery.coverage, 1)
  assert.equal(delivery.trustworthy, true)
  assert.equal(delivery.rate, 3 / 5)
})

test('a delivery rate is suppressed when events do not cover the population', () => {
  // The realistic failure mode: the webhook is not delivering events, so
  // nearly everything sits at 'sent'. Showing "2% delivered" would be a lie.
  const rows = [...Array.from({ length: 49 }, () => row({ status: 'sent' })), row({ status: 'delivered' })]
  const { delivery } = aggregateOutreach(rows, { contactCategories: CATS, ...WINDOW })
  assert.equal(delivery.unconfirmed, 49)
  assert.ok(delivery.coverage < DELIVERY_CONFIDENCE_MIN)
  assert.equal(delivery.trustworthy, false, 'the UI must not show a rate here')
  // The failed COUNT stays usable regardless - it is written directly by the
  // send paths, not inferred from webhook coverage.
  const withFails = aggregateOutreach([...rows, row({ status: 'failed' })], { contactCategories: CATS, ...WINDOW })
  assert.equal(withFails.delivery.failed, 1)
})

test('an unrecognized status inflates neither success nor failure', () => {
  const { delivery } = aggregateOutreach([row({ status: 'weird' }), row({ status: 'delivered' })], { contactCategories: CATS, ...WINDOW })
  assert.equal(delivery.total, 2)
  assert.equal(delivery.reached, 1)
  assert.equal(delivery.failed, 0)
  assert.equal(delivery.unconfirmed, 0)
})

test('deliveryHealth is a pure summary of its counts', () => {
  const h = deliveryHealth({ total: 10, reached: 6, failed: 2, unconfirmed: 2 })
  assert.equal(h.coverage, 0.8)
  assert.equal(h.trustworthy, true)
  assert.equal(h.rate, 0.75)
})

// ── Endpoint wiring: one filter chain, no widened access, no bodies ──────────

test('aggregate mode reuses the SAME filter chain as the list', () => {
  // Reconciliation is structural: both paths run applyFilters, so the KPI
  // total cannot drift from the list total.
  assert.match(endpoint, /const applyFilters = \(qb\) => \{/)
  assert.match(endpoint, /applyFilters\(\s*\n?\s*supabaseAdmin\.from\('notification_log'\)/)
  for (const f of [
    /notification_types/, /recipient_type_filter/, /statusFilter === 'failed'/,
    /contact_id/, /student_id/,
  ]) assert.match(endpoint, f)
  // Folder filters that the list honors are inside the shared builder.
  const builder = endpoint.slice(endpoint.indexOf('const applyFilters'), endpoint.indexOf('if (q.aggregate'))
  assert.match(builder, /\.in\('notification_type', notificationTypes\)/)
  assert.match(builder, /\.in\('status', \['failed', 'bounced', 'complained'\]\)/)
  assert.match(builder, /\.is\('recipient_type', null\)/)
})

test('aggregate mode never fetches message content and stays inside existing auth', () => {
  const agg = endpoint.slice(endpoint.indexOf("if (q.aggregate"), endpoint.indexOf('// ── 4. Query notification_log'))
  assert.match(agg, /select\('sent_at, recipient_type, contact_id, status'\)/)
  for (const forbidden of ['subject', 'body', 'html', 'metadata']) {
    assert.ok(!agg.includes(`, ${forbidden}`), `aggregate must not select ${forbidden}`)
  }
  // The auth gate is upstream and untouched: one bearer check for both modes.
  const authAt = endpoint.indexOf("bearerToken")
  assert.ok(authAt > -1 && authAt < endpoint.indexOf('if (q.aggregate'), 'auth precedes aggregation')
  assert.equal(endpoint.split("['owner', 'admin'].includes(profile.role)").length - 1, 1,
    'the single existing authorization check still guards the endpoint')
  // Bounded work: chunked reads with an honest ceiling.
  assert.match(agg, /const MAX_ROWS = 25000/)
  assert.match(agg, /truncated/)
})

test('the UI reads its labels and colours from the one audience vocabulary', () => {
  const ui = read('src/components/connect/OutreachAnalytics.jsx')
  assert.match(ui, /from '\.\.\/\.\.\/\.\.\/lib\/server\/outreachAnalytics\.js'/)
  assert.match(ui, /AUDIENCES\.map/)
  for (const a of AUDIENCES) assert.ok(ui.includes(a), `${a} must have a colour`)
  assert.deepEqual(Object.keys(AUDIENCE_LABELS).sort(), [...AUDIENCES].sort())
  // Delivery rate renders only when trustworthy.
  assert.match(ui, /delivery\?\.trustworthy && \(/)
  assert.match(ui, /!delivery\?\.trustworthy && delivery\?\.failed > 0/)
})

test('the analytics query is the list query minus paging, plus timezone', () => {
  const list = read('src/components/connect/SentHistory.jsx')
  assert.match(list, /const params = new URLSearchParams\(buildQueryString\(\)\)/)
  assert.match(list, /params\.delete\('page'\)/)
  assert.match(list, /params\.delete\('per_page'\)/)
  assert.match(list, /params\.set\('aggregate', '1'\)/)
  assert.match(list, /params\.set\('tz_offset_minutes'/)
  // Both effects key off the same filter state.
  assert.match(list, /useEffect\(\(\) => \{ fetchAnalytics\(\) \}, \[fetchAnalytics\]\)/)
  // The existing list, its rows and expansion are untouched.
  assert.match(list, /communication\{total === 1 \? '' : 's'\}/)
  assert.match(list, /<OutreachAnalytics data=\{analytics\}/)
})

test('paginating the list does not re-run the aggregate', () => {
  // The analytics describe the whole filtered period; page changes must not
  // trigger another aggregate scan.
  const list = read('src/components/connect/SentHistory.jsx')
  const deps = /const buildAnalyticsQuery = useCallback\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\)/.exec(list)[1]
  assert.ok(!/\bpage\b/.test(deps), `buildAnalyticsQuery must not depend on page (got: ${deps.trim()})`)
  for (const filter of ['dateRange', 'pseudoFolder', 'failedOnly']) {
    assert.ok(deps.includes(filter), `${filter} must drive the analytics`)
  }
})

test('an unexpected response shape renders nothing, never a crash', () => {
  // Regression: a non-aggregate payload reached the component and the missing
  // `totals` blanked the entire Sent History page. Analytics are supplementary
  // and must fail silent.
  const ui = read('src/components/connect/OutreachAnalytics.jsx')
  assert.match(ui, /if \(!data \|\| !data\.totals \|\| !Array\.isArray\(data\.daily\)\) return null/)
  // The destructure happens only AFTER that guard.
  assert.ok(ui.indexOf('!data.totals') < ui.indexOf('const { totals, daily'),
    'the guard must precede the destructure')
})
