// Owner, 2026-10-05, on Residency > Profiles & Interest: stop scrolling past the end, name the
// views Profiles | Interest, mirror Student Profiles' list (header, Grid, the follow-up flag),
// and land on At a Glance when switching to Residency.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { narrowPayloadForTalentAcquisition } from '../lib/server/ngrpTalentAcquisition.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const tab = read('src/components/ngrp/ProfilesTab.jsx')
const manage = read('api/ngrp-manage.js')

// RESIDENCY-TA-1 (Owner, 2026-10-05) changed this: one shared flag, Talent Acquisition included.
test('RESIDENCY-FLAG-1: its own column, enrolled by student, logged, 409 before the migration', () => {
  const mig = read('supabase/migrations/20261107000000_ngrp_followup_flag.sql')
  assert.match(mig, /ALTER TABLE public\.ngrp_candidates\s+ADD COLUMN IF NOT EXISTS flagged_for_followup boolean NOT NULL DEFAULT false/)
  assert.doesNotMatch(mig, /ALTER TABLE public\.students/, 'never the student\'s own flag')
  assert.match(manage, /'followup_flag_set',/)
  const block = manage.slice(manage.indexOf("if (action === 'followup_flag_set')"), manage.indexOf('// ── candidate-scoped actions'))
  assert.doesNotMatch(block, /if \(isTalentAcquisition\) return res\.status\(403\)/)
  assert.match(block, /eventType: body\.flagged \? 'followup_flagged' : 'followup_unflagged'/)
  assert.match(block, /not_on_roster/)
  assert.match(block, /enrollStudents\(db, \{ cycleId, studentIds: \[studentId\] \}\)/)
  assert.match(block, /res\.status\(409\)\.json\(\{ error: 'not_enabled' \}\)/)
})

test('Talent Acquisition receives the shared flag', () => {
  const payload = { students: [{ id: 's1', status: 'Completed' }], candidates: [{ id: 'c1', student_id: 's1', form_status: 'submitted', flagged_for_followup: true }] }
  const view = narrowPayloadForTalentAcquisition(payload)
  assert.equal(view.candidates[0].flagged_for_followup, true)
  assert.match(read('api/ngrp-workspace.js'), /followUpFlagProvisioned: payload\.followUpFlagProvisioned === true/)
})

test('the ribbon and the row mark mirror Student Profiles', () => {
  const chart = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(chart, /<FlagRibbon[\s\S]*?classPrefix="sc-ribbon"/)
  assert.match(tab, /\$\{flagged \? ' pl-followup' : ''\}/)
  assert.match(tab, /Flagged for follow up/)
  assert.match(tab, /followUp=\{canManage \?/)
})

test('Profiles | Interest, Alumni Cohort View, and a Grid', () => {
  assert.match(tab, /\{ value: 'profiles', label: 'Profiles' \}, \{ value: 'interest', label: 'Interest' \}/)
  assert.match(tab, /\['interest', 'status'\]\.includes\(searchParams\.get\('view'\)\)/, 'an old ?view=status link still opens Interest')
  assert.match(tab, />Alumni Cohort View</)
  assert.match(tab, /alumni'\} shown · KPI cards work as quick filters/)
  assert.match(tab, /<StudentCard key=\{r\.id\} variant="applicant"/)
  assert.match(read('src/components/StudentCard.jsx'), /variant === 'applicant' &&/)
})

test('the list and the chart end where their content ends', () => {
  assert.match(read('src/components/ngrp/ngrp.css'), /\.pl-list\.ngrp-pl-list \{ padding-bottom: 8px; \}/)
  const chartCss = read('src/components/student/studentChart.css')
  assert.match(chartCss, /\.sc-sheet\[data-sheet="activity"\] \{ border-bottom: none; \}/)
  assert.doesNotMatch(chartCss, /data-sheet="activity"\][^{]*\{[^}]*min-height: 60vh/)
  const hook = read('src/components/student/useChartScroll.js')
  assert.match(hook, /if \(last && atBottom\(\)\) setActiveSheet\(last\)/)
})

test('RESIDENCY-LANDING-1: switching to Residency opens At a Glance', () => {
  const app = read('src/staff/StaffApp.jsx')
  const sw = app.slice(app.indexOf('const switchExperience'), app.indexOf('const ngrpActiveTab'))
  assert.match(sw, /navigate\(ngrpPath\('overview'\)\)/)
  assert.doesNotMatch(sw, /resolveNgrpEntryPath/)
})
