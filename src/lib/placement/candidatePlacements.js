// src/lib/placement/candidatePlacements.js
//
// KEITH-PLACEMENT-1 (2026-09-29): code does the math. Pure, shared by the server (suggestions and
// their live re-check) and the board. Keith supplies only an experience fit (0 to 1) for options
// that already passed every hard rule; it can reorder them and can never add one.
//
// THE HARD RULES (Owner, 2026-09-29), each a check with the words its chip shows:
//   capacity    the unit is participating and has an open slot (total_slots less its placements
//               and less any slot another suggestion in the same batch already holds)
//   shift       a Night-preferred unit needs a student who has not said no to nights
//               (students.nights_available === false refuses it); Day-preferred and No preference
//               fit everyone. The student's own availability only: no school rule is on file.
//   preceptor   a preceptor on the unit with room under the cap (active primary students this
//               cohort < PLACEMENT_RULES.preceptorCap)
//   clearance   today's placement rule: ASPIRE status Interviewed, not placed, not Not Proceeding
//   school      none exist; the check is recorded as "no school rules on file" and always passes
// A candidate that fails any rule is gone.
//
// A candidate is one (unit, preceptor): every preceptor on the unit with room is a candidate, so when
// two students want one unit, the second falls to its next preceptor rather than losing the unit.
// What is SHOWN is three different units (the suggestion and two alternatives).

import { PLACEMENT_WEIGHTS, PLACEMENT_RULES } from './suggestionConfig.js'
import { READY_STATUS, POOL_INELIGIBLE_STATUSES } from '../placementReadiness.js'

const INELIGIBLE = new Set(POOL_INELIGIBLE_STATUSES)
export const NIGHT_UNIT = 'Night Shift Preferred'
export const DAY_UNIT = 'Day Shift Preferred'

/** 1, 2 or 3 when the student picked this unit, else null. Names compare exactly, as the board does. */
export function preferenceRank(student, unit) {
  for (const r of [1, 2, 3]) if (unit?.unit_name && student?.[`unit_preference_${r}`] === unit.unit_name) return r
  return null
}

/** Clearance as placement defines it today (Owner, 2026-09-29). */
export const isSuggestable = (s) => !!s && !s.matched_unit_id && s.status === READY_STATUS && !INELIGIBLE.has(s.status)

export function shiftFits(student, unit) {
  if (unit?.shift_preference === NIGHT_UNIT) return student?.nights_available !== false
  return true
}

/** Active primary students per preceptor, this cohort. `assignments` are active primary rows. */
export function preceptorLoads(assignments = []) {
  const load = new Map()
  const seen = new Set()
  for (const a of assignments) {
    if (!a?.preceptor_id || !a?.student_id) continue
    const k = `${a.preceptor_id}|${a.student_id}`
    if (seen.has(k)) continue
    seen.add(k)
    load.set(a.preceptor_id, (load.get(a.preceptor_id) || 0) + 1)
  }
  return load
}

/**
 * The live facts rules run on. `reserved` holds slots and preceptors held by other suggestions of
 * the same batch: { units: Map(unitId -> n), preceptors: Map(preceptorId -> n) }.
 */
export function buildContext({ units = [], matches = [], preceptors = [], assignments = [], rejected = [], reserved = null }) {
  const filled = new Map()
  for (const m of matches) filled.set(m.unit_id, (filled.get(m.unit_id) || 0) + 1)
  const byUnit = new Map()
  for (const p of preceptors) {
    if (!p?.unit_id || p.is_active === false) continue
    if (!byUnit.has(p.unit_id)) byUnit.set(p.unit_id, [])
    byUnit.get(p.unit_id).push(p)
  }
  return {
    units: units.filter(u => u.is_participating),
    filled, byUnit, load: preceptorLoads(assignments),
    rejected: new Set(rejected),
    reserved: reserved || { units: new Map(), preceptors: new Map() },
  }
}

const loadOf = (ctx, pid) => (ctx.load.get(pid) || 0) + (ctx.reserved.preceptors.get(pid) || 0)

/** The best preceptor on a unit with room, or null. */
export function preceptorFor(unit, ctx) {
  const list = (ctx.byUnit.get(unit.id) || []).filter(p => loadOf(ctx, p.id) < PLACEMENT_RULES.preceptorCap)
  list.sort((a, b) => loadOf(ctx, a.id) - loadOf(ctx, b.id) || String(a.full_name || '').localeCompare(String(b.full_name || '')))
  return list[0] || null
}

/**
 * Every hard rule for one student on one unit, as checks: { key, ok, label }. `preceptor` is the
 * preceptor the unit would offer (preceptorFor), or null.
 */
export function ruleChecks(student, unit, preceptor, ctx) {
  const filled = (ctx.filled.get(unit.id) || 0) + (ctx.reserved.units.get(unit.id) || 0)
  const total = Number(unit.total_slots) || 0
  const open = unit.is_participating && filled < total
  const load = preceptor ? loadOf(ctx, preceptor.id) : null
  return [
    { key: 'capacity', ok: open, label: open ? `Capacity ${filled + 1} of ${total}` : `Full: ${filled} of ${total}` },
    { key: 'shift', ok: shiftFits(student, unit), label: shiftFits(student, unit) ? (unit.shift_preference === NIGHT_UNIT ? 'Nights OK' : 'Shift fits') : 'Student cannot work nights' },
    { key: 'preceptor', ok: !!preceptor, label: preceptor ? `Preceptor load ${load}` : 'No preceptor with room' },
    { key: 'clearance', ok: isSuggestable(student), label: isSuggestable(student) ? 'Interviewed' : `Status ${student?.status || 'not set'}` },
    { key: 'school', ok: true, label: 'No school rules on file' },
  ]
}

const passes = (checks) => checks.every(c => c.ok)

/** A candidate's score. `fit` is Keith's experience fit, 0 to 1, or null before Keith has read it. */
export function scoreOf({ rank, load = 0, fit = null }) {
  const w = PLACEMENT_WEIGHTS
  return (w.preference[rank ?? 'none'] ?? 0) + w.experienceFit * (Number.isFinite(fit) ? Math.max(0, Math.min(1, fit)) : 0) - w.preceptorLoad * (load || 0)
}

/**
 * candidatePlacements(student, ctx, { fits }) -> every rule-passing (unit, preceptor), best first.
 * `fits` maps `${unitId}|${preceptorId}` to Keith's fit. A unit that fails a rule is not returned,
 * and `failed` lists why (for the conflict and shadow logs), so nothing is ever silently dropped.
 */
export function candidatePlacements(student, ctx, { fits = new Map() } = {}) {
  const out = []
  const failed = []
  for (const unit of ctx.units) {
    if (ctx.rejected.has(`${student.id}|${unit.id}`)) { failed.push({ unitId: unit.id, reason: 'rejected' }); continue }
    const withRoom = (ctx.byUnit.get(unit.id) || []).filter(p => loadOf(ctx, p.id) < PLACEMENT_RULES.preceptorCap)
    const checks0 = ruleChecks(student, unit, withRoom[0] || null, ctx)
    if (!passes(checks0)) { failed.push({ unitId: unit.id, reason: checks0.filter(c => !c.ok).map(c => c.key).join(',') }); continue }
    const rank = preferenceRank(student, unit)
    for (const preceptor of withRoom) {
      const checks = ruleChecks(student, unit, preceptor, ctx)
      const load = loadOf(ctx, preceptor.id)
      const fit = fits.get(`${unit.id}|${preceptor.id}`)
      out.push({ unitId: unit.id, unitName: unit.unit_name, preceptorId: preceptor.id, preceptorName: preceptor.full_name || '', rank, load, fit: fit ?? null, score: scoreOf({ rank, load, fit }), checks })
    }
  }
  out.sort((a, b) => b.score - a.score || (a.rank ?? 9) - (b.rank ?? 9) || String(a.unitName).localeCompare(String(b.unitName))
    || a.load - b.load || String(a.preceptorName).localeCompare(String(b.preceptorName)))
  return { candidates: out, failed }
}

/** Whether a stored suggestion still passes every rule right now (the board re-checks before showing). */
export function stillValid(student, suggestion, ctx) {
  const unit = ctx.units.find(u => u.id === suggestion.unitId)
  if (!unit || ctx.rejected.has(`${student.id}|${unit.id}`)) return false
  const preceptor = (ctx.byUnit.get(unit.id) || []).find(p => p.id === suggestion.preceptorId)
  if (!preceptor || loadOf(ctx, preceptor.id) >= PLACEMENT_RULES.preceptorCap) return false
  return passes(ruleChecks(student, unit, preceptor, ctx))
}

/**
 * Suggest for every student at once. Each student's options are tried best first; when two want the
 * same last slot (or the same preceptor), the higher score wins, then the better preference rank,
 * then the earlier application date. Every such contest is logged.
 * `options` maps student id -> ranked candidates (candidatePlacements with fits); `appliedAt` maps
 * student id -> ISO date. Returns { picks: Map(studentId -> candidate), conflicts: [...] }.
 */
export function allocate(students, options, ctx, appliedAt = new Map()) {
  const queue = []
  const idx = new Map()
  const push = (s) => {
    const i = idx.get(s.id) ?? 0
    const c = options.get(s.id)?.[i]
    if (c) queue.push({ s, c })
  }
  for (const s of students) { idx.set(s.id, 0); push(s) }
  const better = (a, b) => b.c.score - a.c.score || (a.c.rank ?? 9) - (b.c.rank ?? 9) || String(appliedAt.get(a.s.id) || '9').localeCompare(String(appliedAt.get(b.s.id) || '9'))
  const units = new Map(ctx.units.map(u => [u.id, u]))
  const unitUse = new Map()
  const precUse = new Map()
  const holder = new Map()
  const picks = new Map()
  const conflicts = []
  while (queue.length) {
    queue.sort(better)
    const { s, c } = queue.shift()
    if (picks.has(s.id)) continue
    const unit = units.get(c.unitId)
    const filled = (ctx.filled.get(c.unitId) || 0) + (unitUse.get(c.unitId) || 0)
    const unitRoom = filled < (Number(unit?.total_slots) || 0)
    const precRoom = (ctx.load.get(c.preceptorId) || 0) + (precUse.get(c.preceptorId) || 0) < PLACEMENT_RULES.preceptorCap
    if (unitRoom && precRoom) {
      picks.set(s.id, c)
      unitUse.set(c.unitId, (unitUse.get(c.unitId) || 0) + 1)
      precUse.set(c.preceptorId, (precUse.get(c.preceptorId) || 0) + 1)
      holder.set(`u:${c.unitId}`, s.id)
      holder.set(`p:${c.preceptorId}`, s.id)
      continue
    }
    const winner = holder.get(unitRoom ? `p:${c.preceptorId}` : `u:${c.unitId}`) || null
    const won = winner ? picks.get(winner) : null
    const decidedBy = !won ? 'already full' : won.score !== c.score ? 'score'
      : (won.rank ?? 9) !== (c.rank ?? 9) ? 'preference rank' : 'application date'
    conflicts.push({ studentId: s.id, unitId: c.unitId, unitName: c.unitName, preceptorId: c.preceptorId, over: unitRoom ? 'preceptor' : 'last slot', winnerId: winner, decidedBy })
    idx.set(s.id, (idx.get(s.id) || 0) + 1)
    push(s)
  }
  return { picks, conflicts }
}
