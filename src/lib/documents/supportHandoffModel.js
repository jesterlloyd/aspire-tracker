// src/lib/documents/supportHandoffModel.js
//
// SUPPORT-OUTREACH-1 (résumé review build, Phase 4): what Residency > Documents hands to
// ASPIRE Connect > Outreach. Pure, so Documents, Outreach and the tests read one shape.
// The launch context carries only what the composer needs to open a draft; the server
// verifies every claim in it again before anything is sent.
import { LAUNCH_KINDS } from '../connect/launchContext.js'
import { composeDraft } from './resumeReviewModel.js'
import { displayName } from '../utils.js'
import { appUrl } from '../appUrl.js'

const first = s => s?.preferred_first_name || s?.first_name || ''

// Where the composer opens: the student is in the URL, so a refresh keeps the recipient.
export const outreachHandoffPath = studentId =>
  `/connect/outreach?launch=1&mode=message&recipientType=student&recipientId=${encodeURIComponent(studentId)}`

// The message for a résumé review: the draft as it reads in the review (score sentence and
// bullets as chosen), signed only "Warmly," because Outreach adds the sender's own signature.
export function resumeReviewHandoff({ review, student, cycle, version, includeScore, includeBullets, subject, body }) {
  return {
    kind: LAUNCH_KINDS.SUPPORT_HANDOFF,
    cycleId: cycle?.id || null,
    cycleName: cycle?.name || '',
    templateKey: 'support_resume_review',
    source: 'residency_documents',
    returnPath: '/ngrp/support/before',
    support: {
      kind: 'resume_review', resumeReviewId: review.id, studentId: student.id,
      studentName: displayName(student), firstName: first(student),
    },
    draft: {
      subject: subject ?? review.draft_subject ?? 'Feedback on your résumé',
      body: composeDraft({
        body: body ?? review.draft_body ?? '', score: review.score, readiness: review.readiness,
        includeScore, bullets: review.full_report?.rewritten_bullets || [], includeBullets, sender: {},
        // RESUME-FEEDBACK-1: sending shares their full feedback in the portal, so the email says where.
        portalUrl: appUrl('/portal/residency'),
      }),
    },
    documents: version ? [{ versionId: version.id, fileName: version.file_name }] : [],
  }
}

// A request for one application document. It never logs support.
export function documentRequestHandoff({ type, student, cycle }) {
  const name = first(student) || 'there'
  const what = type.label
  const qualifier = type.qualifier ? ` (${type.qualifier.toLowerCase()})` : ''
  return {
    kind: LAUNCH_KINDS.SUPPORT_HANDOFF,
    cycleId: cycle?.id || null,
    cycleName: cycle?.name || '',
    templateKey: 'support_document_request',
    source: 'residency_documents',
    returnPath: '/ngrp/profiles',
    support: {
      kind: 'document_request', docType: type.key, docLabel: what, studentId: student.id,
      studentName: displayName(student), firstName: first(student),
    },
    draft: {
      subject: `Your ${what} for the residency application`,
      body: [
        `Hi ${name},`,
        `Could you send me your ${what}${qualifier}? It is part of your New Graduate RN Residency Program application file, and I will add it to your record as soon as it arrives.`,
        'You can reply to this email with it attached.',
        'Thank you,',
      ].join('\n\n'),
    },
    documents: [],
  }
}

// The chip and the note the composer shows while the handoff applies.
export function handoffChip(support) {
  if (!support) return null
  if (support.kind === 'resume_review') {
    return {
      label: `Support · Résumé Review · ${support.studentName}`,
      note: `When you send, ${support.firstName || 'this alumnus'} is logged as supported for Résumé Review on the send date. Copying the text does not log it.`,
    }
  }
  return {
    label: `Request · ${support.docLabel} · ${support.studentName}`,
    note: 'A document request. Sending it does not log support.',
  }
}

// What the send carries for the server to verify. Never trusted there.
export function supportRefFor(launch) {
  const s = launch?.support
  if (!s || !launch.cycleId) return null
  return s.kind === 'resume_review'
    ? { kind: 'resume_review', cycle_id: launch.cycleId, resume_review_id: s.resumeReviewId }
    : { kind: 'document_request', cycle_id: launch.cycleId, doc_type: s.docType }
}

// "Sent to Maya. Résumé Review logged for Oct 5."
export function sentMessage({ support, supportEntry, fallback }) {
  if (!support || support.kind !== 'resume_review') return fallback
  const who = support.firstName || support.studentName || 'the alumnus'
  if (!supportEntry?.logged) return `Sent to ${who}. Résumé Review could not be logged automatically; tell the Owner so it can be added.`
  const [y, m, d] = String(supportEntry.occurred_on).split('-').map(Number)
  const day = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return supportEntry.already_recorded
    ? `Sent to ${who}. Résumé Review was already logged for ${day}.`
    : `Sent to ${who}. Résumé Review logged for ${day}.`
}
