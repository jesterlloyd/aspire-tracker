// lib/server/forms/formPdf.js
//
// FORMS-PHASE3: the PDF of one submission, the copy filed to the person's record. Letter
// size, the form's title, who answered and when, then every question with its answer in
// the order the form asked them. A drawn signature is drawn; a typed one is set in italic.
// Standard fonts only (no font files to ship); characters they cannot encode are replaced
// rather than failing the submission.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Buffer } from 'node:buffer'
import { takesAnswer, answerText } from '../../../src/lib/forms/formModel.js'
import { drawParkingSpd } from './layouts/parkingSpd.js'

const W = 612, H = 792, M = 54
const INK = rgb(0.11, 0.13, 0.19), MUTED = rgb(0.36, 0.38, 0.45), RULE = rgb(0.85, 0.86, 0.89), NAVY = rgb(0.11, 0.15, 0.4)

// WinAnsi covers Latin-1 plus a few typographic marks; anything else becomes "?".
const WIN_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
const safe = (s) => [...String(s ?? '')].map(ch => {
  const c = ch.codePointAt(0)
  if (ch === '\n' || ch === '\t') return ch
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(ch)) return ch
  return '?'
}).join('')

function wrap(text, font, size, width) {
  const out = []
  for (const para of safe(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      if (!word) continue
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue }
      if (line) out.push(line)
      // A single word wider than the line is broken by characters.
      let w = word
      while (font.widthOfTextAtSize(w, size) > width) {
        let n = w.length
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--
        out.push(w.slice(0, n)); w = w.slice(n)
      }
      line = w
    }
    out.push(line)
  }
  return out
}

// PARKING-PDF-1: a form whose paper original the office already knows is drawn in that
// form's own layout. The engine picks the layout; everything else gets the plain PDF.
const LAYOUTS = { 'parking-spd': drawParkingSpd }

async function embedLogo(doc, bytes) {
  if (!bytes?.length) return null
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes)
  } catch { /* an unreadable logo falls back to the organization's name */ }
  return null
}

/**
 * definition: the version answered. answers: cleaned answers. who: { name, email }.
 * meta: { submittedAt, submissionId, version, timeZone, orgName }.
 * layout: a key of LAYOUTS, or none for the plain PDF. logo: PNG or JPEG bytes, or none.
 */
export async function buildSubmissionPdf({ definition, answers, who, meta, layout = null, logo = null }) {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(definition.title)); doc.setAuthor(safe(who?.name || '')); doc.setCreator('ASPIRE Intelligence')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic)
  const draw = LAYOUTS[layout]
  if (draw) {
    draw({ definition, answers, meta }, { doc, fonts: { regular, bold, italic }, safe, wrap, logo: await embedLogo(doc, logo), orgName: meta?.orgName })
    return finish(doc, regular, meta)
  }
  let page, y
  const newPage = () => { page = doc.addPage([W, H]); y = H - M }
  const need = (h) => { if (y - h < M + 24) newPage() }
  const text = (s, { font = regular, size = 11, color = INK, x = M, width = W - 2 * M, gap = 3 } = {}) => {
    for (const line of wrap(s, font, size, width)) {
      need(size + gap)
      page.drawText(line, { x, y: y - size, size, font, color })
      y -= size + gap
    }
  }

  newPage()
  text(meta?.orgName || 'ASPIRE Intelligence', { font: bold, size: 9, color: NAVY })
  y -= 6
  text(definition.title, { font: bold, size: 18 })
  if (definition.description) { y -= 2; text(definition.description, { size: 10.5, color: MUTED }) }
  y -= 8
  const when = new Date(meta?.submittedAt || Date.now()).toLocaleString('en-US', { timeZone: meta?.timeZone || 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  text(`Submitted by ${who?.name || ''}${who?.email ? ` (${who.email})` : ''} on ${when}.`, { size: 10, color: MUTED })
  need(16); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 1, color: RULE }); y -= 18

  for (const q of definition.questions || []) {
    if (q.type === 'section') { y -= 6; text(q.label, { font: bold, size: 12.5, color: NAVY }); if (q.help) text(q.help, { size: 9.5, color: MUTED }); y -= 4; continue }
    if (!takesAnswer(q)) continue
    need(40)
    text(`${q.label}${q.required ? ' *' : ''}`, { font: bold, size: 10.5 })
    const v = answers?.[q.id]
    if (q.type === 'signature' && v?.kind === 'draw' && v.path) {
      need(64)
      page.drawSvgPath(v.path, { x: M, y: y - 4, scale: 1.8, borderColor: INK, borderWidth: 1.2 })
      y -= 58
      if (v.text) text(v.text, { size: 9.5, color: MUTED })
    } else if (q.type === 'signature' && v?.kind === 'type') {
      text(v.text, { font: italic, size: 20, gap: 6 })
    } else {
      const a = answerText(q, v)
      text(a || 'No answer', { size: 11, color: a ? INK : MUTED })
    }
    if (q.help && q.type === 'signature') text(q.help, { size: 9, color: MUTED })
    y -= 10
  }

  return finish(doc, regular, meta)
}

async function finish(doc, regular, meta) {
  const pages = doc.getPages()
  pages.forEach((p, i) => p.drawText(safe(`Submission ${meta?.submissionId || ''} · form version ${meta?.version ?? ''} · page ${i + 1} of ${pages.length}`),
    { x: M, y: 30, size: 8, font: regular, color: MUTED }))
  return Buffer.from(await doc.save())
}
