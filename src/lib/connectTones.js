// src/lib/connectTones.js
//
// CONNECT-OUTREACH-CONTACTS-PANEL-POLISH - centralized panel tone tokens (ONE source of truth).
// Faint gradients that fade to near-white. Used by <ConnectPanel> and by panels that own their
// own header and only need the shell background (e.g. Contacts side panels). Presentation only.

// Softened tones (Student-Profiles feel): faint `top` color, washed-out `mid`, then a hard fade to
// pure white lower in the panel (3-stop), so the tint never reads as colorful/playful.
export const CONNECT_TONES = {
  audience:       { top: '#FFFBEC', mid: '#FFFEF8' }, // butter
  message:        { top: '#F1F8F3', mid: '#FAFCFB' }, // sage
  draft:          { top: '#F6F2FC', mid: '#FBFAFE' }, // lavender
  preview:        { top: '#FCF2F7', mid: '#FEF9FC' }, // blush
  contacts:       { top: '#FFFBEC', mid: '#FFFEF8' }, // butter (same as audience)
  communications: { top: '#FCF2F7', mid: '#FEF9FC' }, // blush (same as preview)
  linkedStudents: { top: '#F1F8F3', mid: '#FAFCFB' }, // sage (same as message)
}

// Subtle solid circular-chip colors per tone (icon chip background + faint border). Harmonizes with
// the panel tone while staying subtle; the icon itself stays navy.
export const TONE_CHIP = {
  audience:       { bg: '#FAF3D8', border: '#EFE3AE' }, // butter
  message:        { bg: '#E6F1EA', border: '#CBE3D3' }, // sage
  draft:          { bg: '#EEE8F8', border: '#DCD0F0' }, // lavender
  preview:        { bg: '#F8E6EF', border: '#EFCEDD' }, // blush
  contacts:       { bg: '#FAF3D8', border: '#EFE3AE' },
  communications: { bg: '#F8E6EF', border: '#EFCEDD' },
  linkedStudents: { bg: '#E6F1EA', border: '#CBE3D3' },
}

// The tinted-shell gradient for a tone - fades to pure white at the bottom (falls back to butter).
export function toneGradient(tone) {
  const t = CONNECT_TONES[tone] || CONNECT_TONES.audience
  return `linear-gradient(160deg, ${t.top} 0%, ${t.mid} 55%, #ffffff 100%)`
}

// Icon-chip colors for a tone (falls back to audience/butter).
export function toneChip(tone) {
  return TONE_CHIP[tone] || TONE_CHIP.audience
}
