// src/lib/notifications/templates/midpointCheckin.js
// Midpoint check-in email sent to Active Rotation students at ~50% hours completion.
// Template version: v1.0

import { JESTER_SIGNATURE } from './signatures.js';

const NAVY   = '#1D2567';   // Nightfall — ASPIRE Intelligence primary brand color
const SAND   = '#F4F1EC';
const RAVEN  = '#191919';

const JESTER_PHONE = '310-248-8964';

function wrap(content, preheader) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASPIRE Program</title></head>
<body style="margin:0;padding:0;background:${SAND};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${RAVEN};">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
  style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

<!-- Nightfall header with reversed CS logo — canonical ASPIRE shell -->
<tr><td style="background:${NAVY};padding:12px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td style="vertical-align:middle;">
      <img src="https://aspire-tracker.vercel.app/cs-logo-large.png"
           alt="Cedars-Sinai"
           width="160" height="auto"
           style="display:block;height:auto;max-height:46px;width:auto;max-width:160px;border:0;" />
    </td>
    <td style="text-align:right;vertical-align:middle;">
      <div style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;line-height:1.4;">ASPIRE Program</div>
      <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:0.3px;margin-top:3px;line-height:1.4;">Brawerman Nursing Institute</div>
    </td>
  </tr></table>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>

<!-- Footer -->
<tr><td style="padding:16px 28px 28px;font-size:12px;color:#9ca3af;line-height:1.5;border-top:1px solid #f0ede8;">
  This is an automated check-in from the ASPIRE Program. Replies go directly to Jester.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function buildMidpointCheckinEmail({ firstName, approvedHours, hoursRequired, unitName }) {
  const subject   = `Checking in: how is your ASPIRE rotation going?`;
  const preheader = `You're about halfway through your rotation — I wanted to check in directly.`;

  const hoursLine = (approvedHours != null && hoursRequired != null && parseFloat(hoursRequired) > 0)
    ? `<p style="margin:0 0 16px;">You're currently at ${parseFloat(approvedHours).toFixed(1)} of your ${parseFloat(hoursRequired).toFixed(0)} required hours${unitName ? ` on ${unitName}` : ''} — roughly halfway through your rotation. That's the milestone that prompted this note.</p>`
    : '';

  const body = `
<p style="margin:0 0 16px;">Hi ${firstName},</p>

<p style="margin:0 0 16px;">I hope your rotation is going well. I wanted to reach out directly to check in — not as a formality, but because I genuinely want to know how things are going for you.</p>

${hoursLine}

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">A few things I'd love to hear from you</p>
<ul style="margin:0 0 20px;padding-left:22px;color:${RAVEN};">
  <li style="margin-bottom:10px;">How is the unit environment? Is it what you expected, and are you getting the learning opportunities you were hoping for?</li>
  <li style="margin-bottom:10px;">How is your relationship with your preceptor? Is the teaching style a good fit, and do you feel supported?</li>
  <li style="margin-bottom:10px;">Is there anything you wish had been different about the preparation or the placement itself?</li>
  <li style="margin-bottom:0;">Is there anything you need from me — an introduction, a clarification with the unit, or just a conversation?</li>
</ul>

<p style="margin:0 0 16px;">Just hit reply — even a few sentences is helpful. Your feedback directly shapes how we support future ASPIRE students, and it helps me advocate for you if anything needs to be addressed before your rotation ends.</p>

<!-- Patient confidentiality reminder -->
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#FFF8F0;border-left:3px solid #d97706;border-radius:0 6px 6px 0;margin:0 0 24px;">
<tr><td style="padding:14px 16px;">
  <div style="font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Reminder: Patient Confidentiality</div>
  <div style="font-size:13px;color:#78350f;line-height:1.5;">Please do not share any patient information, case details, or unit-specific protected health information in your reply. General observations about the rotation environment and your experience are always welcome.</div>
</td></tr>
</table>

<p style="margin:0 0 20px;">Thank you for being part of ASPIRE. I'm glad you're here.</p>

<p style="margin:0;">
  ${JESTER_SIGNATURE.fullName}<br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span><br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.email} | Office: ${JESTER_PHONE}</span>
</p>`;

  return { subject, html: wrap(body, preheader) };
}

export const midpointCheckin = {
  student: (ctx) => buildMidpointCheckinEmail(ctx),
};
