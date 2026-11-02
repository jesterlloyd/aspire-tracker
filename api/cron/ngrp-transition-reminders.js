// api/cron/ngrp-transition-reminders.js
//
// TRANSITION-REMINDER-1 (Owner, 2026-11-01): every morning, each alumnus who was sent the
// Transition Form and has not submitted it gets the form again, with a working link, until they
// submit or the form closes. The rules are lib/server/ngrpTransitionReminders.js; this file reads,
// sends and logs.
//
// - ASPIRE Connect > Automations can pause it (automation key below, default On).
// - Real rows only (populationDb), and every email goes through createMailer's demo guard.
// - No audit event per email: Residency Activity would fill with one line per alumnus per day.
//   notification_log is the record, and Sent History lists it.
// - ?dryRun=1 resolves everything and sends nothing, writes no rows. CRON_SECRET still required.
//
// 16:00 UTC is 8 AM PST and 9 AM PDT.
/* global process */
import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { createMailer } from '../../lib/server/email/mailer.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAutomationEnabled } from '../lib/automationSettings.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { emailBaseUrl } from '../../lib/server/appUrl.js'
import { generateToken } from '../../lib/server/evaluation/tokens.js'
import { fetchCycles, loadApplicantsPayload } from '../../lib/server/ngrpApplicants.js'
import { effectiveFormClose } from '../../lib/server/ngrpTransition.js'
import { buildTransitionReminderEmail } from '../../lib/server/email/ngrpTransitionEmail.js'
import { digestCycles } from '../../src/lib/ngrp/residencyDigestModel.js'
import {
  reminderTargets, addReminderLink, retireUnsentLink, REMINDER_NOTIFICATION_TYPE, REMINDER_STUDENT_FIELDS,
} from '../../lib/server/ngrpTransitionReminders.js'

export const AUTOMATION_KEY = 'ngrp_transition_reminders'
export const CRON_NAME = 'ngrp-transition-reminders'
const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const SEND_DELAY_MS = 300
const RATE_RETRY_MS = 1000
const TIME_BUDGET_MS = 100_000   // of the function's 120 seconds; whoever is left goes tomorrow

const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRateLimited = err => err?.statusCode === 429 || /rate.?limit/i.test(err?.message || '')

async function sendEmail(mailer, { to, subject, html, idempotencyKey }) {
  const message = { from: FROM, to, subject, html, tags: [{ name: 'type', value: REMINDER_NOTIFICATION_TYPE }] }
  try {
    let { data, error } = await mailer.emails.send(message, { idempotencyKey })
    if (error && isRateLimited(error)) {
      await sleep(RATE_RETRY_MS)
      ;({ data, error } = await mailer.emails.send(message, { idempotencyKey }))
    }
    return error ? { rejected: true, message: error.message } : { providerId: data?.id || null }
  } catch (e) {
    return { unknown: true, message: e.message }
  }
}

// One cohort's reminder list. Every read is checked: a failed read must stop the run, because
// reading "no links" or "nothing recent" by accident is how someone gets two emails.
async function loadTargets(db, cycle, nowMs) {
  const payload = await loadApplicantsPayload(db, cycle.id)
  if (payload.state !== 'ok') throw new Error(`applicants for ${cycle.id}: ${payload.state}`)
  const candidates = (payload.candidates || []).filter(c => c.assignment_id)
  if (!candidates.length) return { targets: [], skipped: {} }
  const ids = candidates.map(c => c.assignment_id)
  const assignments = await db.from('ngrp_transition_assignments')
    .select('id, status, revoked_at, revision_count, deadline_at').in('id', ids)
  if (assignments.error) throw new Error(`assignments: ${assignments.error.message}`)
  const tokens = await db.from('ngrp_transition_tokens')
    .select('assignment_id, status, created_at').in('assignment_id', ids)
  if (tokens.error) throw new Error(`tokens: ${tokens.error.message}`)
  const students = await db.from('students').select(REMINDER_STUDENT_FIELDS).in('id', candidates.map(c => c.student_id))
  if (students.error) throw new Error(`students: ${students.error.message}`)
  return reminderTargets({
    cycle, candidates, assignments: assignments.data || [], tokens: tokens.data || [], students: students.data || [], nowMs,
  })
}

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const dryRun = req.query?.dryRun === '1' || req.query?.dry_run === '1'

  // DEMO-DATA-2: real rows only. A cron has no request and so no demo mode; see populationDb.
  const db = populationDb(createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ))
  const startedAt = Date.now()
  const runId = dryRun ? null : await startCronRun(db, CRON_NAME)
  const done = async (details) => { if (!dryRun) await finishCronRunSuccess(db, runId, details) }

  try {
    if (!dryRun) {
      const gate = await isAutomationEnabled({ supabaseAdmin: db, automationKey: AUTOMATION_KEY })
      if (!gate.enabled) {
        await done({ skipped: true, reason: 'automation_disabled' })
        return res.status(200).json({ skipped: true, reason: 'automation_disabled' })
      }
    }

    const cyclesRes = await fetchCycles(db)
    if (cyclesRes.error) throw new Error('cycles read failed')

    const baseUrl = emailBaseUrl(req)
    const mailer = dryRun ? null : createMailer()
    let sent = 0, failed = 0, eligible = 0, outOfTime = 0
    const skipped = {}
    const preview = []

    for (const cycle of digestCycles(cyclesRes.cycles || [])) {
      const list = await loadTargets(db, cycle, startedAt)
      for (const [why, n] of Object.entries(list.skipped)) skipped[why] = (skipped[why] || 0) + n
      eligible += list.targets.length

      for (const { candidate, assignment, student, email } of list.targets) {
        if (dryRun) { preview.push({ candidate_id: candidate.id, cycle_id: cycle.id }); continue }
        if (Date.now() - startedAt > TIME_BUDGET_MS) { outOfTime++; continue }

        const link = await addReminderLink(db, assignment.id, generateToken)
        if (link.notReady) {
          // Nothing has been mailed for this person, and the index refuses everyone alike.
          await done({ skipped: true, reason: 'links_migration_pending', sent_count: sent })
          return res.status(200).json({ skipped: true, reason: 'links_migration_pending', sent })
        }
        if (link.error) {
          console.error('[ngrp-reminders] link write failed', { candidate_id: candidate.id, code: link.error.code })
          failed++
          continue
        }

        const { subject, html } = buildTransitionReminderEmail({
          student, cycle, url: `${baseUrl}/ngrp/transition#t=${link.raw}`, closeText: effectiveFormClose(cycle, assignment),
        })
        const out = await sendEmail(mailer, { to: email, subject, html, idempotencyKey: `ngrp-transition-reminder/${link.token.id}` })
        if (out.rejected) await retireUnsentLink(db, link.token.id, 'provider_rejected')
        const ok = !out.rejected && !out.unknown
        ok ? sent++ : failed++

        // Never the URL and never the raw token: Sent History says "body not stored", as it
        // does for the invitation.
        const log = await db.from('notification_log').insert({
          notification_type: REMINDER_NOTIFICATION_TYPE, audience: 'student',
          recipient_type: 'student', student_id: student.id, recipient_email: email,
          recipient_name: student.name || null, recipient_role: 'Student',
          subject, status: ok ? 'sent' : 'failed', resend_email_id: out.providerId || null,
          error_message: ok ? null : (out.message || 'send_failed'),
          metadata: { cycle_id: cycle.id, cycle_name: cycle.name, candidate_id: candidate.id, token_hash_prefix: link.token.token_hash_prefix },
        })
        if (log.error) console.error('[ngrp-reminders] log write failed', { candidate_id: candidate.id, code: log.error.code })
        await sleep(SEND_DELAY_MS)
      }
    }

    const details = {
      eligible_count: eligible, sent_count: sent, failed_count: failed,
      skipped_count: Object.values(skipped).reduce((a, b) => a + b, 0),
      skipped_recently_reminded_count: skipped.recently_sent || 0,
      skipped_no_email_count: skipped.no_email || 0,
      ...(outOfTime ? { left_for_tomorrow: outOfTime } : {}),
    }
    if (dryRun) return res.status(200).json({ dryRun: true, ...details, skipped, would_send_count: preview.length, preview })
    await done(details)
    return res.status(200).json({ success: true, ...details })
  } catch (e) {
    console.error('[ngrp-reminders] run failed:', e.message)
    if (!dryRun) await finishCronRunError(db, runId, e.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}
