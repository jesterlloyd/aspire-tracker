// KNOWLEDGE-ENRICH-1: the client-side wikilink resolver, extracted from
// KnowledgeEntryDrawer so the enrichment review can use the SAME resolution
// the drawer preview uses - a third hand-rolled copy would drift.
//
// Mirrors lib/server/keith/knowledgeLinks.js exactly: same normalization, same
// slug > title > alias precedence, same "ambiguous resolves to nothing" rule.
// The server remains the authority; this only keeps previews honest without a
// round trip.

export const linkKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function buildResolver(catalog) {
  const bySlug = new Map(); const byTitle = new Map(); const byAlias = new Map()
  const add = (m, k, e) => {
    if (!k) return
    if (!m.has(k)) m.set(k, e)
    else if (m.get(k) && m.get(k).id !== e.id) m.set(k, null) // null = ambiguous
  }
  for (const e of catalog || []) {
    add(bySlug, linkKey(e.slug), e)
    add(byTitle, linkKey(e.title), e)
    for (const a of e.aliases || []) add(byAlias, linkKey(a), e)
  }
  return (target) => {
    const k = linkKey(target)
    for (const m of [bySlug, byTitle, byAlias]) {
      if (!m.has(k)) continue
      const hit = m.get(k)
      if (hit === null) return { status: 'ambiguous' }
      return { status: 'resolved', id: hit.id, slug: hit.slug, title: hit.title, state: hit.state }
    }
    return { status: 'broken' }
  }
}
