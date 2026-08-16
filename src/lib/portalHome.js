import { countAwaitingReview } from './portalShiftStatus.js'
// ASPIRE-COMPASS: pure, null-safe derivations for the Student Portal Compass
// home (the stage-aware primary action and the attention items). No React, no
// I/O, so the portal and the tests share one source.
//
// Everything here derives ONLY from data the portal already holds. Nothing
// invents a stage, promises an outcome, or manufactures urgency: an attention
// item exists only when a real record is genuinely waiting on the student.

// The ONE stage-aware primary action for the Compass band. Returns null when
// no honest, actionable primary exists (pre-placement stages have nothing the
// student can do inside the portal, and a false CTA is worse than none).
//   kind: 'shift-log'    -> external /shift-log flow (existing behavior)
//         'certificate'  -> in-portal certificate download
export function deriveCompassAction({ status, certificateDownloadable = false } = {}) {
  if (status === 'Active Rotation') {
    return { kind: 'shift-log', label: 'Log a Shift', href: '/shift-log' }
  }
  if (status === 'Completed' && certificateDownloadable) {
    return { kind: 'certificate', label: 'Download your certificate' }
  }
  return null
}

// Attention items for the Compass band: compact, truthful chips answering
// "what needs my attention now?". Order is priority order. Each item:
//   { key, count, label, target }  target: 'messages' | 'surveys' | 'shifts'
// A survey "waits" only in the states the server uses for an open, actionable
// window; shift attention means logs still awaiting review; message attention
// is the authoritative unread count the nav badge already uses.
const SURVEY_WAITING_STATES = new Set(['sent', 'opened', 'reminder_due'])

export function deriveAttentionItems({ unreadMessages = 0, evaluations = [], shiftLogs = [] } = {}) {
  const items = []

  const unread = Number(unreadMessages) || 0
  if (unread > 0) {
    items.push({
      key: 'messages', count: unread, target: 'messages',
      label: unread === 1 ? '1 unread message' : `${unread} unread messages`,
    })
  }

  const waitingSurveys = (evaluations || []).filter(e => SURVEY_WAITING_STATES.has(e?.status)).length
  if (waitingSurveys > 0) {
    items.push({
      key: 'surveys', count: waitingSurveys, target: 'surveys',
      label: waitingSurveys === 1 ? '1 survey waiting for you' : `${waitingSurveys} surveys waiting for you`,
    })
  }

  // STUDENT-SHIFT-LOG-MANAGEMENT-1: canonical statuses, and withdrawn entries
  // await nothing. The previous test compared against the lowercase literal
  // 'approved', which no stored status equals - so EVERY shift counted as
  // awaiting review.
  const pendingShifts = countAwaitingReview(shiftLogs)
  if (pendingShifts > 0) {
    items.push({
      key: 'shifts', count: pendingShifts, target: 'shifts',
      label: pendingShifts === 1 ? '1 shift awaiting review' : `${pendingShifts} shifts awaiting review`,
    })
  }

  return items
}
