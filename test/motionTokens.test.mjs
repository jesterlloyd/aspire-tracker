// MOTION-1: one set of timings. The CSS tokens in aspireBrand.css and the numbers Motion
// animates with (src/lib/motionTokens.js) are the same values, and the two shared surfaces
// that leave the screen animate their exit.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DUR, EASE_OUT, EASE_IN } from '../src/lib/motionTokens.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const brand = read('src/styles/aspireBrand.css')
const token = (name) => brand.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim()

test('the CSS motion tokens and the Motion numbers are the same values', () => {
  assert.equal(token('--aspire-dur-fast'), `${DUR.fast * 1000}ms`)
  assert.equal(token('--aspire-dur-base'), `${DUR.base * 1000}ms`)
  assert.equal(token('--aspire-dur-slow'), `${DUR.slow * 1000}ms`)
  assert.equal(token('--aspire-ease-out'), `cubic-bezier(${EASE_OUT.join(', ')})`)
  assert.equal(token('--aspire-ease-in'), `cubic-bezier(${EASE_IN.join(', ')})`)
})

test('the shared drawer and the toasts animate their exit and honour reduced motion', () => {
  for (const path of ['src/components/ui/DetailDrawer.jsx', 'src/components/Toast.jsx']) {
    const src = read(path)
    assert.match(src, /from 'motion\/react'/, path)
    assert.match(src, /<AnimatePresence/, path)
    assert.match(src, /exit=\{\{/, path)
    assert.match(src, /<MotionConfig reducedMotion="user">/, path)
  }
})

test('modals arrive only when motion is welcome, and the theme cross-fade stands down', () => {
  const css = read('src/index.css')
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.modal-overlay \{ animation: aspire-fade-in var\(--aspire-dur-base\)/)
  assert.match(read('src/styles/theme.css'), /prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{ transition-duration: 0\.01ms !important; \}/)
})
