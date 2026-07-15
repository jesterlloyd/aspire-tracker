// ASPIRE-STUDENT-HOME: static-source guards for the Student Portal desktop
// redesign (wider workspace, 12-column grid, stronger hero, Next Steps
// timeline, raised Need Help, and the secure Documents card). Verifies the
// mobile-first behavior is preserved and no student id / storage URL leaks.
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
  await t.test('the desktop workspace is widened to ~1180-1240px', () => {
    assert.match(css, /\.ptl-main \{[^}]*max-width: 1200px/)
  })
  await t.test('a purposeful 12-column grid with the specified spans', () => {
    assert.match(css, /\.ptl-grid \{[\s\S]*?grid-template-columns: repeat\(12, 1fr\)/)
    for (const c of ['ptl-col-4', 'ptl-col-5', 'ptl-col-7', 'ptl-col-8']) {
      assert.match(css, new RegExp(`\\.${c}\\s*\\{ grid-column: span`))
    }
  })
  await t.test('the JSX assigns Placement 7 / Hours 5, Next steps 8 / Need help 4, and 4/4/4 below', () => {
    assert.match(portal, /title="Placement"[\s\S]*?cols=\{7\}/)
    assert.match(portal, /title="Clinical hours"[\s\S]*?cols=\{5\}/)
    assert.match(portal, /title="Next steps"[\s\S]*?cols=\{8\}/)
    assert.match(portal, /title="Need help\?"[\s\S]*?cols=\{4\}/)
    assert.match(portal, /title="Evaluations"[\s\S]*?cols=\{4\}/)
    assert.match(portal, /title="Shift logs"[\s\S]*?cols=\{4\}/)
    assert.match(portal, /title="Documents"[\s\S]*?cols=\{4\}/)
  })
  await t.test('tablet collapses to two-up; the lower three become two columns', () => {
    assert.match(css, /@media \(max-width: 1000px\) \{[\s\S]*?\.ptl-col-4, \.ptl-col-5, \.ptl-col-7, \.ptl-col-8 \{ grid-column: span 6/)
  })
})

test('mobile-first layout is preserved', async (t) => {
  await t.test('the grid stacks to a single column on mobile', () => {
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ptl-grid \{ grid-template-columns: 1fr; \}/)
  })
  await t.test('the mobile hero avatar stays 72px (desktop grows to ~104px)', () => {
    assert.match(css, /\.ptl-hero \.ptl-avatar \{ width: 104px; height: 104px;/)
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ptl-hero \.ptl-avatar \{ width: 72px; height: 72px;/)
  })
  await t.test('the desktop current-stage panel is hidden on mobile', () => {
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ptl-hero-stage \{ display: none; \}/)
  })
  await t.test('the mobile sticky action bar remains', () => {
    assert.match(portal, /ptl-actionbar/)
    assert.match(css, /\.ptl-actionbar \{ display: none; \}/)
  })
})

test('profile hero: stronger identity + current-stage panel', async (t) => {
  await t.test('the stage panel derives ONLY from reliable status data', () => {
    assert.match(portal, /const stage = deriveHeroStage\(student\.status\)/)
    assert.match(portal, /\{stage && \(/, 'stage panel only renders when a stage exists')
    assert.match(portal, /ptl-hero-stage/)
    assert.match(portal, /Current stage/)
  })
  await t.test('the stronger name and larger avatar are desktop-scaled', () => {
    assert.match(css, /\.ptl-hero-name \{ font-size: 30px/)
  })
})

test('Need Help is raised above the lower cards', async (t) => {
  await t.test('Need help renders before Evaluations, Shift logs, and Documents in source order', () => {
    const needHelp = portal.indexOf('title="Need help?"')
    const evaluations = portal.indexOf('title="Evaluations"')
    const shiftLogs = portal.indexOf('title="Shift logs"')
    const documents = portal.indexOf('title="Documents"')
    assert.ok(needHelp > 0 && needHelp < evaluations, 'Need help before Evaluations')
    assert.ok(evaluations < shiftLogs && shiftLogs < documents, 'lower row order Eval, Shift, Documents')
  })
  await t.test('Need Help offers Log a Shift, Contact ASPIRE, correction, and the email', () => {
    assert.match(portal, /ptl-help-list/)
    assert.match(portal, /Request a profile correction/)
    assert.match(portal, /onClick=\{openEdit\}/)
    assert.match(portal, /aspire@cshs\.org/)
  })
})

test('Next Steps timeline', async (t) => {
  await t.test('renders the derived timeline with accessible per-step state text', () => {
    assert.match(portal, /derivePortalTimeline\(\{ status: student\.status, certificateUnlocked/)
    assert.match(portal, /ptl-timeline/)
    assert.match(portal, /\{s\.stateLabel\}/, 'state is announced as text, not color alone')
  })
})

test('Documents card', async (t) => {
  await t.test('renders both the ID Badge and Certificate of Completion', () => {
    assert.match(portal, /title="Documents"/)
    assert.match(portal, /ID Badge/)
    assert.match(portal, /Certificate of Completion/)
    assert.match(portal, /deriveBadgeStatus\(/)
    assert.match(portal, /deriveCertificateStatus\(/)
  })
  await t.test('the certificate download button appears only when downloadable', () => {
    assert.match(portal, /certStatus\.downloadable \? \(/)
    assert.match(portal, /Download Certificate/)
    assert.match(portal, /aria-label="Download your Certificate of Completion/)
  })
  await t.test('the badge never renders an active download control (no server-side file)', () => {
    // The portal never calls the badge endpoint from the UI.
    assert.doesNotMatch(portal, /download-badge/)
    assert.doesNotMatch(portal, /Download Badge/)
  })
  await t.test('certificate download uses the authenticated endpoint with NO id in the URL', () => {
    assert.match(portal, /fetch\('\/api\/portal\/download-certificate', \{ headers: \{ Authorization/)
    assert.doesNotMatch(portal, /download-certificate\?[^'"]*(student|id|email)/i)
  })
  await t.test('no raw storage URL, public URL, or signed URL is rendered', () => {
    assert.doesNotMatch(portal, /getPublicUrl|createSignedUrl|storage\.from|supabase\.co\/storage/)
  })
  await t.test('the download does not navigate the portal tab (blob download)', () => {
    assert.match(portal, /URL\.createObjectURL\(blob\)/)
    assert.match(portal, /a\.download = /)
  })
})

test('accessibility and regression', async (t) => {
  await t.test('the clinical-hours progress bar is labeled and has value text', () => {
    assert.match(portal, /role="progressbar" aria-label="Clinical hours completed"/)
    assert.match(portal, /aria-valuetext=\{`\$\{hours\.completed\} of \$\{hours\.required\} hours completed/)
  })
  await t.test('Contact ASPIRE still routes through the centralized compose helper', () => {
    assert.match(portal, /composePortalEmail\(\{ to: SUPPORT, subject: CONTACT_SUBJECT/)
  })
  await t.test('Log a Shift still routes to /shift-log with no student identifiers', () => {
    assert.match(portal, /href="\/shift-log"/)
    assert.doesNotMatch(portal, /shift-log\?[^"']*(student|id|email)/i)
  })
  await t.test('dates route through the null-safe helper (Invalid Date never renders)', () => {
    assert.doesNotMatch(portal, /toLocaleDateString/)
    assert.match(portal, /import \{ fmtDate, placementWindow, TBC \}/)
  })
  await t.test('no service-role reference leaks into the client bundle', () => {
    assert.doesNotMatch(portal, /SERVICE_ROLE|service_role/i)
  })
})
