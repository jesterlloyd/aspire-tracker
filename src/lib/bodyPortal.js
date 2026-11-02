// DRAWER-PORTAL-1 (2026-11-01): draw a fixed overlay on <body>, so no stacking context, transform or
// containment above it decides what it paints over. A server render (the render tests)
// has no document, so the node renders in place there.
import { createPortal } from 'react-dom'

export function bodyPortal(node) {
  return typeof document === 'undefined' ? node : createPortal(node, document.body)
}
