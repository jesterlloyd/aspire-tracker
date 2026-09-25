// src/lib/evaluation/reviewQueueBuild.js
//
// HOME-1 (2026-09-24): every workflow's queue, in the shared shape, from the loaders'
// evidence. This is the block SurveyAutomationDashboard computed in a useMemo, lifted out
// so the home page's Needs you reads the SAME adapters over the SAME evidence and can
// never disagree with the clipboard about what is ready or blocked. Pure.

import {
  adaptCaseyFinkPreRotation, adaptPreceptor, adaptStudentFeedback, adaptCaseyFinkPostRotation,
  adaptAspireFeedback, adaptUnitLeaderRelease,
} from './reviewQueueAdapters.js'

/**
 * @param evidence the result of loadCohortEvidence (or null while loading)
 * @param ulQueue the result of loadUnitLeaderQueue (or null)
 * @returns {{ [workflowKey]: { items, sent } }}
 */
export function buildQueues(evidence, ulQueue) {
  const out = {}
  const ev = evidence
  if (ev) {
    const shared = { students: ev.students, displayName: ev.displayName, nowMs: ev.detectedAtMs }
    out.caseyFinkPreRotation = adaptCaseyFinkPreRotation({ ...shared, assignments: ev.forWorkflow.caseyFinkPreRotation })
    out.preceptor = adaptPreceptor({ ...shared, preceptors: ev.preceptors, assignments: ev.forWorkflow.preceptor })
    out.student = adaptStudentFeedback({ ...shared, preceptors: ev.preceptors, assignments: ev.forWorkflow.student })
    out.caseyFinkPostRotation = adaptCaseyFinkPostRotation({
      ...shared, assignments: ev.forWorkflow.caseyFinkPostRotation, allAssignmentsByStudent: ev.allAssignmentsByStudent,
      certificates: ev.certificates, shiftMeta: ev.shiftMeta,
    })
    out.postRotation = adaptAspireFeedback({
      ...shared, assignments: ev.forWorkflow.postRotation, allAssignmentsByStudent: ev.allAssignmentsByStudent,
      activityByStudent: ev.activityByStudent, ledgerDown: ev.ledgerDown, shiftMeta: ev.shiftMeta,
      supportByStudent: ev.supportByStudent, supportDown: ev.supportDown,
    })
  }
  if (ulQueue) {
    out.unitLeaderRelease = adaptUnitLeaderRelease({ rows: ulQueue.rows, nowMs: ulQueue.detectedAtMs })
  }
  return out
}
