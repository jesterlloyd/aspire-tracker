// lib/server/evaluation/studentEvalEmailTemplates.js
//
// Server-side email template builder for the ASPIRE Student Evaluation of Preceptor/Unit
// Experience survey (SR-2b-2). Separate from the Casey-Fink (emailTemplates.js) and
// preceptor (preceptorEmailTemplates.js) builders, neither of which is touched.
//
// This is a learning-environment / experience survey sent to the STUDENT. It contains no
// hiring, endorsement, or evaluative-of-student language.
//
// EMAIL-BRAND-REFRESH Phase 3D: migrated onto the shared ASPIRE system email shell
// (lib/server/email/aspireShell.js). The shell owns the Nightfall header, ASPIRE wordmark,
// white card on Sand, Nightfall footer, white Cedars-Sinai mark, identity lines, and the
// no-reply line. Typed system signature from aspireSystemSignature (no handwritten image).
// Token/URL/expiration behavior unchanged. studentFirstName stays HTML-escaped.

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell, aspireSystemSignature } from '../email/aspireShell.js';

// Body-content accent color (the shared shell owns header/footer chrome).
const NAVY = '#1D2567';

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

// Build the student survey invitation email.
//
// Arguments:
//   studentFirstName — greeting name for the student
//   expiresAtHuman   — formatted date string (use formatExpiresAt)
//   surveyUrl        — the survey URL including the token hash fragment
//
// Returns: { subject, html }
export function buildStudentEvalInvitationEmail({ studentFirstName, expiresAtHuman, surveyUrl }) {
  const greeting  = studentFirstName ? `Hi ${escapeHtml(studentFirstName)},` : 'Hello,';
  const subject   = 'ASPIRE: Share Feedback on Your Preceptor & Unit';
  const preheader = 'Your feedback helps improve the ASPIRE learning environment for future students.';

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>

<p style="margin:0 0 16px;">Congratulations on completing your ASPIRE clinical rotation. We&rsquo;d value your feedback on your
learning experience and the support you received. Your responses help us strengthen the ASPIRE learning
environment for future students.</p>

<p style="margin:0 0 10px;">A few notes:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;line-height:1.7;">
  <li>This is the Student Feedback: Preceptor &amp; Unit survey, a short survey about your rotation experience.</li>
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
    Share Your Feedback
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
${aspireSystemSignature()}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
