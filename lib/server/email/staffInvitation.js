// lib/server/email/staffInvitation.js
//
// STAFF-INVITE-CONTACTS-1: branded ASPIRE staff invitation, the staff
// counterpart of portalInvitation.js. Same approved shell, same sender, and the
// SAME scanner-safe activation contract released in
// PORTAL-ACTIVATION-RELIABILITY-1: the caller passes an ASPIRE-owned activation
// URL built from the token HASH (never the Supabase /auth/v1/verify link, which
// is consumed on GET by email-security scanners), and the recipient creates a
// password at /auth/activate before reaching the application.
//
// The link lifetime sentence is imported from lib/server/activationLifetime.js,
// which is the single place the duration is stated to a human and which carries
// the provenance and configuration history of the figure. It is worded
// identically to the portal invitation on purpose: one rule, one sentence.
// Staff access itself has no expiration, so this
// template deliberately carries NO access-expiry line: staff authorization is
// role + is_active, with no time dimension to describe.
//
// PURE PRESENTATIONAL: builds { subject, html }. No sends, no DB, no logging.

import { aspireEmailShell, aspireSystemSignature } from './aspireShell.js'
import { appUrl } from '../appUrl.js'
import { ACTIVATION_LIFETIME_SENTENCE } from '../activationLifetime.js'

const NIGHTFALL = '#1d2567'
const RAVEN = '#191919'
const SUPPORT_EMAIL = 'aspire@cshs.org'
const PUBLIC_SITE = appUrl('/')

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const STAFF_INVITE_SUBJECT = 'You’re invited to ASPIRE Intelligence'

// Role-aware description of what the account can reach. Unknown roles fall back
// to neutral wording rather than the broadest role's copy.
const ROLE_COPY = {
  admin:         'full operational access to ASPIRE Intelligence, including students, placements, interviews, evaluations, and communication.',
  'co-lead':     'placement and student management in ASPIRE Intelligence.',
  'co_lead':     'placement and student management in ASPIRE Intelligence.',
  interviewer:   'the interview and rubric areas of ASPIRE Intelligence.',
  viewer:        'read-only access to the ASPIRE Intelligence dashboard.',
}
const FALLBACK_ROLE_COPY = 'the areas of ASPIRE Intelligence allowed by your assigned role.'

export function staffRoleCopy(role) {
  return ROLE_COPY[role] || FALLBACK_ROLE_COPY
}

/**
 * @param {object}  opts
 * @param {string}  opts.firstName       recipient's first name (optional)
 * @param {string}  opts.activationLink  ASPIRE-owned /auth/activate?token_hash=... URL
 * @param {string}  opts.role            staff role key
 */
export function staffInvitationEmail({ firstName, activationLink, role } = {}) {
  const name = esc(firstName) || 'there'
  const link = String(activationLink || '')

  const body = `
<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>
<p style="margin:0 0 16px;">You have been invited to <strong>ASPIRE Intelligence</strong>, the workspace the ASPIRE team uses to manage the student-to-residency pathway at Cedars-Sinai. Your account gives you ${esc(staffRoleCopy(role))}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
  <tr><td style="border-radius:9px;background:${NIGHTFALL};">
    <a href="${link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9px;font-family:'DM Sans',Helvetica,Arial,sans-serif;">Activate My Account</a>
  </td></tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">${ACTIVATION_LIFETIME_SENTENCE}</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:<br /><span style="word-break:break-all;color:${NIGHTFALL};">${esc(link)}</span></p>
<p style="margin:0 0 16px;padding:12px 14px;background:#f4f1ec;border-radius:9px;font-size:13px;color:${RAVEN};">For your security, this invitation is intended only for you. Please do not forward it. If you did not expect this invitation, you can ignore this email.</p>
<p style="margin:0 0 4px;font-size:13px;">Questions or need help? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${NIGHTFALL};">${SUPPORT_EMAIL}</a>.</p>
<p style="margin:0 0 4px;font-size:13px;">Learn more about ASPIRE: <a href="${PUBLIC_SITE}" style="color:${NIGHTFALL};">${esc(PUBLIC_SITE)}</a></p>
${aspireSystemSignature('Warm regards,')}
`
  return {
    subject: STAFF_INVITE_SUBJECT,
    html: aspireEmailShell({ body, preheader: 'Activate your ASPIRE Intelligence account and create your password.' }),
    supportEmail: SUPPORT_EMAIL,
  }
}
