// src/lib/notifications/templates/formReceived.js
// Three audience variants for the 'form_received' notification type.
// EMAIL-TEMPLATE-BRAND-2B — rendered in the canonical Nightfall/Cedars ASPIRE shell (navy header,
// reversed CS logo, ASPIRE Program / Brawerman Nursing Institute), matching the other ASPIRE emails.
import { JESTER_SIGNATURE } from './signatures.js';

const NAVY  = '#1D2567';   // Nightfall — ASPIRE Intelligence primary brand color
const SAND  = '#F4F1EC';   // Sand — ASPIRE app background
const RAVEN = '#191919';   // Near-black body text

// Footer attribution preserved verbatim from the prior SHARED_FOOTER, now in the canonical footer cell.
const FOOTER_TEXT = `This is an automated notification from ASPIRE Intelligence. The Affiliate Students' Pathway from Internship to Residency Experience is a program of the Geri and Richard Brawerman Nursing Institute at Cedars-Sinai Medical Center.`;

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

export const formReceived = {
  student: (ctx) => ({
    subject: 'We received your ASPIRE application',
    html: wrap(`
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
        </p>`,
      `We've received your ASPIRE application.`),
  }),

  internal_team: (ctx) => ({
    subject: `New ASPIRE application: ${ctx.studentName} (${ctx.school || 'unknown school'})`,
    html: wrap(`
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
        </p>`,
      `New ASPIRE application from ${ctx.studentName}.`),
  }),

  school_coordinator: (ctx, recipient) => {
    const coordFirst = recipient?.name?.split(' ')[0] || 'there';
    return {
      subject: `${ctx.studentName} has submitted their ASPIRE application`,
      html: wrap(`
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
          </p>`,
        `${ctx.studentName} submitted their ASPIRE application.`),
    };
  },
};
