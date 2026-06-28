// lib/server/evaluation/emailTemplates.js
//
// Server-side email template builders for ASPIRE evaluation (Casey-Fink) survey invitations.
// Used by api/evaluation-send-test-email.js (test send) and
// api/evaluation-send-bulk-invitations.js (production student send).
// Also imported by src/components/connect/OutreachView.jsx for the Send-to-One live preview.
//
// EMAIL-BRAND-REFRESH Phase 3B: migrated onto the shared ASPIRE system email shell
// (lib/server/email/aspireShell.js). The shell owns the Nightfall header, ASPIRE wordmark,
// white card on Sand, Nightfall footer, white Cedars-Sinai mark, identity lines, and the
// no-reply line. The typed system signature comes from aspireSystemSignature (no handwritten
// image). Token/URL/expiration/override behavior is unchanged.

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell, aspireSystemSignature } from '../email/aspireShell.js';

// Body-content accent colors (the shared shell owns header/footer chrome).
const NAVY = '#1D2567';
const SAND = '#F4F1EC';

// ── Timepoint human-readable labels ──────────────────────────────────────────

export const TIMEPOINT_LABELS = {
  baseline:               'Baseline',
  early_rotation_baseline: 'Baseline',
  midpoint:               'Midpoint',
  post_rotation:          'Post-Rotation',
  custom:                 'Custom',
};

// ── Utility: format an ISO date as "Month Day, Year" ─────────────────────────

export function formatExpiresAt(isoDatetime) {
  if (!isoDatetime) return '';
  // Date-only strings (YYYY-MM-DD) must be parsed as LOCAL midnight, not UTC midnight.
  // new Date("2026-07-01") is parsed as UTC midnight = June 30 PDT — off by one day.
  // We parse the parts manually to construct a local Date instead.
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDatetime)) {
    const [y, m, dy] = isoDatetime.split('-').map(Number);
    return new Date(y, m - 1, dy).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  }
  // Full ISO datetime strings — use LA timezone for display
  const d = new Date(isoDatetime);
  if (isNaN(d.getTime())) return isoDatetime;
  return d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

// ── Editable-draft overrides (Send-to-One Survey Invitation) ──────────────────
// Optional plain-text overrides for the SUBJECT line and the intro BODY paragraph(s) only. All
// other content (greeting, survey-details block, CTA/link, expiry, signature, shell) stays
// system-controlled. User text is ALWAYS escaped before HTML rendering; no custom HTML is allowed.
const SUBJECT_MAX = 200;
const BODY_MAX    = 4000;
const DEFAULT_INTRO = 'As part of ASPIRE at Cedars-Sinai, please complete the Casey-Fink Readiness for Practice Survey. This short survey helps us understand your readiness as you prepare for your clinical rotation.';

// Subject is a plain-text email header: strip CR/LF (header-injection safe), trim, cap length.
function sanitizeSubjectOverride(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, SUBJECT_MAX);
}

// Body override → escaped HTML paragraphs. Blank lines split paragraphs; single newlines become <br>.
function renderBodyOverride(value) {
  const text = (typeof value === 'string' ? value : '').trim().slice(0, BODY_MAX);
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// Endpoint-level validation for the optional draft override fields. Absent fields are valid
// (the builder falls back to the fixed template). Returns { ok: true } or { ok: false, error }.
export function validateDraftOverrides({ subject_override, body_override } = {}) {
  if (subject_override !== undefined && subject_override !== null) {
    if (typeof subject_override !== 'string') return { ok: false, error: 'subject_override must be a string' };
    if (subject_override.length > SUBJECT_MAX) return { ok: false, error: `subject_override exceeds ${SUBJECT_MAX} characters` };
  }
  if (body_override !== undefined && body_override !== null) {
    if (typeof body_override !== 'string') return { ok: false, error: 'body_override must be a string' };
    if (body_override.length > BODY_MAX) return { ok: false, error: `body_override exceeds ${BODY_MAX} characters` };
  }
  return { ok: true };
}

// ── Shared survey-details + CTA + link + expiry body fragment ─────────────────
// Both the test and production builders render the same core block. `expiryLine` differs slightly
// in wording between the two variants, so it is passed in. `surveyUrl` passes through VERBATIM into
// both the CTA href and the copy-paste row (it is token-bearing; never transformed here).
function surveyBodyCore({ timepointLabel, expiresAtHuman, surveyUrl, ctaLabel, expiryLine }) {
  return `
<!-- Survey details block -->
<table role="presentation" cellpadding="0" cellspacing="0"
  style="width:100%;background:${SAND};border-radius:8px;margin:0 0 24px;">
<tr><td style="padding:18px 20px;">
  <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-weight:600;">Survey Details</div>
  <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Instrument</strong></td>
      <td style="padding:4px 0;font-size:14px;">Casey-Fink Readiness for Practice Survey</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Timepoint</strong></td>
      <td style="padding:4px 0;font-size:14px;">${timepointLabel}</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Expires</strong></td>
      <td style="padding:4px 0;font-size:14px;">${expiresAtHuman}</td>
    </tr>
  </table>
</td></tr>
</table>

<p style="margin:0 0 16px;">Please complete the survey using the secure link below:</p>

<!-- CTA button -->
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td>
  <a href="${surveyUrl}"
    style="display:inline-block;background:${NAVY};color:#ffffff;padding:12px 28px;
           border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;
           letter-spacing:0.01em;">
    ${ctaLabel}
  </a>
</td></tr>
</table>

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

<p style="margin:0 0 24px;font-size:13px;color:#666;">
  ${expiryLine}
</p>`;
}

// ── TEST variant: survey invitation email ─────────────────────────────────────
// Sent to the authenticated Owner/admin as a verification test before
// any student-facing sends are enabled. Includes a prominent [TEST] banner.
//
// Arguments:
//   studentFirstName  — first name used in the greeting (from student record)
//   timepointLabel    — human-readable timepoint string (use TIMEPOINT_LABELS)
//   expiresAtHuman    — formatted date string (use formatExpiresAt)
//   surveyUrl         — the raw survey URL including the token hash fragment
//   subjectOverride   — optional plain-text subject override (Send-to-One)
//   bodyOverride      — optional plain-text intro override (Send-to-One)
//
// Returns: { subject: string, html: string }

export function buildStudentInvitationTestEmail({
  studentFirstName,
  timepointLabel,
  expiresAtHuman,
  surveyUrl,
  subjectOverride,
  bodyOverride,
}) {
  const baseSubject = sanitizeSubjectOverride(subjectOverride)
    || `ASPIRE: Casey-Fink Readiness Survey, ${timepointLabel} for ${studentFirstName}`;
  const subject   = `[TEST] ${baseSubject}`;
  const preheader = `Test email. Verify the survey invitation template before enabling student sends.`;
  const introHtml = renderBodyOverride(bodyOverride)
    || `<p style="margin:0 0 16px;">${escapeHtml(DEFAULT_INTRO)}</p>`;

  const body = `
<!-- TEST banner -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="background:#FBF5E8;border:1px solid #f0c9b0;border-radius:8px;padding:12px 16px;">
  <div style="font-size:13px;font-weight:600;color:#8B5E1A;">
    &#9888; TEST EMAIL: This was sent to you as the Owner for verification.
  </div>
  <div style="font-size:12px;color:#92600A;margin-top:4px;line-height:1.5;">
    Real student sends are not yet enabled. This email uses a real generated assignment and survey link.
    Copy or click the URL below to verify the student-facing experience.
  </div>
</td></tr>
</table>

<p style="margin:0 0 16px;">Hi ${escapeHtml(studentFirstName)},</p>

${introHtml}
${surveyBodyCore({
    timepointLabel,
    expiresAtHuman,
    surveyUrl,
    ctaLabel: 'Complete Test Survey',
    expiryLine: `This link is unique. It will expire on <strong>${expiresAtHuman}</strong>.`,
  })}
${aspireSystemSignature()}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}

// ── PRODUCTION variant: real student survey invitation ────────────────────────
// Sent to the student directly. No [TEST] prefix or test banner.
// Subject and body are clean production-ready content.
//
// Arguments: same as buildStudentInvitationTestEmail
// Returns: { subject: string, html: string }

export function buildStudentInvitationEmail({
  studentFirstName,
  timepointLabel,
  expiresAtHuman,
  surveyUrl,
  subjectOverride,
  bodyOverride,
}) {
  const subject   = sanitizeSubjectOverride(subjectOverride)
    || `ASPIRE: Casey-Fink Readiness Survey, ${timepointLabel}`;
  const preheader = `Complete your Casey-Fink Readiness for Practice Survey as part of ASPIRE.`;
  const introHtml = renderBodyOverride(bodyOverride)
    || `<p style="margin:0 0 16px;">${escapeHtml(DEFAULT_INTRO)}</p>`;

  const body = `
<p style="margin:0 0 16px;">Hi ${escapeHtml(studentFirstName)},</p>

${introHtml}
${surveyBodyCore({
    timepointLabel,
    expiresAtHuman,
    surveyUrl,
    ctaLabel: 'Complete Survey',
    expiryLine: `This link is unique to you. Please do not share it. It will expire on <strong>${expiresAtHuman}</strong>.`,
  })}
${aspireSystemSignature()}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}
