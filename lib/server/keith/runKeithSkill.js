// lib/server/keith/runKeithSkill.js
//
// KEITH-FOUNDATION-1 (2026-09-28): the ONE way a Keith feature reaches the model. Every Skill run
// goes through runKeithSkill, and every person's action on its output goes through
// recordKeithOutcome. Chat (api/keith.js) keeps its own tool loop; this is for Skills that produce
// a structured output attached to a record.
//
// runKeithSkill(db, skillKey, input, context)
//   1. refuses when the Skill is OFF (not active, or disabled), when the caller may not run it,
//      or when `input` names anything the Skill did not declare (skillDefs.inputs);
//   2. makes one tool-free completion (anthropicClient.completeWithoutTools, or context.complete);
//   3. checks the output against the Skill's JSON schema, then its parse. Invalid output is logged
//      (the problems, never the text) and dropped: the caller gets { ok: false }, nothing is shown;
//   4. records the cost in Usage & Cost (keith_requests, under the Skill's id, so it lists by name)
//      and the metadata-only invocation audit (keith_skill_invocations);
//   5. writes one keith_provenance row, state 'drafted', with the Skill's mode at that moment, and
//      returns the output with its provenance id.
// In SHADOW mode it does all of that too. The runner cannot stop a feature acting, so the result
// says `mode: 'shadow'` and the feature must take no action on the output (it records the person's
// own decision with recordKeithOutcome(id, 'observe', { label })).
//
// Provenance is best-effort in one way only: before the foundation migration the table does not
// exist, and the run still succeeds with provenanceId null (no mark shows). Any other write error
// is logged and also returns null: a failed audit row must not lose a reading the person needs.

import { randomUUID } from 'node:crypto'
import { resolveRoute } from './modelRouting.js'
import { completeWithoutTools } from './anthropicClient.js'
import { recordKeithUsage, recordSkillInvocation, OUTCOMES } from './usageLog.js'
import { authorizeSkillForCaller } from './skillAuthorization.js'
import { validate, jsonFromText } from './outputSchema.js'
import { SKILL_DEFS } from './skillDefs.js'
import { skillMode, nextState, mergeDiff, computeAgreement } from '../../../src/lib/keith/provenanceModel.js'

const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])
const missingTable = (error) => MISSING.has(error?.code) || /does not exist|could not find the table/i.test(error?.message || '')

export class KeithSkillError extends Error {
  constructor(reason, message, status = 409) { super(message); this.reason = reason; this.status = status }
}

/** The skill row, or null. select('*') so a database without run_mode still answers. */
export async function loadSkill(db, skillKey) {
  const { data, error } = await db.from('keith_skills').select('*').eq('slug', skillKey).limit(1)
  if (error) throw new KeithSkillError('catalog_failed', 'Keith’s skills could not be read.', 500)
  return data?.[0] || null
}

export const skillVersionOf = (skill, def) => `${Number(skill?.version) || 0}.${def.outputVersion}`

/**
 * Run a Skill. `input` is { name: { value, refs?: [{type, id}] } } for exactly the Skill's declared
 * inputs; `value` is what the model is sent, `refs` the IDs recorded in provenance.
 * `context`: { actor, entity: { id, field? }, complete?, requestId?, invocationMode?, defs? }.
 * Returns { ok: true, output, provenanceId, mode, model, usage } or { ok: false, reason, message, status }.
 */
export async function runKeithSkill(db, skillKey, input, context = {}) {
  const defs = context.defs || SKILL_DEFS
  const def = defs[skillKey]
  if (!def) throw new KeithSkillError('unknown_skill', `No Skill named ${skillKey} is defined.`, 500)

  // Inputs: exactly what the Skill declared, nothing more.
  const given = Object.keys(input || {})
  const extra = given.filter(k => !def.inputs.includes(k))
  const missing = def.inputs.filter(k => !given.includes(k))
  if (extra.length || missing.length) {
    throw new KeithSkillError('bad_input', `Skill ${skillKey} ${extra.length ? `was sent undeclared input: ${extra.join(', ')}` : `is missing input: ${missing.join(', ')}`}.`, 500)
  }

  const skill = await loadSkill(db, skillKey)
  const mode = skillMode(skill)
  const actor = context.actor || null
  const caller = { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }
  if (mode === 'off') return { ok: false, reason: 'off', status: 409, message: `Keith’s ${skill?.display_name || skillKey} skill is off.` }
  // context.system: a server sweep with no person behind it (KEITH-CHECKIN-1's cron). Only server
  // code can set it; the OFF switch above still applies, and usage is logged under role 'system'.
  if (context.system !== true && !authorizeSkillForCaller(skill, caller).ok) return { ok: false, reason: 'denied', status: 403, message: `You cannot run Keith’s ${skill.display_name} skill.` }

  const started = Date.now()
  const requestId = context.requestId || randomUUID()
  const baseRoute = resolveRoute(skill.model_route)
  const req = def.request({ skill, input, context })
  const route = typeof req.route === 'function' ? req.route(baseRoute) : baseRoute
  const complete = context.complete || completeWithoutTools
  const roleOf = context.system === true ? 'system' : actor?.is_owner ? 'owner' : actor?.role
  const meter = (outcome, usage = {}, model = route.model) => recordKeithUsage(db, {
    requestId, profileId: actor?.id, role: roleOf, intent: def.intent, skillId: skill.id,
    skillVersion: Number(skill.version) || null, model, modelRoute: route.route, rounds: 1,
    inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0, durationMs: Date.now() - started, outcome,
  })
  const refs = given.flatMap(k => (Array.isArray(input[k].refs) ? input[k].refs : [])).map(r => ({ type: String(r.type), id: String(r.id) }))

  const out = await complete({ route, system: req.system, messages: req.messages, timeoutMs: req.timeoutMs || 18000 })
  if (!out?.ok) {
    await meter(out?.reason === 'upstream_rate_limited' ? OUTCOMES.RATE_LIMITED : OUTCOMES.ERROR)
    return { ok: false, reason: out?.reason || 'upstream_error', status: out?.status || 502 }
  }

  // Validate, then parse. Either failing drops the output.
  // `stage` says where it failed (json, schema, parse) so a feature can say why in its own words.
  let output
  let stage = 'json'
  try {
    const json = jsonFromText(out.text)
    stage = 'schema'
    const problems = validate(def.schema, json)
    if (problems.length) {
      console.warn('[keith-runner] output failed its schema; dropped', { skill: skillKey, request_id: requestId, problems: problems.slice(0, 12) })
      await meter(OUTCOMES.ERROR, out.usage, out.model)
      return { ok: false, reason: 'invalid_output', stage, status: 502, problems }
    }
    stage = 'parse'
    output = def.parse ? def.parse(json, input) : json
  } catch (e) {
    console.warn('[keith-runner] output could not be parsed; dropped', { skill: skillKey, request_id: requestId, stage, code: e?.code || e?.name || 'Error' })
    await meter(OUTCOMES.ERROR, out.usage, out.model)
    return { ok: false, reason: 'invalid_output', stage, status: 502, error: e }
  }

  await meter(OUTCOMES.COMPLETED, out.usage, out.model)
  // Metadata only: which records, never what they say.
  await recordSkillInvocation(db, {
    requestId, profileId: actor?.id, role: roleOf, model: out.model,
    inputTokens: out.usage?.inputTokens || 0, outputTokens: out.usage?.outputTokens || 0, durationMs: Date.now() - started,
    skillId: skill.id, skillSlug: skill.slug, skillVersion: Number(skill.version) || null,
    invocationMode: context.invocationMode || 'picker', dataSources: { refs, mode, ...(context.dataSources || {}) }, outcome: OUTCOMES.COMPLETED,
  })

  const prov = def.provenance ? def.provenance(output) : {}
  const provenanceId = await writeProvenance(db, {
    skill_key: skillKey, skill_version: skillVersionOf(skill, def), entity_type: def.entityType, entity_id: context.entity?.id,
    field: context.entity?.field ?? def.field ?? null, input_refs: refs, output,
    confidence: prov.confidence || null, reason: prov.reason || null, mode, state: 'drafted',
  })
  return { ok: true, output, provenanceId, mode, model: out.model, usage: out.usage, requestId }
}

async function writeProvenance(db, row) {
  try {
    const { data, error } = await db.from('keith_provenance').insert(row).select('id')
    if (error) {
      if (!missingTable(error)) console.warn('[keith-provenance] insert failed', { skill: row.skill_key, code: error.code })
      return null
    }
    return data?.[0]?.id || null
  } catch (err) {
    console.warn('[keith-provenance] insert threw', { skill: row.skill_key, reason: err?.message })
    return null
  }
}

/**
 * A person acted on a Keith output. `action` is edit | accept | reject | undo | revert | observe.
 *   edit     `diff` is a list of { field, item?, from, to }; it merges into what is recorded, and a
 *            record whose edits all went back to Keith's values reads as drafted again
 *   observe  shadow mode: `diff` is { label }, the person's own decision on the same entity
 * Compare-and-set on the state, so two tabs cannot both move it. Returns the new state, or null
 * when nothing was written (no record, an action that does not apply, a lost race, no table).
 */
export async function recordKeithOutcome(db, provenanceId, action, diff = null, actor = null) {
  if (!provenanceId) return null
  try {
    const { data, error } = await db.from('keith_provenance').select('id, state, human_diff').eq('id', provenanceId).limit(1)
    if (error || !data?.[0]) return null
    const row = data[0]
    const hd = row.human_diff && typeof row.human_diff === 'object' && !Array.isArray(row.human_diff) ? row.human_diff : {}
    const prior = Array.isArray(hd.edits) && hd.edits.length ? 'edited' : 'drafted'
    let next = nextState(row.state, action, { prior })
    if (!next) return null
    let human = hd
    if (action === 'edit') {
      const edits = mergeDiff(hd.edits, diff)
      human = { ...hd, edits }
      if (!edits.length && (row.state === 'drafted' || row.state === 'edited')) next = 'drafted'
    } else if (action === 'observe') {
      human = { ...hd, label: diff?.label ?? null }
    }
    const patch = { state: next, human_diff: human, human_action_by: actor?.id || null, human_action_at: new Date().toISOString() }
    const { data: upd, error: uerr } = await db.from('keith_provenance').update(patch).eq('id', provenanceId).eq('state', row.state).select('id')
    if (uerr) { console.warn('[keith-provenance] outcome failed', { action, code: uerr.code }); return null }
    return upd?.length ? next : null
  } catch (err) {
    console.warn('[keith-provenance] outcome threw', { action, reason: err?.message })
    return null
  }
}

/** The latest provenance id for an entity, or null (and null before the migration). */
export async function provenanceIdFor(db, entityType, entityId) {
  if (!entityId) return null
  const map = await provenanceIdsFor(db, entityType, [entityId])
  return map.get(entityId) || null
}

/** Latest provenance id per entity, for many entities at once. */
export async function provenanceIdsFor(db, entityType, entityIds) {
  const ids = [...new Set((entityIds || []).filter(Boolean))]
  const out = new Map()
  if (!ids.length) return out
  try {
    const { data, error } = await db.from('keith_provenance').select('id, entity_id, created_at').eq('entity_type', entityType).in('entity_id', ids).order('created_at', { ascending: false })
    if (error) return out
    for (const r of data || []) if (!out.has(r.entity_id)) out.set(r.entity_id, r.id)
  } catch { /* before the migration: no marks */ }
  return out
}

/**
 * Shadow mode agreement for one Skill: every shadow row with a person's decision, Keith's label
 * (the Skill's labelOf) against theirs. A Skill without labelOf has no agreement figure.
 */
export async function shadowAgreement(db, skillKey, { defs = SKILL_DEFS } = {}) {
  const def = defs[skillKey]
  if (!def?.labelOf) return computeAgreement([])
  const { data, error } = await db.from('keith_provenance').select('output, human_diff').eq('skill_key', skillKey).eq('mode', 'shadow')
  if (error) return computeAgreement([])
  return computeAgreement((data || []).map(r => ({ keith: def.labelOf(r.output), human: r.human_diff?.label ?? null })), def.agrees)
}

/**
 * Owner action: switch a Skill between shadow and on, logged with the agreement at that moment.
 * OFF stays the existing Disable action. Returns { from, to, agreement }.
 */
export async function setSkillMode(db, skillKey, toMode, actor, { defs = SKILL_DEFS } = {}) {
  if (actor?.is_owner !== true) throw new KeithSkillError('forbidden', 'Only the Owner can change a skill’s mode.', 403)
  if (!['shadow', 'on'].includes(toMode)) throw new KeithSkillError('bad_mode', 'Choose Shadow or On.', 400)
  const skill = await loadSkill(db, skillKey)
  if (!skill) throw new KeithSkillError('not_found', 'That skill no longer exists.', 404)
  if (!('run_mode' in skill)) throw new KeithSkillError('not_enabled', 'Skill modes need the Keith foundation database update (20261016000000_keith_foundation.sql).', 409)
  const from = skill.run_mode === 'shadow' ? 'shadow' : 'on'
  if (from === toMode) return { from, to: toMode, agreement: null, unchanged: true }
  const agreement = await shadowAgreement(db, skillKey, { defs })
  // A Skill may hold the switch to On behind its own rule (KEITH-CHECKIN-1: 14 days, none kept open).
  if (toMode === 'on' && defs[skillKey]?.gateOn) {
    const gate = await defs[skillKey].gateOn(db)
    if (!gate?.ok) throw new KeithSkillError('gate_closed', gate?.message || 'This skill cannot be turned on yet.', 409)
  }
  const { error } = await db.from('keith_skills').update({ run_mode: toMode, updated_by: actor.id || null }).eq('id', skill.id)
  if (error) throw new KeithSkillError('save_failed', 'The skill’s mode could not be saved.', 500)
  const { error: lerr } = await db.from('keith_skill_mode_changes').insert({ skill_id: skill.id, skill_key: skillKey, from_mode: from, to_mode: toMode, agreement, changed_by: actor.id || null })
  if (lerr) console.warn('[keith-mode] change log failed', { skill: skillKey, code: lerr.code })
  return { from, to: toMode, agreement }
}
