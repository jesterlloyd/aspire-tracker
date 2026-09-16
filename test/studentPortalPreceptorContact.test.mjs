// STUDENT-PORTAL-PRECEPTOR-CONTACT-1: preceptor contact details in Placement
// Progress and the Email Preceptor compose in Support.
//
// Pure behavior for the shared rules (src/lib/placementContacts.js), the compose
// helper's CC support, and source pins for the summary's privacy contract and
// the portal UI. No database, network, or browser.
//
// Run: node --test test/studentPortalPreceptorContact.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PRECEPTOR_ROLE_LABEL, ASPIRE_TEAM_EMAIL,
  orderPreceptorContacts, emailablePreceptors, buildPreceptorRecipients,
} from '../src/lib/placementContacts.js'
import { selectUnitLeadershipCc } from '../src/lib/placementLeadership.js'
import { buildMailtoUrl, buildOutlookComposeUrl } from '../src/lib/outlookCompose.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const summary = read('api/lib/studentPortalSummary.js')
const portal = read('src/portal/StudentPortal.jsx')
const css = read('src/portal/portal.css')
const clientRules = read('src/lib/placementContacts.js')

// ── Preceptor rows ────────────────────────────────────────────────────────────

test('every active preceptor is listed Primary, Secondary, Coverage, then by name', () => {
  const rows = [
    { role: 'coverage', preceptor: { id: 'c', full_name: 'Zed Cover', email: 'zed@cshs.org', phone: null } },
    { role: 'secondary', preceptor: { id: 's', full_name: 'Sam Second', email: 'sam@cshs.org', phone: '310-555-0100' } },
    { role: 'primary', preceptor: { id: 'p', full_name: 'Fabian Reynoso', email: 'Fabian.Reynoso@cshs.org', phone: null } },
    { role: 'coverage', preceptor: { id: 'a', full_name: 'Amy Cover', email: null, phone: null } },
  ]
  const out = orderPreceptorContacts(rows)
  assert.deepEqual(out.map(p => p.id), ['p', 's', 'a', 'c'])
  assert.deepEqual(out[0], { id: 'p', name: 'Fabian Reynoso', role: 'primary', email: 'Fabian.Reynoso@cshs.org', phone: null })
  assert.equal(PRECEPTOR_ROLE_LABEL.coverage, 'Coverage')
})

test('a preceptor holding two roles appears once, under the higher role', () => {
  const rows = [
    { role: 'coverage', preceptor: { id: 'p', full_name: 'Fabian Reynoso', email: 'f@cshs.org' } },
    { role: 'primary', preceptor: { id: 'p', full_name: 'Fabian Reynoso', email: 'f@cshs.org' } },
  ]
  const out = orderPreceptorContacts(rows)
  assert.equal(out.length, 1)
  assert.equal(out[0].role, 'primary')
})

test('a missing phone comes from the Connect profile with the same email, case-insensitively', () => {
  const rows = [{ role: 'primary', preceptor: { id: 'p', full_name: 'Fabian Reynoso', email: 'Fabian.Reynoso@cshs.org', phone: '' } }]
  const out = orderPreceptorContacts(rows, { 'fabian.reynoso@cshs.org': '(310) 423-0000' })
  assert.equal(out[0].phone, '(310) 423-0000')
  // The preceptor's own phone wins over the profile.
  const own = orderPreceptorContacts(
    [{ role: 'primary', preceptor: { id: 'p', full_name: 'F R', email: 'f@cshs.org', phone: '111' } }],
    { 'f@cshs.org': '222' })
  assert.equal(own[0].phone, '111')
})

test('an invalid email is not shown or offered, and rows without a name are dropped', () => {
  const out = orderPreceptorContacts([
    { role: 'primary', preceptor: { id: 'p', full_name: 'Fabian Reynoso', email: 'not-an-email' } },
    { role: 'secondary', preceptor: { id: 'x', full_name: '  ', email: 'x@cshs.org' } },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].email, null)
  assert.deepEqual(emailablePreceptors(out), [])
})

// ── Unit leadership from ASPIRE Connect ───────────────────────────────────────

const CONNECT = [
  { full_name: 'Lorraine Sheffield', preferred_name: 'Lori', category: 'Unit Leader', role: 'Associate Director', email: 'Lorraine.Sheffield@cshs.org', unit_name: '7 SCCT', related_units: [], is_active: true },
  { full_name: 'Jillian Felice', category: 'Unit Leader', role: 'NPD Practitioner', email: 'Jillian.Felice@cshs.org', unit_name: '7SCCT', is_active: true },
  { full_name: 'Charlotte Guevarra', category: 'Unit Leadership', role: 'Assistant Nurse Manager', email: 'Charlotte.Guevarra@cshs.org', unit_name: '5 SCCT', related_units: ['7 SCCT'], is_active: true },
  { full_name: 'Dana Director', category: 'Unit Leader', role: 'Director', email: 'dana@cshs.org', unit_name: '7 SCCT', is_active: true },
  { full_name: 'Old ANM', category: 'Unit Leader', role: 'Assistant Nurse Manager', email: 'old@cshs.org', unit_name: '7 SCCT', is_active: false },
  { full_name: 'Other Unit NPD', category: 'Unit Leader', role: 'NPD Practitioner', email: 'other@cshs.org', unit_name: '6 NE', is_active: true },
  { full_name: 'A Preceptor', category: 'Preceptor', role: 'CN III', email: 'prec@cshs.org', unit_name: '7 SCCT', is_active: true },
  { full_name: 'Legacy Title', category: 'Unit Leader', role: 'Unit NPD-P', email: 'legacy@cshs.org', unit_name: '7 SCCT', is_active: true },
  { full_name: 'Lori Duplicate', category: 'Unit Leader', role: 'Associate Director', email: 'lorraine.sheffield@CSHS.org', unit_name: '7 SCCT', is_active: true },
]

test('7 SCCT leadership: AD, ANM, NPD-P from Connect, ranked, preferred names, deduplicated', () => {
  const out = selectUnitLeadershipCc(CONNECT, ['7 SCCT'])
  assert.deepEqual(out, [
    { name: 'Lori Sheffield', title: 'Associate Director', email: 'Lorraine.Sheffield@cshs.org' },
    { name: 'Charlotte Guevarra', title: 'Assistant Nurse Manager', email: 'Charlotte.Guevarra@cshs.org' },
    { name: 'Jillian Felice', title: 'NPD Practitioner', email: 'Jillian.Felice@cshs.org' },
    { name: 'Legacy Title', title: 'NPD Practitioner', email: 'legacy@cshs.org' },
  ])
})

test('leadership excludes Directors, preceptors, inactive contacts, and other units', () => {
  const emails = selectUnitLeadershipCc(CONNECT, ['7 SCCT']).map(l => l.email.toLowerCase())
  for (const e of ['dana@cshs.org', 'old@cshs.org', 'other@cshs.org', 'prec@cshs.org']) {
    assert.ok(!emails.includes(e), `${e} must not be copied`)
  }
  assert.deepEqual(selectUnitLeadershipCc(CONNECT, []), [])
  assert.deepEqual(selectUnitLeadershipCc(CONNECT, ['9 NOWHERE']), [])
})

test('leadership rows expose only name, title, and email (no phone or unit data)', () => {
  const withPhone = CONNECT.map(c => ({ ...c, phone: '310-555-9999' }))
  for (const row of selectUnitLeadershipCc(withPhone, ['7 SCCT'])) {
    assert.deepEqual(Object.keys(row).sort(), ['email', 'name', 'title'])
  }
})

// ── Email Preceptor recipients ────────────────────────────────────────────────

const PRECEPTORS = [
  { id: 'p', name: 'Fabian Reynoso', role: 'primary', email: 'Fabian.Reynoso@cshs.org', phone: null },
  { id: 's', name: 'Sam Second', role: 'secondary', email: 'sam@cshs.org', phone: null },
  { id: 'c', name: 'No Email', role: 'coverage', email: null, phone: null },
]
const LEADERSHIP = selectUnitLeadershipCc(CONNECT, ['7 SCCT'])

test('one chosen preceptor on To; leadership then the ASPIRE team on CC', () => {
  const r = buildPreceptorRecipients({ preceptors: PRECEPTORS, leadership: LEADERSHIP, choice: 'p' })
  assert.deepEqual(r.to, ['Fabian.Reynoso@cshs.org'])
  assert.deepEqual(r.cc, [
    'Lorraine.Sheffield@cshs.org', 'Charlotte.Guevarra@cshs.org', 'Jillian.Felice@cshs.org',
    'legacy@cshs.org', ASPIRE_TEAM_EMAIL,
  ])
})

test('All puts every emailable preceptor on To and skips one with no email', () => {
  const r = buildPreceptorRecipients({ preceptors: PRECEPTORS, leadership: LEADERSHIP, choice: 'all' })
  assert.deepEqual(r.to, ['Fabian.Reynoso@cshs.org', 'sam@cshs.org'])
  assert.equal(r.cc.at(-1), ASPIRE_TEAM_EMAIL)
})

test('nobody appears on both To and CC, and a choice with no email yields nothing', () => {
  const leaderPreceptor = [{ id: 'j', name: 'Jillian Felice', role: 'primary', email: 'jillian.felice@cshs.org' }]
  const r = buildPreceptorRecipients({ preceptors: leaderPreceptor, leadership: LEADERSHIP, choice: 'j' })
  assert.ok(!r.cc.map(e => e.toLowerCase()).includes('jillian.felice@cshs.org'))
  assert.equal(buildPreceptorRecipients({ preceptors: PRECEPTORS, leadership: LEADERSHIP, choice: 'c' }), null)
  assert.equal(buildPreceptorRecipients({ preceptors: [], leadership: LEADERSHIP, choice: 'all' }), null)
})

test('with no leadership on file the ASPIRE team is still copied', () => {
  const r = buildPreceptorRecipients({ preceptors: PRECEPTORS, leadership: [], choice: 'p' })
  assert.deepEqual(r.cc, [ASPIRE_TEAM_EMAIL])
})

// ── Compose helper CC ─────────────────────────────────────────────────────────

test('mailto carries CC; the existing Email ASPIRE Team URL is unchanged', () => {
  assert.equal(
    buildMailtoUrl({ to: 'a@cshs.org,b@cshs.org', cc: 'c@cshs.org,aspire@cshs.org', subject: 'S' }),
    'mailto:a@cshs.org,b@cshs.org?cc=c%40cshs.org%2Caspire%40cshs.org&subject=S')
  assert.equal(
    buildMailtoUrl({ to: 'aspire@cshs.org', subject: 'ASPIRE Student Support Request', body: 'Hi' }),
    'mailto:aspire@cshs.org?subject=ASPIRE%20Student%20Support%20Request&body=Hi')
  assert.match(buildOutlookComposeUrl({ to: 'a@cshs.org', cc: 'c@cshs.org' }), /[?&]cc=c%40cshs\.org/)
})

// ── Summary privacy contract ──────────────────────────────────────────────────

test('summary reads preceptor contact fields and Connect leadership, never unit_leaders', () => {
  assert.match(summary, /preceptors \( id, full_name, email, phone \)/)
  assert.match(summary, /\.from\('contacts'\)\s*\.select\('full_name, preferred_name, category, role, email, unit_name, related_units, is_active'\)/)
  assert.doesNotMatch(summary, /from\(['"]unit_leaders['"]\)/, 'the legacy unit_leaders table must not be read')
  assert.match(summary, /preceptors: orderPreceptorContacts\(/)
  assert.match(summary, /unit_leadership: selectUnitLeadershipCc\(/)
  // The leadership read never selects phone.
  const leaderSelect = summary.match(/\.select\('full_name, preferred_name[^']*'\)/)?.[0] || ''
  assert.doesNotMatch(leaderSelect, /phone/)
})

// ── Portal UI ─────────────────────────────────────────────────────────────────

test('Placement Progress lists each preceptor with contact lines and drops the School row', () => {
  assert.match(portal, /preceptors\.map\(p => \(/)
  assert.match(portal, /\$\{PRECEPTOR_ROLE_LABEL\[p\.role\]\} Preceptor/)
  assert.match(portal, /href=\{`tel:\$\{p\.phone/)
  assert.doesNotMatch(portal, /<dt>School<\/dt>/)
  // Preceptor email is shown as text; composing happens through Email Preceptor.
  assert.doesNotMatch(portal, /href=\{`mailto:\$\{p\.email/)
})

test('Support shows Email ASPIRE Team and Email Preceptor with a keyboard-complete chooser', () => {
  assert.match(portal, /<span className="ptl-help-action-title">Email ASPIRE Team<\/span>/)
  assert.doesNotMatch(portal, /<span className="ptl-help-action-title">Contact ASPIRE<\/span>/)
  assert.match(portal, /<span className="ptl-help-action-title">Email Preceptor<\/span>/)
  assert.match(portal, /'aria-expanded': preceptorPickerOpen/)
  assert.match(portal, /aria-label="Choose who to email"/)
  assert.match(portal, />All preceptors</)
  assert.match(portal, /e\.key === 'Escape'/)
  assert.match(portal, /preceptorBtnRef\.current\?\.focus\(\)/)
  assert.match(portal, /composePortalEmail\(\{ to, cc: recipients\.cc\.join\(','\), subject: PRECEPTOR_SUBJECT, body, loginEmail \}\)/)
})

test('new portal styles are scoped and read the radius token', () => {
  const block = css.slice(css.indexOf('STUDENT-PORTAL-PRECEPTOR-CONTACT-1'))
  const scoped = block.slice(0, block.indexOf('/* Documents:'))
  assert.ok(scoped.length > 0)
  assert.doesNotMatch(scoped, /border-radius:\s*\d+px/, 'no literal radii in the new block')
  assert.match(scoped, /border-radius: var\(--aspire-radius-control\)/)
  assert.match(scoped, /min-height: 44px/)
})

test('the browser-side rules module carries no catalog imports (bundle cost)', () => {
  assert.doesNotMatch(clientRules, /^import /m, 'placementContacts.js must stay import-free')
  assert.doesNotMatch(portal, /placementLeadership/, 'the portal never imports the leadership selector')
})
