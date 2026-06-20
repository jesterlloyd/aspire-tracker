// lib/server/evaluation/studentEvalEmailTemplates.js
//
// Server-side email template builder for the ASPIRE Student Evaluation of Preceptor/Unit
// Experience survey (SR-2b-2). Separate from the Casey-Fink (emailTemplates.js) and
// preceptor (preceptorEmailTemplates.js) builders, neither of which is touched.
//
// This is a learning-environment / experience survey sent to the STUDENT. It contains no
// hiring, endorsement, or evaluative-of-student language. HTML structure mirrors the shared
// evaluation email pattern (Nightfall header, Cedars-Sinai logo, sand background).

import { JESTER_SIGNATURE } from '../../../src/lib/notifications/templates/signatures.js';

const NAVY = '#1D2567';
const SAND = '#F4F1EC';
const RAVEN = '#191919';
const JESTER_PHONE = '310-248-8964';

// Format an ISO date/datetime as "Month Day, Year" (LA timezone for full datetimes).
export function formatExpiresAt(isoDatetime) {
  if (!isoDatetime) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDatetime)) {
    const [y, m, dy] = isoDatetime.split('-').map(Number);
    return new Date(y, m - 1, dy).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  }
  const d = new Date(isoDatetime);
  if (isNaN(d.getTime())) return isoDatetime;
  return d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
  });
}

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
<tr><td style="background:${NAVY};padding:20px 28px;">
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
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>
<tr><td style="padding:0 28px 24px;font-size:11px;color:#999;line-height:1.5;border-top:1px solid #eee;padding-top:16px;">
  This is an automated notification from the ASPIRE Program at Cedars-Sinai Medical Center.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// Build the student survey invitation email.
//
// Arguments:
//   studentFirstName — greeting name for the student
//   expiresAtHuman   — formatted date string (use formatExpiresAt)
//   surveyUrl        — the survey URL including the token hash fragment
//
// Returns: { subject, html }
export function buildStudentEvalInvitationEmail({ studentFirstName, expiresAtHuman, surveyUrl }) {
  const greeting  = studentFirstName ? `Hi ${studentFirstName},` : 'Hello,';
  const subject   = 'ASPIRE: Share Feedback on Your Preceptor & Unit';
  const preheader = 'Your feedback helps improve the ASPIRE learning environment for future students.';

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>

<p style="margin:0 0 16px;">Congratulations on completing your ASPIRE clinical rotation. We&rsquo;d value your feedback on your
learning experience and the support you received. Your responses help us strengthen the ASPIRE learning
environment for future students.</p>

<p style="margin:0 0 10px;">A few notes:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;line-height:1.7;">
  <li>This is the Student Feedback: Preceptor &amp; Unit survey — a short survey about your rotation experience.</li>
  <li>It is <strong>not</strong> a performance review of your preceptor.</li>
  <li>Please answer honestly based on your own experience.</li>
</ul>

<!-- CTA button -->
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td>
  <a href="${surveyUrl}"
    style="display:inline-block;background:${NAVY};color:#ffffff;padding:12px 28px;
           border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;
           letter-spacing:0.01em;">
    Share Your Feedback →
  </a>
</td></tr>
</table>

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

<p style="margin:0 0 24px;font-size:13px;color:#666;">
  This link is unique to you. Please do not share it. It will expire on <strong>${expiresAtHuman}</strong>.
</p>

<p style="margin:0 0 6px;font-size:14px;">With appreciation,</p>
<p style="margin:0;font-size:14px;">
  <strong>${JESTER_SIGNATURE.fullName}</strong><br>
  ${JESTER_SIGNATURE.affiliation}<br>
  <a href="mailto:${JESTER_SIGNATURE.email}" style="color:${NAVY};">${JESTER_SIGNATURE.email}</a>
  &nbsp;|&nbsp;Office: ${JESTER_PHONE}
</p>
`;

  return { subject, html: wrap(body, preheader) };
}
