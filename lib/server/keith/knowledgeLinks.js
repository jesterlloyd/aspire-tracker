// KNOWLEDGE-VAULT-1: [[wikilink]] extraction and resolution.
//
// Links are extracted from a body at SAVE time and resolved against the entry
// catalog into knowledge_links, so backlinks, orphans and broken links are
// plain SQL queries rather than a scan of every body at read time.
//
// RESOLUTION ORDER, and why it is this order:
//   1. slug   - the only globally unique identifier a page has. An author who
//               writes the slug means exactly one page and must always win.
//   2. title  - what a human actually types. Titles are NOT unique in the
//               schema, so a collision here is genuinely ambiguous.
//   3. alias  - the author-declared alternate names.
// Matching is case- and punctuation-insensitive at every level, because
// "[[CS-Link Access]]", "[[cs link access]]" and "[[CS Link Access]]" are the
// same intent.
//
// AMBIGUITY IS NOT A SILENT PICK. If a target matches two different entries at
// the same precedence level, the link resolves to NOTHING and is reported as
// ambiguous. Guessing would let a rename quietly repoint a link at the wrong
// page, which is worse than showing the author a problem they can fix.
//
// A link may point at an entry in ANY state. Linking to a draft you are about
// to activate is normal authoring; the link checker flags non-active targets as
// a warning rather than refusing them.

// CODE IS LITERAL. A page that documents this syntax - "write [[Page Title]] to
// link" - must not thereby link to a page called "Page Title", and a page that
// does not exist must not become a permanent broken edge in the graph just
// because someone quoted the syntax in an example. The rule is the one every
// Markdown author already knows and the one Obsidian itself uses: text inside a
// fenced block (```...```) or an inline code span (`...`) is shown, not
// interpreted. That gives authors a deliberate escape hatch with no new
// vocabulary to learn, and it is applied at the EXTRACTION seam so every
// consumer - the knowledge_links index behind the graph, the link checker, the
// enrichment gate, and prompt stripping - inherits it from one definition.
//
// Fences are masked before spans so a stray backtick inside a fenced block
// cannot start a phantom span.
const FENCED_RE = /```[\s\S]*?(?:```|$)/g;
const CODE_SPAN_RE = /(`+)(?:[\s\S]*?)\1/g;

/**
 * Blank out code regions, preserving length and newlines so every offset in the
 * returned string still lines up with the original body.
 */
function maskCodeRegions(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return String(text || '').replace(FENCED_RE, blank).replace(CODE_SPAN_RE, blank);
}

/** Matches [[target]] and [[target|label]]. Targets cannot contain [ ] or |. */
const WIKILINK_RE = /\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

/** Normalize any name to its comparison key. */
export function linkKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Extract every wikilink from a body, in document order, deduped by target.
 * Returns [{ target, label, raw }]. `label` is the pipe alias when present.
 */
export function extractWikilinks(body) {
  const out = [];
  const seen = new Set();
  // Scan the MASKED text: a [[link]] written inside code is an example, not a
  // relationship, so it never reaches the index.
  const text = maskCodeRegions(body);
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const target = String(m[1]).trim();
    if (!target) continue;
    const key = linkKey(target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ target, label: m[2] !== undefined ? String(m[2]).trim() : null, raw: m[0] });
  }
  return out;
}

/**
 * Build the lookup index from the entry catalog.
 * `entries` need only carry { id, slug, title, aliases, state }.
 */
export function buildLinkIndex(entries) {
  const bySlug = new Map();
  const byTitle = new Map();
  const byAlias = new Map();

  const add = (map, key, entry) => {
    if (!key) return;
    const hit = map.get(key);
    if (hit === undefined) map.set(key, entry);
    else if (hit && hit.id !== entry.id) map.set(key, null); // null = ambiguous
  };

  for (const e of entries || []) {
    add(bySlug, linkKey(e.slug), e);
    add(byTitle, linkKey(e.title), e);
    for (const a of e.aliases || []) add(byAlias, linkKey(a), e);
  }
  return { bySlug, byTitle, byAlias };
}

export const LINK_STATUS = Object.freeze({
  RESOLVED: 'resolved',
  BROKEN: 'broken',
  AMBIGUOUS: 'ambiguous',
  SELF: 'self',
});

/**
 * Resolve one target against the index.
 * Returns { status, entry, matchedOn }.
 *
 * A page linking to itself resolves to SELF: it is not broken, but it should
 * not create a backlink loop that makes every page look connected.
 */
export function resolveWikilink(target, index, selfId = null) {
  const key = linkKey(target);
  if (!key) return { status: LINK_STATUS.BROKEN, entry: null, matchedOn: null };

  for (const [map, matchedOn] of [[index.bySlug, 'slug'], [index.byTitle, 'title'], [index.byAlias, 'alias']]) {
    if (!map.has(key)) continue;
    const hit = map.get(key);
    if (hit === null) return { status: LINK_STATUS.AMBIGUOUS, entry: null, matchedOn };
    if (selfId && hit.id === selfId) return { status: LINK_STATUS.SELF, entry: hit, matchedOn };
    return { status: LINK_STATUS.RESOLVED, entry: hit, matchedOn };
  }
  return { status: LINK_STATUS.BROKEN, entry: null, matchedOn: null };
}

/**
 * Resolve every link in a body. This is what the endpoint persists.
 * Returns [{ target, label, status, targetEntryId, targetSlug, targetTitle,
 *            targetState, matchedOn }].
 */
export function resolveBodyLinks(body, entries, selfId = null) {
  const index = buildLinkIndex(entries);
  return extractWikilinks(body).map(({ target, label }) => {
    const r = resolveWikilink(target, index, selfId);
    return {
      target,
      label,
      status: r.status,
      matchedOn: r.matchedOn,
      targetEntryId: r.status === LINK_STATUS.RESOLVED ? r.entry.id : null,
      targetSlug: r.entry?.slug ?? null,
      targetTitle: r.entry?.title ?? null,
      targetState: r.entry?.state ?? null,
    };
  });
}

/**
 * Replace [[wikilinks]] with plain prose for prompt injection.
 *
 * Keith must never emit [[...]] to a user: it is vault syntax, meaningless in
 * chat, and it exposes internal page identifiers. `[[Slug|Label]]` becomes
 * "Label"; a bare `[[Target]]` becomes the resolved page's TITLE when it
 * resolves (so the model sees the human name, not a slug), and the literal
 * target text when it does not.
 */
export function stripWikilinksForPrompt(body, entries = []) {
  const index = buildLinkIndex(entries);
  const original = String(body || '');
  // Same rule as extraction: syntax quoted inside code is an EXAMPLE, and an
  // entry that teaches the syntax must still be able to show it to Keith
  // verbatim. Matches are found in the masked copy (whose offsets line up) and
  // spliced out of the original, so code regions pass through untouched.
  const masked = maskCodeRegions(original);
  let out = '';
  let last = 0;
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(masked)) !== null) {
    const [full, target, label] = m;
    const replacement = (label !== undefined && String(label).trim())
      ? String(label).trim()
      : (resolveWikilink(String(target).trim(), index).entry?.title || String(target).trim());
    out += original.slice(last, m.index) + replacement;
    last = m.index + full.length;
  }
  return out + original.slice(last);
}

/** Backlink map: target entry id -> [source entries]. Self-links excluded. */
export function buildBacklinks(links) {
  const map = new Map();
  for (const l of links || []) {
    if (!l.target_entry_id || l.source_entry_id === l.target_entry_id) continue;
    if (!map.has(l.target_entry_id)) map.set(l.target_entry_id, []);
    map.get(l.target_entry_id).push(l.source_entry_id);
  }
  return map;
}
