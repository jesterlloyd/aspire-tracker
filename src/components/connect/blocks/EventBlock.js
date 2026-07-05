// src/components/connect/blocks/EventBlock.js
//
// RICH-COMPOSE-2B - TipTap atom node for the ASPIRE Content Block "Event Details" (info card).
// Scalar plain-text attributes only (title, dateTime, location, format, respondBy). Serializes to
//   <div data-aspire-block="event" data-title data-datetime data-location data-format data-respondby></div>
// which the server (renderContentBlocks.js) extracts, VALIDATES + ESCAPES, and replaces with a branded,
// email-safe event card. parseHTML round-trips the marker; richDoc (TipTap JSON) rehydrates the node
// faithfully (RICH-COMPOSE-2A-1 hydration gate). Mirrors NoteBlock/ButtonBlock.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EventNodeView } from './EventNodeView'

export const EventBlock = Node.create({
  name: 'aspireEvent',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return { requestEdit: null }
  },

  addAttributes() {
    return {
      title:     { default: '', parseHTML: el => el.getAttribute('data-title') || '',     renderHTML: a => ({ 'data-title': a.title || '' }) },
      dateTime:  { default: '', parseHTML: el => el.getAttribute('data-datetime') || '',  renderHTML: a => ({ 'data-datetime': a.dateTime || '' }) },
      location:  { default: '', parseHTML: el => el.getAttribute('data-location') || '',  renderHTML: a => ({ 'data-location': a.location || '' }) },
      format:    { default: '', parseHTML: el => el.getAttribute('data-format') || '',    renderHTML: a => ({ 'data-format': a.format || '' }) },
      respondBy: { default: '', parseHTML: el => el.getAttribute('data-respondby') || '', renderHTML: a => ({ 'data-respondby': a.respondBy || '' }) },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-aspire-block="event"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-aspire-block': 'event' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EventNodeView)
  },

  addCommands() {
    return {
      insertAspireEvent:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              title: attrs?.title || '', dateTime: attrs?.dateTime || '', location: attrs?.location || '',
              format: attrs?.format || '', respondBy: attrs?.respondBy || '',
            },
          }),
    }
  },
})
