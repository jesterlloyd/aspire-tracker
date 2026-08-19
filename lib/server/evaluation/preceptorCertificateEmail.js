// lib/server/evaluation/preceptorCertificateEmail.js
//
// PRECEPTOR-CERT-1 - the certificate-ready recognition email, built on the same
// ASPIRE email shell and primitives as every other evaluation email. PURE
// PRESENTATIONAL: builds { subject, html }. No sends, no DB, no logging.
//
// The CTA links to the preceptor's own tokenized assessment page - the page they
// already used - which now offers Download Certificate once the assessment is
// complete. The link is unique and time-bounded exactly like the survey link
// (it IS a survey-token link); no permanent public certificate URL exists.

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell } from '../email/aspireShell.js';
import { renderEmailButton, renderEmailNote } from '../email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js';

export const PRECEPTOR_CERT_EMAIL_SUBJECT = 'Your ASPIRE Certificate of Appreciation';

/**
 * @param {object} o
 * @param {string} o.preceptorFirstName - first token of the verified name ('' ok)
 * @param {string} o.certificateNumber  - e.g. ASPIRE-2026-055
 * @param {string} o.downloadUrl        - tokenized page URL (trusted, server-built)
 */
export function buildPreceptorCertificateEmail({ preceptorFirstName, certificateNumber, downloadUrl }) {
  const greeting = preceptorFirstName ? `Hi ${escapeHtml(preceptorFirstName)},` : 'Hello,';
  const preheader = 'Your Certificate of Appreciation is ready to download.';

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>

<p style="margin:0 0 16px;">Thank you for your contribution as an ASPIRE preceptor. We received your
Preceptor Student Readiness Assessment, and your Certificate of Appreciation is now available in
recognition of the clinical expertise, guidance, and encouragement you shared with our nursing
students.</p>

<p style="margin:0 0 20px;font-size:13px;color:#666;">Certificate ID: <strong style="color:#374151;">${escapeHtml(certificateNumber || '')}</strong></p>

${renderEmailButton({ label: 'Download Certificate', url: downloadUrl, variant: 'navy', trustedUrl: true })}

${renderEmailNote({
  title: 'Having trouble downloading at Cedars-Sinai?',
  body: 'Copy the secure link below and open it in Safari or Chrome outside the Cedars-Sinai Island browser. This link is unique to you. Please do not share it.',
  tone: 'info',
})}

<p style="margin:0 0 20px;font-size:12px;line-height:1.55;color:#4b5563;word-break:break-all;">
  <strong style="color:#374151;">Secure certificate link:</strong><br>
  ${escapeHtml(downloadUrl || '')}
</p>
${aspireHandwrittenSignature('With gratitude,')}
`;

  return { subject: PRECEPTOR_CERT_EMAIL_SUBJECT, html: aspireEmailShell({ body, preheader }) };
}
