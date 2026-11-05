// STUDENT-HIRE-READ-1: the lines Student Profiles > Placement prints for one residency hire.
// Pure, so the words are tested without a browser.
import { dayOf } from './ngrpResidents.js'

export const fmtHireDay = d => {
  const day = dayOf(d)
  if (!day) return ''
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function hireLines(h) {
  return [
    ['Residency cohort', h.cohort_name || 'Not recorded'],
    ['Hired into unit', h.unit || 'Not recorded'],
    ['Hired as', h.hired_as_label || 'Not recorded'],
    ['Current title', h.current_title || 'Not recorded'],
    ['Hired on', fmtHireDay(h.hired_at) || 'Not recorded'],
    ['Still at Cedars-Sinai', h.affiliated ? 'Yes' : `No, separated ${fmtHireDay(h.separated_at)}`.trim()],
  ]
}
