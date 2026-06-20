// src/lib/notifications/templates/teamsInviteReminder.js
// Two audience variants per type:
//   teamsInviteReminder          → interviewer (first reminder, amber callout)
//   teamsInviteReminderEscalation → interviewer (second/escalation, urgent callout)
// Owner is included as a recipient via the recipients resolver; both get identical content.
// EMAIL-TEMPLATE-BRAND-2B — rendered in the canonical Nightfall/Cedars ASPIRE shell. The escalation
// variant keeps its urgency as an in-body alert block, but no longer uses the magenta/red shell as
// its visual identity (recolored to an on-brand urgent treatment; CTA is the canonical navy).

import { JESTER_SIGNATURE } from './signatures.js';

const NAVY  = '#1D2567';   // Nightfall — ASPIRE Intelligence primary brand color
const SAND  = '#F4F1EC';   // Sand — ASPIRE app background
const RAVEN = '#191919';   // Near-black body text

// Footer attribution preserved verbatim from the prior SHARED_FOOTER, now in the canonical footer cell.
const FOOTER_TEXT = `This is an automated reminder from ASPIRE Intelligence. The Affiliate Students' Pathway from Internship to Residency Experience is a program of the Geri and Richard Brawerman Nursing Institute at Cedars-Sinai Medical Center.`;

function wrap(content, preheader = '') {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASPIRE Program</title></head>
<body style="margin:0;padding:0;background:${SAND};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${RAVEN};">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
  style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

<!-- Nightfall header with reversed CS logo — canonical ASPIRE shell -->
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
  ${FOOTER_TEXT}
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

export const teamsInviteReminder = {
  interviewer: (ctx) => ({
    subject: `Reminder: Send Teams invite for ${ctx.studentName} — interview in ~${ctx.hoursUntilInterview}h`,
    html: wrap(`
        <div style="background:#FBF5E8;border-left:3px solid #C08A2A;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
          <strong style="color:#8B5E1A;">Action needed:</strong> Your ASPIRE interview with ${ctx.studentName} is in about ${ctx.hoursUntilInterview} hours, and the Microsoft Teams invitation hasn't been sent yet.
        </div>

        <p>Hi ${ctx.interviewerName?.split(' ')[0] || 'there'},</p>
        <p>You're scheduled to interview <strong>${ctx.studentName}</strong> from ${ctx.studentSchool || 'an affiliated school'} on:</p>

        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Date:</strong></td><td>${ctx.interviewDate}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Time:</strong></td><td>${ctx.interviewTime} Pacific Time</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Duration:</strong></td><td>${ctx.duration} minutes</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student Email:</strong></td><td><a href="mailto:${ctx.studentEmail}" style="color:#1D2567;">${ctx.studentEmail}</a></td></tr>
        </table>

        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#475467;margin-top:24px;">What to do</h3>
        <ol style="padding-left:20px;color:#475467;">
          <li>Create a Microsoft Teams meeting for the date and time above.</li>
          <li>Send the meeting link to the student at <a href="mailto:${ctx.studentEmail}" style="color:#1D2567;">${ctx.studentEmail}</a>.</li>
          <li>Open ASPIRE Intelligence → Interview Room → Day Manager and click "Mark Teams invite sent" on this booking.</li>
        </ol>

        <p style="margin-top:20px;">
          <a href="https://aspire-tracker.vercel.app" style="display:inline-block;padding:10px 18px;background:#1D2567;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open ASPIRE Intelligence</a>
        </p>

        <p style="margin-top:24px;">Thank you for supporting these students. If you're unable to conduct this interview, please reply so we can reassign or reschedule.</p>

        <p style="margin-top:16px;">
          ${JESTER_SIGNATURE.fullName}<br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span>
        </p>`,
      `Teams invite still needs to be sent for ${ctx.studentName}.`),
  }),

  // Owner gets same email content as interviewer (addressed via recipient resolver)
  internal_team: (ctx) => teamsInviteReminder.interviewer(ctx),
};

export const teamsInviteReminderEscalation = {
  interviewer: (ctx) => ({
    subject: `URGENT: Teams invite still pending for ${ctx.studentName} — interview in ~${ctx.hoursUntilInterview}h`,
    html: wrap(`
        <div style="background:#FDF0E6;border-left:3px solid #C2410C;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
          <strong style="color:#9A3412;">This is a second reminder.</strong> ${ctx.studentName}'s interview is in about ${ctx.hoursUntilInterview} hours and the Teams invitation still hasn't been sent. The student is expecting it.
        </div>

        <p>Hi ${ctx.interviewerName?.split(' ')[0] || 'there'},</p>
        <p>I sent a reminder yesterday about ${ctx.studentName}'s upcoming ASPIRE interview, but it doesn't look like the Teams invitation has gone out yet. The student needs the link to join.</p>

        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student:</strong></td><td>${ctx.studentName}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School:</strong></td><td>${ctx.studentSchool || 'N/A'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Date:</strong></td><td>${ctx.interviewDate}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Time:</strong></td><td>${ctx.interviewTime} Pacific Time</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Duration:</strong></td><td>${ctx.duration} minutes</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student Email:</strong></td><td><a href="mailto:${ctx.studentEmail}" style="color:#1D2567;">${ctx.studentEmail}</a></td></tr>
        </table>

        <p>Can you please send the Teams invitation today, or reply if you're unable to conduct this interview so we can reassign or reschedule? The student has been waiting.</p>

        <p style="margin-top:20px;">
          <a href="https://aspire-tracker.vercel.app" style="display:inline-block;padding:10px 18px;background:#1D2567;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open ASPIRE Intelligence</a>
        </p>

        <p style="margin-top:16px;">
          ${JESTER_SIGNATURE.fullName}<br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span>
        </p>`,
      `Second reminder — Teams invite still pending for ${ctx.studentName}.`),
  }),

  internal_team: (ctx) => teamsInviteReminderEscalation.interviewer(ctx),
};
