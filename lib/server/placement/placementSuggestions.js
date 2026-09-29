// lib/server/placement/placementSuggestions.js
//
// KEITH-PLACEMENT-1 (2026-09-29): Keith suggests placements. Code applies the hard rules and scores
// (src/lib/placement/candidatePlacements.js, weights in suggestionConfig.js); Keith reads the free
// text and writes the reason (the explain-placement skill, through runKeithSkill).
//
//   runSuggestions   one run for one cohort: every suggestable student's rule-passing options, the
//                    best PLACEMENT_RULES.explainTop read by Keith (a reading of the same student,
//                    unit and preceptor is reused within the cohort), scored, allocated across the
//                    cohort with every contest logged, and written as ranks 1 to 3. A student's
//                    earlier open suggestions are superseded. SHADOW runs (the hourly cron) write
//                    mode 'shadow' and only for students with none yet; they are never shown.
//   boardView        what the board shows: ON, each student's suggestion re-checked against the live
//                    board (a slot filled since, a preceptor taken, a pairing rejected) and its two
//                    alternatives; always, the accepted suggestions whose placement still stands (the
//                    pinned note keeps the Keith mark); and the shadow comparison.
//   accept / undoAccept / reject   the person's decision, with provenance. Accept re-checks every
//                    rule on the server first; the placement itself is the board's own manual path.

import { randomUUID } from 'node:crypto'
import { runKeithSkill, recordKeithOutcome, loadSkill } from '../keith/runKeithSkill.js'
import { skillMode } from '../../../src/lib/keith/provenanceModel.js'
import { getUnit } from '../../../src/lib/unitCatalog.js'
import {
  buildContext, candidatePlacements, allocate, stillValid, isSuggestable, preferenceRank,
} from '../../../src/lib/placement/candidatePlacements.js'
import { PLACEMENT_RULES } from '../../../src/lib/placement/suggestionConfig.js'

export const SKILL_KEY = 'explain-placement'
const STUDENT_COLS = 'id, first_name, last_name, preferred_first_name, status, matched_unit_id, cohort_id, unit_preference_1, unit_preference_2, unit_preference_3, nights_available, interest_statement, prior_healthcare_experience, created_at'
const nameOf = (s) => [s?.preferred_first_name || s?.first_name, s?.last_name].filter(Boolean).join(' ') || 'Student'

export class PlacementSuggestionError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

async function rows(query, what) {
  const { data, error } = await query
  if (error) throw new PlacementSuggestionError('read_failed', `${what} could not be read.`, 500)
  return data || []
}

/** Everything the rules run on, for one cohort, read live. */
export async function loadContext(db, cohortId) {
  const [students, units, matches, assignments, rejected] = await Promise.all([
    rows(db.from('students').select(STUDENT_COLS).eq('cohort_id', cohortId), 'Students'),
    rows(db.from('units').select('id, unit_name, total_slots, is_participating, shift_preference, patient_population, division').eq('cohort_id', cohortId), 'Units'),
    rows(db.from('matches').select('id, student_id, unit_id, created_at').eq('cohort_id', cohortId), 'Placements'),
    rows(db.from('student_preceptor_assignments').select('student_id, preceptor_id').eq('cohort_id', cohortId).eq('role', 'primary').eq('status', 'active'), 'Preceptor assignments'),
    db.from('placement_suggestions').select('student_id, unit_id').eq('cohort_id', cohortId).eq('state', 'rejected').then(r => r.data || []),
  ])
  const unitIds = units.map(u => u.id)
  const preceptors = unitIds.length ? await rows(db.from('preceptors').select('id, full_name, unit_id, is_active, notes').in('unit_id', unitIds), 'Preceptors') : []
  const applied = await db.from('program_events').select('student_id, event_date').eq('event_type', 'form_received').in('student_id', students.map(s => s.id).slice(0, 1000))
  const appliedAt = new Map(students.map(s => [s.id, String(s.created_at || '').slice(0, 10)]))
  for (const e of applied.data || []) if (e.event_date && (!appliedAt.get(e.student_id) || e.event_date < appliedAt.get(e.student_id))) appliedAt.set(e.student_id, e.event_date)
  return {
    students, units, matches, preceptors, appliedAt,
    ctx: buildContext({ units, matches, preceptors, assignments, rejected: rejected.map(r => `${r.student_id}|${r.unit_id}`) }),
  }
}

const unitText = (u) => [u.unit_name, getUnit(u.unit_name)?.description, u.patient_population ? `patients: ${u.patient_population}` : null, u.division].filter(Boolean).join('; ')

/** Keith's fit and reason for one option, reused when the same pairing was read in this cohort. */
async function explain(db, { student, unit, preceptor, cache, complete, actor, system }) {
  const key = `${student.id}|${unit.id}|${preceptor.id}`
  if (cache.has(key)) return cache.get(key)
  const entityId = randomUUID()
  const run = await runKeithSkill(db, SKILL_KEY, {
    goals: { value: student.interest_statement || '', refs: [{ type: 'student_record', id: student.id }] },
    experience: { value: student.prior_healthcare_experience || '' },
    unit: { value: unitText(unit), refs: [{ type: 'unit', id: unit.id }] },
    preceptor_notes: { value: preceptor.notes || '', refs: [{ type: 'preceptor', id: preceptor.id }] },
  }, { actor, system, entity: { id: entityId, field: 'explanation' }, complete })
  const out = run.ok ? { fit: run.output.experience_fit, reason: run.output.reason, provenanceId: run.provenanceId, mode: run.mode } : null
  cache.set(key, out)
  return out
}

// Every reading Keith has made for these students, from provenance (it records the student, unit and
// preceptor it read by id), so a pairing is read once however the runs rank it.
async function explanationCache(db, studentIds) {
  const want = new Set(studentIds)
  const cache = new Map()
  const { data } = await db.from('keith_provenance').select('id, input_refs, output, created_at')
    .eq('skill_key', SKILL_KEY).order('created_at', { ascending: false }).limit(5000)
  for (const r of data || []) {
    const ref = (t) => (r.input_refs || []).find(x => x.type === t)?.id
    const k = `${ref('student_record')}|${ref('unit')}|${ref('preceptor')}`
    if (!want.has(ref('student_record')) || cache.has(k) || !Number.isFinite(Number(r.output?.experience_fit))) continue
    cache.set(k, { fit: Number(r.output.experience_fit), reason: r.output.reason || null, provenanceId: r.id })
  }
  return cache
}

/**
 * One run. `source` is 'manual' (the board's "Suggest for all unplaced", skill ON) or 'shadow_cron'.
 * Returns { mode, run_id, students, suggested, conflicts, unexplained }.
 */
export async function runSuggestions(db, { cohortId, actor = null, source = 'manual', complete, limit = null } = {}) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  const mode = skillMode(skill)
  if (mode === 'off') return { mode, students: 0, suggested: 0, conflicts: [] }
  if (source === 'manual' && mode !== 'on') throw new PlacementSuggestionError('shadow', 'Keith’s suggestions are in shadow mode, so they are computed quietly and not shown.')
  if (source === 'shadow_cron' && mode !== 'shadow') return { mode, students: 0, suggested: 0, conflicts: [] }
  const system = source === 'shadow_cron'

  const { students, units, preceptors, ctx, appliedAt } = await loadContext(db, cohortId)
  let eligible = students.filter(isSuggestable)
  if (source === 'shadow_cron') {
    const have = new Set((await rows(db.from('placement_suggestions').select('student_id').eq('cohort_id', cohortId).eq('mode', 'shadow'), 'Suggestions')).map(r => r.student_id))
    eligible = eligible.filter(s => !have.has(s.id))
  }
  if (limit) eligible = eligible.slice(0, limit)
  if (!eligible.length) return { mode, students: 0, suggested: 0, conflicts: [] }

  const unitById = new Map(units.map(u => [u.id, u]))
  const precById = new Map(preceptors.map(p => [p.id, p]))
  const cache = await explanationCache(db, eligible.map(s => s.id))
  const options = new Map()
  const reasons = new Map()
  let unexplained = 0
  for (const s of eligible) {
    // Keith reads the best explainTop units, up to two preceptors each (a spare for when another
    // student takes the first): at most 2 x explainTop readings per student.
    const perUnit = new Map()
    const first = candidatePlacements(s, ctx).candidates.filter(c => {
      const n = perUnit.get(c.unitId) || 0
      if (!n && perUnit.size >= PLACEMENT_RULES.explainTop) return false
      if (n >= 2) return false
      perUnit.set(c.unitId, n + 1)
      return true
    })
    const fits = new Map()
    for (const c of first) {
      const e = await explain(db, { student: s, unit: unitById.get(c.unitId), preceptor: precById.get(c.preceptorId), cache, complete, actor, system })
      if (!e) { unexplained += 1; continue }
      fits.set(`${c.unitId}|${c.preceptorId}`, e.fit)
      reasons.set(`${s.id}|${c.unitId}|${c.preceptorId}`, e)
    }
    // Keith can reorder what passed; it can never add: only the explained, rule-passing options remain.
    const rescored = candidatePlacements(s, ctx, { fits }).candidates.filter(c => fits.has(`${c.unitId}|${c.preceptorId}`))
    options.set(s.id, rescored)
  }
  const { picks, conflicts } = allocate(eligible, options, ctx, appliedAt)

  const runId = randomUUID()
  const named = conflicts.map(c => ({ ...c, student: nameOf(eligible.find(s => s.id === c.studentId)), winner: nameOf(eligible.find(s => s.id === c.winnerId)) }))
  const out = []
  for (const s of eligible) {
    const pick = picks.get(s.id)
    if (!pick) continue
    const seenUnits = new Set([pick.unitId])
    const rest = options.get(s.id).filter(c => (seenUnits.has(c.unitId) ? false : seenUnits.add(c.unitId))).slice(0, PLACEMENT_RULES.suggest - 1)
    ;[pick, ...rest].forEach((c, i) => {
      const e = reasons.get(`${s.id}|${c.unitId}|${c.preceptorId}`)
      out.push({
        run_id: runId, cohort_id: cohortId, student_id: s.id, rank: i + 1, unit_id: c.unitId, preceptor_id: c.preceptorId,
        pref_rank: c.rank, score: Math.round(c.score * 1000) / 1000, experience_fit: c.fit, load: c.load,
        checks: c.checks.map(k => ({ key: k.key, ok: k.ok, label: k.label })), reason: e?.reason || null,
        keith_provenance_id: e?.provenanceId || null, mode,
      })
    })
  }
  const { error: rerr } = await db.from('placement_suggestion_runs').insert({
    id: runId, cohort_id: cohortId, mode, source, started_by: actor?.id || null,
    students: eligible.length, suggested: picks.size, conflicts: named,
  })
  if (rerr) throw new PlacementSuggestionError('save_failed', 'The suggestions could not be saved.', 500)
  const ids = eligible.map(s => s.id)
  await db.from('placement_suggestions').update({ state: 'superseded' }).eq('cohort_id', cohortId).eq('state', 'open').in('student_id', ids)
  if (out.length) {
    const { error } = await db.from('placement_suggestions').insert(out)
    if (error) throw new PlacementSuggestionError('save_failed', 'The suggestions could not be saved.', 500)
  }
  return { mode, run_id: runId, students: eligible.length, suggested: picks.size, conflicts: named, unexplained }
}

const view = (r, unitById, precById) => ({
  id: r.id, rank: r.rank, unitId: r.unit_id, unitName: unitById.get(r.unit_id)?.unit_name || '',
  preceptorId: r.preceptor_id, preceptorName: precById.get(r.preceptor_id)?.full_name || '',
  prefRank: r.pref_rank, reason: r.reason || '', checks: r.checks || [], provenanceId: r.keith_provenance_id || null,
})

/** The shadow comparison: how the Owner's placements compare with what Keith would have suggested. */
export function shadowComparison({ suggestions, students, matches, unitName }) {
  const firstByStudent = new Map()
  for (const r of suggestions) {
    if (r.mode !== 'shadow' || r.rank !== 1) continue
    const prior = firstByStudent.get(r.student_id)
    if (!prior || r.created_at > prior.created_at) firstByStudent.set(r.student_id, r)
  }
  const matchOf = new Map(matches.map(m => [m.student_id, m]))
  let placed = 0, same = 0, sameRank = 0, broken = 0
  const disagreements = []
  for (const s of students) {
    const k = firstByStudent.get(s.id)
    const m = matchOf.get(s.id)
    if (!k || !m) continue
    placed += 1
    if ((k.checks || []).some(c => c.ok === false)) broken += 1
    if (m.unit_id === k.unit_id) { same += 1; continue }
    const placedRank = preferenceRank(s, { unit_name: unitName(m.unit_id) })
    if (placedRank != null && placedRank === k.pref_rank) sameRank += 1
    disagreements.push({ student: nameOf(s), keith: unitName(k.unit_id), keithRank: k.pref_rank, placed: unitName(m.unit_id), placedRank })
  }
  return { placed, matchedFirst: same, sameRank, hardRulesBroken: broken, disagreements }
}

/** What the Placement Board shows for one cohort. */
export async function boardView(db, { cohortId }) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (!skill || !('run_mode' in skill)) return { available: false, mode: 'off', suggestions: [], accepted: {}, comparison: null }
  const mode = skillMode(skill)
  const { data: all, error } = await db.from('placement_suggestions').select('*').eq('cohort_id', cohortId)
  if (error) return { available: false, mode: 'off', suggestions: [], accepted: {}, comparison: null }
  const { students, units, matches, preceptors, ctx } = await loadContext(db, cohortId)
  const unitById = new Map(units.map(u => [u.id, u]))
  const precById = new Map(preceptors.map(p => [p.id, p]))
  const studentById = new Map(students.map(s => [s.id, s]))

  const suggestions = []
  if (mode === 'on') {
    const open = (all || []).filter(r => r.state === 'open' && r.mode === 'on')
    const byStudent = new Map()
    for (const r of open) { if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []); byStudent.get(r.student_id).push(r) }
    for (const [sid, list] of byStudent) {
      const s = studentById.get(sid)
      if (!s || !isSuggestable(s)) continue
      const valid = list.sort((a, b) => a.rank - b.rank).filter(r => stillValid(s, { unitId: r.unit_id, preceptorId: r.preceptor_id }, ctx))
      if (!valid.length) continue
      const [first, ...alts] = valid
      suggestions.push({ studentId: sid, studentName: nameOf(s), ...view(first, unitById, precById), alternatives: alts.map(r => view(r, unitById, precById)) })
    }
  }
  const matched = new Map(matches.map(m => [m.student_id, m.unit_id]))
  const accepted = {}
  for (const r of all || []) {
    if (r.state === 'accepted' && matched.get(r.student_id) === r.unit_id && r.keith_provenance_id) accepted[r.student_id] = r.keith_provenance_id
  }
  const comparison = (all || []).some(r => r.mode === 'shadow')
    ? shadowComparison({ suggestions: all, students, matches, unitName: (id) => unitById.get(id)?.unit_name || '' })
    : null
  return { available: true, mode, runMode: skill.run_mode === 'shadow' ? 'shadow' : 'on', suggestions, accepted, comparison }
}

async function suggestionOf(db, id) {
  const { data } = await db.from('placement_suggestions').select('*').eq('id', id).limit(1)
  if (!data?.[0]) throw new PlacementSuggestionError('not_found', 'That suggestion no longer exists.', 404)
  return data[0]
}

/** Accept: every rule again, on the server, now. The board then places through its manual path. */
export async function accept(db, actor, { suggestionId }) {
  const r = await suggestionOf(db, suggestionId)
  if (r.state !== 'open' || r.mode !== 'on') throw new PlacementSuggestionError('not_open', 'This suggestion was already decided.')
  const { students, ctx } = await loadContext(db, r.cohort_id)
  const s = students.find(x => x.id === r.student_id)
  if (!s || !stillValid(s, { unitId: r.unit_id, preceptorId: r.preceptor_id }, ctx)) {
    throw new PlacementSuggestionError('rule_failed', 'This suggestion no longer passes the placement rules (the slot or preceptor may be taken). Run the suggestions again.')
  }
  const { data: upd } = await db.from('placement_suggestions').update({ state: 'accepted', decided_by: actor?.id || null, decided_at: new Date().toISOString() })
    .eq('id', r.id).eq('state', 'open').select('id')
  if (!upd?.length) throw new PlacementSuggestionError('not_open', 'This suggestion was already decided.')
  await db.from('placement_suggestions').update({ state: 'superseded' }).eq('student_id', r.student_id).eq('state', 'open')
  await recordKeithOutcome(db, r.keith_provenance_id, 'accept', null, actor)
  return { studentId: r.student_id, unitId: r.unit_id, preceptorId: r.preceptor_id, provenanceId: r.keith_provenance_id }
}

/** Undo an Accept (the board has already taken the placement back): the suggestion is open again. */
export async function undoAccept(db, actor, { suggestionId }) {
  const r = await suggestionOf(db, suggestionId)
  if (r.state !== 'accepted') throw new PlacementSuggestionError('not_accepted', 'This suggestion is not accepted.')
  await db.from('placement_suggestions').update({ state: 'open', decided_by: null, decided_at: null }).eq('id', r.id).eq('state', 'accepted')
  await recordKeithOutcome(db, r.keith_provenance_id, 'undo', null, actor)
  return { reopened: true }
}

/** Reject: the slip goes, and this student is not suggested for this unit again in the cohort. */
export async function reject(db, actor, { suggestionId }) {
  const r = await suggestionOf(db, suggestionId)
  if (r.state !== 'open') throw new PlacementSuggestionError('not_open', 'This suggestion was already decided.')
  await db.from('placement_suggestions').update({ state: 'rejected', decided_by: actor?.id || null, decided_at: new Date().toISOString() }).eq('id', r.id).eq('state', 'open')
  await recordKeithOutcome(db, r.keith_provenance_id, 'reject', null, actor)
  return { rejected: true }
}

/** Cohorts with a student Keith could suggest for, for the shadow cron. */
export async function cohortsToShadow(db) {
  const list = await rows(db.from('students').select('cohort_id, status, matched_unit_id').eq('status', 'Interviewed').is('matched_unit_id', null), 'Students')
  return [...new Set(list.map(s => s.cohort_id).filter(Boolean))]
}
