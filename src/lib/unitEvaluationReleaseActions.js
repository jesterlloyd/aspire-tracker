// src/lib/unitEvaluationReleaseActions.js
//
// Pure availability + labelling logic for the Owner/Admin Unit Leader evaluation Review &
// Release console. The DATABASE is always the final authority (each RPC re-checks every
// gate and returns an exact refusal status); this module only decides which buttons to
// enable and when a row is read-only, so staff aren't offered actions that will obviously
// be refused. Pure functions — no React, no network.

export const RELEASE_STATE_LABELS = Object.freeze({
  pending: 'Pending', moderated: 'Moderated', released: 'Released',
  revoked: 'Revoked', ineligible: 'Ineligible',
})
export const MODERATION_STATE_LABELS = Object.freeze({
  pending: 'Not moderated', cleared: 'Cleared', blocked: 'Blocked',
})

const VERIFIED_SNAPSHOT = new Set(['submission_trigger', 'backfill_verified'])

/**
 * A row is read-only when it can never be released in the first release: an unverified
 * (legacy) snapshot, an ineligible release_state, a missing evaluated preceptor, or an
 * unknown eligibility date (snapshot incomplete). Read-only rows offer no lifecycle actions.
 */
export function rowIsReadOnly(row) {
  if (!row) return true
  return (
    !VERIFIED_SNAPSHOT.has(row.snapshot_source) ||
    row.release_state === 'ineligible' ||
    !row.evaluated_preceptor ||
    !row.eligible_at
  )
}

/** Is the 7-day post-rotation delay satisfied for this row (client view; server is final)? */
export function isEligibleNow(row, now = Date.now()) {
  return !!row?.eligible_at && new Date(row.eligible_at).getTime() <= now
}

/**
 * The set of enabled actions for a row, from:
 *   'moderate_cleared' | 'moderate_blocked' | 'release' | 'revoke' | 'rerelease'
 * Release requires cleared moderation AND eligibility; revoke requires a released row;
 * re-release is the only path out of 'revoked' and also requires cleared + eligible.
 */
export function availableActions(row, now = Date.now()) {
  if (rowIsReadOnly(row)) return []
  const out = []
  if (row.moderation_state !== 'cleared') out.push('moderate_cleared')
  if (row.moderation_state !== 'blocked') out.push('moderate_blocked')
  const eligible = isEligibleNow(row, now)
  if ((row.release_state === 'pending' || row.release_state === 'moderated') &&
      row.moderation_state === 'cleared' && eligible) {
    out.push('release')
  }
  if (row.release_state === 'released') out.push('revoke')
  if (row.release_state === 'revoked' && row.moderation_state === 'cleared' && eligible) {
    out.push('rerelease')
  }
  return out
}

// Maps a console action button to the API action verb (+ moderation decision).
export const ACTION_API = Object.freeze({
  moderate_cleared: { action: 'moderate', decision: 'cleared', label: 'Clear', confirm: false },
  moderate_blocked: { action: 'moderate', decision: 'blocked', label: 'Block', confirm: true },
  release:          { action: 'release', label: 'Release', confirm: true },
  revoke:           { action: 'revoke', label: 'Revoke', confirm: true },
  rerelease:        { action: 'rerelease', label: 'Re-release', confirm: true },
})

// Human-readable copy for each server refusal status, shown verbatim-safe in the console.
export const ACTION_STATUS_MESSAGE = Object.freeze({
  success: 'Done.',
  no_change: 'No change was needed.',
  not_authorized: 'Only an active Owner or Admin can do that.',
  not_found: 'That response could not be found.',
  invalid_decision: 'Invalid moderation decision.',
  already_released: 'This response is already released.',
  already_revoked: 'This response is already revoked.',
  not_revoked: 'This response is not revoked, so it cannot be re-released.',
  not_releasable_state: 'This response is not in a releasable state.',
  revoked_requires_explicit_rerelease: 'This response was revoked; use Re-release.',
  snapshot_unverified: 'This is a legacy response and cannot be released.',
  snapshot_incomplete: 'This response is missing required attribution and cannot be released.',
  not_yet_eligible: 'Not yet eligible: results release 7 days after the rotation ends.',
  not_moderated: 'Clear moderation before releasing.',
})
