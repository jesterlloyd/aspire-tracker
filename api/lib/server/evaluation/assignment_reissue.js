// api/lib/server/evaluation/assignment_reissue.js
//
// SURVEY-REISSUE-1 — shared, pure classifier that decides whether a new Casey-Fink invitation may be
// generated for a (instrument, student, cohort, timepoint) tuple, given the existing
// evaluation_assignments row(s) for that tuple. Used by BOTH the single endpoint
// (evaluation-create-invitation.js) and the bulk endpoint (evaluation-bulk-invitations.js) so the two
// never diverge.
//
// uq_assignment guarantees at most ONE row per tuple, so a fresh row cannot be inserted when one
// already exists — reissue therefore REUSES the existing row. These functions accept an array and are
// defensive in case more than one row is ever returned.
//
// No DB access, no side effects, no token handling — classification only.

// A row represents a completed response. Completed rows must always block and must never be
// overwritten (do not touch completed_at / response data).
export function isCompletedAssignment(row) {
  return row?.status === 'completed' || !!row?.completed_at;
}

// A row is a still-usable (blocking) invitation: not revoked/expired/completed, and not past its
// expires_at. A row with no expires_at is treated as active (cannot prove it is expired).
export function isActiveUsableAssignment(row, nowMs) {
  if (!row) return false;
  if (['revoked', 'expired', 'completed'].includes(row.status)) return false;
  if (row.completed_at) return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > nowMs;
}

// Classifies the existing rows for one tuple into exactly one decision:
//   { kind: 'completed', row } — block; a completed response already exists.
//   { kind: 'active',    row } — block; an unexpired usable invitation already exists.
//   { kind: 'reissue',   row } — reuse this row; it is expired/revoked and not completed.
//   { kind: 'new' }            — no existing row; insert a fresh assignment.
// Order matters: completed wins over active wins over reissue.
export function classifyExistingAssignment(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];

  const completedRow = list.find(isCompletedAssignment);
  if (completedRow) return { kind: 'completed', row: completedRow };

  const activeRow = list.find((r) => isActiveUsableAssignment(r, nowMs));
  if (activeRow) return { kind: 'active', row: activeRow };

  const reissueRow = list[0] || null;
  if (reissueRow) return { kind: 'reissue', row: reissueRow };

  return { kind: 'new' };
}
