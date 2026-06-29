// src/components/connect/blocks/ButtonNodeView.jsx
//
// RICH-COMPOSE-2A-2 — in-editor preview for the Linked Button atom. Shows a branded Cedars-Sinai
// button approximation (not pixel-perfect; the server render is authoritative) plus an Edit affordance.
// Click/tap or Enter opens the shared edit modal (via editor.storage.aspireButton.requestEdit);
// Backspace/Delete removes the block. No drag/drop.

import { NodeViewWrapper } from '@tiptap/react'
import { Pencil } from 'lucide-react'

const CS_RED = '#dc1e34'
const F = 'DM Sans, sans-serif'

export function ButtonNodeView({ node, editor, getPos, deleteNode, selected }) {
  const label = node.attrs.label || 'Button'

  const openEdit = () => {
    const bridge = editor?.storage?.aspireButton
    if (bridge && typeof bridge.requestEdit === 'function') {
      bridge.requestEdit(getPos(), { label: node.attrs.label || '', url: node.attrs.url || '' })
    }
  }

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}
      data-aspire-button-nv="true"
    >
      <span
        role="button"
        tabIndex={0}
        title="Edit button"
        onClick={openEdit}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit() }
          if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteNode() }
        }}
        style={{
          display: 'inline-block', background: CS_RED, color: '#fff', fontFamily: F, fontSize: 14,
          fontWeight: 600, padding: '10px 22px', borderRadius: 6, cursor: 'pointer', userSelect: 'none',
          outline: selected ? `2px solid ${CS_RED}` : 'none', outlineOffset: 2,
          boxShadow: selected ? '0 0 0 4px rgba(220,30,52,0.18)' : 'none',
          maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{label}</span>
      <button
        type="button"
        onClick={openEdit}
        aria-label="Edit button block"
        title="Edit button"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, border: '1px solid rgba(29,37,103,0.14)', borderRadius: 7, background: '#fff', color: '#6b7280', cursor: 'pointer', padding: 0 }}
      ><Pencil size={14} /></button>
    </NodeViewWrapper>
  )
}
