// src/components/connect/blocks/DividerBlock.js
//
// RICH-COMPOSE-2A-0 — TipTap atom node for the ASPIRE Content Block "Divider".
// Zero fields. Serializes to the canonical marker `<hr data-aspire-block="divider">`, which the
// server (renderContentBlocks.js) extracts and replaces with a branded, email-safe divider table.
// parseHTML lets the marker round-trip faithfully (paste + draft rehydration from body HTML).

import { Node } from '@tiptap/core'

export const DividerBlock = Node.create({
  name: 'aspireDivider',
  group: 'block',
  atom: true,        // single, indivisible unit — no nested/editable content
  selectable: true,  // can be selected and deleted (Backspace / Delete)
  draggable: false,

  parseHTML() {
    return [{ tag: 'hr[data-aspire-block="divider"]' }]
  },

  renderHTML() {
    return ['hr', { 'data-aspire-block': 'divider' }]
  },

  addCommands() {
    return {
      insertAspireDivider:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
})
