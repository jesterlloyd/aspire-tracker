// lib/server/evaluation/postRotationEmailTemplates.js
//
// Server-side email template builder for the ASPIRE Post-Rotation Evaluation & Certificate
// workflow (slug: post_rotation_evaluation). Recipient is the STUDENT. Separate from the
// Casey-Fink (emailTemplates.js), preceptor (preceptorEmailTemplates.js), and student
// experience (studentEvalEmailTemplates.js) builders, none of which are touched.
//
// This first email is the post-rotation evaluation invitation. It congratulates the student
// on completing ASPIRE and asks them to complete the post-rotation evaluation. It deliberately
// does NOT include or attach the Certificate of Participation: the certificate becomes
// available for download only AFTER the student submits the evaluation.
//
// Uses the shared ASPIRE system email shell + primitives (same as the sibling builders), so
// header/footer/signature stay consistent and there is a single source of truth. studentFirstName
// stays HTML-escaped. The button URL is a tokenized server-generated link; trustedUrl:true
// preserves it verbatim (escape-only, never validated).

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell } from '../email/aspireShell.js';
import { renderEmailButton, renderEmailNote } from '../email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js';

const NAVY = '#1D2567';

// Build the post-rotation evaluation invitation email.
//
// Arguments:
//   studentFirstName - greeting name for the student (preferred or legal first name)
//   surveyUrl        - the evaluation URL including the token hash fragment
//   expiresAtHuman   - optional formatted expiry date string; when present, a link note is shown
//
// Returns: { subject, html }
export function buildPostRotationInvitationEmail({ studentFirstName, surveyUrl, expiresAtHuman } = {}) {
  const greeting  = studentFirstName ? `Hi ${escapeHtml(studentFirstName)},` : 'Hello,';
  const subject   = 'Congratulations on Completing ASPIRE';
  const preheader = 'One final step: complete your post-rotation evaluation to unlock your Certificate of Participation.';

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

<p style="margin:0 0 16px;">Congratulations on completing ASPIRE at Cedars-Sinai. This is an important milestone,
and we are proud of the professionalism, growth, and commitment you demonstrated throughout the experience.</p>

<p style="margin:0 0 16px;">As a final step, please complete your post-rotation evaluation using the button below.</p>

<!-- CTA button: TOKENIZED server-generated link; trustedUrl:true preserves it verbatim. -->
${renderEmailButton({ label: 'Complete Evaluation', url: surveyUrl, variant: 'navy', trustedUrl: true })}

<p style="margin:0 0 16px;">Once your evaluation is submitted, your Certificate of Participation will be available for download.</p>

<p style="margin:0 0 16px;">Your feedback helps us continue improving ASPIRE for future students and academic partners.</p>

<p style="margin:0 0 16px;">Congratulations again, and thank you for being part of ASPIRE.</p>

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

${linkNote}
${aspireHandwrittenSignature('Kind regards,')}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
