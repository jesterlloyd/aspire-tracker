// src/lib/notifications/templates/coordinatorWeeklyDigest.js
// Weekly digest email sent to school placement coordinators every Friday.
// Summarises the past 7 days of student activity for their school.
// EMAIL-BRAND-REFRESH Phase 2B-6: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) - Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. Typed system signature only (no handwritten image).

import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';

const NAVY  = '#1d2567';   // Nightfall - ASPIRE primary brand color
const RAVEN = '#191919';   // Near-black body text

// Minimal HTML escape for dynamic values (coordinator first name, school name) interpolated into the
// HTML body, so a stray angle bracket in a record never breaks the markup. Subject/preheader are plain
// text and are not escaped. No behavior change: values, counts, and detection logic are untouched.
const escHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Category metadata ─────────────────────────────────────────────────────────
// All sections use a unified navy left-border treatment for a restrained,
// coordinated appearance.

const CATEGORIES = [
  { key: 'form_received',    label: 'Forms Received'       },
  { key: 'interview_booked', label: 'Interviews Scheduled' },
  { key: 'interview',        label: 'Interviews Completed' },
  { key: 'placement',        label: 'Unit Placements'      },
  { key: 'rotation',         label: 'Began Active Rotation' },
];

// Defensive display sanitizer: line items are built upstream (cron); strip any em/en dash used as
// punctuation to a comma so the rendered digest stays dash-free regardless of the upstream format.
function cleanLine(line) {
  return String(line == null ? '' : line).replace(/\s*[-–]\s*/g, ', ');
}

// ── Section renderer ──────────────────────────────────────────────────────────
// Restrained treatment: light neutral header with a navy left border, white content area.
// Consistent across all section types. Grouping/labels/counts preserved.

function renderSection(category, items) {
  if (!items || items.length === 0) return '';
  const rows = items.map(item => `
    <tr>
      <td style="padding:7px 0;font-size:14px;color:${RAVEN};border-bottom:1px solid #f3f4f6;">
        <span style="color:${NAVY};font-weight:700;margin-right:7px;">&rsaquo;</span>${cleanLine(item.line)}
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

  const subject   = `ASPIRE Weekly Update: ${schoolDisplayName}`;
  const preheader = `${totalCount} ASPIRE update${totalCount === 1 ? '' : 's'} for ${schoolDisplayName} (${dateRange}).`;

  // Personalized greeting: use the coordinator's first name when present; fall back to a plain
  // "Good morning," when it is missing (never render a literal placeholder or "undefined"/"null").
  const firstName = String(coordinatorFirstName || '').trim();
  const greeting  = firstName ? `Good morning ${escHtml(firstName)},` : 'Good morning,';

  const sections = CATEGORIES
    .map(cat => renderSection(cat, transitions[cat.key]))
    .join('');

  const body = `
<p style="margin:0 0 6px;">${greeting}</p>
<p style="margin:0 0 20px;">I hope you are doing well. Please see this week&rsquo;s ASPIRE update for your students&rsquo; interview and placement activity.</p>

${sections}

<p style="margin:0 0 16px;">This reflects ${totalCount} total update${totalCount === 1 ? '' : 's'} for ${escHtml(schoolDisplayName)} this week.</p>

<p style="margin:0 0 16px;">For any questions about these students or their ASPIRE placement activity, please email Jester directly at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};">jesterlloyd.bautista@cshs.org</a>.</p>

<p style="margin:0;">Thank you for your continued partnership.</p>
${aspireHandwrittenSignature('Kind regards,')}`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatDateRange(start, end) {
  const fmt = d => new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  });
  return `${fmt(start)} to ${fmt(end)}`;
}
