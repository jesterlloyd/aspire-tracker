// RESIDENCY-TOOLTIPS-1 + RESIDENCY-PORTAL-WIDTH-1 (Owner, 2026-10-05).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('TOOLTIPS 1: Residency uses the canonical Tooltip, never the browser\'s title tooltip', () => {
  const files = [
    ...readdirSync(new URL('../src/components/ngrp/', import.meta.url)).filter(f => f.endsWith('.jsx')).map(f => `src/components/ngrp/${f}`),
    'src/components/documents/ResumeReviewDrawer.jsx', 'src/components/documents/StudentDocumentsDrawer.jsx',
  ]
  const bad = []
  for (const f of files) {
    const src = read(f).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    // An HTML element (lower-case tag) carrying title= on its own tag.
    for (const m of src.matchAll(/<([a-z][a-z0-9]*)\b[^<>]*?\stitle=/g)) bad.push(`${f}: <${m[1]} title=`)
  }
  assert.deepEqual(bad, [])
})

test('WIDTH 1: the Residency Portal takes the staff app\'s column, and the pinned bar sits under the portal header', () => {
  const css = read('src/portal/portal.css')
  assert.match(css, /\.ptl-main\.ptl-main-app \{\s*width: min\(100% - 140px, 1580px\); max-width: none;/)
  assert.match(read('src/index.css'), /\.app-main \{ width: min\(100% - 140px, 1580px\);/, 'the same column as the staff app')
  assert.match(read('src/portal/PortalApp.jsx'), /weeklyDigest=\{residencyDigest\}\s*\n\s*mainWidth="app"/)
  assert.match(read('src/components/student/useChartViewport.js'), /const CHROME_SELECTOR = '\.top-section, \.ptl-topsection'/)
})

test('SCROLL 2: a page in the staff app\'s column has no footer or bottom padding, as the staff app has none', () => {
  const shell = read('src/portal/PortalShell.jsx')
  assert.match(shell, /\{mainWidth !== 'app' && \(\s*<footer className="ptl-footer">/)
  assert.match(read('src/portal/portal.css'), /\.ptl-main\.ptl-main-app \{[^}]*padding-bottom: 0;/)
})

// PORTAL-TOOLBAR-Z-1 (2026-10-07): the pinned toolbar never draws over a portal's chrome or its menus.
test('PORTAL-TOOLBAR-Z-1: the pinned toolbar sits under the portal chrome', () => {
  const css = readFileSync(new URL('../src/components/ngrp/ngrp.css', import.meta.url), 'utf8')
  const portal = readFileSync(new URL('../src/portal/portal.css', import.meta.url), 'utf8')
  assert.match(css, /\.ptl-page \.profiles-toolbar \{ z-index: 10; \}/)
  assert.match(portal, /\.ptl-topsection \{ position: sticky; top: 0; z-index: 20; \}/)
})
