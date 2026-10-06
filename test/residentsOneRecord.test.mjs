// RESIDENTS-ONE-RECORD-1 + RESIDENCY-CALENDAR-1 (Owner, 2026-10-05).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { residentRecordPath } from '../src/lib/ngrp/ngrpResidents.js'
import { ngrpSubTabs } from '../src/lib/ngrp/ngrpTabs.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('ONE RECORD 1: a Residents row opens the binder at the Hiring sheet, by candidate', () => {
  assert.equal(residentRecordPath('/ngrp', 'c 1'), '/ngrp/profiles?candidate=c%201&sheet=hiring')
  assert.equal(residentRecordPath('/portal/residency', 'c1'), '/portal/residency/profiles?candidate=c1&sheet=hiring')
  const profiles = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(profiles, /const linkedSheet = searchParams\.get\('sheet'\)/)
  assert.match(profiles, /next\.delete\('sheet'\)/, 'choosing someone drops the one-time sheet link')
  const chart = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(chart, /initialSheet && sheets\.some\(x => x\.id === initialSheet\) \? initialSheet : null/)
  assert.match(chart, /new ResizeObserver\(/, 'the target is held while the sheets above it load')
  const hiring = chart.slice(chart.indexOf("id={sheetDomId('hiring')}"), chart.indexOf("id={sheetDomId('activity')}"))
  assert.match(hiring, /<ResidentDetailsSection row=\{row\} cycle=\{cycle\} canManage=\{canManage\} toast=\{toast\} \/>/)
})

test('ONE RECORD 2: Resident Details appears once hired and reads the Residents query', () => {
  const s = read('src/components/ngrp/ResidentDetailsSection.jsx')
  assert.match(s, /const hired = Boolean\(row\?\.outcome\?\.hired_at\)/)
  assert.match(s, /useNgrpResidents\(cycle\?\.id, \{ enabled: hired \}\)/)
  assert.match(s, /if \(!hired\) return null/)
  for (const f of ['position_title', 'preceptor_name', 'phone', 'separated_on', 'separation_reason']) assert.ok(s.includes(`${f}`), f)
})

test('CALENDAR 1: the sub-tab reads Calendar, its id stays activity', () => {
  assert.deepEqual(ngrpSubTabs('residency').map(t => [t.id, t.label]), [['board', 'Interview Board'], ['schedule', 'Interview Schedule'], ['residents', 'Residents'], ['activity', 'Calendar']]) // NGRP-INTERVIEWS-1 Phase 4 added Interview Schedule after Interview Board.
  assert.match(read('src/components/ngrp/ActivityCalendar.jsx'), /title="Residency Calendar"/)
})
