// src/lib/notifications/templates/clockoutReminder.js
// CLOCKOUT-NUDGE-LIVE-1 — student "your shift still appears open" reminder.
// Supportive/operational, never disciplinary: "clock out" (not "logout"); "still appears open"
// (not "you forgot"). Approved subject/body, unchanged.
// CLOCKOUT-EMAIL-BRAND-1 — uses the shared Nightfall/Cedars branded shell (same header markup as the
// coordinator digest: navy header, reversed CS logo, ASPIRE Program / Brawerman Nursing Institute).

const NAVY  = '#1D2567';   // Nightfall — ASPIRE Intelligence primary brand color
const SAND  = '#F4F1EC';   // Sand — ASPIRE app background
const RAVEN = '#191919';   // Near-black body text

export const CLOCKOUT_REMINDER_SUBJECT = 'ASPIRE Shift Clock-Out Reminder';

// Exact approved plaintext body. Used for the preview mode and as the email content source.
export function clockoutReminderText(firstName) {
  const name = (firstName && String(firstName).trim()) || 'there';
  return [
    `Hi ${name},`,
    '',
    'Your ASPIRE shift still appears open in the tracker. If your shift has ended, please clock out as soon as possible.',
    '',
    'If you are still on shift, no action is needed at this time.',
    '',
    'Thank you,',
    'Jester',
  ].join('\n');
}

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

<!-- Nightfall header with reversed CS logo — matches other ASPIRE emails (coordinator digest shell) -->
<tr><td style="background:${NAVY};padding:12px 28px;">
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
  This is an automated reminder from the ASPIRE Program.
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

export function buildClockoutReminderEmail({ firstName } = {}) {
  const name = (firstName && String(firstName).trim()) || 'there';
  const preheader = 'Your ASPIRE shift still appears open in the tracker.';
  const body = `
    <p style="margin:0 0 16px;">Hi ${name},</p>
    <p style="margin:0 0 16px;">Your ASPIRE shift still appears open in the tracker. If your shift has ended, please clock out as soon as possible.</p>
    <p style="margin:0 0 20px;">If you are still on shift, no action is needed at this time.</p>
    <p style="margin:0 0 4px;">Thank you,</p>
    <p style="margin:0;">Jester</p>`;
  return { subject: CLOCKOUT_REMINDER_SUBJECT, html: wrap(body, preheader) };
}

// Registry-shaped export (audience -> builder), matching the other notification templates.
export const clockoutReminder = {
  student: (ctx) => buildClockoutReminderEmail(ctx),
};
