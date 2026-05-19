// src/lib/notifications/templates/unitFormReceived.js
// Two audience variants:
//   submitter     → confirmation to unit leader who submitted the form
//   internal_team → alert to Jester + Krystal with full response summary

import { JESTER_SIGNATURE } from './signatures.js';
import { getGreetingName } from '../greetings.js';

const CS_RED   = '#930045';
const SAND     = '#F4F1EC';
const RAVEN    = '#191919';
const SAGE_BG  = '#C8D5C0';
const SAGE_TXT = '#2D4A2B';

function wrap(content, preheader) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASPIRE Program</title></head>
<body style="margin:0;padding:0;background:${SAND};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${RAVEN};">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
<tr><td style="background:${CS_RED};padding:20px 28px;">
<div style="color:#ffffff;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">ASPIRE Program</div>
<div style="color:#ffffff;font-size:11px;opacity:0.85;margin-top:2px;">Cedars-Sinai Medical Center</div>
</td></tr>
<tr><td style="padding:32px 28px;font-size:15px;line-height:1.6;color:${RAVEN};">${content}</td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#666;line-height:1.5;border-top:1px solid #eee;padding-top:16px;">
This is an automated notification from the ASPIRE Program tracking system. Replies go directly to Jester.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function signatureHtml() {
  return `
<p style="margin-top:24px;">
  ${JESTER_SIGNATURE.fullName}<br>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.title}</span><br>
  <span style="color:#475467;font-size:13px;">${JESTER_SIGNATURE.affiliation}</span>
</p>`;
}

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
<p style="margin:0 0 16px;">Thank you for being part of the ASPIRE pipeline. Your preceptors and unit play a meaningful role in shaping the next generation of Cedars-Sinai nurses.</p>`
    : `${greeting}
<p style="margin:0 0 16px;">Thank you for taking the time to respond on behalf of ${unitName} for the <strong>${cohortName}</strong> cohort. We've recorded that the unit is unable to host this round, and we appreciate the honest response so we can plan accordingly.</p>
<p style="margin:0 0 16px;">"No" is a valid and respected answer. Unit capacity, staffing realities, and preceptor availability ebb and flow, and forcing placements when a unit isn't positioned to support students well doesn't serve anyone.</p>
<p style="margin:0 0 16px;">If circumstances change before the submission deadline, you can return to the form and update your response.</p>
<p style="margin:0 0 16px;">Thank you for the partnership.</p>`;

  return body + signatureHtml();
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
<p style="margin:0 0 12px;font-size:13px;color:#666;">View in app: <a href="https://aspire-tracker.vercel.app" style="color:${CS_RED};">ASPIRE Intelligence</a></p>`;
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
    return { subject, html: wrap(buildConfirmationHtml({ ...ctx, isHosting }), preheader) };
  },

  internal_team: (ctx) => {
    const isHosting = (ctx.slotsOffered || 0) > 0;
    const subject = isHosting
      ? `Unit response: ${ctx.unitName} → ${ctx.slotsOffered} slot${ctx.slotsOffered === 1 ? '' : 's'} (${ctx.cohortName})`
      : `Unit response: ${ctx.unitName} → not hosting (${ctx.cohortName})`;
    const preheader = `${ctx.submitterName || ctx.submitterEmail} submitted on behalf of ${ctx.unitName}`;
    return { subject, html: wrap(buildInternalAlertHtml({ ...ctx, isHosting }), preheader) };
  },
};
