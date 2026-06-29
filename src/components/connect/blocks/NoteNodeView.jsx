// src/components/connect/blocks/NoteNodeView.jsx
//
// RICH-COMPOSE-2A-3 — in-editor preview for the Note atom. Shows a branded callout approximation
// (Nightfall left accent + title, soft tint, body) plus an Edit affordance. Click/tap or Enter opens
// the shared edit modal (via editor.storage.aspireNote.requestEdit); Backspace/Delete removes the
// block. The server render is authoritative; this is a lightweight approximation.

import { NodeViewWrapper } from '@tiptap/react'
import { Pencil } from 'lucide-react'

const NAVY = '#1D2567'
const RAVEN = '#191919'
const F = 'DM Sans, sans-serif'

export function NoteNodeView({ node, editor, getPos, deleteNode, selected }) {
  const title = node.attrs.title || ''
  const body = node.attrs.body || ''

  const openEdit = () => {
    const bridge = editor?.storage?.aspireNote
    if (bridge && typeof bridge.requestEdit === 'function') {
      bridge.requestEdit(getPos(), { title, body })
    }
  }

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={{ margin: '12px 0' }} data-aspire-note-nv="true">
      <div
        role="button"
        tabIndex={0}
        title="Edit note"
        onClick={openEdit}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit() }
          if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteNode() }
        }}
        style={{
          position: 'relative', background: '#f4f5f9', borderLeft: `3px solid ${NAVY}`, borderRadius: '0 6px 6px 0',
          padding: '12px 36px 12px 14px', cursor: 'pointer', fontFamily: F,
          outline: selected ? `2px solid ${NAVY}` : 'none', outlineOffset: 2,
          boxShadow: selected ? '0 0 0 4px rgba(29,37,103,0.14)' : 'none',
        }}
      >
        {title && <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, marginBottom: 4, lineHeight: 1.4 }}>{title}</div>}
        <div style={{ fontSize: 13, color: RAVEN, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>{body || 'Note'}</div>
        <span aria-hidden="true" style={{ position: 'absolute', top: 8, right: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid rgba(29,37,103,0.14)', borderRadius: 6, background: '#fff', color: '#6b7280' }}>
          <Pencil size={13} />
        </span>
      </div>
    </NodeViewWrapper>
  )
}
