// NURSING-ACADEMICS-1: one deterministic color per school.
//
// The calendar's locked requirement is CONSISTENT color-coding: the same
// school must carry the same color on every render, in every filter state, in
// the legend, and on the Community Benefit charts. Colors are therefore
// derived from the school's canonical identity string (a stable hash into a
// fixed palette), never from render order or dataset position, so adding or
// filtering schools can never shuffle anyone's color.
//
// The palette is drawn from the app's established accent families (Nightfall,
// marina, sage, dawn, lavender, periwinkle, chroma) plus two supporting tones,
// each paired with an ink color that stays readable on the fill.

// Extension included so the module also loads under node:test (Vite resolves either way).
import { schoolGroupKey } from '../../lib/schoolIdentity.js'

export const NA_SCHOOL_PALETTE = [
  { fill: '#1D2567', soft: '#E4E7F5', ink: '#1D2567' }, // nightfall
  { fill: '#0E7490', soft: '#DFF3F7', ink: '#155E70' }, // marina
  { fill: '#3F9142', soft: '#E4F1E4', ink: '#2F6C31' }, // sage
  { fill: '#D08700', soft: '#FCEFD4', ink: '#7C5A1F' }, // dawn
  { fill: '#7C5CBF', soft: '#EDE7F8', ink: '#5B3FA0' }, // lavender
  { fill: '#5C74C4', soft: '#E7ECF9', ink: '#41529B' }, // periwinkle
  { fill: '#B4468A', soft: '#F7E4EF', ink: '#8E2F6A' }, // chroma
  { fill: '#8A6D3B', soft: '#F3ECDE', ink: '#6B532C' }, // ochre
  { fill: '#3B7A6A', soft: '#E1F0EC', ink: '#2C5D50' }, // pine
]

// djb2: stable, dependency-free, spreads short strings well.
function hashString(s) {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

// The color entry for a school string (any known variant resolves to its
// canonical group first, so "CSUN" and "Cal State Northridge" share a color).
export function schoolColor(rawSchoolName) {
  const key = schoolGroupKey(String(rawSchoolName || '').trim() || 'Unknown school')
  return NA_SCHOOL_PALETTE[hashString(key) % NA_SCHOOL_PALETTE.length]
}
