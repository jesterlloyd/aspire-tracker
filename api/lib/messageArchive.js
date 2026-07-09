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
  if (!notificationLogId) return { status: 'skipped', reason: 'no_notification_log_id' };

  const redacted = redactArchiveHtml(html);
  if (!redacted || redacted.trim() === '') {
    // Empty redaction would violate chk_message_archive_has_body - skip rather than insert.
    return { status: 'skipped', reason: 'empty_after_redaction' };
  }

  try {
    const { error } = await db
      .from('message_archive')
      .upsert(
        {
          notification_log_id: notificationLogId,
          content_kind:        'manual_direct_email',
          html_redacted:       redacted,
          text_redacted:       null,
          redaction_version:   1,
          created_by:          createdBy || null,
          metadata: {
            source:      'connect_send_direct_email',
            body_format: bodyFormat || null,
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
