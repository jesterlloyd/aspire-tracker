// ADD-ALUMNUS-1 (Owner, 2026-10-29): Residency > Profiles & Interest > Add alumnus.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateProfile, studentColumnsFrom, PROFILE_KEYS } from '../lib/server/ngrpAddedAlumni.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('the profile is the application profile only, and the email is required', () => {
  assert.deepEqual([...PROFILE_KEYS], ['first_name', 'last_name', 'preferred_first_name', 'personal_email', 'phone', 'school', 'program_type', 'estimated_graduation_date', 'precepted_unit'])
  const bad = validateProfile({ first_name: ' ', last_name: 'Avery', personal_email: 'nope' })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.errors.map(e => e.field).sort(), ['first_name', 'personal_email'])
  const v = validateProfile({ first_name: ' Jordan ', last_name: 'Avery', personal_email: 'Jordan@Example.com', estimated_graduation_date: '2025-12-15', precepted_unit: '6 NE' })
  assert.equal(v.ok, true)
  assert.equal(v.profile.personal_email, 'jordan@example.com')
  const cols = studentColumnsFrom(v.profile)
  assert.equal(cols.name, 'Jordan Avery')
  assert.equal(cols.unit, '6 NE', 'the reported precepted unit goes to students.unit')
  assert.equal(cols.phone, null)
  assert.equal(validateProfile({ first_name: 'A', last_name: 'B', personal_email: 'a@b.co', estimated_graduation_date: 'Dec 2025' }).ok, false)
})

test('the roster is the participating cohorts plus the alumni added by hand', () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /from\('ngrp_cycle_added_alumni'\)\.select\('student_id'\)\s*\.eq\('cycle_id', cycleId\)\.is\('removed_at', null\)/)
  // HIRE-PAST-COHORT-1 widened this: the read also returns the cohort's own hires (hiredIds).
  assert.match(src, /isMissingNgrpTable\(r\.error\) \? \{ provisioned: false, ids: \[\], hiredIds: \[\] \}/, 'before the migration: nobody added')
  assert.match(src, /from\('ngrp_residency_outcomes'\)\.select\('student_id'\)\.eq\('cycle_id', cycleId\)\.not\('hired_at', 'is', null\)/, 'a cohort lists its own hires')
  assert.match(src, /added_to_roster: true/)
  assert.match(src, /addedProvisioned: added\.provisioned/)
  for (const [f, re] of [
    ['api/ngrp-transition-send.js', /fetchAddedStudentIds\(db, cycle\.id\)/],
    ['lib/server/ngrpApplicantProfile.js', /fetchAddedStudentIds\(db, cycleId\)/],
    ['lib/server/alumnusResidency.js', /fetchAddedCycleIdsForStudent\(db, student\.id\)/],
  ]) assert.match(read(f), re, f)
})

// RESIDENCY-PROFILES-TOOLBAR-1 (this commit) let Talent Acquisition add alumni (search, add,
// create); removing and the portal invitation are still the Owner's and Admins'. Pinned in full
// in test/residencyProfilesToolbar.test.mjs.
test('Add alumnus is the Owner, Admins and Talent Acquisition, and every step is logged', () => {
  const api = read('api/ngrp-manage.js')
  assert.match(api, /const ownerAdmin = !isTalentAcquisition && \['owner', 'admin'\]\.includes\(caller\.profile\.role\)/)
  assert.match(api, /if \(!ownerAdmin && !taAllowed\) \{\s*return res\.status\(403\)/)
  for (const t of ['alumnus_added', 'alumnus_removed', 'alumnus_invited']) assert.match(api, new RegExp(`eventType: '${t}'`))
  assert.match(api, /if \(body\.confirm_new !== true\) \{\s*const m = await findMatches/)
  assert.match(api, /status: 'Completed'/)
  assert.match(read('lib/server/ngrpAddedAlumni.js'), /\.update\(\{ removed_at: nowIso, removed_by_profile_id: actorId \}\)/, 'removing never deletes')
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /const canAddAlumni = canManage && \(ownerAdmin \|\| !staffApp\)/)
  assert.match(tab, /\{s\.added_to_roster && \(/)
})

test('the portal card saves to their own record and keeps the program\'s fields read-only', () => {
  const api = read('api/portal/my-residency.js')
  assert.match(api, /const upd = await db\.from\('students'\)\.update\(cols\)\.eq\('id', student\.id\)/)
  assert.match(api, /if \(student\.matched_unit_id\) delete cols\.unit/)
  assert.doesNotMatch(api, /aspire_cohort: v\.profile/)
  const card = read('src/portal/ApplicationProfileCard.jsx')
  assert.match(card, /postMyResidency\('profile_save'/)
  assert.match(card, /p\.precepted_from_placement\s*\? <div className="sr-pstatic">/)
  assert.match(card, /'ASPIRE cohort', <div className="sr-pstatic">/)
})
