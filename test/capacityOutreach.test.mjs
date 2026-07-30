// Capacity-response outreach: connect the explicit target model to unit selection (Send to Many).
//
// Functional tests drive the pure selection helper (full canonical catalog, division/eligibility,
// recipient readiness, alias + recipient dedup). Source guards prove the At a Glance deep-link and
// manual fallback, that the new capacity template is registered but NOT in the live composer send lists
// (no regression / no real email this release), and that no response/capacity row is ever written.
//
// Run: node --test test/capacityOutreach.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildCapacityOutreachRows, capacityOutreachCounts } from '../src/lib/capacityOutreach.js'
import { getEligibleUnits, UNIT_CATALOG } from '../src/lib/unitCatalog.js'
// templateRegistry.js uses Vite-resolved extensionless imports, so it is source-guarded (below), not imported.

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const modal = read('src/components/CohortResponseTargetsModal.jsx')
const overview = read('src/components/OverviewTab.jsx')
const registry = read('src/lib/connect/templateRegistry.js')
const composer = read('src/components/connect/BulkManualComposer.jsx')

const lead = (unit_name, over = {}) => ({ unit_name, email: 'lead@x.org', is_primary_lead: true, is_active: true, ...over })

// ─── Full catalog + metadata (1, 2) ─────────────────────────────────────────────

test('the selector renders the complete canonical catalog (all 28 units), not public.units', () => {
  const rows = buildCapacityOutreachRows({ catalog: getEligibleUnits(true), leads: [] })
  assert.equal(rows.length, UNIT_CATALOG.length)
  assert.ok(rows.some(r => r.key === 'OPERATINGROOM'))         // default-ineligible units still shown
  assert.ok(rows.some(r => r.key === 'EMERGENCYDEPARTMENT'))
})

test('each row carries division and eligibility metadata', () => {
  const rows = buildCapacityOutreachRows({ catalog: getEligibleUnits(true), leads: [] })
  const or = rows.find(r => r.key === 'OPERATINGROOM')
  assert.equal(or.division, 'Procedural')
  assert.equal(or.defaultEligible, false)
  assert.equal(rows.find(r => r.key === '6NE').division, 'Critical Care')
})

// ─── Recipient readiness (4, 5, 15) ─────────────────────────────────────────────

test('a unit with an active primary lead is send-ready; one without is flagged and blocked', () => {
  const rows = buildCapacityOutreachRows({
    catalog: [{ name: '6 NE', division: 'Critical Care', defaultEligible: true }, { name: '6 NW', division: 'Critical Care', defaultEligible: true }],
    leads: [lead('6NE'), lead('6 NW', { email: '' })],   // 6NW lead has no email → not ready
  })
  assert.equal(rows.find(r => r.key === '6NE').hasRecipient, true)     // matched by canonical key
  assert.equal(rows.find(r => r.key === '6NW').hasRecipient, false)
  const c = capacityOutreachCounts(rows, new Set(['6NE', '6NW']))
  assert.deepEqual(c, { selected: 2, sendReady: 1, blocked: 1 })
})

test('aliases collapse to one row and the primary lead is preferred over a non-primary', () => {
  const rows = buildCapacityOutreachRows({
    catalog: [{ name: '6 NE', division: 'Critical Care', defaultEligible: true }, { name: '6-NE', division: 'Critical Care', defaultEligible: true }],
    leads: [lead('6NE', { is_primary_lead: false, email: 'ops@x.org' }), lead('6 N E', { is_primary_lead: true, email: 'primary@x.org' })],
  })
  assert.equal(rows.length, 1)                                          // alias collapsed
  assert.equal(rows[0].recipientEmail, 'primary@x.org')                // primary preferred
})

test('inactive leads and already-active targets are handled', () => {
  const rows = buildCapacityOutreachRows({
    catalog: [{ name: '6 NE' }, { name: '3 SCCT' }],
    leads: [lead('6NE', { is_active: false })],                         // inactive → no recipient
    activeTargetCanons: new Set(['3SCCT']),
  })
  assert.equal(rows.find(r => r.key === '6NE').hasRecipient, false)
  assert.equal(rows.find(r => r.key === '3SCCT').alreadyTarget, true)
})

// ─── Template ACTIVE in the Send-to-Many roster (Owner correction) ──────────────

test('the Unit Leader Capacity Request is a live Send-to-Many template with Unit Leadership defaults', () => {
  assert.match(registry, /export const CAPACITY_RESPONSE_TEMPLATE_KEY = 'unit_capacity_response_request'/)
  // Roster entry: manual bulk template, Contacts source, Unit Leadership category, UL audience.
  assert.match(registry, /key: 'unit_capacity_response_request', label: 'Unit Leader Capacity Request'/)
  assert.match(registry, /builderKey: 'unit_capacity_response_request',\s*\n\s*defaultSource: 'contacts', defaultContactCategory: 'Unit Leadership', audiences: \[AUDIENCES\.UNIT_LEADER\]/)
  // Body registered in the shared bulk body registry, with the unit-form link + cohort tokens.
  const bodies = read('src/lib/outreachTemplates.js')
  assert.match(bodies, /unit_capacity_response_request:\s+BULK_UNIT_CAPACITY/)
  assert.match(bodies, /\[Insert Unit Form Link\]/)
  assert.match(bodies, /ASPIRE: Unit Capacity Response Request \| \[Cohort\]/)
  // Composer resolves the link to the public /unit-form route and always resolves [Cohort].
  assert.match(composer, /unit_capacity_response_request: \{ token: '\[Insert Unit Form Link\]',\s+path: '\/unit-form' \}/)
  assert.match(composer, /function withCohortToken/)
  assert.match(composer, /the upcoming ASPIRE cohort/)
})

// ─── Selection UI + deep-link + fallback (3, 6, 9, 11, 13, 14, 16, 17) ──────────

test('the selector uses the full catalog with division + recipient readiness, records via the API', () => {
  assert.match(modal, /buildCapacityOutreachRows\(\{ catalog: getEligibleUnits\(true\), leads/)
  assert.match(modal, /capacityOutreachCounts\(/)
  assert.match(modal, /getAllUnitLeaders\(\)/)
  assert.match(modal, /No recipient/)                                  // blocked units flagged
  assert.match(modal, /createCohortResponseTargets\(cohortId, units\)/)  // records via the owner/admin API
  // Never writes a response or capacity row directly.
  assert.doesNotMatch(modal, /from\('units'\)/)
  assert.doesNotMatch(modal, /from\('unit_cohort_responses'\)/)
  // Already-active targets are excluded from the addable list (no duplicate).
  assert.match(modal, /rows\.filter\(r => !r\.alreadyTarget\)/)
})

test('At a Glance launches the real Connect flow (staff-only) and keeps the manual fallback', () => {
  // The Send capacity request action LAUNCHES Connect: writes the session launch context (units with
  // resolvable leads, not already targets) and navigates to Outreach → Send to Many with ?launch=1.
  assert.match(overview, /handleLaunchCapacityRequest/)
  assert.match(overview, /writeLaunchContext\(\{\s*\n\s*kind: LAUNCH_KINDS\.CAPACITY_REQUEST/)
  assert.match(overview, /templateKey: CAPACITY_RESPONSE_TEMPLATE_KEY/)
  assert.match(overview, /navigate\('\/connect\/outreach\?launch=1'\)/)
  assert.match(overview, /Send capacity request/)
  assert.match(overview, /Configure response targets/)               // manual fallback remains
  assert.match(overview, /CohortResponseTargetsModal[\s\S]*cohortId=\{cohortId\}/)  // cohort preselected
  // Launching writes no target/status: only the session context + navigation.
  assert.doesNotMatch(overview, /handleLaunchCapacityRequest[\s\S]{0,900}createCohortResponseTargets/)
})

test('the outreach selector is Owner/Admin gated (target writes are server-verified owner/admin)', () => {
  // The modal only mounts under isAdmin in OverviewTab; all writes go through the staff-only API.
  assert.match(overview, /isAdmin[\s\S]*setTargetsModalOpen\(true\)/)
  const api = read('api/cohort-unit-response-targets.js')
  assert.match(api, /verifyOwnerAdminCaller\(req\)/)
  assert.match(api, /code: 'STAFF_ONLY'/)
})
