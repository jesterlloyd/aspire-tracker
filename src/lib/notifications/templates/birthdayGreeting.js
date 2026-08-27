// src/lib/notifications/templates/birthdayGreeting.js
// STUDENT-BIRTHDAY-GREETING-1 - a short birthday note to a student who is
// currently on their ASPIRE rotation.
//
// Built on the shared ASPIRE system shell (lib/server/email/aspireShell.js), the
// same Nightfall header / white card / no-reply footer every automated ASPIRE
// email uses, with the handwritten GIF signature (SIGNATURE-PARITY-1: the GIF
// long ago outgrew its original midpoint-only exception and is now the standard
// cron signature; this template and access retirement were the last two typed
// holdouts).
//
// PRIVACY. The only personal value that reaches this template is the first
// name. No age, no date of birth, no year, no cohort, no rotation detail, and
// nothing derived from the birthday beyond the fact that it is today. The cron
// deliberately does not pass a DOB into the context, so it cannot leak into the
// rendered HTML or into notification_log metadata.

import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';

export const BIRTHDAY_GREETING_SUBJECT = 'Happy Birthday from ASPIRE';

/** The approved plaintext body; the HTML below mirrors it so preview equals sent. */
export function birthdayGreetingText(firstName) {
  const name = (firstName && String(firstName).trim()) || 'there';
  return [
    `Happy Birthday, ${name}!`,
    '',
    'Wishing you a wonderful birthday from all of us at ASPIRE. We hope your day is filled with',
    'joy, and we appreciate the energy and commitment you bring to your clinical experience.',
    '',
    'Warm wishes,',
    'The ASPIRE Team',
  ].join('\n');
}

export function buildBirthdayGreetingEmail({ firstName } = {}) {
  const name = escapeHtml((firstName && String(firstName).trim()) || 'there');
  const subject = BIRTHDAY_GREETING_SUBJECT;
  const preheader = 'Wishing you a wonderful birthday from all of us at ASPIRE.';

  const body = `
<p style="margin:0 0 16px;font-size:16px;font-weight:600;">Happy Birthday, ${name}!</p>
<p style="margin:0 0 16px;">Wishing you a wonderful birthday from all of us at ASPIRE. We hope your day is filled with joy, and we appreciate the energy and commitment you bring to your clinical experience.</p>
${aspireHandwrittenSignature('Warm wishes,')}
`.trim();

  return {
    subject,
    preheader,
    html: aspireEmailShell({ body, preheader }),
    text: birthdayGreetingText(firstName),
  };
}

export const birthdayGreeting = {
  student: (ctx) => buildBirthdayGreetingEmail(ctx),
};
