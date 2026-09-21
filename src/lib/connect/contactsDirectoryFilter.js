// CONTACTS-BOOK-3: the Contacts filter and category counts, pure. Moved out of
// useContactsDirectory unchanged so both layouts share one copy: Classic applies them with
// its Show inactive toggle, the Address book with inactive contacts always included.
import { getContactCategories, CONTACT_CATEGORY_ORDER } from '../contactCategories.js'

// CONTACTS-CANON-1: the chip row derives from the shared canonical order.
export const CATEGORY_ORDER = ['All', ...CONTACT_CATEGORY_ORDER]

// The filter both layouts apply, pure so each can apply it with its own rule for inactive
// contacts (CONTACTS-BOOK-3): Classic hides them behind its toggle; the Address book
// always lists them, marked. The search reads every field it always read.
export function contactMatches(c, { search, categoryFilter, showInactive }) {
  // Hide inactive contacts when toggle is OFF
  if (!showInactive && c.is_active === false) return false
  const q = search.trim().toLowerCase()
  if (q) {
    const relatedStr = Array.isArray(c.related_units) ? c.related_units.join(' ') : ''
    const searchText = [
      c.full_name, c.preferred_name, c.email, c.organization,
      c.role, c.unit_name, relatedStr, c.school_name, c.notes,
    ].filter(Boolean).join(' ').toLowerCase()
    if (!searchText.includes(q)) return false
  }
  if (categoryFilter !== 'All' && !getContactCategories(c).includes(categoryFilter)) return false
  return true
}

// Category counts - respect the showInactive rule so pills count only listed contacts
export function countCategories(contacts, { showInactive }) {
  const counts = {}
  contacts
    .filter(c => showInactive || c.is_active !== false)
    .forEach(c => {
      getContactCategories(c).forEach(cat => {
        counts[cat] = (counts[cat] || 0) + 1
      })
    })
  return counts
}
