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
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon, Unlink, RemoveFormatting, Minus, Plus } from 'lucide-react'
import { DividerBlock } from './blocks/DividerBlock'

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
  const [insertOpen, setInsertOpen] = useState(false)

  const editor = useEditor({
    immediatelyRender: true,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Phase 2A: Heading restricted to h2 (Heading) and h3 (Subheading) only — no h1/h4-6, no
        // font-size/color pickers. Everything else outside the subset stays disabled; standalone
        // Underline/Link below; DividerBlock atom for the Content Block divider.
        heading: { levels: [2, 3] },
        blockquote: false, codeBlock: false, code: false,
        horizontalRule: false, strike: false, link: false, underline: false,
      }),
      DividerBlock,
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
    // Emit the body HTML AND the TipTap JSON (richDoc) so composers can persist richDoc additively.
    // Emit '' for a truly empty doc (TipTap returns '<p></p>') so draft "emptiness" checks and the
    // pristine/discard logic in the composers behave the same as the plain-text textarea.
    onUpdate: ({ editor }) => { onChange?.(editor.isEmpty ? '' : editor.getHTML(), editor.getJSON()) },
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
        .rte-content h2{margin:16px 0 6px;color:${NAVY};font-size:20px;font-weight:700;line-height:1.3;}
        .rte-content h3{margin:14px 0 6px;color:${NAVY};font-size:16px;font-weight:600;line-height:1.4;}
        .rte-content hr[data-aspire-block="divider"]{border:none;border-top:1px solid #cbd5e1;margin:14px 0;}
        .rte-content hr.ProseMirror-selectednode{border-top-color:${NAVY};box-shadow:0 0 0 2px rgba(29,37,103,0.18);}
        .rte-content:empty:before{content:attr(data-placeholder);color:#9ca3af;}
      `}</style>

      {/* Compact toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: 6, border: '1.5px solid #e5e7eb', borderBottom: 'none', borderRadius: '8px 8px 0 0', background: '#faf9f7' }}>
        {/* Style dropdown: Body / Heading / Subheading (locked styles applied server-side at render) */}
        <select
          value={editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
          disabled={disabled}
          onChange={e => {
            const v = e.target.value, c = editor.chain().focus()
            if (v === 'h2') c.setHeading({ level: 2 }).run()
            else if (v === 'h3') c.setHeading({ level: 3 }).run()
            else c.setParagraph().run()
          }}
          aria-label="Text style"
          title="Text style"
          style={{ height: 36, borderRadius: 7, border: '1px solid rgba(29,37,103,0.14)', background: '#fff', color: '#4A5560', fontFamily: F, fontSize: 12, fontWeight: 600, padding: '0 6px', cursor: disabled ? 'not-allowed' : 'pointer' }}
        >
          <option value="p">Body</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        {sep}
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
        {sep}
        {/* Insert block: a small dropdown (extensible — Divider in 2A-0; Button/Note/Event later). */}
        <div style={{ position: 'relative' }}>
          <TBtn on={insertOpen} disabled={disabled} onClick={() => setInsertOpen(o => !o)} label="Insert block"><Plus size={15} /></TBtn>
          {insertOpen && (
            <div role="menu" style={{ position: 'absolute', top: 40, left: 0, zIndex: 20, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.12)', padding: 4, minWidth: 150 }}>
              <button
                type="button"
                role="menuitem"
                onClick={() => { editor.chain().focus().insertAspireDivider().run(); setInsertOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 36, padding: '0 10px', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: F, fontSize: 12.5, fontWeight: 600, color: '#374151', textAlign: 'left' }}
              ><Minus size={15} /> Divider</button>
            </div>
          )}
        </div>
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
