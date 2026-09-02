// api/lib/bulkRecipientAllowlist.js
//
// BULK-EXACT-RECIPIENTS-1 (P0): the server-side exact-recipient allowlist.
//
// THE INCIDENT THIS EXISTS FOR: a production bulk send reached 12 recipients
// when exactly 6 were reviewed. The server never expanded the audience - the
// extra recipients arrived in the client payload from stale selection state.
// This module is the server floor that makes the reviewed list the ONLY list:
// every entry is resolved and verified BEFORE the first provider call, and an
// entry that cannot be proven to be an intentional, current, owned recipient
// never reaches the provider.
//
// Contract:
//   • The allowlist is exactly the entries passed in. Nothing here queries by
//     school, cohort, status, category, or any prior send - there is no code
//     path that can ADD a recipient. Output length <= input length, always.
//   • Ownership: a student/contact entry sends only to an email the database
//     row actually owns right now (stale or forged emails are rejected).
//   • 'Not Proceeding' students are rejected unless the entry carries an
//     explicit status_ack: true - set by the client only after the Review
//     screen displayed its warning for that specific student.
//   • Duplicates resolve deterministically: first valid occurrence of a
//     normalized email wins; later ones are rejected as 'duplicate' (the same
//     rule the client's dedupe shows the operator).
//   • Within-batch idempotency: an email already logged sent under this
//     batch_id is rejected ('already_sent_in_batch') so a replayed request
//     cannot double-send.
//
// Pure orchestration over an injected db client - no Resend import, no env
// access - so the guard is testable with a substituted database and the
// negative control (removing the guard) is provable.

import { isValidEmail } from '../../src/lib/notifications/studentRecipient.js';
import { normalizeEmailForLookup } from '../../src/lib/emailUtils.js';

export const NOT_PROCEEDING_STATUS = 'Not Proceeding';
export const ALLOWED_SOURCES = new Set(['student', 'contact', 'manual']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_PATTERN.test(v);

/**
 * Resolve the ENTIRE reviewed allowlist before any provider call.
 *
 * @param {object} args
 * @param {object} args.db          Supabase-style client (service role)
 * @param {Array}  args.recipients  the client payload entries, in review order
 * @param {string} args.batchId     the batch UUID (for idempotency lookups)
 * @returns {Promise<{cleared: Array, rejected: Array}>}
 *   cleared:  [{ index, source, rawEmail, normEmail, recipientId, recipientName,
 *               emailSource, firstName, school }]
 *   rejected: [{ index, source, email, reason }]
 */
export async function validateBulkRecipients({ db, recipients, batchId }) {
  const cleared  = [];
  const rejected = [];
  const seenNorm = new Set();

  for (let index = 0; index < recipients.length; index++) {
    const r = recipients[index] || {};
    const source = r.source;
    const rawEmail  = String(r.email || '').trim();
    const normEmail = normalizeEmailForLookup(rawEmail);
    const label = { index, source: source || null, email: rawEmail || null };

    // Shape + email validity - malformed entries never reach the provider.
    if (!ALLOWED_SOURCES.has(source)) { rejected.push({ ...label, reason: 'invalid_source' }); continue; }
    if (!rawEmail)                    { rejected.push({ ...label, reason: 'missing_email' }); continue; }
    if (!isValidEmail(rawEmail))      { rejected.push({ ...label, reason: 'invalid_email' }); continue; }

    // Deterministic duplicate rule: first valid occurrence wins.
    if (seenNorm.has(normEmail)) { rejected.push({ ...label, reason: 'duplicate' }); continue; }

    // Ownership + status verification against the CURRENT database row.
    let emailSource   = null;   // students only: 'school' | 'personal'
    let recipientId   = null;
    let recipientName = String(r.name || '').trim() || null;

    if (source === 'student') {
      if (!isUuid(r.studentId)) { rejected.push({ ...label, reason: 'invalid_student_id' }); continue; }
      const { data: student, error: sErr } = await db
        .from('students')
        .select('id, first_name, preferred_first_name, last_name, personal_email, school_email, status')
        .eq('id', r.studentId)
        .single();
      if (sErr || !student) { rejected.push({ ...label, reason: 'student_not_found' }); continue; }
      emailSource = r.emailType === 'personal' ? 'personal' : 'school';
      const ownedEmail = emailSource === 'personal' ? student.personal_email : student.school_email;
      if (!ownedEmail || normalizeEmailForLookup(String(ownedEmail).trim()) !== normEmail) {
        rejected.push({ ...label, reason: 'email_mismatch' }); continue;
      }
      // A 'Not Proceeding' student is out of scope for bulk sending unless the
      // operator explicitly acknowledged THIS student on the Review screen.
      if (String(student.status || '') === NOT_PROCEEDING_STATUS && r.status_ack !== true) {
        rejected.push({ ...label, reason: 'not_proceeding_not_acknowledged' }); continue;
      }
      recipientId = student.id;
      recipientName = recipientName || `${student.first_name || ''} ${student.last_name || ''}`.trim() || null;

    } else if (source === 'contact') {
      if (!isUuid(r.contactId)) { rejected.push({ ...label, reason: 'invalid_contact_id' }); continue; }
      const { data: contact, error: cErr } = await db
        .from('contacts')
        .select('id, full_name, email, is_active')
        .eq('id', r.contactId)
        .single();
      if (cErr || !contact) { rejected.push({ ...label, reason: 'contact_not_found' }); continue; }
      if (contact.is_active === false) { rejected.push({ ...label, reason: 'contact_inactive' }); continue; }
      if (!contact.email || normalizeEmailForLookup(String(contact.email).trim()) !== normEmail) {
        rejected.push({ ...label, reason: 'email_mismatch' }); continue;
      }
      recipientId = contact.id;
      recipientName = recipientName || contact.full_name || null;
    }
    // source === 'manual': no id, no ownership row; email validity already proven.

    // Within-batch idempotency (replay/double-submit protection).
    const { data: dup } = await db
      .from('notification_log')
      .select('id')
      .eq('notification_type', 'bulk_message_sent')
      .filter('metadata->>batch_id', 'eq', batchId)
      .filter('metadata->>recipient_email_norm', 'eq', normEmail)
      .limit(1);
    if (dup && dup.length > 0) { rejected.push({ ...label, reason: 'already_sent_in_batch' }); continue; }

    seenNorm.add(normEmail);
    cleared.push({
      index, source, rawEmail, normEmail, recipientId, recipientName, emailSource,
      firstName: String(r.firstName || '').trim() || null,
      school:    String(r.school || '').trim() || null,
    });
  }

  return { cleared, rejected };
}
