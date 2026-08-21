// src/lib/notifications/templates/placementRequestReceived.js
//
// AP-SCHOOL-CANONICALIZATION-1: the confirmation for a COORDINATOR-SUBMITTED placement request
// (public /school-form and the Academic Partner portal). Replaces the retired 'form_received'
// notification, whose application language was false for this event: the coordinator submitted a
// placement request; the student has not submitted anything (no Student Profile Form, no
// application, no intake). Accordingly there is NO student variant - a placement request never
// emails the student. The three events stay distinct: placement request (this), Student Profile
// Form submission (student intake flow), and interview/application progression (staff workflows).
//
// Owner-approved copy (2026-07-30). The Program row renders only when a program was submitted
// (renderEmailDetailsCard drops empty rows); the Submitted row keeps the localized PT timestamp.
// Signature: the existing approved ASPIRE handwritten signature with 'Kind regards,'.
import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { renderEmailButton, renderEmailDetailsCard } from '../../../../lib/server/email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';
import { appUrl } from '../../appUrl.js';

const NAVY = '#1d2567';

const submittedStamp = () =>
  `${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT`;

export const placementRequestReceived = {
  school_coordinator: (ctx, recipient) => {
    const coordFirst = (recipient?.name || ctx.coordinatorName || '').split(' ')[0] || 'there';
    const studentName = ctx.studentName || 'your student';
    const studentFirst = ctx.studentFirstName || studentName.split(' ')[0];
    const cohortPhrase = ctx.cohortName
      ? `the rest of the ${escapeHtml(ctx.cohortName)} cohort submissions`
      : "the rest of this cohort's submissions";
    return {
      subject: `ASPIRE Placement Request Received: ${studentName}`,
      html: aspireEmailShell({
        preheader: `We received your placement request for ${escapeHtml(studentName)}.`,
        body: `
          <p style="margin:0 0 16px;">Hi ${escapeHtml(coordFirst)},</p>
          <p style="margin:0 0 16px;">Thank you for submitting a placement request for <strong>${escapeHtml(studentName)}</strong> from <strong>${escapeHtml(ctx.school || 'your school')}</strong>. We have received the request and will review it with ${cohortPhrase}.</p>

          ${renderEmailDetailsCard({ rows: [
            { label: 'Program',   value: ctx.programType || '' },
            { label: 'Submitted', value: submittedStamp() },
          ] })}

          <p style="margin:0 0 16px;">Our team will follow up with ${escapeHtml(studentFirst)} directly regarding the Student Profile Form, interview scheduling, and next steps.</p>

          <p style="margin:0 0 16px;">If anything needs to be corrected or you have additional context to share, please email us at <a href="mailto:aspire@cshs.org" style="color:${NAVY};"><strong>aspire@cshs.org</strong></a>.</p>

          <p style="margin:0;">Thank you for supporting our students.</p>
          ${aspireHandwrittenSignature('Kind regards,')}`,
      }),
    };
  },

  internal_team: (ctx) => ({
    subject: `New ASPIRE Placement Request: ${ctx.studentName} (${ctx.school || 'unknown school'})`,
    html: aspireEmailShell({
      preheader: `New placement request for ${escapeHtml(ctx.studentName)} from ${escapeHtml(ctx.coordinatorName || 'a coordinator')}.`,
      body: `
        <h2 style="color:${NAVY};font-weight:600;margin:0 0 12px;">New ASPIRE Placement Request</h2>

        ${renderEmailDetailsCard({ rows: [
          { label: 'Student',      value: ctx.studentName || '' },
          { label: 'School',       value: ctx.school || 'Not specified' },
          { label: 'Program',      value: ctx.programType || '' },
          { label: 'School Email', value: ctx.studentEmail || '' },
          { label: 'Submitted By', value: [ctx.coordinatorName, ctx.coordinatorEmail].filter(Boolean).join(' · ') },
          { label: 'Submitted',    value: submittedStamp() },
        ] })}

        ${renderEmailButton({ label: 'Open in ASPIRE Intelligence', url: appUrl(), variant: 'navy' })}`,
    }),
  }),
};
