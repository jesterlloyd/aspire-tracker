// KNOWLEDGE-GRAPH-1: pure assembly of the governed knowledge graph.
//
// api/knowledge-admin.js fetches entry and link rows and hands them here; the
// shape the Graph View renders is computed entirely in this module so it is
// testable without a database.
//
// EDGES ARE EXPLICIT GOVERNED RELATIONSHIPS AND NOTHING ELSE:
//   * wikilink   - a RESOLVED [[wikilink]] row in knowledge_links. Rows whose
//                  target did not resolve (broken/ambiguous) have no target to
//                  draw to; they surface as a per-node broken_count instead of
//                  being faked as edges.
//   * supersedes - knowledge_entries.superseded_by, drawn old -> new.
// Nothing here infers, embeds, scores similarity, or manufactures a
// relationship an author did not explicitly write. A sparse graph renders
// sparse; that is the honest picture of the corpus.

/** Stable edge identity so the same relationship is never drawn twice. */
function edgeKey(type, source, target) {
  return `${type}:${source}->${target}`;
}

/**
 * Build { nodes, edges } from raw rows.
 *
 * entries: knowledge_entries rows carrying at least
 *   { id, slug, title, category, state, body_format, superseded_by,
 *     expires_at, review_date }
 * links: knowledge_links rows carrying
 *   { source_entry_id, target_entry_id, status }
 * today: YYYY-MM-DD used for the review flags (passed in, never computed here,
 *   so the module stays deterministic under test).
 */
export function buildKnowledgeGraph({ entries = [], links = [], today = '' }) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const edges = [];
  const seen = new Set();
  const degree = new Map();
  const inbound = new Map();
  const outbound = new Map();
  const brokenCount = new Map();

  const bump = (map, id) => map.set(id, (map.get(id) || 0) + 1);

  // Wikilink edges: resolved rows only, both endpoints must still exist, and a
  // page linking to itself is a SELF row upstream (target null) - but guard
  // here anyway so a future data change cannot draw a loop.
  for (const l of links) {
    if (!l) continue;
    if (l.status && l.status !== 'resolved') {
      // Broken and ambiguous links have no drawable target. Count them per
      // source so the view can say "2 unresolved links" instead of hiding or
      // inventing them. A SELF link is deliberately NOT counted: a page naming
      // itself resolved fine - it just isn't drawable - and flagging it as
      // "unresolved" would tell the author something is wrong when nothing is.
      if (l.status !== 'self' && l.source_entry_id && byId.has(l.source_entry_id)) {
        bump(brokenCount, l.source_entry_id);
      }
      continue;
    }
    const s = l.source_entry_id;
    const t = l.target_entry_id;
    if (!s || !t || s === t) continue;
    if (!byId.has(s) || !byId.has(t)) continue;
    const key = edgeKey('wikilink', s, t);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: s, target: t, type: 'wikilink' });
    bump(degree, s); bump(degree, t);
    bump(outbound, s); bump(inbound, t);
  }

  // Supersession edges: old page -> the page that replaced it. A lifecycle
  // relationship, not authored prose, so it is its own edge type and the view
  // draws it distinctly.
  for (const e of entries) {
    const t = e.superseded_by;
    if (!t || t === e.id || !byId.has(t)) continue;
    const key = edgeKey('supersedes', e.id, t);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: e.id, target: t, type: 'supersedes' });
    bump(degree, e.id); bump(degree, t);
    bump(outbound, e.id); bump(inbound, t);
  }

  const nodes = entries.map(e => {
    const d = degree.get(e.id) || 0;
    return {
      id: e.id,
      slug: e.slug,
      title: e.title || 'Untitled',
      category: e.category,
      state: e.state,
      body_format: e.body_format || 'plain',
      tags: Array.isArray(e.tags) ? e.tags : [],
      superseded_by: e.superseded_by || null,
      degree: d,
      in_degree: inbound.get(e.id) || 0,
      out_degree: outbound.get(e.id) || 0,
      // An orphan has NO governed relationship in either direction. Draft
      // pages are still reported honestly; the view decides how to present
      // them (a brand-new draft being unlinked is normal, not a smell).
      is_orphan: d === 0,
      broken_count: brokenCount.get(e.id) || 0,
      expired: !!(e.expires_at && String(e.expires_at) < today),
      due_for_review: !!(e.review_date && String(e.review_date) <= today),
    };
  });

  return { nodes, edges };
}

// Adjacency and neighborhood traversal live in src/lib/knowledgeGraphLayout.js:
// they are CLIENT concerns (hover highlighting, the Local Graph), and the house
// direction for shared pure code is server -> src/lib, never src -> lib/server.
