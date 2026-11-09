// src/lib/studio/studioMarkup.js
//
// STUDIO-RICH-1 (Owner, 2026-11-08): Studio's text fields edit with a real toolbar (bold, italic,
// underline, bullets, numbering, links) instead of typed markup. The STORED value is still the light
// markup every reader already understands (the renderer, Keith, the canvas's inline editor, the
// plain-text part), so this module only translates between that text and the editor's document.
// Pure: no DOM.
//
//   **bold**  *italic*  ++underline++  [words](https://link)
//   a paragraph per blank line, a line break per newline
//   "- item" lines are a bulleted list ("• item" too), "1. item" lines a numbered list

import { safeUrl } from './studioBlocks.js'

const BULLET = /^\s*(?:[-•]|\*(?=\s))\s+(.*)$/
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/

/** One line's list kind: { kind: 'bullet'|'ordered', text, start? } or null. */
export function listLine(line) {
  const n = NUMBER.exec(line)
  if (n) return { kind: 'ordered', text: n[2], start: Number(n[1]) }
  const b = BULLET.exec(line)
  if (b) return { kind: 'bullet', text: b[1] }
  return null
}

/**
 * A paragraph's lines grouped into runs: { type: 'lines', lines } or { type: 'list', kind, start,
 * items }. Consecutive list lines of one kind form one list.
 */
export function groupLines(chunk) {
  const out = []
  for (const line of String(chunk).split('\n')) {
    const li = listLine(line)
    const last = out[out.length - 1]
    if (li) {
      if (last && last.type === 'list' && last.kind === li.kind) last.items.push(li.text)
      else out.push({ type: 'list', kind: li.kind, start: li.start || 1, items: [li.text] })
    } else if (last && last.type === 'lines') last.lines.push(line)
    else out.push({ type: 'lines', lines: [line] })
  }
  return out
}

// ---- markup -> editor document ---------------------------------------------------------------
// A marker pair counts only when it hugs its words ("3 * 4" is arithmetic), as the renderer reads it.

const MARKS = [
  { open: '**', close: '**', mark: 'bold' },
  { open: '++', close: '++', mark: 'underline' },
  { open: '*', close: '*', mark: 'italic' },
]

/** Inline markup to TipTap text nodes. Unmatched markers stay as typed. */
export function inlineToNodes(text, marks = []) {
  const s = String(text || '')
  const nodes = []
  let buf = ''
  const flush = () => { if (buf) { nodes.push(marks.length ? { type: 'text', text: buf, marks: marks.map(m => ({ ...m })) } : { type: 'text', text: buf }); buf = '' } }
  let i = 0
  while (i < s.length) {
    if (s[i] === '[') {
      const m = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/.exec(s.slice(i))
      const href = m && safeUrl(m[2])
      if (m && href) {
        flush()
        nodes.push(...inlineToNodes(m[1], [...marks, { type: 'link', attrs: { href } }]))
        i += m[0].length
        continue
      }
    }
    const hit = MARKS.find(k => s.startsWith(k.open, i) && !(k.open === '*' && s[i + 1] === '*'))
    if (hit) {
      const end = s.indexOf(hit.close, i + hit.open.length)
      const inner = end > i + hit.open.length ? s.slice(i + hit.open.length, end) : ''
      if (inner && !inner.includes('\n') && !/^\s|\s$/.test(inner) && !(hit.open === '*' && s[end + 1] === '*')) {
        flush()
        nodes.push(...inlineToNodes(inner, [...marks, { type: hit.mark }]))
        i = end + hit.close.length
        continue
      }
    }
    buf += s[i]
    i++
  }
  flush()
  return nodes
}

function linesToContent(lines) {
  const content = []
  lines.forEach((line, n) => {
    if (n) content.push({ type: 'hardBreak' })
    content.push(...inlineToNodes(line))
  })
  return content
}

/** Stored markup to a TipTap document. */
export function markupToDoc(text) {
  const content = []
  for (const chunk of String(text || '').split(/\n{2,}/)) {
    if (!chunk.trim()) continue
    for (const run of groupLines(chunk.replace(/^\n+|\n+$/g, ''))) {
      if (run.type === 'lines') {
        const c = linesToContent(run.lines)
        content.push(c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' })
      } else {
        const items = run.items.map(t => {
          const c = inlineToNodes(t)
          return { type: 'listItem', content: [c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' }] }
        })
        content.push(run.kind === 'ordered'
          ? { type: 'orderedList', attrs: { start: run.start }, content: items }
          : { type: 'bulletList', content: items })
      }
    }
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

// ---- editor document -> markup ---------------------------------------------------------------

const WRAP = { bold: '**', italic: '*', underline: '++' }
const ORDER = ['link', 'bold', 'underline', 'italic']

function textOf(node) {
  if (node.type === 'hardBreak') return '\n'
  if (node.type !== 'text') return ''
  let t = node.text || ''
  const marks = [...(node.marks || [])].sort((a, b) => ORDER.indexOf(b.type) - ORDER.indexOf(a.type))
  for (const m of marks) {
    if (WRAP[m.type]) {
      // Markers hug the words: spaces at either end stay outside, or the renderer would not read them.
      const lead = /^\s*/.exec(t)[0]
      const trail = /\s*$/.exec(t.slice(lead.length))[0]
      const core = t.slice(lead.length, t.length - trail.length)
      t = core ? `${lead}${WRAP[m.type]}${core}${WRAP[m.type]}${trail}` : t
    } else if (m.type === 'link') {
      const href = safeUrl(m.attrs?.href)
      if (href) t = `[${t}](${href})`
    }
  }
  return t
}

// Adjacent text nodes with the same link are joined first, so a link with bold inside stays one link.
function inlineMarkupOf(nodes = []) {
  const merged = []
  for (const n of nodes) {
    const link = n.marks?.find(m => m.type === 'link')?.attrs?.href
    const last = merged[merged.length - 1]
    if (link && last && last.link === link) last.parts.push(n)
    else merged.push({ link, parts: [n] })
  }
  return merged.map(g => {
    if (!g.link) return g.parts.map(textOf).join('')
    const inner = g.parts.map(p => textOf({ ...p, marks: (p.marks || []).filter(m => m.type !== 'link') })).join('')
    const href = safeUrl(g.link)
    return href ? `[${inner}](${href})` : inner
  }).join('')
}

const itemText = (item) => (item.content || []).map(c => (c.type === 'paragraph' ? inlineMarkupOf(c.content) : '')).filter(Boolean).join(' ').replace(/\n/g, ' ')

/** A TipTap document to stored markup. */
export function docToMarkup(doc) {
  const blocks = []
  for (const node of doc?.content || []) {
    if (node.type === 'paragraph') blocks.push(inlineMarkupOf(node.content))
    else if (node.type === 'bulletList') blocks.push((node.content || []).map(i => `- ${itemText(i)}`).join('\n'))
    else if (node.type === 'orderedList') {
      const start = Number(node.attrs?.start) || 1
      blocks.push((node.content || []).map((i, n) => `${start + n}. ${itemText(i)}`).join('\n'))
    }
  }
  // An empty paragraph between two others is a deliberate gap; the markup has one gap, so it collapses.
  return blocks.filter(b => b.trim() !== '').join('\n\n')
}
