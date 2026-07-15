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
    // 94vw leaves ~3vw gutters each side; never 100vw (which would overflow).
    assert.doesNotMatch(css, /\.ptl-main \{[^}]*width: 100vw/)
    assert.match(css, /width: 94vw/)
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
  await t.test('Need Help renders three interactive action rows plus the email + copy', () => {
    const actionRows = portal.match(/className="ptl-help-action"/g) || []
    assert.equal(actionRows.length, 3, 'exactly three action rows')
    assert.match(portal, /Request a profile correction/)
    assert.match(portal, /aspire@cshs\.org/)
    assert.match(portal, /Copy the ASPIRE email address/)
  })
  await t.test('the action rows preserve their existing destinations and handlers', () => {
    // Log a Shift -> /shift-log (no identifiers); Contact -> onContact; correction -> openEdit.
    assert.match(portal, /className="ptl-help-action" href="\/shift-log"/)
    assert.match(portal, /className="ptl-help-action" onClick=\{onContact\}/)
    assert.match(portal, /className="ptl-help-action" onClick=\{openEdit\}/)
  })
  await t.test('the action rows are styled interactive (icon, hover, focus, touch target)', () => {
    assert.match(css, /\.ptl-help-action \{[\s\S]*?min-height: 56px/)
    assert.match(css, /\.ptl-help-action:hover \{/)
    assert.match(css, /\.ptl-help-action:focus-visible \{[^}]*outline:/)
    assert.match(css, /\.ptl-help-action-icon \{/)
  })
})

test('desktop refinements (tighter hero, larger stage, upcoming contrast, documents)', async (t) => {
  await t.test('the desktop hero is compact and content-driven (no fixed/min height)', () => {
    // ~22px vertical padding, columns vertically centered, actions grouped with
    // identity (gap, not a bottom-pushing margin).
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-hero \{ padding: 22px 28px; \}/)
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-hero-top \{ align-items: center; \}/)
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-hero-main \{ gap: 14px; \}/)
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-hero-actions \{ margin-top: 0; \}/)
    // No restrictive desktop min-height or vertical space-between on the hero.
    assert.doesNotMatch(css, /\.ptl-hero \{[^}]*min-height/)
    assert.doesNotMatch(css, /\.ptl-hero-top \{[^}]*flex-direction: column[^}]*space-between/)
  })
  await t.test('actions are grouped with identity in the left column', () => {
    // ptl-hero-main wraps the identity AND the actions (actions no longer a
    // separate sibling row after ptl-hero-top).
    assert.match(portal, /<div className="ptl-hero-main">[\s\S]*?ptl-hero-id[\s\S]*?ptl-hero-actions[\s\S]*?<\/div>\s*\{\/\* Right column/)
    assert.match(css, /\.ptl-hero-main \{ display: flex; flex-direction: column;/)
  })
  await t.test('Edit Profile and the Current Stage panel share the right-side column', () => {
    assert.match(portal, /<div className="ptl-hero-aside">\s*<button[^>]*ptl-edit-btn[\s\S]*?Edit Profile[\s\S]*?ptl-hero-stage/)
  })
  await t.test('the desktop avatar remains 104px', () => {
    assert.match(css, /\.ptl-hero \.ptl-avatar \{ width: 104px; height: 104px;/)
  })
  await t.test('the Current Stage panel gains scale (wider, larger value + next text)', () => {
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-hero-stage \{[^}]*min-width: 248px/)
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-stage-value \{ font-size: 18px/)
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*?\.ptl-stage-next \{ font-size: 14px/)
  })
  await t.test('Upcoming timeline states gain readable contrast but stay quieter', () => {
    // Darker label, darker mark border, and a bordered badge distinguish Upcoming
    // by treatment (not color alone) while remaining quieter than Current/Complete.
    assert.match(css, /\.ptl-tl-upcoming \.ptl-tl-label \{ color: #55607a/)
    assert.match(css, /\.ptl-tl-upcoming \.ptl-tl-mark \{ border-color: #a49d8d/)
    assert.match(css, /\.ptl-tl-upcoming \.ptl-tl-state \{[^}]*border: 1px solid/)
  })
  await t.test('Documents shows two clearly separated, bordered document rows', () => {
    assert.match(portal, /className="ptl-doc-list"/)
    assert.match(css, /\.ptl-doc-list \{ display: flex;[^}]*gap: 12px/)
    assert.match(css, /\.ptl-doc-row \{ padding: 14px; border: 1px solid [^;]+; border-radius: 11px;/)
  })
  await t.test('Clinical Hours empty state stays compact (capped width)', () => {
    assert.match(css, /\.ptl-empty \{ max-width: 420px; \}/)
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
