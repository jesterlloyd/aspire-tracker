// lib/server/signatures/mail.js
//
// SIGNATURES-PHASE2: every email the signing engine sends, on the shared ASPIRE shell.
// Each builder returns { subject, html } and the engine sends it through createMailer(),
// so the demo recipient guard applies (DEMO-DATA-2).
//
// Invitations come "from {Sender} via ASPIRE Intelligence" (brief section 5.1) and say the
// link is only for this address. Signature requests are transactional, one person, one
// link: they are not Outreach bulk mail (every recipient's link differs), and they are
// never Messages.

import { aspireEmailShell } from '../email/aspireShell.js'
import { escapeHtml, renderEmailButton, renderEmailNote, renderEmailDetailsCard } from '../email/emailPrimitives.js'

const FROM_ADDRESS = 'noreply@aspire-program.com'
export const fromLine = (senderName) => `${String(senderName || 'ASPIRE').replace(/[<>"]/g, '')} via ASPIRE Intelligence <${FROM_ADDRESS}>`

const P = (text) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#1f2330;white-space:pre-wrap;">${escapeHtml(text)}</p>`
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'
const merge = (text, name) => String(text || '').replace(/\{\s*first\s+name\s*\}/gi, firstName(name))

export function invitationEmail({ request, signer, url, reminder = false }) {
  const subject = reminder ? `Reminder: ${request.subject || `Please sign: ${request.title}`}` : (request.subject || `Please sign: ${request.title}`)
  const body = [
    P(merge(request.message || `Hi {first name},\n\nPlease review and sign ${request.title}.`, signer.name)),
    renderEmailButton({ label: signer.recipient_type === 'viewer' ? 'Review document' : 'Review document', url, trustedUrl: true }),
    renderEmailNote({ title: 'This link is only for you', body: `This link is only for ${signer.email}. Do not forward it. You will be asked for a one-time code sent to this address.`, tone: 'info' }),
    request.expires_at ? P(`This request expires on ${new Date(request.expires_at).toUTCString().slice(0, 16)}.`) : '',
  ].join('')
  return { subject, html: aspireEmailShell({ body, preheader: `${request.sender_name || 'ASPIRE'} sent you ${request.title} to sign.` }) }
}

export function staffTurnEmail({ request, signer, url }) {
  return {
    subject: `Your signature: ${request.title}`,
    html: aspireEmailShell({ body: [
      P(`Hi ${firstName(signer.name)},\n\n${request.title} is waiting for your signature in ASPIRE Intelligence.`),
      renderEmailButton({ label: 'Sign in ASPIRE', url, trustedUrl: true }),
      P('You will confirm it is you with your ASPIRE password before signing.'),
    ].join('') }),
  }
}

export function codeEmail({ request, code, ttlMinutes }) {
  return {
    subject: `Your code for ${request.title}: ${code}`,
    html: aspireEmailShell({ body: [
      P(`Your one-time code to open ${request.title} is:`),
      `<p style="margin:6px 0 16px;font-size:30px;letter-spacing:8px;font-weight:700;color:#1D2567;font-family:Menlo,Consolas,monospace;">${escapeHtml(code)}</p>`,
      P(`It expires in ${ttlMinutes} minutes. If you did not ask for it, you can ignore this email.`),
    ].join(''), preheader: `Your code: ${code}` }),
  }
}

export function completedEmail({ request, recipientName, sealedSha256 }) {
  return {
    subject: `Completed: ${request.title}`,
    html: aspireEmailShell({ body: [
      P(`Hi ${firstName(recipientName)},\n\nEveryone has signed ${request.title}. The sealed copy is attached, with its certificate of completion on the last pages.`),
      renderEmailDetailsCard({ title: 'Sealed copy', rows: [
        { label: 'Envelope', value: request.envelope_code },
        { label: 'SHA-256', value: sealedSha256 },
      ] }),
      P('Keep this email: the attached PDF is your copy. Any change to it after sealing makes its digital seal show as invalid in a PDF reader.'),
    ].join('') }),
  }
}

export function voidedEmail({ request, recipientName, reason }) {
  return {
    subject: `Cancelled: ${request.title}`,
    html: aspireEmailShell({ body: [
      P(`Hi ${firstName(recipientName)},\n\n${request.sender_name || 'The sender'} cancelled the request to sign ${request.title}. Its link no longer works.`),
      reason ? renderEmailNote({ title: 'Reason', body: reason, tone: 'info' }) : '',
    ].join('') }),
  }
}

export function senderNoticeEmail({ request, headline, detail, url }) {
  return {
    subject: `${headline}: ${request.title}`,
    html: aspireEmailShell({ body: [
      P(`${headline}.`),
      detail ? renderEmailNote({ title: 'Details', body: detail, tone: 'info' }) : '',
      url ? renderEmailButton({ label: 'Open Signature requests', url, trustedUrl: true }) : '',
    ].join('') }),
  }
}
