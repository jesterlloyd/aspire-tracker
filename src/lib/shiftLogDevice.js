// src/lib/shiftLogDevice.js
//
// SHIFT-LOG-REMEMBER-1 (Owner, 2026-11-05): a student scanning the unit's QR code
// typed a long school email on every visit. The public /shift-log page now
// remembers the last email that found an eligible student ON THIS DEVICE and
// fills it in next time. It adds no new risk: the email is already the only
// thing that identifies a student on the public page. "Forget" removes it.
//
// Every read and write is guarded: private browsing or blocked storage simply
// means nothing is remembered, never a broken page.

export const SHIFT_LOG_EMAIL_KEY = 'aspire.shiftLog.email'

export function readRememberedShiftEmail() {
  try {
    const v = window.localStorage.getItem(SHIFT_LOG_EMAIL_KEY)
    return typeof v === 'string' && v.includes('@') ? v : ''
  } catch {
    return ''
  }
}

export function rememberShiftEmail(email) {
  const v = String(email || '').trim()
  if (!v.includes('@')) return
  try { window.localStorage.setItem(SHIFT_LOG_EMAIL_KEY, v) } catch { /* storage unavailable */ }
}

export function forgetShiftEmail() {
  try { window.localStorage.removeItem(SHIFT_LOG_EMAIL_KEY) } catch { /* storage unavailable */ }
}
