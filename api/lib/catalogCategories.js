// api/lib/catalogCategories.js
//
// CATALOG-REVAMP-1: which category slugs a Catalog write may use. The list used to be a
// constant in each endpoint, so adding Student Onboarding and School Documents would have
// meant editing three files and hoping they agreed. Now it is catalog_categories itself,
// less any retired category ('forms' became an item kind).
//
// Works on both sides of the migration: before retired_at exists (42703) every stored
// category is assignable, exactly as before.

export async function assignableCategorySlugs(db) {
  let { data, error } = await db.from('catalog_categories').select('slug, retired_at')
  if (error && error.code === '42703') {
    ;({ data, error } = await db.from('catalog_categories').select('slug'))
  }
  if (error) return { ok: false, error }
  return { ok: true, slugs: new Set((data || []).filter(c => !c.retired_at).map(c => c.slug)) }
}

// The one-value audience (catalog_resources.audience is a text[] holding one key).
export const AUDIENCE_KEYS = ['everyone', 'students', 'preceptors', 'schools', 'staff']

/** Returns a one-element array, [] for "not set", or null for an invalid value. */
export function cleanAudience(v) {
  if (v == null || v === '') return []
  const key = Array.isArray(v) ? v[0] : v
  if (Array.isArray(v) && v.length > 1) return null
  if (key == null || key === '') return []
  return AUDIENCE_KEYS.includes(key) ? [key] : null
}
