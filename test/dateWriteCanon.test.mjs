// test/dateWriteCanon.test.mjs
//
// The rule, stated in shared/dateUtils.js and in src/lib/keithKnowledge.js:900, was
// written down and then broken twice. This pins it.
//
// WHAT THE BUG LOOKS LIKE
//
// new Date().toISOString() converts to UTC. Taking the date half of that gives the UTC
// calendar date, which after ~5pm Pacific (PDT) or ~4pm (PST) is ALREADY TOMORROW. Write
// that into a calendar-date column and the row is dated a day late. A preceptor assigned
// at 6pm got a started_at of the following day.
//
// THERE ARE TWO CORRECT ANSWERS, NOT ONE, and picking the wrong one produces a change
// that looks like a fix and is not:
//
//   BROWSER (src/)  toLocalDateStr(). The runtime's timezone IS the user's, which is
//                   Pacific, so local is right and cheap.
//
//   SERVER (api/)   toPacificDateStr(). toLocalDateStr would be a NO-OP here: Vercel
//                   functions run in UTC, so "local" and "UTC" are the same thing and
//                   swapping one for the other changes nothing at all. The zone has to
//                   be explicit.
//
// No home existed for this. test/portalDates.test.mjs is scoped to src/lib/portalDates.js
// (display formatting), and nothing covered shared/dateUtils.js at all, so this is a new
// file rather than a bad fit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import { toLocalDateStr, toPacificDateStr } from '../shared/dateUtils.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────
// 1. The helpers do what they claim
// ─────────────────────────────────────────────────────────────────────
test('toPacificDateStr returns the PACIFIC date, not the UTC one', () => {
  // 02:00 UTC on the 19th is 19:00 Pacific on the 18th. This is precisely the window
  // where the bug bites, and the two answers differ.
  const evening = new Date('2026-09-19T02:00:00Z')
  assert.equal(toPacificDateStr(evening), '2026-09-18',
    'a Pacific evening is still the previous calendar day in Pacific')
  assert.equal(evening.toISOString().slice(0, 10), '2026-09-19',
    'while UTC has already rolled over, which is the whole bug')

  // Midday, where every method agrees, so a passing test above is not an accident of
  // the helper always subtracting a day.
  const midday = new Date('2026-09-18T19:00:00Z') // 12:00 Pacific
  assert.equal(toPacificDateStr(midday), '2026-09-18')

  // And across the PST boundary, so this is not just a PDT fixture.
  const winter = new Date('2026-01-15T03:00:00Z') // 19:00 Pacific on the 14th, PST
  assert.equal(toPacificDateStr(winter), '2026-01-14')
})

test('toPacificDateStr always formats YYYY-MM-DD', () => {
  // en-CA, not en-US, is what makes this ISO-ordered. A locale slip turns it into
  // 09/18/2026 and every comparison against a date column silently stops matching.
  assert.match(toPacificDateStr(new Date('2026-03-07T20:00:00Z')), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(toPacificDateStr(new Date('2026-03-07T20:00:00Z')), '2026-03-07')
})

test('toLocalDateStr reads the runtime, which is why it is not the server answer', () => {
  const d = new Date(2026, 8, 18, 19, 0, 0) // local 18 Sep, 19:00
  assert.equal(toLocalDateStr(d), '2026-09-18',
    'it formats the local calendar date, whatever the runtime zone happens to be')
})

// ─────────────────────────────────────────────────────────────────────
// 2. The ratchet: nothing writes a date column the UTC way
// ─────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx)$/.test(full)) out.push(full)
  }
  return out
}

// Comments explaining the rule necessarily quote the thing they forbid.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')

const SPLIT_T = /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/
const DATE_HALF = /toISOString\(\)\s*\.\s*(split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]|slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\))/g

// src/lib/keithKnowledge.js states the rule inside a TEMPLATE STRING, as the text of the
// rule itself. Stripping comments does not remove a string literal, so it is named here.
const PROSE_ONLY = new Set([join('src', 'lib', 'keithKnowledge.js')])

function scan(re) {
  const hits = []
  for (const base of ['src', 'api', 'lib', 'shared']) {
    for (const file of walk(join(root, base))) {
      const rel = relative(root, file)
      if (PROSE_ONLY.has(rel)) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      const n = (code.match(re) || []).length
      if (n) hits.push({ rel, n })
    }
  }
  return hits
}

test('nothing uses the exact pattern the rule forbids by name', () => {
  // The written rule names ONE spelling: toISOString().split('T')[0]. That spelling is
  // now at zero and stays at zero. A hard gate, because there is nothing left to
  // grandfather and the rule is unambiguous about this form.
  const offenders = scan(new RegExp(SPLIT_T.source, 'g')).map(h => `${h.rel} (x${h.n})`)
  assert.deepEqual(offenders, [],
    'This is the exact expression shared/dateUtils.js and keithKnowledge.js forbid.\n' +
    '  src/ (browser): toLocalDateStr()\n' +
    '  api/ (Vercel, UTC): toPacificDateStr() -- toLocalDateStr is a NO-OP there')
})

// The WIDER family, .slice(0,10) and .substring(0,10), takes the same date half by
// another spelling. A hard gate is not honest here: 17 occurrences predate this work and
// I assessed every one of them as legitimate rather than deleting the evidence:
//
//   deliberate UTC calendar arithmetic  src/lib/rotationCalendarDates.js (getUTCMonth
//                                       alongside it), lib/server/ngrpEligibility.js,
//                                       api/portal/unit-roster.js, unit-shift-activity.js
//   explicitly named as UTC             src/lib/ngrp/ngrpReflectionForm.js (fromUtc)
//   already timezone-adjusted by hand   lib/server/outreachAnalytics.js
//   a round-trip validity CHECK,        api/preceptor-assignments.js:38
//     not a write
//   CSV filename slugs, no column       src/components/EvaluationTab.jsx,
//                                       src/staff/StaffApp.jsx, connect/OutreachView.jsx
//   display/context strings             api/knowledge-admin.js, keith/knowledgeRetrieval.js
//
// So: a RATCHET, the pattern this repo already uses in test/uiCanonRatchet.test.mjs.
// Lower it when one is converted; never raise it. A new one is the thing to catch.
const DATE_HALF_BASELINE = 17

test('the .slice(0,10) family never grows', () => {
  const hits = scan(DATE_HALF)
  const total = hits.reduce((a, h) => a + h.n, 0)

  assert.ok(total <= DATE_HALF_BASELINE,
    `Taking the date half of a UTC ISO string went from ${DATE_HALF_BASELINE} to ${total}.\n` +
    'If the new one writes a calendar-date column it is a bug: after ~5pm Pacific it is a ' +
    'day ahead. Use toLocalDateStr() in src/ or toPacificDateStr() in api/.\n' +
    'If it is deliberate UTC arithmetic, a filename or a validity check, add it to the ' +
    'assessed list above and raise the baseline WITH that reasoning.\n\n' +
    hits.map(h => `  ${h.rel} (x${h.n})`).join('\n'))

  assert.ok(DATE_HALF_BASELINE - total <= 4,
    `The baseline says ${DATE_HALF_BASELINE} but the tree has ${total}. Lower it, or the ` +
    'ratchet stops having teeth.')
})

test('full ISO timestamps are still allowed, so the ratchet is not over-broad', () => {
  // The rule permits new Date().toISOString() for timestamp columns. If this ratchet
  // ever starts flagging those, it will get switched off rather than obeyed.
  const sample = "const sent_at = new Date().toISOString()\nconst other = d.toISOString()"
  const re = /toISOString\(\)\s*\.\s*(split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]|slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\))/
  assert.equal(re.test(sample), false, 'a bare toISOString() must not be flagged')

  // And it does catch the three spellings of taking the date half.
  for (const bad of [
    "new Date().toISOString().split('T')[0]",
    'new Date().toISOString().slice(0, 10)',
    'new Date().toISOString().substring(0,10)',
  ]) {
    assert.equal(re.test(bad), true, `should flag: ${bad}`)
  }
})
