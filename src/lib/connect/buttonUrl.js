// src/lib/connect/buttonUrl.js
//
// RICH-COMPOSE-2A-2 - pure URL validator for the ASPIRE Connect Linked Button block. No DOM/browser
// deps, so it is shared by BOTH the client modal (UX) and the server renderer (authority). The server
// is the trust boundary; the client check is only for immediate feedback.
//
// POLICY (stricter than prose links - Button URLs reject explicit http:):
//   allow   https:  and  mailto:
//   normalize protocol-less ("example.com", "name@org.edu") -> https:// / mailto:
//   reject  http:  javascript:  data:  vbscript:  file:  protocol-relative (//x)  empty  malformed
//           control characters, and any other scheme.

const SAFE = /^(https:\/\/|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// eslint-disable-next-line no-control-regex -- intentional: reject embedded control chars in URLs
const CONTROL = /[\x00-\x1F\x7F]/;
const EMAILish = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns { ok: true, url } with a safe, normalized URL, or { ok: false } if it cannot be made safe.
export function validateButtonUrl(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return { ok: false };
  if (CONTROL.test(v)) return { ok: false };          // control chars (incl. embedded newlines/tabs)
  if (/^\/\//.test(v)) return { ok: false };           // protocol-relative
  if (SAFE.test(v)) return { ok: true, url: v };       // already https:/mailto:
  if (HAS_SCHEME.test(v)) return { ok: false };        // any OTHER explicit scheme (http:, javascript:, ...)
  if (v.includes(':')) return { ok: false };           // a stray colon without a safe scheme - ambiguous, reject
  if (EMAILish.test(v)) return { ok: true, url: `mailto:${v}` };
  const httpsy = `https://${v.replace(/^\/+/, '')}`;
  return SAFE.test(httpsy) ? { ok: true, url: httpsy } : { ok: false };
}
