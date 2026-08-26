// src/lib/contactCategories.js
//
// CONTACTS-CANON-1: the canonical contacts vocabulary - the single source of
// truth for BOTH editors (staff ASPIRE Connect Contacts and the Nursing
// Education & Leadership portal Contacts) and both write endpoints
// (api/contacts-upsert.js, api/portal/academics-contacts.js), so the surfaces
// cannot drift.
//
// STORED CATEGORY VALUES ARE THE SINGULAR FORMS. The 20260826000000
// canonicalization migration renames the legacy plural/collective values
// ('Academic Partners', 'Unit Leadership', 'Preceptors', 'Nursing
// Executives') in place. Until the Owner applies it, canonicalCategory()
// maps legacy stored values at READ time and the endpoints normalize at
// WRITE time, so the app behaves identically before and after the SQL.
//
// TITLES ARE STRUCTURED PER CATEGORY. A category's titles come from
// CONTACT_ROLE_TITLES; free text is allowed ONLY where the canon says so
// (Academic Partner, Other). A LEGACY stored title that predates the canon
// passes through as an extra dropdown option until corrected by hand - the
// same unknown-value-passes-through pattern program_type uses.
//
// AFFILIATION IS DERIVED, NEVER FREE-FORM (except the Other escape):
//   Academic Partner            -> a school (identity catalog), written to
//                                  BOTH school_name and organization
//   Unit Leader / Preceptor /
//   BNI Team / Nursing Executive-> Cedars-Sinai Medical Center, fixed
//   Other                       -> school, Cedars-Sinai, or free text
// Unit affiliation (multi-unit, unit catalog) exists ONLY for Unit Leader
// and Preceptor. Nursing Executive with the Executive Director title gets a
// free-text Services field instead (BNI, Surgical Services, OLAR, ...).
//
// A contact may still belong to more than one category at READ time:
//   getContactCategories() → all categories a contact belongs to (>= 1).
//   getPrimaryCategory()   → the single category used for grouping.

// ── Categories ───────────────────────────────────────────────────────────────

// Canonical category order (excludes the synthetic 'All' bucket the UIs prepend).
export const CONTACT_CATEGORY_ORDER = [
  'Academic Partner',
  'Unit Leader',
  'Preceptor',
  'BNI Team',
  'Nursing Executive',
  'Other',
]

// Legacy stored values -> canonical. Read-time mapping until the migration
// lands; the migration itself carries the same table in SQL.
export const LEGACY_CATEGORY_MAP = {
  'Academic Partners': 'Academic Partner',
  'Unit Leadership': 'Unit Leader',
  'Preceptors': 'Preceptor',
  'Nursing Executives': 'Nursing Executive',
}

// Resolve any stored/submitted category to its canonical form, or null for
// unknown/empty input (callers decide whether null means "infer" or "reject").
export function canonicalCategory(raw) {
  const v = String(raw || '').trim()
  if (!v) return null
  if (CONTACT_CATEGORY_ORDER.includes(v)) return v
  return LEGACY_CATEGORY_MAP[v] || null
}

// ── Titles (Role/Title per category) ─────────────────────────────────────────

export const CONTACT_ROLE_TITLES = {
  'Academic Partner': [
    'Program Coordinator',
    'Assistant Professor',
    'Clinical Placement Coordinator',
    'Manager',
    'Clinical Faculty',
  ],
  'Unit Leader': [
    'Associate Director',
    'Interim Associate Director',
    'Assistant Nurse Manager',
    'NPD Practitioner',
    'Clinical Nurse Specialist',
  ],
  'Preceptor': [
    'CN II',
    'CN III',
  ],
  'BNI Team': [
    'Executive Director',
    'NPD Practitioner',
    'Program/Project Coordinator',
    'Lead Administrative Assistant',
  ],
  'Nursing Executive': [
    'SVP, Chief Nursing Executive',
    'VP of Nursing and Therapies',
    'Executive Director',
    'Manager',
  ],
  'Other': [
    'Talent Acquisition',
  ],
}

// Categories whose Role/Title also accepts free text (per the canon decision).
export const TITLE_FREE_TEXT_CATEGORIES = ['Academic Partner', 'Other']

export function titleOptionsFor(category) {
  return CONTACT_ROLE_TITLES[canonicalCategory(category)] || []
}

export function titleAllowsFreeText(category) {
  return TITLE_FREE_TEXT_CATEGORIES.includes(canonicalCategory(category))
}

// Is this title acceptable for this category? Empty is always acceptable
// (title not set, e.g. auto-synced preceptors whose CN level is unknown).
// `existingTitle` is the row's CURRENT stored value: an unchanged legacy
// title always passes (correct it by hand at your pace, never lose it).
export function isTitleAllowed(category, title, existingTitle = null) {
  const t = String(title || '').trim()
  if (!t) return true
  if (existingTitle != null && t === String(existingTitle).trim()) return true
  if (titleOptionsFor(category).includes(t)) return true
  return titleAllowsFreeText(category)
}

// JS mirror of the migration's title-mapping pass (category-scoped, exact
// matches only; nothing is guessed). Exported so the tests and the SQL can
// never drift.
export const LEGACY_TITLE_MAP = {
  'Unit Leader': {
    'Unit NPD-P': 'NPD Practitioner',
    'Unit NPD Practitioner': 'NPD Practitioner',
  },
  'Preceptor': {
    // The repair tool and preceptor sync historically wrote the literal role
    // 'Preceptor'; the CN level is unknown, so the canonical state is "no
    // title" rather than an invented one.
    'Preceptor': '',
    'Clinical Preceptor': '',
  },
}

// ── Affiliation ──────────────────────────────────────────────────────────────

export const CSMC_AFFILIATION = 'Cedars-Sinai Medical Center'

// 'school' | 'csmc' | 'choice' (Other picks school, Cedars-Sinai, or free text).
export function affiliationKind(category) {
  const c = canonicalCategory(category)
  if (c === 'Academic Partner') return 'school'
  if (c === 'Other') return 'choice'
  return 'csmc'
}

// Unit affiliation (multi-unit picker) exists ONLY for these categories.
export function showsUnitAffiliation(category) {
  const c = canonicalCategory(category)
  return c === 'Unit Leader' || c === 'Preceptor'
}

// Nursing Executive + Executive Director gets a free-text Services field
// (BNI, Surgical Services, Medical Services, OLAR, ...) instead of units.
export function showsServicesField(category, title) {
  return canonicalCategory(category) === 'Nursing Executive'
    && String(title || '').trim() === 'Executive Director'
}

// ── Units (multi-unit model over the existing columns) ───────────────────────
//
// The canonical unit list for a contact is [unit_name, ...related_units]:
// unit_name stays the PRIMARY unit (every existing consumer keeps working)
// and related_units carries the rest. These two helpers are the only place
// that mapping lives.

export function contactUnitList(contact) {
  const list = []
  const primary = String(contact?.unit_name || '').trim()
  if (primary) list.push(primary)
  for (const u of (Array.isArray(contact?.related_units) ? contact.related_units : [])) {
    const v = String(u || '').trim()
    if (v && !list.includes(v)) list.push(v)
  }
  return list
}

export function splitUnitList(units) {
  const list = []
  for (const u of (Array.isArray(units) ? units : [])) {
    const v = String(u || '').trim()
    if (v && !list.includes(v)) list.push(v)
  }
  return { unit_name: list[0] || null, related_units: list.slice(1) }
}

// ── Role inference (read-time, for rows predating the stored category) ───────

export const ACADEMIC_ROLES = new Set([
  'School Coordinator', 'Clinical Placement Coordinator', 'Clinical Placement Coordinators',
  'Program Assistant', 'Program Assistants',
  'Manager', 'Manager, Clinical Operations', 'Manager, Clinical Faculty',
  'Manager Clinical Faculty',
  'Clinical Faculty', 'Associate Professor', 'Professor & Assistant Director',
  'Program Coordinator',
])

export const UNIT_LEADERSHIP_ROLES = new Set([
  'Associate Director', 'Interim Associate Director', 'Assistant Nurse Manager',
  'Clinical Nurse Specialist',
  'Unit NPD-P', 'Unit NPD Practitioner',
])

export const PRECEPTOR_ROLES = new Set([
  'Preceptor', 'Clinical Preceptor', 'CN II', 'CN III',
])

export const BNI_TEAM_ROLES = new Set([
  'NPD Practitioner', 'BNI Administration', 'BNI Team',
  'Program/Project Coordinator', 'Lead Administrative Assistant',
])

export const NURSING_EXEC_ROLES = new Set([
  'Nursing Leadership', 'Nursing Executive', 'Executive Director',
  'Chief Nursing Officer',
  'SVP, Chief Nursing Executive', 'VP of Nursing and Therapies',
])

// ── Chip palettes ────────────────────────────────────────────────────────────
//
// Keyed by the CANONICAL category; categoryChipColors() canonicalizes its
// input, so a legacy stored value still resolves to its color before the
// migration is applied. This module is the ONLY palette: the former copies
// in RecipientPicker, RecipientProfileCard, SentHistory, and UniversalSearch
// were consolidated here (CONTACTS-CANON-1).
export const CATEGORY_CHIP_STYLES = {
  'Academic Partner':  { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Unit Leader':       { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Preceptor':         { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'BNI Team':          { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'Nursing Executive': { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Other':             { color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}

// Canonical role-pill colors used in the Contacts list and profile. Titles not
// listed here inherit their category color through contactRoleChipColors().
// Legacy titles keep their entries so passthrough rows stay legible.
export const CONTACT_ROLE_CHIP_STYLES = {
  // Academic Partner
  'School Coordinator':             { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Clinical Placement Coordinator': { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Program Coordinator':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Assistant Professor':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Program Assistant':              { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager':                        { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager, Clinical Operations':   { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager, Clinical Faculty':      { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager Clinical Faculty':       { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Clinical Faculty':               { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Associate Professor':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  // Unit Leader
  'Associate Director':             { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Interim Associate Director':     { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Assistant Nurse Manager':        { color: '#166534', bg: '#EEF7F0', border: '#c6d9a8' },
  'Clinical Nurse Specialist':      { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Unit NPD-P':                     { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  'Unit NPD Practitioner':          { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  // Preceptor
  'Preceptor':                      { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'Clinical Preceptor':             { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'CN II':                          { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'CN III':                         { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  // BNI Team
  'NPD Practitioner':               { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  'Program/Project Coordinator':    { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'Lead Administrative Assistant':  { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'BNI Administration':             { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'BNI Team':                       { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  // Nursing Executive
  'SVP, Chief Nursing Executive':   { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'VP of Nursing and Therapies':    { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Nursing Leadership':             { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Nursing Executive':              { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Executive Director':             { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Chief Nursing Officer':          { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
}

// Returns the canonical chip colors for a category (legacy values resolve
// through canonicalCategory; unknown falls back to 'Other').
export function categoryChipColors(category) {
  const c = canonicalCategory(category)
  return CATEGORY_CHIP_STYLES[c] || CATEGORY_CHIP_STYLES['Other']
}

export function contactRoleChipColors(role, category) {
  return CONTACT_ROLE_CHIP_STYLES[role] || categoryChipColors(category)
}

// ── Read-time categorization ─────────────────────────────────────────────────

// Returns the inferred primary category from role only (no stored category
// consulted). Priority: Nursing Executive > BNI Team > Unit Leader >
// Preceptor > Academic Partner. Returns null if no role Set matches.
export function inferPrimaryCategory(contact) {
  const role = contact.role || ''
  if (NURSING_EXEC_ROLES.has(role))    return 'Nursing Executive'
  if (BNI_TEAM_ROLES.has(role))        return 'BNI Team'
  if (UNIT_LEADERSHIP_ROLES.has(role)) return 'Unit Leader'
  if (PRECEPTOR_ROLES.has(role))       return 'Preceptor'
  if (ACADEMIC_ROLES.has(role))        return 'Academic Partner'
  return null
}

// Returns the primary category for a contact, always in canonical form.
// contacts.category (stored) takes precedence; legacy stored values map
// through canonicalCategory. Falls back to role inference for NULL rows.
export function getPrimaryCategory(contact) {
  const stored = canonicalCategory(contact.category)
  if (stored) return stored
  return inferPrimaryCategory(contact)
}

// Returns all categories a contact belongs to (may be more than one), in
// canonical form. Secondary rules are additive (computed at read time):
//   - NPD Practitioner with a unit affiliation also appears in Unit Leader
//   - Nursing exec role in a Brawerman/BNI organization also appears in BNI Team
export function getContactCategories(contact) {
  const cats = new Set()

  const primary = getPrimaryCategory(contact)
  if (primary) cats.add(primary)

  if ((contact.role || '') === 'NPD Practitioner' && contactUnitList(contact).length > 0) {
    cats.add('Unit Leader')
  }

  if (NURSING_EXEC_ROLES.has(contact.role || '')) {
    const org = (contact.organization || '').toLowerCase().trim()
    if (org.includes('brawerman') || org === 'bni' || org.includes(' bni ') || org.endsWith(' bni') || org.startsWith('bni ')) {
      cats.add('BNI Team')
    }
  }

  return cats.size > 0 ? [...cats] : ['Other']
}
