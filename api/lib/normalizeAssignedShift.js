// api/lib/normalizeAssignedShift.js
//
// SHIFT-LOG-ASSIGNED-SHIFT-DEFAULT: normalize a free-form/stored shift value to the
// Title-case vocabulary the shift-log forms use ('Day' | 'Night' | 'Mid'), or null.
//
// The shift-log form + endpoints accept ONLY 'Day' | 'Night' | 'Mid' (SHIFT_TYPES) - note
// Title case, NOT uppercase. preceptors.shift_type also allows 'Variable', which has no
// shift-log equivalent and therefore normalizes to null (caller keeps the 'Day' fallback).
// Returning null means "could not confidently resolve" → preserve existing default behavior.
export function normalizeAssignedShift(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (!v) return null
  switch (v) {
    case 'day':
    case 'days':
    case 'day shift':
      return 'Day'
    case 'night':
    case 'nights':
    case 'night shift':
      return 'Night'
    case 'mid':
    case 'mids':
    case 'midshift':
    case 'mid shift':
      return 'Mid'
    // Explicitly non-mappable (variable/flex/either/no-preference/evening/pm) and anything
    // unrecognized → null → caller falls back to the existing 'Day' default.
    default:
      return null
  }
}

export default normalizeAssignedShift
