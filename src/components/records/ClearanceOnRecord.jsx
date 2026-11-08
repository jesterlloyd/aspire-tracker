// src/components/records/ClearanceOnRecord.jsx
//
// AP-CLEARANCE-1 (Owner, 2026-11-08): the clearance files a student's school uploaded in the
// Academic Partner portal, as rows in the chart's Documents list (the same columns as Resume and
// Headshot). Read-only for the ASPIRE team: "filed, no review". A missing required item reads
// Missing; nothing waits on anyone. Before 20261204000000 nothing renders.
import { useCallback, useState } from 'react'
import { postStudentDocuments } from './useClearanceOnRecord'
import { fmtShortDate } from '../../lib/catalog/catalogModel'

export function ClearanceDocumentRows({ rows }) {
  const [busy, setBusy] = useState(null)
  const open = useCallback(async (versionId) => {
    setBusy(versionId)
    const pending = window.open('', '_blank')
    if (pending) pending.opener = null
    try {
      const r = await postStudentDocuments({ action: 'open', version_id: versionId })
      if (r.ok && r.data.url && pending) pending.location = r.data.url
      else if (pending) pending.close()
    } finally { setBusy(null) }
  }, [])
  if (!rows.length) return null
  return rows.map(row => (
    <div key={row.key} className="doc-upload-area">
      <div className="doc-area-label">
        {row.label}
        <span className="doc-row-note">
          {row.current
            ? `From the school, ${fmtShortDate(row.current.uploaded_at)}${row.current.doc_date ? ` · ${row.dateLabel === 'Expiration date' ? 'expires' : 'completed'} ${fmtShortDate(row.current.doc_date)}` : ''}`
            : row.required ? 'Missing: the school uploads it' : 'Not on file'}
        </span>
      </div>
      <div className="doc-existing-file">
        {row.current
          ? <button type="button" className="doc-file-link doc-file-open" disabled={busy === row.current.id} onClick={() => open(row.current.id)}>{row.current.file_name}</button>
          : <span className="doc-row-note">None</span>}
      </div>
      <div className="doc-act" />
      <div className="doc-act" />
    </div>
  ))
}
