// test/portalTerms.test.mjs
//
// PORTAL-TERMS-1 (Owner, 2026-11-09): every portal user accepts the Terms of Use and
// Confidentiality Agreement before any portal renders; again when the text changes and once a
// year; Decline signs them out; Owner/Admin previews skip it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PORTAL_TERMS_VERSION, PORTAL_TERMS_SECTIONS, REACCEPT_DAYS, needsAcceptance, termsNotProvisioned, termsRoles,
} from '../src/lib/portalTerms.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const DAY = 24 * 60 * 60 * 1000

test('the version is an ISO date the database will accept', () => {
  assert.match(PORTAL_TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/)
  const sql = read('supabase/migrations/20261206000000_portal_terms.sql')
  assert.ok(sql.includes("'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"))
})

test('accept when never accepted, on another version, or after a year', () => {
  const now = new Date('2027-01-01T12:00:00Z')
  assert.equal(needsAcceptance(null, now), true)
  assert.equal(needsAcceptance({ terms_version: '2000-01-01', accepted_at: now.toISOString() }, now), true)
  assert.equal(needsAcceptance({ terms_version: PORTAL_TERMS_VERSION, accepted_at: 'not a date' }, now), true)
  const recent = new Date(now.getTime() - 10 * DAY).toISOString()
  assert.equal(needsAcceptance({ terms_version: PORTAL_TERMS_VERSION, accepted_at: recent }, now), false)
  const edge = new Date(now.getTime() - REACCEPT_DAYS * DAY).toISOString()
  assert.equal(needsAcceptance({ terms_version: PORTAL_TERMS_VERSION, accepted_at: edge }, now), false)
  const old = new Date(now.getTime() - (REACCEPT_DAYS + 1) * DAY).toISOString()
  assert.equal(needsAcceptance({ terms_version: PORTAL_TERMS_VERSION, accepted_at: old }, now), true)
})

test('only the missing table or function reads as not provisioned', () => {
  assert.equal(termsNotProvisioned({ code: '42P01' }), true)
  assert.equal(termsNotProvisioned({ code: 'PGRST205', message: 'Could not find the table' }), true)
  assert.equal(termsNotProvisioned({ code: 'PGRST202' }), true)
  assert.equal(termsNotProvisioned({ code: '42501', message: 'permission denied' }), false)
  assert.equal(termsNotProvisioned({ message: 'Failed to fetch' }), false)
  assert.equal(termsNotProvisioned(null), false)
})

test('roles are filtered to the five portal roles', () => {
  assert.deepEqual(termsRoles(['student', 'owner', 'talent_acquisition']), ['student', 'talent_acquisition'])
  assert.deepEqual(termsRoles(null), [])
})

test('the text covers confidentiality, patients, students, account, use and monitoring', () => {
  const heads = PORTAL_TERMS_SECTIONS.map(s => s.heading)
  for (const h of ['Confidential Information', 'Patient Privacy', 'Student Records', 'Your Account', 'Appropriate Use', 'Monitoring']) {
    assert.ok(heads.includes(h), h)
  }
  const text = PORTAL_TERMS_SECTIONS.flatMap(s => s.body).join(' ')
  assert.ok(!text.includes('—'), 'no em dashes')
})

test('PortalApp gates every portal branch, after access and before the first role branch', () => {
  const src = read('src/portal/PortalApp.jsx')
  const hook = src.indexOf('usePortalTerms({')
  const firstReturn = src.indexOf('  if (loading) {')
  assert.ok(hook > 0 && hook < firstReturn, 'the hook is declared above every early return')
  const gate = src.indexOf('if (termsBlocking) {')
  const deact = src.indexOf('if (deactivated || accessEnded) return')
  const firstBranch = src.indexOf("if (roles.includes('student'))")
  assert.ok(deact > 0 && gate > deact && gate < firstBranch, 'gate sits after the access answer, before any portal')
  assert.match(src, /const termsEnabled = !staffPreview/, 'previews skip it')
  assert.match(src, /\['idle', 'checking', 'needed'\]\.includes\(terms\.status\)/, 'nothing renders before the answer')
})

test('Decline signs out; Accept waits for the box', () => {
  const gate = read('src/portal/PortalTermsGate.jsx')
  assert.match(gate, /onClick=\{signOut\}/)
  assert.match(gate, /disabled=\{!agreed \|\| saving\}/)
})

test('the record is append-only and written only by the self RPC', () => {
  const sql = read('supabase/migrations/20261206000000_portal_terms.sql')
  assert.match(sql, /REVOKE ALL ON public\.portal_terms_acceptances FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /GRANT SELECT ON public\.portal_terms_acceptances TO authenticated;/)
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]*portal_terms_acceptances/)
  assert.match(sql, /BEFORE UPDATE ON public\.portal_terms_acceptances/)
  assert.match(sql, /SECURITY DEFINER/)
  assert.match(sql, /WHERE auth_user_id = auth\.uid\(\)/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.accept_portal_terms\(text, text\[\], text\) FROM PUBLIC, anon;/)
})
