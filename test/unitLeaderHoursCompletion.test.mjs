// Unit Leader hours completion, Commit 2: hours completion (approved >= required) is DISPLAY-ONLY and
// is NOT lifecycle completion. Reaching/exceeding required hours before the rotation end date does not
// change Active Rotation; the numbers stay uncapped; a "Hours complete" indicator + future-end helper
// appear; and once the end date is today/past with the requirement met and status still Active
// Rotation, a derived, display-only "Ready to complete" signal appears. Behavioral tests of the pure
// helper across every edge case, plus source guards on the cell/row wiring.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { deriveHoursCompletion } from '../src/portal/unit/hoursCompletion.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const FUTURE = '2026-09-01'
const TODAY = '2026-07-28'
const PAST = '2026-07-01'
const h = (required, approved, pending = 0) => ({ required, approved, pending })

test('approved EXACTLY equals required -> complete', () => {
  const c = deriveHoursCompletion({ hours: h(144, 144), rotationEnd: FUTURE, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.complete, true)
})

test('approved EXCEEDS required -> complete (overage; caller keeps the raw numbers uncapped)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 192), rotationEnd: FUTURE, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.complete, true)
  assert.equal(c.approved, 192)
  assert.equal(c.required, 144)   // helper does NOT cap; the cell renders "192 of 144"
})

test('reaching required BEFORE the end date does NOT produce completion/readiness (stays Active Rotation)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 192), rotationEnd: FUTURE, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.complete, true)
  assert.equal(c.endFuture, true)          // future end -> the "remains active through" helper shows
  assert.equal(c.endReached, false)
  assert.equal(c.readyToComplete, false)   // NO readiness signal, NO status change while the end is future
})

test('end date TODAY, requirement met, still Active Rotation -> Ready to complete', () => {
  const c = deriveHoursCompletion({ hours: h(144, 150), rotationEnd: TODAY, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.endReached, true)
  assert.equal(c.readyToComplete, true)
})

test('end date PAST, requirement met, still Active Rotation -> Ready to complete', () => {
  const c = deriveHoursCompletion({ hours: h(144, 144), rotationEnd: PAST, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.readyToComplete, true)
})

test('missing required hours -> not complete, no signals', () => {
  for (const hours of [h(null, 100), { approved: 100 }, null]) {
    const c = deriveHoursCompletion({ hours, rotationEnd: PAST, todayYmd: TODAY, status: 'Active Rotation' })
    assert.equal(c.complete, false)
    assert.equal(c.readyToComplete, false)
    assert.equal(c.required, null)
  }
})

test('missing end date -> complete can show, but no future/reached/readiness (needs a date)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 200), rotationEnd: null, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.complete, true)
  assert.equal(c.endFuture, false)
  assert.equal(c.endReached, false)
  assert.equal(c.readyToComplete, false)
})

test('pending hours do not affect completion (completion is approved >= required)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 144, 30), rotationEnd: TODAY, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.complete, true)
  assert.equal(c.readyToComplete, true)
})

test('already Completed -> readiness signal suppressed (only Active Rotation qualifies)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 200), rotationEnd: PAST, todayYmd: TODAY, status: 'Completed' })
  assert.equal(c.complete, true)
  assert.equal(c.readyToComplete, false)
})

test('Not Proceeding -> readiness signal suppressed', () => {
  const c = deriveHoursCompletion({ hours: h(144, 200), rotationEnd: PAST, todayYmd: TODAY, status: 'Not Proceeding' })
  assert.equal(c.readyToComplete, false)
})

test('zero-hour requirement -> not a meaningful completion', () => {
  const c = deriveHoursCompletion({ hours: h(0, 10), rotationEnd: PAST, todayYmd: TODAY, status: 'Active Rotation' })
  assert.equal(c.validReq, false)
  assert.equal(c.complete, false)
  assert.equal(c.readyToComplete, false)
})

test('invalid negative values -> not complete', () => {
  assert.equal(deriveHoursCompletion({ hours: h(-5, 10), rotationEnd: PAST, todayYmd: TODAY, status: 'Active Rotation' }).complete, false)
  assert.equal(deriveHoursCompletion({ hours: h(144, -10), rotationEnd: PAST, todayYmd: TODAY, status: 'Active Rotation' }).complete, false)
})

test('the helper is pure and display-only: no status write, no I/O', () => {
  const src = read('src/portal/unit/hoursCompletion.js')
  assert.doesNotMatch(src, /supabase|fetch\(|\.update\(|\.insert\(|localStorage/)
  // It only READS status (compares to 'Active Rotation'); the CODE never sets or references 'Completed'
  // (the explanatory comment does; strip comments before checking).
  const code = src.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /'Completed'/)
  assert.match(code, /status === 'Active Rotation'/)
})

// ── Source guards: cell + row wiring ─────────────────────────────────────────

test('HoursCell consumes the pure helper and renders the three states; status pill is untouched', () => {
  const ul = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(ul, /import \{ deriveHoursCompletion \} from '\.\/unit\/hoursCompletion'/)
  assert.match(ul, /const c = deriveHoursCompletion\(\{ hours, rotationEnd, todayYmd, status \}\)/)
  // Numbers are never capped at the requirement (overage stays visible).
  assert.match(ul, /<span className="ptl-hours-text">\{c\.approved\} of \{hours\.required\}<\/span>/)
  assert.match(ul, /\{c\.complete && <span className="ptl-hours-complete">Hours complete<\/span>\}/)
  assert.match(ul, /Required approved hours reached\. Rotation remains active through \{fmtShortDate\(rotationEnd\)\}\./)
  assert.match(ul, /\{c\.readyToComplete && <span className="ptl-ready-complete" role="status">Ready to complete<\/span>\}/)
  // The ASPIRE status pill still renders the STORED status verbatim; hours never change it.
  assert.match(ul, /<td data-label="ASPIRE status">[\s\S]*?\{orDash\(s\.status\)\}/)
})

test('the row passes the canonical rotation end, a stable today, and the stored status to HoursCell', () => {
  const ul = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(ul, /<HoursCell hours=\{s\.hours\} rotationEnd=\{s\.rotation\?\.end\} todayYmd=\{todayYmd\} status=\{s\.status\} \/>/)
  // "today" is read once at mount via useMemo (not during render).
  assert.match(ul, /const todayYmd = useMemo\(\(\) => new Date\(\)\.toLocaleDateString\('en-CA'\), \[\]\)/)
})

test('the completion visuals reuse canonical portal colors, not a new status color system', () => {
  const css = read('src/portal/portal.css')
  assert.match(css, /\.ptl-hours-complete \{[\s\S]*?background: #e7f4ec/)   // canonical timeline-complete green
  assert.match(css, /\.ptl-hours-complete::before \{ content: '✓'; color: #16a34a/)
  assert.match(css, /\.ptl-ready-complete \{[\s\S]*?background: #fef3c7/)   // canonical amber attention
})
