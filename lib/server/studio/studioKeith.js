// lib/server/studio/studioKeith.js
//
// STUDIO-3 (Phase 2b, 2026-11-05): Keith in Studio, behind /api/studio (Owner and Admin; the
// endpoint has already checked). Three actions:
//
//   keith_brief   { conversation: { request, turns[] }, design_ref }
//        -> { kind: 'question', question, why, choices, multi, allowOther } | { kind: 'brief', brief }
//   keith_design  { conversation, brief, design_ref } -> { design, provenanceId }
//   keith_rewrite { block, ask, design_ref }         -> { block, provenanceId }
//
// What Keith is shown is `studioFacts`: cohort names and dates, residency key dates, published
// Catalog form titles, and COUNTS (students by status and school, alumni by form, licence and
// hire, contacts by category). Never a name, an address or a record. Everything he returns passes
// src/lib/studio/keithStudio.js, which drops a link the person did not type and a form he was not
// shown. Nothing here sends: the design opens as a draft and the send drawer still decides.
//
// design_ref is the design's id, or a conversation id the browser made, so his provenance has a
// subject before the design is saved. Before the skills are seeded (20261201000000) every action
// answers 409 not_enabled, and Studio shows no Ask Keith.

import { runKeithSkill } from '../keith/runKeithSkill.js'
import { cleanConversation, urlsFromConversation, REWRITES, REWRITABLE } from '../../../src/lib/studio/keithStudio.js'
import { sanitizeDesign } from '../../../src/lib/studio/studioBlocks.js'
import { sanitizeRule, RULE_STATUSES, CONTACT_CATEGORIES } from '../../../src/lib/studio/audienceCatalog.js'
import { canonicalCategory } from '../../../src/lib/contactCategories.js'
import { digestCycles } from '../../../src/lib/ngrp/residencyDigestModel.js'
import { hasSubmittedForm } from '../ngrpTalentAcquisition.js'
import { isHired } from '../ngrpResidencyRecipient.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SKILLS = ['studio-brief', 'studio-design']
const MAX_COHORTS = 6
const MAX_CYCLES = 3

export const KEITH_ACTIONS = new Set(['keith_brief', 'keith_design', 'keith_rewrite'])

const err = (status, message, code) => Object.assign(new Error(message), { status, code })

/** Are both Skills seeded and on? Read by status, so the screen offers Ask Keith only then. */
export async function keithAvailable(db) {
  const { data, error } = await db.from('keith_skills').select('slug, enabled, status, run_mode').in('slug', SKILLS)
  if (error) return false
  const on = new Set((data || []).filter(s => s.enabled !== false && s.status === 'active' && s.run_mode !== 'off').map(s => s.slug))
  return SKILLS.every(s => on.has(s))
}

const tally = (rows, key) => {
  const out = {}
  for (const r of rows) { const k = key(r); if (k) out[k] = (out[k] || 0) + 1 }
  return out
}

/** Counts per status and per school for each recent ASPIRE cohort. Pure. */
export function cohortFacts(cohorts, students) {
  return cohorts.map(c => {
    const mine = students.filter(s => s.cohort_id === c.id)
    return {
      id: c.id, name: c.name, status: c.status,
      dates: { starts: c.start_date || null, ends: c.end_date || null },
      students: mine.length,
      byStatus: tally(mine.filter(s => RULE_STATUSES.includes(s.status)), s => s.status),
      notProceeding: mine.filter(s => s.status === 'Not Proceeding').length,
      bySchool: tally(mine, s => String(s.school || '').trim()),
    }
  })
}

/** Counts for one residency roster: the choices a rule can make, each with how many it holds. Pure. */
export function cycleFacts(cycle, payload) {
  const cands = new Map((payload?.candidates || []).map(c => [c.student_id, c]))
  const roster = (payload?.students || []).map(s => cands.get(s.id) || {})
  const submitted = roster.filter(c => hasSubmittedForm(c.form_status))
  return {
    id: cycle.id, name: cycle.name, status: cycle.status,
    keyDates: {
      applicationOpens: cycle.application_open_date || null, applicationDeadline: cycle.application_deadline || null,
      interviewsBegin: cycle.interview_window_start || null, interviewsEnd: cycle.interview_window_end || null,
      residencyStarts: cycle.residency_start_date || null,
    },
    roster: roster.length,
    formSubmitted: submitted.length,
    formNotSubmitted: roster.length - submitted.length,
    // The Transition Form's licence answer: active = Licensed, pending = NCLEX Ahead, none = Not Yet.
    licenseAmongSubmitted: tally(submitted, c => c.form_rn_status || 'none'),
    hired: roster.filter(c => isHired(c.outcome)).length,
  }
}

/**
 * Everything Keith may know, in the request's population. `pop` is the population-scoped client
 * (demo or real); `admin` the service client for the skill rows and forms. `deps` lets a test
 * substitute the residency loader.
 */
export async function studioFacts(pop, admin, deps = {}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const [cohortsQ, cyclesQ, contactsQ, formsQ] = await Promise.all([
    pop.from('cohorts').select('id, name, status, start_date, end_date').order('start_date', { ascending: false, nullsFirst: false }).limit(MAX_COHORTS),
    pop.from('ngrp_cycles').select('id, name, status, application_open_date, application_deadline, interview_window_start, interview_window_end, residency_start_date').limit(40),
    pop.from('contacts').select('category').eq('is_active', true),
    admin.from('catalog_resources').select('title, storage_path, is_active').eq('kind', 'form'),
  ])
  if (cohortsQ.error) throw cohortsQ.error
  const cohorts = cohortsQ.data || []
  let students = []
  if (cohorts.length) {
    const { data, error } = await pop.from('students').select('cohort_id, status, school').in('cohort_id', cohorts.map(c => c.id))
    if (error) throw error
    students = data || []
  }

  const cycles = digestCycles(cyclesQ.error ? [] : (cyclesQ.data || [])).slice(0, MAX_CYCLES)
  const residency = []
  if (cycles.length) {
    const load = deps.loadApplicantsPayload || (await import('../ngrpApplicants.js')).loadApplicantsPayload
    for (const c of cycles) {
      try {
        const payload = await load(pop, c.id)
        residency.push(cycleFacts(c, payload?.state === 'ok' ? payload : null))
      } catch { residency.push(cycleFacts(c, null)) }
    }
  }

  // Published forms only: a draft has no link to give anyone.
  const formRows = (formsQ.error ? [] : formsQ.data || []).filter(r => r.is_active !== false && /^form:/.test(r.storage_path || ''))
  let forms = formRows.map(r => ({ id: r.storage_path.slice(5), title: r.title })).filter(f => UUID.test(f.id))
  if (forms.length) {
    const { data, error } = await admin.from('catalog_forms').select('id, status').in('id', forms.map(f => f.id))
    const live = new Set((error ? [] : data || []).filter(f => f.status === 'published').map(f => f.id))
    forms = forms.filter(f => live.has(f.id)).slice(0, 40)
  }

  const contacts = tally(contactsQ.error ? [] : contactsQ.data || [], r => canonicalCategory(r.category))
  return {
    today,
    cohorts: cohortFacts(cohorts, students),
    residency,
    forms,
    contactsByCategory: Object.fromEntries(CONTACT_CATEGORIES.map(k => [k, contacts[k] || 0])),
  }
}

const refOf = (v) => (UUID.test(String(v || '')) ? String(v) : null)
const actorOf = (ctx) => ({ id: ctx.profileId, role: ctx.role, is_owner: ctx.isOwner === true })

function refused(res) {
  if (res.reason === 'off') return err(409, res.message || 'Keith’s Studio skills are off.', 'not_enabled')
  if (res.reason === 'denied') return err(403, res.message || 'You cannot ask Keith to do that.', 'denied')
  if (res.reason === 'invalid_output' && res.error?.code === 'too_many_questions') return err(502, 'Keith kept asking questions. Try again.', 'too_many_questions')
  if (res.reason === 'invalid_output') return err(502, 'Keith’s answer could not be used. Try again.', 'invalid_output')
  return err(res.status || 502, 'Keith could not answer just now. Try again.', res.reason || 'upstream_error')
}

export async function runKeithAction(action, body, ctx) {
  const { admin, pop } = ctx
  const entityId = refOf(body.design_ref)
  if (!entityId) throw err(400, 'A design reference is required.')
  const run = (skill, input) => (ctx.runSkill || runKeithSkill)(admin, skill, input, {
    actor: actorOf(ctx), entity: { id: entityId }, invocationMode: 'picker',
  })

  if (action === 'keith_rewrite') {
    const block = sanitizeDesign({ blocks: [body.block] }).blocks[0]
    if (!block || !REWRITABLE.includes(block.type)) throw err(400, 'Keith rewrites blocks that hold words.')
    const preset = REWRITES.find(r => r.key === body.ask)
    const ask = preset ? preset.ask : String(body.ask || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!ask) throw err(400, 'Say how to rewrite it.')
    const res = await run('studio-design-rewrite', { block: { value: block }, ask: { value: ask } })
    if (!res.ok) throw refused(res)
    return { block: res.output, provenanceId: res.provenanceId || null }
  }

  const conversation = cleanConversation(body.conversation)
  if (!conversation.request) throw err(400, 'Tell Keith what the email is for.')
  const facts = await studioFacts(pop, admin, ctx.deps)

  if (action === 'keith_brief') {
    const res = await run('studio-brief', { conversation: { value: conversation }, facts: { value: facts } })
    if (!res.ok) throw refused(res)
    return { ...res.output, provenanceId: res.provenanceId || null }
  }

  // keith_design: the brief the screen shows is checked again here, never trusted as sent.
  const b = body.brief && typeof body.brief === 'object' ? body.brief : null
  if (!b) throw err(400, 'Finish the brief first.')
  const offered = { cohorts: new Set(facts.cohorts.map(c => c.id)), cycles: new Set(facts.residency.map(c => c.id)), forms: new Set(facts.forms.map(f => f.id)) }
  const audience = sanitizeRule(b.audience)
  if (audience.population === 'students') audience.cohortIds = audience.cohortIds.filter(id => offered.cohorts.has(id))
  if (audience.population === 'alumni' && !offered.cycles.has(audience.cycleId)) audience.cycleId = null
  const allowedUrls = [...urlsFromConversation(conversation.request, conversation.turns)]
  const action_ = b.action && typeof b.action === 'object' ? b.action : {}
  const brief = {
    ...b, audience,
    action: {
      kind: ['link', 'form', 'none'].includes(action_.kind) ? action_.kind : 'none',
      label: action_.label || null,
      url: allowedUrls.includes(action_.url) ? action_.url : '',
      formId: offered.forms.has(action_.formId) ? action_.formId : '',
    },
  }
  const res = await run('studio-design', { brief: { value: { brief, allowedUrls } }, facts: { value: facts } })
  if (!res.ok) throw refused(res)
  const design = sanitizeDesign({ ...res.output, ...(res.provenanceId ? { keith: { provenanceId: res.provenanceId } } : {}) })
  return { design, provenanceId: res.provenanceId || null }
}
