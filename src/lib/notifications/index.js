/* global process */
// src/lib/notifications/index.js
// Server-side only - imported by API routes, never by frontend components.
// Requires RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY environment variables.

import { createClient } from '@supabase/supabase-js';
import { templates } from './templates/index.js';
import { resolveRecipients } from './recipients.js';
import { sharedSenderMayArchive } from '../../../api/lib/archiveClassification.js';
import { archiveSentMessage } from '../../../api/lib/messageArchive.js';
import { createMailer } from '../../../lib/server/email/mailer.js';

// ARCHIVE-SNAPSHOT-1: recorded in archive metadata so a stored body can be tied
// to the renderer that produced it. Bump when a template's shape changes.
const TEMPLATE_NOTIFICATION_VERSION = 1;

async function loadOrganization(db) {
  try {
    const { data } = await db.from('organization_settings').select('display_name, general_email, address_line_1, address_line_2, city, state_province, postal_code, document_logo_path').order('created_at').limit(1).maybeSingle()
    if (!data) return null
    const url = data.document_logo_path ? db.storage.from('organization-branding').getPublicUrl(data.document_logo_path).data.publicUrl : null
    return { ...data, document_logo_url: url }
  } catch { return null }
}

function applyOrganizationBranding(html, organization) {
  if (!organization) return html
  const email = organization.general_email || 'aspire@cshs.org'
  const name = organization.display_name || 'Cedars-Sinai'
  const address = [organization.address_line_1, organization.address_line_2, organization.city, organization.state_province, organization.postal_code].filter(Boolean).join(', ')
  return String(html || '').replaceAll('jesterlloyd.bautista@cshs.org', email).replaceAll('JesterLloyd.Bautista@cshs.org', email).replaceAll('Email Jester at', 'Email us at').replaceAll('email Jester directly at', 'email us at').replaceAll('Cedars-Sinai Medical Center &bull; 8700 Beverly Blvd, Los Angeles, CA 90048', `${name}${address ? ` &bull; ${address}` : ''}`).replaceAll('https://aspire-program.com/cs-logo-large.png', organization.document_logo_url || 'https://aspire-program.com/cs-logo-large.png').replaceAll('https://aspire-program.com/cs-logo-white-mark.png', organization.document_logo_url || 'https://aspire-program.com/cs-logo-white-mark.png')
}

const FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

// DEMO-DATA-2 (2026-09-21): through the mailer, like every other send site. This one
// constructed Resend itself, so the demo recipient guard never saw the thirteen callers
// of sendNotification. The hourly clock-out sweep reaches the two seeded demo shifts
// (in progress since the seed) and handed their reminders straight to Resend.
// test/demoMailer.test.mjs now sweeps src/ as well as api/ and lib/.
function getResend() {
  return createMailer();
}

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  return createClient(url, key);
}

function sanitizeContext(ctx) {
  const rest = { ...(ctx || {}) };
  delete rest.resume_url;
  delete rest.headshot_url;
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
  const organization = await loadOrganization(db);
  const results = [];

  for (const recipient of recipients) {
    const tpl = templateGroup[recipient.audience] || templateGroup.default;
    if (!tpl) {
      console.warn(`[notifications] no template for ${type}/${recipient.audience}, skipping`);
      continue;
    }

    let subject, html;
    try {
      ({ subject, html } = tpl({ ...context, organization }, recipient));
      html = applyOrganizationBranding(html, organization || {});
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
