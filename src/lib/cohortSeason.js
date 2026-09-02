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
//   - Residency cohorts were originally named by START MONTH ("January 2027"), and
//     deriving winter from January would have asserted something the name does not
//     say, so the residency list did not call this. COHORT-ORDER-1 (Owner): residency
//     cohorts are named by season now ("Winter 2027"), which removes that objection.
//     Both lists read the same rule, and a residency cohort still named by month
//     simply gets the empty slot every other unrecognized name gets.
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

// ── Chronological ordering ───────────────────────────────────────────────────
//
// COHORT-ORDER-1: cohort lists order by the NAME, not by cohorts.start_date.
//
// start_date is a free-text TEXT column. It genuinely holds values like
// "May 4, 2026" alongside ISO ones, so localeCompare over it sorts
// alphabetically: January before May before September, which put Winter 2027
// above Fall 2026 in every cohort list in the app. The name is the reliable
// claim, and it is the thing the reader is comparing anyway.
//
// Winter belongs to the year it NAMES. "Winter 2027" starts in January 2027, so
// it follows Fall 2026, which is the order the program actually runs in:
// Summer 2026, Fall 2026, Winter 2027.
const SEASON_ORDER = { winter: 0, spring: 1, summer: 2, fall: 3 }

// A four-digit year anywhere in the name. Cohort names put it last
// ("Fall II 2026"), but nothing depends on the position.
function yearOf(name) {
  const m = String(name || '').match(/\b(19|20)\d{2}\b/)
  return m ? Number(m[0]) : null
}

/**
 * A sortable key for a cohort name: [year, seasonIndex, name].
 *
 * A name missing a year, or stating no single season, sorts AFTER everything
 * that has one rather than being guessed at - the same refusal seasonOf makes.
 * The name is the final tiebreak so "Fall 2026" and "Fall II 2026" keep a
 * stable, readable order instead of depending on fetch order.
 */
export function cohortChronoKey(name) {
  const year = yearOf(name)
  const season = seasonOf(name)
  return [
    year == null ? Infinity : year,
    season == null ? Infinity : SEASON_ORDER[season],
    String(name || ''),
  ]
}

// Comparator over cohort rows. `created_at` breaks ties among rows whose names
// state neither a year nor a season, so an unnamed-season list still has a
// deterministic order instead of drifting with the query.
export function compareCohortsChrono(a, b) {
  const ka = cohortChronoKey(a?.name)
  const kb = cohortChronoKey(b?.name)
  for (let i = 0; i < 3; i += 1) {
    if (ka[i] < kb[i]) return -1
    if (ka[i] > kb[i]) return 1
  }
  return String(a?.created_at || '').localeCompare(String(b?.created_at || ''))
}
