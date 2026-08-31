// src/lib/cohortSeason.js
//
// SCOPE-PICKER-2: which season, if any, a cohort name states.
//
// The season is ALREADY in the name, so the icon this drives is reinforcement for
// scanning, not information. That is the whole reason the rules below are strict: an
// icon that carries no new fact has nothing to offer in exchange for being wrong.
//
//   - Cohort names are free text. "Fall II 2026" is a real shape in this program, and
//     nothing stops someone naming a cohort in a way that states no season at all.
//     Unrecognized returns null, and the caller renders an empty slot rather than
//     guessing.
//   - A name mentioning TWO seasons ("Summer/Fall 2026") returns null. Picking the
//     first would be a coin flip presented as a fact.
//   - Residency cohorts are named by START MONTH ("January 2027"), never by season.
//     Deriving winter from January would assert something the name does not say, so
//     the residency list deliberately does not call this.
//
// Pure and string-only. No dates are parsed: a cohort's name is the claim being read,
// not its rotation window, which can start in a different season than the name implies.

// Autumn is accepted as a synonym because it is the same season under another word,
// not because anything in ASPIRE currently uses it.
const SEASON_PATTERNS = [
  ['summer', /\bsummer\b/i],
  ['fall',   /\b(fall|autumn)\b/i],
  ['winter', /\bwinter\b/i],
  ['spring', /\bspring\b/i],
]

/**
 * @param  name  a cohort's display name
 * @returns 'summer' | 'fall' | 'winter' | 'spring', or null when the name states no
 *          single unambiguous season
 */
export function seasonOf(name) {
  const s = String(name || '')
  if (!s.trim()) return null
  const hits = SEASON_PATTERNS.filter(([, re]) => re.test(s)).map(([key]) => key)
  return hits.length === 1 ? hits[0] : null
}
