// lib/server/ngrpSupportLog.js
//
// SUPPORT-STANDALONE-1 (Owner, 2026-10-04): Log group activity writes one support entry
// per alumnus for one activity and date, and never needs the Transition Form first.
//
// An entry still points at an ngrp_candidates row, because that row is the alumnus's
// enrollment in the cycle (cycle + student, workflow state only), not the form. Until
// now only the form send created it; here the log creates it when it is missing, through
// the table's own UNIQUE (cycle_id, student_id), so the later form send finds and reuses
// the same row exactly as ensureCandidate would.
//
// One save is a handful of statements whatever its size: read the enrollments, add the
// missing ones, read the live entries that already cover this activity and date, insert
// the rest. A repeat is skipped and counted, never an error. Only if another save lands
// between the read and the insert (the live unique index refuses the batch) does it fall
// back to one insert per alumnus, so the counts stay exact.

const ENTRIES = 'ngrp_support_entries'
const CANDIDATES = 'ngrp_candidates'
const isUnique = error => error?.code === '23505'

// Find or create the enrollment for every student. Returns Map(student_id -> candidate).
export async function enrollStudents(db, { cycleId, studentIds }) {
  const read = () => db.from(CANDIDATES).select('id, cycle_id, student_id').eq('cycle_id', cycleId).in('student_id', studentIds)
  const first = await read()
  if (first.error) return { error: first.error }
  const byStudent = new Map((first.data || []).map(c => [c.student_id, c]))
  const missing = studentIds.filter(id => !byStudent.has(id))
  if (missing.length === 0) return { byStudent, enrolled: 0 }
  const ins = await db.from(CANDIDATES)
    .upsert(missing.map(student_id => ({ cycle_id: cycleId, student_id })), { onConflict: 'cycle_id,student_id', ignoreDuplicates: true })
  if (ins.error) return { error: ins.error }
  const again = await read()
  if (again.error) return { error: again.error }
  const after = new Map((again.data || []).map(c => [c.student_id, c]))
  if (studentIds.some(id => !after.has(id))) return { error: new Error('enrollment_failed') }
  return { byStudent: after, enrolled: missing.length }
}

// Write one entry per candidate. `entry` is validateAttendance's entry.
export async function writeGroupEntries(db, { cycleId, candidates, entry, actorId }) {
  const existing = await db.from(ENTRIES)
    .select('candidate_id')
    .in('candidate_id', candidates.map(c => c.id))
    .eq('activity', entry.activity)
    .eq('occurred_on', entry.occurred_on)
    .is('voided_at', null)
  if (existing.error) return { error: existing.error }
  const covered = new Set((existing.data || []).map(e => e.candidate_id))
  const todo = candidates.filter(c => !covered.has(c.id))
  let alreadyRecorded = candidates.length - todo.length
  const row = c => ({ ...entry, cycle_id: cycleId, candidate_id: c.id, student_id: c.student_id, recorded_by_profile_id: actorId })
  if (todo.length === 0) return { created: 0, alreadyRecorded, entryIds: [] }

  const batch = await db.from(ENTRIES).insert(todo.map(row)).select('id')
  if (!batch.error) return { created: (batch.data || []).length, alreadyRecorded, entryIds: (batch.data || []).map(r => r.id) }
  if (!isUnique(batch.error)) return { error: batch.error }

  // A concurrent save took one of these rows: one at a time, counting each refusal.
  const entryIds = []
  for (const c of todo) {
    const one = await db.from(ENTRIES).insert(row(c)).select('id').maybeSingle()
    if (one.error) {
      if (isUnique(one.error)) { alreadyRecorded += 1; continue }
      return { error: one.error, created: entryIds.length, entryIds }
    }
    entryIds.push(one.data.id)
  }
  return { created: entryIds.length, alreadyRecorded, entryIds }
}
