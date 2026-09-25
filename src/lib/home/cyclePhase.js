// HOME-1 (2026-09-24): the cycle phase, derived, never stored.
//
// The home page orders its sections for the phase the cohort is in. The `cohorts` table
// has no window dates (only start_date, end_date, status, completed_at), and the Owner
// chose to DERIVE the phase from what exists rather than add columns (option A,
// 2026-09-24). The evidence, in the order it is weighed:
//
//   1. A Completed or Archived cohort, or one whose every known school rotation has
//      ended, is in Evaluation: the surveys and the certificates are what is left.
//   2. A rotation that has started (any school's rotation_start_date is today or
//      earlier and its end is ahead), or any student in Active Rotation, is Active
//      rotation.
//   3. A student placed and no rotation started yet is Placement.
//   4. A student interviewed, scheduled, or a form received (the interview pipeline has
//      begun) and nobody placed is Interviewing.
//   5. Otherwise Recruitment: outreach and applications.
//
// The '1900-01-01' sentinel in cohort_school_rotations means "window pending" and is
// unknown, never a date (same rule as src/lib/attention.js).
//
// Pure: no React, no I/O, `today` is passed in as a local 'YYYY-MM-DD'.

export const PHASES = Object.freeze({
  recruit: { key: 'recruit', label: 'Recruitment', stage: 0, order: ['recruit', 'duo', 'activity', 'placement'] },
  interview: { key: 'interview', label: 'Interviewing', stage: 1, order: ['duo', 'recruit', 'activity', 'placement'] },
  placement: { key: 'placement', label: 'Placement', stage: 2, order: ['placement', 'duo', 'activity'] },
  rotation: { key: 'rotation', label: 'Active rotation', stage: 3, order: ['duo', 'placement', 'activity'] },
  eval: { key: 'eval', label: 'Evaluation', stage: 4, order: ['evals', 'duo', 'activity', 'placement'] },
})

export const PHASE_KEYS = Object.freeze(Object.keys(PHASES))

const SENTINEL = '1900-01-01'
export const knownDate = (d) => (d && String(d).slice(0, 10) !== SENTINEL ? String(d).slice(0, 10) : null)

const INTERVIEW_PIPELINE = new Set(['Form Received', 'Interview Scheduled', 'Interviewed'])
const PLACED_OR_LATER = new Set(['Placed', 'Active Rotation', 'Completed'])

/** Today as a local 'YYYY-MM-DD'. */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The known rotation windows of a cohort, from its cohort_school_rotations rows.
 * @returns {{ start: string|null, end: string|null }[]} one entry per row with any known date
 */
export function rotationWindows(rotations = []) {
  return (rotations || [])
    .map(r => ({ start: knownDate(r?.rotation_start_date), end: knownDate(r?.rotation_end_date) }))
    .filter(w => w.start || w.end)
}

/**
 * Derive the phase.
 * @param {object} args
 * @param {object} args.cohort - the cohort row (status, start_date, end_date, completed_at)
 * @param {object[]} args.students - the cohort's students (status)
 * @param {object[]} args.rotations - cohort_school_rotations rows for the cohort
 * @param {string} args.today - local 'YYYY-MM-DD'
 * @returns {{ key: string, label: string, stage: number, order: string[], reason: string }}
 */
export function derivePhase({ cohort = null, students = [], rotations = [], today = localDateStr() } = {}) {
  const list = Array.isArray(students) ? students : []
  const status = String(cohort?.status || '')
  const windows = rotationWindows(rotations)
  const known = windows.filter(w => w.start || w.end)

  const pick = (key, reason) => ({ ...PHASES[key], reason })

  if (status === 'Completed' || status === 'Archived' || cohort?.completed_at) {
    return pick('eval', `cohort is ${status || 'completed'}`)
  }
  const anyActive = list.some(s => s?.status === 'Active Rotation')
  const anyPlaced = list.some(s => PLACED_OR_LATER.has(s?.status))
  const allEnded = known.length > 0 && known.every(w => w.end && w.end < today)
  const anyStarted = known.some(w => w.start && w.start <= today && (!w.end || w.end >= today))

  if (allEnded && !anyActive) return pick('eval', 'every known rotation has ended')
  if (anyStarted || anyActive) return pick('rotation', anyActive ? 'students are in Active Rotation' : 'a rotation window has started')
  if (anyPlaced) return pick('placement', 'students are placed and no rotation has started')
  if (list.some(s => INTERVIEW_PIPELINE.has(s?.status))) return pick('interview', 'the interview pipeline has begun')
  return pick('recruit', list.length ? 'students are still in outreach' : 'no students yet')
}

/**
 * The five pipeline stages for the Cohort pulse, counted cumulatively: a student who is
 * Placed has also Applied and been Interviewed. Applied counts every student the school
 * submitted, less Declined and Not Proceeding, whose applications are withdrawn.
 */
export function pipelineCounts(students = []) {
  const list = (Array.isArray(students) ? students : []).filter(s => s && s.status !== 'Declined' && s.status !== 'Not Proceeding')
  const rank = { 'Pending Outreach': 0, 'Form Sent': 0, 'Form Received': 0, 'Interview Scheduled': 0, Interviewed: 1, Placed: 2, 'Active Rotation': 3, Completed: 4 }
  const at = (n) => list.filter(s => (rank[s.status] ?? 0) >= n).length
  return [
    { key: 'applied', label: 'Applied', count: list.length },
    { key: 'interviewed', label: 'Interviewed', count: at(1) },
    { key: 'placed', label: 'Placed', count: at(2) },
    { key: 'rotation', label: 'Active rotation', count: at(3) },
    { key: 'completed', label: 'Completed', count: at(4) },
  ]
}
