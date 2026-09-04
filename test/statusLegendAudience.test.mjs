// STATUS-LEGEND-AUDIENCE-1: canonical status legend with audience-aware copy.
//
// One shared component (StatusLegendPopover), one shared copy module
// (statusLegendCopy.js) keyed by STATUS VALUE per audience - never by list
// position. Status names, pill colors, and ordering stay canonical; only the
// descriptions adapt. External audiences carry no internal workflow terms.
//
// Run: node --test test/statusLegendAudience.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  LEGEND_TITLE, LEGEND_INTRO, LEGEND_AUDIENCES,
  STATUS_DESCRIPTIONS_BY_AUDIENCE, NOT_PROCEEDING_DESCRIPTION, legendColorRows,
} from '../src/lib/statusLegendCopy.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const legend = read('src/components/StatusLegendPopover.jsx')
const interviews = read('src/components/InterviewRubricTab.jsx')

const LIFECYCLE = [
  'Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled',
  'Interviewed', 'Placed', 'Active Rotation', 'Completed',
]
const INTERNAL_TERMS = /rubric|formal disposition|Action Center|Phase 4|moderation|NGRP/i

// ── Copy module: completeness and audience safety ────────────────────────────

test('every audience describes every lifecycle status, keyed by value', () => {
  assert.deepEqual(LEGEND_AUDIENCES, ['staff', 'academic_partner', 'unit_leader', 'nursing_academic'])
  for (const audience of LEGEND_AUDIENCES) {
    const map = STATUS_DESCRIPTIONS_BY_AUDIENCE[audience]
    for (const status of LIFECYCLE) {
      assert.equal(typeof map[status], 'string', `${audience} must describe ${status}`)
      assert.ok(map[status].length > 20, `${audience} ${status} description is real prose`)
    }
  }
})

test('external audiences carry no internal workflow terminology', () => {
  for (const audience of ['academic_partner', 'unit_leader', 'nursing_academic']) {
    for (const [status, text] of Object.entries(STATUS_DESCRIPTIONS_BY_AUDIENCE[audience])) {
      assert.doesNotMatch(text, INTERNAL_TERMS, `${audience} ${status} copy must stay external-safe`)
    }
    for (const row of legendColorRows(audience)) {
      assert.doesNotMatch(row.description, INTERNAL_TERMS, `${audience} ${row.label} color copy must stay external-safe`)
    }
  }
  assert.doesNotMatch(NOT_PROCEEDING_DESCRIPTION, INTERNAL_TERMS)
})

test('the audience copy matches the approved wording where it differs', () => {
  const ap = STATUS_DESCRIPTIONS_BY_AUDIENCE.academic_partner
  const ul = STATUS_DESCRIPTIONS_BY_AUDIENCE.unit_leader
  const staff = STATUS_DESCRIPTIONS_BY_AUDIENCE.staff
  assert.match(staff['Interviewed'], /being reviewed or has been recorded/)
  assert.match(ap['Interviewed'], /being finalized or has been recorded/)
  assert.match(ul['Interviewed'], /awaiting or has received a placement decision/)
  assert.match(ap['Completed'], /may still have final evaluation or certificate steps remaining/)
  assert.match(staff['Completed'], /completing any remaining evaluation or certificate steps/)
  assert.equal(ul['Placed'], staff['Placed'])
  assert.match(NOT_PROCEEDING_DESCRIPTION, /no longer moving forward in the ASPIRE pathway\. A more specific outcome may appear/)
})

test('color meanings: canonical set, Muted Red label, audience-specific amber only', () => {
  const staff = legendColorRows('staff')
  assert.deepEqual(staff.map(r => r.label), ['Neutral', 'Amber', 'Red', 'Light Green', 'Solid Green', 'Indigo', 'Muted Red'])
  const amber = (a) => legendColorRows(a).find(r => r.key === 'amber').description
  assert.match(amber('staff'), /Action Center/)                       // main app may reference it
  assert.equal(amber('academic_partner'), 'The student may need follow-up from the student, school, or ASPIRE team.')
  assert.equal(amber('unit_leader'), 'Follow-up may be needed.')
  // Every non-amber row is identical across audiences (one canonical meaning).
  for (const key of ['neutral', 'red', 'light_green', 'solid_green', 'indigo', 'muted_red']) {
    const texts = new Set(LEGEND_AUDIENCES.map(a => legendColorRows(a).find(r => r.key === key).description))
    assert.equal(texts.size, 1, `${key} must read identically for every audience`)
  }
})

// ── Component: one legend, canonical sources ─────────────────────────────────

test('the component renders from the shared copy module and the REAL pill dictionary', () => {
  assert.match(legend, /from '\.\.\/lib\/statusLegendCopy'/)
  assert.match(legend, /\{LEGEND_TITLE\}/)
  assert.match(legend, /\{LEGEND_INTRO\}/)
  assert.match(legend, /\{statusDescriptions\[status\.value\]\}/, 'descriptions keyed by value, never position')
  // Swatches come from ASPIRE_STATUS_CONFIG - the same dictionary the actual pills use -
  // so the legend can never show different colors than the tables.
  assert.match(legend, /import \{ ASPIRE_STATUS_CONFIG \} from '\.\.\/lib\/constants'/)
  assert.match(legend, /const swatchFor = \(value\) => ASPIRE_STATUS_CONFIG\[value\]/)
  // The disposition groups come from lib/dispositions - no local re-declared copies.
  assert.match(legend, /PRE_PLACEMENT_DISPOSITION_TYPES, POST_PLACEMENT_DISPOSITION_TYPES,/)
  assert.doesNotMatch(legend, /const PRE_PLACEMENT_DISPOSITIONS = \[/)
  assert.equal(typeof LEGEND_TITLE, 'string')
  assert.equal(LEGEND_TITLE, 'ASPIRE Status Legend') // existing product naming kept for consistency
})

test('interaction model is untouched: portal, Escape, outside click, focus restore', () => {
  assert.match(legend, /role="dialog"/)
  assert.match(legend, /aria-label="ASPIRE Status Legend"/)
  assert.match(legend, /e\.key === 'Escape'/)
  assert.match(legend, /function handleClickOutside/)
  assert.match(legend, /aria-label="Close status legend"/)
  assert.match(legend, /if \(wasOpen\.current && !isOpen\) triggerRef\.current\?\.focus\(\)/)
  assert.match(legend, /minHeight: 0, overflowY: 'auto'/)   // internal scroll preserved
})

// ── Trigger inventory: six sites, three audiences ────────────────────────────

test('all six trigger sites use the shared component with the right audience', () => {
  // Main app (staff default - no audience prop needed).
  for (const p of ['src/components/OverviewTab.jsx', 'src/components/StudentProfilesTab.jsx', 'src/components/InterviewRubricTab.jsx', 'src/components/MatchingTab.jsx']) {
    assert.match(read(p), /<StatusLegendPopover /, `${p} must render the shared legend`)
    assert.doesNotMatch(read(p), /audience=/, `${p} is a staff surface - default audience`)
  }
  assert.match(read('src/portal/AcademicPartnerPortal.jsx'), /<StatusLegendPopover audience="academic_partner" \/>/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /<StatusLegendPopover audience="unit_leader" \/>/)
})

test('the Interviews column is renamed ASPIRE Status (it renders the canonical pills)', () => {
  assert.match(interviews, /ASPIRE Status\s*\n\s*<StatusLegendPopover/)
  assert.doesNotMatch(interviews, />\s*Workflow Status\s*</, 'the old label must be gone')
  // The cell really is the canonical system: same config + disposition substitution.
  assert.match(interviews, /ASPIRE_STATUS_CONFIG\[s\.status\]/)
  assert.match(interviews, /DISPOSITION_PILL_COLORS\[irDispType\]/)
})

test('Student Portal intentionally excluded: no canonical pills, no legend', () => {
  const sp = read('src/portal/StudentPortal.jsx')
  assert.doesNotMatch(sp, /StatusLegendPopover/, 'students see the milestone timeline, not the pill system')
  assert.doesNotMatch(sp, /ASPIRE_STATUS_CONFIG/, 'no canonical status pills are rendered to students')
  assert.match(sp, /ptl-timeline/, 'the student-facing progress remains the derived timeline')
})
