// lib/server/email/portalInvitation.js
//
// ASPIRE-STUDENT-PORTAL: branded Student Portal invitation email. Wraps the
// approved ASPIRE email shell (Cedars-Sinai + ASPIRE header/footer). The caller
// generates a Supabase activation link server-side (admin.generateLink) and
// passes it in here; the raw link is embedded ONLY in the email HTML and is
// never logged or returned to the browser.
//
// PURE PRESENTATIONAL: builds { subject, html }. No sends, no DB, no logging.

import { aspireEmailShell, aspireSystemSignature } from './aspireShell.js'
import { appUrl } from '../appUrl.js'

const NIGHTFALL = '#1d2567'
const RAVEN = '#191919'
const SUPPORT_EMAIL = 'aspire@cshs.org'
const PUBLIC_SITE = appUrl('/')

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Format the CALENDAR date of an ISO timestamp without timezone drift (parse the
// YYYY-MM-DD portion as a local date so "...T00:00:00Z" never rolls back a day).
function fmtExpiry(iso) {
  const s = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export const PORTAL_INVITE_SUBJECT = 'You’re invited to the ASPIRE Student Portal'

// Build the branded invitation. `activationLink` is the Supabase-hosted
// acceptance/password-setup link. `expiresAt` (ISO) is shown when available.
export function portalInvitationEmail({ firstName, activationLink, expiresAt } = {}) {
  const name = esc(firstName) || 'there'
  const link = String(activationLink || '')
  const expiryText = fmtExpiry(expiresAt)
  const expiryLine = expiryText
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">This invitation is time-limited. Please activate your access by <strong>${esc(expiryText)}</strong>.</p>`
    : ''

  const body = `
<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>
<p style="margin:0 0 16px;">You have been invited to the <strong>ASPIRE Student Portal</strong>, your personal home for your Cedars-Sinai clinical rotation. From the portal you can view your placement, track your clinical hours, log shifts, and see your next steps in the ASPIRE pathway.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
  <tr><td style="border-radius:9px;background:${NIGHTFALL};">
    <a href="${link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9px;font-family:'DM Sans',Helvetica,Arial,sans-serif;">Activate My Portal Access</a>
  </td></tr>
</table>
${expiryLine}
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:<br /><span style="word-break:break-all;color:${NIGHTFALL};">${esc(link)}</span></p>
<p style="margin:0 0 16px;padding:12px 14px;background:#f4f1ec;border-radius:9px;font-size:13px;color:${RAVEN};">For your security, this invitation is intended only for you. Please do not forward it. If you did not expect this invitation, you can ignore this email.</p>
<p style="margin:0 0 4px;font-size:13px;">Questions or need help? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${NIGHTFALL};">${SUPPORT_EMAIL}</a>.</p>
<p style="margin:0 0 4px;font-size:13px;">Learn more about ASPIRE: <a href="${PUBLIC_SITE}" style="color:${NIGHTFALL};">${esc(PUBLIC_SITE)}</a></p>
${aspireSystemSignature('Warm regards,')}
`
  return {
    subject: PORTAL_INVITE_SUBJECT,
    html: aspireEmailShell({ body, preheader: 'Activate your ASPIRE Student Portal access.' }),
    supportEmail: SUPPORT_EMAIL,
  }
}
