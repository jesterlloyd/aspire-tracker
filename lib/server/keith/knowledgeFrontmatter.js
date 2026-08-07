// KNOWLEDGE-VAULT-1: YAML frontmatter at the import/export boundary ONLY.
//
// The database stays the governed source of truth (plan Section 2.4, option 1).
// Frontmatter exists so a vault folder can be exported to disk, opened in
// Obsidian, and imported back without loss. Nothing in the running app reads or
// writes YAML - metadata lives in real columns so retrieval and governance can
// query it.
//
// This is a DELIBERATELY TINY YAML subset, not a YAML parser. It handles exactly
// the shapes this app emits: scalars, quoted scalars, flow sequences [a, b], and
// block sequences (- item). Anything else is preserved as a raw string rather
// than guessed at. A real YAML parser would be a new dependency and a much
// larger attack surface for a format we control both ends of.
//
// SAFETY: parsing never evaluates anything, never resolves references, and
// never constructs objects from type tags. The output is always a flat object
// of strings and string arrays.

/** Keys we round-trip. Anything else in a file's frontmatter is ignored on
 *  import (reported as a warning) rather than silently written somewhere. */
export const FRONTMATTER_KEYS = Object.freeze([
  'title', 'slug', 'category', 'state', 'body_format', 'aliases', 'tags',
  'precedence_rank', 'source_attribution', 'effective_date', 'expires_at',
  'review_date', 'confidence', 'version',
]);

/** Keys whose value is a list. Everything else is a scalar. */
const LIST_KEYS = new Set(['aliases', 'tags']);

const FENCE = '---';

function needsQuoting(s) {
  const v = String(s);
  if (v === '') return true;
  // Quote anything that could be read as structure, a number, or a boolean.
  return /^[\s>|*&!%@`?-]|[:#]\s|[:#]$|^(true|false|null|yes|no|on|off|~)$/i.test(v)
    || /^-?\d+(\.\d+)?$/.test(v)
    || /[\n"']/.test(v)
    || v !== v.trim();
}

function quote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function scalar(s) {
  const v = String(s ?? '');
  return needsQuoting(v) ? quote(v) : v;
}

function unquote(raw) {
  const v = String(raw ?? '').trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    const inner = v.slice(1, -1);
    return v[0] === '"'
      ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : inner.replace(/''/g, "'");
  }
  return v;
}

/**
 * Serialize an entry to a Markdown file with YAML frontmatter.
 * Empty and null values are OMITTED rather than written as empty keys, so a
 * round trip does not invent fields the entry never had.
 */
export function serializeEntryFile(entry) {
  const lines = [FENCE];
  for (const key of FRONTMATTER_KEYS) {
    const value = entry?.[key];
    if (value === undefined || value === null) continue;
    if (LIST_KEYS.has(key)) {
      const list = Array.isArray(value) ? value.filter(v => String(v).trim()) : [];
      if (!list.length) continue;
      lines.push(`${key}: [${list.map(scalar).join(', ')}]`);
    } else {
      const v = String(value);
      if (v === '') continue;
      lines.push(`${key}: ${scalar(v)}`);
    }
  }
  lines.push(FENCE, '');
  return `${lines.join('\n')}${String(entry?.body ?? '')}`;
}

/**
 * Parse a Markdown file into { data, body, warnings }.
 *
 * A file with no frontmatter is NOT an error: it parses as all-body, which is
 * how a plain note dragged in from elsewhere should behave. `warnings` names
 * unknown keys and malformed lines so an import can report them instead of
 * dropping them silently.
 */
export function parseEntryFile(source) {
  // A file exported from Obsidian on Windows can carry a UTF-8 BOM, which
  // would otherwise make the opening --- fence fail to match.
  const text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const warnings = [];

  if (!text.startsWith(`${FENCE}\n`)) {
    return { data: {}, body: text, warnings: ['no_frontmatter'] };
  }
  const end = text.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) {
    return { data: {}, body: text, warnings: ['unterminated_frontmatter'] };
  }

  const head = text.slice(FENCE.length + 1, end);
  // Body starts after the closing fence's own line.
  const afterFence = text.indexOf('\n', end + 1 + FENCE.length);
  const body = afterFence === -1 ? '' : text.slice(afterFence + 1);

  const data = {};
  const lines = head.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) { warnings.push(`malformed_line:${i + 1}`); continue; }
    const key = m[1];
    let rest = m[2];

    if (!FRONTMATTER_KEYS.includes(key)) { warnings.push(`unknown_key:${key}`); continue; }

    if (LIST_KEYS.has(key)) {
      if (rest.trim().startsWith('[')) {
        const inner = rest.trim().replace(/^\[/, '').replace(/\]$/, '');
        data[key] = splitFlow(inner).map(unquote).filter(Boolean);
      } else if (rest.trim() === '') {
        // Block sequence: consume following "- item" lines.
        const items = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          items.push(unquote(lines[i + 1].replace(/^\s*-\s+/, '')));
          i++;
        }
        data[key] = items.filter(Boolean);
      } else {
        // A bare scalar where a list belongs: accept it as a single-item list
        // rather than discarding what the author wrote.
        data[key] = [unquote(rest)].filter(Boolean);
      }
      continue;
    }

    data[key] = unquote(rest);
  }

  return { data, body, warnings };
}

/** Split a flow sequence on commas that are not inside quotes. */
function splitFlow(inner) {
  const out = [];
  let cur = '';
  let quoteCh = null;
  for (const ch of String(inner)) {
    if (quoteCh) {
      if (ch === quoteCh) quoteCh = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quoteCh = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

/** A filesystem-safe filename for an entry, stable across exports. */
export function entryFilename(entry) {
  const base = String(entry?.slug || entry?.title || 'untitled')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return `${base || 'untitled'}.md`;
}
