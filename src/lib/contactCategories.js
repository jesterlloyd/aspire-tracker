// src/lib/contactCategories.js
//
// Shared contact categorization logic - the single source of truth for both the Contacts page
// (ContactsView) and the Send-to-Many Contacts audience source (BulkManualComposer), so the two
// never drift. Extracted verbatim from ContactsView; behavior is unchanged.
//
// A contact may belong to more than one category.
//   getContactCategories() → all categories a contact belongs to (>= 1).
//   getPrimaryCategory()   → the single category used for grouping in the All view.

export const ACADEMIC_ROLES = new Set([
  'School Coordinator', 'Clinical Placement Coordinator', 'Clinical Placement Coordinators',
  'Program Assistant', 'Program Assistants',
  'Manager', 'Manager, Clinical Operations', 'Manager, Clinical Faculty',
  'Manager Clinical Faculty',
  'Clinical Faculty', 'Associate Professor', 'Professor & Assistant Director',
  'Program Coordinator',
])

export const UNIT_LEADERSHIP_ROLES = new Set([
  'Associate Director', 'Assistant Nurse Manager',
  'Unit NPD-P', 'Unit NPD Practitioner',
])

export const PRECEPTOR_ROLES = new Set([
  'Preceptor', 'Clinical Preceptor',
])

export const BNI_TEAM_ROLES = new Set([
  'NPD Practitioner', 'BNI Administration', 'BNI Team',
])

export const NURSING_EXEC_ROLES = new Set([
  'Nursing Leadership', 'Nursing Executive', 'Executive Director',
  'Chief Nursing Officer',
])

// Canonical category order (excludes the synthetic 'All' bucket the UIs prepend).
export const CONTACT_CATEGORY_ORDER = [
  'Academic Partners',
  'Unit Leadership',
  'Preceptors',
  'BNI Team',
  'Nursing Executives',
  'Other',
]

// Canonical category chip colors (color/bg/border) - the single source for category pills across
// the Contacts page, Send to One, and Send to Many so the palettes never drift.
export const CATEGORY_CHIP_STYLES = {
  'Academic Partners':  { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Unit Leadership':    { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Preceptors':         { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'BNI Team':           { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'Nursing Executives': { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Other':              { color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}

// Canonical role-pill colors used in the Contacts list and profile. Roles not
// listed here inherit their category color through contactRoleChipColors().
export const CONTACT_ROLE_CHIP_STYLES = {
  // Academic Partners
  'School Coordinator':             { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Clinical Placement Coordinator': { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Program Coordinator':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Program Assistant':              { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager':                        { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager, Clinical Operations':   { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager, Clinical Faculty':      { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager Clinical Faculty':       { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Clinical Faculty':               { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Associate Professor':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  // Unit Leadership
  'Associate Director':             { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Assistant Nurse Manager':        { color: '#166534', bg: '#EEF7F0', border: '#c6d9a8' },
  'Unit NPD-P':                     { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  'Unit NPD Practitioner':          { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  // Preceptors
  'Preceptor':                      { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'Clinical Preceptor':             { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  // BNI Team
  'NPD Practitioner':               { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  'BNI Administration':             { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'BNI Team':                       { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  // Nursing Executives
  'Nursing Leadership':             { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Nursing Executive':              { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Executive Director':             { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Chief Nursing Officer':          { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
}

// Returns the canonical chip colors for a category (falls back to 'Other').
export function categoryChipColors(category) {
  return CATEGORY_CHIP_STYLES[category] || CATEGORY_CHIP_STYLES['Other']
}

export function contactRoleChipColors(role, category) {
  return CONTACT_ROLE_CHIP_STYLES[role] || categoryChipColors(category)
}

// Returns the inferred primary category from role only (no stored category consulted).
// Priority: Nursing Executives > BNI Team > Unit Leadership > Preceptors > Academic Partners
// Returns null if no role Set matches.
export function inferPrimaryCategory(contact) {
  const role = contact.role || ''
  if (NURSING_EXEC_ROLES.has(role))    return 'Nursing Executives'
  if (BNI_TEAM_ROLES.has(role))        return 'BNI Team'
  if (UNIT_LEADERSHIP_ROLES.has(role)) return 'Unit Leadership'
  if (PRECEPTOR_ROLES.has(role))       return 'Preceptors'
  if (ACADEMIC_ROLES.has(role))        return 'Academic Partners'
  return null
}

// Returns the primary category for a contact.
// contacts.category (stored) takes precedence - Phase C.2.
// Falls back to role inference for contacts with NULL category (future-resilient).
export function getPrimaryCategory(contact) {
  if (contact.category) return contact.category
  return inferPrimaryCategory(contact)
}

// Returns all categories a contact belongs to (may be more than one).
// Primary: stored contacts.category if set; otherwise inferred from role Sets.
// Secondary rules are additive (computed at read-time, not stored in contacts.category):
//   - NPD Practitioner with unit_name also appears in Unit Leadership
//   - Nursing Exec role in Brawerman/BNI organization also appears in BNI Team
export function getContactCategories(contact) {
  const cats = new Set()

  const primary = getPrimaryCategory(contact)
  if (primary) cats.add(primary)

  // NPD Practitioner assigned to a unit → also Unit Leadership
  if ((contact.role || '') === 'NPD Practitioner' && contact.unit_name) {
    cats.add('Unit Leadership')
  }

  // Nursing exec roles in Brawerman/BNI organizations → also BNI Team
  if (NURSING_EXEC_ROLES.has(contact.role || '')) {
    const org = (contact.organization || '').toLowerCase().trim()
    if (org.includes('brawerman') || org === 'bni' || org.includes(' bni ') || org.endsWith(' bni') || org.startsWith('bni ')) {
      cats.add('BNI Team')
    }
  }

  return cats.size > 0 ? [...cats] : ['Other']
}
