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

// Ordered alternation: link | **bold** | `code` | *italic*. Non-nested (subset).
const INLINE_RE = /(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/;

function renderInline(text, keyBase) {
  const out = [];
  let rest = String(text);
  let n = 0;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1]) {                              // [label](url)
      const url = m[3].trim();
      if (SAFE_URL.test(url)) {
        out.push(React.createElement('a',
          { key, href: url, target: '_blank', rel: 'noopener noreferrer', style: LINK_STYLE }, m[2]));
      } else {
        out.push(m[2]);                      // unsafe scheme → label as plain text, no href
      }
    } else if (m[4]) {                        // **bold**
      out.push(React.createElement('strong', { key }, m[5]));
    } else if (m[6]) {                        // `code`
      out.push(React.createElement('code', { key, style: CODE_STYLE }, m[7]));
    } else if (m[8]) {                        // *italic*
      out.push(React.createElement('em', { key }, m[9]));
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

export function renderMarkdownLite(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0, k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }      // blank line → paragraph separator

    if (BULLET_RE.test(line)) {
      const { contents, next } = gatherListItems(lines, i, BULLET_RE);
      const items = contents.map((c, idx) => React.createElement('li',
        { key: `li${k}-${idx}`, style: { marginBottom: '2px' } }, renderInline(c, `bi${k}-${idx}`)));
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
        { key: `li${k}-${idx}`, style: { marginBottom: '2px' } }, renderInline(c, `ni${k}-${idx}`)));
      blocks.push(React.createElement('ol',
        { key: `b${k++}`, style: { margin: '4px 0', paddingLeft: '20px', listStyleType: 'decimal' } }, items));
      i = next;
      continue;
    }

    const hm = line.match(HEADING_RE);
    if (hm) {
      blocks.push(React.createElement('p', { key: `b${k++}`, style: { margin: '4px 0 2px', fontWeight: 700 } },
        renderInline(hm[1], `h${k}`)));
      i++;
      continue;
    }

    // Paragraph: gather consecutive plain lines; soft-break with <br>.
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !BULLET_RE.test(lines[i]) && !NUM_RE.test(lines[i]) && !HEADING_RE.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    const children = [];
    para.forEach((pl, idx) => {
      if (idx > 0) children.push(React.createElement('br', { key: `br${k}-${idx}` }));
      renderInline(pl, `p${k}-${idx}`).forEach(node => children.push(node));
    });
    blocks.push(React.createElement('p', { key: `b${k++}`, style: { margin: '0 0 6px' } }, children));
  }

  return blocks;
}
