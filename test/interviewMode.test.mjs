// INTERVIEW-MODE-1 (Owner, 2026-10-05): in person or virtual, optional.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateInterviewPayload, INTERVIEW_MODES } from '../lib/server/ngrpPlanning.js'
import { INTERVIEW_MODE_LABELS } from '../src/lib/ngrp/ngrpStates.js'
import { buildResidencyCsv } from '../lib/server/ngrpResidencyExport.js'
import { packetSummary } from '../src/lib/ngrp/applicantPacketModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('MODE 1: optional; absent leaves it alone, blank clears it, anything else is refused', () => {
  assert.deepEqual(INTERVIEW_MODES, ['in_person', 'virtual'])
  assert.deepEqual(Object.keys(INTERVIEW_MODE_LABELS), INTERVIEW_MODES)
  const at = '2026-12-10T17:00:00.000Z'
  assert.equal('interview_mode' in validateInterviewPayload({ status: 'scheduled', interview_at: at }).interview, false)
  assert.equal(validateInterviewPayload({ status: 'scheduled', interview_at: at, interview_mode: 'virtual' }).interview.interview_mode, 'virtual')
  assert.equal(validateInterviewPayload({ status: 'completed', interview_at: at, interview_mode: '' }).interview.interview_mode, null)
  const bad = validateInterviewPayload({ status: 'scheduled', interview_at: at, interview_mode: 'phone' })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some(e => e.field === 'interview_mode'))
})

test('MODE 2: the column and its CHECK match the code; the save works on both sides of it', () => {
  const mig = read('supabase/migrations/20261110000000_interview_mode.sql')
  assert.match(mig, /ADD COLUMN IF NOT EXISTS interview_mode text/)
  assert.match(mig, /CHECK \(interview_mode IS NULL OR interview_mode IN \('in_person', 'virtual'\)\)/)
  const manage = read('api/ngrp-manage.js')
  assert.match(manage, /if \(upd\.error && isMissingNgrpColumn\(upd\.error\) && v\.interview\.interview_mode !== undefined\)/, 'before the column, the interview still saves')
  assert.match(read('lib/server/ngrpApplicants.js'), /interviewModeProvisioned: candidatesRes\.interviewModeProvisioned === true/)
  assert.match(read('api/ngrp-workspace.js'), /interviewModeProvisioned: payload\.interviewModeProvisioned === true/)
})

test('MODE 3: shown in the binder only where it can be stored, on the board, in the CSV and the packet', () => {
  const chart = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(chart, /modeAvailable && KEEPS_TIME\.includes\(status\) && \(/)
  assert.match(chart, /\.\.\.\(modeAvailable \? \{ interview_mode: KEEPS_TIME\.includes\(status\) \? mode : '' \} : \{\}\)/)
  assert.match(read('src/components/ngrp/ProfilesTab.jsx'), /interviewModeAvailable=\{payload\?\.interviewModeProvisioned === true\}/)
  assert.match(read('src/components/ngrp/InterviewBoard.jsx'), /interviewModeAvailable=\{applicants\.payload\?\.interviewModeProvisioned === true\}/)
  assert.match(read('src/components/ngrp/InterviewBoard.jsx'), /INTERVIEW_MODE_LABELS\[row\.interview_mode\]/)
  const csv = buildResidencyCsv({
    cycle: { name: 'Winter 2027' },
    students: [{ id: 's1', first_name: 'A', last_name: 'B', status: 'Completed' }],
    candidates: [{ id: 'c1', student_id: 's1', interview_status: 'completed', interview_at: '2026-12-11T01:30:00Z', interview_mode: 'in_person' }],
    revisionsByAssignment: new Map(),
  }).csv
  const [head, row] = csv.replace(/^﻿/, '').split(/\r?\n/)
  const cols = head.split(',')
  const cells = row.split(',')
  assert.equal(cells[cols.indexOf('Interview Format')], 'In person')
  assert.equal(cells[cols.indexOf('Interview Date')], '2026-12-10', 'the Pacific day of a 5:30 PM interview')
  const s = packetSummary({ row: { student: {}, interview_status: 'completed', interview_at: '2026-12-10T18:00:00Z', interview_mode: 'virtual' }, cycle: null, documents: [] })
  assert.match(s.sections.find(x => x.heading === 'Application').rows.find(([l]) => l === 'Interview')[1], /Virtual$/)
})
