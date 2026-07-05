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

const UNSAFE_URL_MARKERS = /\?|token|magic|survey|resume|headshot|packet|signature|expires|access_token|refresh_token|jwt/i;

export function redactArchiveHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';
  return html
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
