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
  assert.match(src, /isMissingNgrpTable\(r\.error\) \? \{ provisioned: false, ids: \[\] \}/, 'before the migration: nobody added')
  assert.match(src, /added_to_roster: true/)
  assert.match(src, /addedProvisioned: added\.provisioned/)
  for (const [f, re] of [
    ['api/ngrp-transition-send.js', /fetchAddedStudentIds\(db, cycle\.id\)/],
    ['lib/server/ngrpApplicantProfile.js', /fetchAddedStudentIds\(db, cycleId\)/],
    ['lib/server/alumnusResidency.js', /fetchAddedCycleIdsForStudent\(db, student\.id\)/],
  ]) assert.match(read(f), re, f)
})

test('Add alumnus is the Owner and Admin only, and every step is logged', () => {
  const api = read('api/ngrp-manage.js')
  assert.match(api, /if \(action\.startsWith\('alumni_'\)\) \{\s*if \(isTalentAcquisition \|\| !\['owner', 'admin'\]\.includes\(caller\.profile\.role\)\) \{\s*return res\.status\(403\)/)
  for (const t of ['alumnus_added', 'alumnus_removed', 'alumnus_invited']) assert.match(api, new RegExp(`eventType: '${t}'`))
  assert.match(api, /if \(body\.confirm_new !== true\) \{\s*const m = await findMatches/)
  assert.match(api, /status: 'Completed'/)
  assert.match(read('lib/server/ngrpAddedAlumni.js'), /\.update\(\{ removed_at: nowIso, removed_by_profile_id: actorId \}\)/, 'removing never deletes')
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /const canAddAlumni = staffApp && \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
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
