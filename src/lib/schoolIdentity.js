// src/lib/schoolIdentity.js
//
// AP-SCHOOL-CANONICALIZATION-1 (revised against the actual production schema): the ONE write/display
// identity answer for "which school IS this string?". There is NO database school catalog in
// production (public.schools and students.school_id do not exist), so this static module IS the
// catalog, derived from the repository's existing alias source (api/lib/schoolAliases.js groups,
// parity-tested) plus each school's OPERATIVE display identity - the exact string the app's
// dropdowns and every historical students.school row use.
//
// The proven defect: the Academic Partner portal submits the CANONICAL scope name
// ("California State University, Northridge") while the public /school-form submits the OPERATIVE
// name ("Cal State Northridge"); both were persisted verbatim, splitting one school into two
// At a Glance groups and two rotation rows. Writers now resolve any known variant here and persist
// ONLY the operative name; At a Glance grouping resolves through here too as a defensive safeguard.
//
// Matching is case- and punctuation-insensitive but EXACT-NORMALIZED ONLY - never fuzzy - because a
// write-path identity must never be guessed. Campus identities (e.g. the two West Coast University
// campuses) are distinct groups and never collapse into each other.
//
// Shared by client (At a Glance grouping) and server (api/lib imports src/lib, same as emailUtils).

// Same normalization contract as api/lib/schoolAliases.js.
export function normSchoolName(s) {
  return String(s || '').toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// canonical: the formal institutional name (portal scope keys use this).
// operative: the display/write identity (students.school, cohort_school_rotations.school_name,
//            SCHOOL_COORDINATORS routing keys, the app's dropdowns).
// aliases:   search/display variants only; never persisted.
export const SCHOOL_IDENTITY_GROUPS = [
  { canonical: 'Azusa Pacific University', operative: 'Azusa Pacific University',
    aliases: ['APU', 'Azusa Pacific', 'Azusa'] },
  { canonical: 'California State University, Long Beach', operative: 'Cal State Long Beach',
    aliases: ['CSULB', 'Cal State Long Beach', 'CSU Long Beach', 'Long Beach State'] },
  { canonical: 'California State University, Los Angeles', operative: 'Cal State LA',
    aliases: ['CSULA', 'Cal State LA', 'Cal State Los Angeles', 'CSU Los Angeles'] },
  { canonical: 'California State University, Northridge', operative: 'Cal State Northridge',
    aliases: ['CSUN', 'Cal State Northridge', 'CSU Northridge'] },
  { canonical: 'University of California, Los Angeles', operative: 'UCLA',
    aliases: ['UCLA', 'UC Los Angeles'] },
  // NA-CONTACTS-SCOPE-2: the umbrella group exists ONLY to resolve ambiguous
  // legacy strings (a bare 'WCU' cannot be guessed into a campus). It is
  // legacyOnly: pickers hide it; resolution keeps working.
  { canonical: 'West Coast University', operative: 'West Coast University',
    aliases: ['WCU', 'West Coast'], legacyOnly: true },
  { canonical: 'West Coast University North Hollywood', operative: 'West Coast University North Hollywood',
    aliases: ['WCU North Hollywood', 'WCU NoHo', 'West Coast University NoHo'] },
  { canonical: 'West Coast University Anaheim', operative: 'West Coast University Anaheim',
    aliases: ['WCU Anaheim'] },
]

// The operatives pickers OFFER (school dropdowns, scope filters): every group
// except legacy-only resolution umbrellas. Resolution still accepts them all.
export const SCHOOL_PICKER_OPTIONS = SCHOOL_IDENTITY_GROUPS
  .filter(g => g.legacyOnly !== true)
  .map(g => g.operative)

// Resolve any known variant (canonical, operative, or alias; exact-normalized) to its identity.
// Returns { canonicalName, displayName } or null for unknown strings.
export function resolveOperativeSchoolName(rawName) {
  const q = normSchoolName(rawName)
  if (!q) return null
  for (const g of SCHOOL_IDENTITY_GROUPS) {
    const terms = [g.canonical, g.operative, ...g.aliases]
    if (terms.some(t => normSchoolName(t) === q)) {
      return { canonicalName: g.canonical, displayName: g.operative }
    }
  }
  return null
}

// The grouping key for display surfaces (At a Glance Placement Requests): the operative identity
// when the string is a known variant, else the raw string unchanged (unknown schools still group
// by exactly what was stored - never invented, never merged by guesswork).
export function schoolGroupKey(rawName) {
  return resolveOperativeSchoolName(rawName)?.displayName || rawName
}
