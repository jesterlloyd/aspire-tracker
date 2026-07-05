// src/components/connect/blocks/NoteBlock.js
//
// RICH-COMPOSE-2A-3 - TipTap atom node for the ASPIRE Content Block "Note" (branded callout).
// Scalar attributes (title, body - plain text) only. Serializes to the canonical marker
//   <div data-aspire-block="note" data-title="..." data-body="..."></div>
// which the server (renderContentBlocks.js) extracts, VALIDATES + ESCAPES, and replaces with a
// branded, email-safe callout table. parseHTML round-trips the marker; richDoc (TipTap JSON)
// rehydrates the node faithfully with its title/body (RICH-COMPOSE-2A-1 hydration gate).
//
// Mirrors ButtonBlock. The in-editor preview + click-to-edit is ReactNodeView (NoteNodeView); editing
// uses the shared modal owned by RichTextEditor, reached via editor.storage.aspireNote.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { NoteNodeView } from './NoteNodeView'

export const NoteBlock = Node.create({
  name: 'aspireNote',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return { requestEdit: null }
  },

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: el => el.getAttribute('data-title') || '',
        renderHTML: attrs => ({ 'data-title': attrs.title || '' }),
      },
      body: {
        default: '',
        parseHTML: el => el.getAttribute('data-body') || '',
        renderHTML: attrs => ({ 'data-body': attrs.body || '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-aspire-block="note"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-aspire-block': 'note' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteNodeView)
  },

  addCommands() {
    return {
      insertAspireNote:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { title: attrs?.title || '', body: attrs?.body || '' } }),
    }
  },
})
