// src/components/connect/blocks/ButtonBlock.js
//
// RICH-COMPOSE-2A-2 - TipTap atom node for the ASPIRE Content Block "Linked Button".
// Scalar attributes (label, url) only. Serializes to the canonical marker
//   <div data-aspire-block="button" data-label="..." data-url="..."></div>
// which the server (renderContentBlocks.js) extracts, VALIDATES, and replaces with a branded,
// email-safe Cedars-Sinai button table. parseHTML round-trips the marker; richDoc (TipTap JSON)
// rehydrates the node faithfully with its label/url (RICH-COMPOSE-2A-1 hydration gate).
//
// The in-editor preview + click-to-edit is the ReactNodeView (ButtonNodeView). Editing is done through
// the shared modal owned by RichTextEditor; the NodeView reaches it via editor.storage.aspireButton.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ButtonNodeView } from './ButtonNodeView'

/** The attributes a button carries: a web address, or a Catalog form (OUTREACH-FORM-BUTTON-1). */
export const buttonAttrs = (a = {}) => a.form
  ? { label: a.label || '', url: '', form: a.form, formTitle: a.formTitle || '', due: a.due || '', reminders: a.reminders || '' }
  : { label: a.label || '', url: a.url || '', form: '', formTitle: '', due: '', reminders: '' }

export const ButtonBlock = Node.create({
  name: 'aspireButton',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    // Bridge set by RichTextEditor so a NodeView's "edit" can open the shared modal.
    return { requestEdit: null }
  },

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: el => el.getAttribute('data-label') || '',
        renderHTML: attrs => ({ 'data-label': attrs.label || '' }),
      },
      url: {
        default: '',
        parseHTML: el => el.getAttribute('data-url') || '',
        renderHTML: attrs => ({ 'data-url': attrs.url || '' }),
      },
      // OUTREACH-FORM-BUTTON-1: a button that opens a Catalog form names the FORM; the send path
      // puts each recipient's own link in data-url (lib/server/forms/outreachButtons.js).
      form: {
        default: '',
        parseHTML: el => el.getAttribute('data-form') || '',
        renderHTML: attrs => (attrs.form ? { 'data-form': attrs.form } : {}),
      },
      formTitle: {
        default: '',
        parseHTML: el => el.getAttribute('data-form-title') || '',
        renderHTML: attrs => (attrs.form && attrs.formTitle ? { 'data-form-title': attrs.formTitle } : {}),
      },
      due: {
        default: '',
        parseHTML: el => el.getAttribute('data-due') || '',
        renderHTML: attrs => (attrs.form && attrs.due ? { 'data-due': attrs.due } : {}),
      },
      reminders: {
        default: '',
        parseHTML: el => el.getAttribute('data-reminders') || '',
        renderHTML: attrs => (attrs.form && attrs.reminders ? { 'data-reminders': attrs.reminders } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-aspire-block="button"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-aspire-block': 'button' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButtonNodeView)
  },

  addCommands() {
    return {
      insertAspireButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: buttonAttrs(attrs) }),
    }
  },
})
