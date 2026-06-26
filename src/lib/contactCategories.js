// src/lib/contactCategories.js
//
// Shared contact categorization logic — the single source of truth for both the Contacts page
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
// contacts.category (stored) takes precedence — Phase C.2.
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
