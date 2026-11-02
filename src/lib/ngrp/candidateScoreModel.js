// CANDIDATE-SCORE-1 (Owner, 2026-11-01): one number per applicant to help Talent Acquisition
// decide who to pair with which unit for an interview. The rule is the app's, never the model's:
// four factors with fixed points, added up here, so the same record always gives the same score.
// Keith rates only the statements (three 0 to 10 ratings) and writes the reasons; this module turns
// every rating into points. Pure: the server builds the score with it and the screens print it.
//
//   Unit fit           20  rotated in a unit they ranked: 1st 20, 2nd 15, 3rd 10
//   Preceptor feedback 30  the six competency ratings from the latest feedback, scaled
//   Résumé             25  Keith's latest résumé composite, scaled
//   Statement          25  Keith's three statement ratings, summed and scaled
//
// A factor with nothing on file is left out and the rest are scaled to 100, so a missing piece
// never counts as a low one; the score says how many factors it stands on. Fewer than two is not
// enough to score. Eligibility is a gate, not points: an ineligible applicant reads Not eligible.
// Preceptor feedback counts only once the Transition Form is submitted, the consent that shares
// it (FEEDBACK-CONSENT-1), so the ASPIRE team and Talent Acquisition always see the same number.
import { unitNameKey } from '../unitNameCanon.js'

export const FACTORS = Object.freeze([
  { key: 'unit_fit', label: 'Unit Fit', max: 20 },
  { key: 'feedback', label: 'Preceptor Feedback', max: 30 },
  { key: 'resume', label: 'Résumé', max: 25 },
  { key: 'statement', label: 'Statement', max: 25 },
])
export const UNIT_FIT_POINTS = Object.freeze([20, 15, 10])
export const STATEMENT_CATEGORIES = Object.freeze([
  { key: 'specificity', label: 'Specific' },
  { key: 'connection', label: 'Connects to Cedars-Sinai and the unit' },
  { key: 'reflection', label: 'Reflects on ASPIRE' },
])
export const MIN_FACTORS = 2
export const BANDS = Object.freeze([
  { key: 'strong', label: 'Strong fit', min: 80 },
  { key: 'good', label: 'Good fit', min: 65 },
  { key: 'developing', label: 'Developing', min: 0 },
])
export const NOT_ENOUGH = 'Not enough to score'
export const NOT_ELIGIBLE = 'Not eligible'

const round1 = n => Math.round(n * 10) / 10
const ORDINAL = ['1st', '2nd', '3rd']

// The units they were placed in for ASPIRE, by any record of it. PRECEPTED-UNITS-1: the record
// and the form may each name several units, so either may be a list.
export function rotatedUnits({ preceptedUnit = null, formPreceptedUnit = null, feedbackUnits = [] } = {}) {
  const out = new Map()
  for (const u of [preceptedUnit, formPreceptedUnit, feedbackUnits].flat(2)) {
    const k = unitNameKey(u)
    if (k && !out.has(k)) out.set(k, String(u).trim())
  }
  return [...out.values()]
}

export function unitFitFactor(preferences = [], rotated = []) {
  const ranked = (preferences || []).filter(Boolean).slice(0, 3)
  if (!ranked.length) return { points: null, detail: 'No units ranked yet' }
  const keys = new Set(rotated.map(unitNameKey))
  const hit = ranked.findIndex(u => keys.has(unitNameKey(u)))
  if (hit === -1) {
    return { points: 0, detail: rotated.length ? `Rotated in ${rotated.join(', ')}, which they did not rank` : 'No ASPIRE unit on record' }
  }
  return { points: UNIT_FIT_POINTS[hit], detail: `Rotated in ${ranked[hit]}, their ${ORDINAL[hit]} choice` }
}

// Ratings run 1 to 5 and 1 is "Not Observed / Unable to Assess", which is left out of every mean
// in this app (RESPONSES-PACKET-1). So 2 to 5 is the scale: 2 is 0% of the points, 5 is all of them.
export function feedbackFactor(ratings = [], { consent = true } = {}) {
  const usable = (ratings || []).map(Number).filter(n => Number.isInteger(n) && n >= 2 && n <= 5)
  if (!consent && usable.length) return { points: null, detail: 'Counts once they submit the Transition Form' }
  if (!usable.length) return { points: null, detail: 'No preceptor feedback on file' }
  const mean = usable.reduce((a, b) => a + b, 0) / usable.length
  return { points: round1(((mean - 2) / 3) * 30), detail: `Average rating ${mean.toFixed(1)} of 5 across ${usable.length} competenc${usable.length === 1 ? 'y' : 'ies'}` }
}

export function resumeFactor(composite) {
  const n = Number(composite)
  if (composite == null || !Number.isFinite(n)) return { points: null, detail: 'Résumé not scored yet. Keith scores each new résumé within about 10 minutes.' }
  const c = Math.max(0, Math.min(100, n))
  return { points: round1((c / 100) * 25), detail: `Résumé scored ${Math.round(c)} of 100` }
}

// Keith's ratings, cleaned: integers 0 to 10, all three or nothing.
export function cleanStatementRatings(raw) {
  const out = {}
  for (const { key } of STATEMENT_CATEGORIES) {
    const n = Number(raw?.[key]?.score ?? raw?.[key])
    if (!Number.isFinite(n)) return null
    out[key] = Math.max(0, Math.min(10, Math.round(n)))
  }
  return out
}

export function statementFactor(ratings) {
  const r = cleanStatementRatings(ratings)
  // KEITH-AUTO-1: Keith reads the statements on his own after each submit and revision.
  if (!r) return { points: null, detail: 'Not assessed yet. Keith reads the statements within about 10 minutes of a submit or revision.' }
  const sum = STATEMENT_CATEGORIES.reduce((a, { key }) => a + r[key], 0)
  return { points: round1((sum / 30) * 25), detail: `Keith rated it ${sum} of 30` }
}

export function bandFor(score) {
  return BANDS.find(b => score >= b.min) || BANDS[BANDS.length - 1]
}

// The whole score. `input`: { preferences, rotated, ratings, consent, resumeComposite,
// statementRatings, eligibility }.
export function candidateScore(input = {}) {
  const parts = {
    unit_fit: unitFitFactor(input.preferences, input.rotated || []),
    feedback: feedbackFactor(input.ratings, { consent: input.consent !== false }),
    resume: resumeFactor(input.resumeComposite),
    statement: statementFactor(input.statementRatings),
  }
  const factors = FACTORS.map(f => ({ ...f, ...parts[f.key] }))
  const counted = factors.filter(f => f.points != null)
  const basedOn = counted.length
  const ineligible = input.eligibility === 'not_eligible'
  if (basedOn < MIN_FACTORS) {
    return { score: null, band: null, label: ineligible ? NOT_ELIGIBLE : NOT_ENOUGH, basedOn, factors, ineligible }
  }
  const points = counted.reduce((a, f) => a + f.points, 0)
  const possible = counted.reduce((a, f) => a + f.max, 0)
  const score = Math.round((points / possible) * 100)
  const band = bandFor(score)
  return { score, band: band.key, label: ineligible ? NOT_ELIGIBLE : band.label, basedOn, factors, ineligible }
}

export const basedOnLine = s => (s?.basedOn != null ? `Based on ${s.basedOn} of ${FACTORS.length} factors` : '')

// Sort key for the Fit column: scored applicants by score, then the unscored.
export const scoreSortValue = s => (s?.score == null ? null : s.score)

// CANDIDATE-SCORE-2: Keith had a hand in this score when he rated the statement or scored the
// résumé it counts. The Fit chip shows his orb exactly then.
export const keithContributed = s => Boolean(s?.assessment?.provenanceId || s?.resumeProvenanceId)
