// src/lib/notifications/templates/interviewReminder.js
// 24-hour interview reminder email sent to students.
// EMAIL-BRAND-REFRESH Phase 2B-3: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) - Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. Typed system signature only (no handwritten image).

import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { renderEmailDetailsCard } from '../../../../lib/server/email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';

const NAVY  = '#1d2567';
const RAVEN = '#191919';

export function buildInterviewReminderEmail({ firstName, interviewDate, interviewTime, cohortName }) {
  const subject   = `See you tomorrow, ${firstName}: a few notes before your ASPIRE interview`;
  const preheader = `Your interview details, what to expect, and a few small things that might help.`;

  const body = `
<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>

<p style="margin:0 0 16px;">Looking forward to meeting you tomorrow. Your interview with our Nursing Professional Development team is one of the last steps before we work on your unit placement, and we want you to feel as prepared and at ease as possible going in.</p>

<p style="margin:0 0 20px;">A few things before tomorrow:</p>

<!-- Interview details block, EMAIL-NOTIF-MODERNIZE-2A: shared details-card primitive (same Date/Time/
     Format data; consistent ASPIRE card styling). -->
${renderEmailDetailsCard({ title: 'Your Interview', rows: [
  { label: 'Date',   value: interviewDate },
  { label: 'Time',   value: `${interviewTime} Pacific` },
  { label: 'Format', value: 'Microsoft Teams (check your calendar invite for the link)' },
] })}

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">What to expect</p>
<p style="margin:0 0 16px;">The interview is a conversation, not an evaluation in the traditional sense. We want to learn about you: your clinical interests, the patients you connect with, and what you hope to take from your ASPIRE rotation. It usually runs about 30 minutes. Your interviewer will leave time for your questions too.</p>

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">A few things that might help</p>
<ul style="margin:0 0 20px;padding-left:22px;color:${RAVEN};">
  <li style="margin-bottom:10px;"><strong>Think about a clinical moment that mattered to you.</strong> It does not have to be dramatic. It can be a patient interaction, a moment of clarity, or a time you felt useful. We'll probably ask about this.</li>
  <li style="margin-bottom:10px;"><strong>Have a couple of questions ready for us.</strong> Bring questions about the units, the preceptorship structure, or what sets Cedars-Sinai apart. Good questions tend to make interviews feel more like conversations.</li>
  <li style="margin-bottom:10px;"><strong>Know your top unit choices and why.</strong> We'll talk through your preferences from the intake form. Being able to articulate why a particular unit appeals to you (the patient population, the specialty, what you want to learn) is helpful for matching.</li>
  <li style="margin-bottom:10px;"><strong>Test your tech beforehand.</strong> Open Microsoft Teams at least 15 minutes early, check your audio and camera, and find a quiet spot with a stable connection. Log in with the link from your calendar invite.</li>
  <li style="margin-bottom:0;"><strong>Sleep, eat, and don't overthink it.</strong> You applied to this program because you want to be here. That comes through. We're looking forward to the conversation.</li>
</ul>

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">If anything comes up</p>
<p style="margin:0 0 20px;">If you need to reschedule or have a last-minute question, email me directly at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};">jesterlloyd.bautista@cshs.org</a> or call <a href="tel:+13102488964" style="color:${NAVY};">310-248-8964</a>. We'll do our best to work it out.</p>

<p style="margin:0 0 4px;">You've got this.</p>
${aspireHandwrittenSignature('Kind regards,')}`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}

// Notification framework audience wrapper
export const interviewReminder = {
  student: (ctx) => buildInterviewReminderEmail(ctx),
};
