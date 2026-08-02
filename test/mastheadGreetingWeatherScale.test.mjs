// Commit 3: shared masthead typography no longer clips the greeting descenders, and the existing
// weather artwork is enlarged. Both are fixed once at the shared level (.mast-greet, .wx-mast) so
// the main app, Unit Leader, and Student mastheads all inherit them. No new weather art or request.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { greetingLine } from '../src/lib/masthead.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const css = read('src/index.css')
const cssBlock = (selector) => {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ''
  const end = css.indexOf('\n}', start)
  return end === -1 ? '' : css.slice(start, end + 2)
}

// ── greeting descender fix at the shared level ────────────────────────────────
test('the shared greeting has a line box tall enough for descenders under overflow:hidden', () => {
  const greet = cssBlock('.mast-greet')
  // The tight 1.1 line box was the clipping cause; it is now taller with a small bottom pad.
  assert.match(greet, /line-height: 1\.25/)
  assert.match(greet, /padding-bottom: 2px/)
  assert.doesNotMatch(greet, /line-height: 1\.1;/)
  // The approved 30px size and the horizontal ellipsis behavior are preserved.
  assert.match(greet, /font-size: 30px/)
  assert.match(greet, /overflow: hidden; text-overflow: ellipsis; white-space: nowrap/)
})

test('every daypart greeting (the clipped glyphs live in "morning/evening") is produced', () => {
  const at = (h) => new Date(2026, 6, 18, h, 0)
  assert.equal(greetingLine('Jordan Cruz', at(8)).heading, 'Good morning, Jordan')
  assert.equal(greetingLine('Jordan Cruz', at(14)).heading, 'Good afternoon, Jordan')
  assert.equal(greetingLine('Jordan Cruz', at(20)).heading, 'Good evening, Jordan')
})

test('all three surfaces use the shared .mast-greet, so the fix applies once', () => {
  const staff = read('src/components/TodayMasthead.jsx')
  const shared = read('src/components/masthead/GreetingMasthead.jsx')
  assert.match(staff, /className="chart-route-title mast-greet"/)   // main app
  assert.match(shared, /className="chart-route-title mast-greet"/)  // Unit Leader + Student portals
})

// ── weather artwork enlarged, reusing the existing scene ──────────────────────
test('the masthead weather artwork is enlarged from the existing scene', () => {
  // up from the original 110px, nudged farther up into the card headroom.
  // MASTHEAD-WEATHER-1b: margin-top -10 -> -16px pulls the whole composition to the
  // card's top edge (the card frames it via its own overflow:hidden).
  // MASTHEAD-WEATHER-1: 178 -> 192 (and 132 -> 142 narrow) for the modest
  // prominence bump; the caption grew alongside (27px temp, 13px condition).
  assert.match(css, /\.wx-mast-art \{ position: relative; flex-shrink: 0; width: 192px; margin-top: -16px; pointer-events: none; \}/)
  assert.match(css, /\.wx-mast \.wx-svg \{ width: 192px; \}/)
  // Narrow screens keep it balanced beside the caption.
  assert.match(css, /\.wx-mast-art \{ width: 142px; margin-top: 0; \}/)
  assert.match(css, /\.wx-mast \.wx-svg \{ width: 142px; \}/)
})

test('the evening wash is cooler and less reddish so the night sky elements read', () => {
  const evening = css.slice(css.indexOf('.mast-wash-evening::before'))
  const block = evening.slice(0, evening.indexOf('}') + 1)
  // The warm peach radial that read as reddish is gone; the dusk glow is a cool indigo.
  assert.doesNotMatch(block, /255,180,130/)
  assert.match(block, /rgba\(84,96,168,0\.40\)/)
  assert.match(block, /rgba\(52,64,128,0\.34\)/)
  // The dark-theme evening wash is cooled too (no warm sunset cast).
  const dark = css.slice(css.indexOf('[data-theme="dark"] .mast-wash-evening::before'))
  const darkBlock = dark.slice(0, dark.indexOf('}') + 1)
  assert.doesNotMatch(darkBlock, /255,160,110/)
  assert.match(darkBlock, /rgba\(96,120,210,0\.16\)/)
})

test('no new weather artwork or weather request is introduced', () => {
  // The scene component is reused unchanged: one shared Open-Meteo query, the same SVG + licensed
  // asset renderers. The resize is CSS only, so index.css must not add any image or asset path.
  const wx = read('src/components/WeatherScene.jsx')
  assert.equal((wx.match(/fetch\(/g) || []).length, 1)              // still one weather request
  assert.match(wx, /export function WeatherMasthead\(\)/)
  assert.match(wx, /<SceneSvg scene=\{scene\} \/>/)
  assert.match(wx, /<AssetScene manifest=\{manifest\}/)
  assert.doesNotMatch(css, /wx-mast[\s\S]{0,400}url\(|wx-mast[\s\S]{0,400}\.png|wx-mast[\s\S]{0,400}<img/)
})
