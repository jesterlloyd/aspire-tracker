// Unit Leader hours completion: reaching/exceeding required hours keeps the numbers uncapped and
// renders one "Hours complete" indicator. Lifecycle completion is owned by the canonical server-side
// reconciler, so the old duplicate "Ready to complete" presentation must not return.

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
  const c = deriveHoursCompletion({ hours: h(144, 144), rotationEnd: FUTURE, todayYmd: TODAY })
  assert.equal(c.complete, true)
})

test('approved EXCEEDS required -> complete (overage; caller keeps the raw numbers uncapped)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 192), rotationEnd: FUTURE, todayYmd: TODAY })
  assert.equal(c.complete, true)
  assert.equal(c.approved, 192)
  assert.equal(c.required, 144)   // helper does NOT cap; the cell renders "192 of 144"
})

test('reaching required before the end date shows the future-end helper', () => {
  const c = deriveHoursCompletion({ hours: h(144, 192), rotationEnd: FUTURE, todayYmd: TODAY })
  assert.equal(c.complete, true)
  assert.equal(c.endFuture, true)
})

test('missing required hours -> not complete, no signals', () => {
  for (const hours of [h(null, 100), { approved: 100 }, null]) {
    const c = deriveHoursCompletion({ hours, rotationEnd: PAST, todayYmd: TODAY })
    assert.equal(c.complete, false)
    assert.equal(c.required, null)
  }
})

test('missing end date -> complete can show, but no future-date helper', () => {
  const c = deriveHoursCompletion({ hours: h(144, 200), rotationEnd: null, todayYmd: TODAY })
  assert.equal(c.complete, true)
  assert.equal(c.endFuture, false)
})

test('pending hours do not affect completion (completion is approved >= required)', () => {
  const c = deriveHoursCompletion({ hours: h(144, 144, 30), rotationEnd: TODAY, todayYmd: TODAY })
  assert.equal(c.complete, true)
})

test('zero-hour requirement -> not a meaningful completion', () => {
  const c = deriveHoursCompletion({ hours: h(0, 10), rotationEnd: PAST, todayYmd: TODAY })
  assert.equal(c.validReq, false)
  assert.equal(c.complete, false)
})

test('invalid negative values -> not complete', () => {
  assert.equal(deriveHoursCompletion({ hours: h(-5, 10), rotationEnd: PAST, todayYmd: TODAY }).complete, false)
  assert.equal(deriveHoursCompletion({ hours: h(144, -10), rotationEnd: PAST, todayYmd: TODAY }).complete, false)
})

test('the helper is pure hours display logic: no status rules or I/O', () => {
  const src = read('src/portal/unit/hoursCompletion.js')
  assert.doesNotMatch(src, /supabase|fetch\(|\.update\(|\.insert\(|localStorage/)
  const code = src.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /status|readyToComplete/)
})

// ── Source guards: cell + row wiring ─────────────────────────────────────────

test('HoursCell renders one completion indicator and leaves canonical status to its own column', () => {
  const ul = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(ul, /import \{ deriveHoursCompletion \} from '\.\/unit\/hoursCompletion'/)
  assert.match(ul, /const c = deriveHoursCompletion\(\{ hours, rotationEnd, todayYmd \}\)/)
  // Numbers are never capped at the requirement (overage stays visible).
  assert.match(ul, /<span className="ptl-hours-text">\{c\.approved\} of \{hours\.required\}<\/span>/)
  assert.match(ul, /\{c\.complete && <span className="ptl-hours-complete">Hours complete<\/span>\}/)
  assert.match(ul, /Required approved hours reached\. Rotation remains active through \{fmtShortDate\(rotationEnd\)\}\./)
  assert.doesNotMatch(ul, /Ready to complete|ptl-ready-complete/)
  assert.match(ul, /<td data-label="ASPIRE Status">[\s\S]*?\{orDash\(s\.status\)\}/)
})

test('the row passes the canonical rotation end and a stable today to HoursCell', () => {
  const ul = read('src/portal/UnitLeaderPortal.jsx')
  assert.match(ul, /<HoursCell hours=\{s\.hours\} rotationEnd=\{s\.rotation\?\.end\} todayYmd=\{todayYmd\} \/>/)
  // "today" is read once at mount via useMemo (not during render).
  assert.match(ul, /const todayYmd = useMemo\(\(\) => new Date\(\)\.toLocaleDateString\('en-CA'\), \[\]\)/)
})

test('the completion visuals reuse canonical portal colors, not a new status color system', () => {
  const css = read('src/portal/portal.css')
  assert.match(css, /\.ptl-hours-complete \{[\s\S]*?background: #e7f4ec/)   // canonical timeline-complete green
  assert.match(css, /\.ptl-hours-complete::before \{ content: '✓'; color: #16a34a/)
  assert.doesNotMatch(css, /\.ptl-ready-complete/)
})
