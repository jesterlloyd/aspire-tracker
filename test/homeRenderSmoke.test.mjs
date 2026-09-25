// test/homeRenderSmoke.test.mjs
//
// HOME-1 (2026-09-24): the At a Glance home page's presentational pieces actually render.
// Same method as headerRenderSmoke.test.mjs: Vite's ssrLoadModule transforms the .jsx and
// react-dom/server renders it, so a component that throws on render fails here instead of
// taking the staff app's landing page down. Only prop-only components are listed; the page
// itself (OverviewTab) needs router, query and auth context and is not rendered here.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let vite
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})
after(async () => { await vite?.close() })

const load = (path) => vite.ssrLoadModule(path)
function render(Component, props, label) {
  try {
    return renderToStaticMarkup(React.createElement(Component, props))
  } catch (err) {
    assert.fail(`${label} threw while rendering: ${err.constructor.name}: ${err.message}`)
  }
}

const group = {
  key: 'messages', name: 'Messages', sub: 'Support threads', count: 2,
  pills: [{ text: '2 reply', tone: 'amber' }],
  open: { label: 'Open Messages', to: '/connect/messages' },
  rows: [{ id: 'm1', title: 'Maya · Parking', meta: 'They wrote today', pill: { text: 'Today', tone: 'amber' }, to: '/connect/messages?conversation=1' }],
}

test('Needs you renders groups, a skeleton and a failed source side by side', async () => {
  const { default: NeedsYou } = await load('/src/components/home/NeedsYou.jsx')
  const html = render(NeedsYou, { sources: [
    { key: 'messages', status: 'ready', group },
    { key: 'signatures', status: 'loading' },
    { key: 'formsDocs', status: 'error', retry: () => {} },
  ] }, 'NeedsYou')
  assert.match(html, /Needs you/)
  assert.match(html, /Maya · Parking/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /load Forms and documents/)
  assert.doesNotMatch(html, /All caught up/, 'a source still loading or failed is not "caught up"')
})

test('Needs you says All caught up only when every source is ready and empty', async () => {
  const { default: NeedsYou } = await load('/src/components/home/NeedsYou.jsx')
  const html = render(NeedsYou, { sources: [{ key: 'messages', status: 'ready', group: null }, { key: 'placement', status: 'ready', group: null }] }, 'NeedsYou (clear)')
  assert.match(html, /All caught up/)
})

test('Today, Cohort pulse, Placement, Recent activity and the phase cards render', async () => {
  const { default: TodayCard } = await load('/src/components/home/TodayCard.jsx')
  const { default: CohortPulse } = await load('/src/components/home/CohortPulse.jsx')
  const { default: PlacementCard } = await load('/src/components/home/PlacementCard.jsx')
  const { default: RecentActivity } = await load('/src/components/home/RecentActivity.jsx')
  const { ApplicationsOutreach, SurveysResults } = await load('/src/components/home/PhaseCards.jsx')

  const today = render(TodayCard, { dateLabel: 'Thu, Sep 24', schedule: [{ id: 'a', time: '9:00 AM', title: 'Interview · Riley', meta: 'APU', tag: 'Interview', tone: 'navy', inProgress: true, to: '/x' }], campus: { count: 0, groups: [] } }, 'TodayCard')
  assert.match(today, /role="tablist"/)
  assert.match(today, /class="is-now"/)

  const pulse = render(CohortPulse, { cohortName: 'Fall 2026', currentStage: 3, pipeline: [{ key: 'a', label: 'Applied', count: 4 }, { key: 'b', label: 'Interviewed', count: 3 }, { key: 'c', label: 'Placed', count: 2 }, { key: 'd', label: 'Active rotation', count: 2 }, { key: 'e', label: 'Completed', count: 0 }],
    hours: { headline: '1 of 2 past midpoint', ariaLabel: '1 past midpoint, 1 on track, 0 behind', segments: [{ tone: 'green', pct: 50 }], onTrack: 1, behind: 0 } }, 'CohortPulse')
  assert.match(pulse, /aria-current="step"/)
  assert.match(pulse, /aria-label="1 past midpoint, 1 on track, 0 behind"/)

  const placement = render(PlacementCard, { summary: { hostingUnits: 1, clauses: [{ key: 'filled', text: '1 of 2 slots filled', strong: '1 of 2' }] }, capacityRows: [{ id: 'Medical', serviceLine: 'Medical', filled: 1, slots: 2 }], requestRows: [] }, 'PlacementCard')
  assert.match(placement, /<details class="hm-pl">/)
  assert.match(placement, /Capacity and requests/)

  assert.equal(render(RecentActivity, { rows: [] }, 'RecentActivity (empty)'), '', 'hidden when empty')
  assert.match(render(ApplicationsOutreach, { received: 3, thisWeek: 1, missingDocs: 0, openRate: null }, 'ApplicationsOutreach'), /3<\/b> applications/)
  assert.match(render(SurveysResults, { ready: 2, needReminder: null, pairs: 1, certificates: 0 }, 'SurveysResults'), /ready to release/)
})

test('the launcher renders as a combobox with its quick-action chips', async () => {
  const { default: Launcher } = await load('/src/components/home/Launcher.jsx')
  const { allowedActions } = await load('/src/lib/home/launcherModel.js')
  const html = render(Launcher, { actions: allowedActions({ isAdmin: true, canInterview: true, signatures: true, forms: true }), people: [] }, 'Launcher')
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-controls="hm-cmd-results"/)
  assert.match(html, /role="listbox"/)
  assert.match(html, /placeholder="What do you want to do today\?"/)
  assert.equal((html.match(/class="hm-chip"/g) || []).length, 6)
})
