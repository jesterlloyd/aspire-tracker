// src/lib/signatures/draft.js
//
// SIGNATURES-PHASE2: the shape of a Prepare and send draft, shared by the wizard and the
// Signatures page (which builds drafts from templates and from Correct and resend).
import { colorForIndex } from './sigModel'

export const blankRecipient = (i) => ({ roleKey: `r${i + 1}`, name: '', email: '', type: 'signer', color: colorForIndex(i) })

export function emptyDraft() {
  return {
    source: 'pdf', templateId: null, title: '', documentType: 'acknowledgment', excludedConfirmed: false,
    documentPath: null, sha256: null, pageSizes: [], recipients: [blankRecipient(0)], ordered: true, fields: [],
    senderValues: {}, subject: '', message: 'Hi {first name},\n\nPlease review and sign this document.\n\nThank you.',
    reminderRule: 'every_3_days', expiresDays: 30, saveTemplate: false,
  }
}

/** A role key no recipient in the list already has. */
export function nextRoleKey(recipients) {
  const taken = new Set((recipients || []).map(r => r.roleKey))
  let n = (recipients || []).length + 1
  while (taken.has(`r${n}`)) n++
  return `r${n}`
}
