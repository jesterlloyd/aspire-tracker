// src/components/connect/blocks/EventNodeView.jsx
//
// RICH-COMPOSE-2B - in-editor preview for the Event Details atom. Shows a branded card approximation
// (CS-Red top accent, Nightfall title, only populated label/value rows) plus an Edit affordance.
// Click/tap or Enter opens the shared edit modal (via editor.storage.aspireEvent.requestEdit);
// Backspace/Delete removes the block. The server render is authoritative.

import { NodeViewWrapper } from '@tiptap/react'
import { Pencil } from 'lucide-react'

const NAVY = '#1D2567'
const CS_RED = '#dc1e34'
const RAVEN = '#191919'
const F = 'DM Sans, sans-serif'

export function EventNodeView({ node, editor, getPos, deleteNode, selected }) {
  const a = node.attrs
  const rows = [['Date / Time', a.dateTime]]
  if (a.location) rows.push(['Location', a.location])
  if (a.format) rows.push(['Format', a.format])
  if (a.respondBy) rows.push(['Respond by', a.respondBy])

  const openEdit = () => {
    const bridge = editor?.storage?.aspireEvent
    if (bridge && typeof bridge.requestEdit === 'function') {
      bridge.requestEdit(getPos(), { title: a.title || '', dateTime: a.dateTime || '', location: a.location || '', format: a.format || '', respondBy: a.respondBy || '' })
    }
  }

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={{ margin: '12px 0' }} data-aspire-event-nv="true">
      <div
        role="button"
        tabIndex={0}
        title="Edit event"
        onClick={openEdit}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit() }
          if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteNode() }
        }}
        style={{
          position: 'relative', border: '1px solid #e8e4dc', borderTop: `3px solid ${CS_RED}`, borderRadius: 8,
          background: '#f8f9fc', padding: '12px 36px 12px 16px', cursor: 'pointer', fontFamily: F,
          outline: selected ? `2px solid ${NAVY}` : 'none', outlineOffset: 2,
          boxShadow: selected ? '0 0 0 4px rgba(29,37,103,0.14)' : 'none',
        }}
      >
        {a.title && <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, lineHeight: 1.3, marginBottom: 8 }}>{a.title}</div>}
        {rows.map(([label, value], i) => (
          <div key={label} style={{ padding: '6px 0', borderTop: i > 0 ? '1px solid #e8e4dc' : 'none' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#6b7280', marginBottom: 1 }}>{label}</div>
            <div style={{ fontSize: 13, color: RAVEN, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value || '-'}</div>
          </div>
        ))}
        <span aria-hidden="true" style={{ position: 'absolute', top: 10, right: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid rgba(29,37,103,0.14)', borderRadius: 6, background: '#fff', color: '#6b7280' }}>
          <Pencil size={13} />
        </span>
      </div>
    </NodeViewWrapper>
  )
}
