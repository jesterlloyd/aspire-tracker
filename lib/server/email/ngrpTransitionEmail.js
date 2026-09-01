// lib/server/email/ngrpTransitionEmail.js
//
// NGRP-TRANSITION-PREVIEW-1: the Transition Form invitation email, extracted VERBATIM
// from api/ngrp-transition-send.js so the in-app preview renders the SAME builder the
// send uses.
//
// PREVIEW EQUALS SENT. That is the whole reason this file exists. A preview that
// re-implements the copy is a second template that drifts, and the drift is invisible
// until a student receives something nobody reviewed. src/lib/notifications/
// previewFixtures.js already states this rule for the automation previews; this is the
// same rule applied to the one email that is sent by hand.
//
// PURE AND CLIENT-SAFE. No Resend, no Supabase, no tokens, no environment reads of its
// own. It takes a URL and returns { subject, html }. The endpoint mints the real
// per-recipient token and passes the URL in; the preview passes a visibly fake one. A
// raw token may never round-trip through the browser, and nothing here can leak one
// because nothing here creates one.

import { aspireEmailShell, aspireSystemSignature } from './aspireShell.js'

const escapeHtml = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The close instant is Pacific end-of-day (effectiveFormClose), so the email
// copy formats it in America/Los_Angeles - the SAME calendar date the staff
// configured, never the UTC rollover date.
function fmtCloseDate(closeIso) {
  if (!closeIso) return null
  const d = new Date(closeIso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
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
      toward the <strong>${cohortName}</strong> New Graduate RN Residency Program (NGRP) is the secure
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
