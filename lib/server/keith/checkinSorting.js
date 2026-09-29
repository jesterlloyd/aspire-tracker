// lib/server/keith/checkinSorting.js
//
// KEITH-CHECKIN-1 (2026-09-29): Keith sorts support check-in replies the rules did not catch.
// Reference: 1 · Check-in sorting in docs/mockups/keith-workflow.html; the rules are
// src/lib/keith/checkinSortModel.js.
//
//   sweep       the cron's work. Sorts replies whose latest event is still rule 3 or 4's (open,
//               untouched by a person), from the last 14 days, 25 at a time, REAL rows only (the
//               caller hands a populationDb client: student_shift_logs is inside the boundary).
//               Skill OFF: nothing. SHADOW: provenance only, nothing acts. ON: writes Keith's event
//               (closes a thank-you; labels the rest), after checking again that no person has
//               acted and that the reply has no safety term. It also records, for every shadow
//               sort, the decision a person made on the same reply (observeShadow).
//   queueView   what the Action Center shows: each reply's sort, the daily line, the shadow card.
//   reopen      a reply Keith closed goes back to the queue; its provenance is reverted.
//   undoReopen  the Undo on that toast: Keith's close again, the provenance back to drafted.
//
// support_checkin_events is unique on (shift_log_id, reply_fingerprint, status, rule_key), so an
// event this module writes more than once for the same reply carries a '#<time>' suffix on its
// rule_key; everything that reads a rule key reads it up to the '#'.

import { runKeithSkill, recordKeithOutcome, loadSkill } from './runKeithSkill.js'
import { SKILL_DEFS } from './skillDefs.js'
import { checkinShadowFigures } from './checkinShadow.js'
import {
  SKILL_KEY, KEITH_SORTS_RULES, hasSafetyTerm, eventFor, isKeithClose, humanLabelOf, gateState,
} from '../../../src/lib/keith/checkinSortModel.js'
import { skillMode } from '../../../src/lib/keith/provenanceModel.js'

const DAY = 86400000
const WINDOW_DAYS = 14
const CORRECTIONS = 20
export const ruleOf = (key) => String(key || '').split('#')[0]
const stamp = (rule) => `${rule}#${Date.now().toString(36)}`

/** The latest event per shift log. */
function latestByLog(events) {
  const out = new Map()
  for (const e of events || []) {
    const prior = out.get(e.shift_log_id)
    if (!prior || e.created_at > prior.created_at || (e.created_at === prior.created_at && String(e.id) > String(prior.id))) out.set(e.shift_log_id, e)
  }
  return out
}

async function provenanceFor(db, shiftLogIds) {
  if (!shiftLogIds.length) return []
  const out = []
  for (let i = 0; i < shiftLogIds.length; i += 200) {
    const { data, error } = await db.from('keith_provenance').select('id, entity_id, field, output, state, mode, human_diff, created_at')
      .eq('skill_key', SKILL_KEY).eq('entity_type', 'checkin_reply').in('entity_id', shiftLogIds.slice(i, i + 200)).order('created_at', { ascending: false })
    if (error) return []
    out.push(...(data || []))
  }
  return out
}

/** The replies a person reopened after Keith closed them, latest first: Keith's corrections. */
export async function correctionsFor(db) {
  const { data, error } = await db.from('keith_provenance').select('entity_id, updated_at')
    .eq('skill_key', SKILL_KEY).eq('state', 'reverted').order('updated_at', { ascending: false }).limit(CORRECTIONS)
  if (error || !data?.length) return []
  const { data: logs } = await db.from('student_shift_logs').select('id, support_needed').in('id', data.map(r => r.entity_id))
  const text = new Map((logs || []).map(l => [l.id, String(l.support_needed || '').trim()]))
  return data.map(r => text.get(r.entity_id)).filter(Boolean).map(t => t.slice(0, 400))
}

/** Record, on every shadow sort, the decision a person made on the same reply. */
export async function observeShadow(db, { limit = 500 } = {}) {
  const { data, error } = await db.from('keith_provenance').select('id, entity_id, field, human_diff')
    .eq('skill_key', SKILL_KEY).eq('mode', 'shadow').order('created_at', { ascending: false }).limit(limit)
  if (error || !data?.length) return 0
  const ids = [...new Set(data.map(r => r.entity_id))]
  const staff = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ev } = await db.from('support_checkin_events').select('id, shift_log_id, reply_fingerprint, rule_key, actor_profile_id, created_at')
      .in('shift_log_id', ids.slice(i, i + 200)).like('rule_key', 'staff_%')
    staff.push(...(ev || []))
  }
  let n = 0
  for (const row of data) {
    const mine = staff.filter(e => e.shift_log_id === row.entity_id && e.reply_fingerprint === row.field)
    const last = latestByLog(mine).get(row.entity_id)
    const label = last ? humanLabelOf(ruleOf(last.rule_key)) : null
    if (!label || row.human_diff?.label === label) continue
    if (await recordKeithOutcome(db, row.id, 'observe', { label }, last.actor_profile_id ? { id: last.actor_profile_id } : null)) n += 1
  }
  return n
}

/**
 * The cron's work. `complete` is the model call (a test passes a stub). Returns what it did.
 */
export async function sweep(db, { complete, now = Date.now(), limit = 25 } = {}) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  const mode = skillMode(skill)
  const out = { mode, candidates: 0, sorted: 0, closed: 0, labeled: 0, skipped_safety: 0, failed: 0, observed: 0 }
  if (skill && 'run_mode' in skill) out.observed = await observeShadow(db)
  if (mode === 'off') return out

  const since = new Date(now - WINDOW_DAYS * DAY).toISOString()
  const { data: events, error } = await db.from('support_checkin_events')
    .select('id, shift_log_id, student_id, cohort_id, reply_fingerprint, classification, status, rule_key, created_at')
    .gte('created_at', since)
  if (error) throw new Error(`check-in events could not be read (${error.code || 'error'})`)
  const latest = latestByLog(events)
  let open = [...latest.values()].filter(e => e.status === 'open' && KEITH_SORTS_RULES.includes(ruleOf(e.rule_key)))
  if (!open.length) return out

  // Only real replies: the caller's client is scoped, and student_shift_logs is inside the boundary.
  const { data: logs } = await db.from('student_shift_logs').select('id, support_needed').in('id', open.map(e => e.shift_log_id))
  const replyOf = new Map((logs || []).map(l => [l.id, String(l.support_needed || '').trim()]))
  const sorted = new Set((await provenanceFor(db, open.map(e => e.shift_log_id))).map(p => `${p.entity_id}|${p.field}`))
  open = open.filter(e => replyOf.get(e.shift_log_id) && !sorted.has(`${e.shift_log_id}|${e.reply_fingerprint}`))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, limit)
  out.candidates = open.length
  if (!open.length) return out
  const corrections = await correctionsFor(db)

  for (const e of open) {
    const reply = replyOf.get(e.shift_log_id)
    // Rule 1 already sent these to Urgent; checked again so nothing Keith does can reach one.
    if (hasSafetyTerm(reply)) { out.skipped_safety += 1; continue }
    const run = await runKeithSkill(db, SKILL_KEY, {
      reply: { value: reply, refs: [{ type: 'checkin_reply', id: e.shift_log_id }] },
      corrections: { value: corrections },
    }, { system: true, entity: { id: e.shift_log_id, field: e.reply_fingerprint }, complete, defs: SKILL_DEFS })
    if (!run.ok) { out.failed += 1; continue }
    out.sorted += 1
    if (run.mode !== 'on') continue

    // ON: act only if the reply is still exactly where Keith found it.
    const { data: now2 } = await db.from('support_checkin_events').select('id, rule_key, status, created_at').eq('shift_log_id', e.shift_log_id).order('created_at', { ascending: false }).limit(1)
    if (!now2?.[0] || now2[0].id !== e.id) continue
    const ev = eventFor(run.output, reply)
    const { error: werr } = await db.from('support_checkin_events').insert({
      shift_log_id: e.shift_log_id, student_id: e.student_id, cohort_id: e.cohort_id, reply_fingerprint: e.reply_fingerprint,
      classification: ev.classification, status: ev.status, rule_key: ev.rule_key,
    })
    if (werr) { out.failed += 1; continue }
    if (ev.status === 'closed_auto') out.closed += 1
    else out.labeled += 1
  }
  return out
}

const pacificDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

/**
 * What the Action Center shows for one cohort: the skill's mode, each reply's latest sort, the
 * replies Keith closed in the last 7 days by day, and the shadow card.
 */
export async function queueView(db, { cohortId, now = Date.now() } = {}) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (!skill || !('run_mode' in skill)) return { available: false, mode: 'off', sorts: {}, daily: [], card: null }
  const mode = skillMode(skill)
  await observeShadow(db, { limit: 200 })

  const { data: events } = await db.from('support_checkin_events').select('id, shift_log_id, reply_fingerprint, status, rule_key, created_at')
    .eq('cohort_id', cohortId)
  const latest = latestByLog(events || [])
  const prov = await provenanceFor(db, [...latest.keys()])
  const sorts = {}
  for (const p of prov) {
    const ev = latest.get(p.entity_id)
    if (!ev || ev.reply_fingerprint !== p.field || sorts[p.entity_id]) continue
    sorts[p.entity_id] = {
      provenanceId: p.id, label: p.output?.label, requestType: p.output?.request_type ?? null,
      confidence: p.output?.confidence, state: p.state, mode: p.mode,
    }
  }
  // The daily line: Keith's closes of the last 7 days that are still closed, by Pacific day.
  const weekAgo = now - 7 * DAY
  const byDay = new Map()
  for (const ev of latest.values()) {
    if (ev.status !== 'closed_auto' || !isKeithClose(ev.rule_key) || new Date(ev.created_at).getTime() < weekAgo) continue
    const day = pacificDay(ev.created_at)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push({ shiftLogId: ev.shift_log_id, provenanceId: sorts[ev.shift_log_id]?.provenanceId || null, at: ev.created_at })
  }
  const daily = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, items]) => ({ day, items: items.sort((a, b) => (a.at < b.at ? 1 : -1)) }))

  const f = await checkinShadowFigures(db)
  const gate = gateState({ firstShadowAt: f.firstShadowAt, keptOpen: f.keptOpen, now })
  return {
    available: true, mode, runMode: skill.run_mode === 'shadow' ? 'shadow' : 'on', today: pacificDay(now), sorts, daily,
    card: { agreement: f.agreement, keptOpen: f.keptOpen, sorted: f.sorted, firstShadowAt: f.firstShadowAt, gate },
  }
}

async function latestEvent(db, shiftLogId) {
  const { data, error } = await db.from('support_checkin_events').select('*').eq('shift_log_id', shiftLogId).order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error('The check-in could not be read.')
  return data?.[0] || null
}
async function provenanceOf(db, shiftLogId, fingerprint) {
  const { data } = await db.from('keith_provenance').select('id').eq('skill_key', SKILL_KEY).eq('entity_type', 'checkin_reply')
    .eq('entity_id', shiftLogId).eq('field', fingerprint).order('created_at', { ascending: false }).limit(1)
  return data?.[0]?.id || null
}

export class CheckinError extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status } }

/** Reopen a reply Keith closed: back to the queue, its provenance reverted (a correction for Keith). */
export async function reopen(db, actor, { shiftLogId }) {
  const ev = await latestEvent(db, shiftLogId)
  if (!ev || ev.status !== 'closed_auto' || !isKeithClose(ev.rule_key)) throw new CheckinError('not_keith_closed', 'Keith did not close this reply, or it was already reopened.')
  const { error } = await db.from('support_checkin_events').insert({
    shift_log_id: ev.shift_log_id, student_id: ev.student_id, cohort_id: ev.cohort_id, reply_fingerprint: ev.reply_fingerprint,
    classification: 'needs_look', status: 'reopened', rule_key: stamp('staff_reopen'), actor_profile_id: actor?.id || null,
  })
  if (error) throw new CheckinError('save_failed', 'The reply could not be reopened.', 500)
  await recordKeithOutcome(db, await provenanceOf(db, ev.shift_log_id, ev.reply_fingerprint), 'revert', null, actor)
  return { reopened: true }
}

/** Undo a Reopen: Keith's close again, and its provenance back to what Keith did. */
export async function undoReopen(db, actor, { shiftLogId }) {
  const ev = await latestEvent(db, shiftLogId)
  if (!ev || ev.status !== 'reopened' || ruleOf(ev.rule_key) !== 'staff_reopen') throw new CheckinError('not_reopened', 'This reply is no longer the one you reopened.')
  const reply = (await db.from('student_shift_logs').select('support_needed').eq('id', shiftLogId).limit(1)).data?.[0]?.support_needed
  if (hasSafetyTerm(reply)) throw new CheckinError('safety', 'This reply mentions a safety term, so it stays open.')
  const { error } = await db.from('support_checkin_events').insert({
    shift_log_id: ev.shift_log_id, student_id: ev.student_id, cohort_id: ev.cohort_id, reply_fingerprint: ev.reply_fingerprint,
    classification: 'thank_you', status: 'closed_auto', rule_key: stamp('keith_thank_you'), actor_profile_id: actor?.id || null,
  })
  if (error) throw new CheckinError('save_failed', 'The reply could not be closed again.', 500)
  await recordKeithOutcome(db, await provenanceOf(db, ev.shift_log_id, ev.reply_fingerprint), 'undo', null, actor)
  return { closed: true }
}
