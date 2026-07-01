// src/lib/notifications/templates/clockoutReminder.js
// CLOCKOUT-NUDGE-LIVE-1 — student "your shift still appears open" reminder.
// Supportive/operational, never disciplinary: "clock out" (not "logout"); "still appears open"
// (not "you forgot"). Approved subject/body.
// EMAIL-BRAND-REFRESH Phase 2B pilot: migrated onto the shared ASPIRE shell
// (lib/server/email/aspireShell.js) — Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. Typed system signature (no handwritten image).

import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';

export const CLOCKOUT_REMINDER_SUBJECT = 'ASPIRE Shift Clock-Out Reminder';

// Exact approved plaintext body — used for the cron admin preview and as the plaintext source.
// Mirrors the sent HTML so preview equals sent.
export function clockoutReminderText(firstName) {
  const name = (firstName && String(firstName).trim()) || 'there';
  return [
    `Hi ${name},`,
    '',
    'Your ASPIRE shift still appears open in the tracker. If your shift has ended, please clock out as soon as possible.',
    '',
    'If you are still on shift, no action is needed at this time.',
    '',
    'Kind regards,',
    'Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN',
    'Nursing Professional Development Practitioner',
    'Geri & Richard Brawerman Nursing Institute',
    'jesterlloyd.bautista@cshs.org | Office: 310-248-8964',
  ].join('\n');
}

export function buildClockoutReminderEmail({ firstName } = {}) {
  const name = (firstName && String(firstName).trim()) || 'there';
  const preheader = 'Your ASPIRE shift still appears open in the tracker.';
  const body = `
    <p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 16px;">Your ASPIRE shift still appears open in the tracker. If your shift has ended, please clock out as soon as possible.</p>
    <p style="margin:0;">If you are still on shift, no action is needed at this time.</p>
    ${aspireHandwrittenSignature('Kind regards,')}`;
  return { subject: CLOCKOUT_REMINDER_SUBJECT, html: aspireEmailShell({ body, preheader }) };
}

// Registry-shaped export (audience -> builder), matching the other notification templates.
export const clockoutReminder = {
  student: (ctx) => buildClockoutReminderEmail(ctx),
};
