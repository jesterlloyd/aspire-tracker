// src/lib/notifications/templates/accessRetirement.js
//
// COHORT-ACCESS-RETIREMENT-1: the notice sent to Nursing Academics when a
// cohort is marked Completed, listing the students whose Hybrid Student Nurse
// CS-Link access is ready to be retired.
//
// Built on the shared ASPIRE system shell (lib/server/email/aspireShell.js),
// like every automated ASPIRE email. The table carries name, school, and
// ASPIRE status only - no emails, no phone numbers, no record identifiers.

import { escapeHtml } from '../../htmlEscape.js';
import { aspireEmailShell, aspireSystemSignature } from '../../../../lib/server/email/aspireShell.js';

const NAVY = '#1D2567';

export function buildAccessRetirementEmail({ cohortName, students = [], recipientName } = {}) {
  const cohort = escapeHtml(String(cohortName || 'ASPIRE cohort').trim());
  const greeting = escapeHtml(String(recipientName || '').trim().split(/\s+/)[0] || 'there');
  const count = students.length;

  const subject = count > 0
    ? `ASPIRE: CS-Link access retirement - ${String(cohortName || 'cohort').trim()} (${count} student${count === 1 ? '' : 's'})`
    : `ASPIRE: ${String(cohortName || 'cohort').trim()} completed - no CS-Link accesses to retire`;

  const preheader = count > 0
    ? `${count} Hybrid Student Nurse CS-Link access${count === 1 ? '' : 'es'} ready to retire for ${cohort}.`
    : `${cohort} is complete; no CS-Link accesses remain to retire.`;

  const rows = students.map(s => `
<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #e8e8ef;font-size:13.5px;">${escapeHtml(s.name)}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e8e8ef;font-size:13.5px;">${escapeHtml(s.school)}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e8e8ef;font-size:13.5px;">${escapeHtml(s.status)}</td>
</tr>`).join('');

  const table = count > 0 ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8ef;border-radius:8px;border-collapse:separate;overflow:hidden;margin:0 0 16px;">
<tr>
  <th align="left" style="padding:9px 12px;background:${NAVY};color:#ffffff;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;">Student</th>
  <th align="left" style="padding:9px 12px;background:${NAVY};color:#ffffff;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;">School</th>
  <th align="left" style="padding:9px 12px;background:${NAVY};color:#ffffff;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;">ASPIRE status</th>
</tr>
${rows}
</table>` : '';

  const lead = count > 0
    ? `The <strong>${cohort}</strong> cohort has been marked completed in ASPIRE. The following ${count === 1 ? 'student' : `${count} students`} still hold${count === 1 ? 's' : ''} Hybrid Student Nurse CS-Link access that is ready to be retired:`
    : `The <strong>${cohort}</strong> cohort has been marked completed in ASPIRE. No students in this cohort currently hold Hybrid Student Nurse CS-Link access, so there is nothing to retire.`;

  const body = `
<p style="margin:0 0 16px;font-size:16px;font-weight:600;">Hi ${greeting},</p>
<p style="margin:0 0 16px;">${lead}</p>
${table}
${count > 0 ? '<p style="margin:0 0 16px;">Students still on an active rotation are not listed; they keep their access until their rotation ends.</p>' : ''}
${aspireSystemSignature('Kind regards,')}
`.trim();

  return { subject, preheader, html: aspireEmailShell({ body, preheader }) };
}

export const accessRetirement = {
  internal_team: (ctx) => buildAccessRetirementEmail(ctx),
  default: (ctx) => buildAccessRetirementEmail(ctx),
};
