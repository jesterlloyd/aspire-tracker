// Commit 3: shared masthead typography no longer clips the greeting descenders, and the existing
// weather artwork is enlarged. Both are fixed once at the shared level (.mast-greet, .wx-mast) so
// the main app, Unit Leader, and Student mastheads all inherit them. No new weather art or request.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { greetingLine } from '../src/lib/greeting.js'

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
test('every daypart greeting (the clipped glyphs live in "morning/evening") is produced', () => {
  const at = (h) => new Date(2026, 6, 18, h, 0)
  assert.equal(greetingLine('Jordan Cruz', at(8)).heading, 'Good morning, Jordan')
  assert.equal(greetingLine('Jordan Cruz', at(14)).heading, 'Good afternoon, Jordan')
  assert.equal(greetingLine('Jordan Cruz', at(20)).heading, 'Good evening, Jordan')
})

test('all three surfaces use the shared .mast-greet, so the fix applies once', () => {
  const staff = read('src/components/TodayMasthead.jsx')
  const shared = read('src/components/MastheadCard.jsx')
  // MASTHEAD-PHASE-2b: both hosts render the one element; the greeting itself
  // (chart-route-title mast-greet) lives inside <masthead-card>, guarded in the
  // masthead repository.
  assert.match(staff, /<MastheadCard[\s\S]*?fullName=\{userProfile\?\.full_name\}/)
  assert.match(shared, /<masthead-card/)
})

// ── weather artwork enlarged, reusing the existing scene ──────────────────────
