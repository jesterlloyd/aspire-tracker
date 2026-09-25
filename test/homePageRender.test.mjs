// test/homePageRender.test.mjs
//
// HOME-1 (2026-09-25): render the REAL At a Glance page (OverviewTab), signed in as an
// Owner, in Classic and in Modern. homeRenderSmoke covers the pieces; this covers the page
// that wires them, which is where the preview crashed. Same method as headerRenderSmoke:
// Vite's ssrLoadModule plus react-dom/server. Queries do not fetch during a server render,
// so every source is in its loading state; the page must still draw its whole layout.
//
// No .env is needed: dummy public Supabase values are set before Vite starts, because
// src/lib/supabase.js throws at import without them.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

let vite
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})
after(async () => { await vite?.close() })

const OWNER = { id: 'p-owner', role: 'owner', is_owner: true, is_active: true, full_name: 'Test Owner', email: 'owner@example.test' }
const auth = { user: { id: 'u-owner' }, userProfile: OWNER, isOwner: true, isAdmin: true, canEdit: true, canInterview: true, isInterviewer: false, isViewer: false }

const units = [
  { id: 'u1', unit_name: '4 South', division: 'Medical', is_participating: true, total_slots: 2 },
  { id: 'u2', unit_name: 'CSICU', division: 'Critical Care', is_participating: true, total_slots: 1 },
]
const students = [
  { id: 's1', first_name: 'Maya', last_name: 'Okafor', school: 'Cal State LA', status: 'Active Rotation', matched_unit_id: 'u1', hours_required: 180, approved_hours: 60 },
  { id: 's2', first_name: 'Priya', last_name: 'Natarajan', school: 'Cal State Long Beach', status: 'Interviewed', matched_unit_id: null, unit_preference_1: 'CSICU' },
  { id: 's3', first_name: 'Dan', last_name: 'Reyes', school: 'Cal State LA', status: 'Pending Outreach', matched_unit_id: null },
]

async function renderPage(style) {
  const { default: OverviewTab } = await vite.ssrLoadModule('/src/components/OverviewTab.jsx')
  const { AuthContext } = await vite.ssrLoadModule('/src/contexts/AuthContext.jsx')
  const { ThemeContext } = await vite.ssrLoadModule('/src/contexts/ThemeContext.jsx')
  const theme = { colorMode: 'light', effectiveTheme: 'light', systemTheme: 'light', style, paintColorMode: () => {}, paintStyle: () => {} }
  const tree = React.createElement(QueryClientProvider, { client: new QueryClient() },
    React.createElement(MemoryRouter, { initialEntries: ['/aggregate'] },
      React.createElement(AuthContext.Provider, { value: auth },
        React.createElement(ThemeContext.Provider, { value: theme },
          React.createElement(OverviewTab, {
            students, units, cohortId: 'c1', cohort: { id: 'c1', name: 'Fall 2026', status: 'Active' },
            toast: {}, currentUserId: 'u-owner', matches: [], communications: [],
            onOpenStudent: () => {}, onSelectStudent: () => {}, onStudentUpdate: async () => {}, onRefreshUnits: async () => {},
          })))))
  try {
    return renderToStaticMarkup(tree)
  } catch (err) {
    assert.fail(`At a Glance threw while rendering (${style}): ${err.constructor.name}: ${err.message}\n` +
      'A throw here is the error boundary\'s "needs a refresh" screen for every signed-in staff member.')
  }
}

for (const style of ['classic', 'modern']) {
  test(`At a Glance renders for a signed-in Owner in ${style}`, async () => {
    const html = await renderPage(style)
    assert.match(html, /role="combobox"/, 'the launcher')
    assert.match(html, />Needs you</)
    assert.match(html, /aria-busy="true"/, 'sources still loading show skeletons, not "All caught up"')
    assert.doesNotMatch(html, /All caught up/)
    assert.match(html, /Cycle phase: <b>Active rotation<\/b>/)
    assert.match(html, />Today</)
    assert.match(html, />Cohort Pulse</)
    assert.match(html, />Placement</)
    assert.match(html, /<b[^>]*>1 of 3<\/b> slots filled/)
    if (style === 'classic') assert.match(html, /hm-corner-tl/)
    else assert.doesNotMatch(html, /hm-corner/)
  })
}
