// HOME-1 (2026-09-24): the Cohort pulse, for the cohort in scope.
//
// Pipeline: the five stages (src/lib/home/cyclePhase.js pipelineCounts) with the current
// phase's stage marked. Clinical hours: how many students in rotation are past the
// midpoint, and of the rest who is on track and who is behind, by the ONE pace rule in
// src/lib/clinicalHours.js (hoursPace). Midpoint assessments: the preceptor's midpoint
// assignments, submitted / awaiting the preceptor / ready to release. Every number here
// matches what Student Profiles, Rotation and Review & Release show for the same cohort,
// because it is computed from the same rows by the same rules. Pure.

import { hoursPace, hoursProgress } from '../clinicalHours.js'
import { knownDate } from './cyclePhase.js'

const IN_ROTATION = new Set(['Active Rotation', 'Completed'])

/**
 * @param students the cohort's students
 * @param rotations cohort_school_rotations rows
 * @param schoolKey (name) => key
 * @param today local 'YYYY-MM-DD'
 */
export function hoursBar({ students = [], rotations = [], schoolKey = (s) => s, today } = {}) {
  const windows = new Map()
  for (const r of rotations || []) {
    const k = schoolKey(r?.school_name)
    if (k) windows.set(k, { start: knownDate(r.rotation_start_date), end: knownDate(r.rotation_end_date) })
  }
  const list = (students || []).filter(s => s && IN_ROTATION.has(s.status))
  let pastMidpoint = 0, onTrack = 0, behind = 0
  for (const s of list) {
    const p = hoursProgress(s)
    if (p.pct >= 50) { pastMidpoint += 1; continue }
    const pace = hoursPace(s, windows.get(schoolKey(s.school)) || {}, today)
    if (pace.pace === 'behind') behind += 1
    else onTrack += 1
  }
  const total = list.length
  return {
    total, pastMidpoint, onTrack, behind,
    headline: `${pastMidpoint} of ${total} past midpoint`,
    sub: `${onTrack} on track · ${behind} behind pace`,
    ariaLabel: `${pastMidpoint} past midpoint, ${onTrack} on track, ${behind} behind`,
    segments: segments(total, [['green', pastMidpoint], ['navy', onTrack], ['amber', behind]]),
  }
}

/**
 * @param assignments the cohort's evaluation_assignments rows with evaluation_instruments.slug embedded
 * @param readyToRelease the Review & Release preceptor queue's ready midpoint count
 */
export function midpointBar({ assignments = [], readyToRelease = 0 } = {}) {
  const slug = (a) => { const i = a?.evaluation_instruments; return (Array.isArray(i) ? i[0] : i)?.slug }
  const mid = (assignments || []).filter(a => slug(a) === 'preceptor_progress' && a.timepoint === 'midpoint' && a.status !== 'revoked')
  const submitted = mid.filter(a => a.completed_at).length
  const awaiting = mid.filter(a => !a.completed_at && !a.revoked_at && (!a.expires_at || new Date(a.expires_at).getTime() > Date.now())).length
  const ready = Number(readyToRelease) || 0
  const total = submitted + awaiting + ready
  return {
    total, submitted, awaiting, ready,
    headline: `${submitted} of ${total} submitted`,
    sub: `${awaiting} awaiting preceptor · ${ready} ready to release`,
    ariaLabel: `${submitted} submitted, ${awaiting} awaiting preceptor, ${ready} ready to release`,
    segments: segments(total, [['green', submitted], ['navy', awaiting], ['amber', ready]]),
  }
}

function segments(total, parts) {
  if (!total) return []
  return parts.filter(([, v]) => v > 0).map(([tone, v]) => ({ tone, pct: Math.round((v / total) * 1000) / 10 }))
}
