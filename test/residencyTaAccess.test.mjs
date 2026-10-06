// RESIDENCY-TA-1 (Owner, 2026-10-05): Talent Acquisition logs, flags, uploads and scores in
// Residency for ALUMNI, and Settings > Residency Activity shows who did what.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { authorizeStudentResumeAccess, authorizeSkillForCaller } from '../lib/server/keith/skillAuthorization.js'
import { canSeeEntity, provenanceCards } from '../lib/server/keith/provenanceCards.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { EVENT_LABELS, actorOf, detailOf, eventLabel, matchesGroup, activityCsv } from '../src/lib/ngrp/residencyActivityModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('Keith: talent_acquisition reads and scores ALUMNI résumés only, and only where the Skill lists it', async () => {
  const caller = { profileId: 'p1', role: 'talent_acquisition' }
  assert.equal((await authorizeStudentResumeAccess({ db: {}, caller, student: { id: 's1', cohort_id: 'c1', status: 'Completed' } })).ok, true)
  assert.equal((await authorizeStudentResumeAccess({ db: {}, caller, student: { id: 's2', cohort_id: 'c1', status: 'Active Rotation' } })).ok, false)
  assert.equal(authorizeSkillForCaller({ status: 'active', enabled: true, allowed_roles: ['owner', 'admin'] }, caller).ok, false, 'not until the migration lists it')
  assert.equal(authorizeSkillForCaller({ status: 'active', enabled: true, allowed_roles: ['owner', 'admin', 'talent_acquisition'] }, caller).ok, true)
})

test('Keith marks: Talent Acquisition sees résumé reviews, nothing else, and only an alumnus\'s', async () => {
  assert.equal(canSeeEntity({ role: 'portal' }, 'resume_review', { talentAcquisition: true }), true)
  assert.equal(canSeeEntity({ role: 'portal' }, 'budget_receipt', { talentAcquisition: true }), false)
  assert.equal(canSeeEntity({ role: 'portal' }, 'resume_review'), false, 'a portal user without the grant sees nothing')
  const tables = {
    keith_provenance: [
      { id: 'a0000000-0000-4000-8000-000000000001', skill_key: 'review-resume', entity_type: 'resume_review', entity_id: 'r1', input_refs: [], state: 'drafted', created_at: 'x' },
      { id: 'a0000000-0000-4000-8000-000000000002', skill_key: 'review-resume', entity_type: 'resume_review', entity_id: 'r2', input_refs: [], state: 'drafted', created_at: 'x' },
    ],
    resume_reviews: [{ id: 'r1', student_id: 'alum' }, { id: 'r2', student_id: 'current' }],
    students: [{ id: 'alum', status: 'Completed' }, { id: 'current', status: 'Active Rotation' }],
    keith_skills: [{ slug: 'review-resume', display_name: 'Review Résumé' }],
  }
  const db = { from: name => { const f = []; const api = { select: () => api, in: (c, v) => { f.push(r => v.includes(r[c])); return api }, then: (ok) => Promise.resolve({ data: (tables[name] || []).filter(r => f.every(fn => fn(r))), error: null }).then(ok) }; return api } }
  const cards = await provenanceCards(db, { role: 'portal' }, tables.keith_provenance.map(r => r.id), { talentAcquisition: true })
  assert.deepEqual(Object.keys(cards), ['a0000000-0000-4000-8000-000000000001'])
})

test('the log: the migration allows exactly what the code writes, and every type has words', () => {
  const mig = read('supabase/migrations/20261108000000_residency_ta_access.sql')
  const check = mig.slice(mig.indexOf('CHECK (event_type IN ('), mig.indexOf("));", mig.indexOf('CHECK (event_type IN (')))
  const inSql = [...check.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(inSql, [...NGRP_AUDIT_EVENTS].sort())
  for (const t of NGRP_AUDIT_EVENTS) assert.ok(EVENT_LABELS[t], `${t} has a label`)
  assert.match(mig, /SET allowed_roles = array_append\(allowed_roles, 'talent_acquisition'\)\s+WHERE slug = 'review-resume'\s+AND NOT \('talent_acquisition' = ANY \(allowed_roles\)\)/)
})

test('the log in words: who, which team, what, and a CSV that never runs a formula', () => {
  assert.deepEqual(actorOf({ actor_profile_id: 'p', actor_name: 'Dana Lee', actor_role: 'portal' }), { name: 'Dana Lee', team: 'Talent Acquisition' })
  assert.deepEqual(actorOf({ actor_profile_id: 'p', actor_name: 'Jester', actor_role: 'owner' }), { name: 'Jester', team: 'ASPIRE' })
  assert.deepEqual(actorOf({ actor_kind: 'alumnus', student_name: 'Bayaraa, Emi' }), { name: 'Bayaraa, Emi', team: 'Alumnus' })
  assert.equal(eventLabel('followup_flagged'), 'Flagged for follow-up')
  assert.equal(detailOf({ event_type: 'support_logged', metadata: { activity: 'town_hall' } }), 'Town Hall')
  assert.equal(detailOf({ event_type: 'document_uploaded', metadata: { doc_type: 'personal_statement' } }), 'Personal statement')
  assert.ok(matchesGroup({ event_type: 'support_voided' }, 'support'))
  assert.ok(!matchesGroup({ event_type: 'support_voided' }, 'flags'))
  const csv = activityCsv([{ created_at: '2026-10-05T10:00:00Z', actor_profile_id: 'p', actor_name: '=cmd()', actor_role: 'portal', event_type: 'support_logged', student_name: 'Bayaraa, Emi', metadata: { activity: 'town_hall' } }])
  assert.match(csv, /'=cmd\(\)/, 'a formula-looking cell is defused')
})

test('the log page: Owner and Admin only, in the Program group, and one population', () => {
  const manage = read('api/ngrp-manage.js')
  const block = manage.slice(manage.indexOf("if (action === 'activity_log')"), manage.indexOf('// ── RESIDENCY-FLAG-1'))
  assert.match(block, /if \(isTalentAcquisition \|\| !isAdmin\) return res\.status\(403\)/)
  assert.match(block, /demo: populationOf\(req\)/)
  assert.match(read('src/components/settings/settingsSections.js'), /\{ key: 'residencyActivity', label: 'Residency Activity', path: '\/settings\/residency-activity', group: 'Program', implemented: true, visible: r => r\.isAdmin \}/)
  assert.match(read('lib/server/residencyActivity.js'), /if \(isDemo !== demo\) continue/)
})

test('every new action writes the log', () => {
  assert.match(read('api/ngrp-support.js'), /await auditEntries\(db, 'support_logged', w\.entryIds, actorId\)/)
  assert.match(read('api/ngrp-support.js'), /await auditEntries\(db, 'support_voided'/)
  assert.match(read('api/student-documents.js'), /eventType: 'document_uploaded'/)
  assert.match(read('api/student-documents.js'), /eventType: 'resume_scored'/)
  assert.match(read('api/ngrp-manage.js'), /'followup_flagged' : 'followup_unflagged'/)
})

test('what stays with the ASPIRE team: sending, links, the mentor, the reflection tool', () => {
  const support = read('api/ngrp-support.js')
  assert.match(support, /const TA_WRITES = new Set\(\['record', 'record_attendance', 'void', 'void_batch'\]\)/)
  assert.match(support, /if \(isTA\) q = q\.eq\('recorded_by_profile_id', actorId\)/, 'Talent Acquisition removes only its own entries')
  assert.match(read('src/components/documents/ResumeReviewDrawer.jsx'), /const canHandoff = canWrite && canSendForms &&/)
})
