// src/components/studio/InlineTextEditor.jsx
//
// STUDIO-INLINE-1: the box that sits over a piece of the email while its words are typed in
// place. It wears the element's own font, size, colour and alignment, grows as the text does,
// and edits the STORED text (so **bold**, links and [First Name] stay as written). Enter
// finishes a one-line field; Cmd/Ctrl+Enter finishes a paragraph; Escape puts it back; clicking
// away keeps what was typed.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export default function InlineTextEditor({ edit, onCommit, onCancel }) {
  const ref = useRef(null)
  const [value, setValue] = useState(edit.value)
  const done = useRef(false)

  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(edit.rect.height, el.scrollHeight)}px`
  }
  useLayoutEffect(fit)
  useEffect(() => {
    const el = ref.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const finish = (keep) => {
    if (done.current) return
    done.current = true
    if (keep) onCommit(value)
    else onCancel()
  }

  return (
    <textarea
      ref={ref}
      className="st-inline"
      aria-label={edit.label}
      value={value}
      rows={1}
      spellCheck
      style={{ left: edit.rect.left, top: edit.rect.top, width: edit.rect.width, minHeight: edit.rect.height, ...edit.style }}
      onChange={e => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); finish(false) }
        else if (e.key === 'Enter' && (!edit.multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true) }
      }}
    />
  )
}
