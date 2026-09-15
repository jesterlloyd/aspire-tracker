// api/ngrp-support.js
//
// RESIDENCY-SUPPORT-1: the Residency Support tab's endpoint.
//
// Authorization: verifyNgrpCaller (the one Residency check), then:
//   summary           { cycle_id }                        -> both audiences.
//                     Talent Acquisition gets the same narrowed roster as
//                     every other Residency endpoint (submitted forms only).
//   record            { candidate_id, activity, occurred_on, note?, mentor_name?, event_id? }
//   record_attendance { cycle_id, activity, occurred_on, candidate_ids[], note?, event_id? }
//   void              { entry_id, reason? }
//   set_mentor        { candidate_id, mentor_name, mentor_profile_id? }
//                     -> the ASPIRE team only (Owner, 2026-09-11): staff with
//                        the NGRP manage capability. Talent Acquisition sees
//                        support but never records it.
//   reflection_start  { candidate_id }  -> RESIDENCY-REFLECTION-1: begins the
//                        resident's bi-weekly reflection run and sends period 1
//                        now. Retries the first send if it failed; refuses a
//                        second run.
//   reflection_stop   { candidate_id }  -> ends the run; live links die with it.
//   reflection_view   { period_id }     -> one submitted reflection, for the
//                        ASPIRE team. Sharing beyond the team is deferred.
//
// Entries are voided, never deleted. The weekly email check-in this tab used to
// count is gone (Owner, 2026-09-13): the reflection replaces it.
// A missing table reads as { provisioned: false } until 20260914000000 is applied;
// the reflection actions need 20260917000000 as well.
/* global process */
import { Resend } from 'resend'
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { loadApplicantsPayload, isMissingNgrpTable } from '../lib/server/ngrpApplicants.js'
import { TALENT_ACQUISITION, narrowPayloadForTalentAcquisition } from '../lib/server/ngrpTalentAcquisition.js'
import { validateSupportEntry, validateAttendance, validateMentor, validateVoid } from '../lib/server/ngrpSupport.js'
import { generateToken } from '../lib/server/evaluation/tokens.js'
import { emailBaseUrl } from '../lib/server/appUrl.js'
import { buildReflectionEmail } from '../lib/server/email/ngrpReflectionEmail.js'
import { isHired } from '../lib/server/ngrpResidencyRecipient.js'
import { loadResidents } from '../lib/server/ngrpResidents.js'
import {
  startReflectionRun, stopReflectionRun, sendReflectionPeriod,
  RUNS as REFLECTION_RUNS, PERIODS as REFLECTION_PERIODS, SUBMISSIONS as REFLECTION_SUBMISSIONS,
  RUN_FIELDS, PERIOD_FIELDS, NOTIFICATION_TYPE as REFLECTION_NOTIFICATION_TYPE, TEMPLATE_KEY as REFLECTION_TEMPLATE_KEY,
  SCHEDULE, SCHEDULE_FIELDS,
} from '../lib/server/ngrpReflection.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
//   schedule          { cycle_id, from, to } -> RESIDENCY-REFLECTION-2: the days
//                        residents marked as working, for Residency > Activity.
//                        Both audiences: a schedule names no answer.
//   residents         { cycle_id } | { scope: 'aggregate' } -> RESIDENTS-1: the
//                        hired residents and their affiliation, for Residency >
//                        Residents. Both audiences; Talent Acquisition narrowed.
const ACTIONS = new Set(['summary', 'residents', 'record', 'record_attendance', 'void', 'set_mentor', 'reflection_start', 'reflection_stop', 'reflection_view', 'schedule'])
const WRITES = new Set(['record', 'record_attendance', 'void', 'set_mentor', 'reflection_start', 'reflection_stop'])
// Reading a resident's answers is the ASPIRE team's until the Owner decides
// how sharing works; it is a read, so it needs no manage capability.
const TEAM_ONLY = new Set([...WRITES, 'reflection_view'])
const ENTRIES = 'ngrp_support_entries'
const MENTORS = 'ngrp_resident_mentors'
const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const ENTRY_FIELDS = 'id, cycle_id, candidate_id, student_id, activity, occurred_on, note, mentor_name, event_id, recorded_at'

const unprovisioned = res => res.status(200).json({ provisioned: false })
const internal = res => res.status(500).json({ error: 'internal_error' })
const invalid = (res, errors) => res.status(422).json({ error: 'validation_failed', errors })
const isUnique = error => error?.code === '23505'

// Today in Pacific time, as YYYY-MM-DD: support cannot be recorded ahead of time.
function pacificToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action || !ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })

  const caller = await verifyNgrpCaller(req, { manage: WRITES.has(action) })
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const isTA = caller.audience === TALENT_ACQUISITION
  // Only the ASPIRE team records support, or reads a resident's reflections.
  if (TEAM_ONLY.has(action) && isTA) return res.status(403).json({ error: 'aspire_team_only' })

  const db = getServiceDb()
  const actorId = caller.profile.id
  const today = pacificToday()

  try {
    // ── summary ─────────────────────────────────────────────────────────────
    if (action === 'summary') {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const payload = await loadApplicantsPayload(db, cycleId)
      if (payload.state === 'unprovisioned') return unprovisioned(res)
      if (payload.state === 'cycle_not_found') return res.status(404).json({ error: 'cycle_not_found' })
      if (payload.state !== 'ok') return internal(res)
      const view = isTA ? narrowPayloadForTalentAcquisition(payload) : payload
      const candidateIds = (view.candidates || []).map(c => c.id)
      const studentIds = (view.students || []).map(s => s.id)

      let entries = []
      let mentors = []
      if (candidateIds.length) {
        const [e, m] = await Promise.all([
          db.from(ENTRIES).select(ENTRY_FIELDS).in('candidate_id', candidateIds).is('voided_at', null).order('occurred_on', { ascending: false }),
          db.from(MENTORS).select('candidate_id, mentor_name, mentor_profile_id, assigned_at').in('candidate_id', candidateIds),
        ])
        if (e.error) return isMissingNgrpTable(e.error) ? unprovisioned(res) : internal(res)
        if (m.error) return isMissingNgrpTable(m.error) ? unprovisioned(res) : internal(res)
        entries = e.data || []
        mentors = m.data || []
      } else {
        const probe = await db.from(ENTRIES).select('id').limit(1)
        if (probe.error) return isMissingNgrpTable(probe.error) ? unprovisioned(res) : internal(res)
      }
      // RESIDENCY-REFLECTION-1: each resident's run and periods, status only,
      // never a payload. Absent until 20260917000000 is applied, which the tab
      // reads as "Start is not available yet" rather than as an error.
      let runs = []
      let periods = []
      let reflectionsProvisioned = true
      if (candidateIds.length) {
        const r = await db.from(REFLECTION_RUNS).select(RUN_FIELDS).in('candidate_id', candidateIds)
        if (r.error) {
          if (!isMissingNgrpTable(r.error)) return internal(res)
          reflectionsProvisioned = false
        } else {
          runs = r.data || []
          if (runs.length) {
            const p = await db.from(REFLECTION_PERIODS).select(PERIOD_FIELDS).in('run_id', runs.map(x => x.id)).order('period_number')
            if (p.error) return internal(res)
            periods = p.data || []
          }
        }
      }
      void studentIds

      return res.status(200).json({
        provisioned: true,
        canRecord: !isTA,
        today,
        entries,
        mentors,
        reflections: { provisioned: reflectionsProvisioned, runs, periods },
      })
    }

    // ── residents: the hired new grads, per cohort or across all cohorts ────
    if (action === 'residents') {
      const aggregate = body.scope === 'aggregate'
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!aggregate && !cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const loaded = await loadResidents(db, { cycleId: aggregate ? null : cycleId, talentAcquisition: isTA })
      if (loaded.state === 'unprovisioned') return unprovisioned(res)
      if (loaded.state !== 'ok') return internal(res)
      return res.status(200).json({
        provisioned: true,
        scope: aggregate ? 'aggregate' : 'cohort',
        detailsProvisioned: loaded.detailsProvisioned,
        residents: loaded.residents,
      })
    }

    // ── schedule: residents' marked days in a date range, for the calendar ───
    if (action === 'schedule') {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      const from = typeof body.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : null
      const to = typeof body.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.to) ? body.to : null
      if (!cycleId || !from || !to || from > to) return res.status(422).json({ error: 'invalid_range' })
      const cands = await db.from('ngrp_candidates').select('id, student_id').eq('cycle_id', cycleId)
      if (cands.error) return isMissingNgrpTable(cands.error) ? unprovisioned(res) : internal(res)
      const ids = (cands.data || []).map(c => c.id)
      if (!ids.length) return res.status(200).json({ provisioned: true, marks: [], shifts: {} })
      const [marks, outcomes] = await Promise.all([
        db.from(SCHEDULE).select(SCHEDULE_FIELDS).in('candidate_id', ids).gte('on_date', from).lte('on_date', to).order('on_date'),
        db.from('ngrp_residency_outcomes').select('candidate_id, shift').in('candidate_id', ids),
      ])
      if (marks.error) return isMissingNgrpTable(marks.error) ? res.status(200).json({ provisioned: false, marks: [], shifts: {} }) : internal(res)
      // Before 20260918000000 the shift column is absent; marks then read as plain.
      const shifts = outcomes.error ? {} : Object.fromEntries((outcomes.data || []).filter(o => o.shift).map(o => [o.candidate_id, o.shift]))
      return res.status(200).json({ provisioned: true, marks: marks.data || [], shifts })
    }

    // ── reflection_view: one submitted period, the ASPIRE team only ─────────
    if (action === 'reflection_view') {
      const periodId = typeof body.period_id === 'string' && UUID.test(body.period_id) ? body.period_id : null
      if (!periodId) return res.status(422).json({ error: 'invalid_period_id' })
      const period = await db.from(REFLECTION_PERIODS).select(PERIOD_FIELDS).eq('id', periodId).maybeSingle()
      if (period.error) return isMissingNgrpTable(period.error) ? unprovisioned(res) : internal(res)
      if (!period.data) return res.status(404).json({ error: 'period_not_found' })
      const sub = await db.from(REFLECTION_SUBMISSIONS).select('payload, submitted_at').eq('period_id', periodId).maybeSingle()
      if (sub.error) return internal(res)
      return res.status(200).json({ ok: true, period: period.data, submission: sub.data || null })
    }

    // ── reflection_start / reflection_stop ───────────────────────────────────
    if (action === 'reflection_start' || action === 'reflection_stop') {
      const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
      if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
      const cand = await db.from('ngrp_candidates').select('id, cycle_id, student_id').eq('id', candidateId).maybeSingle()
      if (cand.error) return isMissingNgrpTable(cand.error) ? unprovisioned(res) : internal(res)
      if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
      const nowIso = new Date().toISOString()
      const existing = await db.from(REFLECTION_RUNS).select(RUN_FIELDS).eq('candidate_id', candidateId).maybeSingle()
      if (existing.error) return isMissingNgrpTable(existing.error) ? unprovisioned(res) : internal(res)

      if (action === 'reflection_stop') {
        if (!existing.data) return res.status(404).json({ error: 'run_not_found' })
        const stopped = await stopReflectionRun(db, { run: existing.data, actorProfileId: actorId, nowIso })
        if (!stopped.ok) return internal(res)
        return res.status(200).json({ ok: true, idempotent: stopped.idempotent === true })
      }

      // Only a resident (hired, not separated) receives reflections, at the
      // residency address (Cedars-Sinai first, never the school).
      const [outcome, student] = await Promise.all([
        db.from('ngrp_residency_outcomes').select('candidate_id, hired_at, separated_at, cs_email').eq('candidate_id', candidateId).maybeSingle(),
        db.from('students').select('id, first_name, last_name, preferred_first_name, name, personal_email').eq('id', cand.data.student_id).maybeSingle(),
      ])
      if (outcome.error || student.error || !student.data) return internal(res)
      if (!isHired(outcome.data)) return res.status(422).json({ error: 'not_a_resident' })

      let run = existing.data
      let periods = []
      if (run) {
        const p = await db.from(REFLECTION_PERIODS).select(PERIOD_FIELDS).eq('run_id', run.id).order('period_number')
        if (p.error) return internal(res)
        periods = p.data || []
        // A run whose first period went out is already started; one whose
        // first send failed is retried rather than duplicated.
        if (run.status !== 'active') return res.status(409).json({ error: 'run_ended' })
        if (periods[0]?.sent_at) return res.status(409).json({ error: 'already_started' })
      } else {
        const started = await startReflectionRun(db, { candidate: cand.data, actorProfileId: actorId, startedOn: today })
        if (!started.ok) {
          if (started.reason === 'already_started') return res.status(409).json({ error: 'already_started' })
          return isMissingNgrpTable(started.error) ? unprovisioned(res) : internal(res)
        }
        run = started.run
        periods = started.periods
      }

      const resendClient = new Resend(process.env.RESEND_API_KEY)
      const sendEmail = async ({ to, subject, html, idempotencyKey }) => {
        try {
          const { data, error } = await resendClient.emails.send({ from: FROM, to, subject, html }, { idempotencyKey })
          if (error) return { ok: false, reason: 'provider_rejected' }
          return { ok: true, providerId: data?.id || null }
        } catch {
          return { ok: false, reason: 'provider_error' }
        }
      }
      const sent = await sendReflectionPeriod({
        db, run, period: periods[0], student: student.data, outcome: outcome.data,
        actorProfileId: actorId, generateToken, sendEmail, buildEmail: buildReflectionEmail,
        baseUrl: emailBaseUrl(req), nowIso,
      })
      if (sent.outcome === 'sent') {
        // Display ledger only (Sent History). Never the URL, never the token.
        await db.from('notification_log').insert({
          notification_type: REFLECTION_NOTIFICATION_TYPE, audience: 'student', recipient_email: sent.to,
          recipient_name: student.data.name || `${student.data.first_name || ''} ${student.data.last_name || ''}`.trim(),
          recipient_role: 'Student', subject: sent.subject, status: 'sent', resend_email_id: sent.providerId,
          sent_at: nowIso, recipient_type: 'student', student_id: cand.data.student_id,
          metadata: { template_key: REFLECTION_TEMPLATE_KEY, period_number: 1, token_hash_prefix: sent.tokenHashPrefix, sent_by_user_id: actorId },
        })
      }
      const ok = sent.outcome === 'sent' || sent.outcome === 'repaired'
      return res.status(ok ? 200 : 502).json({ ok, run, periods, send: { outcome: sent.outcome, reason: sent.reason || null } })
    }

    // ── record one activity for one alumnus ─────────────────────────────────
    if (action === 'record') {
      const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
      if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
      const v = validateSupportEntry(body, { today })
      if (!v.ok) return invalid(res, v.errors)
      const cand = await db.from('ngrp_candidates').select('id, cycle_id, student_id').eq('id', candidateId).maybeSingle()
      if (cand.error) return isMissingNgrpTable(cand.error) ? unprovisioned(res) : internal(res)
      if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
      const ins = await db.from(ENTRIES).insert({
        ...v.entry,
        cycle_id: cand.data.cycle_id,
        candidate_id: cand.data.id,
        student_id: cand.data.student_id,
        recorded_by_profile_id: actorId,
      }).select(ENTRY_FIELDS).maybeSingle()
      if (ins.error) {
        if (isUnique(ins.error)) return res.status(409).json({ error: 'already_recorded' })
        return isMissingNgrpTable(ins.error) ? unprovisioned(res) : internal(res)
      }
      return res.status(200).json({ ok: true, entry: ins.data })
    }

    // ── group attendance (Town Hall, Interview Bootcamp) ─────────────────────
    if (action === 'record_attendance') {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const v = validateAttendance(body, { today })
      if (!v.ok) return invalid(res, v.errors)
      const cands = await db.from('ngrp_candidates').select('id, cycle_id, student_id').in('id', v.candidateIds)
      if (cands.error) return isMissingNgrpTable(cands.error) ? unprovisioned(res) : internal(res)
      const inCycle = (cands.data || []).filter(c => c.cycle_id === cycleId)
      if (inCycle.length !== v.candidateIds.length) return res.status(404).json({ error: 'candidate_not_found' })
      let created = 0
      let alreadyRecorded = 0
      for (const c of inCycle) {
        const ins = await db.from(ENTRIES).insert({
          ...v.entry, cycle_id: cycleId, candidate_id: c.id, student_id: c.student_id, recorded_by_profile_id: actorId,
        })
        if (ins.error) {
          if (isUnique(ins.error)) { alreadyRecorded += 1; continue }
          return isMissingNgrpTable(ins.error) ? unprovisioned(res) : res.status(500).json({ error: 'internal_error', created })
        }
        created += 1
      }
      return res.status(200).json({ ok: true, created, alreadyRecorded })
    }

    // ── void (never delete) ─────────────────────────────────────────────────
    if (action === 'void') {
      const v = validateVoid(body)
      if (!v.ok) return invalid(res, v.errors)
      const upd = await db.from(ENTRIES)
        .update({ voided_at: new Date().toISOString(), voided_by_profile_id: actorId, void_reason: v.reason })
        .eq('id', v.entryId).is('voided_at', null)
        .select('id').maybeSingle()
      if (upd.error) return isMissingNgrpTable(upd.error) ? unprovisioned(res) : internal(res)
      if (!upd.data) return res.status(404).json({ error: 'entry_not_found' })
      return res.status(200).json({ ok: true })
    }

    // ── set_mentor (one per resident; reassigning updates it) ────────────────
    const candidateId = typeof body.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
    if (!candidateId) return res.status(422).json({ error: 'invalid_candidate_id' })
    const v = validateMentor(body)
    if (!v.ok) return invalid(res, v.errors)
    const cand = await db.from('ngrp_candidates').select('id').eq('id', candidateId).maybeSingle()
    if (cand.error) return isMissingNgrpTable(cand.error) ? unprovisioned(res) : internal(res)
    if (!cand.data) return res.status(404).json({ error: 'candidate_not_found' })
    const nowIso = new Date().toISOString()
    const up = await db.from(MENTORS).upsert({
      candidate_id: candidateId, ...v.mentor, assigned_by_profile_id: actorId, assigned_at: nowIso, updated_at: nowIso,
    }, { onConflict: 'candidate_id' }).select('candidate_id, mentor_name, mentor_profile_id, assigned_at').maybeSingle()
    if (up.error) return isMissingNgrpTable(up.error) ? unprovisioned(res) : internal(res)
    return res.status(200).json({ ok: true, mentor: up.data })
  } catch {
    return internal(res)
  }
}
