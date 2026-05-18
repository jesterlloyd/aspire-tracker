// src/lib/notifications/templates/formReceived.js
// Three audience variants for the 'form_received' notification type.
import { JESTER_SIGNATURE } from './signatures.js';

const SHARED_FOOTER = `
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:11px;color:#98A2B3;line-height:1.5;">
    This is an automated notification from ASPIRE Intelligence. The Affiliate Students' Pathway from Internship to Residency Experience is a program of the Geri and Richard Brawerman Nursing Institute at Cedars-Sinai Medical Center.
  </p>
`;

const base = 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:580px;color:#0E1428;line-height:1.55;';

export const formReceived = {
  student: (ctx) => ({
    subject: 'We received your ASPIRE application',
    html: `
      <div style="${base}">
        <h2 style="color:#1D2567;font-weight:600;margin:0 0 12px;">Welcome, ${ctx.studentFirstName || 'there'}.</h2>
        <p>Thank you for submitting your application to the ASPIRE Program at Cedars-Sinai. We've received your information and your placement coordinator at <strong>${ctx.school || 'your school'}</strong> has been notified.</p>

        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#475467;margin-top:24px;">What happens next</h3>
        <ol style="padding-left:20px;color:#475467;">
          <li>Our team will review your application within the next few business days.</li>
          <li>If you meet eligibility requirements, you'll be invited to schedule a brief interview to discuss your clinical interests and unit preferences.</li>
          <li>After your interview, our Nursing Professional Development team will work to match you with a unit and preceptor aligned with your goals.</li>
        </ol>

        <p style="margin-top:24px;">If you have questions in the meantime, you can reach me directly at <a href="mailto:JesterLloyd.Bautista@cshs.org" style="color:#1D2567;">JesterLloyd.Bautista@cshs.org</a>.</p>

        <p style="margin-top:24px;">We're glad you're considering Cedars-Sinai as the next step in your nursing journey.</p>

        <p style="margin-top:16px;">
          ${JESTER_SIGNATURE.fullName}<br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br/>
          <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span>
        </p>
        ${SHARED_FOOTER}
      </div>
    `,
  }),

  internal_team: (ctx) => ({
    subject: `New ASPIRE application: ${ctx.studentName} (${ctx.school || 'unknown school'})`,
    html: `
      <div style="${base}">
        <h2 style="color:#1D2567;font-weight:600;margin:0 0 12px;">New ASPIRE Application</h2>

        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student:</strong></td><td>${ctx.studentName}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School:</strong></td><td>${ctx.school || 'Not specified'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Program:</strong></td><td>${ctx.programType || 'Not specified'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School Email:</strong></td><td><a href="mailto:${ctx.studentEmail}" style="color:#1D2567;">${ctx.studentEmail}</a></td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>GPA:</strong></td><td>${ctx.cumulativeGpa || 'Not provided'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Submitted:</strong></td><td>${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</td></tr>
        </table>

        <p style="margin-top:20px;">
          <a href="https://aspire-tracker.vercel.app" style="display:inline-block;padding:10px 18px;background:#1D2567;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open in ASPIRE Intelligence</a>
        </p>
        ${SHARED_FOOTER}
      </div>
    `,
  }),

  school_coordinator: (ctx, recipient) => {
    const coordFirst = recipient?.name?.split(' ')[0] || 'there';
    return {
      subject: `${ctx.studentName} has submitted their ASPIRE application`,
      html: `
        <div style="${base}">
          <p>Hi ${coordFirst},</p>
          <p>This is a heads-up that <strong>${ctx.studentName}</strong> from ${ctx.school} has just submitted their ASPIRE Program application at Cedars-Sinai.</p>

          <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Program:</strong></td><td>${ctx.programType || 'Not specified'}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Submitted:</strong></td><td>${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</td></tr>
          </table>

          <p>Our team will be in touch with ${ctx.studentFirstName || 'them'} directly to schedule a brief interview and discuss next steps. If anything looks off on your end or you have additional context to share, just reply to this email.</p>

          <p style="margin-top:16px;">Thank you for your partnership in supporting these students.</p>

          <p style="margin-top:16px;">
            Best,<br/>
            ${JESTER_SIGNATURE.fullName}<br/>
            <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}, Cedars-Sinai</span>
          </p>
          ${SHARED_FOOTER}
        </div>
      `,
    };
  },
};
