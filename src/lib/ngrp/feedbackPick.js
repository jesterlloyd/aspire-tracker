// FEEDBACK-MODAL-1 (Owner, 2026-11-02): the roster's Preceptor feedback chip opens ONE entry,
// the one that says most about where the alumnus finished: the latest End of Rotation, else the
// latest Midpoint, else the latest of anything. Pure; `entries` is shapePreceptorFeedback's list.

const ORDER = ['End of Rotation', 'Midpoint']

export function latestFeedback(entries = []) {
  const byNewest = [...(entries || [])].sort((a, b) => String(b?.submittedAt || '').localeCompare(String(a?.submittedAt || '')))
  for (const period of ORDER) {
    const hit = byNewest.find(e => e?.period === period)
    if (hit) return hit
  }
  return byNewest[0] || null
}

/**
 * May this viewer open the feedback from the chip? `feedback` is the summary hook's answer.
 * Owner and Admin (canDecide) when any is on file; Talent Acquisition when it is on file (the
 * dialog then says it opens once they submit, if they have not). Nobody else.
 */
export function chipOpens(entry, feedback) {
  if (!entry || !feedback) return false
  if (feedback.audience === 'talent_acquisition') return entry.available === true
  return feedback.canDecide === true && entry.count > 0
}

// What the dialog asks the endpoint for, or null when Talent Acquisition may not open it yet.
export function feedbackTarget(row, entry, audience) {
  if (!row?.candidate_id) return null
  if (audience !== 'talent_acquisition') return { candidate_id: row.candidate_id }
  if (entry?.canView) return { candidate_id: row.candidate_id }
  return entry?.request?.status === 'approved' ? { request_id: entry.request.id } : null
}
