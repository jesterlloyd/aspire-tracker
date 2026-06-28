// src/lib/notifications/templates/formReceived.js
// Three audience variants for the 'form_received' notification type.
// EMAIL-BRAND-REFRESH Phase 2B-1: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) — Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. Typed system signature only (no handwritten image).
import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell, aspireSystemSignature } from '../../../../lib/server/email/aspireShell.js';

const NAVY = '#1d2567';

export const formReceived = {
  student: (ctx) => ({
    subject: 'We received your ASPIRE application',
    html: aspireEmailShell({
      preheader: 'We received your ASPIRE application.',
      body: `
        <h2 style="color:${NAVY};font-weight:600;margin:0 0 12px;">Welcome, ${escapeHtml(ctx.studentGreetingName || ctx.studentFirstName || 'there')}.</h2>
        <p style="margin:0 0 16px;">Thank you for submitting your application to ASPIRE at Cedars-Sinai. We&rsquo;ve received your information and your placement coordinator at <strong>${ctx.school || 'your school'}</strong> has been notified.</p>

        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#475467;margin-top:24px;">What happens next</h3>
        <ol style="padding-left:20px;color:#475467;">
          <li>Our team will review your application within the next few business days.</li>
          <li>If you meet eligibility requirements, you&rsquo;ll be invited to schedule a brief interview to discuss your clinical interests and unit preferences.</li>
          <li>After your interview, our Nursing Professional Development team will work to match you with a unit and preceptor aligned with your goals.</li>
        </ol>

        <p style="margin-top:24px;">If you have questions in the meantime, you can reach me directly at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};">jesterlloyd.bautista@cshs.org</a>.</p>

        <p style="margin-top:16px;">We&rsquo;re glad you&rsquo;re considering Cedars-Sinai for your next step in nursing.</p>
        ${aspireSystemSignature('Kind regards,')}`,
    }),
  }),

  internal_team: (ctx) => ({
    subject: `New ASPIRE application: ${ctx.studentName} (${ctx.school || 'unknown school'})`,
    html: aspireEmailShell({
      preheader: `New ASPIRE application from ${ctx.studentName}.`,
      body: `
        <h2 style="color:${NAVY};font-weight:600;margin:0 0 12px;">New ASPIRE Application</h2>

        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student:</strong></td><td>${ctx.studentName}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School:</strong></td><td>${ctx.school || 'Not specified'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Program:</strong></td><td>${ctx.programType || 'Not specified'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School Email:</strong></td><td><a href="mailto:${ctx.studentEmail}" style="color:${NAVY};">${ctx.studentEmail}</a></td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>GPA:</strong></td><td>${ctx.cumulativeGpa || 'Not provided'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Submitted:</strong></td><td>${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</td></tr>
        </table>

        <p style="margin-top:20px;">
          <a href="https://aspire-tracker.vercel.app" style="display:inline-block;padding:10px 18px;background:${NAVY};color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open in ASPIRE Intelligence</a>
        </p>`,
    }),
  }),

  school_coordinator: (ctx, recipient) => {
    const coordFirst = recipient?.name?.split(' ')[0] || 'there';
    return {
      subject: `${ctx.studentName} has submitted their ASPIRE application`,
      html: aspireEmailShell({
        preheader: `${ctx.studentName} submitted their ASPIRE application.`,
        body: `
          <p style="margin:0 0 16px;">Hi ${coordFirst},</p>
          <p style="margin:0 0 16px;">This is a heads-up that <strong>${ctx.studentName}</strong> from ${ctx.school} has just submitted their ASPIRE application at Cedars-Sinai.</p>

          <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Program:</strong></td><td>${ctx.programType || 'Not specified'}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Submitted:</strong></td><td>${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</td></tr>
          </table>

          <p style="margin:0 0 16px;">Our team will be in touch with ${ctx.studentFirstName || 'them'} directly to schedule a brief interview and discuss next steps. If anything looks off or you have context to share, email Jester at <a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};">jesterlloyd.bautista@cshs.org</a>.</p>

          <p style="margin:0;">Thank you for supporting these students.</p>
          ${aspireSystemSignature('Kind regards,')}`,
      }),
    };
  },
};
