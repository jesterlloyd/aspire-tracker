// lib/server/certificates/unlockPreceptorCertificate.js
//
// PRECEPTOR-CERT-1 - the ONE unlock-and-notify path, shared by the immediate
// post-submission unlock (api/evaluation-preceptor-submit.js) and the
// Owner/Admin reconciliation backstop. Everything here is deliberately
// NON-FATAL to its caller: a certificate hiccup must never fail a preceptor's
// accepted survey submission - reconciliation exists precisely to recover.
//
// Sequence:
//   1. issue_preceptor_certificate(assignment_id) - atomic + idempotent in the
//      database (the RPC returns the existing certificate on re-invocation).
//   2. CLAIM the notification: UPDATE ... SET notified_at = now() WHERE id = X
//      AND notified_at IS NULL. Exactly one caller can win the claim, so the
//      certificate-ready email sends AT MOST ONCE no matter how many unlock
//      attempts race (submit retry, reconciliation sweep, double-click).
//   3. Send the email; on send failure, RELEASE the claim (notified_at back to
//      NULL) so reconciliation retries later.
//   4. Log to notification_log (no token, no URL persisted).
//
// The download link is the preceptor's own tokenized assessment page: the
// caller passes the raw token it already holds (the submit endpoint has the
// just-used token in hand; reconciliation mints a fresh one). Raw tokens are
// never stored - only embedded in the outbound email, exactly like the
// invitation itself.

import { Resend } from 'resend';
import { buildPreceptorCertificateEmail } from '../evaluation/preceptorCertificateEmail.js';
import { archiveSentMessage } from '../../../api/lib/messageArchive.js';

// Same sender identity as every other evaluation email (see preceptorSend.js).
const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

/**
 * @param {object} o
 * @param {object} o.supabaseAdmin - service-role client
 * @param {string} o.assignmentId  - completed EOR preceptor_progress assignment
 * @param {string} o.downloadUrl   - tokenized page URL for the email CTA
 * @param {string} o.source        - notification_log metadata marker
 * @param {string} [o.logPrefix]
 * @returns {{ status: 'issued'|'already_issued'|'refused'|'error',
 *             certificate_number?: string, notified?: boolean, reason?: string }}
 */
export async function unlockPreceptorCertificate({
  supabaseAdmin, assignmentId, downloadUrl, source, logPrefix = '[preceptor-cert]',
}) {
  // 1. Issue (idempotent; the RPC enforces every eligibility rule).
  let issue;
  try {
    const { data, error } = await supabaseAdmin.rpc('issue_preceptor_certificate', {
      p_assignment_id: assignmentId,
    });
    if (error) throw new Error(error.message);
    issue = data;
  } catch (e) {
    console.error(`${logPrefix} issue_failed:`, { assignment_id: assignmentId, error: e.message });
    return { status: 'error', reason: 'issue_failed' };
  }

  if (issue.status !== 'issued' && issue.status !== 'already_issued') {
    // Eligibility refusals (not_completed, wrong instrument/timepoint, missing
    // canonical respondent, ...) are surfaced, never retried into existence.
    return { status: 'refused', reason: issue.status };
  }

  const certId = issue.certificate_id;
  const certificateNumber = issue.certificate_number;

  // 2. Claim the notification. Zero rows updated = someone else already
  //    notified (or is mid-send) - done, and definitively not a duplicate.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('preceptor_certificates')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', certId)
    .is('notified_at', null)
    .select('id, preceptor_id');
  if (claimErr || !claimed || claimed.length === 0) {
    return { status: issue.status, certificate_number: certificateNumber, notified: false };
  }

  // 3. Send. The recipient is the CERTIFIED preceptor's canonical record.
  let sendOk = false;
  try {
    const { data: prec } = await supabaseAdmin
      .from('preceptors')
      .select('full_name, email')
      .eq('id', claimed[0].preceptor_id)
      .single();
    const email = (prec?.email || '').trim();
    if (!email) throw new Error('preceptor_email_missing');

    const firstName = (prec?.full_name || '').trim().split(/\s+/)[0] || '';
    const { subject, html } = buildPreceptorCertificateEmail({
      preceptorFirstName: firstName, certificateNumber, downloadUrl,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data: emailData, error: emailErr } = await resend.emails.send({
      from: FROM, to: [email], reply_to: REPLY_TO, subject, html,
    });
    if (emailErr) throw new Error(emailErr.message || 'send_failed');
    sendOk = true;

    // 4. Audit log - the download URL and token are NOT persisted.
    let notificationLogId = null;
    try {
      const { data: logRow } = await supabaseAdmin.from('notification_log').insert({
        notification_type: 'preceptor_certificate_ready',
        audience:          'preceptor',
        recipient_email:   email,
        recipient_name:    prec?.full_name || null,
        recipient_role:    'Preceptor',
        recipient_type:    'preceptor',
        subject,
        status:            'sent',
        resend_email_id:   emailData?.id || null,
        sent_at:           new Date().toISOString(),
        metadata: {
          certificate_id: certId,
          certificate_number: certificateNumber,
          assignment_id: assignmentId,
          source,
        },
      }).select('id').single();
      notificationLogId = logRow?.id || null;
    } catch (logErr) {
      console.error(`${logPrefix} log_write_failed:`, { certificate_id: certId, error: logErr.message });
    }

    if (notificationLogId) {
      await archiveSentMessage({
        db: supabaseAdmin,
        notificationLogId,
        contentKind: 'secure_link_email',
        html,
        bodyFormat: 'html',
        source: 'preceptor_certificate_ready',
        templateKey: 'preceptor_certificate_ready',
        templateVersion: 1,
      });
    }
  } catch (e) {
    console.error(`${logPrefix} notify_failed:`, { certificate_id: certId, error: e.message });
    // Release the claim so reconciliation retries; best effort.
    try {
      await supabaseAdmin.from('preceptor_certificates')
        .update({ notified_at: null }).eq('id', certId);
    } catch { /* reconciliation will still find it via manual review */ }
  }

  return { status: issue.status, certificate_number: certificateNumber, notified: sendOk };
}
