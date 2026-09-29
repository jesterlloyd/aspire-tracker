// test/keithMark.test.mjs
//
// KEITH-FOUNDATION-1: the Keith mark, rendered (Vite ssrLoadModule + react-dom/server, the pattern of
// test/headerRenderSmoke.test.mjs; no .env needed).
//   - drafted, edited and accepted each render a real <button> with the brief's accessible name, the
//     orb image, and the right badge; rejected and reverted render nothing
//   - INTERNAL ONLY: a student, a school, a preceptor, leadership or nobody signed in gets nothing,
//     even when the record is in the cache; the server half is test/keithFoundation.test.mjs
//   - the badge and card colours pass contrast in light and dark (measured from the tokens)
//   - nothing a student, school or outside party sees imports the mark (portal pages, emails, PDFs)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

let vite, Mark, Store, Auth
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  Mark = await vite.ssrLoadModule('/src/components/keith/KeithMark.jsx')
  Store = await vite.ssrLoadModule('/src/components/keith/keithProvenanceStore.js')
  Auth = await vite.ssrLoadModule('/src/contexts/AuthContext.jsx')
})
after(async () => { await vite?.close() })

const OWNER = { id: 'o', role: 'owner', is_owner: true, full_name: 'Jester Lloyd Bautista' }
const record = (state, over = {}) => ({ id: `p-${state}`, state, mode: 'on', skill_name: 'Read Receipt', created_at: '2026-09-28T18:04:00Z', read: 'IMG_4471.jpg', confidence: 'medium', reason: 'Copy Paper: Paper for packets.', human_action_by_name: '', human_action_at: null, ...over })
const view = (props) => renderToStaticMarkup(React.createElement(Mark.KeithMarkView, props))
const withAuth = (profile, el) => renderToStaticMarkup(React.createElement(Auth.AuthContext.Provider, { value: { userProfile: profile } }, el))

test('each state renders a real button with the brief’s name, the orb and its badge', () => {
  const d = view({ record: record('drafted'), viewer: OWNER })
  assert.match(d, /<button type="button" class="km km-sm" data-state="drafted" aria-label="Drafted by Keith\. Show details" aria-expanded="false">/)
  assert.match(d, /<img class="km-orb" src="\/brand\/keith-orb-160\.png" alt=""/)
  assert.doesNotMatch(d, /km-badge/, 'drafted is the orb alone')

  const e = view({ record: record('edited'), viewer: OWNER, size: 'lg' })
  assert.match(e, /class="km km-lg" data-state="edited" aria-label="Edited after Keith drafted it\. Show details"/)
  assert.match(e, /<svg class="km-badge"[^>]*style="background:#F5B530"/)
  assert.match(e, /fill="#5A2E0A"/, 'a dark brown pencil')

  const a = view({ record: record('accepted'), viewer: OWNER })
  assert.match(a, /aria-label="Suggested by Keith, accepted\. Show details"/)
  assert.match(a, /<svg class="km-badge"[^>]*style="background:#3FD6AE"/)
  assert.match(a, /stroke="#14205C"/, 'a navy check mark')

  for (const s of ['rejected', 'reverted', 'maybe']) assert.equal(view({ record: record(s), viewer: OWNER }), '', `${s} draws nothing`)
})

test('the mark never renders for a student, a school or any other outside viewer', () => {
  Store.primeKeithProvenance('p-cached', record('accepted', { id: 'p-cached' }))
  const el = React.createElement(Mark.default, { provenanceId: 'p-cached' })
  assert.match(withAuth(OWNER, el), /Suggested by Keith, accepted/, 'the Owner sees the cached record')
  assert.match(withAuth({ role: 'interviewer' }, el), /km km-sm/, 'staff see it')
  for (const role of ['student', 'academic_partner', 'school', 'preceptor', 'unit_leader', 'nursing_academic', 'resident']) {
    assert.equal(withAuth({ id: 'x', role }, el), '', `${role} sees nothing`)
  }
  assert.equal(withAuth(null, el), '', 'nobody signed in sees nothing')
  assert.equal(renderToStaticMarkup(el), '', 'no auth context at all: nothing')
  // Even the view refuses a non-staff viewer handed a record directly.
  assert.equal(view({ record: record('drafted'), viewer: { role: 'student' } }), '')
})

test('the card says what Keith did in words, a count of what it read, and that it is internal', async () => {
  const P = await import('../src/lib/keith/provenanceModel.js')
  const c = P.cardView(record('edited', { human_action_by_name: 'Jester Lloyd Bautista', human_action_at: '2026-09-28T18:20:00Z' }), { now: new Date('2026-10-01T12:00:00Z') })
  assert.equal(c.title, 'Edited after Keith drafted it')
  assert.deepEqual(c.rows.map(r => r[0]), ['Skill', 'When', 'Read', 'Person', 'Confidence'])
  assert.match(c.rows[3][1], /^Edited by Jester Lloyd Bautista, Sep 28, /)
  assert.equal(c.why, 'Copy Paper: Paper for packets.')
  assert.equal(c.footer, 'Internal only. Logged in Keith › Usage & Cost.')
  assert.equal(P.readSummary([{ type: 'checkin_reply', id: 1 }, { type: 'checkin_reply', id: 2 }], { checkin_reply: ['reply', 'replies'] }), '2 replies')
  const s = P.cardView(record('drafted', { mode: 'shadow' }))
  assert.deepEqual(s.rows.at(-1), ['Mode', 'Shadow mode: Keith took no action'])
})

// ── Contrast, from the tokens ───────────────────────────────────────────────────

const hex = (h) => { const n = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255) }
const lum = (h) => { const [r, g, b] = hex(h).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const theme = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
const tokenIn = (block, name) => block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]
const lightBlock = theme.slice(0, theme.indexOf(':root[data-theme="dark"]'))
const darkBlock = theme.slice(theme.indexOf(':root[data-theme="dark"]'))

test('the badges and the Keith surfaces pass contrast in light and dark', async () => {
  const P = await import('../src/lib/keith/provenanceModel.js')
  // A badge's glyph is a graphic: 3:1 against its fill (WCAG 1.4.11). The fill against the orb's navy too.
  assert.ok(ratio(P.BADGES.edited.ink, P.BADGES.edited.fill) >= 4.5, `pencil ${ratio(P.BADGES.edited.ink, P.BADGES.edited.fill).toFixed(2)}`)
  assert.ok(ratio(P.BADGES.accepted.ink, P.BADGES.accepted.fill) >= 4.5, `check ${ratio(P.BADGES.accepted.ink, P.BADGES.accepted.fill).toFixed(2)}`)
  for (const [mode, block] of [['light', lightBlock], ['dark', darkBlock]]) {
    const keith = tokenIn(block, '--keith'), soft = tokenIn(block, '--keith-soft')
    assert.ok(keith && soft, `${mode}: --keith and --keith-soft are defined`)
    // The pill's text (--keith on --keith-soft) is text: 4.5:1.
    assert.ok(ratio(keith, soft) >= 4.5, `${mode} --keith on --keith-soft ${ratio(keith, soft).toFixed(2)}`)
  }
  assert.match(lightBlock, /--keith-launcher-ring:\s*0 0 0 2px rgba\(255, 255, 255, 0\.7\)/, 'a white ring in light mode')
  assert.match(darkBlock, /--keith-launcher-ring:\s*0 0 0 0 transparent/, 'none in dark mode')
})

// ── Nothing outside sees it ─────────────────────────────────────────────────────

const walk = (dir) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
test('no portal page, email, PDF or export imports the mark or reads provenance', () => {
  const root = new URL('..', import.meta.url).pathname
  const outside = [
    ...walk(join(root, 'src/portal')), ...walk(join(root, 'src/pages')),
    ...walk(join(root, 'lib/server/forms')), ...walk(join(root, 'lib/server/signatures')),
    ...walk(join(root, 'api')).filter(p => /email|mail|pdf|export|portal|notify|cron/i.test(p)),
    join(root, 'lib/server/sheet/xlsx.js'),
  ].filter(p => /\.(jsx?|mjs)$/.test(p) && !/ \d\.(jsx?|mjs)$/.test(p))
  assert.ok(outside.length > 50, `swept ${outside.length} files`)
  for (const p of outside) {
    const src = readFileSync(p, 'utf8')
    assert.doesNotMatch(src, /KeithMark|keith_provenance|keithProvenanceStore|provenanceCards/, `${p.slice(root.length)} must not reach Keith provenance`)
  }
})
