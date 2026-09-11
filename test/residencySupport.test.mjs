// RESIDENCY-SUPPORT-1: the Support tab's rules. Owner decisions, 2026-09-11:
// Before = Résumé Review, Town Hall, Interview Bootcamp, Placement Advising;
// During = Weekly Email Check-ins (sent through Connect, counted from its log)
// and Mentorship Sessions with the resident's assigned NPD-P. Only the ASPIRE
// team records; Talent Acquisition sees. Voided, never deleted.
// Run: node --test test/residencySupport.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { SUPPORT_ACTIVITIES, SUPPORT_ACTIVITY_KEYS, activitiesFor } from '../src/lib/ngrp/ngrpSupportActivities.js'
import { beforeResidency, duringResidency, isResident } from '../src/lib/ngrp/ngrpSupportView.js'
import { validateSupportEntry, validateAttendance, validateMentor, validateVoid, ATTENDANCE_MAX } from '../lib/server/ngrpSupport.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const code = src => src.split('\n').filter(l => !/^\s*(--|\/\/)/.test(l)).join('\n')
const ID = n => `00000000-0000-4000-8000-0000000000${n}`

test('the activities and their names are the Owner\'s', () => {
  assert.deepEqual(activitiesFor('before').map(a => a.label), ['Résumé Review', 'Town Hall', 'Interview Bootcamp', 'Placement Advising'])
  assert.deepEqual(activitiesFor('during').map(a => a.label), ['Mentorship Session'])
  assert.deepEqual(SUPPORT_ACTIVITIES.filter(a => a.mode === 'group').map(a => a.key), ['town_hall', 'interview_bootcamp'])
  assert.ok(!JSON.stringify(SUPPORT_ACTIVITIES).includes('Unit Advising'))
})

test('the migration\'s activity CHECK is exactly the shared list; server-only; no DELETE', () => {
  const sql = code(read('supabase/migrations/20260914000000_ngrp_support.sql'))
  const check = sql.match(/activity\s+text\s+NOT NULL CHECK \(activity IN \(([^)]*)\)\)/)
  assert.ok(check, 'activity CHECK present')
  assert.deepEqual(check[1].match(/'([a-z_]+)'/g).map(s => s.replace(/'/g, '')), [...SUPPORT_ACTIVITY_KEYS])
  for (const t of ['ngrp_support_entries', 'ngrp_resident_mentors']) {
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\.${t}\\s+FROM PUBLIC, anon, authenticated, service_role;`))
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE ON TABLE public\\.${t}\\s+TO service_role;`))
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`))
  }
  assert.doesNotMatch(sql, /GRANT[^;]*DELETE|GRANT[^;]*TO (anon|authenticated)/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_ngrp_support_entry_live\s+ON public\.ngrp_support_entries \(candidate_id, activity, occurred_on\)\s+WHERE voided_at IS NULL;/)
})

test('an entry: a real, past date; notes bounded; mentor name only on a mentorship session', () => {
  const ok = validateSupportEntry({ activity: 'resume_review', occurred_on: '2026-09-10', note: '  Tightened the summary. ', mentor_name: 'X' }, { today: '2026-09-11' })
  assert.deepEqual(ok, { ok: true, entry: { activity: 'resume_review', occurred_on: '2026-09-10', note: 'Tightened the summary.', mentor_name: null, event_id: null } })
  assert.equal(validateSupportEntry({ activity: 'mentorship_session', occurred_on: '2026-09-11', mentor_name: 'Jester' }, { today: '2026-09-11' }).entry.mentor_name, 'Jester')
  assert.equal(validateSupportEntry({ activity: 'unit_advising', occurred_on: '2026-09-10' }).ok, false)
  assert.equal(validateSupportEntry({ activity: 'town_hall', occurred_on: '2026-02-30' }).ok, false, 'not a real date')
  assert.equal(validateSupportEntry({ activity: 'town_hall', occurred_on: '2026-09-12' }, { today: '2026-09-11' }).ok, false, 'not in the future')
  assert.equal(validateSupportEntry({ activity: 'town_hall', occurred_on: '2026-09-10', note: 'x'.repeat(1001) }).ok, false)
})

test('attendance is for group activities only, 1 to 200 alumni', () => {
  const ok = validateAttendance({ activity: 'town_hall', occurred_on: '2026-09-10', candidate_ids: [ID('11'), ID('11'), ID('12')] }, { today: '2026-09-11' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.candidateIds, [ID('11'), ID('12')], 'duplicates collapse')
  assert.equal(validateAttendance({ activity: 'resume_review', occurred_on: '2026-09-10', candidate_ids: [ID('11')] }).ok, false)
  assert.equal(validateAttendance({ activity: 'town_hall', occurred_on: '2026-09-10', candidate_ids: [] }).ok, false)
  assert.equal(validateAttendance({ activity: 'town_hall', occurred_on: '2026-09-10', candidate_ids: ['nope'] }).ok, false)
  assert.equal(ATTENDANCE_MAX, 200)
  assert.equal(validateMentor({ mentor_name: '  ' }).ok, false)
  assert.deepEqual(validateMentor({ mentor_name: 'Jester Lloyd Bautista' }).mentor, { mentor_name: 'Jester Lloyd Bautista', mentor_profile_id: null })
  assert.equal(validateVoid({ entry_id: 'x' }).ok, false)
})

const row = (n, o = {}) => ({ id: ID(n), candidate_id: `k${n}`, student: { id: ID(n), first_name: n, last_name: 'Alum' }, ...o })

test('before residency: per-alumnus cells and KPI counts; voided entries never count', () => {
  const rows = [row('11'), row('12'), row('13')]
  const entries = [
    { student_id: ID('11'), activity: 'resume_review', occurred_on: '2026-08-01' },
    { student_id: ID('11'), activity: 'resume_review', occurred_on: '2026-08-20' },
    { student_id: ID('11'), activity: 'town_hall', occurred_on: '2026-08-05' },
    { student_id: ID('12'), activity: 'placement_advising', occurred_on: '2026-08-06' },
    { student_id: ID('13'), activity: 'town_hall', occurred_on: '2026-08-05', voided_at: '2026-08-06T00:00:00Z' },
  ]
  const b = beforeResidency(rows, entries)
  assert.deepEqual(b.rows[0].cells.resume_review, { count: 2, last: '2026-08-20' })
  assert.equal(b.kpis.supported, 2)
  assert.equal(b.kpis.alumni, 3)
  assert.equal(b.kpis.resume_review, 1)
  assert.equal(b.kpis.town_hall, 1, 'the voided attendance is gone')
  assert.equal(b.rows[2].total, 0)
})

test('during residency: residents, mentors, check-ins from Connect, overdue after 7 days', () => {
  const hired = { hired_at: '2027-01-05T00:00:00Z', residency_start_date: '2027-01-11' }
  const rows = [
    row('11', { outcome: hired }),
    row('12', { outcome: hired }),
    row('13', { outcome: { ...hired, separated_at: '2027-02-01T00:00:00Z' } }),
    row('14'),
  ]
  assert.equal(isResident(rows[2]), false, 'separated residents drop off')
  const d = duringResidency(rows, {
    today: '2027-01-25',
    mentors: [{ candidate_id: 'k11', mentor_name: 'Jester Lloyd Bautista' }],
    checkins: [{ student_id: ID('11'), sent_at: '2027-01-20T16:00:00Z' }, { student_id: ID('11'), sent_at: '2027-01-13T16:00:00Z' }],
    entries: [{ student_id: ID('11'), activity: 'mentorship_session', occurred_on: '2027-01-15' }],
  })
  assert.equal(d.residents.length, 2)
  const [ana, ben] = d.residents
  assert.equal(ana.mentor.mentor_name, 'Jester Lloyd Bautista')
  assert.equal(ana.checkins, 2)
  assert.equal(ana.lastCheckin, '2027-01-20')
  assert.equal(ana.overdue, false, '5 days since the last one')
  assert.equal(ana.sessions, 1)
  assert.equal(ben.overdue, true, 'started 14 days ago with no check-in')
  assert.deepEqual(d.kpis, { residents: 2, withMentor: 1, overdue: 1, checkins: 2, sessions: 1 })
  const early = duringResidency(rows, { today: '2027-01-08' })
  assert.equal(early.residents.every(r => !r.overdue && !r.started), true, 'nothing is due before the residency starts')
})

test('the endpoint: Talent Acquisition reads the narrowed roster and never writes; entries are voided', () => {
  const api = read('api/ngrp-support.js')
  assert.match(api, /verifyNgrpCaller\(req, \{ manage: WRITES\.has\(action\) \}\)/)
  assert.match(api, /if \(WRITES\.has\(action\) && isTA\) return res\.status\(403\)\.json\(\{ error: 'aspire_team_only' \}\)/)
  assert.match(api, /const view = isTA \? narrowPayloadForTalentAcquisition\(payload\) : payload/)
  assert.match(api, /\.is\('voided_at', null\)/)
  assert.doesNotMatch(api, /\.delete\(/, 'nothing is ever deleted')
  assert.match(api, /if \(isUnique\(ins\.error\)\) return res\.status\(409\)\.json\(\{ error: 'already_recorded' \}\)/)
})
