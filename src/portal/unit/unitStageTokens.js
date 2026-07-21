// src/portal/unit/unitStageTokens.js
//
// UL-PHASE1-VISUAL: lifecycle bucket -> stage-pill colors.
//
// The Unit Leader roster groups students into 'upcoming' | 'active' | 'completed'
// (BUCKET_LABEL in unitLeaderApi). The staff app has no pill for those exact names,
// so these reuse the SAME hue families the staff ASPIRE_STATUS_CONFIG uses, so a
// stage pill here reads as the same visual language: blue for pre-rotation, green for
// in-rotation, pale green for completed. Kept as data so the mapping is testable.

export const STAGE_TOKENS = Object.freeze({
  upcoming:  { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd', label: 'Upcoming' },
  active:    { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7', label: 'Active rotation' },
  completed: { bg: '#f0fdf4', text: '#14532d', border: '#4ade80', label: 'Recently completed' },
})

const NEUTRAL = { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db', label: '' }

export function stageToken(bucket) {
  return STAGE_TOKENS[bucket] || { ...NEUTRAL }
}
