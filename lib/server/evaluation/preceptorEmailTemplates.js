// lib/server/evaluation/preceptorEmailTemplates.js
//
// Server-side email template builder for the ASPIRE Preceptor Student Progress &
// Readiness Feedback survey (PS-2b). Separate from the Casey-Fink student template
// builder (emailTemplates.js) so the Casey-Fink path is untouched.
//
// Compliance: this survey is developmental/readiness feedback, NOT a hiring tool.
// Every variant states that any endorsement is "for consideration" only and is not a
// hiring decision, that specific examples are helpful, that confidential comments are
// reviewed by the ASPIRE team / unit leadership, and that the survey does not replace
// real-time coaching.
//
// HTML structure mirrors the shared evaluation email pattern (Nightfall header,
// Cedars-Sinai logo, sand background). Credential source: signatures.js.

import { JESTER_SIGNATURE } from '../../../src/lib/notifications/templates/signatures.js';

const NAVY = '#1D2567';
const SAND = '#F4F1EC';
const RAVEN = '#191919';
const JESTER_PHONE = '310-248-8964';

// Period labels for the survey-details block.
export const PERIOD_LABELS = {
  midpoint:        'Midpoint',
  end_of_rotation: 'End of Rotation',
  other_interim:   'Other / Interim Check-In',
};

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

// Per-period intro copy. Each leads the email body before the shared compliance block.
function introCopy(period, studentName) {
  switch (period) {
    case 'midpoint':
      return `${studentName} is at a midpoint feedback point in their ASPIRE clinical rotation. We are requesting your feedback to support coaching and the student's continued development.`;
    case 'end_of_rotation':
      return `${studentName} is completing their ASPIRE clinical rotation. We are requesting your end-of-rotation feedback to support summative review, transition readiness, and placement insight.`;
    case 'other_interim':
    default:
      return `We are requesting interim feedback on ${studentName} to support their development during the ASPIRE clinical rotation.`;
  }
}

function subjectFor(period, studentName) {
  switch (period) {
    case 'midpoint':        return `ASPIRE: Midpoint Readiness Check-In for ${studentName}`;
    case 'end_of_rotation': return `ASPIRE: Student Readiness Feedback Requested for ${studentName}`;
    case 'other_interim':
    default:                return `ASPIRE: Student Readiness Feedback Requested for ${studentName}`;
  }
}

// Build the preceptor invitation email.
//
// Arguments:
//   period            — 'midpoint' | 'end_of_rotation' | 'other_interim'
//   studentName       — subject student's display name
//   preceptorFirstName— greeting name for the responding preceptor
//   expiresAtHuman    — formatted date string (use formatExpiresAt)
//   surveyUrl         — the survey URL including the token hash fragment
//
// Returns: { subject, html }
export function buildPreceptorInvitationEmail({
  period,
  studentName,
  preceptorFirstName,
  expiresAtHuman,
  surveyUrl,
}) {
  const safePeriod = PERIOD_LABELS[period] ? period : 'other_interim';
  const subject    = subjectFor(safePeriod, studentName);
  const preheader  = `Your feedback supports ${studentName}'s development and readiness.`;
  const greeting   = preceptorFirstName ? `Hi ${preceptorFirstName},` : 'Hello,';

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>

<p style="margin:0 0 16px;">${introCopy(safePeriod, studentName)}</p>

<!-- Survey details block -->
<table role="presentation" cellpadding="0" cellspacing="0"
  style="width:100%;background:${SAND};border-radius:8px;margin:0 0 24px;">
<tr><td style="padding:18px 20px;">
  <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-weight:600;">Feedback Request</div>
  <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Assessment</strong></td>
      <td style="padding:4px 0;font-size:14px;">Preceptor Student Readiness Assessment</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Student</strong></td>
      <td style="padding:4px 0;font-size:14px;">${studentName}</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Feedback Period</strong></td>
      <td style="padding:4px 0;font-size:14px;">${PERIOD_LABELS[safePeriod]}</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Please complete by</strong></td>
      <td style="padding:4px 0;font-size:14px;">${expiresAtHuman}</td>
    </tr>
  </table>
</td></tr>
</table>

<p style="margin:0 0 10px;">A few notes as you complete this feedback:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;line-height:1.7;">
  <li>Specific examples are especially helpful.</li>
  <li>Any endorsement you provide is <strong>for consideration only</strong> and is not a hiring decision.</li>
  <li>The confidential section is reviewed by the ASPIRE team and unit leadership.</li>
  <li>This survey does not replace real-time coaching during the shift.</li>
</ul>

<!-- CTA button -->
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td>
  <a href="${surveyUrl}"
    style="display:inline-block;background:${NAVY};color:#ffffff;padding:12px 28px;
           border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;
           letter-spacing:0.01em;">
    Provide Feedback →
  </a>
</td></tr>
</table>

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

<p style="margin:0 0 24px;font-size:13px;color:#666;">
  This link is unique. Please do not share it. It will expire on <strong>${expiresAtHuman}</strong>.
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
