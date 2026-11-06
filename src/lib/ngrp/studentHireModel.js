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

// HIRED-TAG-1 (Owner, 2026-11-05): the tag beside the Completed pill. The ASPIRE status stays
// Completed; this says what happened next. "Hired · 6 NE · CN I", or "Separated · 6 NE" once a
// separation is recorded. Null when there is no hire.
export const HIRE_TAG_TONES = Object.freeze({
  hired:     { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  separated: { bg: '#f3f4f6', text: '#4b5563', border: '#d1d5db' },
})
export function hireTag(h) {
  if (!h || !h.hired_at) return null
  const tone = h.affiliated === false ? 'separated' : 'hired'
  const parts = [tone === 'hired' ? 'Hired' : 'Separated', h.unit, tone === 'hired' ? h.hired_as_label : null].filter(Boolean)
  const title = [`Residency hire${h.cohort_name ? `, ${h.cohort_name}` : ''}`, fmtHireDay(h.hired_at) && `hired ${fmtHireDay(h.hired_at)}`].filter(Boolean).join(', ')
  return { label: parts.join(' · '), short: tone === 'hired' ? 'Hired' : 'Separated', tone, colors: HIRE_TAG_TONES[tone], title }
}
