import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NAV_ICONS, NAV_LABELS } from '../src/lib/navigationCanon.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

test('canonical navigation terminology preserves accurate singular and plural labels', () => {
  assert.equal(NAV_LABELS.atAGlance, 'At a Glance')
  assert.equal(NAV_LABELS.studentProfiles, 'Student Profiles')
  assert.equal(NAV_LABELS.interviews, 'Interviews')
  assert.equal(NAV_LABELS.rotation, 'Rotation')
  assert.equal(NAV_LABELS.evaluation, 'Evaluation')
  assert.equal(NAV_LABELS.profilesInterest, 'Profiles & Interest')
  assert.equal(NAV_LABELS.students, 'Students')
})

test('equivalent destinations share the same icon component', () => {
  assert.equal(NAV_ICONS.studentProfiles, NAV_ICONS.students)
  assert.equal(NAV_ICONS.rotation, NAV_ICONS.residency)
  const source = read('src/lib/navigationCanon.js')
  assert.match(source, /interviews: CalendarDays/)
  assert.match(source, /evaluation: ChartColumn/)
})

test('staff and Residency navigation render icons instead of ASPIRE letter chips', () => {
  for (const path of ['src/components/UnifiedNav.jsx', 'src/components/ngrp/NgrpNav.jsx']) {
    const source = read(path)
    assert.match(source, /<Icon size=\{16\} aria-hidden="true" \/>/)
    assert.doesNotMatch(source, /chart-nav-chip|\bchip\b/)
  }
})

test('every portal navigation consumes the shared icon canon', () => {
  for (const path of [
    'src/portal/PortalNav.jsx',
    'src/portal/ap/AcademicPartnerChrome.jsx',
    'src/portal/na/NursingAcademicsChrome.jsx',
    'src/portal/residency/ResidencyChrome.jsx',
    'src/portal/unit/UnitLeaderChrome.jsx',
  ]) {
    assert.match(read(path), /NAV_ICONS/, path)
  }
})

test('Unit Leader uses singular Evaluation in its tab and heading', () => {
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /label: NAV_LABELS\.evaluation/)
  assert.match(read('src/portal/unit/UnitEvaluationsWorkspace.jsx'), />Evaluation<\/SectionHeading>/)
  assert.match(read('src/portal/unit/UnitEvaluationsPlaceholder.jsx'), />Evaluation<\/SectionHeading>/)
})
