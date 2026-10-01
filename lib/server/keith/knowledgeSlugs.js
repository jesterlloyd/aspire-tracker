// Knowledge Center slugs: one rule for every writer (api/knowledge-admin.js's create and import, and
// Keith's self-check Drafts). Moved here from api/knowledge-admin.js unchanged in behaviour
// (KEITH-KNOWLEDGE-SELFCHECK-1): the lookup reads `slug LIKE base%` and keeps the exact base and its
// numbered forms, which is what the old `slug.eq.base OR slug.like.base-%` returned.

/** Lowercase, hyphenated, [a-z0-9-] only; hyphens collapsed and trimmed; 180 characters at most. */
export function slugify(title) {
  const base = String(title || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
  return base || 'entry'
}

/**
 * Race-safe-enough dedup: read the slugs sharing the base and pick the lowest unused numeric suffix.
 * A concurrent insert may still collide on UNIQUE(slug); the caller maps that 23505.
 * Returns { slug } or { error }.
 */
export async function nextAvailableSlug(db, base) {
  const { data, error } = await db.from('knowledge_entries').select('slug').like('slug', `${base}%`)
  if (error) return { error }
  const taken = new Set((data || []).map(r => r.slug).filter(s => s === base || s.startsWith(`${base}-`)))
  if (!taken.has(base)) return { slug: base }
  for (let i = 2; i < 10000; i++) {
    const cand = `${base}-${i}`
    if (!taken.has(cand)) return { slug: cand }
  }
  return { error: { code: 'slug_exhausted' } }
}
