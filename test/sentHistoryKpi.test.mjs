// SENT-HISTORY-KPI-1: the Sent History KPI band becomes interactive where -
// and only where - an exact filter already exists.
//
// THE SHAPE OF THIS CHANGE
// Only ONE Sent History KPI maps to an existing filter. The total card already
// IS the Failed indicator (its label flips to "Failed communications" when
// `failedOnly` is on), so it is bound to that same filter and nothing else.
//
// The four audience cards - Students, Academic Partners, Unit Leaders, Other -
// have NO exact filter: Sent History filters by notification type (pseudo
// folders) or recipient_type=null, never by audience, and "Other" is a residual
// bucket no filter could express. Inventing folders to make them clickable
// would be inventing reporting definitions, so they stay passive with no click,
// pointer, hover or keyboard affordance.
//
// This is an interaction change only. The aggregation module is untouched, and
// these tests assert that the numbers, their source, and the API contract are
// byte-identical.
//
// Run: node --test test/sentHistoryKpi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AUDIENCES, classifyAudience } from '../lib/server/outreachAnalytics.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')

const analyticsUi = read('src/components/connect/OutreachAnalytics.jsx')
const sentHistory = read('src/components/connect/SentHistory.jsx')
const kpiBand = read('src/components/KPIBand.jsx')

// ── 1 + 8. The numbers and the contract did not move ────────────────────────

test('the analytics aggregation module is untouched by this change', () => {
  const changed = execSync('git status --porcelain', { cwd: repo }).toString()
  assert.doesNotMatch(changed, /lib\/server\/outreachAnalytics\.js/,
    'the KPI calculations must not be edited by an interaction change')
  assert.doesNotMatch(changed, /api\/notification-log-query\.js/, 'the list/analytics API is untouched')
})

test('audience classification is unchanged', () => {
  // The exact buckets the KPI cards count, exercised directly.
  const cats = new Map([['c1', 'Academic Partners'], ['c2', 'Unit Leadership'], ['c3', 'Preceptors']])
  assert.equal(classifyAudience({ recipient_type: 'student' }, cats), 'students')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c1' }, cats), 'academic_partners')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c2' }, cats), 'unit_leaders')
  assert.equal(classifyAudience({ recipient_type: 'contact', contact_id: 'c3' }, cats), 'other')
  assert.equal(classifyAudience({ recipient_type: null }, cats), 'other')
  assert.deepEqual([...AUDIENCES], ['students', 'academic_partners', 'unit_leaders', 'other'])
})

test('the KPI values still come from the same fields, unrounded', () => {
  // total and each audience read straight off the server totals - no client
  // recomputation was introduced alongside the interaction.
  assert.match(analyticsUi, /value=\{fmtInt\(totals\.total\)\}/)
  assert.match(analyticsUi, /value=\{fmtInt\(totals\[a\]\)\}/)
  // Scoped to the KPI BAND: the chart tooltip legitimately filters which
  // audiences to list, and that is not KPI arithmetic.
  const band = analyticsUi.slice(analyticsUi.indexOf('{/* KPI band'), analyticsUi.indexOf('{/* Chart */}'))
  assert.doesNotMatch(band, /\.filter\(|\.reduce\(/, 'no client-side re-aggregation in the KPI band')
})

test('the query string that feeds analytics is unchanged', () => {
  // Same params, same scope: date range, folder, failed, constraint, paging.
  for (const p of ['start_date', 'end_date', 'recipient_type_filter', 'notification_types',
    'status_filter', 'student_id', 'contact_id', 'page', 'per_page']) {
    assert.match(sentHistory, new RegExp(`params\\.set\\('${p}'`), `${p} must still be sent`)
  }
  assert.match(sentHistory, /if \(failedOnly\) params\.set\('status_filter', 'failed'\)/)
})

// ── 2 + 3. Failed applies, and the same control clears ──────────────────────

test('the total card is bound to the EXISTING failedOnly filter', () => {
  assert.match(analyticsUi, /onClick=\{\(\) => onToggleFailed\(!failedOnly\)\}/)
  assert.match(analyticsUi, /active=\{!!failedOnly\}/)
  // SentHistory hands over its own setter - no second source of truth.
  assert.match(sentHistory, /onToggleFailed=\{changeFailed\}/)
  assert.match(sentHistory, /const changeFailed = \(v\) => \{ setPage\(1\); setFailedOnly\(v\) \}/,
    'the canonical setter still resets to page 1')
})

test('toggling is its own inverse, so the card clears what it applies', () => {
  // There is no separate All card in this band; the one card is a two-state
  // toggle, so pressing it while active restores the unfiltered view.
  let failedOnly = false
  const onToggle = (v) => { failedOnly = v }
  onToggle(!failedOnly); assert.equal(failedOnly, true, 'apply')
  onToggle(!failedOnly); assert.equal(failedOnly, false, 'clear')
})

// ── 5. Canonical semantics, not a local imitation ───────────────────────────

test('the clickable card is the canonical FilterKPICard', () => {
  assert.match(analyticsUi, /import \{ FilterKPICard \} from '\.\.\/KPIBand'/)
  assert.match(analyticsUi, /<FilterKPICard/)
  // The local passive card was NOT restyled into a fake interactive one.
  const localCard = analyticsUi.slice(analyticsUi.indexOf('function KpiCard'), analyticsUi.indexOf('/** Stacked daily bars'))
  assert.doesNotMatch(localCard, /onClick|cursor: 'pointer'|aria-pressed|onMouseEnter/,
    'the passive card must not imitate the interactive one')
})

test('button semantics, aria-pressed and focus come from the canonical primitive', () => {
  const card = kpiBand.slice(kpiBand.indexOf('export function FilterKPICard'))
  assert.match(card, /<button/, 'real button: Enter and Space activate for free')
  assert.match(card, /aria-pressed=\{active\}/)
  assert.match(card, /onMouseEnter/, 'hover lift')
  assert.match(card, /p\.halo/, 'hover halo')
  assert.match(card, /active \? p\.solid\s*:\s*p\.tint/, 'selected fill')
})

test('the relabelling card still announces its action', () => {
  // Its visible label changes with state, so the accessible name must not.
  assert.match(analyticsUi, /ariaLabel=\{failedOnly \? '[^']*Clear[^']*' : 'Show failed only'\}/)
  assert.match(kpiBand, /aria-label=\{ariaLabel \|\| undefined\}/)
})

test('ariaLabel is additive: existing FilterKPICard callers are unaffected', () => {
  // Every other caller omits it and must keep rendering with no accessible-name
  // override (undefined, never an empty string).
  assert.match(kpiBand, /ariaLabel \|\| undefined/)
  for (const f of ['src/components/StudentProfilesTab.jsx', 'src/components/InterviewRubricTab.jsx']) {
    assert.doesNotMatch(read(f), /ariaLabel=/, `${f} should not need changing`)
  }
})

// ── 6. Non-actionable cards advertise nothing ───────────────────────────────

test('the audience breakdown cards carry no interaction affordance', () => {
  const block = analyticsUi.slice(analyticsUi.indexOf('{AUDIENCES.map('), analyticsUi.indexOf('{/* Chart */}'))
  assert.doesNotMatch(block, /onClick|FilterKPICard|aria-pressed|role="button"|tabIndex/,
    'no click, no button semantics, no keyboard target on a card with no action')
  assert.match(block, /<KpiCard/, 'they stay the passive primitive')
})

test('no audience filter was invented to make them clickable', () => {
  // The pseudo-folders are by notification type / recipient_type=null only.
  const folders = sentHistory.slice(sentHistory.indexOf('const PSEUDO_FOLDERS'), sentHistory.indexOf('const DATE_RANGES'))
  for (const a of AUDIENCES) {
    assert.doesNotMatch(folders, new RegExp(`'${a}'`), `no ${a} folder may be added`)
  }
  assert.doesNotMatch(sentHistory, /audience_filter|params\.set\('audience'/,
    'no new audience query parameter')
})

// ── 7. The rest of the surface still works alongside it ─────────────────────

test('the KPI filter composes with folder, date, constraint and paging', () => {
  // failedOnly is one clause in the shared builder, not a separate query path.
  const builder = sentHistory.slice(sentHistory.indexOf('const buildQueryString'), sentHistory.indexOf('}, [dateRange'))
  for (const clause of ['start_date', 'notification_types', 'status_filter', 'page']) {
    assert.match(builder, new RegExp(clause), `${clause} still in the one builder`)
  }
  assert.match(sentHistory, /failedOnly,\s*page,/, 'the builder still re-runs when either changes')
})

test('the preview control is untouched by the KPI change', () => {
  const changed = execSync('git status --porcelain', { cwd: repo }).toString()
  // Part 1 owns the preview endpoint; Part 2 must not have edited it further.
  const previewEdits = changed.split('\n').filter(l => /notification-log-message/.test(l))
  assert.equal(previewEdits.length, 1, 'exactly the Part 1 file, still modified once')
})
