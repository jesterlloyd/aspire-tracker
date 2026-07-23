import { aspireEmailShell, aspireSystemSignature, ASPIRE_NOREPLY_LINE } from '../email/aspireShell.js';
import { renderEmailDetailsCard, renderEmailHeading, renderEmailNote } from '../email/emailPrimitives.js';

function labelType(type) {
  return type === 'bug' ? 'Bug report' : 'Feedback';
}

function rowsForSubmission(submission) {
  return [
    { label: 'Submission ID', value: submission.id },
    { label: 'Type', value: labelType(submission.submission_type) },
    { label: 'Reporter', value: [submission.reporter_display_name, submission.reporter_email].filter(Boolean).join(' <') + (submission.reporter_email ? '>' : '') },
    { label: 'Role', value: submission.portal_role },
    { label: 'Portal', value: submission.portal_type },
    { label: 'Route', value: submission.pathname },
    { label: 'Section', value: submission.section },
    { label: 'Build', value: submission.build_sha },
    { label: 'Environment', value: submission.environment },
    { label: 'Submitted', value: submission.created_at },
  ];
}

function textBlock(title, value) {
  if (!value) return '';
  return renderEmailNote({ title, body: value, tone: 'info' });
}

export function buildPortalFeedbackEmail(submission = {}) {
  const typeLabel = labelType(submission.submission_type);
  const subject = `ASPIRE Portal ${typeLabel}: ${submission.portal_role || 'portal user'}`;

  const body = [
    renderEmailHeading({ level: 2, text: `New portal ${typeLabel.toLowerCase()}` }),
    renderEmailDetailsCard({ title: 'Submission details', rows: rowsForSubmission(submission) }),
    textBlock('Message', submission.message),
    textBlock('Expected behavior', submission.expected_behavior),
    textBlock('Actual behavior', submission.actual_behavior),
    textBlock('Reproduction steps', submission.reproduction_steps),
    aspireSystemSignature('Thank you,'),
  ].filter(Boolean).join('\n');

  const html = aspireEmailShell({
    body,
    preheader: `New ASPIRE Portal ${typeLabel.toLowerCase()} submitted.`,
    footerNote: ASPIRE_NOREPLY_LINE,
  });

  const textLines = [
    `New ASPIRE Portal ${typeLabel}`,
    '',
    ...rowsForSubmission(submission).filter(row => row.value).map(row => `${row.label}: ${row.value}`),
    '',
    'Message:',
    submission.message || '',
    submission.expected_behavior ? `\nExpected behavior:\n${submission.expected_behavior}` : '',
    submission.actual_behavior ? `\nActual behavior:\n${submission.actual_behavior}` : '',
    submission.reproduction_steps ? `\nReproduction steps:\n${submission.reproduction_steps}` : '',
  ].filter(line => line !== null && line !== undefined);

  return {
    subject,
    html,
    text: textLines.join('\n'),
  };
}
