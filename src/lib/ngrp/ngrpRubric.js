// src/lib/ngrp/ngrpRubric.js
//
// NGRP-INTERVIEWS-1 (Owner, 2026-10-05): the residency interview rubric, transcribed from the
// "Competency-Based Interview Rubric, New Graduate RN Interview Scoring Sheet" (Brawerman Nursing
// Institute, Cedars-Sinai). It is the internship rubric's shape (three domains, 1 to 5, a composite
// out of 15, three recommendations) with the new-graduate questions, so the same rubric book draws
// it. Pure: the Unit Leader Portal, the Residency binder, the server's validator and the tests read
// this one module.
//
// Question KEYS are what a rubric row stores (`cj_question`, ...). Never renumber a key: a stored
// rubric names the question its interviewer asked. A new edition adds keys.

export const NGRP_RUBRIC_TITLE = 'Competency-Based Interview Rubric'
export const NGRP_RUBRIC_SUBTITLE = 'New Graduate RN Interview Scoring Sheet'

export const SCORE_LEGEND = Object.freeze([
  { score: 1, label: 'Not Yet Ready', meaning: 'Vague, unclear, unsafe, or lacks insight' },
  { score: 2, label: 'Emerging', meaning: 'Some awareness present, but reasoning or insight is limited' },
  { score: 3, label: 'Competent', meaning: 'Appropriate, safe, and acceptable for entry-level RN practice' },
  { score: 4, label: 'Strong', meaning: 'Thoughtful, clear, demonstrates good judgment or maturity' },
  { score: 5, label: 'Highly Aligned / Practice-Ready', meaning: 'Insightful, reflective, well-articulated, strongly practice-ready' },
])

export const SCORING_NOTE =
  'Score each domain 1 to 5 for a composite of up to 15 points. Score the quality of the reasoning and the safety of the thinking, not whether the candidate has specific unit experience.'

export const OTHER_QUESTION = 'other'

export const NGRP_DOMAINS = Object.freeze([
  {
    key: 'cj', title: 'Clinical Judgment', reference: 'AACN Domain 1: Knowledge for Nursing Practice',
    focus: 'Independent decision-making, recognition of patient changes, and safe, timely action.',
    questions: [
      { key: 'cj1', text: 'Tell me about a time early in your RN practice where you had to make a quick decision on your own. What happened, and what did you do?' },
      { key: 'cj2', text: 'Describe a time a patient’s condition changed suddenly during your first role. How did you recognize it, and what actions did you take?' },
      { key: 'cj3', text: 'If two patients needed attention at once, one anxious and in pain and one with abnormal vital signs, how would you decide what to do first?' },
      { key: 'cj4', text: 'Tell me about a time you noticed something concerning in your early RN experience. What did you do, and what was the outcome?' },
      { key: 'cj5', text: 'What do you pay attention to first when you walk into a patient’s room, and why?' },
    ],
  },
  {
    key: 'pp', title: 'Professional Presence', reference: 'AACN Domains 6, 8, 9',
    focus: 'Communication, adaptability, accountability, and response to feedback and stress.',
    questions: [
      { key: 'pp1', text: 'Tell me about a time you received feedback from a preceptor or colleague during your transition. How did you handle it?' },
      { key: 'pp2', text: 'Describe a situation where you had to work with someone who had a different communication style. How did you adapt?' },
      { key: 'pp3', text: 'What do you do when you feel overwhelmed or unsure during a shift?' },
      { key: 'pp4', text: 'What has been one of the biggest challenges in your transition to RN practice, and how have you navigated it?' },
      { key: 'pp5', text: 'Tell me about a time you had to advocate for a patient or speak up during a shift.' },
    ],
  },
  {
    key: 'ga', title: 'Goal Alignment', reference: 'AACN Domain 10: Academic-Practice Partnerships',
    focus: 'Career goals, learning environment fit, and alignment with the unit and program.',
    questions: [
      { key: 'ga1', text: 'What are your career goals for the next year or two, and how does a residency program fit into those?' },
      { key: 'ga2', text: 'Tell me what kind of unit environment and team helps you learn and grow best, and why.' },
      { key: 'ga3', text: 'How do you see this residency program preparing you for success in your nursing career?' },
      { key: 'ga4', text: 'What drew you to Cedars-Sinai, and how do you see yourself contributing to this organization?' },
      { key: 'ga5', text: 'What personal strengths or qualities do you bring that make you a good fit for our unit and team?' },
    ],
  },
])

export const RECOMMENDATIONS = Object.freeze([
  { key: 'recommend', label: 'Recommend', meaning: 'Ready to move forward to hire.' },
  { key: 'recommend_with_reservations', label: 'Recommend with Reservations', meaning: 'Promising, with specific development needs to monitor.' },
  { key: 'do_not_recommend', label: 'Do Not Recommend at This Time', meaning: 'Not yet ready for this role.' },
])
export const RECOMMENDATION_KEYS = RECOMMENDATIONS.map(r => r.key)

// The sheet's interpretation ranges. "Practical interpretive guidance to support consistency,
// not validated cut scores. The final recommendation always rests with the panel and hiring leader."
export const COMPOSITE_RANGES = Object.freeze([
  { min: 13, max: 15, label: 'Highly Aligned / Practice-Ready', meaning: 'Strong and consistent across all three domains', recommendation: 'recommend' },
  { min: 10, max: 12.99, label: 'Strong / Competent', meaning: 'Ready, with the normal development expected of a new graduate', recommendation: 'recommend' },
  { min: 7, max: 9.99, label: 'Emerging / Mixed', meaning: 'Meets the bar in some areas with gaps in others', recommendation: 'recommend_with_reservations' },
  { min: 3, max: 6.99, label: 'Not Yet Ready', meaning: 'Significant readiness or safety concerns at this time', recommendation: 'do_not_recommend' },
])

// Panel rules from the sheet.
export const DIVERGENCE_POINTS = 4
export const CLOSER_LOOK_MAX = 2

export const recommendationLabel = key => RECOMMENDATIONS.find(r => r.key === key)?.label || ''
export const domainOf = key => NGRP_DOMAINS.find(d => d.key === key) || null
export const questionText = (domainKey, questionKey, other = '') => {
  if (!questionKey) return ''
  if (questionKey === OTHER_QUESTION) return other ? `Other: ${other}` : 'Other'
  return domainOf(domainKey)?.questions.find(q => q.key === questionKey)?.text || ''
}

const score = v => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null)

/** The composite of one rubric: the sum of three scores, null until all three are given. */
export function compositeOf(r) {
  const s = NGRP_DOMAINS.map(d => score(r?.[`${d.key}_score`]))
  return s.every(v => v !== null) ? s.reduce((a, b) => a + b, 0) : null
}

/** Where a composite (or a panel average) falls on the sheet's ranges. */
export function rangeFor(composite) {
  if (composite === null || composite === undefined || Number.isNaN(composite)) return null
  return COMPOSITE_RANGES.find(r => composite >= r.min && composite <= r.max) || null
}

/** Domains scored 1 or 2: "warrants a closer look and a brief discussion before a final decision". */
export function closerLookDomains(r) {
  return NGRP_DOMAINS.filter(d => { const v = score(r?.[`${d.key}_score`]); return v !== null && v <= CLOSER_LOOK_MAX }).map(d => d.key)
}

/** What a rubric still needs before it can be marked complete (the DB CHECK asks the same). */
export function missingForComplete(r) {
  const out = NGRP_DOMAINS.filter(d => score(r?.[`${d.key}_score`]) === null).map(d => `${d.title} score`)
  if (!RECOMMENDATION_KEYS.includes(r?.individual_recommendation)) out.push('Recommendation')
  return out
}

/**
 * The panel, from COMPLETED rubrics only: "Average the interviewers' composites and apply the
 * ranges above". Divergence: composites about 4 or more apart, or a split recommendation.
 */
export function panelSummary(rubrics = []) {
  const done = (rubrics || []).filter(r => r?.status === 'completed' && compositeOf(r) !== null)
  if (!done.length) return { count: 0, average: null, range: null, recommendation: null, domainAverages: {}, diverged: false, closerLook: [] }
  const composites = done.map(compositeOf)
  const average = Math.round((composites.reduce((a, b) => a + b, 0) / done.length) * 10) / 10
  const range = rangeFor(average)
  const recs = new Set(done.map(r => r.individual_recommendation).filter(Boolean))
  const domainAverages = Object.fromEntries(NGRP_DOMAINS.map(d => [d.key, Math.round((done.reduce((a, r) => a + r[`${d.key}_score`], 0) / done.length) * 10) / 10]))
  const closerLook = [...new Set(done.flatMap(closerLookDomains))]
  return {
    count: done.length, average, range,
    recommendation: range?.recommendation || null,
    domainAverages,
    diverged: Math.max(...composites) - Math.min(...composites) >= DIVERGENCE_POINTS || recs.size > 1,
    closerLook,
  }
}

const TEXT_LIMITS = { notes: 4000, other: 500, suggested_unit: 120, summary_comments: 4000 }
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null)

/**
 * The server's check of a rubric save. Partial: a field that is absent is left alone. Returns
 * { ok, fields, errors }. `status` 'completed' is refused while something it needs is missing.
 */
export function validateRubricSave(input, current = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const fields = {}
  const errors = []
  for (const d of NGRP_DOMAINS) {
    const q = src[`${d.key}_question`]
    if (q !== undefined) {
      if (q === null || q === '') fields[`${d.key}_question`] = null
      else if (q === OTHER_QUESTION || d.questions.some(x => x.key === q)) fields[`${d.key}_question`] = q
      else errors.push({ field: `${d.key}_question`, message: `Choose a ${d.title} question.` })
    }
    if (src[`${d.key}_question_other`] !== undefined) fields[`${d.key}_question_other`] = clean(src[`${d.key}_question_other`], TEXT_LIMITS.other) || null
    if (src[`${d.key}_score`] !== undefined) {
      const v = src[`${d.key}_score`]
      if (v === null || v === '') fields[`${d.key}_score`] = null
      else if (score(Number(v)) !== null) fields[`${d.key}_score`] = Number(v)
      else errors.push({ field: `${d.key}_score`, message: `${d.title} is scored 1 to 5.` })
    }
    if (src[`${d.key}_notes`] !== undefined) fields[`${d.key}_notes`] = clean(src[`${d.key}_notes`], TEXT_LIMITS.notes) || null
  }
  if (src.individual_recommendation !== undefined) {
    const v = src.individual_recommendation
    if (v === null || v === '') fields.individual_recommendation = null
    else if (RECOMMENDATION_KEYS.includes(v)) fields.individual_recommendation = v
    else errors.push({ field: 'individual_recommendation', message: 'Choose a recommendation.' })
  }
  if (src.suggested_unit !== undefined) fields.suggested_unit = clean(src.suggested_unit, TEXT_LIMITS.suggested_unit) || null
  if (src.summary_comments !== undefined) fields.summary_comments = clean(src.summary_comments, TEXT_LIMITS.summary_comments) || null
  if (src.status !== undefined) {
    if (!['in_progress', 'completed'].includes(src.status)) errors.push({ field: 'status', message: 'Unknown rubric state.' })
    else {
      fields.status = src.status
      if (src.status === 'completed') {
        const missing = missingForComplete({ ...current, ...fields })
        if (missing.length) errors.push({ field: 'status', message: `Still needed before it is complete: ${missing.join(', ')}.` })
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, fields }
}
