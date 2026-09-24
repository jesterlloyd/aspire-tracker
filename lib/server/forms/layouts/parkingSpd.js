// lib/server/forms/layouts/parkingSpd.js
//
// PARKING-PDF-1 (2026-09-24): the Student Parking Request's filed PDF, drawn as Parking
// Services' own "Students Parking Data (SPD)" form (Owner: "redraw their layout"; their PDF
// is not committed, because this repository is public). Every position below was measured
// from their one-page letter form at 288 dpi and is in points from the TOP of the page, the
// way it was measured; `top()` turns it into pdf-lib's bottom-up y. Their fonts (Century
// Gothic, Segoe UI) are not shipped, so Helvetica stands in; their grey ink and pale blue
// boxes are theirs.
//
// A question the layout has no box for (someone added it in the builder) still reaches the
// PDF: it is listed on a second page, so an answer is never dropped. Their "Page 1 of 1"
// is left to the shared footer, which counts the pages this copy really has.

import { rgb } from 'pdf-lib'
import { answerText, formatDate, takesAnswer } from '../../../../src/lib/forms/formModel.js'

const H = 792
const GREY = rgb(119 / 255, 117 / 255, 111 / 255)
const FILL = rgb(222 / 255, 234 / 255, 242 / 255)
const INK = rgb(0.07, 0.1, 0.2)
const top = (t, h = 0) => H - t - h

// [question id or special key, x, top, width, height]
const BOXES = [
  ['badge', 42, 132, 123.2, 14.8], ['first_name', 177.5, 132, 123.2, 14.8], ['last_name', 313, 132, 123.2, 14.8], ['school', 448.5, 132, 123, 14.8],
  ['phone', 42, 164, 123.2, 15], ['email', 177.5, 164, 123.2, 15], ['building', 313, 164, 123.2, 15], ['department', 448.5, 164, 123, 15],
  ['@today', 448.5, 196, 123, 15],
  ['shift', 42, 313, 123.2, 14.8], ['status', 177.5, 313, 123.2, 14.8], ['start', 313, 313, 123.2, 14.8], ['end', 448.5, 313, 123, 14.8],
  ['duration', 313, 345, 123.2, 15], ['days', 448.5, 345, 123, 12.2],
  ['v1_make', 41, 413.5, 108, 16.5, 1], ['v1_color', 176.5, 413.5, 113.8, 16.5, 1], ['v1_state', 318, 413.5, 113.2, 16.5, 1], ['v1_plate', 459, 413.5, 113.5, 16.5, 1],
  ['v2_make', 41, 460.5, 108, 16.5, 1], ['v2_color', 176.5, 460.5, 113.8, 16.5, 1], ['v2_state', 318, 460.5, 113.2, 16.5, 1], ['v2_plate', 459, 460.5, 113.5, 16.5, 1],
  ['sig', 42, 600, 226, 18], ['@date', 301.5, 600, 143.2, 19.2],
  ['@lot', 42, 668.5, 123.2, 14.8], ['@dual', 177.5, 668.5, 123.2, 14.8], ['@lot2', 313, 668.5, 123.2, 14.8],
]
const YES_BOX = [66.5, 250, 45.5, 12.8]
const NO_BOX = [153, 249.5, 45.2, 12.5]

// [text, x, baseline top, bold?]
const LABELS = [
  ['Badge Number', 41.5, 129.4], ['First Name', 176.8, 129.4], ['Last Name', 312.4, 129.4], ['School Name', 447.7, 129.4],
  ['Telephone #', 41.5, 161.4], ['E-mail', 176.8, 161.4], ['Building', 312.4, 161.4], ['Department', 447.7, 161.4],
  ['Today’s Date', 447.7, 193.4],
  ['Shift: Days, Nights, Evenings', 41.5, 310.5], ['Status: FT/PT/PD', 176.8, 310.5], ['Start Date', 312.4, 310.5], ['End Date', 447.7, 310.5],
  ['Rotation Duration', 312.4, 342.5], ['Days of the Week', 447.7, 342.5],
  ['Vehicle # 1', 41.5, 394.5], ['Make/Model 1', 46, 411.2], ['Color', 181.8, 411.2], ['State', 322.9, 411.2], ['License Plate', 463.9, 411.2],
  ['Vehicle # 2', 46, 448.3], ['Make/Model 2', 46, 458], ['Color', 181.8, 458], ['State', 322.9, 458], ['License Plate', 463.9, 458],
  ['Signature', 41.5, 596.7], ['Date', 337.1, 596.7],
]
const SECTIONS = [['1. REQUESTOR INFORMATION', 109.6, 115.1], ['3. WORK SCHEDULE (An approximate time is acceptable)', 292.7, 296.1], ['4. VEHICLE INFORMATION', 377.7, 380.1], ['5. PARKING OFFICE USE ONLY', 642.8, null]]
const APP_NOTE = '*Cellphone can be added to profile and access to Parking APP will be granted. If you wish to have access to parking App, please check Yes or not below. (Instructions for App will be provided separate)'
const TERMS = [
  [496.6, 'I understand that parking is a benefit offered to students on a voluntary basis. I have read, understand, and agree to comply with the Cedars-Sinai Medical Center Parking Program rules and regulations as outlined in the Parking Guide that has been provided.'],
  [536.6, 'The Medical Center reserves the right to increase parking rates from time to time.'],
  [555.1, 'I understand that I will be advised of any increases in parking rates and that my continued use of parking privileges following such notice will consent to such increase.'],
]
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }

/** The questions this layout has a place for; a version without them keeps the plain PDF. */
export const PARKING_SPD_CORE = Object.freeze(['first_name', 'last_name', 'v1_plate', 'sig'])
export const fitsParkingSpd = (definition) => {
  const ids = new Set((definition?.questions || []).map(q => q.id))
  return PARKING_SPD_CORE.every(id => ids.has(id))
}

/**
 * Draws page one (and, when needed, a page of answers the layout has no box for).
 * ctx: { doc, fonts: { regular, bold, italic }, safe, wrap, logo (PDFImage|null), orgName }.
 */
export function drawParkingSpd({ definition, answers, meta }, { doc, fonts, safe, wrap, logo, orgName }) {
  const { regular, bold, italic } = fonts
  doc.setSubject('Students Parking Data (SPD)')
  const page = doc.addPage([612, H])
  const text = (s, x, baseline, { font = bold, size = 7.5, color = GREY } = {}) => page.drawText(safe(s), { x, y: H - baseline, size, font, color })
  const rule = (t) => page.drawLine({ start: { x: 34.5, y: H - t }, end: { x: 577.8, y: H - t }, thickness: 0.6, color: GREY })
  const box = (x, t, w, h, heavy) => page.drawRectangle({ x, y: top(t, h), width: w, height: h, color: FILL, borderColor: GREY, borderWidth: heavy ? 0.9 : 0.5 })
  const fill = (s, x, t, w, h) => {
    let size = Math.min(8.5, h - 5)
    let v = safe(s)
    while (size > 5.5 && regular.widthOfTextAtSize(v, size) > w - 6) size -= 0.25
    while (v.length > 1 && regular.widthOfTextAtSize(v, size) > w - 6) v = `${v.slice(0, -2)}…`
    page.drawText(v, { x: x + 3, y: top(t, h) + (h - size) / 2 + 1.2, size, font: regular, color: INK })
  }

  // Head: the organization's mark at the left, the form's name at the right, one rule.
  if (logo) {
    const h = 36, w = Math.min(130, logo.width * (h / logo.height))
    page.drawImage(logo, { x: 36, y: top(20, h), width: w, height: h })
  } else text(orgName || 'Cedars-Sinai', 36, 44, { size: 16, color: rgb(0.64, 0.1, 0.16) })
  const title = 'Students Parking Data (SPD)'
  text(title, 576.3 - bold.widthOfTextAtSize(title, 16), 72.4, { size: 16 })
  rule(78.6)
  text('Instructions:', 36, 88.5, { size: 8.5, color: INK })
  text(' Please fill all applicable content.', 36 + bold.widthOfTextAtSize('Instructions:', 8.5), 88.5, { font: regular, size: 8.5, color: INK })

  for (const [s, baseline, r] of SECTIONS) { text(s, 36, baseline, { size: 10 }); if (r) rule(r) }
  for (const [s, x, baseline] of LABELS) text(s, x, baseline)
  wrap(APP_NOTE, bold, 7.5, 540).forEach((line, i) => text(line, 36, 227.6 + i * 12.6))
  rule(242.9)
  text('Yes', 36, 259.9, { size: 10 }); text('No', 121.8, 259.9, { size: 10 })
  for (const [t, s] of TERMS) wrap(s, regular, 7.5, 540).forEach((line, i) => text(line, 36, t + i * 10.6, { font: regular }))
  for (const [s, x] of [['Lot Assignment', 41.5], ['Dual Access', 176.8], ['Additional Lot Assignment', 312.4]]) text(s, x, 662.4, { font: regular })

  // Boxes, then what the respondent answered in them.
  const byId = new Map((definition.questions || []).map(q => [q.id, q]))
  const when = meta?.submittedAt ? new Date(meta.submittedAt) : new Date()
  const today = when.toLocaleDateString('en-US', { timeZone: meta?.timeZone || 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric' })
  for (const [id, x, t, w, h, heavy] of BOXES) {
    box(x, t, w, h, heavy)
    if (id === '@today' || id === '@date') { fill(today, x, t, w, h); continue }
    const q = byId.get(id)
    if (!q) continue
    const v = answers?.[id]
    if (q.type === 'signature') {
      if (v?.kind === 'draw' && v.path) {
        const scale = Math.min((w - 8) / 100, (h - 2) / 30)
        page.drawSvgPath(v.path, { x: x + 4, y: top(t) - 1, scale, borderColor: INK, borderWidth: 0.9 })
      } else if (v?.kind === 'type' && v.text) {
        let size = 13
        while (size > 7 && italic.widthOfTextAtSize(safe(v.text), size) > w - 8) size -= 0.5
        page.drawText(safe(v.text), { x: x + 4, y: top(t, h) + 4, size, font: italic, color: INK })
      }
      continue
    }
    if (q.type === 'checkboxes' && id === 'days' && Array.isArray(v)) { fill(v.map(d => DAY_SHORT[d] || d).join(', '), x, t, w, h); continue }
    const a = q.type === 'date' ? formatDate(v) : answerText(q, v)
    if (a) fill(a, x, t, w, h)
  }
  box(...YES_BOX); box(...NO_BOX)
  const app = String(answers?.parking_app || '')
  const mark = app === 'Yes' ? YES_BOX : app === 'No' ? NO_BOX : null
  if (mark) page.drawText('X', { x: mark[0] + mark[2] / 2 - 3, y: top(mark[1], mark[3]) + 2.5, size: 9, font: bold, color: INK })

  // Anything the layout has no place for goes on a second page, in form order.
  const placed = new Set([...BOXES.map(b => b[0]), 'parking_app'])
  const extra = (definition.questions || []).filter(q => takesAnswer(q) && !placed.has(q.id) && answerText(q, answers?.[q.id]))
  if (extra.length) {
    let p = doc.addPage([612, H]), y = H - 54
    const line = (s, font, size, color) => {
      for (const l of wrap(s, font, size, 504)) {
        if (y < 72) { p = doc.addPage([612, H]); y = H - 54 }
        p.drawText(l, { x: 54, y: y - size, size, font, color }); y -= size + 3
      }
    }
    line('Additional answers', bold, 12, GREY); y -= 6
    for (const q of extra) { line(q.label, bold, 9, GREY); line(answerText(q, answers[q.id]), regular, 10, INK); y -= 8 }
  }
}

