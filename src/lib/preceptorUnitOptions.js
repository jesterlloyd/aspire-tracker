// src/lib/preceptorUnitOptions.js
//
// PRECEPTOR-UNIT-DROPDOWN-1: which units the preceptor form may offer.
//
// THE DEFECT THIS FIXES. `units` is a COHORT-SCOPED table: the same physical
// unit (say PACU) exists as a separate row in every cohort. PreceptorFormModal
// ignored its cohortId and ran `from('units').select(...)` with no filter, so
// the dropdown listed PACU once per cohort and staff could not tell the
// entries apart.
//
// The fix is to build the option list from the ACTIVE COHORT's units only.
// This module holds the part worth testing on its own: turning that list plus
// a preceptor's stored unit into the options actually rendered.
//
// EDITING AN OLDER PRECEPTOR. A preceptor saved against a previous cohort
// carries a unit_id that does not exist in the current cohort's rows. Dropping
// it would let saving an unrelated field silently clear or change their unit.
// So the stored value is always represented:
//
//   exact     - the stored id is a current-cohort unit. Nothing to do.
//   remapped  - the stored id is foreign, but EXACTLY ONE current-cohort unit
//               carries the same canonical name. That is the equivalent, so it
//               is selected.
//   ambiguous - the stored id is foreign and SEVERAL current-cohort units share
//               that name. Picking one would be a guess, so the stored value is
//               preserved as-is instead. Never select an arbitrary duplicate.
//   legacy    - the stored id is foreign and no current-cohort unit matches.
//               Preserved as a clearly identified existing value.
//
// In the last three cases the caller must read unit_name from the returned
// options, never from the raw cohort list, or saving would write a null name.

/** Canonical form for comparing unit names: case and spacing do not matter. */
export function canonicalUnitName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Suffix marking a preserved value that is not a current-cohort option. */
export const LEGACY_OPTION_SUFFIX = ' (existing, not in this cohort)'

/**
 * Current-cohort units, alphabetical by name.
 *
 * The cohort filter is applied HERE as well as at the query, so a units prop
 * that briefly lags a cohort switch can never render the previous cohort's
 * rows. Rows without a cohort_id are kept: a caller may pass an already-scoped
 * list that does not carry the column.
 */
export function cohortUnits(units, cohortId) {
  return (units || [])
    .filter(u => u && u.id)
    .filter(u => !cohortId || !u.cohort_id || u.cohort_id === cohortId)
    .slice()
    .sort((a, b) => String(a.unit_name ?? '').localeCompare(String(b.unit_name ?? ''), 'en', { sensitivity: 'base' }))
}

/**
 * Build the dropdown options and the id that should be selected.
 *
 * @returns {{options: Array, selectedId: string, resolution: string}}
 *          resolution is 'none' | 'exact' | 'remapped' | 'ambiguous' | 'legacy'
 */
export function buildUnitOptions(units, cohortId, stored) {
  const options = cohortUnits(units, cohortId)
  // A default parameter would not cover an explicit null, which is exactly what
  // a caller spreading an absent preceptor produces.
  const from = stored || {}
  const storedId = from.unit_id || ''
  const storedName = from.unit_name || ''

  if (!storedId) return { options, selectedId: '', resolution: 'none' }

  if (options.some(u => u.id === storedId)) {
    return { options, selectedId: storedId, resolution: 'exact' }
  }

  // Foreign id: try to find this cohort's equivalent by canonical name.
  const key = canonicalUnitName(storedName)
  const matches = key ? options.filter(u => canonicalUnitName(u.unit_name) === key) : []

  if (matches.length === 1) {
    return { options, selectedId: matches[0].id, resolution: 'remapped' }
  }

  // Either nothing matched, or several did and choosing would be a guess.
  // Both preserve the stored value verbatim so a save cannot alter it.
  const legacy = {
    id: storedId,
    unit_name: storedName || 'Unknown unit',
    __legacy: true,
    label: `${storedName || 'Unknown unit'}${LEGACY_OPTION_SUFFIX}`,
  }
  return {
    options: [...options, legacy],
    selectedId: storedId,
    resolution: matches.length > 1 ? 'ambiguous' : 'legacy',
  }
}

/** Label for rendering an option. */
export function optionLabel(unit) {
  return unit?.label || unit?.unit_name || ''
}

/**
 * The unit_name to save for a chosen id. Reads from the BUILT options so a
 * preserved legacy value keeps its name instead of being written as null.
 */
export function resolveUnitName(options, unitId) {
  if (!unitId) return null
  const hit = (options || []).find(u => u.id === unitId)
  return hit?.unit_name || null
}

/**
 * Canonical names appearing more than once within one cohort's units.
 * Used by the integrity audit; a non-empty result means the data, not the UI,
 * needs attention.
 */
export function duplicateNamesWithinCohort(units) {
  const seen = new Map()
  for (const u of units || []) {
    const k = canonicalUnitName(u?.unit_name)
    if (!k) continue
    seen.set(k, (seen.get(k) || 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
}
