// api/lib/messageArchive.js
//
// CONNECT-SENT-HISTORY Phase 2B - shared redaction + archive write for MANUAL/DIRECT Outreach emails.
//
// redactArchiveHtml: conservative, regex-only sanitization (no heavy deps). Operates on markup and
// attribute VALUES - never on visible text (a visible signature block stays; only a URL/attribute
// containing "signature" is neutralized). The primary safety layer at render time is the read-side
// sandboxed iframe (sandbox="", no scripts); this redaction is defense in depth + keeps tokens/
// secure links out of storage entirely.
//
// archiveManualMessage: best-effort insert into public.message_archive (service-role). Never throws -
// returns a status the caller surfaces as archive_status without ever failing an already-sent email.

import { appUrl } from '../../src/lib/appUrl.js';
import { buildSecureLinkSnapshot } from './secureLinkSnapshot.js';

// ARCHIVE-SNAPSHOT-1: the five kinds the widened CHECK permits. The writer is
// the last place this is enforced before the database, so an unknown kind is
// refused here rather than allowed to become a constraint violation.
export const ARCHIVE_CONTENT_KINDS = Object.freeze([
  'manual_direct_email',
  'manual_bulk_email',
  'coordinator_weekly_digest',
  'template_notification',
  'secure_link_email',
]);

const UNSAFE_URL_MARKERS = /\?|token|magic|survey|resume|headshot|packet|signature|expires|access_token|refresh_token|jwt/i;

// The handwritten signature image is a PUBLIC, non-sensitive ASPIRE brand asset
// (/signature-jester.gif). Its filename contains "signature", which the generic redaction
// treats as a secure-URL keyword and neutralizes to "#", so the signature renders as a broken
// image in Sent History previews. restoreTrustedSignatureImg re-points ONLY the signature image
// (identified by its fixed alt text) to the canonical public asset. It hard-sets one known static
// image and DISCARDS whatever src was present, so it never restores a tokenized or secure URL, and
// a spoofed <img alt="Jester Lloyd Bautista"> can only ever resolve to this benign brand asset.
const SIGNATURE_ASSET_URL = appUrl('/signature-jester.gif');
const SIGNATURE_ALT = /\balt\s*=\s*["']Jester Lloyd Bautista["']/i;

function restoreTrustedSignatureImg(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!SIGNATURE_ALT.test(tag)) return tag;
    if (/\ssrc\s*=\s*"[^"]*"/i.test(tag)) return tag.replace(/\ssrc\s*=\s*"[^"]*"/i, ` src="${SIGNATURE_ASSET_URL}"`);
    if (/\ssrc\s*=\s*'[^']*'/i.test(tag)) return tag.replace(/\ssrc\s*=\s*'[^']*'/i, ` src="${SIGNATURE_ASSET_URL}"`);
    // No src attribute present: inject the trusted one.
    return tag.replace(/^<img\b/i, `<img src="${SIGNATURE_ASSET_URL}"`);
  });
}

export function redactArchiveHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';
  const redacted = html
    // Strip risky tags AND their contents.
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, '')
    // Strip any self-closing / unclosed risky tags too (defensive).
    .replace(/<(script|style|iframe|object|embed|form)\b[^>]*\/?>/gi, '')
    // Strip inline event-handler attributes (on*="..." / on*='...').
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    // Neutralize href/src whose value carries a query string or any secure/token marker.
    .replace(/\s(href|src)\s*=\s*"([^"]*)"/gi, (m, attr, url) => (UNSAFE_URL_MARKERS.test(url) ? ` ${attr}="#"` : m))
    .replace(/\s(href|src)\s*=\s*'([^']*)'/gi, (m, attr, url) => (UNSAFE_URL_MARKERS.test(url) ? ` ${attr}='#'` : m));
  // Defense in depth stays intact above; re-point only the known public signature asset.
  return restoreTrustedSignatureImg(redacted);
}

// Best-effort archive write. Returns:
//   { status: 'archived' }                - row inserted (or already present)
//   { status: 'skipped',  reason }        - nothing to store (no id / empty redaction)
//   { status: 'failed',   reason }        - insert errored or threw (sanitized; never exposes raw error)
export async function archiveManualMessage({ db, notificationLogId, html, bodyFormat, createdBy }) {
  return archiveSentMessage({
    db, notificationLogId, html, bodyFormat, createdBy,
    contentKind: 'manual_direct_email', source: 'connect_send_direct_email',
  });
}

/**
 * ARCHIVE-SNAPSHOT-1: the general sent-time snapshot writer.
 *
 * The caller passes the EXACT payload it handed the provider - never a body
 * rebuilt afterwards from mutable records, which is the whole point of an
 * immutable snapshot.
 *
 * Best-effort by contract. It never throws and never signals anything the caller
 * could mistake for a send failure: archiving is bookkeeping that happens after
 * delivery, so a storage problem must not resend, re-target, duplicate, or
 * change eligibility. Callers surface the returned status as archive_status.
 *
 * secure_link_email goes through the redaction gate and is SKIPPED unless the
 * snapshot is provably secret-free.
 *
 * @param {string} o.contentKind    one of ARCHIVE_CONTENT_KINDS
 * @param {string} o.html           the html handed to the provider
 * @param {string} [o.text]         the text alternative handed to the provider
 * @param {string} [o.templateKey]  stored in metadata, not a column
 * @param {number|string} [o.templateVersion]
 */
export async function archiveSentMessage({
  db, notificationLogId, contentKind, html, text, bodyFormat, createdBy,
  source, templateKey, templateVersion,
}) {
  if (!notificationLogId) return { status: 'skipped', reason: 'no_notification_log_id' };
  if (!ARCHIVE_CONTENT_KINDS.includes(contentKind)) {
    return { status: 'skipped', reason: 'unknown_content_kind' };
  }

  let redacted;
  let redactionVersion = 1;
  let redactedText = typeof text === 'string' && text.trim() !== '' ? text : null;

  if (contentKind === 'secure_link_email') {
    // FAIL CLOSED ON STORAGE: no proof, no row. Delivery already happened.
    const snap = buildSecureLinkSnapshot({ html, text });
    if (!snap.safe) return { status: 'skipped', reason: `secure_link_${snap.reason}` };
    redacted = redactArchiveHtml(snap.html || '');
    redactedText = snap.text;
    redactionVersion = snap.redactionVersion;
  } else {
    redacted = redactArchiveHtml(html);
  }

  if ((!redacted || redacted.trim() === '') && !redactedText) {
    // Empty redaction would violate chk_message_archive_has_body - skip rather than insert.
    return { status: 'skipped', reason: 'empty_after_redaction' };
  }

  try {
    const { error } = await db
      .from('message_archive')
      .upsert(
        {
          notification_log_id: notificationLogId,
          content_kind:        contentKind,
          html_redacted:       redacted && redacted.trim() !== '' ? redacted : null,
          text_redacted:       redactedText,
          redaction_version:   redactionVersion,
          created_by:          createdBy || null,
          // Template identity lives in metadata, NOT in new columns: the jsonb
          // column already exists with an object CHECK and already carries
          // per-write keys. Subject, recipient, resend id and sent_at are all a
          // join away on notification_log and are deliberately not copied here.
          metadata: {
            source:           source || 'unknown',
            body_format:      bodyFormat || null,
            template_key:     templateKey || null,
            template_version: templateVersion != null ? String(templateVersion) : null,
          },
        },
        { onConflict: 'notification_log_id', ignoreDuplicates: true },
      );
    if (error) {
      console.error('[messageArchive] insert failed:', error.message);
      return { status: 'failed', reason: 'insert_error' };
    }
    return { status: 'archived' };
  } catch (e) {
    console.error('[messageArchive] insert threw:', e?.message);
    return { status: 'failed', reason: 'insert_exception' };
  }
}
