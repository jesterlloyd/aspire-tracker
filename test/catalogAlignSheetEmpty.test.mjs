// CATALOG-ALIGN-1 and SHEET-EMPTY-1 (Owner, 2026-09-24). Measured in a browser harness on the
// day: Status sat at one x in all four rows (Send, Send form, Send for signature) in Modern
// and Classic, and an empty Sheet drew its header and ten numbered rows. These pin the shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('the Catalog list gives its action column one width, so Status lines up', () => {
  const css = read('src/components/catalog/catalog.css')
  assert.match(css, /\.ctl-lh, \.ctl-it \{ display: grid; grid-template-columns: 40px minmax\(0, 1fr\) 150px var\(--ctl-acts-w\);/)
  assert.match(css, /\.ctl-listcard \{ --ctl-acts-w: \d+px; \}/)
})

test('an empty Sheet renders the grid, not a card', () => {
  const src = read('src/components/forms/FormSheet.jsx')
  assert.doesNotMatch(src, /if \(!data\.rows\.length\) return/)
  assert.match(src, /const none = !data\.rows\.length/)
  assert.match(src, /none && BLANK_ROWS\.map/)
  assert.match(src, /const BLANK_ROWS = \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/)
  assert.match(read('src/components/forms/forms.css'), /\.fs-row:not\(\.fs-blank\):hover td/)
})
