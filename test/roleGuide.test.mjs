// ROLE-MODEL-1: the resolved role model, enforced and documented from ONE table.
//
// lib/server/access.js is the single authorization decision; src/lib/roleGuide.js
// is its display. These tests resolve EVERY matrix cell against can() and walk
// EVERY role x capability permutation, so the guide cannot describe a permission
// the server does not grant, and a changed check breaks the documentation.
//
// Run: node --test test/roleGuide.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  can, capabilitiesFor, isOwnerCaller, isAdminLevel, normalizeRole,
  callerFrom, STAFF_ROLES, ASSIGNABLE_ROLES, LEGACY_ROLES, CAPABILITY_KEYS,
  keithContextScope, contextSectionsFor, allowsContextSection, KEITH_CONTEXT_SCOPES,
} from '../lib/server/access.js'
import { ROLE_ORDER, ROLE_SUMMARY, CAPABILITY_MATRIX, LEVELS, MODEL_NOTES } from '../src/lib/roleGuide.js'
import { authorizeSkillForCaller } from '../lib/server/keith/skillAuthorization.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const api = (f) => read(`api/${f}`)

// The five callers under test. Owner is the CAPABILITY, not the string.
const CALLERS = {
  owner:         { role: 'owner', is_owner: true },
  admin:         { role: 'admin', is_owner: false },
  'co-lead':     { role: 'co-lead', is_owner: false },
  interviewer:   { role: 'interviewer', is_owner: false },
  viewer:        { role: 'viewer', is_owner: false },
}
const GRANTED = (level) => level !== 'No access'

// ── The table itself ─────────────────────────────────────────────────────────

test('every role x capability permutation resolves, and deny is the default', () => {
  for (const role of STAFF_ROLES) {
    for (const cap of CAPABILITY_KEYS) {
      assert.equal(typeof can(CALLERS[role], cap), 'boolean', `${role}/${cap}`)
    }
  }
  // Unknown capability and unknown role both deny.
  assert.equal(can(CALLERS.owner, 'no_such_capability'), false)
  assert.equal(can({ role: 'wizard', is_owner: false }, 'student_manage'), false)
  assert.equal(can(null, 'student_manage'), false)
  assert.equal(can({}, 'student_manage'), false)
})

test('Owner authority comes from the capability, never from a role string', () => {
  // The string alone is admin-level operational access, NOT governance.
  const stringOwner = { role: 'owner', is_owner: false }
  assert.equal(isOwnerCaller(stringOwner), false)
  assert.equal(isAdminLevel(stringOwner), true, 'no lockout: still operates at admin scope')
  assert.equal(can(stringOwner, 'governance'), false, 'a role name cannot grant governance')
  // The capability alone is owner, whatever the role string says.
  const flagOwner = { role: 'admin', is_owner: true }
  assert.equal(isOwnerCaller(flagOwner), true)
  assert.equal(can(flagOwner, 'governance'), true)
  // co_lead and co-lead are one role.
  assert.equal(normalizeRole('co_lead'), 'co-lead')
  assert.equal(can({ role: 'co_lead' }, 'placement_manage'), true)
  assert.equal(callerFrom({ role: 'CO_LEAD', is_owner: false }).role, 'co-lead')
})

test('Owner holds every capability; Viewer holds none', () => {
  assert.deepEqual(capabilitiesFor(CALLERS.owner).sort(), [...CAPABILITY_KEYS].sort())
  assert.deepEqual(capabilitiesFor(CALLERS.viewer), [])
})

test('the Owner/Admin distinction is exactly the governance set', () => {
  const ownerOnly = CAPABILITY_KEYS.filter(c => can(CALLERS.owner, c) && !can(CALLERS.admin, c))
  assert.deepEqual(ownerOnly.sort(), ['enrichment_run', 'governance'])
  // Admin holds everything else, including the read-only enrichment preview.
  assert.equal(can(CALLERS.admin, 'enrichment_preview'), true)
  assert.equal(can(CALLERS.admin, 'enrichment_run'), false)
})

test('the resolved Co-Lead scope: placement and student records, nothing wider', () => {
  const co = CALLERS['co-lead']
  for (const cap of ['placement_manage', 'student_manage', 'student_read', 'keith_chat', 'keith_skills']) {
    assert.equal(can(co, cap), true, `co-lead should hold ${cap}`)
  }
  // The deliberate exclusions - each a materially wider grant than the UI ever offered.
  for (const cap of ['student_files_manage', 'interview_schedule', 'evaluations_manage',
    'contacts_manage', 'cohort_manage', 'staff_manage', 'governance',
    'knowledge_author', 'skills_author', 'usage_view']) {
    assert.equal(can(co, cap), false, `co-lead must NOT hold ${cap}`)
  }
})

test('Interviewer keeps interview scope only', () => {
  const iv = CALLERS.interviewer
  assert.equal(can(iv, 'interview_conduct'), true)
  assert.equal(can(iv, 'keith_contacts'), true)
  for (const cap of ['placement_manage', 'student_manage', 'interview_schedule', 'evaluations_manage', 'staff_manage']) {
    assert.equal(can(iv, cap), false, `interviewer must NOT hold ${cap}`)
  }
})

// ── The guide is resolved against the table ──────────────────────────────────

test('every matrix cell agrees with can() - the guide cannot overstate access', () => {
  assert.deepEqual([...ROLE_ORDER].sort(), [...STAFF_ROLES].sort())
  for (const row of CAPABILITY_MATRIX) {
    assert.ok(CAPABILITY_KEYS.includes(row.capability), `${row.key} must name a real capability`)
    for (const role of ROLE_ORDER) {
      const level = row.levels[role]
      assert.ok(LEVELS.includes(level), `${row.key}/${role}: unknown level "${level}"`)
      // A row may name narrower READ capabilities for roles that see without
      // managing (an entitled Interviewer). A granted cell must be justified
      // by the manage capability or one of those. The single exception is the
      // legacy Viewer's headshot-only student view, which no capability grants
      // and which the guide must therefore mark "Limited".
      const granted = can(CALLERS[role], row.capability)
        || (row.readCapabilities || []).some(c => can(CALLERS[role], c))
      if (role === 'viewer' && row.key === 'students') { assert.equal(level, 'Limited'); continue }
      assert.equal(GRANTED(level), granted,
        `${row.key}/${role}: guide says "${level}" but the table grants ${granted}`)
    }
  }
})

test('the guide states assignability truthfully, and Viewer is retired', () => {
  for (const role of ROLE_ORDER) {
    assert.equal(ROLE_SUMMARY[role].assignable, ASSIGNABLE_ROLES.includes(role), `${role} assignability`)
  }
  assert.deepEqual([...ASSIGNABLE_ROLES], ['admin', 'co-lead', 'interviewer'])
  assert.deepEqual([...LEGACY_ROLES], ['viewer'])
  // The server refuses to invite a retired or non-assignable role.
  const invite = api('invite-user.js')
  // Parse the VALUES, not the text: "interviewer" contains "viewer".
  const permitted = [...(/PERMITTED_INVITE_ROLES = \[([^\]]*)\]/.exec(invite)[1])
    .matchAll(/'([a-z-]+)'/g)].map(m => m[1])
  assert.deepEqual(permitted.sort(), [...ASSIGNABLE_ROLES].sort(),
    'the server invites exactly the assignable roles')
  assert.ok(!permitted.includes('viewer'), 'viewer is retired')
  assert.ok(!permitted.includes('owner'), 'owner is a capability, not invitable')
  // ...and the invite UI offers exactly the assignable set.
  const shared = read('src/components/settings/accountsShared.jsx')
  const offered = [...shared.matchAll(/\{ value: '([a-z-]+)',\s+label:/g)].map(m => m[1])
  assert.deepEqual(offered.sort(), [...ASSIGNABLE_ROLES].sort())
})

test('a legacy Viewer account is preserved, not broken', () => {
  // Still a known role in the vocabulary and the badge map...
  assert.ok(STAFF_ROLES.includes('viewer'))
  assert.match(read('src/components/settings/accountsShared.jsx'), /viewer:\s+\{ bg:/)
  // ...still rendered in the guide with an honest description...
  assert.match(ROLE_SUMMARY.viewer.detail, /continue to work/)
  // ...and holds nothing, including Keith.
  assert.equal(can(CALLERS.viewer, 'keith_chat'), false)
  assert.equal(capabilitiesFor(CALLERS.viewer).length, 0)
})

test('the guide shows no audit or security debug detail to Settings users', () => {
  const guide = read('src/lib/roleGuide.js')
  const exported = guide.slice(guide.indexOf('export const MODEL_NOTES'))
  for (const leak of ['divergence', 'audit note', 'is_owner', 'endpoint', 'api/']) {
    assert.ok(!exported.includes(leak), `MODEL_NOTES must not mention "${leak}"`)
  }
  assert.equal(MODEL_NOTES.length, 3)
  // The retired divergence warnings are gone.
  assert.ok(!guide.includes('KNOWN_INCONSISTENCIES'))
})

// ── Keith: the gate and the context boundary ─────────────────────────────────

test('Keith gates access BEFORE assembling context or calling the model', () => {
  const keith = api('keith.js')
  const gateAt = keith.indexOf("canAccess(auth, 'keith_chat')")
  const contextAt = keith.indexOf('let liveDataStr')
  const modelAt = keith.indexOf('await runToolLoop(')
  assert.ok(gateAt > -1, 'the gate exists')
  assert.ok(gateAt < contextAt, 'gate precedes context assembly')
  assert.ok(gateAt < modelAt, 'gate precedes the model call')
  assert.match(keith, /return res\.status\(403\)\.json\(\{\s*\n?\s*error: 'forbidden'/)
})

test('Keith context scope is role-minimized, and Viewer gets none', () => {
  assert.equal(keithContextScope(CALLERS.owner), KEITH_CONTEXT_SCOPES.FULL)
  assert.equal(keithContextScope(CALLERS.admin), KEITH_CONTEXT_SCOPES.FULL)
  assert.equal(keithContextScope(CALLERS['co-lead']), KEITH_CONTEXT_SCOPES.STUDENT_PLACEMENT)
  assert.equal(keithContextScope(CALLERS.interviewer), KEITH_CONTEXT_SCOPES.INTERVIEW)
  assert.equal(keithContextScope(CALLERS.viewer), KEITH_CONTEXT_SCOPES.NONE)
  assert.deepEqual(contextSectionsFor(CALLERS.viewer), [])

  // Co-Lead sees student/placement context but never communications or the
  // unit-leadership roster; Interviewer sees interview context only.
  assert.equal(allowsContextSection(CALLERS['co-lead'], 'roster'), true)
  assert.equal(allowsContextSection(CALLERS['co-lead'], 'communications'), false)
  assert.equal(allowsContextSection(CALLERS['co-lead'], 'unit_leadership'), false)
  assert.equal(allowsContextSection(CALLERS.interviewer, 'interviews'), true)
  assert.equal(allowsContextSection(CALLERS.interviewer, 'roster'), false)
  assert.equal(allowsContextSection(CALLERS.interviewer, 'capacity'), false)

  // The handler actually consults the gate for each section it composes.
  const keith = api('keith.js')
  for (const section of ['communications', 'unit_leadership', 'capacity', 'roster', 'status', 'oncampus', 'interviews']) {
    assert.match(keith, new RegExp(`allowsContextSection\\(auth, '${section}'\\)`), `${section} must be gated`)
  }
})

test('downstream Keith gates remain as defense in depth', () => {
  const keith = api('keith.js')
  assert.match(keith, /TOOL_AUTHORIZATION/)
  assert.match(keith, /\['owner', 'admin', 'interviewer'\]\.includes\(normalizedRole\)/)
  // Skills still decide per skill, and still deny viewer at the source.
  const live = { status: 'active', enabled: true, allowed_roles: ['viewer'], data_classification: 'internal', required_data: [] }
  assert.equal(authorizeSkillForCaller(live, { role: 'viewer', isOwner: false }).ok, false)
})

// ── The endpoints now read from the one table ────────────────────────────────

test('placement and student endpoints enforce the canonical capabilities', () => {
  const su = api('student-update.js')
  assert.match(su, /from '\.\.\/lib\/server\/access\.js'/)
  assert.match(su, /const canPlacement = canAccess\(auth, 'placement_manage'\)/)
  assert.match(su, /const canStudentManage = canAccess\(auth, 'student_manage'\)/)
  // The two intentional exclusions still require admin level.
  const badgeAt = su.indexOf("action === 'update_badge'")
  const statusAt = su.indexOf("action === 'update_student_status'")
  assert.match(su.slice(badgeAt, badgeAt + 400), /isOwnerAdmin/)
  assert.match(su.slice(statusAt, statusAt + 400), /isOwnerAdmin/)
  for (const f of ['preceptor-assignments.js', 'preceptor-assignment-manage.js', 'preceptor-primary-assign.js']) {
    assert.match(api(f), /canAccess\((profile|auth), 'placement_manage'\)/, f)
  }
})

test('enrichment: Admin may preview a plan, Owner alone may run it', () => {
  const enrich = api('knowledge-enrich.js')
  assert.match(enrich, /const isPlanOnly = String\(req\.body\?\.action \|\| ''\) === 'enrich_plan'/)
  assert.match(enrich, /canAccess\(auth, 'enrichment_preview'\)/)
  assert.match(enrich, /canAccess\(auth, 'enrichment_run'\)/)
})
