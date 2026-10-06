// NGRP-INTERVIEWS-1 Phase 3: the Unit Leader Portal's Interviews tab, server side.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interviewSlice, scopeUnits, slotTimes, pacificToIso, validateBlock } from '../lib/server/ngrpUnitInterviews.js'
import { createUnitInterviewsHandler } from '../api/portal/unit-interviews.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const person = (id, last, prefs, unit = null, extra = {}) => ({
  id, candidate_id: `c-${id}`, student: { first_name: 'A', last_name: last, school: 'S', status: 'Completed' },
  staff_unit_preferences: prefs, assigned_unit: unit, interview_status: 'not_scheduled', ...extra,
})

test('UNIT 1: only applicants PAIRED with the caller\'s unit are listed; ranked-first is a count', () => {
  const units = scopeUnits(['6 NE', '5 North'], '6NE')
  assert.deepEqual(units, [{ key: units[0].key, name: '6 NE' }], 'a filter narrows, and 6NE matches 6 NE')
  const rows = [
    person('1', 'Reyes', ['6 NE', '5 North', '8 SCCT'], '6 NE'),
    person('2', 'Chen', ['5 North', '6 NE', '8 SCCT'], '6 NE'),
    person('3', 'Patel', ['6 NE', '8 SCCT', '5 North'], null),
    person('4', 'Nguyen', ['6 NE', '8 SCCT', '5 North'], '8 SCCT'),
  ]
  const s = interviewSlice(rows, units)
  assert.deepEqual(s.interviewees.map(i => [i.last_name, i.choice_rank]), [['Reyes', 1], ['Chen', 2]])
  assert.deepEqual(s.rankedFirst, [{ unit: '6 NE', count: 3 }], 'Reyes, Patel and Nguyen ranked 6 NE first')
  for (const k of ['school_email', 'personal_email', 'phone', 'date_of_birth', 'student_id']) assert.equal(k in s.interviewees[0], false, k)
})

test('UNIT 2: open times are Pacific wall clock, across the daylight-saving change, and the block is checked', () => {
  assert.equal(pacificToIso('2026-12-10', '09:00'), '2026-12-10T17:00:00.000Z', 'PST is UTC-8')
  assert.equal(pacificToIso('2026-10-06', '09:00'), '2026-10-06T16:00:00.000Z', 'PDT is UTC-7')
  assert.deepEqual(slotTimes({ block_date: '2026-12-10', start_time: '09:00', end_time: '10:30', duration_minutes: 30, break_minutes: 0 }),
    ['2026-12-10T17:00:00.000Z', '2026-12-10T17:30:00.000Z', '2026-12-10T18:00:00.000Z'])
  assert.equal(slotTimes({ block_date: '2026-12-10', start_time: '09:00', end_time: '10:30', duration_minutes: 30, break_minutes: 15 }).length, 2)
  assert.equal(validateBlock({ block_date: '2026-12-10', start_time: '10:00', end_time: '09:00', duration_minutes: 30 }).ok, false)
  assert.equal(validateBlock({ block_date: '2026-12-10', start_time: '09:00', end_time: '09:20', duration_minutes: 30 }).ok, false)
  assert.equal(validateBlock({ block_date: '2026-12-10', start_time: '09:00', end_time: '12:00', duration_minutes: 30, interview_mode: 'phone' }).ok, false)
  assert.ok(validateBlock({ block_date: '2026-12-10', start_time: '09:00', end_time: '12:00', duration_minutes: 30, break_minutes: 10, interview_mode: 'virtual' }).ok)
})

test('UNIT 3: a preview reads and never writes; an unknown action is refused before any lookup', async () => {
  const res = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v }; r.status = c => { r.code = c; return r }; r.json = b => { r.body = b; return r }; return r }
  let verified = 0
  const handler = createUnitInterviewsHandler({ verifyCaller: async () => { verified++; return { ok: true, staffPreview: true, db: {}, profile: { id: 'p' }, unitKeys: ['6 NE'] } } })
  const r1 = res(); await handler({ method: 'POST', body: { action: 'rubric_save', candidate_id: 'x' } }, r1)
  assert.equal(r1.code, 403); assert.equal(r1.body.error, 'preview_read_only')
  const r2 = res(); await handler({ method: 'POST', body: { action: 'drop_tables' } }, r2)
  assert.equal(r2.code, 400); assert.equal(verified, 1, 'refused before verifying')
})

test('UNIT 4: the rules the routes keep, in the source', () => {
  const lib = read('lib/server/ngrpUnitInterviews.js')
  assert.match(lib, /\.eq\('interviewer_profile_id', profileId\)/, 'own rubrics only')
  assert.match(lib, /answers\?\.attestation\?\.consent_unit_share === true/, 'form answers only with the units consent')
  assert.match(lib, /if \(\(booked\.data \|\| \[\]\)\.length\) return \{ status: 409, error: 'has_bookings' \}/)
  assert.match(lib, /if \(s\.data\.status === 'booked'\) return \{ status: 409, error: 'booked' \}/)
  assert.match(lib, /if \(completing && \['not_scheduled', 'scheduled'\]\.includes/, 'a completed rubric marks the interview held')
})

test('NAV 1: At a Glance first, the rest alphabetical by label, and the explicit key lists agree', async () => {
  const chrome = read('src/portal/unit/UnitLeaderChrome.jsx')
  const { NAV_LABELS } = await import('../src/lib/navigationCanon.js')
  const labelKey = { capacity: 'capacity', evaluations: 'evaluation', interviews: 'interviews', messages: 'messages', placements: 'placementRequests', preceptors: 'preceptors' }
  const desktop = JSON.parse(chrome.match(/const DESKTOP_KEYS = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
  assert.equal(desktop[0], 'home')
  const rest = desktop.slice(1).map(k => NAV_LABELS[labelKey[k]])
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)), 'alphabetical by the label the reader sees')
  assert.match(chrome, /const LANDING = \{ key: 'home', label: NAV_LABELS\.atAGlance/)
  assert.match(read('src/portal/PortalApp.jsx'), /'interviews',\n\]\)/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /view === 'interviews' && \(/)
})
