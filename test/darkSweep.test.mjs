// test/darkSweep.test.mjs
//
// DARK-SWEEP-1 (2026-09-29): the paper-style screens were swept on the live app, every text node in
// all four style and theme combinations. These hold what was fixed: each new ink is measured against
// the surface it sits on, and the sources still say what the measurement assumed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

test('the new inks clear 4.5:1 on the surfaces they were measured on', () => {
  const pairs = [
    ['#A8AEC6', '#1C1F2C', 'soft ink on a Classic dark note'],
    ['#A8AEC6', '#263142', 'soft ink on a Modern dark note'],
    ['#A9BEFF', '#1C1F2C', 'link on a dark note'],
    ['#7FD8A8', '#273345', 'Unit Leader Notified on a Modern dark header'],
    ['#7FD8A8', '#1C1F2C', 'a note row\'s Notified on a Classic dark note'],
    ['#7FD8A8', '#263142', 'a note row\'s Notified on a Modern dark note'],
    ['#166534', '#FFFFFF', 'a note row\'s Notified on a light note'],
    ['#0F1419', '#86A2FF', 'a resting Responses folder tab in Classic dark'],
    ['#E9EAF2', '#171D24', 'KPI figure on a dark card'],
    ['#1D2567', '#FFFFFF', 'KPI figure on a light card'],
    ['#4A5560', '#F4F1EC', 'caption ink on the cream page'],
    ['#A9BEFF', '#3A2C14', 'See who on the dark amber tint'],
  ]
  for (const [ink, ground, what] of pairs) assert.ok(ratio(ink, ground) >= 4.5, `${what}: ${ratio(ink, ground).toFixed(2)}:1`)
})

test('the sources still carry the fixes', () => {
  const board = read('src/components/placement/placementBoard.css')
  assert.match(board, /\[data-theme="dark"\] \.pb-note \{ --aspire-paper-ink-soft: #A8AEC6; \}/)
  assert.match(board, /\[data-theme="dark"\] \.pb-note \.pb-link \{ color: #A9BEFF; \}/)
  assert.match(board, /\.material-soft:not\(\.material-chip\) \{\s*color: #B4C0D0;/, 'a white chip keeps its dark ink in Modern dark')
  // DARK-SWEEP-2: the note row's Notified follows the note.
  assert.match(board, /\[data-theme="dark"\] \.pb-note \{ --pb-notified-ink: #7FD8A8; \}/)
  assert.match(read('src/components/placement/NotificationControl.jsx'), /color: 'var\(--pb-notified-ink, #166534\)'/)
  assert.match(read('src/components/evaluation/responsesPacket.css'), /\.rp-tab:not\(\[data-selected="true"\]\) \.rp-tab-main,[\s\S]{0,700}color: var\(--seg-active-ink, #0F1419\)/, 'DARK-SWEEP-2: a resting tab in Classic dark has dark ink')
  const kpi = read('src/components/KPIBand.jsx')
  assert.match(kpi, /var\(--kpi-ink, /)
  assert.match(kpi, /var\(--aspire-ok, /)
  assert.match(kpi, /var\(--aspire-warn, /)
  assert.doesNotMatch(kpi, /color: colors\.ink4/, 'the KPI sub-line reads a theme ink')
  const theme = read('src/styles/theme.css')
  assert.equal((theme.match(/--kpi-ink:/g) || []).length, 2, 'one value per theme')
  assert.doesNotMatch(read('src/components/placement/NotificationControl.jsx'), /color: '#9ca3af'/)
})
