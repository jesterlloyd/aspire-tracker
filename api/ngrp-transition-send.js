// api/ngrp-transition-send.js
//
// NGRP-RELEASE-2: the manually initiated Transition Form send - the secure
// half of ASPIRE Connect → Outreach → Send to Many for the
// ngrp_transition_form_invitation template. Deliberately a SEPARATE endpoint
// from connect-send-bulk-message: that path accepts a client-authored body,
// and a secure per-recipient link may never round-trip through the browser.
// Raw tokens are minted inside the per-recipient loop, exist only in the
// emailed URL fragment, and never appear in any response, log, or table.
//
// Order of gates mirrors the bulk endpoint (S1-S7): shape → typed
// confirmation → batch id → recipient cap → authorization (active
// Owner-capability/Admin/Co-Lead via ngrp_manage) → cycle readiness →
// server-side recipient resolution (Completed alumni of the cycle's mapped
// cohorts only; emails come from the student row, never the request).
//
// SEND-TRUTH: a recipient is marked Sent only after the provider accepted
// the email; any earlier failure revokes what this call created
// (lib/server/ngrpTransition.js sendOneTransitionForm).
//
// Modes: { preview:true } classifies the selection without sending anything;
// the send mode requires confirmation 'SEND MESSAGES' exactly.
/* global process */
import { Resend } from 'resend'
import { getServiceDb, verifyPortalCaller } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { generateToken } from '../lib/server/evaluation/tokens.js'
import { emailBaseUrl } from '../lib/server/appUrl.js'
import { aspireEmailShell, aspireSystemSignature } from '../lib/server/email/aspireShell.js'
import {
  classifySendRecipients, sendOneTransitionForm, liveAssignmentForCandidate,
} from '../lib/server/ngrpTransition.js'
import { isMissingNgrpTable, sanitizeStudent } from '../lib/server/ngrpApplicants.js'
import { openReadiness } from '../lib/server/ngrpPlanning.js'
import { recordNgrpAudit } from '../lib/server/ngrpAudit.js'

const CONFIRMATION = 'SEND MESSAGES'
const MAX_RECIPIENTS = 75
const SEND_DELAY_MS = 300
const RATE_RETRY_MS = 1000
const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
export const NOTIFICATION_TYPE = 'ngrp_transition_form_sent'
export const TEMPLATE_KEY = 'ngrp_transition_form_invitation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRateLimited = err => err?.statusCode === 429 || /rate.?limit/i.test(err?.message || '')

const escapeHtml = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmtCloseDate(closeIso) {
  if (!closeIso) return null
  const d = new Date(closeIso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// The invitation email. Sending it means "Transition Form Sent" - the copy
// never says "invited to apply", and only the button carries the secure link.
export function buildTransitionEmail({ student, cycle, url, closeText }) {
  const first = escapeHtml(student.first_name || student.name || 'there')
  const cohortName = escapeHtml(cycle.name || 'the upcoming residency cohort')
  const closeDate = fmtCloseDate(closeText)
  const body = `
    <p style="margin:0 0 14px;">Hi ${first},</p>
    <p style="margin:0 0 14px;">
      Congratulations again on completing ASPIRE. As a completed ASPIRE alumnus, the next step
      toward the <strong>${cohortName}</strong> New-Graduate RN Residency (NGRP) is the secure
      <strong>NGRP Transition Form</strong> below. It gathers your licensure, education, and
      residency interest details so the ASPIRE team can review your eligibility.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto;"><tr><td
      style="background:#1d2567;border-radius:8px;">
      <a href="${url}" style="display:inline-block;padding:13px 26px;color:#ffffff;
        font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">
        Open your Transition Form</a>
    </td></tr></table>
    <p style="margin:0 0 14px;">
      This link is personal to you - please do not forward it. You can save a draft and return,
      and you may revise a submitted form${closeDate ? ` until <strong>${closeDate}</strong>` : ' until the cohort closes'}.
    </p>
    <p style="margin:0 0 14px;color:#4a5560;font-size:13px;">
      Completing this form records your information and interest. It is not an application to the
      residency program - the ASPIRE team will guide the official application step separately.
    </p>
    ${aspireSystemSignature('Kind regards,')}
  `
  return {
    subject: `Your NGRP Transition Form - ${cycle.name || 'ASPIRE'}`,
    html: aspireEmailShell({ body, preheader: 'Your secure NGRP Transition Form is ready.' }),
  }
}

// Server-side recipient resolution: only Completed students from the cycle's
// mapped ASPIRE cohorts, addressed at THEIR OWN stored email. The request
// contributes ids only - never an email address.
async function resolveSelection(db, cycle, studentIds) {
  const maps = await db.from('ngrp_cycle_source_cohorts').select('cohort_id').eq('cycle_id', cycle.id)
  if (maps.error) return { error: maps.error }
  const cohortIds = (maps.data || []).map(m => m.cohort_id)
  if (!cohortIds.length) return { students: [], outOfScope: studentIds }
  const rows = await db.from('students')
    .select('id, cohort_id, first_name, last_name, preferred_first_name, name, school, program_type, aspire_cohort, status, school_email, personal_email, headshot_url, updated_at')
    .in('id', studentIds)
    .in('cohort_id', cohortIds)
  if (rows.error) return { error: rows.error }
  const found = new Set((rows.data || []).map(r => r.id))
  return {
    students: (rows.data || []).map(r => ({
      ...sanitizeStudent(r),
      email: (r.school_email || r.personal_email || '').trim() || null,
    })),
    outOfScope: studentIds.filter(id => !found.has(id)),
  }
}

async function classifySelection(db, cycle, studentIds, resend) {
  const resolved = await resolveSelection(db, cycle, studentIds)
  if (resolved.error) return resolved
  const cands = await db.from('ngrp_candidates')
    .select('*').eq('cycle_id', cycle.id).in('student_id', resolved.students.map(s => s.id))
  if (cands.error) return { error: cands.error }
  const candidatesByStudent = new Map((cands.data || []).map(c => [c.student_id, c]))
  const liveAssignmentsByCandidate = new Map()
  for (const c of cands.data || []) {
    const live = await liveAssignmentForCandidate(db, c.id)
    if (live.error) return { error: live.error }
    if (live.assignment) liveAssignmentsByCandidate.set(c.id, live.assignment)
  }
  const classified = classifySendRecipients({
    students: resolved.students, candidatesByStudent, liveAssignmentsByCandidate, resend,
  })
  return { ...classified, outOfScope: resolved.outOfScope }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
  if (!can(caller.profile, 'ngrp_manage')) return res.status(403).json({ error: 'ngrp_role_required' })
  const actorId = caller.profile.id

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  // S1: this endpoint addresses nobody from the request body.
  if ('email' in body || 'to' in body || 'cc' in body || 'bcc' in body) {
    return res.status(400).json({ error: 'recipient_fields_not_accepted' })
  }
  const cycleId = typeof body.cycle_id === 'string' ? body.cycle_id : null
  if (!cycleId || !UUID.test(cycleId)) return res.status(422).json({ error: 'invalid_cycle_id' })
  const studentIds = Array.isArray(body.student_ids) ? [...new Set(body.student_ids.filter(v => typeof v === 'string' && UUID.test(v)))] : []
  if (!studentIds.length) return res.status(422).json({ error: 'no_recipients' })
  if (studentIds.length > MAX_RECIPIENTS) {
    // Whole-request refusal - never a partial send of an oversized batch.
    return res.status(422).json({ error: 'too_many_recipients', max: MAX_RECIPIENTS })
  }
  const resend = body.resend === true
  const preview = body.preview === true

  const db = getServiceDb()

  const cyc = await db.from('ngrp_cycles').select('*').eq('id', cycleId).maybeSingle()
  if (cyc.error) {
    return isMissingNgrpTable(cyc.error)
      ? res.status(200).json({ provisioned: false })
      : res.status(500).json({ error: 'internal_error' })
  }
  if (!cyc.data) return res.status(404).json({ error: 'cycle_not_found' })
  const cycle = cyc.data

  // Readiness: no application deadline (or no active units) → sending is
  // refused with the same reasons Planning shows.
  const unitsRes = await db.from('ngrp_cycle_units').select('id, is_active').eq('cycle_id', cycleId)
  if (unitsRes.error) {
    return isMissingNgrpTable(unitsRes.error)
      ? res.status(200).json({ provisioned: false })
      : res.status(500).json({ error: 'internal_error' })
  }
  const mapCount = await db.from('ngrp_cycle_source_cohorts').select('cohort_id').eq('cycle_id', cycleId)
  if (mapCount.error) return res.status(500).json({ error: 'internal_error' })
  const readiness = openReadiness({
    cycle,
    sourceCohortCount: (mapCount.data || []).length,
    activeUnitCount: (unitsRes.data || []).filter(u => u.is_active).length,
  })
  if (!readiness.ok) return res.status(422).json({ error: 'cycle_not_ready', reasons: readiness.reasons })

  const classified = await classifySelection(db, cycle, studentIds, resend)
  if (classified.error) {
    return isMissingNgrpTable(classified.error)
      ? res.status(200).json({ provisioned: false })
      : res.status(500).json({ error: 'internal_error' })
  }

  const describe = list => list.map(x => ({
    student_id: x.student.id,
    name: x.student.name || `${x.student.first_name || ''} ${x.student.last_name || ''}`.trim(),
    school: x.student.school || '',
    has_email: Boolean(x.student.email ?? x.student.has_email),
  }))

  // ── Preview mode: classification only, nothing is created or sent ──────────
  if (preview) {
    return res.status(200).json({
      provisioned: true,
      cycle: { id: cycle.id, name: cycle.name, application_deadline: cycle.application_deadline },
      send: describe(classified.send),
      reissue: describe(classified.reissue),
      skipped: classified.skipped.map(x => ({
        student_id: x.student.id,
        name: x.student.name || `${x.student.first_name || ''} ${x.student.last_name || ''}`.trim(),
        reason: x.reason,
      })),
      out_of_scope: classified.outOfScope,
    })
  }

  // ── Send mode gates ────────────────────────────────────────────────────────
  if (body.confirmation !== CONFIRMATION) return res.status(400).json({ error: 'confirmation_required' })
  const batchId = typeof body.batch_id === 'string' && UUID.test(body.batch_id) ? body.batch_id : null
  if (!batchId) return res.status(422).json({ error: 'invalid_batch_id' })

  const resendClient = new Resend(process.env.RESEND_API_KEY)
  const baseUrl = emailBaseUrl(req)
  const nowIsoBatch = new Date().toISOString()

  const sendEmail = async ({ to, subject, html }) => {
    try {
      let { data, error } = await resendClient.emails.send({ from: FROM, to, subject, html })
      if (error && isRateLimited(error)) {
        await sleep(RATE_RETRY_MS)
        ;({ data, error } = await resendClient.emails.send({ from: FROM, to, subject, html }))
      }
      if (error) return { ok: false, reason: 'provider_rejected' }
      return { ok: true, providerId: data?.id || null }
    } catch {
      return { ok: false, reason: 'provider_error' }
    }
  }

  const results = { sent: [], skipped: [], failed: [] }
  for (const s of classified.skipped) {
    results.skipped.push({ student_id: s.student.id, reason: s.reason })
  }
  for (const id of classified.outOfScope) {
    results.skipped.push({ student_id: id, reason: 'not_in_cycle_scope' })
  }

  // Batch idempotency: a retried request with the same batch_id skips anyone
  // this batch already mailed, so a double-click cannot double-send.
  const probe = await db.from('notification_log')
    .select('student_id')
    .eq('notification_type', NOTIFICATION_TYPE)
    .eq('metadata->>batch_id', batchId)
  const alreadyInBatch = new Set((probe.data || []).map(r => r.student_id).filter(Boolean))

  let attempted = false
  for (const item of [...classified.send, ...classified.reissue]) {
    const student = item.student
    if (alreadyInBatch.has(student.id)) {
      results.skipped.push({ student_id: student.id, reason: 'already_sent_in_batch' })
      continue
    }
    if (attempted) await sleep(SEND_DELAY_MS)
    attempted = true

    const outcome = await sendOneTransitionForm({
      db, cycle, student,
      candidate: item.candidate || null,
      assignment: item.assignment || null,
      actorProfileId: actorId,
      generateToken,
      sendEmail,
      buildEmail: buildTransitionEmail,
      baseUrl,
    })

    if (outcome.outcome === 'failed') {
      results.failed.push({ student_id: student.id, reason: outcome.reason })
      continue
    }

    // Ledger row (never the URL, never the raw token). Like the evaluation
    // secure sends, the BODY is deliberately not archived: it contains a
    // personal secure link, and Sent History classifies the type as
    // secure_link_email ("body not stored") rather than re-rendering one.
    try {
      const { data: logRow } = await db.from('notification_log').insert({
        notification_type: NOTIFICATION_TYPE,
        audience: 'student',
        recipient_email: student.email,
        recipient_name: student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim(),
        recipient_role: 'Student',
        subject: outcome.subject,
        status: 'sent',
        resend_email_id: outcome.providerId,
        sent_at: nowIsoBatch,
        recipient_type: 'student',
        student_id: student.id,
        metadata: {
          batch_id: batchId,
          template_key: TEMPLATE_KEY,
          template_label: 'NGRP Transition Form Invitation',
          cycle_id: cycle.id,
          cycle_name: cycle.name,
          recipient_email_norm: String(student.email).trim().toLowerCase(),
          token_hash_prefix: outcome.tokenHashPrefix,
          resent: outcome.outcome === 'resent',
          sent_by_user_id: caller.profile.id,
          // transition form URL / token intentionally omitted - must not be persisted.
        },
      }).select('id').single()
      void logRow
    } catch (logErr) {
      console.error('[ngrp-transition-send] log_write_failed:', { batch_id: batchId, error: logErr?.message })
    }
    await recordNgrpAudit(db, {
      eventType: outcome.outcome === 'resent' ? 'token_resent' : 'form_sent',
      cycleId: cycle.id, candidateId: outcome.candidateId, assignmentId: outcome.assignmentId,
      studentId: student.id, actorProfileId: actorId,
      metadata: { batch_id: batchId, token_hash_prefix: outcome.tokenHashPrefix },
    })
    results.sent.push({ student_id: student.id, resent: outcome.outcome === 'resent' })
  }

  return res.status(200).json({
    success: true,
    batch_id: batchId,
    summary: {
      total: studentIds.length,
      sent: results.sent.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
    },
    sent: results.sent,
    skipped: results.skipped,
    failed: results.failed,
  })
}
