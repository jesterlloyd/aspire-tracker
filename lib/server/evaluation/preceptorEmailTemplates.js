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
// EMAIL-BRAND-REFRESH Phase 3C: migrated onto the shared ASPIRE system email shell
// (lib/server/email/aspireShell.js). The shell owns the Nightfall header, ASPIRE wordmark,
// white card on Sand, Nightfall footer, white Cedars-Sinai mark, identity lines, and the
// no-reply line. Typed system signature from aspireSystemSignature (no handwritten image).
// Token/URL/expiration behavior unchanged.

import { aspireEmailShell, aspireSystemSignature } from '../email/aspireShell.js';
import { renderEmailButton, renderEmailDetailsCard, renderEmailNote } from '../email/emailPrimitives.js';

// Body-content accent color (the shared shell owns header/footer chrome). NAVY is used for the
// copy-paste fallback link; the feedback-request card / CTA button / note come from the primitives.
const NAVY = '#1D2567';

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

<!-- Feedback request details — EMAIL-EVAL-MODERNIZE-3B: shared details-card primitive (escape-safe). -->
${renderEmailDetailsCard({ title: 'Feedback Request', rows: [
  { label: 'Assessment',        value: 'Preceptor Student Readiness Assessment' },
  { label: 'Student',           value: studentName },
  { label: 'Feedback Period',   value: PERIOD_LABELS[safePeriod] },
  { label: 'Please complete by', value: expiresAtHuman },
] })}

<p style="margin:0 0 10px;">A few notes as you complete this feedback:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;line-height:1.7;">
  <li>Specific examples are especially helpful.</li>
  <li>Any endorsement you provide is <strong>for consideration only</strong> and is not a hiring decision.</li>
  <li>The confidential section is reviewed by the ASPIRE team and unit leadership.</li>
  <li>This survey does not replace real-time coaching during the shift.</li>
</ul>

<!-- CTA button — EMAIL-EVAL-MODERNIZE-3B: shared button primitive. The survey URL is a TOKENIZED
     server-generated link; trustedUrl:true preserves it verbatim (escape-only, never validated). -->
${renderEmailButton({ label: 'Provide Feedback', url: surveyUrl, variant: 'navy', trustedUrl: true })}

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

${renderEmailNote({
  body: `This link is unique. Please do not share it. It will expire on ${expiresAtHuman}.`,
  tone: 'info',
})}
${aspireSystemSignature()}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
