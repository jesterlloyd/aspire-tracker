// test/confirmDialog.test.mjs
//
// CONFIRM-DIALOG-1 and TAIL-COLLAPSE-1 (Owner, 2026-10-01): "I need a new modal to confirm deletion or
// something. and alike. and maybe collapse the expected or upcoming expenses as it takes up a lot of
// space." The browser's own confirm box is gone from the app: every confirmation is confirmDialog(),
// one dialog in the app's own style. The Sheet's Expected charges start folded to one line.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')
const walk = (dir) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) && !/ \d+\./.test(n) ? [p] : [] })
const code = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

test('no screen uses the browser’s own confirm box', () => {
  const hits = walk(join(root, 'src')).filter(f => /(^|[^a-zA-Z.])(window\.)?confirm\(/.test(code(readFileSync(f, 'utf8')))).map(f => f.slice(root.length))
  assert.deepEqual(hits, [], 'use confirmDialog() from src/components/shared/confirmDialog.jsx')
})

test('a question splits into the dialog’s title and its explanation', async () => {
  // The module imports a stylesheet; the split rule is read from its source and run here.
  const src = read('src/components/shared/confirmDialog.jsx')
  const body = src.slice(src.indexOf('export function splitQuestion'), src.indexOf('/**\n * Ask'))
  const splitQuestion = new Function(`${body.replace('export function', 'function')}; return splitQuestion`)()
  assert.deepEqual(splitQuestion('Delete this row?'), { title: 'Delete this row?', message: '' })
  assert.deepEqual(splitQuestion('End this assignment? This will remove it from the list.'), { title: 'End this assignment?', message: 'This will remove it from the list.' })
  assert.deepEqual(splitQuestion('No question mark here'), { title: 'No question mark here', message: '' })
})

test('the dialog: named, modal, Escape and outside click cancel, focus trapped and returned, Cancel first for a destructive action', () => {
  const fn = read('src/components/shared/confirmDialog.jsx')
  const box = read('src/components/shared/ConfirmDialogBox.jsx')
  assert.match(box, /role="alertdialog" aria-modal="true" aria-labelledby="cfm-title"/)
  assert.match(box, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); onDone\(false\); return \}/)
  assert.match(box, /onMouseDown=\{e => \{ if \(e\.target === e\.currentTarget\) onDone\(false\) \}\}/)
  assert.match(box, /ref=\{danger \? first : undefined\} onClick=\{\(\) => onDone\(false\)\}/, 'Enter never deletes by reflex')
  assert.match(box, /if \(e\.shiftKey && document\.activeElement === f\[0\]\)/, 'Tab is trapped')
  assert.match(fn, /before\?\.focus\?\.\(\)/, 'focus goes back to what had it')
  assert.match(fn, /document\.body\.appendChild\(host\)/, 'its own root: no host component, so the portals have it too')
  const css = read('src/components/shared/confirmDialog.css')
  assert.match(css, /\.cfm-scrim \{ position: fixed; inset: 0; z-index: 5000;/, 'above any drawer or modal that asked')
  assert.doesNotMatch(css, /border-radius:\s*[1-9]/, 'corners are the canon tokens')
})

test('the Sheet asks in the app’s dialog, with the action named on the button', () => {
  const es = read('src/components/sheet/EditableSheet.jsx')
  assert.match(es, /await confirmDialog\(n === 1 \? 'Delete this row\?' : `Delete these \$\{n\} rows\?`, \{ confirmLabel: n === 1 \? 'Delete row' : `Delete \$\{n\} rows`, danger: true \}\)/)
  assert.match(es, /await confirmDialog\('Delete this column\? Everything typed in it goes with it\.', \{ confirmLabel: 'Delete column', danger: true \}\)/)
  // Cancelling a booking never offers a bare "Cancel" as the way out.
  assert.match(read('src/components/InterviewCalendar.jsx'), /confirmLabel: 'Cancel booking', cancelLabel: 'Keep booking', danger: true/)
})

test('the Sheet’s Expected charges start folded to one line with their count and total', () => {
  const es = read('src/components/sheet/EditableSheet.jsx')
  assert.match(es, /const \[tailOpen, setTailOpen\] = useState\(false\)/)
  assert.match(es, /className="fs-tailtoggle"[^>]*aria-expanded=\{tailOpen\} onClick=\{\(\) => setTailOpen\(o => !o\)\}/)
  assert.match(es, /\{tailOpen && tail\.rows\.map\(row => \(/)
  assert.match(read('src/components/budget/BudgetSheet.jsx'), /summary: `\$\{expectedRows\.length\} \$\{expectedRows\.length === 1 \? 'charge' : 'charges'\} · \$\{usd\(/)
})
