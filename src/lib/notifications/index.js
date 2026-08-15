// src/lib/notifications/index.js
// Server-side only - imported by API routes, never by frontend components.
// Requires RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY environment variables.

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { templates } from './templates/index.js';
import { resolveRecipients } from './recipients.js';
import { sharedSenderMayArchive } from '../../../api/lib/archiveClassification.js';
import { archiveSentMessage } from '../../../api/lib/messageArchive.js';

// ARCHIVE-SNAPSHOT-1: recorded in archive metadata so a stored body can be tied
// to the renderer that produced it. Bump when a template's shape changes.
const TEMPLATE_NOTIFICATION_VERSION = 1;

const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  return createClient(url, key);
}

function sanitizeContext(ctx) {
  const { resume_url, headshot_url, ...rest } = ctx || {};
  return rest;
}

export async function sendNotification(type, context = {}) {
  const templateGroup = templates[type];
  if (!templateGroup) {
    console.error(`[notifications] unknown type: ${type}`);
    return [];
  }

  let recipients;
  try {
    recipients = await resolveRecipients(type, context);
  } catch (err) {
    console.error(`[notifications] recipient resolution failed for ${type}:`, err);
    return [];
  }

  if (!recipients.length) {
    console.warn(`[notifications] no recipients resolved for ${type}`);
    return [];
  }

  const resend = getResend();
  const db     = getDb();
  const results = [];

  for (const recipient of recipients) {
    const tpl = templateGroup[recipient.audience] || templateGroup.default;
    if (!tpl) {
      console.warn(`[notifications] no template for ${type}/${recipient.audience}, skipping`);
      continue;
    }

    let subject, html;
    try {
      ({ subject, html } = tpl(context, recipient));
    } catch (err) {
      console.error(`[notifications] template render failed for ${type}/${recipient.audience}:`, err);
      continue;
    }

    let resendId    = null;
    let status      = 'sent';
    let errorMessage = null;

    try {
      const emailPayload = {
        from:     FROM,
        reply_to: REPLY_TO,
        to:       [recipient.email],
        subject,
        html,
        tags: [
          { name: 'type',     value: type },
          { name: 'audience', value: recipient.audience },
        ],
      };
      if (recipient.cc && recipient.cc.length > 0) {
        emailPayload.cc = recipient.cc.map(c => c.email ? `${c.name || ''} <${c.email}>`.trim() : c);
      }
      const { data, error } = await resend.emails.send(emailPayload);

      if (error) {
        status       = 'failed';
        errorMessage = error.message || JSON.stringify(error);
        console.error(`[notifications] ${type} send error to ${recipient.email}:`, error);
      } else {
        resendId = data?.id || null;
        console.log(`[notifications] ${type} sent to ${recipient.email}: ${resendId}`);
      }
    } catch (err) {
      status       = 'failed';
      errorMessage = err.message;
      console.error(`[notifications] ${type} threw for ${recipient.email}:`, err);
    }

    let notificationLogId = null;
    try {
      const { data: logRow } = await db.from('notification_log').insert({
        notification_type: type,
        audience:          recipient.audience,
        recipient_email:   recipient.email,
        recipient_role:    recipient.role  || null,
        recipient_name:    recipient.name  || null,
        // recipient_type reflects who actually RECEIVES this row, derived from the
        // per-recipient audience - NOT context.studentId, which here is the subject
        // student and is the same across every recipient of a notification. So
        // internal-team / coordinator / interviewer / submitter rows stay null even
        // when student_id is populated as the subject. (Phase B.2.B, Option B.)
        recipient_type:    recipient.audience === 'student' ? 'student' : null,
        student_id:        context.studentId || null,
        cohort_id:         context.cohortId  || null,
        subject,
        resend_email_id:   resendId,
        status,
        error_message:     errorMessage,
        metadata:          { context: sanitizeContext(context) },
      }).select('id').single();
      notificationLogId = logRow?.id || null;
    } catch (logErr) {
      console.error(`[notifications] log write failed for ${type}/${recipient.email}:`, logErr);
    }

    // ARCHIVE-SNAPSHOT-1 FAMILY 3B: snapshot ordinary template sends.
    //
    // Four conditions, all required. The registry is consulted rather than
    // defaulted, so a secure-link type (Family 4's gate), a specialised sender
    // that already archives, a retired type, or an unrecognised type all take
    // the false branch and write nothing - the shared path can never become a
    // generic catch-all that archives a token by accident.
    //
    // `subject`/`html` are the SAME bindings handed to resend.emails.send()
    // above; no builder is called again and nothing is re-queried, so the row
    // records this send rather than a later reconstruction.
    //
    // Best-effort: archiveSentMessage never throws and its result is recorded,
    // never acted on. A storage problem cannot re-send, retry, change `status`,
    // or alter what this function returns.
    if (status === 'sent' && notificationLogId && sharedSenderMayArchive(type)) {
      const archive = await archiveSentMessage({
        db,
        notificationLogId,
        contentKind: 'template_notification',
        html,
        bodyFormat: 'html',
        source: 'notifications_shared_sender',
        templateKey: type,
        templateVersion: TEMPLATE_NOTIFICATION_VERSION,
      });
      if (archive.status !== 'archived') {
        console.error(`[notifications] archive_not_stored for ${type}:`, {
          status: archive.status, reason: archive.reason,
        });
      }
    }

    results.push({
      recipient: recipient.email,
      audience:  recipient.audience,
      success:   status === 'sent',
      resendId,
      error:     errorMessage,
    });
  }

  return results;
}
