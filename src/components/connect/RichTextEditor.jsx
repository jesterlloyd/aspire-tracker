// src/components/connect/RichTextEditor.jsx
//
// RICH-COMPOSE-1 Phase 1 — compact, iPad-friendly rich-text editor for ASPIRE Connect manual emails.
// TipTap (ProseMirror) constrained to the Phase 1 subset: bold, italic, underline, bulleted list,
// numbered list, safe links, and clear-formatting. NO tables/images/fonts/colors (later phases).
//
// The editor's getHTML() output is the draft body when bodyFormat === 'html'. It is UX-only safety:
// the authoritative trust boundary is the server sanitizer (lib/server/connect/sanitizeEmailHtml.js),
// which re-sanitizes every body before it reaches the email shell.

import { useEffect, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon, Unlink, RemoveFormatting } from 'lucide-react'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const SAFE_LINK = /^(https?:\/\/|mailto:)/i

// Module-level toolbar button (hoisted out of the editor render so it is not recreated each render).
function TBtn({ on, onClick, label, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={!!on}
      title={label}
      style={{
        minWidth: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid ' + (on ? NAVY : 'rgba(29,37,103,0.14)'), borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? NAVY : '#fff', color: on ? '#fff' : '#4A5560', padding: 0,
      }}
    >{children}</button>
  )
}

// Normalize a user-entered URL to a safe scheme. Returns a safe href or null if it can't be made safe.
// Choice (reported): protocol-less input is normalized to https:// (and email-looking input to mailto:).
function normalizeUrl(raw) {
  const v = String(raw || '').trim()
  if (!v) return null
  if (SAFE_LINK.test(v)) return v
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  if (/^(javascript|data|vbscript|file):/i.test(v)) return null // never allow
  const httpsy = `https://${v.replace(/^\/+/, '')}`
  return SAFE_LINK.test(httpsy) ? httpsy : null
}

export default function RichTextEditor({ html = '', onChange, disabled = false, ariaLabel = 'Message', minHeight = 160 }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')

  const editor = useEditor({
    immediatelyRender: true,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Disable everything outside the Phase 1 subset; use standalone Underline/Link below.
        heading: false, blockquote: false, codeBlock: false, code: false,
        horizontalRule: false, strike: false, link: false, underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        validate: (href) => SAFE_LINK.test(href),
      }),
    ],
    content: html || '',
    // Emit '' for a truly empty doc (TipTap returns '<p></p>') so draft "emptiness" checks and the
    // pristine/discard logic in the composers behave the same as the plain-text textarea.
    onUpdate: ({ editor }) => { onChange?.(editor.isEmpty ? '' : editor.getHTML()) },
    editorProps: {
      attributes: { 'aria-label': ariaLabel, role: 'textbox', 'aria-multiline': 'true', class: 'rte-content' },
    },
  })

  // Keep editor in sync when the body changes EXTERNALLY (template load, draft restore, discard).
  // Guarded by an equality check so typing (which already emits onChange) never loops.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = html || ''
    if (next !== current) editor.commands.setContent(next, { emitUpdate: false })
  }, [html, editor])

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  const applyLink = useCallback(() => {
    const safe = normalizeUrl(linkUrl)
    if (!safe) { setLinkError('Enter a valid http, https, or email link.'); return }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: safe }).run()
    setLinkOpen(false); setLinkUrl(''); setLinkError('')
  }, [editor, linkUrl])

  const openLink = useCallback(() => {
    if (!editor) return
    // Require a non-empty selection OR an existing link to edit (Phase 1: links wrap visible text).
    const { empty } = editor.state.selection
    if (empty && !editor.isActive('link')) { setLinkError('Select the text to link first.'); setLinkOpen(true); return }
    const prev = editor.getAttributes('link')?.href || ''
    setLinkUrl(prev); setLinkError(''); setLinkOpen(true)
  }, [editor])

  if (!editor) {
    return <div style={{ minHeight, border: '1.5px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
  }

  const sep = <span style={{ width: 1, alignSelf: 'stretch', background: '#ececec', margin: '2px 2px' }} />

  return (
    <div>
      <style>{`
        .rte-content{outline:none;min-height:${minHeight}px;padding:10px 13px;font-size:13px;line-height:1.6;color:#191919;font-family:${F};}
        .rte-content p{margin:0 0 10px;} .rte-content p:last-child{margin-bottom:0;}
        .rte-content ul,.rte-content ol{margin:0 0 10px;padding-left:22px;}
        .rte-content li{margin:2px 0;}
        .rte-content a{color:${NAVY};text-decoration:underline;}
        .rte-content:empty:before{content:attr(data-placeholder);color:#9ca3af;}
      `}</style>

      {/* Compact toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: 6, border: '1.5px solid #e5e7eb', borderBottom: 'none', borderRadius: '8px 8px 0 0', background: '#faf9f7' }}>
        <TBtn on={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold"><Bold size={15} /></TBtn>
        <TBtn on={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic"><Italic size={15} /></TBtn>
        <TBtn on={editor.isActive('underline')} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Underline"><UnderlineIcon size={15} /></TBtn>
        {sep}
        <TBtn on={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bulleted list"><List size={15} /></TBtn>
        <TBtn on={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list"><ListOrdered size={15} /></TBtn>
        {sep}
        <TBtn on={editor.isActive('link') || linkOpen} disabled={disabled} onClick={openLink} label="Insert or edit link"><LinkIcon size={15} /></TBtn>
        <TBtn on={false} disabled={disabled || !editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()} label="Remove link"><Unlink size={15} /></TBtn>
        {sep}
        <TBtn on={false} disabled={disabled} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} label="Clear formatting"><RemoveFormatting size={15} /></TBtn>
      </div>

      {/* Link input row (inline, iPad-friendly — no window.prompt) */}
      {linkOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 8px', border: '1.5px solid #e5e7eb', borderBottom: 'none', background: '#fff' }}>
          <input
            autoFocus
            value={linkUrl}
            onChange={e => { setLinkUrl(e.target.value); setLinkError('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } if (e.key === 'Escape') { setLinkOpen(false); setLinkError('') } }}
            placeholder="https://example.com or name@example.com"
            style={{ flex: 1, minWidth: 180, height: 34, padding: '0 10px', fontSize: 12, fontFamily: F, border: '1.5px solid #e5e7eb', borderRadius: 7, color: '#191919', outline: 'none' }}
          />
          <button type="button" onClick={applyLink} style={{ height: 34, padding: '0 12px', fontSize: 12, fontWeight: 600, fontFamily: F, background: NAVY, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}>Apply</button>
          <button type="button" onClick={() => { setLinkOpen(false); setLinkError('') }} style={{ height: 34, padding: '0 10px', fontSize: 12, fontWeight: 600, fontFamily: F, background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 7, cursor: 'pointer' }}>Cancel</button>
          {linkError && <span style={{ width: '100%', fontSize: 11, color: '#b91c1c', fontFamily: F }}>{linkError}</span>}
        </div>
      )}

      {/* Editable surface */}
      <div style={{ border: '1.5px solid #e5e7eb', borderRadius: '0 0 8px 8px', background: '#fff' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
