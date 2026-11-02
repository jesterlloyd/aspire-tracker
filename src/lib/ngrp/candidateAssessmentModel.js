// CANDIDATE-SCORE-1: Keith's assessment of one applicant, cleaned. The three statement ratings
// become integers 0 to 10 (candidateScoreModel turns them into points); every text is trimmed and
// capped, and an assessment that says nothing to recommend is refused rather than shown.
import { STATEMENT_CATEGORIES, cleanStatementRatings } from './candidateScoreModel.js'

const text = (v, max = 600) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s*—\s*/g, ', ').slice(0, max) : null)
const list = (v, n = 3) => (Array.isArray(v) ? v.map(x => text(x, 300)).filter(Boolean).slice(0, n) : [])

export function parseAssessment(json) {
  const ratings = cleanStatementRatings(json?.statement)
  if (!ratings) throw new Error('statement ratings missing')
  const recommendation = text(json?.recommendation, 800)
  if (!recommendation) throw new Error('recommendation missing')
  const statement = {}
  for (const { key } of STATEMENT_CATEGORIES) statement[key] = { score: ratings[key], note: text(json.statement[key]?.note, 400) }
  return {
    statement,
    statementTotal: STATEMENT_CATEGORIES.reduce((a, { key }) => a + ratings[key], 0),
    statementNote: text(json.statement_note, 400),
    summary: text(json.summary, 600),
    strengths: list(json.strengths),
    considerations: list(json.considerations),
    interviewFocus: list(json.interview_focus),
    recommendation,
  }
}
