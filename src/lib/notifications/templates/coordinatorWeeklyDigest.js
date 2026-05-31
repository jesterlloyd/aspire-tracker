// src/lib/notifications/templates/coordinatorWeeklyDigest.js
// Weekly digest email sent to school placement coordinators every Friday.
// Summarises the past 7 days of student activity for their school.

import { JESTER_SIGNATURE } from './signatures.js';

const CS_RED = '#930045';
const SAND   = '#F4F1EC';
const RAVEN  = '#191919';

// ── Category metadata ─────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'form_received',      label: 'Forms Received',        accent: '#1D2567' },
  { key: 'interview_booked',   label: 'Interviews Scheduled',  accent: '#0d7a8a' },
  { key: 'interview',          label: 'Interviews Completed',  accent: '#166534' },
  { key: 'placement',          label: 'Unit Placements',       accent: '#92400e' },
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
<tr><td style="background:${CS_RED};padding:20px 28px;">
  <div style="color:#ffffff;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">ASPIRE Program</div>
  <div style="color:#ffffff;font-size:11px;opacity:0.85;margin-top:2px;">Cedars-Sinai Medical Center · Program Update</div>
</td></tr>
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#666;line-height:1.5;border-top:1px solid #eee;padding-top:16px;">
  This is an ASPIRE Program communication. Replies go directly to Jester.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── Section renderer ──────────────────────────────────────────────────────────

function renderSection(category, items) {
  if (!items || items.length === 0) return '';
  const rows = items.map(item => `
    <tr>
      <td style="padding:6px 0;font-size:14px;color:${RAVEN};border-bottom:1px solid #f3f4f6;">
        <span style="color:${category.accent};font-weight:600;margin-right:6px;">›</span>
        ${item.line}
      </td>
    </tr>`).join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
  style="margin:0 0 20px;border-radius:8px;overflow:hidden;">
<tr><td style="background:${category.accent};padding:8px 14px;border-radius:6px 6px 0 0;">
  <span style="color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">
    ${category.label}
  </span>
  <span style="color:rgba(255,255,255,0.65);font-size:11px;margin-left:8px;">${items.length}</span>
</td></tr>
<tr><td style="background:#fafafa;padding:2px 14px 2px;">
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

  const subject  = `ASPIRE Program Update: Student Interview and Placement Status — ${schoolDisplayName}`;
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
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.email} &middot; 424-386-5004</span>
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
