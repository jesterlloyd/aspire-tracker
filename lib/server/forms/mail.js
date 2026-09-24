// lib/server/forms/mail.js
//
// FORMS-PHASE3: the emails a form sends, on the shared ASPIRE shell. Each builder returns
// { subject, html }; the engine sends through createMailer(), so the demo recipient guard
// applies (DEMO-DATA-2). Every recipient's link differs, so these are not Outreach bulk mail.

import { aspireEmailShell } from '../email/aspireShell.js'
import { escapeHtml, renderEmailButton, renderEmailNote } from '../email/emailPrimitives.js'

const FROM_ADDRESS = 'noreply@aspire-program.com'
export const fromLine = (senderName) => `${String(senderName || 'ASPIRE').replace(/[<>"]/g, '')} via ASPIRE Intelligence <${FROM_ADDRESS}>`

const P = (text) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#1f2330;white-space:pre-wrap;">${escapeHtml(text)}</p>`
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'
export const mergeFirstName = (text, name) => String(text || '').replace(/\{\s*first\s+name\s*\}/gi, firstName(name))
const dueWords = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' }) : ''

export function invitationEmail({ assignment, title, url, reminder = false }) {
  const base = assignment.subject || title
  const subject = reminder ? `Reminder: ${base}` : base
  const due = dueWords(assignment.due_at)
  const body = [
    P(mergeFirstName(assignment.message || `Hi {first name},\n\nPlease complete the ${title}. The answers ASPIRE already has are filled in for you.\n\nThank you.`, assignment.name)),
    renderEmailButton({ label: 'Open the form', url, trustedUrl: true }),
    due ? P(`Please complete it by ${due}.`) : '',
    renderEmailNote({ title: 'This link is only for you', body: `This link is only for ${assignment.email}. Do not forward it: anyone with the link can answer as you.`, tone: 'info' }),
  ].join('')
  return { subject, html: aspireEmailShell({ body, preheader: `${assignment.sender_name || 'ASPIRE'} sent you ${title}.` }) }
}

export function submittedNoticeEmail({ assignment, title, url }) {
  return {
    subject: `Submitted: ${title} (${assignment.name})`,
    html: aspireEmailShell({ body: [
      P(`${assignment.name} submitted ${title}.`),
      url ? renderEmailButton({ label: 'Open the responses', url, trustedUrl: true }) : '',
    ].join('') }),
  }
}
