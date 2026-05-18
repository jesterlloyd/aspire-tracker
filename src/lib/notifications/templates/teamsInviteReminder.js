// src/lib/notifications/templates/teamsInviteReminder.js
// Two audience variants per type:
//   teamsInviteReminder          → interviewer (first reminder, amber callout)
//   teamsInviteReminderEscalation → interviewer (second/escalation, Chroma callout)
// Owner is included as a recipient via the recipients resolver; both get identical content.

import { JESTER_SIGNATURE } from './signatures.js';

const SHARED_FOOTER = `
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:11px;color:#98A2B3;line-height:1.5;">
    This is an automated reminder from ASPIRE Intelligence. The Affiliate Students' Pathway from Internship to Residency Experience is a program of the Geri and Richard Brawerman Nursing Institute at Cedars-Sinai Medical Center.
  </p>
`;

const base = 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:580px;color:#0E1428;line-height:1.55;';

export const teamsInviteReminder = {
  interviewer: (ctx) => ({
    subject: `Reminder: Send Teams invite for ${ctx.studentName} — interview in ~${ctx.hoursUntilInterview}h`,
    html: `
      <div style="${base}">
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
        </p>
        ${SHARED_FOOTER}
      </div>
    `,
  }),

  // Owner gets same email content as interviewer (addressed via recipient resolver)
  internal_team: (ctx) => teamsInviteReminder.interviewer(ctx),
};

export const teamsInviteReminderEscalation = {
  interviewer: (ctx) => ({
    subject: `URGENT: Teams invite still pending for ${ctx.studentName} — interview in ~${ctx.hoursUntilInterview}h`,
    html: `
      <div style="${base}">
        <div style="background:#F8EDF2;border-left:3px solid #930045;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
          <strong style="color:#930045;">This is a second reminder.</strong> ${ctx.studentName}'s interview is in about ${ctx.hoursUntilInterview} hours and the Teams invitation still hasn't been sent. The student is expecting it.
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
          <a href="https://aspire-tracker.vercel.app" style="display:inline-block;padding:10px 18px;background:#930045;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open ASPIRE Intelligence</a>
        </p>

        <p style="margin-top:16px;">
          ${JESTER_SIGNATURE.fullName}<br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span>
        </p>
        ${SHARED_FOOTER}
      </div>
    `,
  }),

  internal_team: (ctx) => teamsInviteReminderEscalation.interviewer(ctx),
};
