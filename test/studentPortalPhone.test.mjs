// test/studentPortalPhone.test.mjs
//
// STUDENT-PHONE-1 + STUDENT-BADGE-1 (Owner decisions, 2026-09-05). Students open the portal on
// their phones first. Pins: below 760px the Rotation Activity calendar is the mini calendar plus
// its day panel (grid, legend and footnote hidden, title and month nav moved above); the Log a
// Shift gate matches the public shift-log flow (Placed + Active Rotation); the ID badge is
// rendered in the student's browser from the staff generator once created, with the summary
// carrying the rotation window the badge dates need.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveBadgeStatus } from '../src/lib/portalDocuments.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const css = read('src/portal/portal.css')
const portal = read('src/portal/StudentPortal.jsx')
const summary = read('api/lib/studentPortalSummary.js')
const lookup = read('api/lib/shiftLogLookup.js')
const canon = read('CLAUDE.md')

// The phone block that owns the student calendar rules.
function phoneBlock() {
  // The nav block also carries the STUDENT-PHONE-1 mark (the Refresh fix); anchor on the calendar's own line.
  const i = css.indexOf('STUDENT-PHONE-1 (Owner decision, 2026-09-05): on a phone the mini calendar')
  assert.ok(i > 0, 'the phone calendar rules are marked')
  const start = css.lastIndexOf('@media (max-width: 760px)', i)
  return css.slice(start, css.indexOf('\n}\n', i) + 3)
}

test('on a phone, the mini calendar and day panel are the calendar', () => {
  const block = phoneBlock()
  const scope = '.canonical-calendar-shell:has(.ptl-student-cal-grid)'
  assert.match(block, new RegExp(`${scope.replace(/[.()]/g, '\\$&')} \\.canonical-calendar-main \\{\\s*order: 1;`))
  assert.match(block, new RegExp(`${scope.replace(/[.()]/g, '\\$&')} \\.canonical-calendar-sidebar \\{ order: 2;`))
  for (const hidden of ['.canonical-calendar-main [role="grid"]', '.ptl-cal-legend', '.ptl-student-cal-foot']) {
    assert.ok(block.includes(`${scope} ${hidden}`), `${hidden} hides on phones`)
  }
  assert.match(block, /\.ptl-student-cal-foot \{ display: none; \}/)
  // The sideways-scrolling grid is gone for good.
  assert.doesNotMatch(css, /\.ptl-student-cal-grid \{ min-width: 620px; \}/)
  assert.doesNotMatch(css, /canonical-calendar-main:has\(\.ptl-student-cal-grid\) \{ overflow-x: auto; \}/)
  // The month nav still renders inside the main, which now sits above the mini calendar.
  const activity = read('src/portal/StudentRotationActivity.jsx')
  assert.match(activity, /<CanonicalCalendarNav onPrev=/)
  assert.match(activity, /<StudentMiniCalendar cells=\{cells\}/)
})

test('Refresh is desktop chrome: the phone bottom bar hides it with a selector that outranks the span rule', () => {
  assert.match(css, /\.ptl-nav > span \{ display: contents; \}/)
  assert.match(css, /\.ptl-nav > \.ptl-nav-refresh \{ display: none; \}/)
  assert.doesNotMatch(css, /^\s+\.ptl-nav-refresh \{ display: none; \}/m)
})

test('the portal Log a Shift gate is the public shift-log gate', () => {
  assert.match(lookup, /const SHIFT_LOG_ELIGIBLE_STATUSES = \['Placed', 'Active Rotation'\]/)
  assert.match(portal, /const canLogShift = placedMoment \|\| activeRotation/)
  assert.match(portal, /\{canLogShift && !readOnlyPreview && \(\s*<button type="button" className="ptl-btn ptl-btn-sm" onClick=\{\(\) => onOpenShiftLog\?\.\(\)\}>/)
  assert.match(portal, /\{canLogShift && shiftCount === 0 && \(/)
  assert.doesNotMatch(stripJs(portal), /activeRotation && !readOnlyPreview/)
})

test('the ID badge is rendered in the browser once created, from the student\'s own inputs', () => {
  assert.equal(deriveBadgeStatus({ badgeCreated: true, status: 'Active Rotation' }).downloadable, true)
  assert.equal(deriveBadgeStatus({ badgeCreated: false, status: 'Active Rotation' }).downloadable, false)
  assert.match(portal, /import \{ generateBadgePNGs \} from '\.\.\/lib\/badgeGenerator'/)
  assert.match(portal, /import \{ fetchPortalHeadshotUrl \} from '\.\.\/lib\/studentFileClient'/)
  // Own headshot through the portal own-file endpoint (no student id, no path), rotation from the summary.
  assert.match(portal, /const headshotUrl = await fetchPortalHeadshotUrl\(\)/)
  assert.match(portal, /rotation_start_date: student\.rotation\.start, rotation_end_date: student\.rotation\.end/)
  assert.match(portal, /generateBadgePNGs\(\{ student, rotation, headshotUrl \}\)/)
  // Preview first, then front and back downloads; nothing in the staff preview.
  assert.match(portal, /\{badgeStatus\.downloadable && !readOnlyPreview && \(/)
  assert.match(portal, /Preview Badge/)
  assert.match(portal, /download=\{`\$\{badgeFiles\.base\}_Front\.png`\}/)
  assert.match(portal, /download=\{`\$\{badgeFiles\.base\}_Back\.png`\}/)
  // Object URLs are revoked.
  assert.match(portal, /URL\.revokeObjectURL\(badgeFiles\.frontUrl\); URL\.revokeObjectURL\(badgeFiles\.backUrl\)/)
  // No server badge file is ever fetched.
  assert.doesNotMatch(portal, /download-badge/)
  // Staff-facing generator messages never reach the student verbatim.
  assert.match(portal, /\/template\|public\\\/\/i\.test\(err\?\.message/)
  assert.match(css, /\.ptl-badge-preview \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
})

test('the student summary carries the rotation window the badge dates need', () => {
  assert.match(summary, /'cohort_school_rotation_id',/)
  assert.match(summary, /\.from\('cohort_school_rotations'\)\s*\.select\('id, rotation_start_date, rotation_end_date'\)/)
  assert.match(summary, /const ROTATION_SENTINEL = '1900-01-01'/)
  assert.match(summary, /rotation: rotationById\[student\.cohort_school_rotation_id\] \|\| null,/)
  // Still no private field on the summary.
  for (const forbidden of ['school_email', 'personal_email', 'admin_notes', 'interview_notes', 'rubric']) {
    assert.ok(!stripJs(summary).includes(forbidden), `summary must not reference ${forbidden}`)
  }
})

test('CLAUDE.md carries the phone rule, the shift gate, and the badge rule', () => {
  for (const must of ['STUDENT-PHONE-1', 'mini calendar plus its day panel', 'Placed and Active Rotation', 'badgeGenerator.js']) {
    assert.ok(canon.includes(must), `CLAUDE.md names ${must}`)
  }
})
