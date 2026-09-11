// lib/server/email/preceptorFeedbackDecisionEmail.js
//
// RESIDENCY-PORTAL-2c: the email a Talent Acquisition requester receives when
// the ASPIRE team approves, declines, or withdraws their request to view one
// applicant's preceptor feedback. Wording approved by the Owner, 2026-09-11.
// The feedback itself is NEVER in the email; only the portal shows it.
//
// PURE: builds subject, html, and text. No sends, no db.
import { aspireEmailShell, aspireSystemSignature } from './aspireShell.js'
import { renderEmailButton, escapeHtml } from './emailPrimitives.js'

export const SUPPORT_EMAIL = 'aspire@cshs.org'
const NIGHTFALL = '#1d2567'
const P = 'margin:0 0 16px;'

export const DECISION_EMAIL_KINDS = Object.freeze(['approved', 'declined', 'revoked'])

function subjectFor(decision, alumnus) {
  if (decision === 'approved') return `Preceptor feedback approved: ${alumnus}`
  if (decision === 'declined') return `Preceptor feedback request: ${alumnus}`
  return `Access to preceptor feedback ended: ${alumnus}`
}

// Returns null for an unknown decision, so a caller can never send a blank email.
export function preceptorFeedbackDecisionEmail({ decision, requesterFirstName, alumnusName, note, link } = {}) {
  if (!DECISION_EMAIL_KINDS.includes(decision)) return null
  const first = String(requesterFirstName || '').trim() || 'there'
  const alumnus = String(alumnusName || '').trim() || 'this applicant'
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : null
  const a = `<strong>${escapeHtml(alumnus)}</strong>`
  const support = `<a href="mailto:${SUPPORT_EMAIL}" style="color:${NIGHTFALL};">${SUPPORT_EMAIL}</a>`
  const noteHtml = cleanNote ? `<p style="${P}">Note from the ASPIRE team: ${escapeHtml(cleanNote)}</p>` : ''
  const noteText = cleanNote ? `Note from the ASPIRE team: ${cleanNote}` : null

  let html
  let text
  if (decision === 'approved') {
    html = `
<p style="${P}font-size:16px;">Hello ${escapeHtml(first)},</p>
<p style="${P}">Your request to view the preceptor feedback for ${a} has been approved. You can open it from their profile in the ASPIRE Residency Portal.</p>
${renderEmailButton({ label: 'View Feedback', url: link, variant: 'navy', trustedUrl: true })}
${noteHtml}
<p style="${P}">This feedback is shared with you only, for this applicant only. Each time you open it, the ASPIRE team can see that you did. Please keep it within the portal and do not forward or copy it.</p>
<p style="${P}">Questions? Email us at ${support}.</p>`
    text = [
      `Hello ${first},`,
      `Your request to view the preceptor feedback for ${alumnus} has been approved. You can open it from their profile in the ASPIRE Residency Portal.`,
      `View Feedback: ${link}`,
      noteText,
      'This feedback is shared with you only, for this applicant only. Each time you open it, the ASPIRE team can see that you did. Please keep it within the portal and do not forward or copy it.',
      `Questions? Email us at ${SUPPORT_EMAIL}.`,
    ]
  } else if (decision === 'declined') {
    html = `
<p style="${P}font-size:16px;">Hello ${escapeHtml(first)},</p>
<p style="${P}">Your request to view the preceptor feedback for ${a} was not approved at this time.</p>
${noteHtml}
<p style="${P}">If you would like to talk it through, email us at ${support}. You can also submit a new request from their profile in the ASPIRE Residency Portal.</p>`
    text = [
      `Hello ${first},`,
      `Your request to view the preceptor feedback for ${alumnus} was not approved at this time.`,
      noteText,
      `If you would like to talk it through, email us at ${SUPPORT_EMAIL}. You can also submit a new request from their profile in the ASPIRE Residency Portal.`,
    ]
  } else {
    html = `
<p style="${P}font-size:16px;">Hello ${escapeHtml(first)},</p>
<p style="${P}">Your access to the preceptor feedback for ${a} has ended, and it is no longer visible to you in the ASPIRE Residency Portal.</p>
${noteHtml}
<p style="${P}">If you need it again, you can submit a new request from their profile.</p>`
    text = [
      `Hello ${first},`,
      `Your access to the preceptor feedback for ${alumnus} has ended, and it is no longer visible to you in the ASPIRE Residency Portal.`,
      noteText,
      'If you need it again, you can submit a new request from their profile.',
    ]
  }

  const subject = subjectFor(decision, alumnus)
  return {
    subject,
    html: aspireEmailShell({ body: `${html}\n${aspireSystemSignature('Kind regards,')}`, preheader: escapeHtml(subject) }),
    text: [...text.filter(Boolean), '', 'Kind regards,', 'Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN'].join('\n\n'),
  }
}
