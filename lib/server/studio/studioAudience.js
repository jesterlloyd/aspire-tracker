// lib/server/studio/studioAudience.js
//
// STUDIO-2 (Owner, 2026-11-05): the audience half of /api/studio. Owner and Admin only (the
// endpoint has already checked). Four actions:
//
//   audience_options { rule }  -> { cohorts, cycles, schools, categories, enabled }
//        the choices a rule can be built from. Schools are those of the chosen cohorts' students.
//   audience_resolve { rule }  -> { rule, label, recipients, excluded }
//        the rule resolved, for the sender to read. Nothing is stored.
//   send_freeze { mode, rule, expected, removed, added, picked, reply_route, design_id, subject }
//                              -> { id, recipients, excluded, reply_route }
//        the list as it will be sent, stored in studio_sends BEFORE anything is sent. A rule is
//        resolved again here and the browser's copy is never trusted: only people the sender saw
//        (`expected`) and did not remove survive, so someone who joined the rule after the review is
//        left out with a reason rather than sent to unseen. A hand-picked list is verified by the
//        same allowlist the bulk endpoint runs. Opted-out addresses are left out either way.
//   send_finish { id, batch_ids, sent, skipped, failed } -> { ok }
//        the totals, on the send and on its design.
//
// Before 20261130000000_studio_audiences.sql the three that store or need the rule answer 409
// not_enabled, and the drawer keeps Phase 1's hand-picked send.

import { randomUUID } from 'crypto'
import { sanitizeRule, ruleProblem, describeRule, cleanReplyRoute, CONTACT_CATEGORIES, MAX_AUDIENCE } from '../../../src/lib/studio/audienceCatalog.js'
import { resolveAudience, finishAudience, loadOptedOut } from './resolveAudience.js'
import { validateBulkRecipients } from '../../../api/lib/bulkRecipientAllowlist.js'
import { normalizeEmailForLookup } from '../../../src/lib/emailUtils.js'
import { isValidEmail } from '../../../src/lib/notifications/studentRecipient.js'
import { firstNameFromName } from '../../../src/lib/recipientParse.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING = (e) => e && (['42P01', 'PGRST205', '42703'].includes(e.code) || /does not exist|schema cache/i.test(e.message || ''))
const MAX_SENDS_KEPT = 25

const err = (status, message, code) => Object.assign(new Error(message), { status, code })
const notEnabled = () => err(409, 'Sending by rule is not enabled yet. Pick people by hand for now.', 'not_enabled')
const norm = (v) => normalizeEmailForLookup(String(v || '').trim())
const normSet = (v) => new Set((Array.isArray(v) ? v : []).map(norm).filter(Boolean))

export const AUDIENCE_ACTIONS = new Set(['audience_options', 'audience_resolve', 'send_freeze', 'send_finish'])

export async function audiencesProvisioned(db) {
  const { error } = await db.from('studio_sends').select('id').limit(1)
  if (!error) return true
  if (MISSING(error)) return false
  throw error
}

/** The fields of a recipient the review screen shows. Never the ids. */
const forReview = (p) => ({ normEmail: p.normEmail, name: p.name || '', email: p.email, source: p.source, route: p.route || null })
/** The fields the bulk endpoint's allowlist verifies, plus route and normEmail. */
const forSend = (p) => {
  const out = { source: p.source, email: p.email, normEmail: p.normEmail, name: p.name || '', firstName: p.firstName || null, school: p.school || null, route: p.route || null }
  if (p.source === 'student') {
    out.studentId = p.studentId
    if (p.automaticEmail === true) out.automaticEmail = true
    else out.emailType = p.emailType
    if (p.status_ack === true) out.status_ack = true
  }
  if (p.source === 'contact') out.contactId = p.contactId
  return out
}

async function nameMap(pop, rule) {
  const names = {}
  if (rule.population === 'students' && rule.cohortIds.length) {
    const { data } = await pop.from('cohorts').select('id, name').in('id', rule.cohortIds)
    for (const c of data || []) names[c.id] = c.name
  }
  if (rule.population === 'alumni' && rule.cycleId) {
    const { data } = await pop.from('ngrp_cycles').select('id, name').eq('id', rule.cycleId)
    for (const c of data || []) names[c.id] = c.name
  }
  return names
}

/** Typed addresses, as manual recipients. Invalid ones are reported, not dropped silently. */
function typedPeople(added) {
  const people = []
  const excluded = []
  for (const raw of (Array.isArray(added) ? added : []).slice(0, 200)) {
    const s = String(raw?.email ?? raw ?? '').trim()
    if (!s) continue
    if (!isValidEmail(s)) { excluded.push({ name: '', email: s.slice(0, 120), reason: 'invalid_email' }); continue }
    const name = String(raw?.name || '').trim().slice(0, 120)
    people.push({ source: 'manual', email: s, name, firstName: firstNameFromName(name) || null, route: 'manual' })
  }
  return { people, excluded }
}

const ALLOWLIST_REASONS = {
  student_not_found: 'not_found', contact_not_found: 'not_found', contact_inactive: 'inactive',
  missing_email: 'no_email', invalid_email: 'invalid_email', duplicate: 'duplicate',
}

/** A hand-picked list, through the bulk allowlist. Returns { people, excluded } like a rule. */
async function verifyPicked(admin, picked) {
  const list = (Array.isArray(picked) ? picked : []).slice(0, MAX_AUDIENCE + 1)
  if (list.length > MAX_AUDIENCE) throw err(400, `A Studio send can reach at most ${MAX_AUDIENCE} people.`)
  // The allowlist rejects an emailType it does not know, so a picked entry can never claim the
  // residency route: that route exists only on a list this server froze from a rule.
  const entries = list.map(p => ({ ...p, emailType: p.emailType === 'personal' ? 'personal' : p.emailType === 'school' ? 'school' : undefined }))
  const { cleared, rejected } = await validateBulkRecipients({ db: admin, recipients: entries, batchId: randomUUID() })
  const people = cleared.map(c => {
    const p = entries[c.index] || {}
    return {
      ...p, email: c.rawEmail, name: c.recipientName || p.name || '', firstName: c.firstName, school: c.school,
      route: p.source === 'student' ? (p.automaticEmail === true ? 'automatic' : (p.emailType || 'school')) : p.source,
    }
  })
  const excluded = rejected.map(r => ({ name: String(list[r.index]?.name || '').slice(0, 120), email: r.email, reason: ALLOWLIST_REASONS[r.reason] || r.reason }))
  return { people, excluded }
}

export async function runAudienceAction(action, body, ctx) {
  const { admin, pop, profileId, isDemo } = ctx

  if (action === 'audience_options') {
    const rule = sanitizeRule(body.rule)
    const enabled = await audiencesProvisioned(admin)
    const [cohorts, cycles] = await Promise.all([
      pop.from('cohorts').select('id, name, status, start_date').order('start_date', { ascending: false, nullsFirst: false }).limit(60),
      pop.from('ngrp_cycles').select('id, name, status, residency_start_date').order('residency_start_date', { ascending: false, nullsFirst: false }).limit(40),
    ])
    if (cohorts.error) throw cohorts.error
    let schools = []
    if (rule.population === 'students' && rule.cohortIds.length) {
      const { data, error } = await pop.from('students').select('school').in('cohort_id', rule.cohortIds)
      if (error) throw error
      schools = [...new Set((data || []).map(s => String(s.school || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    }
    return {
      enabled,
      cohorts: (cohorts.data || []).map(c => ({ id: c.id, name: c.name, status: c.status })),
      cycles: cycles.error ? [] : (cycles.data || []).map(c => ({ id: c.id, name: c.name, status: c.status })),
      schools, categories: CONTACT_CATEGORIES,
    }
  }

  if (action === 'audience_resolve') {
    const rule = sanitizeRule(body.rule)
    const problem = ruleProblem(rule)
    if (problem) throw err(400, problem)
    const found = await resolveAudience(pop, rule)
    return {
      rule, label: describeRule(rule, await nameMap(pop, rule)),
      recipients: found.recipients.map(forReview), excluded: found.excluded,
    }
  }

  if (action === 'send_freeze') {
    if (!(await audiencesProvisioned(admin))) throw notEnabled()
    const mode = body.mode === 'rule' ? 'rule' : 'hand'
    let rule = null
    let label = null
    let found
    if (mode === 'rule') {
      rule = sanitizeRule(body.rule)
      const problem = ruleProblem(rule)
      if (problem) throw err(400, problem)
      const resolved = await resolveAudience(pop, rule)
      label = describeRule(rule, await nameMap(pop, rule))
      const expected = normSet(body.expected)
      const removed = normSet(body.removed)
      const people = []
      const excluded = [...resolved.excluded]
      for (const p of resolved.recipients) {
        if (removed.has(p.normEmail)) excluded.push({ name: p.name, email: p.email, reason: 'removed' })
        else if (!expected.has(p.normEmail)) excluded.push({ name: p.name, email: p.email, reason: 'changed_since_review' })
        else people.push(p)
      }
      const typed = typedPeople(body.added)
      found = { people: [...people, ...typed.people], excluded: [...excluded, ...typed.excluded] }
    } else {
      found = await verifyPicked(admin, body.picked)
    }
    const optedOut = await loadOptedOut(admin, found.people.map(p => p.email))
    const done = finishAudience(found, { optedOut })
    if (!done.recipients.length) throw err(400, 'Nobody is left on the list to send to.', 'empty')
    const replyRoute = cleanReplyRoute(body.reply_route)
    const designId = UUID.test(String(body.design_id || '')) ? body.design_id : null
    const recipients = done.recipients.map(forSend)
    const { data, error } = await admin.from('studio_sends').insert({
      design_id: designId, subject: String(body.subject || '').slice(0, 200), mode, rule, rule_label: label,
      recipients, excluded: done.excluded.slice(0, 2000), reply_route: replyRoute, is_demo: isDemo, created_by: profileId,
    }).select('id').single()
    if (error) { if (MISSING(error)) throw notEnabled(); throw error }
    return { id: data.id, recipients, excluded: done.excluded, reply_route: replyRoute, label }
  }

  if (action === 'send_finish') {
    if (!UUID.test(String(body.id || ''))) throw err(400, 'A send id is required.')
    const batchIds = (Array.isArray(body.batch_ids) ? body.batch_ids : []).filter(v => UUID.test(String(v))).slice(0, 40)
    const n = (v) => Math.max(0, Math.min(100000, Number.parseInt(v, 10) || 0))
    const at = new Date().toISOString()
    const totals = { sent: n(body.sent), skipped: n(body.skipped), failed: n(body.failed) }
    const { data: send, error } = await admin.from('studio_sends')
      .update({ status: 'sent', batch_ids: batchIds, ...totals, finished_at: at })
      .eq('id', body.id).eq('is_demo', isDemo).eq('created_by', profileId).select('id, design_id').maybeSingle()
    if (error) { if (MISSING(error)) throw notEnabled(); throw error }
    if (!send) throw err(404, 'That send is not here.')
    if (send.design_id && batchIds.length) {
      const { data: row } = await admin.from('studio_designs').select('sends').eq('id', send.design_id).eq('is_demo', isDemo).maybeSingle()
      if (row) {
        const entry = { at, by: profileId, batch_ids: batchIds, send_id: send.id, ...totals }
        const sends = [entry, ...(Array.isArray(row.sends) ? row.sends : [])].slice(0, MAX_SENDS_KEPT)
        await admin.from('studio_designs').update({ sends, status: 'sent', last_sent_at: at, updated_at: at }).eq('id', send.design_id).eq('is_demo', isDemo)
      }
    }
    return { ok: true }
  }

  throw err(400, 'Unknown action.')
}
