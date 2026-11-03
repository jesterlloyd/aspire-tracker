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
// same rule applied to the one email that is sent by hand. It has already earned its
// keep: rendering the preview is how the wrong program name was caught.
//
// PURE AND CLIENT-SAFE. No Resend, no Supabase, no tokens, no environment reads of its
// own. It takes a URL and returns { subject, html }. The endpoint mints the real
// per-recipient token and passes the URL in; the preview passes a visibly fake one. A
// raw token may never round-trip through the browser, and nothing here can leak one
// because nothing here creates one. Both modules it imports are environment-agnostic
// (src/lib/appUrl.js is a plain constant), which is what makes the shared import safe.

import { aspireEmailShell } from './aspireShell.js'
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js'
import { ACTIVATION_PAGE_SENTENCE } from '../activationLifetime.js'
import { transitionDisclaimer } from '../../../src/lib/ngrp/transitionDisclaimer.js'

// NGRP-TRANSITION-COPY-2: the handwritten GIF signature, not the typed one. Every
// comparable student secure-link email (post-rotation evaluation, student evaluation,
// preceptor evaluation, the certificate) already closes with it; this template was the
// last holdout. aspireSystemSignature stays correct for the reply-able Messages and
// portal-feedback mail, which close with "Thank you,".

// This email names a monitored team mailbox in its body, so its footer names the same
// one rather than sending the reader to a second address for the same question. The
// no-reply half of the default line is preserved. aspire@cshs.org is approved for
// external use (Owner approval 2026-07-12, recorded in src/public-site/publicContent.js).
const SUPPORT_EMAIL = 'aspire@cshs.org'
const FOOTER_NOTE =
  `Please do not reply to this automated email. For questions, email the ASPIRE team at ${SUPPORT_EMAIL}.`

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
//
// The cohort name is INTERPOLATED, never written in. Renaming a residency cohort
// changes every subsequent email on its own, and the preview reads the live cohort for
// the same reason: a sample name frozen in a fixture goes stale silently.
export function buildTransitionEmail({ student, cycle, url, closeText, portal = null }) {
  const first = escapeHtml(student.first_name || student.name || 'there')
  const cohortName = escapeHtml(cycle.name || 'the upcoming residency cohort')
  const closeDate = fmtCloseDate(closeText)
  const until = closeDate ? `until <strong>${closeDate}</strong>` : 'until the cohort closes'
  const opens = fmtDay(cycle.application_open_date)
  const body = `
    <p style="margin:0 0 14px;">Hi ${first},</p>
    <p style="margin:0 0 14px;">
      Congratulations on completing ASPIRE. As an alum, the next step toward the
      <strong>${cohortName}</strong> New Graduate RN Residency Program (NGRP) application is the
      secure <strong>Transition Form</strong> below. It gathers your licensure, education, and
      residency interest details so the ASPIRE team and Cedars-Sinai Talent Acquisition can
      review your eligibility.
    </p>
    ${button(url, 'Open your Transition Form')}
    <p style="margin:0 0 14px;">
      This link is personal to you, please do not forward it. You can save a draft and return,
      and you may revise a submitted form ${until}.
    </p>
    ${portal ? portalSection(portal, until) : ''}
    <p style="margin:0 0 14px;color:#4a5560;font-size:13px;">
      ${transitionDisclaimer(opens)}
    </p>
    <p style="margin:0 0 14px;">
      If you have questions, email <a href="mailto:${SUPPORT_EMAIL}"
        style="color:#1d2567;">${SUPPORT_EMAIL}</a>.
    </p>
    ${aspireHandwrittenSignature('Kind regards,')}
  `
  return {
    subject: `Your NGRP Transition Form - ${cycle.name || 'ASPIRE'}`,
    html: aspireEmailShell({ body, preheader: 'Your secure NGRP Transition Form is ready.', footerNote: FOOTER_NOTE }),
  }
}

function fmtDay(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return null
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td
      style="background:#1d2567;border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:13px 26px;color:#ffffff;
        font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">
        ${label}</a>
    </td></tr></table>`
}

// The Student Portal: the same form under their own sign-in, with no emailed code. portal is
// { signInUrl, signInEmail, accessEndsAt, activationLink } from lib/server/ngrpPortalAccess.js.
function portalSection(portal, until) {
  const ends = fmtCloseDate(portal.accessEndsAt)
  const who = portal.signInEmail ? ` You sign in with <span style="white-space:nowrap;">${escapeHtml(portal.signInEmail)}</span>.` : ''
  const lead = `
    <p style="margin:18px 0 10px;font-weight:600;color:#1d2567;">Your ASPIRE Student Portal</p>
    <p style="margin:0 0 14px;">
      You can also open the same form in the Student Portal, under <strong>Residency</strong>, and
      edit your answers there ${until}. Signing in to the portal needs no code.
      ${ends ? `Your portal access runs through <strong>${ends}</strong>.` : ''}
    </p>`
  if (portal.activationLink) {
    return `${lead}
    <p style="margin:0 0 6px;">First, set your portal password.${who}</p>
    ${button(portal.activationLink, 'Set your portal password')}
    <p style="margin:0 0 14px;color:#4a5560;font-size:13px;">
      ${escapeHtml(ACTIVATION_PAGE_SENTENCE)} If it expires, go to the sign-in page and choose
      <strong>Email me a new activation link</strong>.
    </p>`
  }
  return `${lead}
    <p style="margin:0 0 14px;">
      <a href="${portal.signInUrl}" style="color:#1d2567;font-weight:600;">Sign in to the Student Portal</a>.${who}
      Forgot your password? Choose <strong>Forgot your password?</strong> on the sign-in page.
    </p>`
}

// TRANSITION-REMINDER-1: the daily reminder until the form is in. Same button, same mailbox, same
// signature as the invitation; it stops by itself once they submit, and says so.
export function buildTransitionReminderEmail({ student, cycle, url, closeText }) {
  const first = escapeHtml(student.preferred_first_name || student.first_name || student.name || 'there')
  const cohortName = escapeHtml(cycle.name || 'the upcoming residency cohort')
  const closeDate = fmtCloseDate(closeText)
  const body = `
    <p style="margin:0 0 14px;">Hi ${first},</p>
    <p style="margin:0 0 14px;">
      We have not received your <strong>Transition Form</strong> for the
      <strong>${cohortName}</strong> New Graduate RN Residency Program (NGRP) yet.
      ${closeDate ? `It closes on <strong>${closeDate}</strong>.` : ''}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td
      style="background:#1d2567;border-radius:8px;">
      <a href="${url}" style="display:inline-block;padding:13px 26px;color:#ffffff;
        font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">
        Open your Transition Form</a>
    </td></tr></table>
    <p style="margin:0 0 14px;">
      This link is personal to you, please do not forward it. Anything you already saved is still
      there, and the links in our earlier emails still work.
    </p>
    <p style="margin:0 0 14px;color:#4a5560;font-size:13px;">
      We will send this reminder each day until your form is in. Once you submit it, the reminders stop.
    </p>
    <p style="margin:0 0 14px;">
      If you have questions, email <a href="mailto:${SUPPORT_EMAIL}"
        style="color:#1d2567;">${SUPPORT_EMAIL}</a>.
    </p>
    ${aspireHandwrittenSignature('Kind regards,')}
  `
  return {
    subject: `Reminder: Your NGRP Transition Form - ${cycle.name || 'ASPIRE'}`,
    html: aspireEmailShell({ body, preheader: 'We have not received your Transition Form yet.', footerNote: FOOTER_NOTE }),
  }
}
