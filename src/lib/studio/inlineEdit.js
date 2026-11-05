// src/lib/studio/inlineEdit.js
//
// STUDIO-INLINE-1: the canvas edits a block's words in place. The renderer marks each editable
// element with data-st-edit="<path>" (canvas only); these two helpers read and write the prop that
// path names, so the edit lands exactly where the Content tab would have put it, and the design is
// still sanitized by the catalog afterwards. A path is a prop name, or a dotted path into one
// ("left.title", "items.2.text"). Nothing here touches HTML: the editor edits the stored text,
// with its **bold**, [links](https://...) and [First Name] intact.

const SAFE = /^[A-Za-z][A-Za-z0-9]*(\.(\d+|[A-Za-z][A-Za-z0-9]*))*$/

export function isEditPath(path) {
  return typeof path === 'string' && path.length <= 40 && SAFE.test(path)
}

export function getAt(props, path) {
  if (!isEditPath(path)) return ''
  let cur = props
  for (const k of path.split('.')) {
    if (cur == null) return ''
    cur = cur[k]
  }
  return typeof cur === 'string' ? cur : ''
}

/** A copy of props with the string at path replaced. Arrays and objects on the way are copied, never mutated. */
export function setAt(props, path, value) {
  if (!isEditPath(path)) return props
  const keys = path.split('.')
  const walk = (node, i) => {
    const k = keys[i]
    const base = Array.isArray(node) ? [...node] : { ...(node || {}) }
    base[k] = i === keys.length - 1 ? String(value ?? '') : walk(node?.[k], i + 1)
    return base
  }
  return walk(props, 0)
}

// Fields that hold paragraphs: Enter makes a new line, Cmd/Ctrl+Enter finishes.
// Everything else is one line: Enter finishes.
const MULTILINE = new Set(['text', 'details', 'caption', 'subhead'])
export function isMultiline(blockType, path) {
  const last = String(path).split('.').pop()
  if (blockType === 'heading' && last === 'text') return false
  return MULTILINE.has(last)
}
