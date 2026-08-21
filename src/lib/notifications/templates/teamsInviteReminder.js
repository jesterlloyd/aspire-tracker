// src/lib/notifications/templates/teamsInviteReminder.js
// Two audience variants per type:
//   teamsInviteReminder           -> interviewer (first reminder, amber callout)
//   teamsInviteReminderEscalation -> interviewer (second/escalation, urgent callout)
// Owner is included as a recipient via the recipients resolver; both get identical content.
// EMAIL-BRAND-REFRESH Phase 2B-5: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) - Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. Typed system signature only (no handwritten image).

// S-06 TEMPLATE ESCAPING: studentName, studentSchool, and studentEmail originate from the public
// intake and school forms, and interviewerName from a profile record. They are interpolated into
// raw HTML here (including inside mailto href attributes), so every one passes through escapeHtml.
// Values handed to renderEmailNote / renderEmailButton are NOT escaped here: those primitives
// escape their own inputs, and escaping twice would show recipients literal character entities.
import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { renderEmailNote, renderEmailButton } from '../../../../lib/server/email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';
import { appUrl } from '../../appUrl.js';

export const teamsInviteReminder = {
  interviewer: (ctx) => ({
    subject: `Reminder: send the Teams invite for ${ctx.studentName} (interview in ~${ctx.hoursUntilInterview}h)`,
    html: aspireEmailShell({
      preheader: `Teams invite still needs to be sent for ${escapeHtml(ctx.studentName)}.`,
      body: `
        ${renderEmailNote({ title: 'Action needed', body: `Your ASPIRE interview with ${ctx.studentName} is in about ${ctx.hoursUntilInterview} hours, and the Microsoft Teams invitation hasn't been sent yet.`, tone: 'warning' })}

        <p>Hi ${escapeHtml(ctx.interviewerName?.split(' ')[0] || 'there')},</p>
        <p>You're scheduled to interview <strong>${escapeHtml(ctx.studentName)}</strong> from ${escapeHtml(ctx.studentSchool || 'an affiliated school')} on:</p>

        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Date:</strong></td><td>${escapeHtml(ctx.interviewDate)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Time:</strong></td><td>${escapeHtml(ctx.interviewTime)} Pacific Time</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Duration:</strong></td><td>${escapeHtml(ctx.duration)} minutes</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student Email:</strong></td><td><a href="mailto:${escapeHtml(ctx.studentEmail)}" style="color:#1D2567;">${escapeHtml(ctx.studentEmail)}</a></td></tr>
        </table>

        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#475467;margin-top:24px;">What to do</h3>
        <ol style="padding-left:20px;color:#475467;">
          <li>Create a Microsoft Teams meeting for the date and time above.</li>
          <li>Send the meeting link to the student at <a href="mailto:${escapeHtml(ctx.studentEmail)}" style="color:#1D2567;">${escapeHtml(ctx.studentEmail)}</a>.</li>
          <li>Open ASPIRE Intelligence, go to Interview Room, then Day Manager, and click "Mark Teams invite sent" on this booking.</li>
        </ol>

        ${renderEmailButton({ label: 'Open ASPIRE Intelligence', url: appUrl(), variant: 'navy' })}

        <p style="margin-top:24px;">Thank you for supporting these students. If you're unable to conduct this interview, email Jester at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:#1D2567;">jesterlloyd.bautista@cshs.org</a> so we can reassign or reschedule.</p>
        ${aspireHandwrittenSignature('Kind regards,')}`,
    }),
  }),

  // Owner gets the same email content as the interviewer (addressed via recipient resolver)
  internal_team: (ctx) => teamsInviteReminder.interviewer(ctx),
};

export const teamsInviteReminderEscalation = {
  interviewer: (ctx) => ({
    subject: `URGENT: Teams invite still pending for ${ctx.studentName} (interview in ~${ctx.hoursUntilInterview}h)`,
    html: aspireEmailShell({
      preheader: `Second reminder: Teams invite still pending for ${escapeHtml(ctx.studentName)}.`,
      body: `
        <div style="background:#FDF0E6;border-left:3px solid #C2410C;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
          <strong style="color:#9A3412;">This is a second reminder.</strong> ${escapeHtml(ctx.studentName)}'s interview is in about ${escapeHtml(ctx.hoursUntilInterview)} hours and the Teams invitation still hasn't been sent. The student is expecting it.
        </div>

        <p>Hi ${escapeHtml(ctx.interviewerName?.split(' ')[0] || 'there')},</p>
        <p>I sent a reminder yesterday about ${escapeHtml(ctx.studentName)}'s upcoming ASPIRE interview, but it doesn't look like the Teams invitation has gone out yet. The student needs the link to join.</p>

        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student:</strong></td><td>${escapeHtml(ctx.studentName)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School:</strong></td><td>${escapeHtml(ctx.studentSchool || 'N/A')}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Date:</strong></td><td>${escapeHtml(ctx.interviewDate)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Time:</strong></td><td>${escapeHtml(ctx.interviewTime)} Pacific Time</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Duration:</strong></td><td>${escapeHtml(ctx.duration)} minutes</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student Email:</strong></td><td><a href="mailto:${escapeHtml(ctx.studentEmail)}" style="color:#1D2567;">${escapeHtml(ctx.studentEmail)}</a></td></tr>
        </table>

        <p>Please send the Teams invitation today. If you're unable to conduct this interview, email Jester at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:#1D2567;">jesterlloyd.bautista@cshs.org</a> so we can reassign or reschedule. The student has been waiting.</p>

        ${renderEmailButton({ label: 'Open ASPIRE Intelligence', url: appUrl(), variant: 'navy' })}
        ${aspireHandwrittenSignature('Kind regards,')}`,
    }),
  }),

  internal_team: (ctx) => teamsInviteReminderEscalation.interviewer(ctx),
};
