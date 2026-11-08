// PAGE-TITLE-1 (Owner, 2026-11-08): one rule for page titles, in the staff app and every portal.
// A page a section nav opens draws no visible title (the tab names it); its meta and actions sit
// in one PageBar. A page that stands on its own has one title, at --aspire-page-title-size.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(root, p), 'utf8')
function walk(dir, out = []) {
  for (const f of readdirSync(join(root, dir))) {
    const p = join(dir, f)
    if (statSync(join(root, p)).isDirectory()) walk(p, out)
    else if (/\.jsx$/.test(f) && !/ \d\.jsx$/.test(f)) out.push(p)
  }
  return out
}

test('one page-title size, defined once and read by every full-screen page', () => {
  assert.match(read('src/styles/aspireBrand.css'), /--aspire-page-title-size: 24px;/)
  const readers = [
    ['src/components/catalog/catalog.css', /\.ctl-head h1 \{[^}]*font-size: var\(--aspire-page-title-size/],
    ['src/components/insights/insights.css', /\.ins-head h1 \{[^}]*font-size: var\(--aspire-page-title-size/],
    ['src/portal/portal.css', /\.ptl-connect-title h2 \{[^}]*font-size: var\(--aspire-page-title-size/],
    ['src/pages/Connect.jsx', /fontSize: 'var\(--aspire-page-title-size/],
    ['src/components/settings/settingsSections.js', /fontSize: 'var\(--aspire-page-title-size/],
  ]
  for (const [file, re] of readers) assert.match(read(file), re, `${file} reads the page-title token`)
})

test('portal tab pages draw no visible page title', () => {
  const files = walk('src/portal')
  for (const f of files) {
    const s = read(f)
    assert.doesNotMatch(s, /ptl-plr-title|ptl-page-heading|bud-portal-head|ptl-na-section-heading/, `${f} brings back a retired page title`)
  }
  const chrome = read('src/portal/unit/UnitLeaderChrome.jsx')
  assert.match(chrome, /visible \? 'ptl-section-title' : 'ptl-section-title ptl-visually-hidden'/)
  // The Unit Leader pages the section nav opens keep their heading for screen readers only.
  const ul = [read('src/portal/UnitLeaderPortal.jsx'), read('src/portal/unit/UnitPreceptorsWorkspace.jsx'), read('src/portal/unit/UnitEvaluationsWorkspace.jsx')].join('\n')
  for (const key of ['placements', 'capacity', 'preceptors', 'evaluations']) {
    assert.match(ul, new RegExp(`<SectionHeading focusKey="${key}">`), `${key} is named by its tab`)
  }
  assert.match(read('src/components/insights/InsightsPage.jsx'), /surface === 'leadership'\s*\? <PageName>/)
  assert.match(read('src/portal/na/NursingAcademicsPortal.jsx'), /<PageBar name="Budget Tracker" as="h2"/)
  assert.match(read('src/portal/ap/PlacementRequestsView.jsx'), /<PageBar\s+name="Placement Requests"/)
})

test('PageBar keeps the name for screen readers and takes no room without meta or actions', () => {
  const bar = read('src/components/shared/PageBar.jsx')
  assert.match(bar, /if \(!meta && !actions\) return heading/)
  assert.match(read('src/components/shared/pageBar.css'), /\.aspire-page-name \{[^}]*clip: rect\(0 0 0 0\)/)
  assert.match(read('src/components/shared/pageBar.css'), /margin: 0 0 var\(--aspire-gap-card\)/)
})
