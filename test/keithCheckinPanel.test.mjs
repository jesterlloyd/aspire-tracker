// test/keithCheckinPanel.test.mjs
//
// KEITH-CHECKIN-1: the Action Center's Keith lines, rendered (Vite ssrLoadModule + react-dom/server).
//   - the daily line shows only on a day Keith closed something, with Review
//   - the shadow strip names the day and the agreement; the card's Turn on auto-close is the Owner's
//     and stays disabled until the server says the gate is open; the kept-open line is always shown
//   - with auto-close on, the Owner sees Turn off auto-close

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

let vite, P, Card
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  P = await vite.ssrLoadModule('/src/components/actionCenter/KeithCheckinPanel.jsx')
  Card = (await vite.ssrLoadModule('/src/components/keith/ShadowModeCard.jsx')).default
})
after(async () => { await vite?.close() })

const html = (C, props) => renderToStaticMarkup(React.createElement(C, props))
const card = (gate, keptOpen = 0) => ({ agreement: { total: 49, agreed: 47, rate: 47 / 49, byLabel: { thank_you: { total: 31, agreed: 31 } } }, keptOpen, sorted: 49, firstShadowAt: '2026-09-20T00:00:00Z', gate })

test('the daily line shows only on a day Keith closed something', () => {
  const item = { key: 'support:1', shiftLogId: '1', provenanceId: 'p1', title: 'Ana', reply: 'Thanks!', at: '2026-09-29T16:00:00Z' }
  assert.equal(html(P.KeithDailyLine, { daily: [{ day: '2026-09-28', today: false, items: [item] }], onReopen() {} }), '')
  const out = html(P.KeithDailyLine, { daily: [{ day: '2026-09-29', today: true, items: [item, { ...item, key: 'support:2' }] }], onReopen() {} })
  assert.match(out, /Keith closed 2 thank-you replies today\./)
  assert.match(out, /aria-expanded="false">Review<\/button>/)
})

test('in shadow the strip names the day and the agreement; only the Owner sees the switch', () => {
  const shut = { ok: false, day: 9, daysLeft: 5, message: 'Shadow mode runs 14 days. 5 days are left.' }
  const strip = html(P.KeithModeStrip, { keith: { mode: 'shadow', card: card(shut) }, isOwner: true, onSetMode() {} })
  assert.match(strip, /Keith is sorting in shadow mode · Day 9 of 14 · 96% agreement/)
  assert.equal(html(P.KeithModeStrip, { keith: { mode: 'off', card: card(shut) }, isOwner: true }), '', 'nothing while the skill is off')
  assert.equal(html(P.KeithModeStrip, { keith: null, isOwner: true }), '')
  // The card itself: the kept-open line, and the Owner's button disabled until the gate opens.
  const labels = { thank_you: 'Thank-you replies Keith would close' }
  const c = html(Card, { agreement: card(shut).agreement, labels, lines: [['Replies Keith would close that you kept open', 0, true]], status: 'Day 9 of 14' })
  assert.match(c, /Agreed with you on 47 of 49/)
  assert.match(c, /<div class="ksm-key"><dt>Replies Keith would close that you kept open<\/dt><dd>0<\/dd><\/div>/)
  assert.match(c, /Thank-you replies Keith would close<\/dt><dd>31 of 31 agreed/)
})

test('with auto-close on, the Owner can turn it off and an Admin sees only the line', () => {
  const on = html(P.KeithModeStrip, { keith: { mode: 'on', card: card({ ok: true }) }, isOwner: true, onSetMode() {} })
  assert.match(on, /Auto-close is on\. Keith closes plain thank-you replies; replies with a safety term are never closed\./)
  assert.match(on, />Turn off auto-close<\/button>/)
  assert.doesNotMatch(html(P.KeithModeStrip, { keith: { mode: 'on', card: card({ ok: true }) }, isOwner: false }), /Turn off/)
})
