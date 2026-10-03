// CONNECT-EDITOR-1 (2026-10-03): Outreach stays mounted behind Connect's Contacts tab, so opening
// Connect from another page builds the rich-text editor and discards one instance. Since TipTap 3 a
// destroyed editor has no schema, and getHTML() on it took the whole page down with
// "Cannot read properties of null (reading 'cached')". Every effect that touches the editor skips a
// destroyed one; the effect runs again when the live editor arrives.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src/components/connect/RichTextEditor.jsx'), 'utf8')

test('the content sync and editable effects skip a destroyed editor', () => {
  assert.match(src, /useEffect\(\(\) => \{\s*if \(!editor \|\| editor\.isDestroyed\) return\s*const current = editor\.getHTML\(\)/)
  assert.match(src, /if \(editor && !editor\.isDestroyed\) editor\.setEditable\(!disabled\)/)
})
