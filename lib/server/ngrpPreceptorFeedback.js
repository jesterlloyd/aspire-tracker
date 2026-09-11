// lib/server/ngrpPreceptorFeedback.js
//
// RESIDENCY-PORTAL-2b: preceptor feedback in the Residency Portal. Owner
// decisions, 2026-09-10:
//   - the roster shows only THAT feedback exists (not every preceptor submits);
//   - Talent Acquisition asks to view it, the Owner approves in the app, and it
//     is then visible to that one person for that one applicant;
//   - every opening is recorded.
//
// This module is pure and db-free: the shaped view Talent Acquisition reads,
// and the per-student summary the roster reads. The shape is an ALLOWLIST.
// Anything not named here stays on the server, which is how the preceptor's
// confidential comments to the ASPIRE team, the attestation, the preceptor's
// identity, and every record id are kept out.
import {
  RATING_SCALE, COMPETENCY_ITEMS, PERIOD_LABELS, TIMEPOINT_TO_PERIOD,
} from './evaluation/preceptor_progress_validation.js'

export const PRECEPTOR_FEEDBACK_FORM_TYPE = 'preceptor_progress'
export const REQUEST_NOTE_MAX = 500

// As the preceptor saw them (lib/server/evaluation/content/preceptor_progress.json).
export const COMPETENCY_LABELS = Object.freeze({
  clinical_judgment: 'Clinical Judgment',
  patient_centered_care: 'Patient-Centered Care',
  safety_quality: 'Safety and Quality',
  teamwork_communication_collaboration: 'Teamwork, Communication, and Collaboration',
  professionalism_accountability: 'Professionalism and Accountability',
  advanced_beginner_readiness: 'Growth Toward Advanced Beginner Readiness',
})

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

// 1-5 to the scale's words; anything else is no rating.
export function ratingLabel(rating) {
  const n = Number(rating)
  return Number.isInteger(n) && n >= 1 && n <= RATING_SCALE.length ? RATING_SCALE[n - 1] : null
}

function shapeOne(row) {
  const responses = obj(row?.responses)
  const df = obj(responses.developmental_feedback)
  const context = obj(df.context)
  const competency = obj(df.competency)
  const narrative = obj(df.narrative)
  const readiness = obj(responses.readiness_endorsement)
  const period = context.feedback_period || TIMEPOINT_TO_PERIOD[row?.timepoint] || null
  return {
    period: PERIOD_LABELS[period] || null,
    submittedAt: row?.submitted_at || null,
    rotationUnit: text(context.rotation_unit),
    shiftsObserved: text(context.shifts_observed),
    competencies: COMPETENCY_ITEMS.map((key) => {
      const item = obj(competency[key])
      const label = ratingLabel(item.rating)
      return {
        key,
        label: COMPETENCY_LABELS[key] || key,
        rating: label ? Number(item.rating) : null,
        ratingLabel: label,
        comment: text(item.comment),
      }
    }),
    narrative: {
      strengths: text(narrative.strengths_observed),
      development: text(narrative.areas_for_development),
      supportPlan: text(narrative.suggested_support_plan),
    },
    readiness: {
      transitionReadiness: text(readiness.transition_readiness),
      unitEndorsement: text(readiness.unit_endorsement_consideration),
      explanation: text(readiness.endorsement_explanation),
      cedarsRecommendation: text(readiness.cedars_consideration_recommendation),
      bestFitEnvironment: text(readiness.best_fit_environment),
    },
  }
}

// Oldest first, so a midpoint reads before the end of rotation.
export function shapePreceptorFeedback(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(shapeOne)
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
}

function publicRequest(r) {
  return {
    id: r.id,
    status: r.status,
    requestedAt: r.requested_at || null,
    note: r.request_note || null,
    decidedAt: r.decided_at || null,
    decisionNote: r.decision_note || null,
  }
}

// The roster's summary, keyed by student id. Only students with feedback on
// file or a request appear.
//   Talent Acquisition: { available, request } where request is the caller's
//     own newest request (never anyone else's), and no count.
//   ASPIRE team: { count, requests } with each requester's name and how often
//     and when the feedback was viewed under that request.
export function buildFeedbackSummary({
  talentAcquisition = false, callerId = null, students = [], candidates = [],
  responseStudentIds = [], requests = [], requesterNames = new Map(), viewEvents = [],
} = {}) {
  const counts = new Map()
  for (const id of responseStudentIds) counts.set(id, (counts.get(id) || 0) + 1)
  const candidateByStudent = new Map(candidates.map(c => [c.student_id, c.id]))
  const viewsByRequest = new Map()
  for (const v of viewEvents) {
    const list = viewsByRequest.get(v.request_id) || []
    list.push(v.created_at)
    viewsByRequest.set(v.request_id, list)
  }
  const visible = talentAcquisition ? requests.filter(r => r.requester_profile_id === callerId) : requests
  const newestFirst = (a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))

  const out = {}
  for (const s of students) {
    const candidateId = candidateByStudent.get(s.id) || null
    const count = counts.get(s.id) || 0
    const forCandidate = candidateId ? visible.filter(r => r.candidate_id === candidateId).sort(newestFirst) : []
    if (count === 0 && forCandidate.length === 0) continue
    if (talentAcquisition) {
      out[s.id] = { available: count > 0, request: forCandidate[0] ? publicRequest(forCandidate[0]) : null }
    } else {
      out[s.id] = {
        count,
        requests: forCandidate.map((r) => {
          const views = [...(viewsByRequest.get(r.id) || [])].sort()
          return {
            ...publicRequest(r),
            requesterName: requesterNames.get(r.requester_profile_id) || null,
            views: views.length,
            lastViewedAt: views[views.length - 1] || null,
          }
        }),
      }
    }
  }
  return out
}
