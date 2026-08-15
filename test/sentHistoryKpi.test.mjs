// SENT-HISTORY-KPI-2: all five KPI cards use the canonical interactive card
// and audience filtering uses the same classification as the KPI calculation.
// Run: node --test test/sentHistoryKpi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AUDIENCES, aggregateOutreach, classifyAudience } from '../lib/server/outreachAnalytics.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')

const analyticsUi = read('src/components/connect/OutreachAnalytics.jsx')
const sentHistory = read('src/components/connect/SentHistory.jsx')
const endpoint = read('api/notification-log-query.js')
const kpiBand = read('src/components/KPIBand.jsx')

test('the audience definitions still classify every row exactly once', () => {
  const cats = new Map([['c1', 'Academic Partners'], ['c2', 'Unit Leadership'], ['c3', 'Preceptors']])
  assert.deepEqual([...AUDIENCES], ['students', 'academic_partners', 'unit_leaders', 'other'])
  assert.equal(classifyAudience({ recipient_type: 'student' }, cats), 'students')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c1' }, cats), 'academic_partners')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c2' }, cats), 'unit_leaders')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c3' }, cats), 'other')
  assert.equal(classifyAudience({ recipient_type: null }, cats), 'other')
})

test('KPI calculations retain one-row-per-recipient semantics', () => {
  const rows = [
    { sent_at: '2026-08-14T10:00:00Z', recipient_type: 'student', status: 'sent' },
    { sent_at: '2026-08-14T11:00:00Z', recipient_type: 'contact', contact_id: 'ap', status: 'delivered' },
    { sent_at: '2026-08-14T12:00:00Z', recipient_type: 'contact', contact_id: 'ul', status: 'failed' },
    { sent_at: '2026-08-14T13:00:00Z', recipient_type: null, status: 'sent' },
  ]
  const result = aggregateOutreach(rows, {
    contactCategories: new Map([['ap', 'Academic Partners'], ['ul', 'Unit Leadership']]),
    startIso: '2026-08-14T00:00:00Z', endIso: '2026-08-15T00:00:00Z',
  })
  assert.deepEqual(result.totals, { students: 1, academic_partners: 1, unit_leaders: 1, other: 1, total: 4 })
})

test('all five cards use the canonical FilterKPICard primitive', () => {
  assert.match(analyticsUi, /import \{ FilterKPICard \} from '\.\.\/KPIBand'/)
  assert.match(analyticsUi, /label="Communications sent"[\s\S]{0,260}active=\{audienceFilter === 'all'\}/)
  const audienceBlock = analyticsUi.slice(analyticsUi.indexOf('{AUDIENCES.map('), analyticsUi.indexOf('{/* Chart */}'))
  assert.match(audienceBlock, /<FilterKPICard/)
  assert.match(audienceBlock, /active=\{audienceFilter === a\}/)
  assert.doesNotMatch(analyticsUi, /function KpiCard/, 'no passive local imitation remains')
})

test('cards apply and clear the exact audience filter', () => {
  assert.match(analyticsUi, /onClick=\{\(\) => onChangeAudience\?\.\('all'\)\}/)
  assert.match(analyticsUi, /onClick=\{\(\) => onChangeAudience\?\.\(audienceFilter === a \? 'all' : a\)\}/)
  assert.match(sentHistory, /audienceFilter=\{audienceFilter\}/)
  assert.match(sentHistory, /onChangeAudience=\{changeAudience\}/)
  assert.match(sentHistory, /const changeAudience = \(v\) => \{ setPage\(1\); setAudienceFilter\(v\) \}/)
})

test('button, keyboard, selected, hover and focus semantics remain canonical', () => {
  const card = kpiBand.slice(kpiBand.indexOf('export function FilterKPICard'))
  assert.match(card, /<button/)
  assert.match(card, /aria-pressed=\{active\}/)
  assert.match(card, /onMouseEnter/)
  assert.match(card, /p\.halo/)
  assert.match(card, /active \? p\.solid\s*:\s*p\.tint/)
})

test('audience state is persisted and sent with the list query', () => {
  assert.match(sentHistory, /AUDIENCE_FILTERS\.has\(stored\.audienceFilter\)/)
  assert.match(sentHistory, /pseudoFolder, failedOnly, audienceFilter, dateRange/)
  assert.match(sentHistory, /if \(audienceFilter !== 'all'\) params\.set\('audience_filter', audienceFilter\)/)
  assert.match(sentHistory, /failedOnly, audienceFilter, page/)
})

test('KPI values remain the full breakdown while the selected card filters only the table', () => {
  assert.match(sentHistory, /params\.delete\('audience_filter'\)/)
  assert.match(analyticsUi, /value=\{fmtInt\(totals\.total\)\}/)
  assert.match(analyticsUi, /value=\{fmtInt\(totals\[a\]\)\}/)
  const band = analyticsUi.slice(analyticsUi.indexOf('{/* KPI band'), analyticsUi.indexOf('{/* Chart */}'))
  assert.doesNotMatch(band, /\.reduce\(/, 'the UI never re-aggregates server totals')
})

test('failed-only remains an independent composable filter', () => {
  assert.match(sentHistory, /if \(failedOnly\) params\.set\('status_filter', 'failed'\)/)
  assert.match(sentHistory, /type="checkbox" checked=\{failedOnly\}/)
  assert.doesNotMatch(analyticsUi, /onToggleFailed|Failed communications/)
})

test('the API validates audience_filter and uses the shared classifier', () => {
  assert.match(endpoint, /import \{ AUDIENCES, aggregateOutreach, classifyAudience \}/)
  assert.match(endpoint, /!AUDIENCES\.includes\(audienceFilter\)/)
  assert.match(endpoint, /classifyAudience\(row, contactCategories\) === audienceFilter/)
  assert.match(endpoint, /matching\.slice\(from, to \+ 1\)/,
    'classification must happen before pagination, never on the visible page only')
})

test('Other is an exact residual server-side filter, not a guessed query', () => {
  assert.match(endpoint, /const matching = candidates\.filter/)
  assert.match(endpoint, /loadContactCategories\(candidates\)/)
  assert.doesNotMatch(endpoint, /subject.*audience|recipient_email.*audience/)
})

test('audience filtering composes with the existing date, folder, failed and recipient filters', () => {
  const builder = sentHistory.slice(sentHistory.indexOf('const buildQueryString'), sentHistory.indexOf('// The analytics query'))
  for (const clause of ['start_date', 'end_date', 'notification_types', 'recipient_type_filter',
    'status_filter', 'audience_filter', 'student_id', 'contact_id', 'page', 'per_page']) {
    assert.match(builder, new RegExp(clause), `${clause} missing from the shared builder`)
  }
})

test('the list endpoint remains read-only and the preview control remains independent', () => {
  const code = endpoint.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|emails\.send/)
  assert.match(sentHistory, /fetch\(`\/api\/notification-log-message\?id=\$\{encodeURIComponent\(id\)\}`/)
})
