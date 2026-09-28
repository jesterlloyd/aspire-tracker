// src/components/budget/ReceiptOriginal.jsx
//
// PROGRAM-BUDGET Phase B (Owner, 2026-09-27: "when I click more details ... I can still see the
// uploaded real receipt"): View original. The slip draws its own receipt; this shows the file that
// was uploaded, from a short-lived link the server mints for the Owner only. Used by the Receipts
// tab and by the Sheet's Receipt column.
import { useEffect, useRef } from 'react'
import { FileText } from 'lucide-react'

/** View original: the uploaded file itself, in a dialog. A saved email downloads instead. */
export default function ReceiptOriginal({ original, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    el?.focus()
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const t = original.content_type || ''
  return (
    <div className="bud-modal-back" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className="bud-modal" role="dialog" aria-modal="true" aria-label={`Original receipt: ${original.slip.file_name}`} tabIndex={-1}>
        <div className="bud-modal-head">
          <b>{original.file_name || original.slip.file_name}</b>
          <span className="bud-grow" />
          {original.url && <a className="bud-btn bud-btn-sm" href={original.url} target="_blank" rel="noreferrer">Open in a new tab</a>}
          <button type="button" className="bud-btn bud-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="bud-modal-body">
          {original.loading ? <p className="bud-empty">Opening the original…</p>
            : t.startsWith('image/') ? <img src={original.url} alt={`Original receipt ${original.slip.file_name}`} />
              : t === 'application/pdf' ? <iframe src={original.url} title={`Original receipt ${original.slip.file_name}`} />
                : <p className="bud-empty"><FileText size={20} aria-hidden="true" /> A saved email opens in your mail app. <a href={original.url}>Download it</a>.</p>}
        </div>
      </div>
    </div>
  )
}

