// src/lib/notifications/templates/clockoutReminder.js
// CLOCKOUT-NUDGE-LIVE-1 — student "your shift still appears open" reminder.
// Supportive/operational, never disciplinary: "clock out" (not "logout"); "still appears open"
// (not "you forgot"). Approved subject/body, unchanged.

const CS_RED = '#930045';
const SAND   = '#F4F1EC';
const RAVEN  = '#191919';

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
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
<tr><td style="background:${CS_RED};padding:20px 28px;">
  <div style="color:#ffffff;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">ASPIRE Program</div>
  <div style="color:#ffffff;font-size:11px;opacity:0.85;margin-top:2px;">Cedars-Sinai Medical Center</div>
</td></tr>
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#666;line-height:1.5;border-top:1px solid #eee;padding-top:16px;">
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
