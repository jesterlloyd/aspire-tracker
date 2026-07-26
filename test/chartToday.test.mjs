// ASPIRE-CHART / ASPIRE-MASTHEAD: static-source guards for the At a Glance
// landing (Aggregate route). Masthead-first hierarchy, digest parity with the
// attention engine, the promoted live strip, the merged snapshot, honest
// error states, and the responsive reflow.
// Run: node --test test/chartToday.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const overview = read('src/components/OverviewTab.jsx')
const masthead = read('src/components/TodayMasthead.jsx')
const app = read('src/App.jsx')
const css = read('src/index.css')

test('masthead-first hierarchy', async (t) => {
  await t.test('masthead, then digest, then live strip, then snapshot, then sticky ledgers', () => {
    const mast = overview.indexOf('<TodayMasthead')
    const digest = overview.indexOf('<AttentionDigest')
    const live = overview.indexOf('<OnCampusStrip')
    const snap = overview.indexOf('<PlacementSnapshot')
    const sticky = overview.indexOf('aggregate-sticky-header')
    assert.ok(mast > 0 && digest > mast && live > digest && snap > live && sticky > snap,
      'masthead -> digest -> live strip -> snapshot -> sticky ledger headers')
  })

  await t.test('the page greets exactly once: the welcome band is retired', () => {
    assert.ok(!existsSync(join(here, '..', 'src/components/AggregateWelcome.jsx')), 'AggregateWelcome.jsx deleted')
    assert.doesNotMatch(overview, /AggregateWelcome/)
    // The masthead heading is the route's h1 and its one Fraunces moment.
    assert.match(masthead, /<h1 className="chart-route-title mast-greet">\{heading\}<\/h1>/)
  })

  await t.test('the digest reads the SAME attention sets as the bell badge', () => {
    assert.match(app, /attention=\{\{ eager: eagerAttention, lazy: lazyAttention, supportUnreadCount \}\}/)
    assert.match(overview, /function AttentionDigest\(\{ attention, onOpenActionCenter \}\)/)
    // No second derivation inside the digest - counts come from the passed sets.
    const digest = overview.slice(overview.indexOf('function AttentionDigest'), overview.indexOf('export default function OverviewTab'))
    assert.doesNotMatch(digest, /deriveEagerAttention|supabase|useQuery/)
    assert.match(digest, /All caught up/)
  })

  await t.test('digest chips open the Action Center and label their counts', () => {
    assert.match(overview, /onClick=\{onOpenActionCenter\}/)
    assert.match(overview, /open \$\{g\.count === 1 \? 'action' : 'actions'\}\. Open Action Center\./)
  })
})

test('the masthead absorbs the welcome band honestly', async (t) => {
  await t.test('last-visit line keeps the honest browser-scoped wording', () => {
    assert.match(masthead, /aspire:lastVisit:\$\{currentUserId\}:\$\{cohortId\}/)
    assert.match(masthead, /Last visit on this browser/)
    assert.match(masthead, /students\.filter\(s => s\.created_at && s\.created_at > lastVisit\)/)
  })

  await t.test('events reuse the gated endpoint and query key, gated to the visible route', () => {
    assert.match(masthead, /queryKey: \['aggregate_welcome_events', today, to\]/)
    assert.match(masthead, /fetch\('\/api\/aspire-events'/)
    assert.match(masthead, /enabled: onTodayRoute !== false/)
  })

  await t.test('the weather scene survives as the compact masthead variant', () => {
    assert.match(masthead, /import \{ WeatherMasthead \} from '\.\/WeatherScene'/)
    const wx = read('src/components/WeatherScene.jsx')
    // Same scenes and animations; only resized/repositioned per the approval (enlarged for presence).
    assert.match(wx, /export function WeatherMasthead\(\)/)
    assert.match(wx, /manifest\s*\?\s*<AssetScene manifest=\{manifest\} onBroken=\{\(\) => setAssetsBroken\(true\)\} \/>\s*:\s*<SceneSvg scene=\{scene\} \/>/)
    assert.match(css, /\.wx-mast \.wx-svg \{ width: 178px; \}/)
  })

  await t.test('the Today-in-ASPIRE line renders only when it has content', () => {
    assert.match(masthead, /\{hasTodayLine && \(/)
  })
})

test('the promoted live strip', async (t) => {
  await t.test('renders nothing when no one is on campus', () => {
    assert.match(overview, /if \(!mergedCampusLogs\.length\) return null/)
  })
  await t.test('keeps the hedged overdue wording and honest shift badges', () => {
    assert.match(overview, /Clock-out may be overdue/)
    assert.match(overview, /shiftBadge\(shiftTypeOf\(log\)\)/)
  })
  await t.test('the pulse dot freezes under reduced motion', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.mast-live-dot \{ animation: none; \} \}/)
  })
})

test('the merged Placement Snapshot', async (t) => {
  await t.test('open slots derive live; the stored slots_remaining is not a display source', () => {
    assert.match(overview, /const openSlotsLive\s+= Math\.max\(0, netRemaining\)/)
    // No code reads the stored field (comments may still name it).
    assert.doesNotMatch(overview, /u\.slots_remaining|\.slots_remaining \|\|/)
  })
  await t.test('the coverage bar keeps the gauge composition math and speaks its counts', () => {
    assert.match(overview, /Math\.min\(Math\.max\(0, totalSlots - placedCount\), Math\.max\(0, totalDemand - placedCount\)\)/)
    assert.match(overview, /role="img" aria-label=\{barLabel\}/)
    assert.match(overview, /awaiting placement, \$\{unmatched\} over capacity/)
  })
  await t.test('segments use the theme gauge tokens (dark mode is token-level)', () => {
    assert.match(overview, /var\(--gauge-segment-placed/)
    assert.match(overview, /var\(--gauge-segment-awaiting/)
    assert.match(overview, /var\(--gauge-segment-over/)
    assert.match(css, /\.snap-bar \{[^}]*var\(--gauge-segment-base/)
  })
  await t.test('the retired gauge and glance band are gone', () => {
    assert.doesNotMatch(overview, /CapacityCoverageGauge|ProgramAtAGlance|annularPath/)
  })
})

test('honest error states', () => {
  assert.match(overview, /error:\s*campusError/)
  assert.match(overview, /error: unitResponsesError/)
  assert.match(overview, /className="today-error" role="alert"/)
  assert.match(overview, /Unit responses could not load/)
})

test('ledger group rows are real buttons', () => {
  const rows = overview.match(/className="ov-group-row"/g) || []
  assert.equal(rows.length, 3, 'three group-row call sites')
  // Every call site is a real button, and every one declares its state.
  const buttons = overview.match(/<button type="button" className="ov-group-row"/g) || []
  assert.equal(buttons.length, 3, 'all three are buttons')
  const expanded = overview.match(/className="ov-group-row" onClick=\{[^}]*\}[^>]*? aria-expanded=\{!!open\}/g) || []
  assert.equal(expanded.length, 3, 'all three carry aria-expanded')
  assert.match(css, /button\.ov-group-row \{[\s\S]*?text-align: left;/)
})

test('responsive reflow of the operational surfaces', async (t) => {
  await t.test('panels and headers stack below 900px', () => {
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.aggregate-panel-headers, \.ov-panels-body \{ grid-template-columns: 1fr; \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.overview-tab \{ height: auto; overflow-y: visible; \}/)
  })
  await t.test('the KPI grid reflows (column count lives in CSS, not inline)', () => {
    assert.match(overview, /className="glance-kpis snap-kpis"/)
    assert.doesNotMatch(overview, /gridTemplateColumns: 'repeat\(5, 1fr\)'/)
    assert.match(css, /\.glance-kpis \{ grid-template-columns: repeat\(5, 1fr\); \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.glance-kpis \{ grid-template-columns: repeat\(3, 1fr\); \}/)
  })
  await t.test('at phone widths the gap KPI spans the row and the greeting wraps', () => {
    assert.match(css, /@media \(max-width: 560px\) \{[\s\S]*?\.glance-kpis > \*:last-child \{ grid-column: 1 \/ -1; \}/)
    assert.match(css, /@media \(max-width: 560px\) \{[\s\S]*?\.mast-greet \{ font-size: 24px; white-space: normal; \}/)
  })
})

test('the digest count chip is the approved red-count use only', () => {
  assert.match(css, /\.today-digest-count \{[\s\S]*?background: var\(--cs-red, #DC1E34\); color: #fff;/)
  // Warnings stay amber: the error banner is warn-toned, not red.
  assert.match(css, /\.today-error \{[\s\S]*?var\(--chart-warn-bg/)
})
