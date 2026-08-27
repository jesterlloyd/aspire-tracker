// src/lib/connectSignatureAssets.js
//
// SIGNATURE-PREVIEW-PARITY-1: the ONE sender-scoped handwritten-image map,
// shared by the server renderer (lib/server/connect/emailTemplates.js, which
// wraps the path in appUrl) and the Settings preview (SignaturePanel, which
// uses the same-origin path directly) - so the preview can never show a GIF
// the sent email would not carry, or vice versa.
//
// The image is an ENHANCEMENT only: senders without a registered image render
// the typed block alone, correctly. Keyed by normalized lowercase email.

export const CONNECT_SIGNATURE_IMAGE_PATHS = Object.freeze({
  'jesterlloyd.bautista@cshs.org': '/signature-jester.gif',
})

export function connectSignatureImagePath(email) {
  return CONNECT_SIGNATURE_IMAGE_PATHS[String(email || '').trim().toLowerCase()] || null
}

// The institute line every Connect signature falls back to when the sender has
// not set a Department - the exact line the renderer has always printed.
export const CONNECT_SIGNATURE_DEFAULT_AFFILIATION = 'Geri & Richard Brawerman Nursing Institute'
