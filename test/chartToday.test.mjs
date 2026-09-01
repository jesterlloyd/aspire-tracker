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
const campusStrip = read('src/components/oncampus/StaffOnCampusStrip.jsx')
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
  await t.test('the date line is a control-room readout, not the retired last-visit note', () => {
    // MASTHEAD-SCENE-3 (Owner): the browser-local "last visit" affordance is
    // retired - do not restore it. The line carries live occupancy and
    // today's event tempo instead, each segment omitted at zero.
    assert.doesNotMatch(masthead, /Last visit on this browser|aspire:lastVisit/)
    assert.match(masthead, /onCampusCount > 0 \? ` · \$\{onCampusCount\} on campus now` : ''/)
    assert.match(masthead, /todayEvents\.length > 0 \? ` · \$\{todayEvents\.length\} event\$\{todayEvents\.length === 1 \? '' : 's'\} today` : ''/)
    // The count is the SAME merged rows the On Campus Now strip renders.
    assert.match(read('src/components/OverviewTab.jsx'), /onCampusCount=\{mergedCampusLogs\.length\}/)
  })

  await t.test('events reuse the gated endpoint and query key, gated to the visible route', () => {
    assert.match(masthead, /queryKey: \['aggregate_welcome_events', today, to\]/)
    assert.match(masthead, /fetch\('\/api\/aspire-events'/)
    assert.match(masthead, /enabled: onTodayRoute !== false/)
  })

  await t.test('the weather scene survives as the compact masthead variant', () => {
    // MASTHEAD-SCENE-1: the import carries the unified scene clock (artwork + night state).
    assert.match(masthead, /import \{ WeatherMasthead, useMastheadScene \} from '\.\/WeatherScene'/)
    const wx = read('src/components/WeatherScene.jsx')
    // Same scenes and animations; only resized/repositioned per the approval (enlarged for presence).
    assert.match(wx, /export function WeatherMasthead\(\)/)
    assert.match(wx, /manifest\s*\?\s*<AssetScene manifest=\{manifest\} onBroken=\{\(\) => setAssetsBroken\(true\)\} \/>\s*:\s*<SceneSvg scene=\{scene\} \/>/)
    // MASTHEAD-WEATHER-1: enlarged 178 -> 192.
    assert.match(css, /\.wx-mast \.wx-svg \{ width: 192px; \}/)
  })

  await t.test('the Today-in-ASPIRE line renders only when it has content', () => {
    assert.match(masthead, /\{hasTodayLine && \(/)
  })
})

// ROTATION-ACTIVITY-CALENDAR-1: the row builder moved out of OverviewTab into the
// shared StaffOnCampusStrip so Rotation > Activity renders the identical strip. The
// properties below did not change, only the file that holds them, so these assertions
// follow the code rather than being dropped.
test('the promoted live strip', async (t) => {
  await t.test('renders nothing when no one is on campus', () => {
    // At a Glance still passes no emptyText, so an empty strip renders nothing at all
    // rather than an empty-state card, and the shared component enforces that.
    assert.match(overview, /<StaffOnCampusStrip[\s\S]{0,240}logs=\{mergedCampusLogs\}/)
    assert.doesNotMatch(overview, /<StaffOnCampusStrip[\s\S]{0,240}emptyText/)
    assert.match(campusStrip, /if \(logs\.length === 0 && !emptyText\) return null/)
  })
  await t.test('keeps the hedged overdue wording and honest shift badges', () => {
    assert.match(campusStrip, /Clock-out may be overdue/)
    assert.match(campusStrip, /shiftBadge\(shiftTypeOf\(log\)\)/)
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
  await t.test('PLACEMENT-SECTION-HIERARCHY-1: the coverage bar is retired; the KPI row stands alone', () => {
    // Owner decision: no composition bar and no replacement visualization under the KPI row.
    assert.doesNotMatch(overview, /snap-bar|snap-legend|Capacity coverage|barLabel/)
    assert.doesNotMatch(css, /\.snap-bar|\.snap-legend|\.snap-title \{/)
    // The card title uses the canonical panel-title treatment (same as the ledger cards).
    assert.match(overview, /className="ov-panel-title">Placement Snapshot/)
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
  // STAFF-SCHOOL-RESPONSE-VISIBILITY-1: the Placement Requests school row became a flex wrapper
  // (div.ov-group-row.ov-school-row) holding TWO separate buttons - the accordion toggle
  // (.ov-school-toggle, still a real button with aria-expanded) and the read-only View response
  // action - because a button may never nest inside another button. The two unit-ledger rows
  // remain single full-row buttons.
  const rows = overview.match(/className="ov-group-row"/g) || []
  assert.equal(rows.length, 2, 'two plain group-row call sites (unit ledgers)')
  const buttons = overview.match(/<button type="button" className="ov-group-row"/g) || []
  assert.equal(buttons.length, 2, 'both unit ledger rows are buttons')
  const expanded = overview.match(/className="ov-group-row" onClick=\{[^}]*\}[^>]*? aria-expanded=\{!!open\}/g) || []
  assert.equal(expanded.length, 2, 'both carry aria-expanded')
  // The school row keeps a real toggle button with aria-expanded inside its wrapper.
  assert.match(overview, /className="ov-group-row ov-school-row"/)
  assert.match(overview, /<button type="button" className="ov-school-toggle" onClick=\{\(\) => toggleSchoolGroup\(school\)\} aria-expanded=\{!!open\}/)
  assert.match(css, /button\.ov-group-row \{[\s\S]*?text-align: left;/)
  assert.match(css, /\.ov-school-toggle \{[^}]*text-align: left;/)
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

test('View calendar is as dynamic as the day (SCENE-4b, Owner)', async (t) => {
  const masthead = read('src/components/TodayMasthead.jsx')
  await t.test('the button lives in the Today-in-ASPIRE row, so a quiet day has none', () => {
    // Owner decision: the button appears only when there is something on the
    // calendar to look at. It must sit INSIDE the hasTodayLine block - not in
    // the right column, where it rendered unconditionally.
    const todayBlock = masthead.slice(masthead.indexOf('{hasTodayLine && ('))
    assert.match(todayBlock, /className="mast-cal-btn mast-cal-btn-inline"/)
    const rightCol = masthead.slice(masthead.indexOf('<div className="mast-right">'), masthead.indexOf('</div>\n      </div>'))
    assert.doesNotMatch(rightCol, /mast-cal-btn/, 'the right column holds the weather only')
    // Pushed to the end of the row, past the chips.
    assert.match(read('src/index.css'), /\.mast-cal-btn-inline \{ margin-left: auto; \}/)
  })
  await t.test('the greeting/temperature pair uses the app face, not a display serif', () => {
    const css = read('src/index.css')
    const pair = css.slice(css.indexOf('.mast-scenic .mast-greet,'))
    assert.match(pair, /font-family: 'DM Sans', sans-serif;/)
    assert.doesNotMatch(pair, /Newsreader|Georgia/)
    // The whole app still loads only its two established families.
    assert.doesNotMatch(read('index.html'), /Newsreader/)
  })
})
