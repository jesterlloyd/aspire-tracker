// RESIDENCY-SUPPORT-1: the numbers behind the Support tab, pure and testable.
//
// Every figure derives from the roster rows the Profiles tab already renders,
// the recorded support entries, the resident mentor assignments, and the
// check-ins ASPIRE Connect recorded. Voided entries never count.
import { activitiesFor, CHECKIN_INTERVAL_DAYS } from './ngrpSupportActivities.js'

const live = entries => (entries || []).filter(e => !e.voided_at)
const dayStr = v => (typeof v === 'string' ? v.slice(0, 10) : null)

function daysBetween(fromDay, toDay) {
  const [a, b] = [fromDay, toDay].map(d => Date.UTC(...d.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))))
  return Math.round((b - a) / 86400000)
}

// Before residency: one row per alumnus on the (already narrowed) roster, with
// each activity's count and most recent date, plus the KPI counts.
export function beforeResidency(rows = [], entries = []) {
  const acts = activitiesFor('before')
  const mine = live(entries).filter(e => acts.some(a => a.key === e.activity))
  const byStudent = new Map()
  for (const e of mine) {
    if (!byStudent.has(e.student_id)) byStudent.set(e.student_id, [])
    byStudent.get(e.student_id).push(e)
  }
  const tableRows = rows.map((r) => {
    const list = byStudent.get(r.student?.id || r.id) || []
    const cells = {}
    for (const a of acts) {
      const hits = list.filter(e => e.activity === a.key).map(e => e.occurred_on).sort()
      cells[a.key] = { count: hits.length, last: hits[hits.length - 1] || null }
    }
    return { row: r, cells, total: list.length }
  })
  const kpis = {
    supported: tableRows.filter(t => t.total > 0).length,
    alumni: rows.length,
    ...Object.fromEntries(acts.map(a => [a.key, tableRows.filter(t => t.cells[a.key].count > 0).length])),
  }
  return { activities: acts, rows: tableRows, kpis }
}

// A resident is a hired applicant who has not separated.
export function isResident(r) {
  return Boolean(r.outcome?.hired_at) && !r.outcome?.separated_at
}

// During residency: each resident's mentor, check-ins, and mentorship sessions.
// A weekly check-in is due once the residency has started, and is overdue when
// the last one is more than CHECKIN_INTERVAL_DAYS old (or there is none yet a
// week after the start).
export function duringResidency(rows = [], { entries = [], mentors = [], checkins = [], cycleStart = null, today }) {
  const mentorByCandidate = new Map(mentors.map(m => [m.candidate_id, m]))
  const sessions = live(entries).filter(e => e.activity === 'mentorship_session')
  const residents = rows.filter(isResident).map((r) => {
    const sid = r.student?.id || r.id
    const sent = checkins.filter(c => c.student_id === sid).map(c => dayStr(c.sent_at)).filter(Boolean).sort()
    const mine = sessions.filter(e => e.student_id === sid).map(e => e.occurred_on).sort()
    const start = dayStr(r.outcome?.residency_start_date) || dayStr(cycleStart)
    const lastCheckin = sent[sent.length - 1] || null
    const started = Boolean(start && today && daysBetween(start, today) >= 0)
    const reference = lastCheckin || start
    const overdue = Boolean(started && reference && daysBetween(reference, today) > CHECKIN_INTERVAL_DAYS)
    return {
      row: r,
      mentor: mentorByCandidate.get(r.candidate_id) || null,
      checkins: sent.length,
      lastCheckin,
      sessions: mine.length,
      lastSession: mine[mine.length - 1] || null,
      started,
      overdue,
    }
  })
  return {
    residents,
    kpis: {
      residents: residents.length,
      withMentor: residents.filter(x => x.mentor).length,
      overdue: residents.filter(x => x.overdue).length,
      checkins: residents.reduce((s, x) => s + x.checkins, 0),
      sessions: residents.reduce((s, x) => s + x.sessions, 0),
    },
  }
}
