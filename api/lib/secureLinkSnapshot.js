// api/lib/secureLinkSnapshot.js
//
// ARCHIVE-SNAPSHOT-1: the safety gate for archiving a secure-link email.
//
// Evaluation invitations, preceptor feedback requests and certificate-ready
// emails all carry a per-recipient secret in their URL. Their surrounding copy
// is worth keeping for Sent History, the secret is not - and "not" here means
// the archive must be provably free of it, not merely regex-scrubbed and hoped
// over.
//
// So this module works in two phases:
//
//   1. REDACT  - replace tokenized URLs and secret parameters irreversibly, in
//                every representation the same URL can take inside an email:
//                raw, HTML-attribute, HTML-entity-encoded, percent-encoded,
//                and bare in plain text.
//   2. VERIFY  - re-scan the OUTPUT for anything still secret-shaped. If the
//                scan finds anything, the snapshot is declared unsafe and the
//                caller SKIPS the archive write.
//
// FAIL CLOSED ON STORAGE, NEVER ON SENDING. A verification failure means "do not
// archive this body"; the email has already been sent and nothing about delivery
// changes. Callers must treat { safe: false } as skip-and-continue.
//
// The replacement is a fixed literal with no encoding of the original, so it is
// irreversible by construction: nothing about the token survives to be decoded.

/** What replaces a secret. Fixed, opaque, carries nothing from the original. */
export const REDACTED_URL = '[secure link removed]';
export const REDACTION_VERSION = 2;

// Query parameters whose VALUE is a secret regardless of shape.
const SECRET_PARAMS = [
  'token', 'access_token', 'refresh_token', 'auth_token', 'id_token',
  'code', 'otp', 'secret', 'signature', 'sig', 'key', 'apikey', 'api_key',
  'magic', 'magiclink', 'invite', 'invitation', 'reset', 'confirmation_token',
  'session', 'jwt', 'nonce', 'state', 'ticket', 'passcode',
];

// A run long enough to be a token rather than a word. Base64url / hex / uuid-ish.
const LONG_SECRET_RUN = /\b[A-Za-z0-9_-]{24,}\b/;
// JWTs survive shorter segment lengths, so they get their own shape.
const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/;

/** Decode the encodings an email body can hide a URL behind, for SCANNING only. */
function decodeForScan(s) {
  let out = String(s || '');
  out = out
    .replace(/&amp;/gi, '&').replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  try { out = decodeURIComponent(out.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { /* keep as-is */ }
  return out;
}

/** Any URL carrying a secret parameter, in any representation. */
function urlLooksSecret(url) {
  const u = decodeForScan(url);
  if (JWT_SHAPE.test(u)) return true;
  for (const p of SECRET_PARAMS) {
    // param=value in a query string, tolerating &amp; and encoded '='.
    if (new RegExp(`[?&#]${p}\\s*=\\s*[^&\\s"'<>]+`, 'i').test(u)) return true;
    // /token/<value> path style.
    if (new RegExp(`/${p}/[A-Za-z0-9_-]{8,}`, 'i').test(u)) return true;
  }
  // A long opaque run inside a path or query is a token even when unnamed.
  if (/[?&#]/.test(u) && LONG_SECRET_RUN.test(u.split(/[?&#]/).slice(1).join('&'))) return true;
  return false;
}

/**
 * Phase 1. Replace every secret-bearing URL with REDACTED_URL, leaving the
 * surrounding copy untouched.
 */
export function redactSecureLinks(input) {
  if (typeof input !== 'string' || input === '') return '';
  let out = input;

  // 1. href/src attribute values (button links included - a button is an <a>).
  out = out.replace(/\s(href|src)\s*=\s*"([^"]*)"/gi, (m, a, url) =>
    urlLooksSecret(url) ? ` ${a}="${REDACTED_URL}"` : m);
  out = out.replace(/\s(href|src)\s*=\s*'([^']*)'/gi, (m, a, url) =>
    urlLooksSecret(url) ? ` ${a}='${REDACTED_URL}'` : m);

  // 2. Bare URLs in text (plain-text bodies, and visible link text in HTML).
  out = out.replace(/\bhttps?:\/\/[^\s"'<>()]+/gi, (url) =>
    urlLooksSecret(url) ? REDACTED_URL : url);

  // 3. A naked secret parameter with no URL around it.
  for (const p of SECRET_PARAMS) {
    out = out.replace(new RegExp(`\\b${p}\\s*=\\s*[A-Za-z0-9._~%+/-]{8,}`, 'gi'), `${p}=${REDACTED_URL}`);
  }

  // 4. A bare JWT sitting in the copy.
  out = out.replace(new RegExp(JWT_SHAPE.source, 'gi'), REDACTED_URL);

  return out;
}

/**
 * Phase 2. Is this OUTPUT provably free of anything secret-shaped?
 * Scans the decoded form, so an encoded survivor cannot slip past.
 *
 * @returns {{ safe: boolean, reason: string|null }}
 */
export function verifyNoSecret(output) {
  const scan = decodeForScan(output || '');
  if (JWT_SHAPE.test(scan)) return { safe: false, reason: 'jwt_shape_present' };
  for (const p of SECRET_PARAMS) {
    // Inside a query string...
    if (new RegExp(`[?&#]${p}\\s*=\\s*[^&\\s"'<>]+`, 'i').test(scan)) return { safe: false, reason: `param_${p}_present` };
    // ...and standing alone in the copy. The gate's own negative control caught
    // this: a bare `token=<secret>` with no URL around it passed the query-string
    // check and verified clean, which would have archived the secret.
    if (new RegExp(`\\b${p}\\s*=\\s*[A-Za-z0-9._~%+/-]{8,}`, 'i').test(scan)) return { safe: false, reason: `param_${p}_present` };
  }
  // A surviving URL that still carries a query string with a long opaque run.
  for (const m of scan.matchAll(/\bhttps?:\/\/[^\s"'<>()]+/gi)) {
    if (urlLooksSecret(m[0])) return { safe: false, reason: 'secret_url_survived' };
  }
  return { safe: true, reason: null };
}

/**
 * The gate itself: redact, then prove. Callers archive ONLY when safe.
 *
 * @returns {{ safe, html, text, reason, redactionVersion }}
 */
export function buildSecureLinkSnapshot({ html, text }) {
  const rHtml = redactSecureLinks(html);
  const rText = redactSecureLinks(text);

  for (const candidate of [rHtml, rText]) {
    const v = verifyNoSecret(candidate);
    if (!v.safe) {
      // Reason is a short token, never the offending content: this string is
      // logged, and a log line is not a place for a leaked secret.
      return { safe: false, html: null, text: null, reason: v.reason, redactionVersion: REDACTION_VERSION };
    }
  }
  if ((!rHtml || !rHtml.trim()) && (!rText || !rText.trim())) {
    return { safe: false, html: null, text: null, reason: 'empty_after_redaction', redactionVersion: REDACTION_VERSION };
  }
  return { safe: true, html: rHtml || null, text: rText || null, reason: null, redactionVersion: REDACTION_VERSION };
}
