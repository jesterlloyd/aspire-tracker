// src/lib/keithMarkdown.js
// KEITH-CHAT-UX-1 - tiny, dependency-free, safe Markdown-subset renderer for Keith's assistant
// messages. Returns an array of React ELEMENTS (never an HTML string, never dangerouslySetInnerHTML),
// so every text node is escaped by React automatically - there is no HTML/script injection surface.
//
// Supported subset (enough to stop Keith's emphasis/lists from showing as raw asterisks):
//   • paragraphs (blank-line separated, soft line breaks preserved)
//   • bullet lists    -, *, •
//   • numbered lists  1. / 1)
//   • headings        # .. ###### (rendered as a bold line)
//   • **bold**  *italic*  `code`
//   • [label](url) - href allowed ONLY for http(s):// and mailto: ; any other scheme renders the
//     label as plain text with no href.
// Anything else (including any raw <tag> such as <u>, <script>, <img onerror=…>) is rendered as
// literal, escaped text. Underline is intentionally unsupported (Markdown has none; raw <u> is shown
// as text, not HTML).

import React from 'react';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const LINK_STYLE = { color: '#1d4ed8', textDecoration: 'underline', wordBreak: 'break-word' };
const CODE_STYLE = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.9em', background: '#eef2ff', borderRadius: '4px', padding: '1px 4px',
};

// KNOWLEDGE-VAULT-1: wikilink chip styling. Broken and ambiguous targets are
// marked by SHAPE (dashed border + a title explaining why), never by color
// alone, so the state survives a monochrome print or a color-blind reader.
const WIKI_OK_STYLE = {
  color: '#1D2567', background: '#eef2fb', borderRadius: '4px',
  padding: '0 4px', cursor: 'pointer', textDecoration: 'none',
  border: '1px solid transparent',
};
const WIKI_BROKEN_STYLE = {
  color: '#b45309', background: '#fffbeb', borderRadius: '4px',
  padding: '0 4px', border: '1px dashed #f59e0b',
};

// Ordered alternation: wikilink | link | **bold** | `code` | *italic*.
// The wikilink alternative is FIRST so [[a]] is never mis-parsed as a [link]().
const INLINE_RE = /(\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\])|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/;

// `opts.resolveWikilink(target)` -> { status, slug, title } | null. Absent in
// Keith chat, where wikilinks are already stripped server-side and any stray
// [[...]] should simply render as a plain chip.
function renderInline(text, keyBase, opts = {}) {
  const out = [];
  let rest = String(text);
  let n = 0;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1]) {                              // [[target]] or [[target|label]]
      const target = String(m[2]).trim();
      const label = m[3] !== undefined && String(m[3]).trim() ? String(m[3]).trim() : target;
      const hit = typeof opts.resolveWikilink === 'function' ? opts.resolveWikilink(target) : null;
      const broken = !hit || hit.status !== 'resolved';
      out.push(React.createElement('span', {
        key,
        style: broken ? WIKI_BROKEN_STYLE : WIKI_OK_STYLE,
        title: broken
          ? (hit?.status === 'ambiguous'
            ? `"${target}" matches more than one entry`
            : `No entry matches "${target}"`)
          : `${hit.title || target}`,
        role: broken || !opts.onWikilinkClick ? undefined : 'button',
        tabIndex: broken || !opts.onWikilinkClick ? undefined : 0,
        onClick: broken || !opts.onWikilinkClick ? undefined : () => opts.onWikilinkClick(hit),
        onKeyDown: broken || !opts.onWikilinkClick ? undefined : (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onWikilinkClick(hit); }
        },
      }, label));
    } else if (m[4]) {                        // [label](url)
      const url = m[6].trim();
      if (SAFE_URL.test(url)) {
        out.push(React.createElement('a',
          { key, href: url, target: '_blank', rel: 'noopener noreferrer', style: LINK_STYLE }, m[5]));
      } else {
        out.push(m[5]);                      // unsafe scheme → label as plain text, no href
      }
    } else if (m[7]) {                        // **bold**
      out.push(React.createElement('strong', { key }, m[8]));
    } else if (m[9]) {                        // `code`
      out.push(React.createElement('code', { key, style: CODE_STYLE }, m[10]));
    } else if (m[11]) {                       // *italic*
      out.push(React.createElement('em', { key }, m[12]));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const BULLET_RE  = /^\s*[-*•]\s+(.*)$/;
const NUM_RE     = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;

// KEITH-MARKDOWN-LISTS-1: collect a contiguous run of list items of ONE type (matcher). Tolerates
// blank lines BETWEEN items (Markdown "loose" lists) so adjacent items stay in a single <ul>/<ol>
// instead of splitting into one-item lists (which made every ordered item restart at "1."). A blank
// line followed by a non-list line (or a list line of the other type) ends the run. Returns the raw
// item texts and the index of the first line after the list.
function gatherListItems(lines, start, matcher) {
  const contents = [];
  let i = start;
  while (i < lines.length) {
    if (matcher.test(lines[i])) {
      contents.push(lines[i].match(matcher)[1]);
      i++;
      continue;
    }
    if (!lines[i].trim()) {
      // Peek past blank line(s): continue the list only if the next non-blank line is the same type.
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && matcher.test(lines[j])) { i = j; continue; }
    }
    break;
  }
  return { contents, next: i };
}

// KNOWLEDGE-VAULT-1: GitHub-style pipe tables. A row is a line containing at
// least one unescaped pipe; the second line must be the delimiter (---, :---,
// ---:). Without a delimiter row the lines stay a paragraph, so prose that
// happens to contain a pipe is never swallowed into a table.
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const looksLikeRow = (line) => typeof line === 'string' && line.includes('|') && line.trim() !== '';

function splitRow(line) {
  return String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

const TH_STYLE = {
  textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #e5e7eb',
  fontWeight: 700, fontSize: '0.95em', whiteSpace: 'nowrap',
};
const TD_STYLE = { padding: '6px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };

export function renderMarkdownLite(text, opts = {}) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0, k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }      // blank line → paragraph separator

    // Table: a header row followed by a delimiter row.
    if (looksLikeRow(line) && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1])) {
      const header = splitRow(line);
      const body = [];
      let j = i + 2;
      while (j < lines.length && looksLikeRow(lines[j])) { body.push(splitRow(lines[j])); j++; }
      const thead = React.createElement('thead', { key: `th${k}` },
        React.createElement('tr', null, header.map((c, ci) =>
          React.createElement('th', { key: `h${k}-${ci}`, style: TH_STYLE }, renderInline(c, `hc${k}-${ci}`, opts)))));
      const tbody = React.createElement('tbody', { key: `tb${k}` },
        body.map((row, ri) => React.createElement('tr', { key: `r${k}-${ri}` },
          // Pad short rows to the header width so the grid never goes ragged.
          header.map((_h, ci) => React.createElement('td',
            { key: `c${k}-${ri}-${ci}`, style: TD_STYLE }, renderInline(row[ci] ?? '', `cc${k}-${ri}-${ci}`, opts))))));
      blocks.push(React.createElement('div',
        { key: `b${k}`, style: { overflowX: 'auto', margin: '8px 0' } },
        React.createElement('table',
          { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.95em' } }, [thead, tbody])));
      k++;
      i = j;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const { contents, next } = gatherListItems(lines, i, BULLET_RE);
      const items = contents.map((c, idx) => React.createElement('li',
        { key: `li${k}-${idx}`, style: { marginBottom: '2px' } }, renderInline(c, `bi${k}-${idx}`, opts)));
      blocks.push(React.createElement('ul',
        { key: `b${k++}`, style: { margin: '4px 0', paddingLeft: '20px', listStyleType: 'disc' } }, items));
      i = next;
      continue;
    }

    if (NUM_RE.test(line)) {
      const { contents, next } = gatherListItems(lines, i, NUM_RE);
      // The browser numbers the <ol>; we never rely on the source digit, so "1. / 1. / 1." and
      // "1. / 2. / 3." both render as an incrementing list.
      const items = contents.map((c, idx) => React.createElement('li',
        { key: `li${k}-${idx}`, style: { marginBottom: '2px' } }, renderInline(c, `ni${k}-${idx}`, opts)));
      blocks.push(React.createElement('ol',
        { key: `b${k++}`, style: { margin: '4px 0', paddingLeft: '20px', listStyleType: 'decimal' } }, items));
      i = next;
      continue;
    }

    const hm = line.match(HEADING_RE);
    if (hm) {
      blocks.push(React.createElement('p', { key: `b${k++}`, style: { margin: '4px 0 2px', fontWeight: 700 } },
        renderInline(hm[1], `h${k}`, opts)));
      i++;
      continue;
    }

    // Paragraph: gather consecutive plain lines; soft-break with <br>. A line
    // that begins a table (row + delimiter) ends the paragraph.
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !BULLET_RE.test(lines[i]) && !NUM_RE.test(lines[i]) && !HEADING_RE.test(lines[i])
      && !(looksLikeRow(lines[i]) && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1]))) {
      para.push(lines[i]); i++;
    }
    const children = [];
    para.forEach((pl, idx) => {
      if (idx > 0) children.push(React.createElement('br', { key: `br${k}-${idx}` }));
      renderInline(pl, `p${k}-${idx}`, opts).forEach(node => children.push(node));
    });
    blocks.push(React.createElement('p', { key: `b${k++}`, style: { margin: '0 0 6px' } }, children));
  }

  return blocks;
}
