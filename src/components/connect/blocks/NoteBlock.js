// src/components/connect/blocks/NoteBlock.js
//
// RICH-COMPOSE-2A-3 - TipTap atom node for the ASPIRE Content Block "Note" (branded callout).
// Scalar attributes (title, body - plain text; optional mailto) only. Serializes to the marker
//   <div data-aspire-block="note" data-title="..." data-body="..." [data-mailto="..."]></div>
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
      // PRECEPTOR-ATTACHMENT-REMINDER-1: one optional address the SERVER turns
      // into a mailto: link inside the escaped note body. It round-trips here
      // so editing the draft - or the editor re-serializing its own document -
      // cannot quietly drop the link. Absent on every hand-authored note, whose
      // marker is then byte-identical to before.
      mailto: {
        default: '',
        parseHTML: el => el.getAttribute('data-mailto') || '',
        renderHTML: attrs => (attrs.mailto ? { 'data-mailto': attrs.mailto } : {}),
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
          commands.insertContent({ type: this.name, attrs: { title: attrs?.title || '', body: attrs?.body || '', mailto: attrs?.mailto || '' } }),
    }
  },
})
