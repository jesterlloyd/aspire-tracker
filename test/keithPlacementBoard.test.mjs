// test/keithPlacementBoard.test.mjs
//
// KEITH-PLACEMENT-1: the board's Keith pieces, rendered (Vite ssrLoadModule + react-dom/server).
//   - a suggestion slip: "Suggested by Keith", the student with preceptor and match rank, the reason,
//     the passed rules as chips, Accept, Swap and Reject; Swap disabled with no alternative
//   - the bar: shadow names the cohort and offers the Owner "Turn on suggestions"; the comparison
//     lists the four figures and each disagreement; ON counts the waiting suggestions
//   - the note in Students says "Suggested for [Unit]"

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

let vite, Slip, Bar, Card
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  Slip = (await vite.ssrLoadModule('/src/components/placement/SuggestionSlip.jsx')).default
  Bar = (await vite.ssrLoadModule('/src/components/placement/KeithPlacementBar.jsx')).default
  Card = (await vite.ssrLoadModule('/src/components/StudentMatchingCard.jsx')).default
})
after(async () => { await vite?.close() })

const html = (C, props) => renderToStaticMarkup(React.createElement(C, props))
const checks = [
  { key: 'capacity', ok: true, label: 'Capacity 1 of 2' }, { key: 'shift', ok: true, label: 'Shift fits' },
  { key: 'preceptor', ok: true, label: 'Preceptor load 0' }, { key: 'clearance', ok: true, label: 'Interviewed' },
  { key: 'school', ok: true, label: 'No school rules on file' },
]
const sg = (over = {}) => ({ id: 's1', studentId: 'st1', studentName: 'Ana Reyes', unitName: '4 SCCT', preceptorName: 'Rosa Tan', prefRank: 1, reason: 'Wants cardiac experience; the unit is the cardiac ICU.', checks, provenanceId: 'p1', alternatives: [], ...over })

test('the slip shows who, where, why and the rules, with Accept, Swap and Reject', () => {
  const out = html(Slip, { suggestion: sg(), onAccept() {}, onReject() {} })
  assert.match(out, /data-testid="keith-suggestion"/)
  assert.match(out, /Suggested by Keith/)
  assert.match(out, /Ana Reyes[\s\S]*Preceptor: Rosa Tan[\s\S]*1st choice match/)
  assert.match(out, /Wants cardiac experience; the unit is the cardiac ICU\./)
  for (const c of checks) assert.match(out, new RegExp(`✓ ${c.label}`))
  assert.match(out, />Accept<\/button>/)
  assert.match(out, /disabled="" aria-expanded="false" title="No other unit passes the rules for this student">Swap<\/button>/)
  assert.match(out, />Reject<\/button>/)
  assert.match(html(Slip, { suggestion: sg({ prefRank: null }), onAccept() {}, onReject() {} }), /Not among their choices/)
  assert.doesNotMatch(html(Slip, { suggestion: sg(), canAct: false }), /Accept|Reject/, 'a reader sees the slip but cannot act')
})

test('the bar: shadow for the Owner, the comparison figures and disagreements; ON counts what is waiting', () => {
  const comparison = { placed: 38, matchedFirst: 29, sameRank: 6, hardRulesBroken: 0, disagreements: [{ student: 'Ben Reyes', keith: 'A', keithRank: 1, placed: 'B', placedRank: 2 }] }
  const shadow = html(Bar, { keith: { available: true, mode: 'shadow', comparison }, cohortName: 'Fall 2026', canRun: true, isOwner: true })
  assert.match(shadow, /Shadow mode, Fall 2026\.<\/b> Keith suggests in the background\. You place as usual\./)
  assert.match(shadow, /Turn on suggestions/)
  assert.doesNotMatch(html(Bar, { keith: { available: true, mode: 'shadow', comparison }, cohortName: 'Fall 2026', isOwner: false }), /Turn on/)
  assert.equal(html(Bar, { keith: { available: true, mode: 'off' } }), '')
  assert.equal(html(Bar, { keith: null }), '')
  const on = html(Bar, { keith: { available: true, mode: 'on', suggestions: [sg(), sg({ id: 's2' })] }, canRun: true, isOwner: true })
  assert.match(on, /2 suggestions waiting\./)
  assert.match(on, /Suggest for all unplaced/)
  assert.match(on, /Turn off suggestions/)
})

test('the student note says where Keith suggests them', () => {
  const student = { id: 'st1', first_name: 'Ana', last_name: 'Reyes', status: 'Interviewed', school: 'CSUN', unit_preference_1: '4 SCCT' }
  const out = html(Card, { student, units: [], matches: [], onSelect() {}, keithSuggestedUnit: '4 SCCT' })
  assert.match(out, /data-testid="pool-keith-suggestion"[\s\S]*Suggested for 4 SCCT/)
  assert.doesNotMatch(html(Card, { student, units: [], matches: [], onSelect() {} }), /Suggested for/)
})
