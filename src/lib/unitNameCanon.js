// src/lib/unitNameCanon.js
//
// MULTI-UNIT-STUDENT-PLACEMENTS-2: canonical unit-name comparison.
//
// Shift-log unit names are free text, and history contains close variants of
// catalog names - the confirmed real case is '6NE' for the canonical '6 NE'.
// The Owner corrected the confirmed 'PA' -> 'PACU' rows directly; everything
// else stays as written (NO bulk rewriting of historical records), and instead
// COMPARISON and DISPLAY canonicalize on the fly.
//
// The comparison key is deliberately blunt: lowercase with ALL whitespace
// removed, so '6NE', '6 ne', and '6 NE ' all key to '6ne'. That is exactly as
// aggressive as the confirmed variants require and no more - it never merges
// two different catalog units (verified by test: all 28 catalog names keep
// distinct keys).

import { UNIT_CATALOG } from './unitCatalog.js'

/** Blunt comparison key: lowercase, all whitespace removed. */
export function unitNameKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

/** key -> canonical catalog name, e.g. '6ne' -> '6 NE'. */
const CANONICAL_BY_KEY = new Map(UNIT_CATALOG.map((u) => [unitNameKey(u.name), u.name]))

/** Do two unit names refer to the same unit? ('6NE' vs '6 NE' -> true) */
export function sameUnitName(a, b) {
  const ka = unitNameKey(a)
  const kb = unitNameKey(b)
  return ka.length > 0 && ka === kb
}

/**
 * Display form: the catalog's canonical name when the value keys to one
 * ('6NE' -> '6 NE'), otherwise the trimmed original. Never returns padding.
 */
export function canonicalUnitName(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  return CANONICAL_BY_KEY.get(unitNameKey(trimmed)) || trimmed
}
