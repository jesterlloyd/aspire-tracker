// ASPIRE-CHART: static-source guards for the Today landing (Aggregate).
// Triage-first hierarchy, digest parity with the attention engine, the
// demoted welcome band, honest error states, and the responsive reflow the
// operational panels never had.
// Run: node --test test/chartToday.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const overview = read('src/components/OverviewTab.jsx')
const app = read('src/App.jsx')
const css = read('src/index.css')

test('triage-first hierarchy', async (t) => {
  await t.test('Today leads: route title, then digest, then operations', () => {
    const title = overview.indexOf('className="chart-route-title today-title"')
    const digest = overview.indexOf('<AttentionDigest')
    const sticky = overview.indexOf('aggregate-sticky-header')
    assert.ok(title > 0 && digest > title && sticky > digest, 'title -> digest -> operational header')
  })

  await t.test('the welcome band is demoted below the operational content', () => {
    const panels = overview.indexOf('className="ov-panels-body"')
    const welcome = overview.indexOf('<AggregateWelcome />')
    assert.ok(panels > 0 && welcome > panels, 'welcome renders after the panels')
  })

  await t.test('the digest reads the SAME attention sets as the bell badge', () => {
    assert.match(app, /attention=\{\{ eager: eagerAttention, lazy: lazyAttention, supportUnreadCount \}\}/)
    assert.match(overview, /function AttentionDigest\(\{ attention, onOpenActionCenter \}\)/)
    // No second derivation inside the digest - counts come from the passed sets.
    const digest = overview.slice(overview.indexOf('function AttentionDigest'), overview.indexOf('function SinceLastVisit'))
    assert.doesNotMatch(digest, /deriveEagerAttention|supabase|useQuery/)
    assert.match(digest, /All caught up/)
  })

  await t.test('digest chips open the Action Center and label their counts', () => {
    assert.match(overview, /onClick=\{onOpenActionCenter\}/)
    assert.match(overview, /open \$\{g\.count === 1 \? 'action' : 'actions'\}\. Open Action Center\./)
  })
})

test('what changed is honest and clearly scoped', () => {
  assert.match(overview, /aspire:lastVisit:\$\{currentUserId\}:\$\{cohortId\}/)
  assert.match(overview, /Last visit on this browser/)
  // Claims only what loaded data proves; no server audit log implied.
  assert.match(overview, /students\.filter\(s => s\.created_at && s\.created_at > lastVisit\)/)
})

test('honest error states', () => {
  assert.match(overview, /error:\s*campusError/)
  assert.match(overview, /error: unitResponsesError/)
  assert.match(overview, /className="today-error" role="alert"/)
  assert.match(overview, /Unit responses could not load/)
})

test('responsive reflow of the operational surfaces', async (t) => {
  await t.test('panels and headers stack below 900px', () => {
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.aggregate-panel-headers, \.ov-panels-body \{ grid-template-columns: 1fr; \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.overview-tab \{ height: auto; overflow-y: visible; \}/)
  })
  await t.test('the KPI grid reflows (column count lives in CSS, not inline)', () => {
    assert.match(overview, /className="glance-kpis"/)
    assert.doesNotMatch(overview, /gridTemplateColumns: 'repeat\(5, 1fr\)'/)
    assert.match(css, /\.glance-kpis \{ grid-template-columns: repeat\(5, 1fr\); \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.glance-kpis \{ grid-template-columns: repeat\(3, 1fr\); \}/)
  })
})

test('the digest count chip is the approved red-count use only', () => {
  assert.match(css, /\.today-digest-count \{[\s\S]*?background: var\(--cs-red, #DC1E34\); color: #fff;/)
  // Warnings stay amber: the error banner is warn-toned, not red.
  assert.match(css, /\.today-error \{[\s\S]*?var\(--chart-warn-bg/)
})
