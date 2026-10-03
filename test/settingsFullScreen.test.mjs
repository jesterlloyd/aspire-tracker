// test/settingsFullScreen.test.mjs
//
// SETTINGS-FULLSCREEN-1 (Owner, 2026-09-27: "when I click Program budget and community benefit in
// the setting, it takes the entire screen, with breadcrumb button on top, similar to some pages in
// ASPIRE catalog"). The real Settings shell, server-rendered at each route for an Owner: the two
// wide pages drop the rail and wear "‹ Settings / Page"; every other page keeps the rail.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

let vite, Shell, AuthContext
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  Shell = (await vite.ssrLoadModule('/src/components/settings/SettingsShell.jsx')).default
  AuthContext = (await vite.ssrLoadModule('/src/contexts/AuthContext.jsx')).AuthContext
})
after(async () => { await vite?.close() })

const OWNER = { id: 'p', role: 'owner', is_owner: true, is_active: true, full_name: 'Owner', email: 'o@example.test' }
const auth = { user: { id: 'u' }, userProfile: OWNER, isOwner: true, isAdmin: true, canEdit: true }
const at = (path) => renderToStaticMarkup(
  React.createElement(QueryClientProvider, { client: new QueryClient() },
    React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(AuthContext.Provider, { value: auth }, React.createElement(Shell)))))

// BUDGET-TRACKER-1 changed this (Owner, 2026-09-30): Program Budget is now labelled Budget Tracker.
for (const [path, label] of [['/settings/budget', 'Budget Tracker'], ['/settings/community-benefit', 'Community Benefit']]) {
  test(`${label} takes the whole screen under a Settings crumb`, () => {
    const html = at(path)
    assert.match(html, /class="settings-shell settings-full"/)
    // NAV-POLISH-1: the shared breadcrumb, Settings / <page>.
    assert.match(html, new RegExp(`<nav class="aspire-crumb settings-fullcrumb" aria-label="Breadcrumb"><ol><li><button type="button" class="aspire-crumb-link">Settings</button></li><li class="aspire-crumb-sep" aria-hidden="true">/</li><li><span class="aspire-crumb-here" aria-current="page">${label}</span></li></ol></nav>`))
    assert.doesNotMatch(html, /settings-grid|settings-side|rr-nav/, 'no rail')
  })
}

test('every other Settings page keeps the rail', () => {
  const html = at('/settings/general')
  assert.match(html, /settings-grid/)
  assert.doesNotMatch(html, /settings-fullcrumb/)
})

test('the two pages are flagged full screen in the registry and stay in the rail', () => {
  const src = readFileSync(new URL('../src/components/settings/settingsSections.js', import.meta.url), 'utf8')
  for (const key of ['communityBenefit', 'programBudget']) assert.match(src, new RegExp(`key: '${key}'[^\\n]*fullScreen: true`), key)
  assert.doesNotMatch(src.match(/key: 'programBudget'[^\n]*/)[0], /inRail: false/)
})
