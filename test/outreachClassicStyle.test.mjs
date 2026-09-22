import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

test('Classic Outreach is one presentation skin over the existing workflows', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  assert.match(outreach, /const classicDesk = appearanceStyle !== 'modern'/)
  assert.match(outreach, /outreach-workspace-classic/)
  assert.match(outreach, /Correspondence Desk/)
  assert.match(outreach, /recipientMode === 'single'/)
  assert.match(outreach, /recipientMode === 'bulk'/)
  assert.match(outreach, /recipientMode === 'history'/)
  assert.match(outreach, /<BulkManualComposer/)
  assert.match(outreach, /<SentHistory/)
})

test('the correspondence skin keeps physical materials warm in Dark mode', () => {
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  assert.match(css, /--ocd-paper: #fffdf7/)
  assert.match(css, /--ocd-leather: #26314f/)
  assert.doesNotMatch(css, /data-theme=['"]dark['"]/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
})

test('the supplied metaphor is restrained and uses the live editor', () => {
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  const editor = read('src/components/connect/RichTextEditor.jsx')
  assert.match(css, /outreach-rich-editor-carriage/)
  assert.match(editor, /<EditorContent editor=\{editor\} \/>/)
  assert.doesNotMatch(css, /typewriter-key|typing-sound|moving-carriage|distressed/)
})

test('Settings documents Outreach as a shipped correspondence desk surface', () => {
  const appearance = read('src/lib/appearance.js')
  const settings = read('src/components/settings/AppearancePanel.jsx')
  assert.match(appearance, /key: 'outreach', label: 'Outreach', material: 'Correspondence desk', modern: true/)
  assert.match(settings, /address book, the correspondence desk/)
})
