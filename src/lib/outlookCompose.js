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

// ── ASPIRE-PORTAL-NAV: portal-aware compose routing ──────────────────────────
// Portal accounts sign in with their OWN email (e.g. a Walden student uses
// jesterlloyd.bautista@waldenu.edu). Recognized Microsoft 365 logins open Outlook
// Web compose in a new tab; everything else uses a separate-tab mailto fallback.
// The current ASPIRE tab is NEVER navigated. Determined from the portal LOGIN
// email, not the student's school name.

// Centralized, easy to extend. Add Microsoft 365 tenant domains here.
export const MICROSOFT_365_DOMAINS = new Set([
  'waldenu.edu',
  'cshs.org',
])

export function emailDomain(email) {
  const m = String(email || '').trim().toLowerCase().match(/@([^@\s]+)$/)
  return m ? m[1] : ''
}

export function isMicrosoft365Email(email) {
  return MICROSOFT_365_DOMAINS.has(emailDomain(email))
}

// Plain mailto URL (used only for the non-Microsoft fallback).
export function buildMailtoUrl({ to, subject, body } = {}) {
  const params = []
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body) params.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${to || ''}${params.length ? `?${params.join('&')}` : ''}`
}

// Open a URL in a NEW blank tab, sever the opener, then navigate that tab. This
// (a) detects popup blocking via the returned window ref, (b) never touches the
// current tab, and (c) approximates noopener/noreferrer. Returns true if opened.
function openInNewTab(url) {
  let win = null
  try { win = window.open('', '_blank') } catch { win = null }
  if (!win) return false
  try { win.opener = null } catch { /* not always writable */ }
  try { win.location.href = url } catch { return false }
  return true
}

// Compose a portal email. MUST be called synchronously from a user click so the
// browser attributes the popup to the gesture. Never logs the composed URL (it
// may carry student context) and never navigates the current ASPIRE tab.
// Returns { mode: 'outlook' | 'mailto', opened: boolean, loginEmail }.
export function composePortalEmail({ to, subject, body, loginEmail } = {}) {
  const login = String(loginEmail || '').trim()
  if (isMicrosoft365Email(login)) {
    // No login_hint: the Outlook compose deeplink does not support one without
    // breaking the URL, and Outlook uses the active session / prompts for an
    // account. The caller shows a confirm-your-account note instead.
    const opened = openInNewTab(buildOutlookComposeUrl({ to, subject, body }))
    return { mode: 'outlook', opened, loginEmail: login }
  }
  const opened = openInNewTab(buildMailtoUrl({ to, subject, body }))
  return { mode: 'mailto', opened, loginEmail: login }
}
