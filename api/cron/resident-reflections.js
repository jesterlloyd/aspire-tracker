// api/cron/resident-reflections.js
//
// RESIDENCY-REFLECTION-1: sends each resident their next reflection period on
// the Friday night before it opens. Period 1 is sent by the Start button, so
// this cron only ever sends periods 2 and up.
//
// WHY THREE SATURDAY-UTC SLOTS GATED ON PACIFIC FRIDAY
// Vercel cron expressions are UTC only and have no every-other-week form. The
// schedule itself lives on each run (send_on per period), so the cron's job is
// just "is it Friday evening in Los Angeles, and is anything due to go out".
// 02:00, 03:00 and 04:00 UTC Saturday are 7 pm, 8 pm and 9 pm PDT (6, 7, 8 pm
// PST); gating on Pacific Friday at or after 19:00 sends once in either half of
// the year, and the later slots retry a failed send the same evening. Sending
// is idempotent per period (sent_at, plus the provider key on the token), so
// the extra runs are no-ops.
//
// A missed Friday is not dropped: a period whose send day has passed but whose
// due date has not is still sent on the next run.
/* global process */
import { createClient } from '@supabase/supabase-js'
import { createMailer } from '../../lib/server/email/mailer.js';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAutomationEnabled } from '../lib/automationSettings.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { pacificDateString, pacificHour } from '../../src/lib/birthdayEligibility.js'
import { generateToken } from '../../lib/server/evaluation/tokens.js'
import { emailBaseUrl } from '../../lib/server/appUrl.js'
import { buildReflectionEmail } from '../../lib/server/email/ngrpReflectionEmail.js'
import {
  sendReflectionPeriod, periodsToSend, RUNS, PERIODS, RUN_FIELDS, PERIOD_FIELDS, NOTIFICATION_TYPE, TEMPLATE_KEY,
} from '../../lib/server/ngrpReflection.js'

export const AUTOMATION_KEY = 'resident_reflections'
export const CRON_NAME = 'resident-reflections'
export const SEND_AFTER_PACIFIC_HOUR = 19
const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const SEND_DELAY_MS = 300

export function withinSendWindow(now = new Date()) {
  // 5 = Friday in Intl's en-US short weekday order below.
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(now)
  return weekday === 'Fri' && pacificHour(now) >= SEND_AFTER_PACIFIC_HOUR
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
  const now = new Date()
  const nowIso = now.toISOString()
  const today = pacificDateString(now)
  const runId = await startCronRun(supabase, CRON_NAME)
  console.log(`[resident-reflections] run at ${nowIso} (Pacific ${today} hour ${pacificHour(now)})`)

  try {
    const gate = await isAutomationEnabled({ supabaseAdmin: supabase, automationKey: AUTOMATION_KEY })
    if (!gate.enabled) {
      await finishCronRunSuccess(supabase, runId, { skipped: true, reason: 'automation_disabled' })
      return res.status(200).json({ skipped: true, reason: 'automation_disabled' })
    }
    // Allow ?force=1 for a manual, authorized re-run outside the window.
    if (!withinSendWindow(now) && req.query?.force !== '1') {
      await finishCronRunSuccess(supabase, runId, { skipped: true, reason: 'outside_send_window', target_date: today })
      return res.status(200).json({ skipped: true, reason: 'outside_send_window', targetDate: today })
    }

    const runs = await supabase.from(RUNS).select(RUN_FIELDS).eq('status', 'active')
    if (runs.error) throw new Error(`runs: ${runs.error.message}`)
    const runsById = new Map((runs.data || []).map(r => [r.id, r]))
    if (runsById.size === 0) {
      await finishCronRunSuccess(supabase, runId, { target_date: today, due_count: 0, sent_count: 0 })
      return res.status(200).json({ success: true, targetDate: today, dueCount: 0, sentCount: 0 })
    }

    const periods = await supabase.from(PERIODS).select(PERIOD_FIELDS)
      .in('run_id', [...runsById.keys()]).is('sent_at', null).lte('send_on', today).gte('due_on', today)
    if (periods.error) throw new Error(`periods: ${periods.error.message}`)
    const due = periodsToSend(periods.data || [], runsById, today)

    // Residents and their addresses, in two bounded reads.
    const candidateIds = [...new Set(due.map(p => p.candidate_id))]
    const studentIds = [...new Set(due.map(p => p.student_id))]
    const [outcomes, students] = candidateIds.length ? await Promise.all([
      supabase.from('ngrp_residency_outcomes').select('candidate_id, hired_at, separated_at, cs_email').in('candidate_id', candidateIds),
      supabase.from('students').select('id, first_name, last_name, preferred_first_name, name, personal_email').in('id', studentIds),
    ]) : [{ data: [] }, { data: [] }]
    if (outcomes.error) throw new Error(`outcomes: ${outcomes.error.message}`)
    if (students.error) throw new Error(`students: ${students.error.message}`)
    const outcomeByCandidate = new Map((outcomes.data || []).map(o => [o.candidate_id, o]))
    const studentById = new Map((students.data || []).map(s => [s.id, s]))

    const resendClient = createMailer()
    const baseUrl = emailBaseUrl(req)
    const sendEmail = async ({ to, subject, html, idempotencyKey }) => {
      try {
        const { data, error } = await resendClient.emails.send({ from: FROM, to, subject, html }, { idempotencyKey })
        if (error) return { ok: false, reason: 'provider_rejected' }
        return { ok: true, providerId: data?.id || null }
      } catch {
        return { ok: false, reason: 'provider_error' }
      }
    }

    const sent = [], skipped = [], failed = []
    let attempted = false
    for (const period of due) {
      if (attempted) await sleep(SEND_DELAY_MS)
      attempted = true
      const run = runsById.get(period.run_id)
      const outcome = sendReflectionPeriod({
        db: supabase, run, period,
        student: studentById.get(period.student_id) || {},
        outcome: outcomeByCandidate.get(period.candidate_id) || null,
        actorProfileId: null, generateToken, sendEmail, buildEmail: buildReflectionEmail, baseUrl, nowIso,
      })
      const result = await outcome
      if (result.outcome === 'sent' || result.outcome === 'repaired') {
        sent.push({ period_id: period.id, period_number: period.period_number })
        if (result.outcome === 'sent') {
          // Display ledger only (Sent History). Never the URL, never the token.
          await supabase.from('notification_log').insert({
            notification_type: NOTIFICATION_TYPE, audience: 'student', recipient_email: result.to,
            recipient_name: studentById.get(period.student_id)?.name || null, recipient_role: 'Student',
            subject: result.subject, status: 'sent', resend_email_id: result.providerId, sent_at: nowIso,
            recipient_type: 'student', student_id: period.student_id,
            metadata: { template_key: TEMPLATE_KEY, period_number: period.period_number, token_hash_prefix: result.tokenHashPrefix, cron: CRON_NAME },
          })
        }
      } else if (result.outcome === 'skipped') {
        skipped.push({ period_id: period.id, reason: result.reason })
      } else {
        failed.push({ period_id: period.id, reason: result.reason })
        console.error(`[resident-reflections] send failed for period ${period.id}: ${result.reason}`)
      }
    }

    const summary = { target_date: today, active_runs: runsById.size, due_count: due.length, sent_count: sent.length, skipped_count: skipped.length, failed_count: failed.length }
    console.log(`[resident-reflections] SUMMARY: ${JSON.stringify(summary)}`)
    await finishCronRunSuccess(supabase, runId, summary)
    return res.status(200).json({ success: true, ...summary, failed })
  } catch (err) {
    console.error('[resident-reflections] unexpected error:', err)
    await finishCronRunError(supabase, runId, err.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}
