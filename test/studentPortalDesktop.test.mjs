// ASPIRE-COMPASS: static-source guards for the Student Portal desktop layout
// (fluid workspace, 12-column grid, the Compass orientation band, merged
// Hours & shifts, stage-aware surfaces, and the secure Badge & Certificate
// card). Verifies the mobile-first behavior is preserved and no student id or
// storage URL leaks. Supersedes the ASPIRE-STUDENT-HOME suite after the
// owner-approved Compass redesign.
// Run: node --test test/studentPortalDesktop.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const portal = read('src/portal/StudentPortal.jsx')
const css = read('src/portal/portal.css')

test('desktop workspace and 12-column grid', async (t) => {
  await t.test('the desktop workspace is fluid (94vw) with a large-screen cap >= ~1440px', () => {
    assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*?\.ptl-main \{[^}]*width: 94vw/)
    const capMatch = css.match(/@media \(min-width: 1024px\) \{[\s\S]*?\.ptl-main \{[^}]*max-width: (\d+)px/)
    assert.ok(capMatch, 'desktop .ptl-main must set a max-width cap')
    assert.ok(Number(capMatch[1]) >= 1440, `cap ${capMatch[1]}px must be at least 1440px`)
  })

  await t.test('no old restrictive 1020/1200 max-width remains on the primary workspace', () => {
    assert.doesNotMatch(css, /\.ptl-main \{[^}]*max-width: 10(20|00)px/)
    assert.doesNotMatch(css, /\.ptl-main \{[^}]*max-width: 1200px/)
  })

  await t.test('responsive side gutters remain (fluid vw width, not 100vw overflow)', () => {
    assert.doesNotMatch(css, /\.ptl-main \{[^}]*width: 100vw/)
    assert.match(css, /width: 94vw/)
  })

  await t.test('a purposeful 12-column grid with the specified spans', () => {
    assert.match(css, /\.ptl-grid \{[\s\S]*?grid-template-columns: repeat\(12, 1fr\)/)
    for (const c of ['ptl-col-4', 'ptl-col-5', 'ptl-col-7', 'ptl-col-8']) {
      assert.match(css, new RegExp(`\\.${c}\\s*\\{ grid-column: span`))
    }
  })

  await t.test('Home leads with Rotation Activity and Rotation Progress; My Placement owns the remaining cards', () => {
    // The Home Messages card is gone (no latest-message strip).
    assert.doesNotMatch(portal, /ptl-latest-title/)
    const iCalendar = portal.indexOf('<StudentRotationActivity')
    const iHours = portal.indexOf('id="ptl-hours"')
    const iPlacement = portal.indexOf('>Placement Progress</h2>')
    const iProgress = portal.indexOf('>ASPIRE Status</h2>')
    const iSurveys = portal.indexOf('id="ptl-surveys"')
    assert.ok(iCalendar > 0 && iCalendar < iHours, 'Home order is Rotation Activity, Rotation Progress')
    assert.ok(iPlacement > 0 && iPlacement < iProgress && iProgress < iSurveys,
      'My Placement order is Placement Progress, ASPIRE Status, Surveys')
    // Spans: Placement col-7, Progress col-5, Hours full-width col-12.
    assert.match(portal, /ptl-col-7\$\{placedMoment/)                          // Placement card is col-7
    assert.match(portal, /<section className="ptl-card ptl-section ptl-col-5">/) // Your progress card is col-5
    assert.match(portal, /ptl-col-12\$\{activeRotation[\s\S]{0,40}id="ptl-hours"/) // Hours is full width
  })

  await t.test('tablet collapses to two-up', () => {
    assert.match(css, /@media \(max-width: 1000px\) \{[\s\S]*?\.ptl-col-4, \.ptl-col-5, \.ptl-col-7, \.ptl-col-8 \{ grid-column: span 6/)
  })
})

test('mobile-first layout is preserved', async (t) => {
  await t.test('the grid stacks to a single column on mobile', () => {
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ptl-grid \{ grid-template-columns: 1fr; \}/)
  })

  await t.test('the shared masthead (not a compass band) leads the mobile column', () => {
    // The compass band and its avatar/mobile overrides were removed; the shared masthead aligns
    // flush inside the student column and the flex gap owns the rhythm.
    assert.doesNotMatch(css, /\.ptl-compass/)
    assert.match(css, /\.ptl-student \.mast \{ margin: 0; \}/)
  })
})

test('the home replaces duplicated surfaces', async (t) => {
  await t.test('one progress representation: a single timeline card, no separate hero dots', () => {
    assert.doesNotMatch(portal, /ptl-compass-dots/)
    const timelineCount = (portal.match(/ptl-timeline/g) || []).length
    assert.ok(timelineCount <= 2, 'exactly one timeline list (class + aria usage)')
    assert.doesNotMatch(portal, /ptl-hero-stage|ptl-stage-value/)
  })

  await t.test('exactly one Log a Shift entry point in the home markup', () => {
    const count = (portal.match(/Log a Shift/g) || []).length
    assert.equal(count, 1, `expected 1 Log a Shift, found ${count}`)
  })

  await t.test('exactly two Contact controls: the Support card and the no-record fallback', () => {
    const supportCard = (portal.match(/onClick=\{onContact\}/g) || []).length
    const noRecord = (portal.match(/onClick=\{\(\) => contactAspire\(\{\}\)\}/g) || []).length
    assert.equal(supportCard, 1, 'one Support-card contact control')
    assert.equal(noRecord, 1, 'one no-record fallback contact control')
  })

  await t.test('Rotation Progress is the one hours and log surface with the authoritative total first', () => {
    assert.match(portal, /Rotation Progress/)
    assert.doesNotMatch(portal, />Clinical Hours<\/h2>|>Shift logs<\/h2>/)
    assert.match(portal, /Approved hours/)
  })
})

test('stage-aware surfaces', async (t) => {
  await t.test('quiet and attention treatments exist and are stage-driven', () => {
    assert.match(css, /\.ptl-section-quiet \{/)
    assert.match(css, /\.ptl-section-attend \{/)
    assert.match(portal, /waitingSurveys\.length === 0 \? ' ptl-section-quiet' : ' ptl-section-attend'/)
  })

  await t.test('placement gains a confirmed moment at Placed', () => {
    assert.match(portal, /placedMoment/)
    assert.match(css, /\.ptl-moment \{/)
  })

  await t.test('the certificate moment uses surface and typography, not confetti', () => {
    assert.match(css, /\.ptl-moment-cert \{/)
    assert.match(portal, /Congratulations, \{displayName\}/)
    assert.doesNotMatch(portal, /confetti|celebrate\(/)
  })

  await t.test('the timeline keeps accessible per-step state text', () => {
    assert.match(portal, /\{s\.stateLabel\}/)
    assert.match(css, /\.ptl-tl-upcoming \.ptl-tl-mark/)
  })
})

test('Badge & Certificate security', async (t) => {
  await t.test('renders both the ID Badge and Certificate of Completion', () => {
    assert.match(portal, /ID Badge/)
    assert.match(portal, /Certificate of Completion/)
    assert.match(portal, /deriveBadgeStatus\(/)
    assert.match(portal, /deriveCertificateStatus\(/)
  })

  await t.test('the certificate download button appears only when downloadable', () => {
    assert.match(portal, /\{certStatus\.downloadable \? \(/)
  })

  await t.test('the badge is rendered in the browser by the staff generator, never fetched as a server file', () => {
    assert.match(portal, /import \{ generateBadgePNGs \} from '\.\.\/lib\/badgeGenerator'/)
    assert.match(portal, /const headshotUrl = await fetchPortalHeadshotUrl\(\)/)
    assert.doesNotMatch(portal, /download-badge/)
  })

  await t.test('certificate download uses the authenticated endpoint with NO id in the URL', () => {
    assert.match(portal, /fetch\('\/api\/portal\/download-certificate', \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \}\)/)
    assert.doesNotMatch(portal, /download-certificate\?|download-certificate\/\$\{/)
  })

  await t.test('no raw storage URL, public URL, or signed URL is rendered', () => {
    assert.doesNotMatch(portal, /storage\.from|getPublicUrl|createSignedUrl/)
  })

  await t.test('the download does not navigate the portal tab (blob download)', () => {
    assert.match(portal, /URL\.createObjectURL\(blob\)/)
    assert.match(portal, /URL\.revokeObjectURL\(url\)/)
  })
})

test('accessibility and hygiene', async (t) => {
  await t.test('the hours progress bar is labeled and has value text', () => {
    assert.match(portal, /role="progressbar" aria-label="Approved Clinical Hours"/)
    assert.match(portal, /aria-valuetext=/)
  })

  await t.test('Home and My Placement share a route-aware page-level heading', () => {
    assert.match(portal, /<h1 className="ptl-visually-hidden">\{view === 'placement' \? 'My Placement' : 'Student Portal home'\}<\/h1>/)
  })

  await t.test('Contact ASPIRE still routes through the centralized compose helper', () => {
    assert.match(portal, /composePortalEmail/)
    assert.doesNotMatch(portal, /window\.location\.href = ['"`]mailto/)
  })

  await t.test('record dates route through the null-safe helper (Invalid Date never renders)', () => {
    assert.match(portal, /fmtDate\(/)
    // The only inline toLocaleDateString is the shared masthead's always-valid date label.
    assert.equal((portal.match(/toLocaleDateString/g) || []).length, 1)
  })

  await t.test('no service-role reference leaks into the client bundle', () => {
    assert.doesNotMatch(portal, /SERVICE_ROLE|service_role/i)
  })
})
