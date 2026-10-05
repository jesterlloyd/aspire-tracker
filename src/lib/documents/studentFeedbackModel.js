// src/lib/documents/studentFeedbackModel.js
//
// RESUME-FEEDBACK-1 (Owner, 2026-10-05): what an alumnus sees of Keith's résumé review, in the
// Student Portal's Residency tab, once the review was SENT to them. Owner: "show words, not the
// number". So:
//   - each of the six areas is a WORD (Strong, Solid, Developing, Needs work), never x/10;
//   - readiness is its word and what reaching the next level takes, never 58 of 100;
//   - "ASPIRE Positioning: Developing → Solid" against the review shared before it;
//   - any number Keith wrote into a note ("6/10", "scored 58") is taken out before it is shown.
// The draft, the staff's edits, the résumé text, the provenance and Keith's own arithmetic never
// leave the server; this module builds the one shape that does, field by field.
import { CATEGORIES, MISSING_INFO } from './resumeReviewModel.js'

// The words, from the rubric's anchors (9 to 10, 7 to 8, 5 to 6, below 5).
export const LEVELS = Object.freeze([
  Object.freeze({ key: 'strong', label: 'Strong', min: 9 }),
  Object.freeze({ key: 'solid', label: 'Solid', min: 7 }),
  Object.freeze({ key: 'developing', label: 'Developing', min: 5 }),
  Object.freeze({ key: 'needs_work', label: 'Needs work', min: 0 }),
])
export function levelFor(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  return LEVELS.find(l => n >= l.min) || LEVELS[LEVELS.length - 1]
}
const rank = key => LEVELS.length - LEVELS.findIndex(l => l.key === key)

// What each readiness level means for the alumnus, and what the next one asks. In words, from the same
// thresholds the app computes readiness with (resumeReviewModel.readinessFor).
export const READINESS_WORDS = Object.freeze({
  'Highly Competitive': {
    meaning: 'Your résumé is polished and aligned with what the New Graduate RN Residency Program looks for.',
    next: 'Keep it current as your rotation and certifications change.',
  },
  Competitive: {
    meaning: 'Your résumé is solid. A few focused changes would make it stand out.',
    next: 'To reach Highly Competitive: bring most areas to Solid or Strong, with none below Developing.',
  },
  'Needs Improvement': {
    meaning: 'You have a foundation to build on. Revise it before you apply.',
    next: 'To reach Competitive: lift any area marked Needs work, and bring more areas to Solid.',
  },
})

// Keith wrote these notes for staff, and a note may state a score ("Strong scan (8/10).",
// "Scored 58 overall."). A bracketed score is taken out; a SENTENCE that states a score is
// dropped whole, because a sentence with its number cut out reads as nonsense. Other numbers
// (hours, years, a unit such as 5 North) stay.
const BRACKETED = /\s*\(\s*\d{1,3}\s*(?:\/|out of|of)\s*(?:10|100)\s*\)/gi
const STATES_SCORE = /\b\d{1,3}\s*(?:\/|out of)\s*(?:10|100)\b|\b\d{1,3}\s+of\s+100\b|\b(?:scores?|scored|rated)\s+(?:an?\s+)?\d{1,3}\b/i
export function stripScores(text) {
  const t = String(text || '').replace(BRACKETED, '').trim()
  if (!t) return ''
  const sentences = t.match(/[^.!?]+[.!?]*\s*/g) || [t]
  return sentences.filter(x => !STATES_SCORE.test(x)).join('').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim()
}
const clean = list => (Array.isArray(list) ? list.map(stripScores).filter(Boolean) : [])

/**
 * The feedback an alumnus sees, from the latest SENT review and the one shared before it.
 * Returns null when nothing has been sent. `reviews` are newest first, sent only.
 */
export function studentFeedback(reviews = []) {
  const [latest, previous] = reviews
  if (!latest) return null
  const r = latest.full_report || {}
  const areas = CATEGORIES.map((c) => {
    const now = levelFor(latest.categories?.[c.key]?.score)
    const before = previous ? levelFor(previous.categories?.[c.key]?.score) : null
    return {
      key: c.key, label: c.label,
      level: now?.label || null, levelKey: now?.key || null,
      note: stripScores(latest.categories?.[c.key]?.note),
      was: before && now && before.key !== now.key ? before.label : null,
      direction: before && now && before.key !== now.key ? (rank(now.key) > rank(before.key) ? 'up' : 'down') : null,
    }
  })
  const words = READINESS_WORDS[latest.readiness] || null
  return {
    shared_at: latest.sent_at || latest.scored_at || null,
    previous_shared_at: previous ? (previous.sent_at || previous.scored_at || null) : null,
    readiness: latest.readiness || null,
    readiness_was: previous && previous.readiness !== latest.readiness ? previous.readiness : null,
    meaning: words?.meaning || null,
    next: words?.next || null,
    summary: stripScores(latest.summary),
    strengths: clean(latest.strengths),
    areas,
    priorities: (latest.top_fixes || []).map(f => stripScores(f?.fix)).filter(Boolean),
    missing: (latest.missing_info || []).map(k => MISSING_INFO.find(m => m.key === k)?.label).filter(Boolean),
    sections: (r.section_review || []).map(s => ({ section: s.section, comment: stripScores(s.comment) })).filter(s => s.comment),
    bullets: (r.rewritten_bullets || []).map(b => ({ original: b.original || '', rewrite: stripScores(b.rewrite) })).filter(b => b.rewrite),
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    recruiter: stripScores(r.recruiter_perspective),
    checklist: {
      before_submitting: clean(r.recommendations?.before_submitting),
      consider_adding: clean(r.recommendations?.consider_adding),
      do_not_include: clean(r.recommendations?.do_not_include),
      interview_prep: clean(r.recommendations?.interview_prep),
    },
  }
}
