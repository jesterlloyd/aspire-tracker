// src/lib/notifications/templates/coordinatorWeeklyDigest.js
// Weekly digest email sent to school placement coordinators every Friday.
// Summarises the past 7 days of student activity for their school.

import { JESTER_SIGNATURE } from './signatures.js';

const NAVY  = '#1D2567';   // Nightfall — ASPIRE Intelligence primary brand color
const SAND  = '#F4F1EC';   // Sand — ASPIRE app background
const RAVEN = '#191919';   // Near-black body text

// ── Category metadata ─────────────────────────────────────────────────────────
// accent colors are no longer used in section backgrounds.
// All sections use a unified navy left-border treatment for a restrained,
// coordinated appearance.

const CATEGORIES = [
  { key: 'form_received',    label: 'Forms Received'       },
  { key: 'interview_booked', label: 'Interviews Scheduled' },
  { key: 'interview',        label: 'Interviews Completed' },
  { key: 'placement',        label: 'Unit Placements'      },
];

// ── HTML wrapper ─────────────────────────────────────────────────────────────

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

<!-- Nightfall header with reversed CS logo -->
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

<!-- Body -->
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>

<!-- Footer -->
<tr><td style="padding:16px 28px 28px;font-size:12px;color:#9ca3af;line-height:1.5;border-top:1px solid #f0ede8;">
  This is an ASPIRE Program communication. Replies go directly to Jester.
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── Section renderer ──────────────────────────────────────────────────────────
// Professional, restrained treatment: light neutral header with a navy left
// border, white content area. Consistent across all four section types.

function renderSection(category, items) {
  if (!items || items.length === 0) return '';
  const rows = items.map(item => `
    <tr>
      <td style="padding:7px 0;font-size:14px;color:${RAVEN};border-bottom:1px solid #f3f4f6;">
        <span style="color:${NAVY};font-weight:700;margin-right:7px;">›</span>${item.line}
      </td>
    </tr>`).join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
  style="margin:0 0 18px;border:1px solid #e8e4dc;border-radius:8px;overflow:hidden;">
<tr><td style="background:#f4f5f9;border-left:3px solid ${NAVY};padding:9px 14px;">
  <span style="color:${NAVY};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${category.label}</span>
  <span style="color:#9ca3af;font-size:11px;margin-left:7px;">${items.length}</span>
</td></tr>
<tr><td style="background:#ffffff;padding:2px 14px 8px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
</td></tr>
</table>`;
}

// ── Main render function ──────────────────────────────────────────────────────

export function buildCoordinatorWeeklyDigestEmail({
  coordinatorFirstName,
  schoolDisplayName,
  windowStart,
  windowEnd,
  transitions,
}) {
  const dateRange = formatDateRange(windowStart, windowEnd);

  const totalCount = CATEGORIES.reduce((sum, cat) =>
    sum + (transitions[cat.key]?.length || 0), 0);

  const subject   = `ASPIRE Program Update: Student Interview and Placement Status — ${schoolDisplayName}`;
  const preheader = `${totalCount} ASPIRE Program update${totalCount === 1 ? '' : 's'} for ${schoolDisplayName}.`;

  const sections = CATEGORIES
    .map(cat => renderSection(cat, transitions[cat.key]))
    .join('');

  const body = `
<p style="margin:0 0 20px;">Good morning. I hope you are doing well. I am sharing an ASPIRE Program update regarding your students&rsquo; recent interview and placement activity.</p>

${sections}

<p style="margin:0 0 16px;">
  That&rsquo;s ${totalCount} update${totalCount === 1 ? '' : 's'} from ${schoolDisplayName}.
  If you have questions about any of these students or want to follow up on anything, just reply to this email.
</p>

<p style="margin:0 0 20px;">Thanks for the partnership.</p>

<p style="margin:0;">
  ${JESTER_SIGNATURE.fullName}<br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span><br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.email} | Office: 310-248-8964</span>
</p>`;

  return { subject, html: wrap(body, preheader) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatDateRange(start, end) {
  const fmt = d => new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  });
  return `${fmt(start)}–${fmt(end)}`;
}
