// lib/server/evaluation/reminderEmailTemplates.js
//
// EVALUATION-REMINDERS-1: reminder copy, one variant per survey workflow.
//
// A reminder is not the invitation sent again. It acknowledges that we already
// asked, says what is still outstanding, and says when it closes. The four
// workflows get genuinely different wording because they ask different people
// for different things - a preceptor being asked to assess a student is not a
// student being asked to reflect on their own readiness.
//
// CERTIFICATE CLAIMS ARE GATED. `certificateKind` is supplied by the caller from
// src/lib/evaluation/reminderSchedule.js, which derives it from the two SQL
// functions that actually issue certificates. Only Casey-Fink at post_rotation
// and preceptor_progress at post_rotation may mention one. The ASPIRE
// Post-Rotation Evaluation stopped gating a certificate in July 2026 and its
// invitation template is explicit that it "never mentions or attaches any
// award"; these reminders hold that same line, so no one is told a survey
// unlocks something it does not.
//
// The survey URL is a tokenized, server-generated link: trustedUrl:true keeps it
// verbatim through the button primitive (validation/normalization would strip
// the #t= fragment and break every link).

import { escapeHtml } from '../../../src/lib/htmlEscape.js';
import { aspireEmailShell } from '../email/aspireShell.js';
import { renderEmailButton, renderEmailNote } from '../email/emailPrimitives.js';
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js';
import { CERTIFICATE_KINDS } from '../../../src/lib/evaluation/reminderSchedule.js';

const NAVY = '#1D2567';

/** The last reminder before the response window closes. */
const FINAL_REMINDER_NUMBER = 3;

/** "Ava Wong" -> "Ava". Empty input yields an empty string, and the greeting adapts. */
export function firstNameOf(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

/** Format an ISO date/datetime as "Month Day, Year" (LA timezone for datetimes). */
export function formatExpiresAt(isoDatetime) {
  if (!isoDatetime) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDatetime)) {
    const [y, m, dy] = isoDatetime.split('-').map(Number);
    return new Date(y, m - 1, dy).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  }
  const d = new Date(isoDatetime);
  if (isNaN(d.getTime())) return isoDatetime;
  return d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
  });
}

/**
 * Per-workflow copy. `subjectBase` is prefixed with the reminder framing; `lead`
 * is the opening paragraph; `ask` explains what is still needed; `cta` labels the
 * button. None of these mention a certificate - that sentence is added
 * separately, and only when one is genuinely gated.
 */
const WORKFLOW_COPY = Object.freeze({
  casey_fink_readiness: {
    subjectBase: 'Complete Your ASPIRE Readiness Survey',
    cta: 'Complete Readiness Survey',
    lead: 'We recently sent you the Casey-Fink Readiness for Practice Survey, and our records show it is still open.',
    ask: 'The survey takes about ten minutes. It asks how confident and prepared you feel as you move toward practice, and your answers help us shape how ASPIRE supports the students who come after you.',
  },
  post_rotation_evaluation: {
    subjectBase: 'Share Your ASPIRE Rotation Feedback',
    cta: 'Share Feedback',
    lead: 'We recently asked for your feedback on your ASPIRE rotation, and we have not received it yet.',
    ask: 'Your feedback tells us what worked on your unit and what did not. It is read by the people who plan the next cohort, and it is most useful while the rotation is still fresh in your mind.',
  },
  student_preceptor_eval: {
    subjectBase: 'Share Feedback on Your Preceptor and Unit',
    cta: 'Share Your Feedback',
    lead: 'We recently asked you to share feedback on your preceptor and your unit, and that form is still open.',
    ask: 'Your feedback helps us recognize preceptors who taught well and improve placements that did not go as planned. It takes just a few minutes.',
  },
  preceptor_progress: {
    subjectBase: 'Student Readiness Feedback Requested',
    cta: 'Provide Feedback',
    lead: 'We recently asked for your assessment of the ASPIRE student you precepted, and it has not come through yet.',
    ask: 'Your assessment is the clearest picture we get of how a student is progressing at the bedside, and it directly informs the support they receive.',
  },
});

/** The one sentence allowed to mention a certificate, per gate. */
const CERTIFICATE_SENTENCE = Object.freeze({
  [CERTIFICATE_KINDS.STUDENT_COMPLETION]:
    'Completing this survey also unlocks your ASPIRE Certificate of Completion.',
  [CERTIFICATE_KINDS.PRECEPTOR_APPRECIATION]:
    'Completing this assessment also unlocks your ASPIRE Certificate of Appreciation.',
});

/**
 * Build one reminder email.
 *
 * @param {object} o
 * @param {string} o.workflowKey        key from REMINDER_WORKFLOWS
 * @param {number} o.reminderNumber     1 | 2 | 3
 * @param {string} [o.recipientName]    full name of the person being emailed
 * @param {string} [o.studentName]      subject student (preceptor workflow only)
 * @param {string} o.surveyUrl          tokenized survey URL (#t= fragment)
 * @param {string} [o.expiresAtHuman]   formatted close date
 * @param {string|null} [o.certificateKind] a CERTIFICATE_KINDS value, or null
 * @returns {{subject: string, html: string}}
 */
export function buildEvaluationReminderEmail({
  workflowKey,
  reminderNumber,
  recipientName,
  studentName,
  surveyUrl,
  expiresAtHuman,
  certificateKind = null,
} = {}) {
  const copy = WORKFLOW_COPY[workflowKey];
  if (!copy) throw new Error(`unknown reminder workflow: ${workflowKey}`);

  const isFinal = Number(reminderNumber) >= FINAL_REMINDER_NUMBER;
  const first = firstNameOf(recipientName);
  const greeting = first ? `Hi ${escapeHtml(first)},` : 'Hello,';

  // The preceptor workflow names the student it is about; the others do not.
  const aboutStudent = (workflowKey === 'preceptor_progress' && studentName)
    ? ` for ${escapeHtml(studentName)}`
    : '';

  const subject = isFinal
    ? `Final reminder: ${copy.subjectBase}${aboutStudent ? ` for ${String(studentName).trim()}` : ''}`
    : `Reminder: ${copy.subjectBase}${aboutStudent ? ` for ${String(studentName).trim()}` : ''}`;

  const preheader = isFinal
    ? 'This is the last reminder before the survey closes.'
    : 'A quick reminder that this survey is still open.';

  const certificateLine = certificateKind && CERTIFICATE_SENTENCE[certificateKind]
    ? `<p style="margin:0 0 16px;">${CERTIFICATE_SENTENCE[certificateKind]}</p>`
    : '';

  const closingLine = expiresAtHuman
    ? (isFinal
      ? `<p style="margin:0 0 16px;"><strong>This survey closes on ${escapeHtml(expiresAtHuman)}</strong>, and this is the last reminder we will send.</p>`
      : `<p style="margin:0 0 16px;">The survey closes on ${escapeHtml(expiresAtHuman)}.</p>`)
    : (isFinal
      ? '<p style="margin:0 0 16px;"><strong>This is the last reminder we will send.</strong></p>'
      : '');

  const linkNote = expiresAtHuman
    ? renderEmailNote({
        body: `This link is unique to you. Please do not share it. It will expire on ${escapeHtml(expiresAtHuman)}.`,
        tone: 'info',
      })
    : renderEmailNote({ body: 'This link is unique to you. Please do not share it.', tone: 'info' });

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>

<p style="margin:0 0 16px;">${copy.lead}${aboutStudent ? ` This one is${aboutStudent}.` : ''}</p>

<p style="margin:0 0 16px;">${copy.ask}</p>

${certificateLine}

<!-- CTA button: TOKENIZED server-generated link; trustedUrl:true preserves it verbatim. -->
${renderEmailButton({ label: copy.cta, url: surveyUrl, variant: 'navy', trustedUrl: true })}

<p style="margin:0 0 16px;font-size:13px;color:#666;">
  Or copy this link into your browser:<br>
  <a href="${surveyUrl}" style="color:${NAVY};word-break:break-all;">${surveyUrl}</a>
</p>

${closingLine}

${linkNote}

<p style="margin:0 0 16px;">If you have already completed it, thank you, and please disregard this note.</p>

${aspireHandwrittenSignature('Kind regards,')}
`;

  return { subject, html: aspireEmailShell({ body, preheader }) };
}

/** Workflow keys this module can render. Used by the preview fixture and its coverage test. */
export const REMINDER_TEMPLATE_KEYS = Object.freeze(Object.keys(WORKFLOW_COPY));
