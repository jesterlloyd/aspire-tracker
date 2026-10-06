// api/cron/residency-weekly-digest.js
//
// RESIDENCY-DIGEST-1 (Owner, 2026-10-05): every Monday morning, each Talent Acquisition member
// who turned the digest ON (Residency Portal > profile menu > Weekly digest email) gets one email
// listing what needs attention in Residency: interviews this week and results to record, offers
// waiting on an answer, alumni flagged for follow-up, and new application documents.
//
// - The content IS Residency's Needs you (src/lib/ngrp/residencyDigestModel.js reads the same
//   groups as At a Glance), for every residency cohort in Planning or Active.
// - Opt-in, per person: user_profiles.ui_preferences['notifications.residencyDigest'] === 'on',
//   an ACTIVE talent_acquisition grant, an active profile with an email.
// - Quiet weeks stay quiet: nothing to name, nothing sent.
// - Once a week: a recipient who received one in the last DEDUPE_DAYS is skipped, so a re-run
//   (or ?force=1) never sends twice. A failed dedupe read stops the run rather than risk it.
// - ASPIRE Connect > Automations can pause it (automation key below, default On; nobody gets it
//   until they opt in anyway).
// - ?dryRun=1 resolves everything and sends nothing, writes no log rows. CRON_SECRET still required.
//
// 15:00 UTC Monday is 8 AM PDT and 7 AM PST.
/* global process */
import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { createMailer } from '../../lib/server/email/mailer.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAutomationEnabled } from '../lib/automationSettings.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { emailBaseUrl } from '../../lib/server/appUrl.js'
import { fetchCycles, loadApplicantsPayload } from '../../lib/server/ngrpApplicants.js'
import { documentActivity } from '../../lib/server/documentActivity.js'
import { TALENT_ACQUISITION } from '../../lib/server/ngrpTalentAcquisition.js'
import { deriveApplicantRows } from '../../src/lib/ngrp/ngrpStates.js'
import { buildDigestSections, digestCycles, digestItemCount, DIGEST_NOTIFICATION_TYPE } from '../../src/lib/ngrp/residencyDigestModel.js'
import { buildResidencyDigestEmail } from '../../lib/server/email/residencyDigestEmail.js'
import { preferenceValue, RESIDENCY_DIGEST } from '../../src/lib/userPreferences.js'

export const AUTOMATION_KEY = 'residency_weekly_digest'
export const CRON_NAME = 'residency-weekly-digest'
export const DEDUPE_DAYS = 5
const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const REPLY_TO = 'ngrp@cshs.org'
const SEND_DELAY_MS = 300
const DAY = 86_400_000

const sleep = ms => new Promise(r => setTimeout(r, ms))

export function grantIsActive(g, now = new Date()) {
  if (!g || g.revoked_at) return false
  if (g.starts_at && new Date(g.starts_at) > now) return false
  if (g.expires_at && new Date(g.expires_at) <= now) return false
  return true
}

/** Who receives the digest: an active grant, an active profile with an email, and the switch ON. */
export function digestRecipients(grants = [], profiles = [], now = new Date()) {
  const granted = new Set((grants || []).filter(g => grantIsActive(g, now)).map(g => g.user_profile_id))
  const seen = new Set()
  const out = []
  for (const p of profiles || []) {
    if (!granted.has(p.id) || p.is_active === false) continue
    const email = String(p.email || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    if (preferenceValue(p.ui_preferences, RESIDENCY_DIGEST) !== 'on') continue
    seen.add(email)
    out.push({ id: p.id, email, name: p.full_name || '' })
  }
  return out
}

export function weekOfLabel(now = new Date()) {
  return now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })
}

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const dryRun = req.query?.dryRun === '1' || req.query?.dry_run === '1'

  // DEMO-DATA-2: real rows only. A cron has no request and so no demo mode; see populationDb.
  const db = populationDb(createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ))
  const now = new Date()
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

    // ── Who opted in ──────────────────────────────────────────────────────────
    const grants = await db.from('user_role_grants')
      .select('user_profile_id, starts_at, expires_at, revoked_at')
      .eq('role', TALENT_ACQUISITION).is('revoked_at', null)
    if (grants.error) throw new Error(`grants: ${grants.error.message}`)
    const ids = [...new Set((grants.data || []).map(g => g.user_profile_id))]
    let profiles = []
    if (ids.length) {
      const p = await db.from('user_profiles').select('id, email, full_name, is_active, ui_preferences').in('id', ids)
      if (p.error) throw new Error(`profiles: ${p.error.message}`)
      profiles = p.data || []
    }
    const recipients = digestRecipients(grants.data, profiles, now)
    if (!recipients.length) {
      await done({ eligible_count: 0, sent_count: 0 })
      return res.status(200).json({ success: true, eligible: 0, sent: 0 })
    }

    // ── What needs attention: the same groups At a Glance shows ───────────────
    const cyclesRes = await fetchCycles(db)
    if (cyclesRes.error) throw new Error('cycles read failed')
    const cohorts = []
    for (const cycle of digestCycles(cyclesRes.cycles || [])) {
      const payload = await loadApplicantsPayload(db, cycle.id)
      if (payload.state !== 'ok') throw new Error(`applicants for ${cycle.id}: ${payload.state}`)
      cohorts.push({ cycle, rows: deriveApplicantRows(payload.students, payload.candidates) })
    }
    const docsRes = cohorts.length ? await documentActivity(db, { demo: false, now }) : { uploads: [], completions: [] }
    // Documents are one section of four; a failed read leaves them out rather than the week out.
    const docs = docsRes.error ? null : docsRes
    const sections = buildDigestSections({ cohorts, docs, now: now.getTime() })
    const itemCount = digestItemCount(sections)
    if (itemCount === 0) {
      await done({ eligible_count: recipients.length, sent_count: 0, quiet_week: true })
      return res.status(200).json({ success: true, eligible: recipients.length, sent: 0, quietWeek: true })
    }

    // ── Once a week ───────────────────────────────────────────────────────────
    const recent = await db.from('notification_log').select('recipient_email')
      .eq('notification_type', DIGEST_NOTIFICATION_TYPE)
      .gte('sent_at', new Date(now.getTime() - DEDUPE_DAYS * DAY).toISOString())
    if (recent.error) throw new Error(`dedupe: ${recent.error.message}`)
    const already = new Set((recent.data || []).map(r => String(r.recipient_email || '').toLowerCase()))

    const baseUrl = emailBaseUrl(req)
    const weekOf = weekOfLabel(now)
    const mailer = dryRun ? null : createMailer()
    let sent = 0, failed = 0, skipped = 0
    const preview = []
    for (const r of recipients) {
      if (already.has(r.email)) { skipped++; continue }
      const { subject, html } = buildResidencyDigestEmail({ sections, recipientName: r.name, weekOf, baseUrl })
      if (dryRun) { preview.push({ profile_id: r.id, subject }); continue }
      let status = 'sent', error = null, resendId = null
      try {
        const out = await mailer.emails.send({
          from: FROM, reply_to: REPLY_TO, to: [r.email], subject, html,
          tags: [{ name: 'type', value: DIGEST_NOTIFICATION_TYPE }],
        })
        if (out.error) { status = 'failed'; error = out.error.message || 'send_failed' } else resendId = out.data?.id || null
      } catch (e) {
        status = 'failed'; error = e.message
      }
      status === 'sent' ? sent++ : failed++
      const log = await db.from('notification_log').insert({
        notification_type: DIGEST_NOTIFICATION_TYPE, audience: TALENT_ACQUISITION,
        recipient_type: 'user', recipient_email: r.email, recipient_name: r.name || null,
        recipient_role: TALENT_ACQUISITION, subject, resend_email_id: resendId, status, error_message: error,
        metadata: { user_profile_id: r.id, item_count: itemCount, cycle_ids: sections.map(s => s.cycleId), week_of: weekOf },
      })
      if (log.error) console.error('[residency-digest] log write failed', { profile_id: r.id, code: log.error.code })
      await sleep(SEND_DELAY_MS)
    }

    const details = {
      eligible_count: recipients.length, sent_count: sent, failed_count: failed,
      skipped_count: skipped, cohort_count: cohorts.length, event_count: itemCount,
      ...(docs ? {} : { documents_unavailable: true }),
    }
    if (dryRun) return res.status(200).json({ dryRun: true, ...details, would_send_count: preview.length, preview })
    await done(details)
    return res.status(200).json({ success: true, ...details })
  } catch (e) {
    console.error('[residency-digest] run failed:', e.message)
    if (!dryRun) await finishCronRunError(db, runId, e.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}
