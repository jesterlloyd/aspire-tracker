// test/formBuilderDrag.test.mjs
//
// FORM-DRAG-1 (2026-09-24): dragging a question in the form builder moved nothing, because the
// drop cleared the picked-up index before React ran the state updater that read it. The drop
// must capture the index first. Verified by dispatching real DragEvents in a browser harness:
// down (first to fourth) and up (last to first) both reorder and save.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/forms/FormBuilder.jsx', import.meta.url), 'utf8')

test('the drop reads the dragged index before clearing it', () => {
  const drop = src.slice(src.indexOf('onDrop={(e) =>'), src.indexOf('onDrop={(e) =>') + 700)
  const capture = drop.indexOf('const from = drag.current')
  const clear = drop.indexOf('drag.current = null')
  assert.ok(capture > -1 && clear > capture, 'capture, then clear')
  assert.match(drop, /moveQuestion\(d\.questions, from, i\)/)
  assert.doesNotMatch(drop, /moveQuestion\(d\.questions, drag\.current/, 'never read the ref inside the updater')
})

test('the drag works in Firefox and shows where the question lands', () => {
  assert.match(src, /dataTransfer\.setData\('text\/plain'/)
  assert.match(src, /fm-q-drop-after/)
  assert.match(src, /onDragEnd=/)
  const css = readFileSync(new URL('../src/components/forms/forms.css', import.meta.url), 'utf8')
  assert.match(css, /\.fm-q-drop-before::before, \.fm-q-drop-after::after/)
})
