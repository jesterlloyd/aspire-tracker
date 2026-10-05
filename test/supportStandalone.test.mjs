// SUPPORT-STANDALONE-1 (Owner, 2026-10-04): support stands on its own. An alumnus the
// Transition Form has not reached yet can be logged; Log group activity enrolls them in
// the cycle as it writes, skips repeats with a count, and returns the ids its Undo voids.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { enrollStudents, writeGroupEntries } from '../lib/server/ngrpSupportLog.js'
import { validateAttendance, validateUndo } from '../lib/server/ngrpSupport.js'
import { BULK_ACTIVITY_KEYS, SUPPORT_ACTIVITY_KEYS } from '../src/lib/ngrp/ngrpSupportActivities.js'
import {
  beforeResidency, formStatusPill, groupLogChoices, lastEventDay, dayBefore,
} from '../src/lib/ngrp/ngrpSupportView.js'

const ID = n => `00000000-0000-4000-8000-0000000000${n}`
const CYCLE = ID('99')

// A tiny in-memory PostgREST stand-in: enough of from().select().eq().in().is() and
// insert/upsert to exercise the two writers, with the real unique rules.
function fakeDb({ candidates = [], entries = [], raceOn = null } = {}) {
  const tables = { ngrp_candidates: candidates.map(c => ({ ...c })), ngrp_support_entries: entries.map(e => ({ ...e })) }
  let seq = 0
  const calls = []
  function query(table) {
    const filters = []
    let mode = 'select'
    let payload = null
    let opts = {}
    const run = () => {
      calls.push({ table, mode })
      const rows = tables[table]
      if (mode === 'select') return { data: rows.filter(r => filters.every(f => f(r))), error: null }
      const list = Array.isArray(payload) ? payload : [payload]
      if (table === 'ngrp_candidates') {
        for (const p of list) {
          if (rows.some(r => r.cycle_id === p.cycle_id && r.student_id === p.student_id)) {
            if (opts.ignoreDuplicates) continue
            return { data: null, error: { code: '23505' } }
          }
          rows.push({ id: `c-${p.student_id}`, ...p })
        }
        return { data: null, error: null }
      }
      // entries: live unique (candidate_id, activity, occurred_on)
      if (raceOn && Array.isArray(payload) && list.some(p => p.candidate_id === raceOn)) {
        rows.push({ id: `e-race`, candidate_id: raceOn, activity: list[0].activity, occurred_on: list[0].occurred_on, voided_at: null })
        raceOn = null
        return { data: null, error: { code: '23505' } }
      }
      const clash = p => rows.some(r => !r.voided_at && r.candidate_id === p.candidate_id && r.activity === p.activity && r.occurred_on === p.occurred_on)
      if (list.some(clash)) return { data: null, error: { code: '23505' } }
      const made = list.map(p => { const r = { id: `e${++seq}`, voided_at: null, ...p }; rows.push(r); return r })
      return { data: Array.isArray(payload) ? made.map(r => ({ id: r.id })) : { id: made[0].id }, error: null }
    }
    const q = {
      select() { return q },
      eq(k, v) { filters.push(r => r[k] === v); return q },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return q },
      insert(p) { mode = 'insert'; payload = p; return q },
      upsert(p, o) { mode = 'upsert'; payload = p; opts = o || {}; return q },
      maybeSingle() { return Promise.resolve(run()) },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return q
  }
  return { from: query, tables, calls }
}

test('an alumnus with no transition form is enrolled, not refused', async () => {
  const db = fakeDb({ candidates: [{ id: 'c-old', cycle_id: CYCLE, student_id: ID('11') }] })
  const r = await enrollStudents(db, { cycleId: CYCLE, studentIds: [ID('11'), ID('12')] })
  assert.equal(r.error, undefined)
  assert.equal(r.enrolled, 1, 'only the missing one is created')
  assert.equal(r.byStudent.get(ID('11')).id, 'c-old', 'an existing enrollment is reused, never duplicated')
  assert.equal(db.tables.ngrp_candidates.length, 2)
  const again = await enrollStudents(db, { cycleId: CYCLE, studentIds: [ID('12')] })
  assert.equal(again.enrolled, 0, 'a second log finds the row it made')
})

test('a repeat is skipped and counted; new rows come back as Undo ids', async () => {
  const db = fakeDb({ entries: [{ id: 'old', candidate_id: 'c1', activity: 'town_hall', occurred_on: '2026-10-01', voided_at: null }] })
  const cands = [{ id: 'c1', student_id: ID('11') }, { id: 'c2', student_id: ID('12') }, { id: 'c3', student_id: ID('13') }]
  const entry = { activity: 'town_hall', occurred_on: '2026-10-01', note: null, mentor_name: null, event_id: null }
  const w = await writeGroupEntries(db, { cycleId: CYCLE, candidates: cands, entry, actorId: ID('01') })
  assert.equal(w.created, 2)
  assert.equal(w.alreadyRecorded, 1)
  assert.equal(w.entryIds.length, 2)
  const inserts = db.calls.filter(c => c.table === 'ngrp_support_entries' && c.mode === 'insert')
  assert.equal(inserts.length, 1, 'one insert for the whole save')
  const second = await writeGroupEntries(db, { cycleId: CYCLE, candidates: cands, entry, actorId: ID('01') })
  assert.deepEqual([second.created, second.alreadyRecorded, second.entryIds.length], [0, 3, 0])
})

test('a concurrent save between the read and the insert still counts exactly', async () => {
  const db = fakeDb({ raceOn: 'c2' })
  const cands = [{ id: 'c1', student_id: ID('11') }, { id: 'c2', student_id: ID('12') }]
  const entry = { activity: 'interview_bootcamp', occurred_on: '2026-10-02', note: null, mentor_name: null, event_id: null }
  const w = await writeGroupEntries(db, { cycleId: CYCLE, candidates: cands, entry, actorId: ID('01') })
  assert.deepEqual([w.created, w.alreadyRecorded], [1, 1])
})

test('Log group activity names alumni by student; mentorship is not a group activity', () => {
  const v = validateAttendance({ activity: 'placement_advising', occurred_on: '2026-10-01', student_ids: [ID('11'), ID('11')] }, { today: '2026-10-04' })
  assert.equal(v.ok, true)
  assert.deepEqual(v.studentIds, [ID('11')])
  assert.equal(v.candidateIds, null)
  assert.equal(validateAttendance({ activity: 'town_hall', occurred_on: '2026-10-05', student_ids: [ID('11')] }, { today: '2026-10-04' }).ok, false, 'never a future date')
  assert.ok(BULK_ACTIVITY_KEYS.every(k => SUPPORT_ACTIVITY_KEYS.includes(k)))
  assert.ok(!BULK_ACTIVITY_KEYS.includes('mentorship_session'))
  assert.equal(validateUndo({ entry_ids: [] }).ok, false)
  assert.equal(validateUndo({ entry_ids: ['x'] }).ok, false)
  assert.deepEqual(validateUndo({ entry_ids: [ID('21'), ID('21')] }).entryIds, [ID('21')])
})

test('the endpoint checks the roster, enrolls, and undoes only the caller\'s own live entries', () => {
  const src = readFileSync(new URL('../api/ngrp-support.js', import.meta.url), 'utf8')
  assert.match(src, /roster\.has\(id\)/, 'a student id must be on the cycle roster')
  assert.match(src, /enrollStudents\(db, \{ cycleId, studentIds: v\.studentIds \}\)/)
  const undo = src.slice(src.indexOf("if (action === 'void_batch')"))
  assert.match(undo, /\.eq\('recorded_by_profile_id', actorId\)\.is\('voided_at', null\)/)
  assert.doesNotMatch(undo.slice(0, 800), /\.delete\(/, 'Undo voids, never deletes')
  assert.match(src, /const WRITES = new Set\(\[[^\]]*'void_batch'/, 'Undo needs the manage capability')
})

test('the form is a pill, never a gate', () => {
  assert.deepEqual(formStatusPill('submitted'), { label: 'Submitted', tone: 'ok' })
  assert.deepEqual(formStatusPill('revised'), { label: 'Submitted', tone: 'ok' })
  assert.deepEqual(formStatusPill('opened'), { label: 'Pending', tone: 'warn' })
  assert.deepEqual(formStatusPill('pending'), { label: 'Not sent', tone: 'off' }, 'a send the provider never accepted is not Sent')
  assert.deepEqual(formStatusPill(undefined), { label: 'Not sent', tone: 'off' })
  const rows = [{ id: ID('11'), student: { id: ID('11') }, candidate_id: null, form_status: 'not_sent' }]
  const b = beforeResidency(rows, [])
  assert.equal(b.rows[0].form.label, 'Not sent')
  assert.equal(b.kpis.alumni, 1, 'an alumnus with no form is on the roster')
})

test('roster filters, last event and yesterday', () => {
  const rows = [
    { id: ID('11'), student: { id: ID('11') }, form_status: 'submitted' },
    { id: ID('12'), student: { id: ID('12') }, form_status: 'sent' },
    { id: ID('13'), student: { id: ID('13') }, form_status: 'not_sent' },
  ]
  const entries = [
    { student_id: ID('11'), activity: 'town_hall', occurred_on: '2026-09-30' },
    { student_id: ID('12'), activity: 'town_hall', occurred_on: '2026-10-02', voided_at: '2026-10-02T10:00:00Z' },
  ]
  const ids = list => list.map(r => r.id)
  assert.deepEqual(ids(groupLogChoices(rows, entries, { activity: 'town_hall', filter: 'all' })), [ID('11'), ID('12'), ID('13')])
  assert.deepEqual(ids(groupLogChoices(rows, entries, { activity: 'town_hall', filter: 'not_yet' })), [ID('12'), ID('13')], 'a voided entry is not done')
  assert.deepEqual(ids(groupLogChoices(rows, entries, { activity: 'town_hall', filter: 'form_open' })), [ID('12'), ID('13')])
  assert.equal(lastEventDay(entries, 'town_hall'), '2026-09-30')
  assert.equal(lastEventDay(entries, 'interview_bootcamp'), null)
  assert.equal(dayBefore('2026-03-01'), '2026-02-28')
  assert.equal(dayBefore('2026-01-01'), '2025-12-31')
})
