// src/lib/contactsCsv.js
//
// NA-CONTACTS-SCOPE-1: the Contacts directory CSV, pure and node-testable.
// Exports the VISIBLE contacts (the caller passes whatever the current
// filters show), organized by category in the canonical order with the
// approved per-category sort - the same organization the grouped All view
// renders. Full directory columns; this portal role already receives every
// one of these fields, so the export discloses nothing new.

import {
  CONTACT_CATEGORY_ORDER, getPrimaryCategory, sortContactsForCategory, contactUnitList,
  contactDivisionList,
} from './contactCategories.js'

const CSV_HEADERS = Object.freeze([
  'Category', 'Name', 'Preferred Name', 'Role / Title', 'School / Organization',
  'Units', 'Divisions', 'Services / Programs', 'Email', 'Phone',
])

const clean = v => String(v || '').trim()

// RFC-4180 escaping: always quoted, inner quotes doubled.
function cell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function buildContactsCsv(contacts = []) {
  const grouped = {}
  for (const contact of contacts) {
    const cat = getPrimaryCategory(contact) || 'Other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(contact)
  }
  const rows = [CSV_HEADERS.map(cell).join(',')]
  const order = [
    ...CONTACT_CATEGORY_ORDER,
    ...Object.keys(grouped).filter(c => !CONTACT_CATEGORY_ORDER.includes(c)).sort(),
  ]
  for (const cat of order) {
    const group = grouped[cat]
    if (!group || group.length === 0) continue
    for (const c of sortContactsForCategory(group, cat)) {
      rows.push([
        cat,
        clean(c.full_name),
        clean(c.preferred_name),
        clean(c.role),
        clean(c.school_name) || clean(c.organization),
        contactUnitList(c).join('; '),
        contactDivisionList(c).join('; '),
        clean(c.services),
        clean(c.email),
        clean(c.phone),
      ].map(cell).join(','))
    }
  }
  return rows.join('\n')
}
