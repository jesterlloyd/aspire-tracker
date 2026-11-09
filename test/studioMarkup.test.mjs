// STUDIO-RICH-1 (2026-11-08): Studio's text fields edit with a TipTap toolbar but still store light
// markup. These hold the translation both ways and the renderer's reading of the new markup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { markupToDoc, docToMarkup, groupLines, listLine } from '../src/lib/studio/studioMarkup.js'
import { renderStudioEmail as renderEmail } from '../src/lib/studio/renderEmail.js'
import { makeBlock } from '../src/lib/studio/studioBlocks.js'

const round = (s) => docToMarkup(markupToDoc(s))

test('markup survives a round trip through the editor', () => {
  for (const s of [
    'Hello [First Name],',
    '**Bold** and *italic* and ++underlined++ words.',
    'Line one\nLine two\n\nNew paragraph.',
    '- One\n- Two with **bold**',
    '3. Third\n4. Fourth',
    'Visit [our page](https://example.com/x) today.',
    '3 * 4 = 12 and a*b',
  ]) assert.equal(round(s), s, s)
})

test('a list line directly under a paragraph line becomes its own block', () => {
  assert.equal(round('**Before:**\n• One'), '**Before:**\n\n- One')
})

test('list lines group by kind and keep the start number', () => {
  assert.deepEqual(listLine('2) Two'), { kind: 'ordered', text: 'Two', start: 2 })
  assert.equal(listLine('3 * 4'), null)
  const runs = groupLines('Intro\n- a\n- b\n1. c')
  assert.deepEqual(runs.map(r => r.type + (r.kind ? ':' + r.kind : '')), ['lines', 'list:bullet', 'list:ordered'])
})

test('markers stay outside spaces at the ends of a marked run', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'a' }, { type: 'text', text: ' bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'b' },
  ] }] }
  assert.equal(docToMarkup(doc), 'a **bold** b')
})

test('the email renders lists and underline with inline styles', () => {
  const block = makeBlock('text')
  block.props.text = 'Before you apply:\n\n- Online application\n- Résumé with ++hours++\n\n1. Apply\n2. Interview'
  const { html, text } = renderEmail({ subject: 's', theme: 'aspire', blocks: [block] })
  assert.match(html, /<ul style="[^"]*padding:0 0 0 24px;[^"]*"><li style="[^"]*">Online application<\/li>/)
  assert.match(html, /<u>hours<\/u>/)
  assert.match(html, /<ol style="[^"]*"><li[^>]*>Apply<\/li>/)
  assert.match(text, /Online application/)
  assert.doesNotMatch(text, /\+\+/)
})
