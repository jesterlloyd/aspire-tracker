// test/navPolish.test.mjs
//
// NAV-POLISH-1 (Owner, 2026-10-02): the four-group Settings rail at AA, one breadcrumb for
// Settings and the Catalog, and the Owner/Admin portal menu shaped like the staff menu.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETTINGS_GROUPS, visibleSections } from '../src/components/settings/settingsSections.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('the rail is Personal, Administration, Program, Diagnostics, and an Admin sees what they saw before', () => {
  assert.deepEqual(SETTINGS_GROUPS, ['Personal', 'Administration', 'Program', 'Diagnostics'])
  const owner = visibleSections({ isOwner: true, isAdmin: true })
  assert.deepEqual(owner.map(s => `${s.group}:${s.key}`), [
    'Personal:general', 'Administration:accounts', 'Administration:organization', 'Administration:keith',
    'Program:communityBenefit', 'Program:programBudget', 'Diagnostics:demoMode', 'Diagnostics:preceptorParity',
  ])
  assert.deepEqual(visibleSections({ isOwner: false, isAdmin: true }).map(s => s.key).sort(),
    ['accounts', 'communityBenefit', 'general', 'keith', 'programBudget'])
  assert.deepEqual(visibleSections({ isOwner: false, isAdmin: false }).map(s => s.key), ['general'])
})

test('the rail\'s group labels read the AA caption ink, in the shared sheet', () => {
  const rail = read('src/styles/selectionRail.css')
  assert.match(rail, /\.rr-nav-group \{[^}]*color: var\(--text-caption\);/)
  assert.doesNotMatch(rail, /\.rr-nav-group \{[^}]*color: var\(--text-muted\)/)
})

test('one breadcrumb: parents are buttons, the page is aria-current, the separator is hidden decoration', () => {
  const bc = read('src/components/shared/Breadcrumb.jsx')
  assert.match(bc, /<nav className=\{`aspire-crumb/)
  assert.match(bc, /aria-label="Breadcrumb"/)
  assert.match(bc, /<span className="aspire-crumb-here" aria-current="page">/)
  assert.match(bc, /<button type="button" className="aspire-crumb-link" onClick=\{item\.onClick\}>/)
  const css = read('src/components/shared/breadcrumb.css')
  assert.match(css, /\.aspire-crumb-sep \{ color: var\(--text-caption/)
  assert.match(css, /\.aspire-crumb-link \{[^}]*color: var\(--color-accent-primary/)
  for (const f of ['src/components/settings/SettingsShell.jsx', 'src/components/forms/FormBuilder.jsx',
    'src/components/forms/FormResponses.jsx', 'src/components/signatures/SignaturesPage.jsx']) {
    assert.match(read(f), /<Breadcrumb className="/, f)
    // (an error state's own "‹ Catalog" button is an action, not a trail, and stays)
    assert.doesNotMatch(read(f), /‹ (Catalog|Settings)<\/button>\s*<span[^>]*>\//, `${f} keeps no old crumb`)
  }
})

test('the forms trail is Catalog / Forms / <form> (/ Responses), and Forms opens the Forms shelf', () => {
  const responses = read('src/components/forms/FormResponses.jsx')
  assert.match(responses, /\{ label: 'Forms', onClick: onForms \},\s*\{ label: form\.draft\?\.title \|\| 'Form', onClick: onEdit \},\s*\{ label: 'Responses' \},/)
  assert.match(read('src/components/forms/FormsScreen.jsx'), /const toForms = \(\) => navigate\('\/catalog\?view=forms'\)/)
  const catalog = read('src/components/catalog/CatalogPage.jsx')
  assert.match(catalog, /get\('view'\) === 'forms'\) setView\(\{ type: 'form', category: null, track: null \}\)/)
})

test('the Owner/Admin portal menu reads identity, Settings, Preview as, then Main App, Public site, Sign out', () => {
  const shell = read('src/portal/PortalShell.jsx')
  const staff = shell.slice(shell.indexOf('function StaffPortalMenuItems('), shell.indexOf('function ProfileMenu('))
  const order = ['ptl-menu-id-link', '<Settings size={15} /> Settings', '>Preview as</div>', '<House size={15} /> Main App',
    '<Globe size={15} /> Public site', '<LogOut size={15} /> Sign out'].map(s => staff.indexOf(s))
  assert.ok(order.every(i => i > 0), `all present: ${order}`)
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  assert.match(staff, /href=\{profileUrl\}/)
  assert.match(staff, /aria-label=\{`Profile, \$\{userName \|\| ''\}/)
  assert.doesNotMatch(staff, /email/i, 'no email in the portal bundle')
  assert.match(shell, /\{open && portalSwitcher && \(/)
  assert.match(shell, /window\.location\.assign\(settingsUrl\)/)
  assert.match(read('src/portal/PortalApp.jsx'), /profileUrl: STAFF_PROFILE_PATH/)
})

test('a real portal user\'s menu is the one it was: no Preview as, no Main App, no Settings', () => {
  const shell = read('src/portal/PortalShell.jsx')
  const own = shell.slice(shell.indexOf('{open && !portalSwitcher && ('), shell.indexOf('export default function PortalShell'))
  assert.doesNotMatch(own, /Preview as/)
  assert.match(own, /My Profile/)
  assert.match(own, /Change Photo/)
  assert.match(own, /ptl-menu-danger/)
})
