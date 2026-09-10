// PROCEEDING-GAP-1 (Owner, 2026-09-10): the Placement Snapshot's fifth card, for every cohort.
// Not Proceeding and Declined students have left the pipeline and never need a slot, so coverage
// counts proceeding students only. Student Requests (a separate card) still counts everyone.
// Pure: no React, no fetch.

export const EXITED_STATUSES = new Set(['Not Proceeding', 'Declined'])

// students: the cohort's students; totalSlots: the participating units' total_slots.
export function placementCoverage(students = [], totalSlots = 0) {
  const list = Array.isArray(students) ? students : []
  const proceeding = list.filter(s => !EXITED_STATUSES.has(s?.status))
  const placed = proceeding.filter(s => s?.matched_unit_id).length
  const gap = proceeding.length - totalSlots // positive = short on slots

  if (proceeding.length > 0 && placed === proceeding.length) {
    return { kind: 'all_placed', value: placed, label: 'All Placed',
      sub: `${placed} of ${proceeding.length} proceeding students`, accent: 'sage' }
  }
  if (gap > 0) {
    return { kind: 'gap', value: gap, label: 'Placement Gap', sub: 'More requests than open slots', accent: 'warning' }
  }
  // Math.abs, not -gap: an exact match would otherwise report -0.
  return { kind: 'covered', value: Math.abs(gap), label: 'Fully Covered', sub: 'Enough slots for all', accent: 'sage' }
}
