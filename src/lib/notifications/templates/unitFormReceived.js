// src/lib/notifications/templates/unitFormReceived.js
// Two audience variants:
//   submitter     -> confirmation to the unit leader who submitted the form
//   internal_team -> alert to Jester + Krystal with the full response summary
// EMAIL-BRAND-REFRESH Phase 2B-2: migrated onto the shared ASPIRE system shell
// (lib/server/email/aspireShell.js) — Nightfall header (ASPIRE wordmark + meaning), white card,
// Nightfall footer with the no-reply line. SYSTEM-DEFAULT-SIGNATURE-GIF-1: the submitter
// confirmation now uses Jester's handwritten GIF signature (system-default policy); the
// internal_team alert has no signature block and is unchanged.

import { getGreetingName } from '../greetings.js';
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js';
import { aspireHandwrittenSignature } from '../handwrittenSignature.js';
import { appUrl } from '../../appUrl.js';

const NAVY     = '#1d2567';
const SAND     = '#F4F1EC';
const RAVEN    = '#191919';
const SAGE_BG  = '#C8D5C0';
const SAGE_TXT = '#2D4A2B';

export function buildResponseSummaryHtml(ctx) {
  const lines = [];
  if (ctx.slotsOffered !== null && ctx.slotsOffered !== undefined) {
    lines.push(`<strong>Slots offered:</strong> ${ctx.slotsOffered}`);
  }
  if (ctx.reasonForZero) {
    lines.push(`<strong>Reason for zero:</strong> ${ctx.reasonForZero}`);
  }
  if (ctx.shiftPreference) {
    lines.push(`<strong>Shift preference:</strong> ${ctx.shiftPreference}`);
  }
  if (ctx.preferredPreceptors) {
    lines.push(`<strong>Preferred preceptors:</strong> ${ctx.preferredPreceptors}`);
  }
  if (ctx.hiringNgrp !== null && ctx.hiringNgrp !== undefined) {
    lines.push(`<strong>NGRP hiring this cohort:</strong> ${ctx.hiringNgrp ? 'Yes' : 'No'}`);
    if (!ctx.hiringNgrp && ctx.hiringNgrpReason) {
      lines.push(`&nbsp;&nbsp;<em>Reason:</em> ${ctx.hiringNgrpReason}`);
    }
  }
  if (ctx.hasFiredAlumni) {
    lines.push(`<strong>Hired ASPIRE alumni before:</strong> ${ctx.hasFiredAlumni}`);
    if (ctx.alumniOutcome) {
      lines.push(`&nbsp;&nbsp;<em>Outcome:</em> ${ctx.alumniOutcome}`);
    }
    if (ctx.alumniNotes) {
      lines.push(`&nbsp;&nbsp;<em>Notes:</em> ${ctx.alumniNotes}`);
    }
    if (ctx.wouldConsiderAlumni) {
      lines.push(`&nbsp;&nbsp;<em>Would consider in future:</em> ${ctx.wouldConsiderAlumni}`);
    }
  }
  if (ctx.considerations) {
    lines.push(`<strong>Considerations:</strong> ${ctx.considerations}`);
  }
  return lines.join('<br>');
}

function buildConfirmationHtml(ctx) {
  const { submitterName, unitName, isHosting, slotsOffered, cohortName } = ctx;
  const greetName = getGreetingName({ full_name: submitterName, preferred_name: ctx.submitterPreferredName });

  const greeting = `<p style="margin:0 0 16px;">Hi ${greetName},</p>`;
  const summaryBox = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;width:100%;background:${SAND};border-radius:8px;">
<tr><td style="padding:16px 20px;">
<div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Your Response</div>
<div style="font-size:15px;color:${RAVEN};">${isHosting ? `<strong>${slotsOffered}</strong> ${slotsOffered === 1 ? 'slot' : 'slots'} offered for ${unitName}` : `${unitName} not hosting this cohort`}</div>
</td></tr>
</table>`;

  const body = isHosting
    ? `${greeting}
<p style="margin:0 0 16px;">Thank you for confirming ${unitName}'s availability to host ASPIRE students for the <strong>${cohortName}</strong> cohort. We've recorded your response.</p>
${summaryBox}
<p style="margin:0 0 16px;">If anything changes before the submission deadline, you're welcome to return to the form and update your response. We'll work with the most recent submission.</p>
<p style="margin:0;">Thank you for hosting ASPIRE students. Your unit and preceptors make a real difference for these students.</p>`
    : `${greeting}
<p style="margin:0 0 16px;">Thank you for completing the ASPIRE unit availability form for the <strong>${cohortName}</strong> cohort. We've recorded that ${unitName} is unable to host this round.</p>
<p style="margin:0 0 16px;">A "no" is a valid and respected answer. Unit capacity, staffing, and preceptor availability change over time, and we would rather place students where a unit can fully support them.</p>
<p style="margin:0;">If circumstances change before the submission deadline, you can return to the form and update your response.</p>`;

  return body + aspireHandwrittenSignature('Kind regards,');
}

function buildInternalAlertHtml(ctx) {
  const { submitterName, submitterEmail, submitterRole, unitName, isHosting, slotsOffered, cohortName } = ctx;
  const responseSummary = buildResponseSummaryHtml(ctx);
  const statusBadge = isHosting
    ? `<span style="display:inline-block;background:${SAGE_BG};color:${SAGE_TXT};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Hosting &middot; ${slotsOffered} slot${slotsOffered === 1 ? '' : 's'}</span>`
    : `<span style="display:inline-block;background:#E8E8E8;color:#555;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Not hosting</span>`;

  return `
<p style="margin:0 0 8px;font-size:13px;color:#666;">${cohortName} &middot; Unit Response</p>
<h2 style="margin:0 0 16px;font-size:20px;color:${RAVEN};">${unitName} ${statusBadge}</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;background:${SAND};border-radius:8px;">
<tr><td style="padding:16px 20px;font-size:14px;line-height:1.7;">
<strong>Submitted by:</strong> ${submitterName || '(unknown)'} (${submitterRole || 'unknown role'})<br>
<strong>Email:</strong> ${submitterEmail || '(unknown)'}<br>
${responseSummary}
</td></tr>
</table>
<p style="margin:0 0 12px;font-size:13px;color:#666;">View in app: <a href="${appUrl()}" style="color:${NAVY};">ASPIRE Intelligence</a></p>`;
}

export const unitFormReceived = {
  submitter: (ctx) => {
    const isHosting = (ctx.slotsOffered || 0) > 0;
    const greetName = getGreetingName({ full_name: ctx.submitterName, preferred_name: ctx.submitterPreferredName });
    const subject = isHosting
      ? `Thank you, ${greetName}: ${ctx.unitName} response received for ${ctx.cohortName}`
      : `Response received: ${ctx.unitName} for ${ctx.cohortName}`;
    const preheader = isHosting
      ? `We've recorded ${ctx.slotsOffered} slot${ctx.slotsOffered === 1 ? '' : 's'} for ${ctx.unitName}.`
      : `We've received your response from ${ctx.unitName}. Your input matters.`;
    return { subject, html: aspireEmailShell({ body: buildConfirmationHtml({ ...ctx, isHosting }), preheader }) };
  },

  internal_team: (ctx) => {
    const isHosting = (ctx.slotsOffered || 0) > 0;
    const subject = isHosting
      ? `Unit response: ${ctx.unitName}, ${ctx.slotsOffered} slot${ctx.slotsOffered === 1 ? '' : 's'} (${ctx.cohortName})`
      : `Unit response: ${ctx.unitName}, not hosting (${ctx.cohortName})`;
    const preheader = `${ctx.submitterName || ctx.submitterEmail} submitted on behalf of ${ctx.unitName}`;
    return { subject, html: aspireEmailShell({ body: buildInternalAlertHtml({ ...ctx, isHosting }), preheader }) };
  },
};
