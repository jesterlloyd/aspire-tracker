// src/lib/documents/resumeReviewModel.js
//
// RESUME-REVIEW-1 (résumé review build, Phase 3): the rules around Keith's résumé review.
// Pure, read by the server (to clean what Keith returned) and by the review drawer (to show
// it), so the two cannot disagree.
//
// OBJECTIVE BY CONSTRUCTION (Owner, 2026-10-04: "rubric-based and objective"). Keith scores
// the six categories against the rubric; the composite and the readiness classification are
// then COMPUTED here from those six numbers, never taken from the model's arithmetic or its
// impression. The same six scores always give the same composite and the same readiness.

export const CATEGORIES = Object.freeze([
  Object.freeze({ key: 'ats', label: 'ATS Optimization' }),
  Object.freeze({ key: 'alignment', label: 'Cedars-Sinai Nursing Alignment' }),
  Object.freeze({ key: 'aspire', label: 'ASPIRE Positioning' }),
  Object.freeze({ key: 'clinical', label: 'Clinical Experience' }),
  Object.freeze({ key: 'leadership', label: 'Leadership and Professionalism' }),
  Object.freeze({ key: 'competitiveness', label: 'Overall NGRP Competitiveness' }),
])
export const CATEGORY_KEYS = Object.freeze(CATEGORIES.map(c => c.key))

export const READINESS = Object.freeze(['Highly Competitive', 'Competitive', 'Needs Improvement'])
// A category at or below this reads amber in the bars.
export const LOW_CATEGORY = 6

export const MISSING_INFO = Object.freeze([
  Object.freeze({ key: 'graduation_date', label: 'Graduation date', ask: 'your anticipated graduation date' }),
  Object.freeze({ key: 'bls_status', label: 'BLS status', ask: 'your BLS (AHA) certification and when it expires' }),
  Object.freeze({ key: 'aspire_participation', label: 'ASPIRE participation', ask: 'your ASPIRE rotation, by name' }),
  Object.freeze({ key: 'clinical_rotation_hours', label: 'Clinical rotation hours', ask: 'each clinical rotation with its facility, unit and hours' }),
  Object.freeze({ key: 'unit_placements', label: 'Unit placements', ask: 'the units you rotated on' }),
  Object.freeze({ key: 'gpa', label: 'GPA', ask: 'your GPA' }),
])
export const MISSING_KEYS = Object.freeze(MISSING_INFO.map(m => m.key))
export const missingLabel = key => MISSING_INFO.find(m => m.key === key)?.label || key

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
}
const text = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v, max, each = 600) => (Array.isArray(v) ? v.map(x => text(x, each)).filter(Boolean).slice(0, max) : [])

// The composite: the six scores summed, times 10, over 6, rounded. Null unless all six exist.
export function compositeScore(categories) {
  const vals = CATEGORY_KEYS.map(k => categories?.[k]?.score)
  if (vals.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) * 10) / 6)
}

// The classification, from the rubric's thresholds. Any category at 3 or below is a red flag.
export function readinessFor(categories) {
  const score = compositeScore(categories)
  if (score == null) return null
  const min = Math.min(...CATEGORY_KEYS.map(k => categories[k].score))
  if (min <= 3) return 'Needs Improvement'
  if (score >= 80 && min >= 6) return 'Highly Competitive'
  if (score >= 65) return 'Competitive'
  return 'Needs Improvement'
}

// Keith's JSON, validated by the runner's schema, to what is stored. Throws when a category
// score is missing, so an incomplete review is dropped rather than shown.
export function parseReview(json) {
  const categories = {}
  for (const k of CATEGORY_KEYS) {
    const c = json?.categories?.[k]
    const score = clampInt(c?.score, 0, 10)
    if (score == null) throw Object.assign(new Error(`missing category ${k}`), { code: 'incomplete_review' })
    categories[k] = { score, note: text(c?.note, 600) }
  }
  const fixes = (Array.isArray(json?.top_fixes) ? json.top_fixes : [])
    .map(f => ({ fix: text(f?.fix, 400), quote: text(f?.quote, 240) || null }))
    .filter(f => f.fix)
    .slice(0, 3)
  const missing = MISSING_KEYS.filter(k => Array.isArray(json?.missing_info) && json.missing_info.includes(k))
  const rec = json?.recommendations || {}
  return {
    score: compositeScore(categories),
    readiness: readinessFor(categories),
    model_score: clampInt(json?.score, 0, 100),
    model_readiness: READINESS.includes(json?.readiness) ? json.readiness : null,
    categories,
    readiness_reason: text(json?.readiness_reason, 800),
    summary: text(json?.summary, 600),
    strengths: list(json?.strengths, 5),
    top_fixes: fixes,
    missing_info: missing,
    full_report: {
      section_review: (Array.isArray(json?.section_review) ? json.section_review : [])
        .map(s => ({ section: text(s?.section, 80), comment: text(s?.comment, 800) })).filter(s => s.section && s.comment).slice(0, 12),
      rewritten_bullets: (Array.isArray(json?.rewritten_bullets) ? json.rewritten_bullets : [])
        .map(b => ({ original: text(b?.original, 600), rewrite: text(b?.rewrite, 800) })).filter(b => b.rewrite).slice(0, 5),
      keywords: list(json?.keywords, 14, 80),
      recruiter_perspective: text(json?.recruiter_perspective, 1200),
      recommendations: {
        before_submitting: list(rec.before_submitting, 8),
        consider_adding: list(rec.consider_adding, 8),
        do_not_include: list(rec.do_not_include, 8),
        interview_prep: list(rec.interview_prep, 8),
      },
    },
    draft: { subject: text(json?.draft?.subject, 160) || 'Feedback on your résumé', body: text(json?.draft?.body, 4000) },
  }
}

// ── The draft email ─────────────────────────────────────────────────────────

// RESUME-FEEDBACK-1 (Owner, 2026-10-05: "show words, not the number"): the optional sentence
// names their readiness in words. A student never reads a score out of 100.
export const scoreSentence = (score, readiness) => {
  if (!readiness) return ''
  return readiness === 'Highly Competitive'
    ? 'On the ASPIRE résumé rubric, your résumé reads as Highly Competitive.'
    : `On the ASPIRE résumé rubric, your résumé reads as ${readiness} for now.`
}

// Where their full feedback is: the Student Portal's Residency tab, shared when this is sent.
export const portalFeedbackLine = (url) =>
  `Your full feedback, with what is working in each area, rewritten bullets you can adapt and a checklist for before you apply, is in the Student Portal under Residency: ${url}`

export function bulletsSection(bullets = []) {
  const rows = bullets.filter(b => b?.rewrite)
  if (!rows.length) return ''
  return ['A few rewritten bullets you can adapt:', ...rows.map(b => `- ${b.rewrite}`)].join('\n')
}

// RESUME-DRAFT-OPENING-1 (Owner, 2026-10-05): the email opens by thanking them for the résumé
// and saying what was done with it, before any feedback. "Sending" when it reached the team,
// "uploading" when they put it in the Student Portal themselves (the version's uploaded_via).
export function openingLine(uploadedVia = null) {
  return `Thank you for ${uploadedVia === 'portal' ? 'uploading' : 'sending'} your résumé. I've reviewed it and run it against our ASPIRE résumé rubric. Here is my feedback.`
}
// Keith may already thank them; the opening is then not added a second time.
const THANKS = /^thank you for (sending|uploading|sharing|submitting)\b/i
const GREETING = /^(hi|hello|dear|good (morning|afternoon|evening))\b/i

export function signOff({ name, credentials } = {}) {
  const who = [name, credentials].map(x => String(x || '').trim()).filter(Boolean).join(', ')
  return who ? `Warmly,\n${who}` : 'Warmly,'
}

// The email: Keith's body (greeting, the opening line, then their strengths, then the priorities), with the readiness
// sentence AFTER their strengths when "Include readiness" is on (RESUME-FEEDBACK-1: the strengths
// come first, never a verdict), the rewritten bullets when that box is on, the line to their full
// feedback when there is a link, and the reviewer's own sign-off. Each box changes only its part.
export function composeDraft({ body = '', score = null, readiness = null, includeScore = false, bullets = [], includeBullets = false, portalUrl = null, sender = {}, uploadedVia = null } = {}) {
  const paras = String(body).trim().split(/\n{2,}/).filter(Boolean)
  const out = [...paras]
  if (includeScore && readiness) out.splice(Math.min(2, out.length), 0, scoreSentence(score, readiness))
  // The opening goes right after the greeting (first, when there is none).
  if (!paras.some(p => THANKS.test(p.trim()))) out.splice(GREETING.test(out[0] || '') ? 1 : 0, 0, openingLine(uploadedVia))
  if (includeBullets) {
    const b = bulletsSection(bullets)
    if (b) out.push(b)
  }
  if (portalUrl) out.push(portalFeedbackLine(portalUrl))
  out.push(signOff(sender))
  return out.join('\n\n')
}

// "Ortiz, Maya · Résumé score 72/100 (Competitive), Oct 4, 2026"
export function copyScoreLine({ name, score, readiness, when }) {
  return `${name} · Résumé score ${score}/100${readiness ? ` (${readiness})` : ''}${when ? `, ${when}` : ''}`
}

// The change since the review before, newest first in `history` (scored reviews only).
export function scoreChange(history = []) {
  const scored = history.filter(h => typeof h.score === 'number')
  if (scored.length < 2) return null
  return scored[0].score - scored[1].score
}

// Split résumé text into plain and highlighted runs for the top fixes' quotes. A quote that
// does not occur exactly is simply not highlighted (Keith is told to copy exactly; the app
// never guesses where a paraphrase belongs).
export function highlightRuns(source = '', quotes = []) {
  const marks = []
  for (const [i, q] of quotes.entries()) {
    if (!q) continue
    const at = source.indexOf(q)
    if (at >= 0 && !marks.some(m => at < m.end && at + q.length > m.start)) marks.push({ start: at, end: at + q.length, fix: i + 1 })
  }
  marks.sort((a, b) => a.start - b.start)
  const runs = []
  let pos = 0
  for (const m of marks) {
    if (m.start > pos) runs.push({ text: source.slice(pos, m.start) })
    runs.push({ text: source.slice(m.start, m.end), fix: m.fix })
    pos = m.end
  }
  if (pos < source.length) runs.push({ text: source.slice(pos) })
  return runs
}

// A review still "scoring" this long after it started did not finish (the function timed out
// or the tab closed mid-run on a host that stopped it). It reads as Failed, with Retry.
export const STALE_SCORING_MS = 4 * 60 * 1000
export function reviewState(review, now = Date.now()) {
  if (!review) return 'none'
  if (review.status === 'scoring' && now - new Date(review.requested_at).getTime() > STALE_SCORING_MS) return 'failed'
  return review.status
}

// The tracker: Uploaded → Scored → Send via Outreach → Logged as support.
export function trackerSteps(review, version) {
  const state = reviewState(review)
  const sent = state === 'sent'
  return [
    { key: 'uploaded', label: 'Uploaded', done: Boolean(version), at: version?.uploaded_at || null },
    { key: 'scored', label: 'Scored', done: state === 'scored' || sent, at: review?.scored_at || null },
    { key: 'send', label: 'Send via Outreach', done: sent, at: review?.sent_at || null },
    { key: 'logged', label: 'Logged as support', done: sent, at: review?.sent_at || null },
  ].map((s, i, all) => ({ ...s, current: !s.done && all.slice(0, i).every(p => p.done) }))
}
