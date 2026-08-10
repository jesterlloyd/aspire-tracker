// lib/server/email/portalInvitation.js
//
// ASPIRE-STUDENT-PORTAL: branded portal invitation email, ROLE AWARE. Wraps the
// approved ASPIRE email shell (Cedars-Sinai + ASPIRE header/footer). The caller
// generates a Supabase activation link server-side (admin.generateLink) and
// passes it in here; the raw link is embedded ONLY in the email HTML and is
// never logged or returned to the browser.
//
// The link lands on /auth/activate, where the recipient CREATES A PASSWORD before
// reaching any portal. The copy says so, because an invitation that promises
// access and then silently leaves the account without a password is how someone
// gets locked out at their first sign-out.
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

// ROLE-AWARE INVITATION COPY.
//
// One invitation system, one shell, one sender. Only the words change per role.
// This exists because the invitation was previously hardcoded to Student Portal
// copy, so a Unit Leader was told to "track your clinical hours" and "log shifts",
// which is both wrong and confusing about what the account is for.
//
// The UNKNOWN-ROLE FALLBACK is deliberately generic rather than the student copy.
// Defaulting an unrecognized role to student wording is exactly the defect being
// fixed here: it would silently reintroduce it for any role added later.
const ROLE_COPY = {
  student: {
    subject: PORTAL_INVITE_SUBJECT,
    portalName: 'ASPIRE Student Portal',
    intro: 'your personal home for your Cedars-Sinai clinical rotation. From the portal you can view your placement, track your clinical hours, log shifts, and see your next steps in the ASPIRE pathway.',
  },
  unit_leader: {
    subject: 'You’re invited to the ASPIRE Unit Leader Portal',
    portalName: 'ASPIRE Unit Leader Portal',
    intro: 'your view of ASPIRE activity on your assigned units. From the portal you can review placement requests, submit unit capacity, see the students placed with you, nominate preceptors, message the ASPIRE team, and report a concern.',
  },
  academic_partner: {
    subject: 'You’re invited to the ASPIRE Academic Partner Portal',
    portalName: 'ASPIRE Academic Partner Portal',
    intro: 'your view of your school’s students in the ASPIRE pathway at Cedars-Sinai. From the portal you can follow your students’ rotation progress and stay in step with the ASPIRE team.',
  },
}

const FALLBACK_COPY = {
  subject: 'You’re invited to the ASPIRE Portal',
  portalName: 'ASPIRE Portal',
  intro: 'your access to the ASPIRE program at Cedars-Sinai. Once you activate your account you will see everything your access includes.',
}

/** The copy block for a portal role, falling back to neutral wording. */
export function inviteCopyForRole(role) {
  return ROLE_COPY[role] || FALLBACK_COPY
}

// Build the branded invitation. `activationLink` is the ASPIRE activation link,
// which lands on /auth/activate where the recipient creates a password.
// `expiresAt` (ISO) is shown when available. `role` selects the copy block.
export function portalInvitationEmail({ firstName, activationLink, expiresAt, role } = {}) {
  const copy = inviteCopyForRole(role)
  const name = esc(firstName) || 'there'
  const link = String(activationLink || '')
  const expiryText = fmtExpiry(expiresAt)
  // PORTAL-ACTIVATION-RELIABILITY-1: the activation LINK's short, single-use
  // lifetime and the PORTAL ACCESS expiration are different things. The old
  // copy presented the months-away grant date as the activation deadline, so
  // recipients reasonably waited past the link's real lifetime and hit the
  // expired screen. The link lifetime now gets its own plain sentence, and the
  // grant date (when available) is described as portal access, never as the
  // activation deadline.
  // Link lifetime matches the CONFIRMED Supabase Email OTP expiration
  // (3600 seconds, verified in the production dashboard 2026-08-03 and
  // re-confirmed as the canonical value 2026-08-10). The TTL is a Supabase
  // Auth project setting (mailer_otp_exp) - nothing in this repository sets
  // it - so this sentence must be re-verified against the dashboard before it
  // is ever changed. Wording refreshed 2026-08-10; the stated duration,
  // single-use semantics and supersession behavior are unchanged.
  const linkLifetimeLine = `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Your activation link is valid for 1 hour and can be used once. If it expires, request a new link from the activation page or use Forgot Password on the sign-in page. When a new link is issued, earlier activation links stop working, so always use the most recent email.</p>`
  const accessLine = expiryText
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Your portal access itself is available through <strong>${esc(expiryText)}</strong>.</p>`
    : ''
  const expiryLine = `${linkLifetimeLine}${accessLine}`

  const body = `
<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>
<p style="margin:0 0 16px;">You have been invited to the <strong>${esc(copy.portalName)}</strong>, ${copy.intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
  <tr><td style="border-radius:9px;background:${NIGHTFALL};">
    <a href="${link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9px;font-family:'DM Sans',Helvetica,Arial,sans-serif;">Activate My Account</a>
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
    subject: copy.subject,
    html: aspireEmailShell({ body, preheader: `Activate your ${copy.portalName} access and create your password.` }),
    supportEmail: SUPPORT_EMAIL,
  }
}
