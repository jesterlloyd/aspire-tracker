// src/lib/evaluation/assignmentReissue.js
//
// SURVEY-REISSUE-2 (Owner, 2026-09-20): ONE rule for when an existing survey assignment may
// be sent again. The database keeps one assignment row per (instrument, student, cohort,
// timepoint), so a deliberate resend REUSES the terminal row: its token is rotated and the
// row is activated again with fresh send metadata. The Casey-Fink workflows carried this
// rule first (SURVEY-REISSUE-1, as isCaseyFinkReissuableAssignment); the preceptor,
// unit-feedback and ASPIRE-feedback workflows now read the same function, so the five
// detectors, the five release endpoints and the Responses roster cannot disagree about which
// rows a Reissue may touch.
//
//   reissuable  expired (by status, or a live status whose expires_at has passed), revoked,
//               or non_responder, and never completed
//   never       completed, live (sent / opened / reminder_due before expiry), draft, unknown
//
// Pure: no I/O and no clock of its own (nowMs is injected).

export function isReissuableAssignment(a, nowMs) {
  if (!a || a.completed_at || a.status === 'completed') return false
  if (a.revoked_at || ['revoked', 'expired', 'non_responder'].includes(a.status)) return true
  const wasLive = ['sent', 'opened', 'reminder_due'].includes(a.status)
  return !!(wasLive && a.expires_at && new Date(a.expires_at).getTime() <= nowMs)
}

/** Why a reissuable row is reissuable, for a stamp or a warning: 'revoked' or 'expired'. */
export function reissueReason(a) {
  if (!a) return null
  if (a.revoked_at || a.status === 'revoked') return 'revoked'
  return 'expired'
}
