// lib/server/evaluation/emailTemplates.js
//
// Server-side email template builders for ASPIRE Program evaluation invitations.
// Used by api/evaluation-send-test-email.js (Phase 3B.1 test send).
// Future: Phase 3B.2 production student send will add buildStudentInvitationEmail().
//
// Credential source of truth: src/lib/notifications/templates/signatures.js.
// HTML structure follows the pattern established in src/lib/notifications/templates/.

import { JESTER_SIGNATURE } from '../../../src/lib/notifications/templates/signatures.js';

const NAVY = '#1D2567';
const SAND = '#F4F1EC';
const RAVEN = '#191919';

const JESTER_PHONE = '310-248-8964';

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

// ── HTML wrapper shared with all templates ────────────────────────────────────

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
<!-- Nightfall header with Cedars-Sinai logo — matches coordinator digest pattern -->
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

// ── TEST variant: survey invitation email ─────────────────────────────────────
// Sent to the authenticated Owner/admin as a verification test before
// any student-facing sends are enabled. Includes a prominent [TEST] banner.
//
// Arguments:
//   studentFirstName  — first name used in the greeting (from student record)
//   timepointLabel    — human-readable timepoint string (use TIMEPOINT_LABELS)
//   expiresAtHuman    — formatted date string (use formatExpiresAt)
//   surveyUrl         — the raw survey URL including the token hash fragment
//
// Returns: { subject: string, html: string }

export function buildStudentInvitationTestEmail({
  studentFirstName,
  timepointLabel,
  expiresAtHuman,
  surveyUrl,
}) {
  const subject   = `[TEST] ASPIRE: Casey-Fink Readiness Survey — ${timepointLabel} for ${studentFirstName}`;
  const preheader = `Test email — verify the survey invitation template before enabling student sends.`;

  const body = `
<!-- TEST banner -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="background:#FBF5E8;border:1px solid #f0c9b0;border-radius:8px;padding:12px 16px;">
  <div style="font-size:13px;font-weight:600;color:#8B5E1A;">
    ⚠ TEST EMAIL — This was sent to you as the Owner for verification.
  </div>
  <div style="font-size:12px;color:#92600A;margin-top:4px;line-height:1.5;">
    Real student sends are not yet enabled. This email uses a real generated assignment and survey link.
    Copy or click the URL below to verify the student-facing experience.
  </div>
</td></tr>
</table>

<p style="margin:0 0 16px;">Hi ${studentFirstName},</p>

<p style="margin:0 0 16px;">As part of the ASPIRE Program at Cedars-Sinai, please complete the Casey-Fink Readiness for Practice Survey.
This short survey helps us understand your readiness as you prepare for your clinical rotation.</p>

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
    Complete Survey →
  </a>
</td></tr>
</table>

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

<p style="margin:0 0 24px;font-size:13px;color:#666;">
  This link is unique. It will expire on <strong>${expiresAtHuman}</strong>.
</p>

<p style="margin:0 0 6px;font-size:14px;">Warm regards,</p>
<p style="margin:0;font-size:14px;">
  <strong>${JESTER_SIGNATURE.fullName}</strong><br>
  ${JESTER_SIGNATURE.affiliation}<br>
  <a href="mailto:${JESTER_SIGNATURE.email}" style="color:${NAVY};">${JESTER_SIGNATURE.email}</a>
  &nbsp;|&nbsp;Office: ${JESTER_PHONE}
</p>
`;

  return { subject, html: wrap(body, preheader) };
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
}) {
  const subject   = `ASPIRE: Casey-Fink Readiness Survey — ${timepointLabel}`;
  const preheader = `Complete your Casey-Fink Readiness for Practice Survey as part of the ASPIRE Program.`;

  const body = `
<p style="margin:0 0 16px;">Hi ${studentFirstName},</p>

<p style="margin:0 0 16px;">As part of the ASPIRE Program at Cedars-Sinai, please complete the Casey-Fink Readiness for Practice Survey.
This short survey helps us understand your readiness as you prepare for your clinical rotation.</p>

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
    Complete Survey →
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

<p style="margin:0 0 6px;font-size:14px;">Warm regards,</p>
<p style="margin:0;font-size:14px;">
  <strong>${JESTER_SIGNATURE.fullName}</strong><br>
  ${JESTER_SIGNATURE.affiliation}<br>
  <a href="mailto:${JESTER_SIGNATURE.email}" style="color:${NAVY};">${JESTER_SIGNATURE.email}</a>
  &nbsp;|&nbsp;Office: ${JESTER_PHONE}
</p>
`;

  return { subject, html: wrap(body, preheader) };
}
