// test/uiCanonRatchet.test.mjs
//
// UI-CONSISTENCY-1: a RATCHET, not an allowlist.
//
// The guard in test/uiConsistency.test.mjs checks ten named card classes. A new card
// class with a literal radius would pass it, because nothing knows it is a card. This
// test does not try to know: it counts every literal radius in src/ and fails if the
// count goes UP. Converting a rule to the token lowers the number; lower the baseline
// with it. Writing a new literal raises the number; that is the failure, and the message
// names the token to use instead.
//
// Pills (999px) and circles (50%) are not literals in this sense and are not counted.
// Chips inside cards still are: they are the most common way a new radius sneaks in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Frozen on 2026-09-03 from the tree as of 852cba5. Lower these as rules migrate to the
// tokens. Never raise them: that is the whole point.
const BASELINE = {
  cssRadiusLiterals: 448,   // border-radius: <n>px in any src/**/*.css
  jsxRadiusLiterals: 1290,  // borderRadius: <n> in any src/**/*.jsx
}

function walk(dir, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (/ \d+\.|node_modules/.test(e.name)) continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, out)
    else if (/\.(css|jsx)$/.test(e.name)) out.push(rel)
  }
  return out
}

function count() {
  let css = 0, jsx = 0
  const worst = { css: new Map(), jsx: new Map() }
  for (const f of walk('src')) {
    const s = readFileSync(join(root, f), 'utf8')
    if (f.endsWith('.css')) {
      const n = (s.match(/border-radius:\s*[0-9.]+px/g) || []).length
      css += n; if (n) worst.css.set(f, n)
    } else {
      const n = (s.match(/borderRadius:\s*'?[0-9.]+(?:px)?'?/g) || []).length
      jsx += n; if (n) worst.jsx.set(f, n)
    }
  }
  return { css, jsx, worst }
}

const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `${n}  ${f}`).join('\n    ')

test('literal radii in CSS never increase (use var(--aspire-radius-card) or --aspire-radius-control)', () => {
  const { css, worst } = count()
  assert.ok(css <= BASELINE.cssRadiusLiterals,
    `CSS literal radii went from ${BASELINE.cssRadiusLiterals} to ${css}. A new rule wrote a number where a token belongs.\n  Heaviest files:\n    ${top(worst.css)}`)
})

test('literal radii in JSX never increase (a card is .snap, .ov-panel or .ptl-card; a control reads the token)', () => {
  const { jsx, worst } = count()
  assert.ok(jsx <= BASELINE.jsxRadiusLiterals,
    `JSX literal radii went from ${BASELINE.jsxRadiusLiterals} to ${jsx}. A new inline style wrote a number where a token or a card class belongs.\n  Heaviest files:\n    ${top(worst.jsx)}`)
})

test('the baseline is honest: it is not slack', () => {
  // If someone lowers the count and forgets the baseline, this reminds them so the ratchet
  // keeps its teeth. It is a warning-shaped assertion: more than 25 of slack means the
  // number in this file no longer describes the tree.
  const { css, jsx } = count()
  assert.ok(BASELINE.cssRadiusLiterals - css <= 25, `CSS baseline is ${BASELINE.cssRadiusLiterals} but the tree has ${css}: lower the baseline`)
  assert.ok(BASELINE.jsxRadiusLiterals - jsx <= 25, `JSX baseline is ${BASELINE.jsxRadiusLiterals} but the tree has ${jsx}: lower the baseline`)
})

test('every block that follows a card carries its own top margin', () => {
  // The rule behind the At a Glance regression: a card never carries a bottom margin, so
  // whatever comes next must bring the gap. These are the two grids that follow a .snap.
  const css = readFileSync(join(root, 'src/index.css'), 'utf8')
  for (const sel of ['.ov-panels', '.dashboard']) {
    const m = css.match(new RegExp('(?:^|\\n)' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}'))
    assert.ok(m, `${sel} rule exists`)
    assert.match(m[1], /margin-top:\s*var\(--aspire-gap-card\)/, `${sel} must carry the gap above itself`)
  }
  assert.match(css, /\.snap \{[^}]*margin:\s*var\(--aspire-gap-card\) 20px 0/s, 'a card carries top, never bottom')
})

test('the canon is written where every session reads it', () => {
  const doc = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  for (const must of ['--aspire-radius-card', '--aspire-gap-card', 'Followers carry the top margin', 'Title Case', 'uiCanonRatchet']) {
    assert.ok(doc.includes(must), `CLAUDE.md must state: ${must}`)
  }
})
