// src/lib/connectTones.js
//
// CONNECT-OUTREACH-CONTACTS-PANEL-POLISH — centralized panel tone tokens (ONE source of truth).
// Faint gradients that fade to near-white. Used by <ConnectPanel> and by panels that own their
// own header and only need the shell background (e.g. Contacts side panels). Presentation only.

export const CONNECT_TONES = {
  audience:       { from: '#FFF9E2', to: '#FFFDF4' }, // butter
  message:        { from: '#ECF7EF', to: '#FAFDFB' }, // sage
  draft:          { from: '#F3EEFC', to: '#FCFAFF' }, // lavender
  preview:        { from: '#FCEEF5', to: '#FFF9FB' }, // blush
  contacts:       { from: '#FFF9E2', to: '#FFFDF4' }, // butter (same as audience)
  communications: { from: '#FCEEF5', to: '#FFF9FB' }, // blush (same as preview)
  linkedStudents: { from: '#ECF7EF', to: '#FAFDFB' }, // sage (same as message)
}

// The tinted-shell gradient for a tone (falls back to audience/butter).
export function toneGradient(tone) {
  const t = CONNECT_TONES[tone] || CONNECT_TONES.audience
  return `linear-gradient(160deg, ${t.from} 0%, ${t.to} 100%)`
}
