// src/lib/pdf/pdfText.js
//
// Text helpers for pdf-lib's standard fonts, shared by the server (Forms' filed PDFs,
// lib/server/forms/formPdf.js) and the browser (the applicant packet,
// src/lib/ngrp/applicantPacketPdf.js). Pure: no Node, no DOM.

// WinAnsi covers Latin-1 plus a few typographic marks; anything else becomes "?".
const WIN_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
export const safe = (s) => [...String(s ?? '')].map(ch => {
  const c = ch.codePointAt(0)
  if (ch === '\n' || ch === '\t') return ch
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(ch)) return ch
  return '?'
}).join('')

export function wrap(text, font, size, width) {
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

