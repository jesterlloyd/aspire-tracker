// src/lib/notifications/templates/midpointCheckin.js
// Midpoint check-in email sent to Active Rotation students at ~50% hours completion.
// EMAIL-BRAND-REFRESH Phase 2B-4: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) — Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. Typed system signature only (no handwritten image).

import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell, aspireSystemSignature } from '../../../../lib/server/email/aspireShell.js';

const NAVY  = '#1d2567';
const RAVEN = '#191919';

export function buildMidpointCheckinEmail({ firstName, approvedHours, hoursRequired, unitName }) {
  const subject   = `Checking in: how is your ASPIRE rotation going?`;
  const preheader = `You're about halfway through your rotation, so I wanted to check in.`;

  const hoursLine = (approvedHours != null && hoursRequired != null && parseFloat(hoursRequired) > 0)
    ? `<p style="margin:0 0 16px;">You're currently at ${parseFloat(approvedHours).toFixed(1)} of your ${parseFloat(hoursRequired).toFixed(0)} required hours${unitName ? ` on ${unitName}` : ''}, roughly halfway through your rotation. That's the milestone that prompted this note.</p>`
    : '';

  const body = `
<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>

<p style="margin:0 0 16px;">I hope your rotation is going well. I wanted to reach out directly to check in, not as a formality, but because I genuinely want to know how things are going for you.</p>

${hoursLine}

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">A few things I'd love to hear from you</p>
<ul style="margin:0 0 20px;padding-left:22px;color:${RAVEN};">
  <li style="margin-bottom:10px;">How is the unit environment? Is it what you expected, and are you getting the learning opportunities you were hoping for?</li>
  <li style="margin-bottom:10px;">How is your relationship with your preceptor? Is the teaching style a good fit, and do you feel supported?</li>
  <li style="margin-bottom:10px;">Is there anything you wish had been different about the preparation or the placement itself?</li>
  <li style="margin-bottom:0;">Is there anything you need from me: an introduction, a clarification with the unit, or just a conversation?</li>
</ul>

<p style="margin:0 0 16px;">To share a few sentences, email me directly at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};">jesterlloyd.bautista@cshs.org</a>. Even a short note is helpful. Your feedback directly shapes how we support future ASPIRE students, and it helps the ASPIRE team identify anything that may need attention before your rotation ends.</p>

<!-- Patient confidentiality reminder -->
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#FFF8F0;border-left:3px solid #d97706;border-radius:0 6px 6px 0;margin:0 0 24px;">
<tr><td style="padding:14px 16px;">
  <div style="font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Reminder: Patient Confidentiality</div>
  <div style="font-size:13px;color:#78350f;line-height:1.5;">Please do not share any patient information, case details, or unit-specific protected health information in your email. General observations about the rotation environment and your experience are always welcome.</div>
</td></tr>
</table>

<p style="margin:0 0 4px;">Thank you for being part of ASPIRE. I'm glad you're here.</p>
${aspireSystemSignature('Kind regards,')}`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}

export const midpointCheckin = {
  student: (ctx) => buildMidpointCheckinEmail(ctx),
};
