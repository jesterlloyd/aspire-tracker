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
// free-text Services field instead (BNI, Surgical Services, OLAR, ...), plus
// an explicit catalog-validated Divisions list (contacts.divisions) that the
// division filter matches on.
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

// DISPLAY labels for chips/KPI cards are PLURAL (decision 2026-08-25);
// stored values stay the singular canon. 'Others' with the s is deliberate.
export const CONTACT_CATEGORY_PLURAL_LABELS = {
  'Academic Partner': 'Academic Partners',
  'Unit Leader': 'Unit Leaders',
  'Preceptor': 'Preceptors',
  'BNI Team': 'BNI Team',
  'Nursing Executive': 'Nursing Executives',
  'Other': 'Others',
}

export function categoryPluralLabel(category) {
  const c = canonicalCategory(category)
  return CONTACT_CATEGORY_PLURAL_LABELS[c] || String(category || '')
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
    'Director',
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
    'Nurse Practitioner',
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

// Categories whose Role/Title also accepts free text. CONTACTS-EDITOR-PARITY-1
// (approved 2026-08-27): every category offers "Other (free text)" - the
// original Academic Partner + Other allowance grew to the full catalog so an
// uncataloged title never blocks a save. The per-category dropdowns remain the
// canonical first choice; free text is the labeled escape hatch.
export const TITLE_FREE_TEXT_CATEGORIES = [...CONTACT_CATEGORY_ORDER]

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

// NA-CONTACTS-SCOPE-4: Nursing Executive + Executive Director ALSO carries an
// explicit list of the divisions they cover, stored in contacts.divisions.
// This is structured data sitting beside the free-text Services line, not a
// replacement for it: Claude Stang's Services reads "Clinical Operations"
// (which is what his card should say) while his divisions say Emergency, so
// the division filter can find him without the display text having to name
// every division he covers. Same field, same rule, for Heidi High over
// Capacity Management.
export function showsDivisionsField(category, title) {
  return showsServicesField(category, title)
}

// The stored divisions, cleaned and de-duplicated. Callers validate the names
// against the unit catalog; this helper only normalizes shape.
export function contactDivisionList(contact) {
  const list = []
  for (const d of (Array.isArray(contact?.divisions) ? contact.divisions : [])) {
    const v = String(d || '').trim()
    if (v && !list.includes(v)) list.push(v)
  }
  return list
}

// The free-text focus line stored in contacts.services, with its per-category
// display label (decision 2026-08-25): Nursing Executive + Executive Director
// shows "Services"; EVERY BNI Team contact shows "Programs" (ASPIRE, NGRP,
// Preceptor Program, ...). Returns { label } when the field applies, else
// null. Endpoints and both editors consult THIS, never the raw rule.
export function contactServicesMeta(category, title) {
  const c = canonicalCategory(category)
  if (c === 'BNI Team') return { label: 'Programs' }
  if (showsServicesField(c, title)) return { label: 'Services' }
  return null
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

// ── List presentation (rows in BOTH contact directories) ─────────────────────
//
// Row shape (decision 2026-08-25): name, then the Role/Title pill, then a
// per-category third line:
//   Academic Partner  -> school
//   Unit Leader       -> unit(s)
//   Preceptor         -> unit(s)
//   BNI Team          -> Programs (contacts.services)
//   Nursing Executive -> Services (contacts.services); units only when stored
//                        (the Charina Emerson acting-AD exception is data,
//                        not a name-keyed rule)
//   Other             -> affiliation (organization, else school)

export function contactListSubline(contact) {
  const c = getPrimaryCategory(contact) || 'Other'
  const units = contactUnitList(contact)
  const services = String(contact?.services || '').trim()
  if (c === 'Academic Partner') return String(contact?.school_name || '').trim()
  if (c === 'Unit Leader' || c === 'Preceptor') return units.join(', ')
  if (c === 'BNI Team') return services
  if (c === 'Nursing Executive') return services || units.join(', ')
  return String(contact?.organization || '').trim() || String(contact?.school_name || '').trim()
}

// ── Category sort engine (BOTH contact directories) ──────────────────────────
//
// Approved ordering (2026-08-25), applied when a category filter is active
// and inside the staff app's grouped All view:
//   Unit Leader:       unit ascending, then Director > AD/Interim AD > ANM >
//                      NPD-P/CNS, then name. "Unit" means the contact's first unit inside
//                      the active scope when one is set, else their primary
//                      unit (see sortUnitFor).
//   BNI Team:          ED > Lead Administrative Assistant > NPD-P >
//                      Program/Project Coordinator, then name
//   Nursing Executive: SVP Chief Nursing Executive > VP of Nursing and
//                      Therapies > Executive Directors > Managers, then name
//   Academic Partner:  school, then name
//   Preceptor / Other: name
// Unknown/legacy titles sort after every ranked tier; missing units/schools
// sort last within their category.

const UL_TITLE_TIER = {
  // An EXECUTIVE acting over a unit (e.g. the acting Associate Director of
  // Float Pool) outranks the unit's own leadership chain.
  'Executive Director': 0,
  // A unit Director outranks an Associate Director. Ranked 2026-08-27 after
  // Jeremy Miller (Director, Transfer Center) fell to the unranked tier and
  // sorted below his own unit's staff.
  'Director': 1,
  'Associate Director': 2, 'Interim Associate Director': 2,
  'Assistant Nurse Manager': 3,
  'NPD Practitioner': 4, 'Clinical Nurse Specialist': 4,
  'Unit NPD-P': 4, 'Unit NPD Practitioner': 4,
}
const BNI_TITLE_TIER = {
  'Executive Director': 1,
  'Lead Administrative Assistant': 2,
  // Approved 2026-08-27: Nurse Practitioners sit level with NPD Practitioners
  // (alphabetical by displayed name within the shared tier).
  'NPD Practitioner': 3,
  'Nurse Practitioner': 3,
  'Program/Project Coordinator': 4,
}
const NE_TITLE_TIER = {
  'SVP, Chief Nursing Executive': 1,
  'VP of Nursing and Therapies': 2,
  'Executive Director': 3,
  'Manager': 4,
}

const SORT_LAST = '￿'
const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
const tierOf = (table, c) => table[String(c?.role || '').trim()] ?? 99

// The DISPLAYED name (preferred first name substituted into the full name,
// the same rule both list rows render), so alphabetization follows what the
// reader actually sees: Jun Bagunu files under J, not under Adolfo's A.
export function contactDisplayName(c) {
  const full = String(c?.full_name || '').trim()
  const preferred = String(c?.preferred_name || '').trim()
  if (!preferred) return full
  const fl = full.toLowerCase()
  const pl = preferred.toLowerCase()
  if (fl === pl || fl.startsWith(`${pl} `)) return full
  return [preferred, full.split(/\s+/).slice(1).join(' ')].filter(Boolean).join(' ')
}

// NA-CONTACTS-SCOPE-4: the unit a Unit Leader SORTS on. Without an active
// scope this is their primary unit, as before. With one, it is the first unit
// they hold that is actually IN the scope, because a multi-unit NPD
// Practitioner's primary unit is frequently not the unit you filtered to -
// and sorting Weiting Chan (primary 3 SCCT) above Jake Cornett (6 SCCT) under
// a 6 SCCT filter let the unit key shadow the title tier entirely. Under a
// single-unit scope every match yields the same key, so the comparison
// collapses to tier-then-name on its own; no separate rule is needed.
function sortUnitFor(contact, scopeUnits) {
  const units = contactUnitList(contact)
  if (scopeUnits) {
    const inScope = units.find(u => scopeUnits.has(u))
    if (inScope) return inScope
  }
  return units[0] || SORT_LAST
}

// `options.scopeUnits` is a Set of the unit names the active School/Division/
// Unit filter covers, or null/undefined when nothing is filtered.
export function compareContactsForCategory(category, { scopeUnits = null } = {}) {
  const c = canonicalCategory(category)
  if (c === 'Unit Leader') {
    return (a, b) =>
      cmpText(sortUnitFor(a, scopeUnits), sortUnitFor(b, scopeUnits))
      || (tierOf(UL_TITLE_TIER, a) - tierOf(UL_TITLE_TIER, b))
      || cmpText(contactDisplayName(a), contactDisplayName(b))
  }
  if (c === 'BNI Team') {
    return (a, b) =>
      (tierOf(BNI_TITLE_TIER, a) - tierOf(BNI_TITLE_TIER, b))
      || cmpText(contactDisplayName(a), contactDisplayName(b))
  }
  if (c === 'Nursing Executive') {
    return (a, b) =>
      (tierOf(NE_TITLE_TIER, a) - tierOf(NE_TITLE_TIER, b))
      || cmpText(contactDisplayName(a), contactDisplayName(b))
  }
  if (c === 'Academic Partner') {
    return (a, b) =>
      cmpText(String(a?.school_name || '').trim() || SORT_LAST, String(b?.school_name || '').trim() || SORT_LAST)
      || cmpText(contactDisplayName(a), contactDisplayName(b))
  }
  return (a, b) => cmpText(contactDisplayName(a), contactDisplayName(b))
}

// Non-mutating convenience over the comparator.
export function sortContactsForCategory(contacts, category, options) {
  return [...(contacts || [])].sort(compareContactsForCategory(category, options))
}

// Search-results ordering (the flat All view while a query is typed). When
// the query names a UNIT, that unit's leadership chain leads the results
// (acting executive > AD/Interim AD > ANM > NPD-P/CNS, then everyone else by
// displayed name), so searching "Float Pool" surfaces its acting Associate
// Director first. A query that matches no unit is plain displayed-name order.
export function sortContactsForSearch(contacts, query) {
  const q = String(query || '').trim().toLowerCase()
  const unitHit = (c) => q
    ? contactUnitList(c).some(u => u.toLowerCase().includes(q))
    : false
  return [...(contacts || [])].sort((a, b) => {
    const ha = unitHit(a), hb = unitHit(b)
    if (ha !== hb) return ha ? -1 : 1
    if (ha && hb) {
      const t = tierOf(UL_TITLE_TIER, a) - tierOf(UL_TITLE_TIER, b)
      if (t !== 0) return t
    }
    return cmpText(contactDisplayName(a), contactDisplayName(b))
  })
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

  // An executive ACTING over a unit (stored units on an Executive Director,
  // e.g. Charina Emerson / Float Pool) also appears under Unit Leader; the
  // UL sort ranks the acting executive above the unit's own chain.
  if ((contact.role || '') === 'Executive Director' && contactUnitList(contact).length > 0) {
    cats.add('Unit Leader')
  }

  // The BNI Executive Director is also a Nursing Executive (deterministic
  // reverse of the org-heuristic below, which post-canon affiliations no
  // longer trigger).
  if (primary === 'BNI Team' && (contact.role || '') === 'Executive Director') {
    cats.add('Nursing Executive')
  }

  if (NURSING_EXEC_ROLES.has(contact.role || '')) {
    const org = (contact.organization || '').toLowerCase().trim()
    if (org.includes('brawerman') || org === 'bni' || org.includes(' bni ') || org.endsWith(' bni') || org.startsWith('bni ')) {
      cats.add('BNI Team')
    }
  }

  return cats.size > 0 ? [...cats] : ['Other']
}
