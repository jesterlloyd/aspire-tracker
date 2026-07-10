// lib/server/evaluation/postRotationEmailTemplates.js
//
// Server-side email template builder for the ASPIRE Post-Rotation Evaluation workflow (slug:
// post_rotation_evaluation). Recipient is the STUDENT. This is NON-GATING experience feedback: it
// does NOT unlock the Certificate of Participation (the Casey-Fink Readiness for Practice survey,
// post-rotation, is the certificate gate and is sent separately). This email must never imply that
// completing it unlocks or provides a certificate, and it never attaches a certificate or PDF.
//
// Separate from the Casey-Fink (caseyFinkPostRotationEmailTemplates.js / emailTemplates.js),
// preceptor (preceptorEmailTemplates.js), and student experience (studentEvalEmailTemplates.js)
// builders, none of which are touched.
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
  const subject   = 'Share Your ASPIRE Rotation Feedback';
  const preheader = 'Share feedback about your ASPIRE rotation experience, unit, and preceptor support.';

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

<p style="margin:0 0 16px;">Thank you for completing your ASPIRE rotation at Cedars-Sinai.</p>

<p style="margin:0 0 16px;">We would appreciate your feedback about your rotation experience, unit learning environment,
and preceptor support. Your responses help us improve ASPIRE for future students and academic partners.</p>

<p style="margin:0 0 16px;">Please use the button below to complete the ASPIRE Post-Rotation Evaluation.</p>

<!-- CTA button: TOKENIZED server-generated link; trustedUrl:true preserves it verbatim. -->
${renderEmailButton({ label: 'Share Feedback', url: surveyUrl, variant: 'navy', trustedUrl: true })}

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

${linkNote}

<p style="margin:0 0 16px;">Your Certificate of Participation is unlocked through the Casey-Fink Readiness for Practice Survey,
Post-Rotation, which is sent separately.</p>

<p style="margin:0 0 16px;">Thank you again for being part of ASPIRE.</p>

${aspireHandwrittenSignature('Kind regards,')}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
