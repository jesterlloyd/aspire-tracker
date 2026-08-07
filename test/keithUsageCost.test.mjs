// KEITH-USAGE-1: Settings > Keith > Usage & Cost.
//
// Three layers under test:
//   1. modelPricing.js  - the only place dollar rates exist; unknown models are
//      never priced as another model.
//   2. usageSummary.js  - pure aggregation: totals, trend, model and workload
//      attribution, outcome classification, truncation honesty.
//   3. Source pins      - api/keith-usage.js posture (Owner/Admin, allow-list,
//      metadata only), navigation order, and the no-secret-in-client rule.
//
// Run: node --test test/keithUsageCost.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  priceForModel, estimateCostUsd, pricingTable, modelLabel, PRICING_AS_OF,
} from '../lib/server/keith/modelPricing.js'
import {
  summarizeUsage, rangeStart, startOfDayInTz, dayKeyInTz, USAGE_RANGES,
} from '../lib/server/keith/usageSummary.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-5-20250929'

// ── modelPricing ─────────────────────────────────────────────────────────────

test('the two routed models are priced at the official rates', () => {
  // platform.claude.com/docs pricing, retrieved 2026-08-06.
  assert.deepEqual({ input: priceForModel(HAIKU).input, output: priceForModel(HAIKU).output }, { input: 1, output: 5 })
  assert.deepEqual({ input: priceForModel(SONNET).input, output: priceForModel(SONNET).output }, { input: 3, output: 15 })
  assert.equal(modelLabel(HAIKU), 'Claude Haiku 4.5')
})

test('the pricing table stays in step with the model routing table', () => {
  // Every model modelRouting.js can emit must be priceable, or the page would
  // show "pricing unavailable" for ASPIRE's own routed models.
  const routing = read('lib/server/keith/modelRouting.js')
  const priced = pricingTable().map(p => p.model)
  for (const m of [...routing.matchAll(/model: '([^']+)'/g)].map(x => x[1])) {
    assert.ok(priced.includes(m), `${m} is routable but has no price row`)
  }
})

test('cost arithmetic: tokens priced per million, correctly per model', () => {
  // 1M input + 1M output on Haiku = $1 + $5.
  assert.equal(estimateCostUsd(HAIKU, 1_000_000, 1_000_000), 6)
  // A realistic request: 3,000 in / 500 out on Haiku = $0.003 + $0.0025.
  assert.equal(estimateCostUsd(HAIKU, 3000, 500), 0.0055)
  assert.equal(estimateCostUsd(SONNET, 3000, 500), 0.0165)
  assert.equal(estimateCostUsd(HAIKU, 0, 0), 0)
  // Garbage token counts clamp instead of producing NaN or negative dollars.
  assert.equal(estimateCostUsd(HAIKU, -50, 'x'), 0)
})

test('an unknown model is NEVER priced as another model', () => {
  assert.equal(priceForModel('claude-sonnet-5'), null)
  assert.equal(estimateCostUsd('claude-sonnet-5', 5000, 1000), null)
  assert.equal(estimateCostUsd(null, 5000, 1000), null)
  assert.equal(estimateCostUsd('', 5000, 1000), null)
})

test('the pricing module carries its source and date', () => {
  assert.match(PRICING_AS_OF, /^\d{4}-\d{2}-\d{2}$/)
  const src = read('lib/server/keith/modelPricing.js')
  assert.match(src, /PRICING SOURCE: https:\/\/platform\.claude\.com/)
  assert.match(src, /ONLY place a dollar rate/)
})

// ── usageSummary: ranges and day math ────────────────────────────────────────

test('range bounds: today is local midnight, 7d/30d are rolling windows', () => {
  const now = new Date('2026-08-06T20:00:00Z') // 1pm PDT
  assert.equal(rangeStart('today', now).toISOString(), '2026-08-06T07:00:00.000Z') // midnight PDT
  assert.equal(rangeStart('7d', now).getTime(), now.getTime() - 7 * 86400000)
  assert.equal(rangeStart('30d', now).getTime(), now.getTime() - 30 * 86400000)
  // Unknown range narrows to 30d, never wider.
  assert.equal(rangeStart('all_time', now).getTime(), now.getTime() - 30 * 86400000)
  assert.deepEqual(USAGE_RANGES, ['today', '7d', '30d'])
})

test('day math is timezone-honest across the UTC boundary', () => {
  // 11pm PDT Aug 5 is 6am UTC Aug 6: the bucket must say Aug 5.
  const lateEvening = new Date('2026-08-06T06:00:00Z')
  assert.equal(dayKeyInTz(lateEvening, 'America/Los_Angeles'), '2026-08-05')
  assert.equal(startOfDayInTz(lateEvening, 'America/Los_Angeles').toISOString(), '2026-08-05T07:00:00.000Z')
  // And in winter the offset is 8, not 7 (DST safety).
  const winter = new Date('2026-01-15T12:00:00Z')
  assert.equal(startOfDayInTz(winter, 'America/Los_Angeles').toISOString(), '2026-01-15T08:00:00.000Z')
})

// ── usageSummary: aggregation ────────────────────────────────────────────────

const NOW = new Date('2026-08-06T20:00:00Z')
function row(over = {}) {
  return {
    id: over.id || `r${Math.abs(JSON.stringify(over).split('').reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7))}`,
    created_at: '2026-08-06T18:00:00Z', profile_id: 'p1', role: 'admin', intent: 'general',
    skill_id: null, model: HAIKU, model_route: 'default',
    input_tokens: 1000, output_tokens: 200, duration_ms: 900,
    outcome: 'completed', rate_limited: false,
    ...over,
  }
}
const NAMES = { skillNames: new Map([['sk1', 'Resume Interview Questions']]), profileNames: new Map([['p1', 'Casey Chen']]) }

test('totals, cost, and averages aggregate correctly', () => {
  const rows = [
    row({ id: 'a', input_tokens: 1_000_000, output_tokens: 1_000_000 }),           // $6 Haiku
    row({ id: 'b', model: SONNET, input_tokens: 1_000_000, output_tokens: 0 }),    // $3 Sonnet
    row({ id: 'c', model: null, input_tokens: 0, output_tokens: 0, outcome: 'rate_limited', rate_limited: true, duration_ms: null }),
  ]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  assert.equal(s.totals.requests, 3)
  assert.equal(s.totals.inputTokens, 2_000_000)
  assert.equal(s.totals.outputTokens, 1_000_000)
  assert.equal(s.totals.estimatedCostUsd, 9)
  // The refused no-model no-token request is priced at zero, not "unavailable".
  assert.equal(s.totals.pricedRequests, 3)
  assert.equal(s.totals.unpricedRequests, 0)
  assert.equal(s.totals.avgCostPerRequestUsd, 3)
  assert.equal(s.totals.avgDurationMs, 900)
})

test('an unknown model contributes tokens but never fabricated dollars', () => {
  const rows = [
    row({ id: 'a' }),                                                              // priced
    row({ id: 'b', model: 'claude-future-9', input_tokens: 50_000, output_tokens: 10_000 }), // unpriceable
  ]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  assert.equal(s.totals.unpricedRequests, 1)
  assert.equal(s.totals.pricedRequests, 1)
  // Total includes only the priced request's cost.
  assert.equal(s.totals.estimatedCostUsd, 0.002)
  const future = s.models.find(m => m.model === 'claude-future-9')
  assert.equal(future.priced, false)
  assert.equal(future.estimatedCostUsd, null, 'unknown model shows no dollar figure')
  assert.equal(future.avgCostPerRequestUsd, null)
  assert.equal(future.inputTokens, 50_000, 'tokens still reported honestly')
})

test('workload attribution separates Base Keith from each skill', () => {
  const rows = [
    row({ id: 'a' }), row({ id: 'b' }),
    row({ id: 'c', skill_id: 'sk1', input_tokens: 8000, output_tokens: 900 }),
    row({ id: 'd', skill_id: 'sk1', outcome: 'error', duration_ms: 2500 }),
    row({ id: 'e', skill_id: 'ghost', input_tokens: 10 }),
  ]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  const base = s.workloads.find(w => w.key === '__base__')
  const riq = s.workloads.find(w => w.key === 'sk1')
  const ghost = s.workloads.find(w => w.key === 'ghost')
  assert.equal(base.label, 'Base Keith'); assert.equal(base.isSkill, false); assert.equal(base.requests, 2)
  assert.equal(s.workloads[0].key, '__base__', 'Base Keith leads the workload list')
  assert.equal(riq.label, 'Resume Interview Questions'); assert.equal(riq.requests, 2); assert.equal(riq.failures, 1)
  // A skill row whose skill vanished still shows, honestly labelled.
  assert.equal(ghost.label, 'Retired skill')
})

test('success rate = completed / (completed + errors); nothing else is in the ratio', () => {
  const rows = [
    row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }),
    row({ id: 'd', outcome: 'denied' }),
    row({ id: 'e', outcome: 'missing_data' }),
    row({ id: 'f', outcome: 'error' }),
    // Four rate limits: the limiter working as designed, deliberately outside
    // the ratio. Under the previous formula these dropped the rate to 37.5%.
    ...['g', 'h', 'i', 'j'].map(id => row({ id, outcome: 'rate_limited', rate_limited: true })),
  ]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  assert.deepEqual(s.outcomes, { completed: 3, denied: 1, missing_data: 1, rate_limited: 4, error: 1 })
  // 3 / (3 + 1) = 75%, regardless of the four rate limits, one denial and one
  // missing-data row.
  assert.equal(s.health.successRate, 75)
  // Each excluded outcome is still reported, as its own count.
  assert.equal(s.health.errors, 1)
  assert.equal(s.health.rateLimited, 4)
  assert.equal(s.health.denied, 1)
  assert.equal(s.health.missingData, 1)
  // The retired combined-failure field must not linger, or a stale consumer
  // would silently keep reading the old semantics.
  assert.equal(s.health.failures, undefined)
})

test('a period with no completions and no errors has no success rate to state', () => {
  // All denied: the ratio has an empty base, so it reports null rather than 0%,
  // which would read as "everything broke".
  const rows = [row({ id: 'a', outcome: 'denied' }), row({ id: 'b', outcome: 'rate_limited', rate_limited: true })]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  assert.equal(s.health.successRate, null)
  assert.equal(s.health.denied, 1)
  assert.equal(s.health.rateLimited, 1)
})

test('a clean period reports 100% even while the limiter is engaging', () => {
  const rows = [
    row({ id: 'a' }), row({ id: 'b' }),
    row({ id: 'c', outcome: 'rate_limited', rate_limited: true }),
  ]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  assert.equal(s.health.successRate, 100)
  assert.equal(s.health.rateLimited, 1)
})

test('the trend axis is continuous: quiet days render as zero', () => {
  const rows = [
    row({ id: 'a', created_at: '2026-08-01T18:00:00Z' }),
    row({ id: 'b', created_at: '2026-08-06T18:00:00Z' }),
  ]
  const s = summarizeUsage({ rows, ...NAMES, range: '7d', now: NOW })
  assert.equal(s.trend.length, 8, '7-day rolling window spans 8 partial PT days')
  const days = s.trend.map(d => d.day)
  assert.deepEqual(days, [...days].sort(), 'chronological')
  assert.equal(new Set(days).size, days.length, 'no duplicate day buckets')
  assert.ok(s.trend.some(d => d.day === '2026-08-03' && d.requests === 0), 'a quiet day is present at zero')
  assert.equal(s.trend.find(d => d.day === '2026-08-06').requests, 1)
})

test('recent activity is bounded, newest first, metadata only', () => {
  const rows = Array.from({ length: 60 }, (_, i) => row({
    id: `r${i}`, created_at: new Date(Date.UTC(2026, 7, 6, 10, i)).toISOString(),
  }))
  const s = summarizeUsage({ rows, ...NAMES, range: 'today', now: NOW, recentLimit: 50 })
  assert.equal(s.recent.length, 50)
  assert.equal(s.recent[0].id, 'r59', 'newest first')
  const keys = Object.keys(s.recent[0])
  // The row shape is a closed metadata set: nothing content-bearing, no
  // request_id, no student linkage.
  assert.deepEqual(keys.sort(), ['createdAt', 'durationMs', 'estimatedCostUsd', 'id', 'inputTokens', 'intent', 'model', 'outcome', 'outputTokens', 'rateLimited', 'role', 'skill', 'user'].sort())
  assert.equal(s.recent[0].user, 'Casey Chen')
  assert.equal(s.recent[0].estimatedCostUsd, 0.002)
})

test('truncation is echoed, never silent', () => {
  const s = summarizeUsage({ rows: [row()], ...NAMES, range: '30d', now: NOW, truncated: true })
  assert.equal(s.truncated, true)
  const panel = read('src/components/settings/KeithUsagePanel.jsx')
  assert.match(panel, /summary\.truncated &&/, 'the UI surfaces the truncation banner')
})

// ── api/keith-usage.js posture ───────────────────────────────────────────────

const endpoint = read('api/keith-usage.js')

test('the endpoint is Owner/Admin only and verifies the caller server-side', () => {
  assert.match(endpoint, /function canViewUsage\(role, isOwner\) \{\s*\n\s*if \(isOwner\) return true\s*\n\s*return role === 'admin'/)
  assert.match(endpoint, /if \(!canViewUsage\(auth\.role, auth\.isOwner\)\) return res\.status\(403\)/)
  assert.match(endpoint, /auth\.getUser\(\)/)
  assert.match(endpoint, /if \(profile\.is_active === false\) return \{ authenticated: false, status: 403/)
  // Co-Lead is NOT on the predicate: usage and spend stay Owner/Admin in v1.
  const gate = endpoint.slice(endpoint.indexOf('function canViewUsage'), endpoint.indexOf('export default'))
  assert.doesNotMatch(gate, /co-lead|interviewer|viewer/)
})

test('the endpoint uses the strict action allow-list pattern', () => {
  assert.match(endpoint, /const ACTION_SCHEMAS = \{\s*\n\s*usage_summary: \['range'\],\s*\n\}/)
  assert.match(endpoint, /unexpected_field/)
  assert.match(endpoint, /unknown_action/)
  assert.match(endpoint, /method_not_allowed/)
  assert.match(endpoint, /Cache-Control', 'no-store/)
})

test('the endpoint ships metadata only and reports its own cap', () => {
  // The select list is a closed metadata set; request_id is deliberately absent.
  assert.match(endpoint, /const USAGE_COLUMNS = 'id, created_at, profile_id, role, intent, skill_id, model, model_route, input_tokens, output_tokens, duration_ms, outcome, rate_limited'/)
  const cols = /const USAGE_COLUMNS = '([^']+)'/.exec(endpoint)[1]
  assert.ok(!cols.includes('request_id'), 'request_id correlates server logs; the browser has no use for it')
  assert.match(endpoint, /const ROW_CAP = 10000/)
  assert.match(endpoint, /\.limit\(ROW_CAP\)/)
  assert.match(endpoint, /truncated = usage\.length >= ROW_CAP/)
  assert.match(endpoint, /row cap hit/, 'hitting the cap is logged, not silent')
  // Label lookups are bounded to ids present in the window.
  assert.match(endpoint, /\.in\('id', skillIds\)/)
  assert.match(endpoint, /\.in\('id', profileIds\)/)
})

test('range input is validated against the closed range list', () => {
  assert.match(endpoint, /USAGE_RANGES\.includes\(body\.range\) \? body\.range : '30d'/)
})

// ── No secret, no direct table read, no content in the client ────────────────

test('the client bundle carries no Anthropic credential or billing API call', () => {
  const panel = read('src/components/settings/KeithUsagePanel.jsx')
  // "Anthropic" appears legitimately in user-facing copy; the pin targets
  // credential and API shapes, not the word.
  assert.doesNotMatch(panel, /ANTHROPIC_API|api\.anthropic\.com|x-api-key|sk-ant-/i)
  // The only network call is the app's own protected endpoint.
  assert.match(panel, /fetch\('\/api\/keith-usage'/)
  const fetches = [...panel.matchAll(/fetch\(/g)]
  assert.equal(fetches.length, 1, 'exactly one fetch target: the governed endpoint')
  // And it never reads Keith audit tables through the browser client.
  assert.doesNotMatch(panel, /from\('keith_requests'\)|from\('keith_skill_invocations'\)/)
})

test('every dollar figure the client shows is labelled an estimate', () => {
  const panel = read('src/components/settings/KeithUsagePanel.jsx')
  assert.match(panel, /label: 'Est\. cost'/)
  assert.match(panel, /label="Estimated cost"/)
  assert.match(panel, /Pricing unavailable/)
  assert.match(panel, /billing authority/)
  assert.match(panel, /platform\.claude\.com/, 'reconciliation links out to the Console')
  assert.match(panel, /rel="noopener noreferrer"/)
})

test('the panel guards access and keeps the house loading/error/empty states', () => {
  const panel = read('src/components/settings/KeithUsagePanel.jsx')
  assert.match(panel, /const allowed = isAdmin/)
  assert.match(panel, /You don’t have access to Keith usage\./)
  assert.match(panel, /Loading Keith usage…/)
  assert.match(panel, /We couldn’t load Keith usage\. Please try again\./)
  assert.match(panel, /No Keith activity in this period/)
  // The KPI names the metric it actually computes.
  assert.match(panel, /label="Success rate"/)
  assert.doesNotMatch(panel, /label="Operational health"/)
  assert.match(panel, /Rate-limited, denied, and missing-data requests are tracked here as separate signals and do not affect it\./)
  // Range control is the accessible SegmentedTabs primitive, defaulting to 30d.
  assert.match(panel, /useState\('30d'\)/)
  assert.match(panel, /<SegmentedTabs label="Usage time range"/)
  // The trend chart carries a text alternative.
  assert.match(panel, /role="img"/)
  assert.match(panel, /aria-label=\{label\}/)
  // Wide recent table scrolls in its own container, not the page.
  assert.match(panel, /overflowX: 'auto'/)
})

test('sub-cent costs render four decimals instead of a false $0.00', async () => {
  const { fmtUsd } = await import('../src/components/settings/KeithUsagePanel.jsx')
    .catch(() => ({ fmtUsd: null }))
  if (fmtUsd) {
    assert.equal(fmtUsd(0.0055), '$0.0055')
    assert.equal(fmtUsd(1.5), '$1.50')
    assert.equal(fmtUsd(0), '$0.00')
  } else {
    // JSX cannot be imported under node:test without a loader; pin the source.
    const panel = read('src/components/settings/KeithUsagePanel.jsx')
    assert.match(panel, /Math\.abs\(n\) > 0 && Math\.abs\(n\) < 0\.01 \? 4 : 2/)
  }
})

// ── No production-behavior drift ─────────────────────────────────────────────

test('this feature adds no SQL and touches no Keith runtime behavior', () => {
  // No new migration file for this feature: the audit found the P0 schema
  // sufficient (keith_requests already records model, tokens, duration,
  // outcome, and attribution).
  assert.doesNotMatch(endpoint, /CREATE TABLE|CREATE POLICY|GRANT |REVOKE /)
  // keith.js (the runtime) is not imported and not modified by the usage page.
  assert.doesNotMatch(endpoint, /from '\.\/keith\.js'|resumeInterviewQuestions|skillAuthorization/)
  // The pricing module is server-side only: no src/ import may reach it.
  const panel = read('src/components/settings/KeithUsagePanel.jsx')
  assert.doesNotMatch(panel, /lib\/server/)
})
