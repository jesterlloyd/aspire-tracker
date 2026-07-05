// src/lib/outlookCompose.js
//
// Centralized Outlook Web (Microsoft 365) compose-link generation + opening for IN-APP STAFF email
// buttons. Routes compose actions to Outlook Web instead of the OS default mail handler (mailto:),
// which in some staff environments opens the wrong client (e.g. IONOS). Always opens in a NEW TAB,
// so the ASPIRE Intelligence window is never replaced.
//
// SCOPE: Outlook Web compose requires a Cedars-Sinai / Microsoft 365 session, so use this ONLY for
// staff-facing in-app controls - NOT student/coordinator-facing public pages (which keep mailto:),
// and NOT inside outbound email templates.

const COMPOSE_BASE = 'https://outlook.office.com/mail/deeplink/compose'

// Normalize a recipient string (comma/semicolon separated) to a clean comma-separated list.
function normalizeRecipients(value) {
  return String(value || '')
    .split(/[;,]/)
    .map(e => e.trim())
    .filter(Boolean)
    .join(',')
}

// Build an Outlook Web compose URL. All fields optional; empty fields are omitted. `to`/`cc`/`bcc`
// may each be a single address or a comma/semicolon-separated list.
export function buildOutlookComposeUrl({ to, cc, bcc, subject, body } = {}) {
  const params = []
  const addRecipients = (key, v) => {
    const n = normalizeRecipients(v)
    if (n) params.push(`${key}=${encodeURIComponent(n)}`)
  }
  addRecipients('to', to)
  addRecipients('cc', cc)
  addRecipients('bcc', bcc)
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body)    params.push(`body=${encodeURIComponent(body)}`)
  return params.length ? `${COMPOSE_BASE}?${params.join('&')}` : COMPOSE_BASE
}

// Build + open an Outlook Web compose window in a NEW TAB (never replaces the app window).
export function openOutlookCompose(params) {
  const url = buildOutlookComposeUrl(params)
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  if (win) win.opener = null
}
