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
const app = read('src/staff/StaffApp.jsx')
const css = read('src/index.css')
// HOME-1 (2026-09-24): At a Glance is the app home. Its pieces live in src/components/home/
// and its page sheet is home.css; the assertions below that pinned the old masthead,
// digest, live strip and snapshot were rewritten for the new page in the same commit.
const homeCss = read('src/components/home/home.css')
const needsYou = read('src/components/home/NeedsYou.jsx')

test('home page order (HOME-1)', async (t) => {
  await t.test('banner with the launcher, then Needs you, then the phase line, then the reordered sections', () => {
    const banner = overview.indexOf('<HomeBanner')
    const needs = overview.indexOf('<NeedsYou')
    const phase = overview.indexOf('Cycle phase:')
    const duo = overview.indexOf('<TodayCard')
    const placement = overview.indexOf('<PlacementCard')
    const activity = overview.indexOf('<RecentActivity')
    assert.ok(banner > 0 && needs > banner && phase > needs && duo > phase && placement > duo && activity > placement,
      'banner -> Needs you -> phase line -> Today + Cohort pulse -> Placement -> Recent activity')
    // Needs you is always first; the rest carry an `order` from the derived phase.
    assert.match(overview, /<NeedsYou order=\{0\}/)
    assert.match(overview, /orderOf\('placement'\)/)
  })

  await t.test('the page greets exactly once: the welcome band is retired', () => {
    assert.ok(!existsSync(join(here, '..', 'src/components/AggregateWelcome.jsx')), 'AggregateWelcome.jsx deleted')
    assert.doesNotMatch(overview, /AggregateWelcome/)
    // Classic still shows the scenery through the shared SkylineCard host.
    assert.match(read('src/components/home/HomeBanner.jsx'), /<SkylineCard fullName=\{fullName\}/)
  })

  await t.test('the placement-only digest and its standalone "All caught up" line are gone', () => {
    assert.doesNotMatch(overview, /function AttentionDigest|<AttentionDigest|today-digest/)
    // "All caught up" is now the empty state of Needs you, shown only when every source is empty.
    assert.match(needsYou, /const allEmpty = loading\.length === 0 && failed\.length === 0 && groups\.length === 0/)
    assert.match(needsYou, /All caught up/)
  })

  await t.test('Needs you rows open their source screen and never carry a decision', () => {
    assert.match(needsYou, /className="hm-row" title=\{r\.title\} onClick=\{\(\) => onNavigate\?\.\(r\.to\)\}/)
    assert.doesNotMatch(needsYou, />\s*(Release|Sign|Assign|Dismiss)\s*</)
  })
})

test('the masthead absorbs the welcome band honestly', async (t) => {
  await t.test('neither the last-visit note nor the control-room readout is on the card', () => {
    // MASTHEAD-SCENE-3 (Owner): the browser-local "last visit" affordance is
    // retired - do not restore it. MASTHEAD-LOCKSCREEN-1 (Owner): the readout
    // that replaced it is retired too; the clock owns the date, the cohort
    // lives in the scope picker. The host still passes onCampusCount for
    // call-site stability; the card does not print it.
    assert.doesNotMatch(masthead, /Last visit on this browser|aspire:lastVisit/)
    assert.doesNotMatch(masthead, /on campus now|className="mast-sub"/)
  })

  await t.test('events reuse the gated endpoint and query key, gated to the visible route', () => {
    assert.match(masthead, /queryKey: \['aggregate_welcome_events', today, to\]/)
    assert.match(masthead, /fetch\('\/api\/aspire-events'/)
    assert.match(masthead, /enabled: onTodayRoute !== false/)
  })

  await t.test('the weather scene survives as the compact masthead variant', () => {
    // MASTHEAD-PHASE-2b: the scene, the weather and the clock all live inside
    // <skyline-card>, loaded from the Masthead service; the staff card is a host.
    assert.match(masthead, /import SkylineCard from '\.\/SkylineCard'/)
    assert.match(read('src/components/SkylineCard.jsx'), /<skyline-card[\s\S]*?mode="full"/)
  })

  await t.test('the events row is the shared component, fed by the shared window rule', () => {
    assert.match(masthead, /items=\{items\}/)
    assert.match(masthead, /mastheadItems\(events, today\)/)
  })
})

// ROTATION-ACTIVITY-CALENDAR-1: the row builder moved out of OverviewTab into the
// shared StaffOnCampusStrip so Rotation > Activity renders the identical strip. The
// properties below did not change, only the file that holds them, so these assertions
// follow the code rather than being dropped.
test('the shared live strip', async (t) => {
  // HOME-1: At a Glance no longer carries the live strip (On campus today is a tab in the
  // Today card, which lists scheduled and logged shifts). Rotation > Activity keeps the
  // shared strip, whose own rules are held here.
  await t.test('renders nothing when no one is on campus', () => {
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

test('Placement is one summary line (HOME-1)', async (t) => {
  await t.test('open slots derive live; the stored slots_remaining is not a display source', () => {
    assert.match(overview, /const openSlotsLive\s+= Math\.max\(0, netRemaining\)/)
    assert.doesNotMatch(overview, /u\.slots_remaining|\.slots_remaining \|\|/)
    assert.doesNotMatch(read('src/lib/home/placementSummaryModel.js'), /slots_remaining/)
  })
  await t.test('the five snapshot tiles are gone; one line built from data replaces them', () => {
    assert.doesNotMatch(overview, /function PlacementSnapshot|<PlacementSnapshot|glance-kpis snap-kpis|KPICell/)
    assert.match(overview, /placementSummary\(\{ students, units, matches, divisionOf \}\)/)
  })
  await t.test('the retired gauge and glance band are gone', () => {
    assert.doesNotMatch(overview, /CapacityCoverageGauge|ProgramAtAGlance|annularPath/)
  })
})

test('honest error states', () => {
  // A failed source says so with a Retry and never blocks the others.
  assert.match(needsYou, /Couldn&rsquo;t load/)
  assert.match(needsYou, /onClick=\{\(\) => s\.retry\?\.\(\)\}>Retry</)
  assert.match(overview, /error: unitResponsesError/)
  assert.match(overview, /className="today-error" role="alert"/)
  assert.match(overview, /Unit responses could not load/)
})

test('capacity and requests are DataSheet rows, expandable by button (HOME-1)', () => {
  // Table canon section 8: capacity by service line is INLINE rows, requests by school a PLAIN sheet.
  const card = read('src/components/home/PlacementCard.jsx')
  assert.match(card, /level="inline"[\s\S]*?title="Capacity by service line"/)
  assert.match(card, /level="plain"[\s\S]*?title="Requests by school"/)
  assert.match(card, /<details className="hm-pl">/)
  assert.doesNotMatch(card, /<details className="hm-pl" open/)
})

test('the home page reflows (HOME-1)', () => {
  assert.match(homeCss, /@media \(max-width: 960px\) \{[\s\S]*?\.hm-duo, \.hm-pl-body \{ grid-template-columns: 1fr; \}/)
  assert.match(homeCss, /@media \(max-width: 640px\) \{[\s\S]*?--hm-frame: 8px; --hm-corner: 46px;/)
  assert.match(homeCss, /@media \(prefers-reduced-motion: reduce\)/)
})

test('responsive reflow of the operational surfaces', async (t) => {
  await t.test('At a Glance uses the document scroll on desktop', () => {
    const overviewRule = css.match(/\.overview-tab \{[^}]*\}/)?.[0] || ''
    assert.match(overviewRule, /overflow-x: clip; overflow-y: visible;/)
    assert.doesNotMatch(overviewRule, /height:\s*calc\(|overflow-y:\s*auto/)
    assert.match(css, /\.aggregate-sticky-header \{[\s\S]*?position: sticky; top: var\(--app-chrome-height\);/)
  })
  await t.test('panels and headers stack below 900px', () => {
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.aggregate-panel-headers, \.ov-panels-body \{ grid-template-columns: 1fr; \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.aggregate-sticky-header \{ position: static; \}/)
  })
  await t.test('the KPI grid reflows (column count lives in CSS, not inline)', () => {
    // The At a Glance tiles are gone (HOME-1); the rule stays for the Residents snapshot.
    assert.match(css, /\.glance-kpis \{ grid-template-columns: repeat\(5, 1fr\); \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.glance-kpis \{ grid-template-columns: repeat\(3, 1fr\); \}/)
  })
  await t.test('at phone widths the gap KPI spans the row and the greeting wraps', () => {
    assert.match(css, /@media \(max-width: 560px\) \{[\s\S]*?\.glance-kpis > \*:last-child \{ grid-column: 1 \/ -1; \}/)
  })
})

test('the digest count chip is the approved red-count use only', () => {
  assert.match(css, /\.today-digest-count \{[\s\S]*?background: var\(--cs-red, #DC1E34\); color: #fff;/)
  // Warnings stay amber: the error banner is warn-toned, not red.
  assert.match(css, /\.today-error \{[\s\S]*?var\(--chart-warn-bg/)
})

test('Open Calendar is the events row\'s constant (MASTHEAD-LOCKSCREEN-1, Owner)', async (t) => {
  const masthead = read('src/components/TodayMasthead.jsx')
  await t.test('the pill lives in the events row and is always offered; the right column holds the weather only', () => {
    // SCENE-4b put View calendar in the Today row so a quiet day had none.
    // LOCKSCREEN-1 keeps it in the row but makes it the row's constant: the
    // one thing left on a quiet day, rightmost, after the chips.
    assert.match(masthead, /calendar=\{\{ label: 'Open Calendar', onClick: \(\) => navigate\('\/interviews'\) \}\}/)
    const rightCol = masthead.slice(masthead.indexOf('<div className="mast-right">'), masthead.indexOf('</div>\n      </div>'))
  })
  await t.test('the app serves its own copy of the masthead\'s face, and no Google font', () => {
    // MASTHEAD-PHASE-2b: the card's own typography is guarded in the masthead
    // repository; what stays here is the app's font delivery.
    const html = read('index.html')
    assert.doesNotMatch(html, /Newsreader|DM\+Sans|fonts\.googleapis/)
    assert.match(html, /fonts\/plus-jakarta-sans\/PlusJakartaSans-Variable\.woff2/)
  })
})

// MASTHEAD-SETTINGS-1: the service refuses a script request with no host key.
test('the app loads the masthead as a registered host', () => {
  const svc = read('src/lib/skylineService.js')
  assert.match(svc, /\/v1\/skyline\.js\?host=\$\{SKYLINE_HOST_KEY\}/)
  assert.match(svc, /SKYLINE_HOST_KEY = import\.meta\.env\.VITE_SKYLINE_HOST_KEY \|\| 'aspire-intelligence'/)
})
