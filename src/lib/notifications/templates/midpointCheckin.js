// src/lib/notifications/templates/midpointCheckin.js
// Midpoint check-in email sent to Active Rotation students at ~50% hours completion.
// EMAIL-BRAND-REFRESH Phase 2B-4: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) — Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line.
// MIDPOINT-CHECKIN-COPY-1: refreshed subject + body copy; adds Jester's handwritten GIF signature as
// an EXPLICIT midpoint-only exception (the shared aspireSystemSignature stays typed-only for every
// other automated/system email — this template no longer imports it).

import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { renderEmailNote } from '../../../../lib/server/email/emailPrimitives.js';

const NAVY   = '#1d2567';
const RAVEN  = '#191919';
const CS_RED = '#dc1e34';

// Handwritten-signature GIF — the SAME existing public asset used by ASPIRE Connect manual Outreach.
// Midpoint-only exception; no other automated email receives it. Asset is not created or edited here.
const JESTER_SIGNATURE_GIF = 'https://aspire-tracker.vercel.app/signature-jester.gif';

export function buildMidpointCheckinEmail({ firstName, approvedHours, hoursRequired, unitName }) {
  const subject   = 'ASPIRE Mid-Rotation Check-In';
  const preheader = `You're about halfway through your rotation, so I wanted to check in.`;

  // Dynamic values are safe: firstName is escaped below; the hours are numeric (parseFloat + toFixed,
  // no injection surface); unitName is HTML-escaped here before it is interpolated.
  const unit = escapeHtml(unitName || '');
  const hasHours = approvedHours != null && hoursRequired != null && parseFloat(hoursRequired) > 0;
  const hoursParagraph = hasHours
    ? `<p style="margin:0 0 16px;">You are currently at ${parseFloat(approvedHours).toFixed(1)} of your ${parseFloat(hoursRequired).toFixed(0)} required hours${unitName ? ` on ${unit}` : ''}, which is a good time for us to hear how things are going and address anything that may need support before the remainder of your rotation.</p>`
    : `<p style="margin:0 0 16px;">You are at the midpoint of your ASPIRE senior rotation${unitName ? ` on ${unit}` : ''}, which is a good time for us to hear how things are going and address anything that may need support before the remainder of your rotation.</p>`;

  // Midpoint-only signature: "Kind regards," + handwritten GIF (160x60) + typed block. The typed block
  // mirrors aspireSystemSignature exactly; only the GIF insertion is unique to this template.
  const signature = `
<p style="margin:24px 0 6px;font-size:14px;color:${RAVEN};">Kind regards,</p>
<img src="${JESTER_SIGNATURE_GIF}" alt="Jester Lloyd Bautista" width="160" height="60" style="display:block;width:160px;max-width:160px;height:auto;border:0;margin:6px 0 0;" />
<p style="margin:0;font-size:14px;color:${RAVEN};line-height:1.6;">
  <strong style="color:${CS_RED};">Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN</strong>
  <span style="display:block;">Nursing Professional Development Practitioner</span>
  <span style="display:block;">Geri &amp; Richard Brawerman Nursing Institute</span>
  <span style="display:block;margin-top:2px;"><a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};text-decoration:none;">jesterlloyd.bautista@cshs.org</a> | Office: 310-248-8964</span>
</p>`;

  const body = `
<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>

<p style="margin:0 0 16px;">I hope your rotation is going well. I wanted to check in as you reach the midpoint of your ASPIRE senior rotation.</p>

${hoursParagraph}

<p style="margin:0 0 16px;">When you have a chance, please send a brief update directly to me at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};">jesterlloyd.bautista@cshs.org</a>. Since this message is sent from a no-reply email address, please do not respond directly to this email.</p>

<p style="margin:0 0 10px;">In your update, it would be helpful to hear about the following:</p>
<ol style="margin:0 0 20px;padding-left:22px;color:${RAVEN};">
  <li style="margin-bottom:10px;">How has your experience been on the unit so far?</li>
  <li style="margin-bottom:10px;">Do you feel supported by your preceptor and the unit team?</li>
  <li style="margin-bottom:10px;">Are you receiving the type of learning opportunities you were hoping for?</li>
  <li style="margin-bottom:0;">Is there anything you need from me or the ASPIRE team at this point?</li>
</ol>

<p style="margin:0 0 16px;">Even a short message is helpful. Your feedback allows us to support you during your current rotation and helps us continue improving the ASPIRE experience for future students.</p>

${renderEmailNote({
  title: 'Reminder: Patient Confidentiality',
  body: 'Please do not include any patient names, case details, medical record information, or protected health information in your message. General comments about your learning experience, unit environment, preceptor support, and any needs or concerns are always welcome.',
  tone: 'warning',
})}

<p style="margin:0 0 4px;">Thank you for being part of ASPIRE. We are glad to have you with us, and I look forward to hearing how your rotation is going.</p>
${signature}`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}

export const midpointCheckin = {
  student: (ctx) => buildMidpointCheckinEmail(ctx),
};
