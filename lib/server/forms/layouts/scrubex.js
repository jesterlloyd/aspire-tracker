// lib/server/forms/layouts/scrubex.js
//
// SCRUBEX-PAPER-1 (2026-09-24): the ScrubEx request is filed ON Linen Services' own
// "Cedars-Sinai scrubEx Policy" PDF, chosen from the Catalog like the Parking form's.
//
// Their PDF looks fillable but is not, reliably: it was re-saved on an iPhone, and the form's
// fields now point at widget objects that are not on the page, while the boxes on the page
// are separate copies. Filling the fields shows nothing. So, like Parking, each answer is
// typed at its box's position (the page widgets' own rectangles, read from their file), the
// size box is marked, an X goes in each chosen row of the printed machine table (measured at
// 288 dpi), and the page's form widgets and the form itself are removed so an empty field
// can never sit over an answer. Department Name's printed "Nursing Education" was whited out
// with an iPhone markup square, which would sit over a typed answer too, so that square is
// removed and the same white patch is painted into the page underneath the answer instead.
//
// Unlike Parking, there is no redrawn copy. Without their PDF on file the plain PDF is used.

import { PDFDict, PDFName, rgb } from 'pdf-lib'
import { formatDate, SCRUB_SIZES, SCRUB_MACHINES } from '../../../../src/lib/forms/formModel.js'
import { appendExtraAnswers } from './extraAnswers.js'

/** SHA-256 of Linen Services' form as the Owner supplied it (ScrubEx Request Form.pdf, revised 102319). */
export const SCRUBEX_SHA256 = '0e585172a38850c77af6acd4b8f2dee0ae366f2d4d5e12010d2268c365cb748a'

export const SCRUBEX_CORE = Object.freeze(['initial', 'last_name', 'first_name', 'size'])
export const fitsScrubex = (definition) => {
  const ids = new Set((definition?.questions || []).map(q => q.id))
  return SCRUBEX_CORE.every(id => ids.has(id))
}

// Question id -> the box on their page, [x, y, width, height] in PDF points (bottom-up), and the
// largest type size that box takes.
const TEXT_BOXES = [
  ['initial', [101.1, 417.9, 55.7, 15.9], 11], ['last_name', [237.8, 417.9, 113.3, 16.3], 11], ['first_name', [415.9, 418.0, 119.0, 16.3], 11],
  ['department', [175.4, 393.5, 138.0, 16.3], 11], ['occupation', [390.8, 393.5, 119.0, 16.3], 11], ['barcode', [276.6, 368.7, 155.7, 16.3], 10], ['badge_exp', [487.7, 368.9, 55.3, 16.3], 8.5],
]
// SCRUB_SIZES in order -> that size's box.
const SIZE_BOXES = [[187.1, 331.1], [187.1, 317.5], [187.1, 304.4], [187.1, 290.8], [295.1, 331.1], [295.1, 317.8], [295.1, 304.4]]
const SIZE_BOX = { w: 13.6, h: 10.6 }
// SCRUB_MACHINES in order -> the top of that row in the Scrubs column (points from the page top).
const MACHINE_ROW_TOP = [555, 569, 582.8, 596.5, 610.7, 625, 638.8, 652.5]
const MACHINE_ROW_H = 13.8
const MACHINE_BOX = { x: 181, w: 15.5 }
const INK = rgb(0.07, 0.1, 0.2)

// The iPhone markup square over "Nursing Education" (its rectangle on their file).
const WHITEOUT = [169.2, 393.1, 123.3, 22.1]
const overlaps = (r, [x, y, w, h]) => r && r[0] < x + w && r[2] > x && r[1] < y + h && r[3] > y

/** Take the form out (widgets off the page, AcroForm off the document) and the white-out square. */
function removeForm(doc, page) {
  const annots = page.node.Annots()
  if (annots) {
    for (let i = annots.size() - 1; i >= 0; i--) {
      const d = doc.context.lookup(annots.get(i))
      if (!(d instanceof PDFDict)) continue
      const type = String(d.get(PDFName.of('Subtype')))
      const rect = d.get(PDFName.of('Rect'))?.asRectangle?.()
      const r = rect ? [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] : null
      if (type === '/Widget') annots.remove(i)
      else if (type === '/Square' && overlaps(r, WHITEOUT)) {
        annots.remove(i)
        const [x, y, w, h] = WHITEOUT
        page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) })
      }
    }
  }
  doc.catalog.delete(PDFName.of('AcroForm'))
}

export function fillScrubex({ definition, answers }, { doc, fonts, safe, wrap, paper }) {
  if (!paper) throw new Error('The ScrubEx layout prints only on Linen Services\' own PDF.')
  doc.setSubject('Cedars-Sinai scrubEx Policy')
  const { regular, bold } = fonts
  const page = doc.getPage(0)
  removeForm(doc, page)
  const H = page.getHeight()
  const byId = new Map((definition.questions || []).map(q => [q.id, q]))

  for (const [id, [x, y, w, h], max] of TEXT_BOXES) {
    const q = byId.get(id)
    if (!q) continue
    let v = safe(q.type === 'date' ? formatDate(answers?.[id]) : String(answers?.[id] ?? '')).trim()
    if (!v) continue
    let size = max
    while (size > 6 && regular.widthOfTextAtSize(v, size) > w - 4) size -= 0.25
    while (v.length > 1 && regular.widthOfTextAtSize(v, size) > w - 4) v = `${v.slice(0, -2)}\u2026`
    page.drawText(v, { x: x + 2, y: y + (h - size) / 2 + 1.5, size, font: regular, color: INK })
  }

  const si = SCRUB_SIZES.indexOf(answers?.size)
  if (si >= 0) {
    const [x, y] = SIZE_BOXES[si]
    page.drawText('X', { x: x + SIZE_BOX.w / 2 - 3.3, y: y + 1.6, size: 10, font: bold, color: INK })
  }

  // The machine table is printed: an X in the box beside each chosen row.
  const chosen = new Set(Array.isArray(answers?.machines) ? answers.machines : [])
  SCRUB_MACHINES.forEach((m, i) => {
    if (!chosen.has(m)) return
    const t = MACHINE_ROW_TOP[i]
    page.drawText('X', { x: MACHINE_BOX.x + MACHINE_BOX.w / 2 - 3.3, y: H - t - MACHINE_ROW_H + 3.4, size: 10, font: bold, color: INK })
  })

  appendExtraAnswers({ definition, answers, placed: new Set([...TEXT_BOXES.map(f => f[0]), 'size', 'machines']) }, { doc, fonts, wrap })
}
