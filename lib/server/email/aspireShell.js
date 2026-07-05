// lib/server/email/aspireShell.js
//
// Shared ASPIRE email shell for AUTOMATED / SYSTEM emails (EMAIL-BRAND-REFRESH Phase 2B).
// Implements the approved Phase 1 / 1A design so operational templates can migrate onto one shell:
//   - Nightfall (#1d2567) header: Cedars-Sinai logo left, bold "ASPIRE" + acronym meaning right.
//   - No red accent bar. White content card on a Sand (#f4f1ec) background. Raven (#191919) text.
//   - Nightfall footer: white Cedars-Sinai mark + identity lines + a no-reply contact line.
// Outlook-safe: table layout, inline CSS, ~620px, fully readable if images are blocked.
//
// PURE PRESENTATIONAL: no sends, tokens, DB, or logging. Callers pass the body HTML (including any
// template-specific content/signature). System emails use a TYPED signature only (no handwritten
// image - that stays scoped to ASPIRE Connect manual messages).

import { appUrl } from '../appUrl.js';

const NIGHTFALL = '#1d2567';
const SAND      = '#f4f1ec';
const RAVEN     = '#191919';
const CS_RED    = '#dc1e34';

// Email logo assets served from the app's public/ folder, addressed via the
// canonical domain (both domains serve the same deployment). See lib/server/appUrl.js.
const LOGO_URL = appUrl('/cs-logo-large.png');
const MARK_URL = appUrl('/cs-logo-white-mark.png');

export const ASPIRE_NOREPLY_LINE =
  'Please do not reply to this automated email. For questions, email Jester at jesterlloyd.bautista@cshs.org.';

// Branded shell. `body` is trusted pre-built HTML; `preheader` is plain text (hidden inbox preview).
// `footerNote` is the small last footer line (EMAIL-SHELL-CONSOLIDATE-1): it defaults to the no-reply
// line used by automated/system emails, so existing callers are byte-identical. ASPIRE Connect manual
// messages - which are reply-able - pass their own confidentiality note instead.
export function aspireEmailShell({ body = '', preheader = '', footerNote = ASPIRE_NOREPLY_LINE } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASPIRE</title></head>
<body style="margin:0;padding:0;background:${SAND};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${RAVEN};">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0"
  style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

<!-- Header: Nightfall, Cedars-Sinai logo left (institutional anchor), ASPIRE wordmark + meaning right -->
<tr><td style="background:${NIGHTFALL};padding:14px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td align="left" style="vertical-align:middle;">
      <img src="${LOGO_URL}" alt="Cedars-Sinai" width="140" height="62"
           style="display:block;width:140px;max-width:140px;height:auto;border:0;" />
    </td>
    <td align="right" style="vertical-align:middle;text-align:right;">
      <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1.5px;line-height:1.1;font-family:'DM Sans',Helvetica,Arial,sans-serif;">ASPIRE</div>
      <div style="color:rgba(255,255,255,0.72);font-size:9px;font-weight:400;letter-spacing:0.2px;line-height:1.3;margin-top:5px;">Affiliate Students&rsquo; Pathway from Internship to Residency Experience</div>
    </td>
  </tr></table>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px 30px;font-size:15px;line-height:1.6;color:${RAVEN};">${body}</td></tr>

<!-- Footer: Nightfall, white Cedars-Sinai mark + identity + no-reply line -->
<tr><td style="background:${NIGHTFALL};padding:18px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td width="54" style="vertical-align:top;padding-right:14px;">
      <img src="${MARK_URL}" alt="Cedars-Sinai" width="40" height="40"
           style="display:block;width:40px;height:40px;border:0;" />
    </td>
    <td style="vertical-align:top;">
      <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;line-height:1.5;">ASPIRE &bull; Geri &amp; Richard Brawerman Nursing Institute</p>
      <p style="margin:3px 0 0;color:rgba(255,255,255,0.82);font-size:11px;line-height:1.5;">Cedars-Sinai Medical Center &bull; 8700 Beverly Blvd, Los Angeles, CA 90048</p>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.6);font-size:10px;line-height:1.55;">${footerNote}</p>
    </td>
  </tr></table>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// Typed system signature for automated ASPIRE emails (no handwritten image). Jester is the single
// system sender for these. Name in Cedars-Sinai Red; role/institute/contact beneath. Reused by 2B
// templates so the closing stays consistent.
export function aspireSystemSignature(closing = 'Kind regards,') {
  return `
<p style="margin:24px 0 6px;font-size:14px;color:${RAVEN};">${closing}</p>
<p style="margin:0;font-size:14px;color:${RAVEN};line-height:1.6;">
  <strong style="color:${CS_RED};">Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN</strong>
  <span style="display:block;">Nursing Professional Development Practitioner</span>
  <span style="display:block;">Geri &amp; Richard Brawerman Nursing Institute</span>
  <span style="display:block;margin-top:2px;"><a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NIGHTFALL};text-decoration:none;">jesterlloyd.bautista@cshs.org</a> | Office: 310-248-8964</span>
</p>`;
}
