// PRECEPTOR-TITLE-PHOTO-1: a preceptor's Role/Title and photo live on their
// ASPIRE Connect contact (matched by email), never on the preceptors row, so
// Rotation > Preceptors and Contacts can never disagree. These helpers are the
// pure half; PreceptorFormModal does the reads and the /api/contacts-upsert write.

import { canonicalCategory, titleOptionsFor, titleAllowsFreeText } from './contactCategories.js'

export const CUSTOM_TITLE = '__custom__'

export const normalizeEmail = (email) => String(email || '').toLowerCase().trim()

// The contact whose email matches exactly. The lookup uses ilike, where "_" is a
// wildcard, so the exact comparison happens here.
export function pickContactByEmail(rows, email) {
  const key = normalizeEmail(email)
  if (!key) return null
  return (rows || []).find(r => normalizeEmail(r.email) === key) || null
}

// A new contact is a Preceptor; an existing one keeps its own category's titles
// (a Unit Leader who also precepts is titled as a Unit Leader).
export function contactTitleCategory(contact) {
  return canonicalCategory(contact?.category) || 'Preceptor'
}

export function titleChoices(contact, currentTitle) {
  const category = contactTitleCategory(contact)
  const options = titleOptionsFor(category)
  const title = String(currentTitle || '').trim()
  return {
    options,
    allowsFreeText: titleAllowsFreeText(category),
    // A stored title outside the list stays selectable, as it does in Contacts.
    legacy: title && !options.includes(title) ? title : null,
  }
}

// The fields the preceptor form changed on an existing contact, or null when
// nothing changed. full_name is required by the endpoint and is the contact's
// own name, so saving a preceptor never renames a contact.
export function buildContactPatch(contact, { role, avatar_url }) {
  if (!contact?.id) return null
  const patch = {}
  if (String(role || '').trim() !== String(contact.role || '').trim()) patch.role = String(role || '').trim()
  if (String(avatar_url || '') !== String(contact.avatar_url || '')) patch.avatar_url = String(avatar_url || '')
  if (Object.keys(patch).length === 0) return null
  return { id: contact.id, full_name: contact.full_name, ...patch }
}

// Email -> contact title map for the Preceptors table, first match wins.
export function buildContactMaps(rows) {
  const avatars = {}
  const titles = {}
  for (const c of rows || []) {
    const key = normalizeEmail(c.email)
    if (!key) continue
    if (c.avatar_url && !avatars[key]) avatars[key] = c.avatar_url
    if (c.role && String(c.role).trim() && !titles[key]) titles[key] = String(c.role).trim()
  }
  return { avatars, titles }
}
