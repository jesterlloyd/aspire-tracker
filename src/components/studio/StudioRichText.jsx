// src/components/studio/StudioRichText.jsx
//
// STUDIO-RICH-1 (Owner, 2026-11-08): the inspector's text field is a small TipTap editor with a real
// toolbar (bold, italic, underline, bulleted and numbered lists, link, the merge fields), the same
// packages and icons ASPIRE Connect's composer uses. It still READS and WRITES the light markup a
// design stores (src/lib/studio/studioMarkup.js), so the renderer, Keith, the canvas's inline editor
// and every saved design are unchanged. Enter starts a paragraph, Shift+Enter a line break, and
// "- " or "1. " at the start of a line starts a list.

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon, Unlink } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { markupToDoc, docToMarkup } from '../../lib/studio/studioMarkup'
import { safeUrl } from '../../lib/studio/studioBlocks'

function TBtn({ on, onClick, label, disabled, children }) {
  return (
    <Tooltip label={label} placement="top" disabled={disabled}>
      <button type="button" className="st-rte-btn" aria-label={label} aria-pressed={!!on} disabled={disabled}
        onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
    </Tooltip>
  )
}

const asHref = (raw) => {
  const v = String(raw || '').trim()
  if (!v) return null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return safeUrl(`mailto:${v}`)
  return safeUrl(/^[a-z]+:/i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`)
}

export default function StudioRichText({ value, onChange, rows = 7, label = 'Text', lists = true }) {
  const emitted = useRef(value || '')
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')

  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, strike: false,
        link: false, underline: false,
        ...(lists ? {} : { bulletList: false, orderedList: false, listItem: false, listKeymap: false }),
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false, protocols: ['http', 'https', 'mailto'], validate: (href) => !!safeUrl(href) }),
    ],
    content: markupToDoc(value),
    onUpdate: ({ editor: ed }) => {
      const md = docToMarkup(ed.getJSON())
      emitted.current = md
      onChangeRef.current?.(md)
    },
    editorProps: { attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true', class: 'st-rte-content' } },
  })

  // A change from outside (Undo, Keith's rewrite, the canvas's inline editor) reloads the editor;
  // the value it just emitted does not, so typing never loses the cursor.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const next = value || ''
    if (next === emitted.current) return
    emitted.current = next
    editor.commands.setContent(markupToDoc(next), { emitUpdate: false })
  }, [value, editor])

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => (ed && !ed.isDestroyed ? {
      bold: ed.isActive('bold'), italic: ed.isActive('italic'), underline: ed.isActive('underline'),
      bullet: ed.isActive('bulletList'), ordered: ed.isActive('orderedList'), link: ed.isActive('link'),
    } : {}),
  }) || {}

  const run = (fn) => { if (editor && !editor.isDestroyed) fn(editor.chain().focus()).run() }
  const insert = (text) => run(c => c.insertContent(text))
  const applyLink = () => {
    const href = asHref(linkUrl)
    if (!href) { setLinkError('Use a web address or an email address.'); return }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      run(c => c.insertContent({ type: 'text', text: linkUrl.trim(), marks: [{ type: 'link', attrs: { href } }] }))
    } else {
      run(c => c.extendMarkRange('link').setLink({ href }))
    }
    setLinkOpen(false); setLinkUrl(''); setLinkError('')
  }

  return (
    <div className="st-rte">
      <div className="st-rte-bar" role="toolbar" aria-label="Formatting">
        <TBtn label="Bold (⌘B)" on={state.bold} onClick={() => run(c => c.toggleBold())}><Bold size={15} /></TBtn>
        <TBtn label="Italic (⌘I)" on={state.italic} onClick={() => run(c => c.toggleItalic())}><Italic size={15} /></TBtn>
        <TBtn label="Underline (⌘U)" on={state.underline} onClick={() => run(c => c.toggleUnderline())}><UnderlineIcon size={15} /></TBtn>
        {lists && (<>
          <span className="st-rte-sep" aria-hidden="true" />
          <TBtn label="Bulleted list" on={state.bullet} onClick={() => run(c => c.toggleBulletList())}><List size={15} /></TBtn>
          <TBtn label="Numbered list" on={state.ordered} onClick={() => run(c => c.toggleOrderedList())}><ListOrdered size={15} /></TBtn>
        </>)}
        <span className="st-rte-sep" aria-hidden="true" />
        <TBtn label="Link" on={state.link || linkOpen} onClick={() => {
          setLinkUrl(editor?.getAttributes('link')?.href?.replace(/^mailto:/, '') || '')
          setLinkError(''); setLinkOpen(o => !o)
        }}><LinkIcon size={15} /></TBtn>
        {state.link && <TBtn label="Remove link" onClick={() => run(c => c.extendMarkRange('link').unsetLink())}><Unlink size={15} /></TBtn>}
        <span className="st-rte-sep" aria-hidden="true" />
        <button type="button" className="st-btn st-btn-sm" onMouseDown={e => e.preventDefault()} onClick={() => insert('[First Name]')}>+ First name</button>
        <button type="button" className="st-btn st-btn-sm" onMouseDown={e => e.preventDefault()} onClick={() => insert('[School]')}>+ School</button>
      </div>
      {linkOpen && (
        <div className="st-rte-link">
          <input className="st-input" autoFocus placeholder="https://… or an email address" value={linkUrl}
            aria-label="Link address" aria-invalid={!!linkError}
            onChange={e => { setLinkUrl(e.target.value); setLinkError('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false) } }} />
          <button type="button" className="st-btn st-btn-sm st-btn-primary" onClick={applyLink}>Apply</button>
          <button type="button" className="st-btn st-btn-sm" onClick={() => setLinkOpen(false)}>Cancel</button>
          {linkError && <div className="st-hint" role="alert">{linkError}</div>}
        </div>
      )}
      <EditorContent editor={editor} className="st-rte-box" style={{ '--st-rte-min': `${Math.max(3, rows) * 22}px` }} />
      <div className="st-hint">Enter starts a new paragraph; Shift+Enter a new line. Type “- ” or “1. ” to start a list.</div>
    </div>
  )
}
