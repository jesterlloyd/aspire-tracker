// src/lib/keithMarkdown.js
// KEITH-CHAT-UX-1 — tiny, dependency-free, safe Markdown-subset renderer for Keith's assistant
// messages. Returns an array of React ELEMENTS (never an HTML string, never dangerouslySetInnerHTML),
// so every text node is escaped by React automatically — there is no HTML/script injection surface.
//
// Supported subset (enough to stop Keith's emphasis/lists from showing as raw asterisks):
//   • paragraphs (blank-line separated, soft line breaks preserved)
//   • bullet lists    -, *, •
//   • numbered lists  1. / 1)
//   • headings        # .. ###### (rendered as a bold line)
//   • **bold**  *italic*  `code`
//   • [label](url) — href allowed ONLY for http(s):// and mailto: ; any other scheme renders the
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

export function renderMarkdownLite(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0, k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }      // blank line → paragraph separator

    if (BULLET_RE.test(line)) {
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(React.createElement('li', { key: `li${k}-${items.length}`, style: { marginBottom: '2px' } },
          renderInline(lines[i].match(BULLET_RE)[1], `bi${k}-${items.length}`)));
        i++;
      }
      blocks.push(React.createElement('ul', { key: `b${k++}`, style: { margin: '4px 0', paddingLeft: '20px' } }, items));
      continue;
    }

    if (NUM_RE.test(line)) {
      const items = [];
      while (i < lines.length && NUM_RE.test(lines[i])) {
        items.push(React.createElement('li', { key: `li${k}-${items.length}`, style: { marginBottom: '2px' } },
          renderInline(lines[i].match(NUM_RE)[1], `ni${k}-${items.length}`)));
        i++;
      }
      blocks.push(React.createElement('ol', { key: `b${k++}`, style: { margin: '4px 0', paddingLeft: '20px' } }, items));
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
