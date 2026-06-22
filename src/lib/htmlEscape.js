// src/lib/htmlEscape.js
//
// Minimal HTML escaping for interpolating user-provided text (e.g. a student's preferred
// first name) into email HTML. Importable by both client (src/) and server (api/, lib/server/).
// Use ONLY for HTML contexts — plain-text bodies and email subjects must use the raw value.
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default escapeHtml
