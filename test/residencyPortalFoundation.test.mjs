// RESIDENCY-PORTAL-1: the fifth portal (Cedars-Sinai Talent Acquisition) is the
// staff Residency workspace mounted under /portal/residency. These tests pin the
// grant wiring, the migration's exact scope, the base-path contract the shared
// tab components now honor, and the staff-only Send boundary.
// Run: node --test test/residencyPortalFoundation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PORTAL_LINKS, portalKeyFromPath } from '../src/lib/portalLinks.js'
import { PORTAL_ROLE_LABELS, PORTAL_ROLE_OPTIONS } from '../src/lib/portalAccessStatus.js'
import { PORTAL_ROLE_ORDER, PORTAL_ROLE_SUMMARY, PORTAL_CAPABILITY_MATRIX } from '../src/lib/portalRoleGuide.js'
import {
  resolveNgrpPath, ngrpPath, NGRP_STAFF_BASE, RESIDENCY_PORTAL_BASE,
} from '../src/lib/ngrp/ngrpTabs.js'
import { STAFF_SURFACE, RESIDENCY_PORTAL_SURFACE } from '../src/lib/ngrp/ngrpSurface.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const MIGRATION = read('supabase/migrations/20260911000000_residency_portal_talent_acquisition.sql')
const NA_MIGRATION = read('supabase/migrations/20260824000000_nursing_academics_portal_foundation.sql')
const FOUR = "('student', 'unit_leader', 'academic_partner', 'nursing_academic')"
const FIVE = "('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition')"

test('migration: widens the grant CHECK to five roles and nothing else', () => {
  assert.match(MIGRATION, /ADD CONSTRAINT user_role_grants_role_check\s+CHECK \(role IN \('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition'\)\);/)
  // Events can be ticked for Talent Acquisition; the old values are all carried through.
  assert.match(MIGRATION, /ADD CONSTRAINT aspire_events_audiences_check\s+CHECK \(audiences <@ array\['student','unit_leader','academic_partner','nursing_academic','talent_acquisition'\]::text\[\]\);/)
  assert.match(MIGRATION, /DEPLOY ORDER: APPLY THIS BEFORE THE APP CODE SHIPS/)
  // No messaging, feedback, or conversation constraint is touched.
  for (const c of ['chk_participant_role_scope', 'chk_messages_author_role', 'chk_portal_feedback_role']) {
    assert.doesNotMatch(MIGRATION, new RegExp(c))
  }
  // No NGRP object is opened to the role.
  // (The header may MENTION ngrp_ while saying it is untouched; no statement may.)
  const codeLines = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--'))
  assert.equal(codeLines.filter(l => l.includes('ngrp_')).length, 0)
  assert.match(MIGRATION, /APPLY MANUALLY/)
  assert.match(MIGRATION, /-- ── ROLLBACK/)
})

test('migration: the lifecycle functions are the NA bodies byte-for-byte, except the two allowlists', () => {
  const naLines = NA_MIGRATION.split('\n')
  const naBody = naLines.slice(94, 461).join('\n')        // lines 95-461: both functions + grants
  assert.equal(naBody.split(FOUR).length - 1, 2)
  const expected = naBody.split(FOUR).join(FIVE)
  assert.ok(MIGRATION.includes(expected), 'function bodies drifted from the 20260824000000 source')
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.provision_portal_access\([^)]*\)\s+TO service_role;/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.revoke_portal_access\([^)]*\)\s+TO service_role;/)
})

test('grant wiring: every role list names talent_acquisition', () => {
  assert.deepEqual(PORTAL_LINKS.at(-1), { key: 'talent_acquisition', label: 'Residency Portal', path: '/portal/residency/overview' })
  assert.equal(portalKeyFromPath('/portal/residency/overview'), 'talent_acquisition')
  assert.equal(portalKeyFromPath('/portal/residency/residency/board'), 'talent_acquisition')
  assert.equal(PORTAL_ROLE_LABELS.talent_acquisition, 'Talent Acquisition')
  assert.ok(PORTAL_ROLE_OPTIONS.some(o => o.value === 'talent_acquisition'))
  assert.equal(PORTAL_ROLE_ORDER.at(-1), 'talent_acquisition')
  assert.ok(PORTAL_ROLE_SUMMARY.talent_acquisition?.detail.includes('Sending Transition Forms stays with the ASPIRE team'))
  for (const row of PORTAL_CAPABILITY_MATRIX) {
    assert.ok(row.levels.talent_acquisition, `matrix row ${row.key} has a Talent Acquisition level`)
  }
  assert.equal(PORTAL_CAPABILITY_MATRIX.find(r => r.key === 'residency').levels.talent_acquisition, 'View or edit')
  assert.equal(PORTAL_CAPABILITY_MATRIX.find(r => r.key === 'staffApplication').levels.talent_acquisition, 'No access')
  for (const f of ['api/invite-portal-user.js', 'api/revoke-portal-access.js', 'api/list-portal-access.js']) {
    assert.match(read(f), /const PORTAL_ROLES = \[[^\]]*'talent_acquisition'\]/, f)
  }
  assert.match(read('api/portal/admin-preview-access.js'), /PREVIEW_ROLES = new Set\(\[[^\]]*'talent_acquisition'\]\)/)
  assert.match(read('api/portal/my-avatar.js'), /hasActiveRoleGrant\(db, auth\.profile\.id, 'talent_acquisition'\)/)
  assert.match(read('api/list-portal-access.js'), /talent_acquisition: 0 \}/)
  assert.match(read('src/App.jsx'), /location\.pathname\.startsWith\('\/portal\/residency\/'\)/)
  // Contacts Editor stays a Nursing Education & Leadership capability only.
  assert.match(read('api/invite-portal-user.js'), /portalRole !== 'nursing_academic' && contactsAccess !== 'view'/)
  // The invitation names the portal instead of falling back to generic copy.
  assert.match(read('lib/server/email/portalInvitation.js'), /talent_acquisition: \{\s+subject: 'You’re invited to the ASPIRE Residency Portal'/)
})

test('base path: the staff surface is unchanged and the portal resolves under /portal/residency', () => {
  // staff: identical to before
  assert.equal(NGRP_STAFF_BASE, '/ngrp')
  assert.equal(ngrpPath('residency'), '/ngrp/residency/board')
  assert.deepEqual(resolveNgrpPath('/ngrp/profiles'), { tab: 'profiles', subTab: null, redirect: null })
  assert.equal(resolveNgrpPath('/ngrp').redirect, '/ngrp/overview')
  assert.equal(resolveNgrpPath('/ngrp/applicants').redirect, '/ngrp/profiles')
  // portal
  const B = RESIDENCY_PORTAL_BASE
  assert.equal(B, '/portal/residency')
  assert.equal(ngrpPath('residency', 'activity', B), '/portal/residency/residency/activity')
  assert.deepEqual(resolveNgrpPath('/portal/residency/profiles', B), { tab: 'profiles', subTab: null, redirect: null })
  assert.deepEqual(resolveNgrpPath('/portal/residency/residency/activity', B), { tab: 'residency', subTab: 'activity', redirect: null })
  assert.equal(resolveNgrpPath('/portal/residency', B).redirect, '/portal/residency/overview')
  assert.equal(resolveNgrpPath('/portal/residency/support', B).redirect, '/portal/residency/support/before')
  // a real portal user lands on /portal: it resolves into the portal, never to /ngrp
  assert.equal(resolveNgrpPath('/portal', B).redirect, '/portal/residency/overview')
  assert.equal(resolveNgrpPath('/portal/profile', B).redirect, '/portal/residency/overview')
})

test('surface: the portal hides the staff-only send action; the staff app is the default', () => {
  assert.equal(STAFF_SURFACE.canSendForms, true)
  assert.equal(RESIDENCY_PORTAL_SURFACE.canSendForms, false)
  assert.equal(RESIDENCY_PORTAL_SURFACE.base, RESIDENCY_PORTAL_BASE)
  const profiles = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(profiles, /canManage && canSendForms && selected\.size > 0/)
  assert.match(profiles, /sendForm: canSendForms \? r => launchSend\(\[r\]\) : undefined/)
  // RESIDENCY-ROSTER-1 retired the Confirm Application button beside it, so the
  // send button now sits directly under the gateNote check. The GATE is what
  // matters here and it is unchanged.
  assert.match(read('src/components/ngrp/ApplicantDrawer.jsx'), /actions\.sendForm && \(/)
  // no shared tab component hard-codes the staff address any more
  for (const f of ['src/components/ngrp/AtAGlanceTab.jsx', 'src/components/ngrp/ActivityCalendar.jsx', 'src/components/ngrp/NgrpWorkspace.jsx']) {
    assert.doesNotMatch(read(f), /'\/ngrp\/residency\/activity'/, f)
  }
})

test('portal app: a talent_acquisition branch mounts the Residency workspace after nursing_academic', () => {
  const app = read('src/portal/PortalApp.jsx')
  const na = app.indexOf("if (roles.includes('nursing_academic'))")
  const ta = app.indexOf("if (roles.includes('talent_acquisition'))")
  assert.ok(na > 0 && ta > na, 'appended after nursing_academic so no existing experience changes')
  const branch = app.slice(ta, app.indexOf('<PortalAccessNotice', ta))
  assert.match(branch, /<ResidencyPortal /)
  assert.match(branch, /<ResidencyNav tab=\{residencyRoute\.tab\}/)
  assert.doesNotMatch(branch, /PortalUtilityLayer/, 'no Messages or Send Feedback for this role yet')
  const portal = read('src/portal/residency/ResidencyPortal.jsx')
  assert.match(portal, /<NgrpSurfaceProvider value=\{RESIDENCY_PORTAL_SURFACE\}>/)
  assert.match(portal, /<NgrpWorkspace/)
  assert.match(portal, /<CohortSettingsModal/)
  // The cohort picker is the staff header's own ScopePicker + ResidencyCohortList, in the
  // portal header's controls slot, fed the same label rules. No in-page cohort bar remains.
  assert.match(portal, /import ScopePicker from '\.\.\/\.\.\/components\/Header\/scope\/ScopePicker'/)
  assert.match(portal, /import ResidencyCohortList from '\.\.\/\.\.\/components\/Header\/scope\/ResidencyCohortList'/)
  assert.match(portal, /<PortalHeaderControls>\s*<ScopePicker/)
  assert.match(portal, /cohortPane=\{<ResidencyCohortList \{\.\.\.residencyCohort\} \/>\}/)
  assert.doesNotMatch(read('src/portal/residency/ResidencyChrome.jsx'), /ResidencyCohortBar/)
  // the nav is NGRP_TABS itself, so portal and staff app cannot offer different tabs
  assert.match(read('src/portal/residency/ResidencyChrome.jsx'), /NGRP_TABS\.map/)
})

test('events: Talent Acquisition sees only events ticked for them AND of a delivered type', async () => {
  const { portalCanSeeEvent, PORTAL_AUDIENCES, PORTAL_DELIVERED_TYPES } = await import('../src/lib/aspireEvents.js')
  assert.ok(PORTAL_AUDIENCES.some(a => a.value === 'talent_acquisition' && a.label === 'Talent Acquisition'))
  const delivered = PORTAL_DELIVERED_TYPES[0]
  assert.equal(portalCanSeeEvent({ audiences: ['talent_acquisition'], event_type: delivered }, 'talent_acquisition'), true)
  assert.equal(portalCanSeeEvent({ audiences: ['student'], event_type: delivered }, 'talent_acquisition'), false, 'not ticked for them')
  assert.equal(portalCanSeeEvent({ audiences: [], event_type: delivered }, 'talent_acquisition'), false, 'internal-only event')
  assert.equal(portalCanSeeEvent({ audiences: ['talent_acquisition'], event_type: 'custom' }, 'talent_acquisition'), false, 'type not delivered to portals')
  assert.equal(portalCanSeeEvent({ event_type: delivered }, 'talent_acquisition'), false, 'no audiences column')
  // the server narrows a portal user's list with the same rule, fail-closed
  const api = read('api/aspire-events.js')
  assert.match(api, /if \(auth\.role === 'portal'\) \{/)
  assert.match(api, /events = events\.filter\(ev => roles\.some\(r => portalCanSeeEvent\(ev, r\)\)\)/)
  assert.match(api, /if \(gErr\) return res\.status\(500\)/)
  // the calendar and the masthead narrow by the surface audience (so a staff preview matches)
  assert.match(read('src/components/ngrp/ActivityCalendar.jsx'), /eventAudience \? all\.filter\(ev => portalCanSeeEvent\(ev, eventAudience\)\) : all/)
  assert.match(read('src/components/ngrp/AtAGlanceTab.jsx'), /useStaffMastheadEvents\(\{ audience: eventAudience \}\)/)
})

test('events: no Add Event or event editing on the Residency Portal', () => {
  assert.equal(RESIDENCY_PORTAL_SURFACE.canEditEvents, false)
  assert.equal(STAFF_SURFACE.canEditEvents, true)
  assert.equal(RESIDENCY_PORTAL_SURFACE.eventAudience, 'talent_acquisition')
  assert.equal(STAFF_SURFACE.eventAudience, null)
  const cal = read('src/components/ngrp/ActivityCalendar.jsx')
  assert.match(cal, /const canManage = canManageCohort && canEditEvents/)
  assert.match(cal, /\{canManage && <AddEventButton onClick=\{\(\) => setEditing\(\{ isNew: true \}\)\} \/>\}/)
})
