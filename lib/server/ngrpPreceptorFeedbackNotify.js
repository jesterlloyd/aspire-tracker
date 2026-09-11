// lib/server/ngrpPreceptorFeedbackNotify.js
//
// RESIDENCY-PORTAL-2c: tell a Talent Acquisition requester, by email, that the
// ASPIRE team approved, declined, or withdrew their request to view preceptor
// feedback (Owner, 2026-09-11; wording in ./email/preceptorFeedbackDecisionEmail.js).
//
// BEST EFFORT BY DESIGN. It runs after the decision is saved and only reports
// whether the email went out; it never throws and never undoes a decision. An
// inactive requester, or one with no email address, is not emailed.
import process from 'node:process'
import { Resend } from 'resend'
import { appUrl } from './appUrl.js'
import { getStudentPreferredFullName } from '../../src/lib/studentNameFormatters.js'
import { preceptorFeedbackDecisionEmail, SUPPORT_EMAIL } from './email/preceptorFeedbackDecisionEmail.js'

// The sender every NGRP email uses (api/ngrp-transition-send.js). Replies go to
// the team inbox named in the email.
export const FEEDBACK_DECISION_FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'

async function resendSend(message) {
  if (!process.env.RESEND_API_KEY) return { error: new Error('resend_not_configured') }
  return new Resend(process.env.RESEND_API_KEY).emails.send(message)
}

export async function notifyRequesterOfDecision(db, { requestId, decision, note } = {}, { send = resendSend } = {}) {
  try {
    const r = await db.from('ngrp_preceptor_feedback_requests')
      .select('id, candidate_id, student_id, requester_profile_id')
      .eq('id', requestId).maybeSingle()
    if (r.error || !r.data) return { emailed: false, reason: 'request_not_found' }

    const [profile, student] = await Promise.all([
      db.from('user_profiles').select('full_name, email, is_active').eq('id', r.data.requester_profile_id).maybeSingle(),
      db.from('students').select('first_name, last_name, preferred_first_name').eq('id', r.data.student_id).maybeSingle(),
    ])
    if (profile.error || student.error) return { emailed: false, reason: 'lookup_failed' }
    const to = typeof profile.data?.email === 'string' ? profile.data.email.trim() : ''
    if (!to || profile.data.is_active === false) return { emailed: false, reason: 'no_recipient' }

    const message = preceptorFeedbackDecisionEmail({
      decision,
      note,
      requesterFirstName: String(profile.data.full_name || '').trim().split(/\s+/)[0],
      alumnusName: getStudentPreferredFullName(student.data || {}),
      link: appUrl(`/portal/residency/profiles?candidate=${r.data.candidate_id}`),
    })
    if (!message) return { emailed: false, reason: 'invalid_decision' }

    const { error } = await send({
      from: FEEDBACK_DECISION_FROM,
      to,
      reply_to: SUPPORT_EMAIL,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    return error ? { emailed: false, reason: 'send_failed' } : { emailed: true }
  } catch {
    return { emailed: false, reason: 'send_failed' }
  }
}
