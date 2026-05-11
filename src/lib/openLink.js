/**
 * openLink.js
 * All outbound navigation from ASPIRE Intelligence should use these helpers.
 * Never use window.location.href or window.location.assign for external URLs.
 * Never use anchor tags without target="_blank" for external links.
 */

/** Opens any external URL in a new tab. */
export function openExternalLink(url) {
  if (!url) return;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (win) win.opener = null;
}

/** Opens a mailto link without replacing the current app tab. */
export function openMailtoLink(mailtoUrl) {
  if (!mailtoUrl) return;
  window.open(mailtoUrl, '_blank');
}

/**
 * Builds a mailto URL and opens it without replacing the current app tab.
 * @param {{ to: string, subject: string, body: string, cc?: string }} params
 */
export function sendEmail({ to, subject, body, cc }) {
  let mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (cc) mailtoUrl += `&cc=${encodeURIComponent(cc)}`;
  openMailtoLink(mailtoUrl);
}
