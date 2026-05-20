// src/lib/notifications/templates/interviewReminder.js
// 24-hour interview reminder email sent to students.

import { JESTER_SIGNATURE } from './signatures.js';

const CS_RED = '#930045';
const SAND   = '#F4F1EC';
const RAVEN  = '#191919';

const JESTER_PHONE = '424-386-5004';

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
  This is an automated notification from the ASPIRE Program. Replies go directly to Jester.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function buildInterviewReminderEmail({ firstName, interviewDate, interviewTime, cohortName }) {
  const subject   = `See you tomorrow, ${firstName}: a few notes before your ASPIRE interview`;
  const preheader = `Your interview details, what to expect, and a few small things that might help.`;

  const body = `
<p style="margin:0 0 16px;">Hi ${firstName},</p>

<p style="margin:0 0 16px;">Looking forward to meeting you tomorrow. Your interview with our Nursing Professional Development team is one of the last steps before we work on your unit placement, and we want you to feel as prepared and at ease as possible going in.</p>

<p style="margin:0 0 20px;">A few things before tomorrow:</p>

<!-- Interview details block -->
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${SAND};border-radius:8px;margin:0 0 24px;">
<tr><td style="padding:18px 20px;">
  <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-weight:600;">Your Interview</div>
  <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Date</strong></td>
      <td style="padding:4px 0;font-size:14px;">${interviewDate}</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Time</strong></td>
      <td style="padding:4px 0;font-size:14px;">${interviewTime} Pacific</td>
    </tr>
    <tr>
      <td style="padding:4px 20px 4px 0;color:#666;font-size:14px;white-space:nowrap;"><strong>Format</strong></td>
      <td style="padding:4px 0;font-size:14px;">Microsoft Teams (check your calendar invite for the link)</td>
    </tr>
  </table>
</td></tr>
</table>

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">What to expect</p>
<p style="margin:0 0 16px;">The interview is a conversation, not an evaluation in the traditional sense. We want to learn about you — your clinical interests, the kinds of patients you connect with, what you're hoping to take away from your ASPIRE rotation, and how you see yourself fitting into the Cedars-Sinai environment. It usually runs about 30 minutes. Your interviewer will leave time for your questions too.</p>

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">A few things that might help</p>
<ul style="margin:0 0 20px;padding-left:22px;color:${RAVEN};">
  <li style="margin-bottom:10px;"><strong>Think about a clinical moment that mattered to you.</strong> It doesn't have to be dramatic. Something that reminded you why you chose nursing — a patient interaction, a moment of clarity, a time you felt useful. We'll probably ask about this.</li>
  <li style="margin-bottom:10px;"><strong>Have a couple of questions ready for us.</strong> Curiosity about the units, the preceptorship structure, or what sets Cedars-Sinai apart — asking good questions tends to make interviews feel more like conversations.</li>
  <li style="margin-bottom:10px;"><strong>Know your top unit choices and why.</strong> We'll talk through your preferences from the intake form. Being able to articulate why a particular unit appeals to you (the patient population, the specialty, what you want to learn) is helpful for matching.</li>
  <li style="margin-bottom:10px;"><strong>Test your tech beforehand.</strong> Open Microsoft Teams at least 15 minutes early, check your audio and camera, and find a quiet spot with a stable connection. Log in with the link from your calendar invite.</li>
  <li style="margin-bottom:0;"><strong>Sleep, eat, and don't overthink it.</strong> You applied to this program because you want to be here. That comes through. We're looking forward to the conversation.</li>
</ul>

<p style="margin:0 0 6px;font-weight:700;font-size:15px;">If anything comes up</p>
<p style="margin:0 0 20px;">If you need to reschedule or have a last-minute question, email me directly at <a href="mailto:${JESTER_SIGNATURE.email}" style="color:${CS_RED};">${JESTER_SIGNATURE.email}</a> or call <a href="tel:+1${JESTER_PHONE.replace(/\D/g,'')}" style="color:${CS_RED};">${JESTER_PHONE}</a>. We'll do our best to work it out.</p>

<p style="margin:0 0 20px;">You've got this.</p>

<p style="margin:0;">
  ${JESTER_SIGNATURE.fullName}<br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span><br/>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.email} · ${JESTER_PHONE}</span>
</p>`;

  return { subject, html: wrap(body, preheader) };
}

// Notification framework audience wrapper
export const interviewReminder = {
  student: (ctx) => buildInterviewReminderEmail(ctx),
};
