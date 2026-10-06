// lib/server/ngrpInterviewRubrics.js
//
// NGRP-INTERVIEWS-1 Phase 2: reading the residency interview rubrics (ngrp_interview_rubrics,
// 20261111000000) for the ASPIRE team and Talent Acquisition, who see every rubric and the panel
// result (Owner, 2026-10-05). Unit leaders read their own through the Unit Leader Portal's route
// (Phase 3), never through here. A missing table reads as "not enabled", never as an error.
import { panelSummary } from '../../src/lib/ngrp/ngrpRubric.js'

// Its own copy of the missing-relation test: ngrpApplicants.js imports this module, so importing
// back from it would be a cycle.
const isMissingNgrpTable = e => Boolean(e) && (e.code === 'PGRST205' || e.code === '42P01' || /find the table|does not exist/i.test(e.message || ''))

export const RUBRIC_FIELDS =
  'id, cycle_id, candidate_id, unit_key, interviewer_profile_id, interviewer_name, interview_at, ' +
  'cj_question, cj_question_other, cj_score, cj_notes, pp_question, pp_question_other, pp_score, pp_notes, ' +
  'ga_question, ga_question_other, ga_score, ga_notes, composite_score, individual_recommendation, ' +
  'suggested_unit, summary_comments, status, completed_at, created_at, updated_at'

const SUMMARY_FIELDS = 'candidate_id, status, cj_score, pp_score, ga_score, individual_recommendation'

/** One cohort's panel results by candidate: { provisioned, byCandidate: Map(id -> panel) }. */
export async function loadPanelSummaries(db, cycleId) {
  const res = await db.from('ngrp_interview_rubrics').select(SUMMARY_FIELDS).eq('cycle_id', cycleId)
  if (res.error) return isMissingNgrpTable(res.error) ? { provisioned: false, byCandidate: new Map() } : { error: res.error }
  const rows = new Map()
  for (const r of res.data || []) {
    if (!rows.has(r.candidate_id)) rows.set(r.candidate_id, [])
    rows.get(r.candidate_id).push(r)
  }
  const byCandidate = new Map()
  for (const [id, list] of rows) {
    const p = panelSummary(list)
    byCandidate.set(id, {
      completed: p.count, in_progress: list.filter(r => r.status !== 'completed').length,
      average: p.average, recommendation: p.recommendation, range: p.range?.label || null,
      diverged: p.diverged, closer_look: p.closerLook,
    })
  }
  return { provisioned: true, byCandidate }
}

/** Every rubric for one applicant, oldest first: { provisioned, rubrics }. */
export async function loadCandidateRubrics(db, { cycleId, candidateId }) {
  const res = await db.from('ngrp_interview_rubrics').select(RUBRIC_FIELDS)
    .eq('cycle_id', cycleId).eq('candidate_id', candidateId).order('created_at', { ascending: true })
  if (res.error) return isMissingNgrpTable(res.error) ? { provisioned: false, rubrics: [] } : { error: res.error }
  return { provisioned: true, rubrics: res.data || [] }
}
