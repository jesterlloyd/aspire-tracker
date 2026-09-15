// RESIDENCY-SUPPORT-1: the numbers behind the Support tab, pure and testable.
//
// Every figure derives from the roster rows the Profiles tab already renders,
// the recorded support entries, the resident mentor assignments, and each
// resident's reflection run (RESIDENCY-REFLECTION-1, which replaced the weekly
// email check-in on 2026-09-13). Voided entries never count.
import { activitiesFor } from './ngrpSupportActivities.js'
import { summarizeReflections } from './ngrpReflectionForm.js'

const live = entries => (entries || []).filter(e => !e.voided_at)
const dayStr = v => (typeof v === 'string' ? v.slice(0, 10) : null)

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

// MENTORSHIP-1 (Owner, 2026-09-14): Support is Before Residency | At the Start
// of Residency | During Residency.

// At the Start of Residency: each resident's ten-week Clinical Orientation
// Progress and Reflection Tool. A period is overdue when it was sent, is past
// its due date, and has not been submitted.
export function startOfResidency(rows = [], { reflections = { runs: [], periods: [] }, today } = {}) {
  const runByCandidate = new Map((reflections?.runs || []).map(x => [x.candidate_id, x]))
  const periods = reflections?.periods || []
  const residents = rows.filter(isResident).map((r) => {
    const run = runByCandidate.get(r.candidate_id) || null
    const reflection = summarizeReflections(run, periods, today)
    return {
      row: r,
      run,
      periods: run ? periods.filter(p => p.run_id === run.id) : [],
      reflection,
      overdue: reflection.overdue > 0,
    }
  })
  return {
    residents,
    kpis: {
      residents: residents.length,
      reflecting: residents.filter(x => x.reflection.started && !x.reflection.stopped).length,
      submitted: residents.reduce((s, x) => s + x.reflection.submitted, 0),
      overdue: residents.reduce((s, x) => s + x.reflection.overdue, 0),
      complete: residents.filter(x => x.reflection.started && x.reflection.done).length,
    },
  }
}

// During Residency: the mentorship record. Each current resident's mentor,
// session count and latest session, plus the whole session log, newest first.
// The log keeps a separated resident's sessions: the record does not shrink
// when someone leaves. Counts are for current residents.
export function duringResidency(rows = [], { entries = [], mentors = [] } = {}) {
  const mentorByCandidate = new Map(mentors.map(m => [m.candidate_id, m]))
  const residentRows = rows.filter(isResident)
  const residentStudents = new Set(residentRows.map(r => r.student?.id || r.id))
  const sessions = live(entries)
    .filter(e => e.activity === 'mentorship_session')
    .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)))
  const residents = residentRows.map((r) => {
    const sid = r.student?.id || r.id
    const mine = sessions.filter(e => e.student_id === sid)
    return {
      row: r,
      mentor: mentorByCandidate.get(r.candidate_id) || null,
      sessions: mine.length,
      latest: mine[0] || null,
    }
  })
  return {
    residents,
    sessions,
    kpis: {
      residents: residents.length,
      withMentor: residents.filter(x => x.mentor).length,
      sessions: residents.reduce((s, x) => s + x.sessions, 0),
      minutes: sessions.filter(e => residentStudents.has(e.student_id)).reduce((s, e) => s + (Number(e.duration_minutes) || 0), 0),
      withoutSession: residents.filter(x => x.sessions === 0).length,
    },
  }
}

export { dayStr }
