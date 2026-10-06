// src/lib/ngrp/residencyNeedsModel.js
//
// RESIDENCY-NEEDS-1 (Owner, 2026-10-05): Residency's At a Glance opens on what needs you, for the
// ASPIRE team and Talent Acquisition alike ("they have to love this and want to adopt this").
// The groups wear the staff home's Needs you shape (src/lib/home/needsYouModel.js `finish`) and
// render in the same component; every row is navigation to that alumnus in Profiles & Interest.
// Pure, so the tab and the tests read the same rules. Documents reuse `residencyDocsGroup`.
import { finish } from '../home/needsYouModel.js'
import { displayName } from '../utils.js'

const DAY = 86_400_000
const shortDay = iso => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const profilePath = (base, studentId) => `${base}/profiles?student=${encodeURIComponent(studentId)}`

/** Interviews in the next seven days, and any whose time has passed with no result recorded. */
export function interviewsGroup(rows = [], { now = Date.now(), base = '/ngrp' } = {}) {
  const upcoming = []
  const overdue = []
  for (const r of rows) {
    if (r.interview_status !== 'scheduled' || !r.interview_at) continue
    const at = new Date(r.interview_at).getTime()
    if (Number.isNaN(at)) continue
    const row = { id: `iv:${r.id}`, ageMs: Math.abs(at - now), to: profilePath(base, r.student?.id || r.id) }
    if (at < now) overdue.push({ ...row, title: `${displayName(r.student)} · record the interview result`, meta: [r.assigned_unit, `was ${shortDay(r.interview_at)}`].filter(Boolean).join(' · '), pill: { text: 'Result due', tone: 'amber' } })
    else if (at - now <= 7 * DAY) upcoming.push({ ...row, title: `${displayName(r.student)} · interview`, meta: [r.assigned_unit, shortDay(r.interview_at)].filter(Boolean).join(' · '), pill: { text: 'This week', tone: 'navy' } })
  }
  const all = [...overdue, ...upcoming]
  const pills = [
    overdue.length ? { text: `${plural(overdue.length, 'result')} due`, tone: 'amber' } : null,
    upcoming.length ? { text: `${upcoming.length} this week`, tone: 'navy' } : null,
  ].filter(Boolean)
  return finish({ key: 'residencyInterviews', name: 'Interviews', sub: 'This week, and results to record', pills, rows: all, open: { label: 'Open Interview Board', to: `${base}/residency/board` }, count: all.length })
}

/** An offer extended with neither an acceptance nor a decline recorded. */
export function offersGroup(rows = [], { now = Date.now(), base = '/ngrp' } = {}) {
  const waiting = rows.filter(r => r.outcome?.offer_extended_at && !r.outcome.offer_accepted_at && !r.outcome.offer_declined_at && !r.outcome.hired_at)
    .map((r) => {
      const at = new Date(r.outcome.offer_extended_at).getTime()
      const days = Math.max(0, Math.floor((now - at) / DAY))
      return {
        id: `offer:${r.id}`, title: `${displayName(r.student)} · offer awaiting an answer`,
        meta: [r.assigned_unit, `extended ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}`].filter(Boolean).join(' · '),
        pill: { text: days >= 7 ? 'Follow up' : 'Waiting', tone: days >= 7 ? 'amber' : 'grey' },
        ageMs: now - at, to: profilePath(base, r.student?.id || r.id),
      }
    })
  return finish({ key: 'residencyOffers', name: 'Offers', sub: 'Extended, no answer yet', pills: waiting.length ? [{ text: `${waiting.length} waiting`, tone: 'grey' }] : [], rows: waiting, open: { label: 'Open Profiles', to: `${base}/profiles` }, count: waiting.length })
}

/** Alumni someone pulled the follow-up ribbon on. */
export function flaggedGroup(rows = [], { base = '/ngrp' } = {}) {
  const flagged = rows.filter(r => r.flagged_for_followup === true).map(r => ({
    id: `flag:${r.id}`, title: `${displayName(r.student)} · flagged for follow-up`,
    meta: [r.student?.school, r.student?.aspire_cohort].filter(Boolean).join(' · '),
    pill: { text: 'Flagged', tone: 'red' }, ageMs: 0, to: profilePath(base, r.student?.id || r.id),
  }))
  return finish({ key: 'residencyFlagged', name: 'Flagged', sub: 'Pulled on the applicant chart', pills: flagged.length ? [{ text: `${flagged.length} flagged`, tone: 'red' }] : [], rows: flagged, open: { label: 'Open Profiles', to: `${base}/profiles` }, count: flagged.length })
}
