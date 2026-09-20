// lib/server/evaluation/caseyFinkPreRotationEmailTemplates.js
//
// REVIEW-RELEASE-1: the invitation email for the PRE-rotation Casey-Fink Readiness for
// Practice Survey (slug: casey_fink_readiness_2024, timepoint: baseline). Recipient is the
// STUDENT. This is the same instrument the student answers again after the rotation, and
// the pair is what makes the comparison: the point of this send is a baseline.
//
// It gates nothing. There is no certificate sentence in here and there must never be
// one: the Certificate of Completion is unlocked by the POST-rotation survey, and the
// database refuses to issue for any other timepoint (issue_participation_certificate
// checks timepoint = 'post_rotation'). A student reading this email should come away
// knowing they will see the same questions again later, not that anything is owed.
//
// Uses the shared ASPIRE system email shell + primitives, so header/footer/signature stay
// consistent. studentFirstName is HTML-escaped. The button URL is a tokenized server-
// generated link; trustedUrl:true preserves it verbatim.

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell } from '../email/aspireShell.js';
import { renderEmailButton, renderEmailNote } from '../email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js';
import { formatExpiresAt } from './caseyFinkPostRotationEmailTemplates.js';
import { surveyLabel } from '../../../src/lib/evaluation/surveyNames.js';

const NAVY = '#1D2567';

export { formatExpiresAt };

// Build the pre-rotation Casey-Fink invitation email.
//
// Arguments:
//   studentFirstName - greeting name for the student (preferred or legal first name)
//   surveyUrl        - the readiness survey URL including the token hash fragment
//   expiresAtHuman   - optional formatted expiry date string; when present, a link note is shown
//
// Returns: { subject, html }
export function buildCaseyFinkPreRotationInvitationEmail({ studentFirstName, surveyUrl, expiresAtHuman } = {}) {
  const greeting  = studentFirstName ? `Hi ${escapeHtml(studentFirstName)},` : 'Hello,';
  const subject   = 'Before Your Rotation: Complete Your ASPIRE Readiness Survey';
  const preheader = 'A short survey about your confidence and readiness for practice, taken before your rotation begins.';

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

<p style="margin:0 0 16px;">Welcome to ASPIRE. Before your rotation begins, please complete the
${surveyLabel('casey_fink_readiness_2024', 'baseline')} survey using the button below.</p>

<p style="margin:0 0 16px;">This survey asks about your confidence, competence, and readiness for practice as they are
today. You will be asked the same questions again after your rotation, and the two answers together show how the
experience shaped you. There are no right or wrong answers, and it takes about ten minutes.</p>

<!-- CTA button: TOKENIZED server-generated link; trustedUrl:true preserves it verbatim. -->
${renderEmailButton({ label: 'Complete Readiness Survey', url: surveyUrl, variant: 'navy', trustedUrl: true })}

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

${linkNote}

<p style="margin:0 0 16px;">Thank you for taking the time to do this before you start. We are glad you are here.</p>

${aspireHandwrittenSignature('Kind regards,')}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
