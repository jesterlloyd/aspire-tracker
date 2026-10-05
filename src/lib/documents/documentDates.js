// src/lib/documents/documentDates.js
//
// RESUME-REVIEW-1 (Owner, 2026-10-04: "I don't even know if I need AI for the rest of the
// documents ... maybe automatically records the dates"). No Keith here. When a staff member
// picks a PDF with real text (an AHA eCard, an unofficial transcript), the browser reads that
// text and looks for the one date the document type needs, and PRE-FILLS it. Staff still
// check it against the file and tick the box; a photo or a scan simply finds nothing.
//
// detectDocumentDate is pure and tested. readPdfText loads PDF.js (bundled in unpdf) lazily,
// so no other screen pays for it.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = n => String(n).padStart(2, '0')
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// The words that introduce the date, by what the type needs. Order is preference.
const LABELS = {
  expiry_date: [
    'recommended renewal date', 'renewal date', 'expiration date', 'expiry date', 'date of expiration',
    'expiration', 'expires on', 'expires', 'valid through', 'valid until', 'valid thru',
  ],
  completion_date: [
    'degree conferred', 'date conferred', 'conferral date', 'degree awarded', 'awarded on', 'date awarded',
    'expected graduation date', 'anticipated graduation date', 'graduation date', 'expected graduation',
    'anticipated graduation', 'completion date', 'date of completion', 'program completion',
  ],
}

const DATE_PATTERNS = [
  // 2028-05-31
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})/, to: m => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 05/31/2028, 5-31-2028
  { re: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/, to: m => [Number(m[3]), Number(m[1]), Number(m[2])] },
  // 05/2028 (an eCard's month and year: valid through the end of that month)
  { re: /^(\d{1,2})[/.-](\d{4})\b/, to: m => [Number(m[2]), Number(m[1]), null] },
  // May 31, 2028 / May 31 2028
  { re: /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i, to: m => [Number(m[3]), MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2])] },
  // 31 May 2028
  { re: /^(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/i, to: m => [Number(m[3]), MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1])] },
  // May 2028
  { re: /^([a-z]{3,9})\.?,?\s+(\d{4})/i, to: m => [Number(m[2]), MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()], null] },
]

function parseDateAt(s) {
  for (const p of DATE_PATTERNS) {
    const m = p.re.exec(s)
    if (!m) continue
    const [y, mo, d] = p.to(m)
    if (!y || !mo || mo < 1 || mo > 12 || y < 1990 || y > 2100) continue
    const day = d == null ? lastDay(y, mo) : d
    if (day < 1 || day > lastDay(y, mo)) continue
    return { date: `${y}-${pad(mo)}-${pad(day)}`, monthOnly: d == null, raw: m[0] }
  }
  return null
}

/**
 * The date a document's text gives for this check, or null.
 * Returns { date: 'YYYY-MM-DD', label, raw, monthOnly } where `label` is the words found and
 * `raw` the date as printed, so the screen can say where it came from.
 */
export function detectDocumentDate(text, checkKind) {
  const labels = LABELS[checkKind]
  if (!labels || !text) return null
  const flat = String(text).replace(/\s+/g, ' ')
  const lower = flat.toLowerCase()
  for (const label of labels) {
    let from = 0
    for (;;) {
      const at = lower.indexOf(label, from)
      if (at < 0) break
      // The date follows within a few characters (a colon, a line break, a dash).
      const after = flat.slice(at + label.length, at + label.length + 40).replace(/^[\s:–—-]+/, '')
      const found = parseDateAt(after)
      if (found) return { ...found, label: flat.slice(at, at + label.length) }
      from = at + label.length
    }
  }
  return null
}

let pdfjs = null
// The text of a PDF the person just picked, read in their browser. Null for anything else,
// or when the PDF has no text layer (a scan).
export async function readPdfText(file, { maxBytes = 10 * 1024 * 1024 } = {}) {
  if (!file || file.size > maxBytes || !/\.pdf$/i.test(file.name || '')) return null
  try {
    pdfjs ||= import('unpdf')
    const { getDocumentProxy, extractText } = await pdfjs
    const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
    const { text } = await extractText(doc, { mergePages: true })
    return typeof text === 'string' && text.trim() ? text : null
  } catch {
    return null
  }
}
