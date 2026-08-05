// lib/server/evaluation/caseyFinkPostRotationEmailTemplates.js
//
// Server-side email template builder for the post-rotation Casey-Fink Readiness for Practice
// Survey (slug: casey_fink_readiness_2024, timepoint: post_rotation). Recipient is the STUDENT.
// This is the certificate-gating survey: completing it unlocks the ASPIRE Certificate of
// Participation. Separate from the ASPIRE Post-Rotation Evaluation, preceptor, and student
// experience builders, none of which are touched. Casey-Fink question content is NOT included
// or modified here; this builder only produces the invitation email.
//
// Uses the shared ASPIRE system email shell + primitives, so header/footer/signature stay
// consistent. studentFirstName is HTML-escaped. The button URL is a tokenized server-generated
// link; trustedUrl:true preserves it verbatim. No certificate is attached or included.

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell } from '../email/aspireShell.js';
import { renderEmailButton, renderEmailNote } from '../email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js';

const NAVY = '#1D2567';

// Format an ISO date/datetime as "Month Day, Year" (LA timezone for full datetimes). Mirrors the
// sibling template helpers so each evaluation email module stays self-contained.
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

// Build the post-rotation Casey-Fink invitation email.
//
// Arguments:
//   studentFirstName - greeting name for the student (preferred or legal first name)
//   surveyUrl        - the readiness survey URL including the token hash fragment
//   expiresAtHuman   - optional formatted expiry date string; when present, a link note is shown
//
// Returns: { subject, html }
export function buildCaseyFinkPostRotationInvitationEmail({ studentFirstName, surveyUrl, expiresAtHuman } = {}) {
  const greeting  = studentFirstName ? `Hi ${escapeHtml(studentFirstName)},` : 'Hello,';
  const subject   = 'Complete Your ASPIRE Readiness Survey';
  const preheader = 'One final step: complete the Readiness for Practice survey to unlock your Certificate of Completion.';

  const linkNote = expiresAtHuman
    ? renderEmailNote({
        body: `This link is unique to you. Please do not share it. It will expire on ${expiresAtHuman}.`,
        tone: 'info',
      })
    : renderEmailNote({
        body: 'This link is unique to you. Please do not share it.',
        tone: 'info',
      });

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>

<p style="margin:0 0 16px;">Congratulations on completing your ASPIRE rotation.</p>

<p style="margin:0 0 16px;">As a final step, please complete the Casey-Fink Readiness for Practice Survey using the
button below. This post-rotation survey helps us understand your growth in confidence, competence, and
readiness for transition to practice.</p>

<p style="margin:0 0 16px;">Completing this Readiness for Practice survey unlocks your ASPIRE Certificate of Completion.</p>

<!-- CTA button: TOKENIZED server-generated link; trustedUrl:true preserves it verbatim. -->
${renderEmailButton({ label: 'Complete Readiness Survey', url: surveyUrl, variant: 'navy', trustedUrl: true })}

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

${linkNote}

<p style="margin:0 0 16px;">Thank you for taking the time to complete this final readiness survey and for being part of ASPIRE.</p>

${aspireHandwrittenSignature('Kind regards,')}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
