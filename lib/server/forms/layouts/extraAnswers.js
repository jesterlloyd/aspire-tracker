// lib/server/forms/layouts/extraAnswers.js
//
// A paper layout has a box for each question it was drawn for. A question someone adds in the
// builder afterwards has none, so its answer is listed on a page after the form's own, in form
// order, and never dropped. Shared by every layout.

import { rgb } from 'pdf-lib'
import { answerText, takesAnswer } from '../../../../src/lib/forms/formModel.js'

const GREY = rgb(119 / 255, 117 / 255, 111 / 255)
const INK = rgb(0.07, 0.1, 0.2)

export function appendExtraAnswers({ definition, answers, placed }, { doc, fonts, wrap }) {
  const { regular, bold } = fonts
  const extra = (definition.questions || []).filter(q => takesAnswer(q) && !placed.has(q.id) && answerText(q, answers?.[q.id]))
  if (!extra.length) return
  let p = doc.addPage([612, 792]), y = 792 - 54
  const line = (s, font, size, color) => {
    for (const l of wrap(s, font, size, 504)) {
      if (y < 72) { p = doc.addPage([612, 792]); y = 792 - 54 }
      p.drawText(l, { x: 54, y: y - size, size, font, color }); y -= size + 3
    }
  }
  line('Additional answers', bold, 12, GREY); y -= 6
  for (const q of extra) { line(q.label, bold, 9, GREY); line(answerText(q, answers[q.id]), regular, 10, INK); y -= 8 }
}
