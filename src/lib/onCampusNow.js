// KEITH-ON-CAMPUS-NOW-1 - single source of truth for the "On Campus Now" derivation.
//
// Both the Aggregate tab (OverviewTab) and Keith's server-side live context derive the
// same On Campus Now set from these two pure helpers, so the UI and Keith can never
// disagree again. NOTHING here fetches or mutates data - callers pass already-fetched
// student_shift_logs rows.
//
// The On Campus Now set is a hybrid of two sources, exactly as the Aggregate tab shows it:
//   1. LIFECYCLE (authoritative): rows with lifecycle_state === 'in_progress' (live
//      /shift-log check-ins). These take precedence and have no timezone dependency.
//   2. TIME-WINDOW FALLBACK: today/yesterday Auto-Accepted/Approved logs whose canonical
//      shift window contains "now" (yesterday is included so night shifts spanning
//      midnight are caught). A student already shown via lifecycle is not duplicated here.

import { isShiftCurrentlyActive } from './shiftWindows.js'
import { shiftDrivesState } from './shiftLifecycle.js'

// Filter time-window fallback rows to those currently active, then deduplicate by student
// (keep the most recently submitted log). Mirrors the Aggregate on_campus_now queryFn.
export function selectActiveWindowRows(rows, now = new Date()) {
  // STUDENT-SHIFT-LOG-MANAGEMENT-1: a withdrawn entry keeps its old status
  // (Auto-Accepted/Approved), so status alone would still put the student on
  // campus. Lifecycle decides.
  const active = (rows || []).filter(log =>
    shiftDrivesState(log) && isShiftCurrentlyActive(log.shift_date, log.shift_type, now)
  )
  const byStudent = new Map()
  for (const log of active) {
    const existing = byStudent.get(log.student_id)
    if (!existing || new Date(log.submitted_at) > new Date(existing.submitted_at)) {
      byStudent.set(log.student_id, log)
    }
  }
  return Array.from(byStudent.values())
}

// Merge lifecycle (in_progress) rows with the active time-window fallback rows. Lifecycle
// rows take precedence; fallback rows are included only for students not already shown via
// lifecycle, so each student appears at most once. Mirrors the Aggregate mergedCampusLogs.
export function mergeOnCampusNow(lifecycleRows, activeWindowRows) {
  const lifecycleStudentIds = new Set((lifecycleRows || []).map(r => r.student_id))
  const fallbackOnly = (activeWindowRows || []).filter(r => !lifecycleStudentIds.has(r.student_id))
  return [...(lifecycleRows || []), ...fallbackOnly]
}

// KEITH-ON-CAMPUS-DETAILS-1 - shared open-shift detail resolvers so the Rotation > Activity
// Open Shift Review table and Keith's On Campus Now answer derive unit/preceptor identically.
//
// Unit precedence: what the student logged at check-in (planned_unit_name) → the final
// unit_name (set at check-out) → the student's matched/assigned unit → null. For an OPEN
// (in_progress) shift the final unit_name is null, so planned_unit_name is the live value.
export function openShiftUnit(log, student, units = []) {
  return log?.planned_unit_name
    || log?.unit_name
    || (units || []).find(u => u.id === student?.matched_unit_id)?.unit_name
    || null
}

// The preceptor the student actually LOGGED on this shift (planned at check-in, or final at
// check-out). Never substitutes the assigned preceptor as logged - it is returned separately
// as a clearly-labeled fallback. Both are trimmed; '' means absent.
export function openShiftPreceptor(log, student) {
  return {
    logged:   (log?.planned_preceptor_name || log?.preceptor_name || '').trim(),
    assigned: (student?.matched_preceptor || '').trim(),
  }
}
