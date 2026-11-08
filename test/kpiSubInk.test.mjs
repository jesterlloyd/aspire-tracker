// KPI-SUB-INK-1 (2026-11-07): the shared FilterKPICard's label and sub-line read on every accent.
// Measured from the source, so a new accent or a lighter ink fails here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { colors } from '../src/lib/designTokens.js'

const src = readFileSync(new URL('../src/components/KPIBand.jsx', import.meta.url), 'utf8')
const palette = src.match(/ACCENT_PALETTE = \{([\s\S]*?)\n\}/)[1]
const resolve = v => {
  const raw = v.trim().replace(/['",]/g, '')
  return raw.startsWith('colors.') ? colors[raw.slice(7)] : raw
}
const accents = [...palette.matchAll(/(\w+):\s*\{([\s\S]*?)\}/g)].map(([, name, body]) => {
  const get = k => resolve(body.match(new RegExp(`${k}:\\s*([^\\n/]+)`))[1])
  return { name, tint: get('tint'), solid: get('solid') }
})

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const whiteAt = (hex, a) => '#' + [1, 3, 5].map(i => Math.round(255 * a + parseInt(hex.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')

test('every accent resolves to a tint and a solid fill', () => {
  assert.ok(accents.length >= 7)
  for (const a of accents) assert.match(`${a.tint} ${a.solid}`, /^#[0-9A-Fa-f]{6} #[0-9A-Fa-f]{6}$/, a.name)
})

test('the sub-line and label read at 4.5:1 on every resting tint and every selected fill', () => {
  const card = src.split('export function FilterKPICard')[1]
  const restSub = card.match(/color: active \? 'rgba\(255,255,255,([\d.]+)\)' : '(#[0-9A-Fa-f]{6})'/)
  assert.ok(restSub, 'the sub-line names a fixed ink and a white alpha')
  const [, alpha, ink] = restSub
  for (const a of accents) {
    assert.ok(ratio(ink, a.tint) >= 4.5, `${a.name}: sub-line ${ratio(ink, a.tint).toFixed(2)}:1 on ${a.tint}`)
    assert.ok(ratio(colors.ink3, a.tint) >= 4.5, `${a.name}: label on ${a.tint}`)
    const w = whiteAt(a.solid, Number(alpha))
    assert.ok(ratio(w, a.solid) >= 4.5, `${a.name}: selected sub-line ${ratio(w, a.solid).toFixed(2)}:1 on ${a.solid}`)
    assert.ok(ratio('#FFFFFF', a.solid) >= 4.5, `${a.name}: selected label on ${a.solid}`)
  }
})
