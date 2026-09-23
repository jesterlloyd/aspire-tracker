// src/components/records/RecordDocuments.jsx
//
// CATALOG-REVAMP-1 (Phase 1). What a student's or a school's record holds beyond its fixed
// slots: files filed to it (record_documents: a personal file moved out of the Catalog
// now; filed forms and signed PDFs in later phases), and every Catalog send that reached
// it (catalog_send_recipients, sent rows only).
//
// Owner/Admin read both tables (RLS); anyone else sees nothing, and so does everyone
// before the Phase 1 migration is applied (42P01 reads as "not enabled", not an error).
// The chart draws the files as rows in its own Documents list, in the same columns as
// Resume and Headshot; the school drawer draws a plain list.
import { fmtShortDate } from '../../lib/catalog/catalogModel'
import { schoolGroupKey } from '../../lib/schoolIdentity'
import { useRecordFiles, useOpenRecordDocument } from './useRecordFiles'
import './recordDocuments.css'

const SOURCE_NOTE = {
  catalog_move: 'Moved from the Catalog',
  staff_upload: 'Uploaded by staff',
  form_submission: 'Form submission',
  signature: 'Signed copy',
}

/** Rows for the student chart's Documents list, in its own columns. */
export function RecordDocumentRows({ docs, onOpen, busy }) {
  return docs.map(doc => (
    <div key={doc.id} className="doc-upload-area">
      <div className="doc-area-label">
        {doc.title}
        <span className="doc-row-note">{SOURCE_NOTE[doc.source] || 'On file'}, {fmtShortDate(doc.created_at)}</span>
      </div>
      <div className="doc-existing-file">
        <button type="button" className="doc-file-link doc-file-open" onClick={() => onOpen(doc, 'open')}>{doc.file_name}</button>
      </div>
      <div className="doc-act">
        <button type="button" className="doc-dl-btn" disabled={busy === doc.id} onClick={() => onOpen(doc, 'download')} aria-label={`Download ${doc.title}`}>
          {busy === doc.id ? '…' : '↓ Download'}
        </button>
      </div>
      <div className="doc-act" />
    </div>
  ))
}

/** The Catalog sends that reached this record. */
export function CatalogSendsOnRecord({ sends, className = '' }) {
  if (!sends.length) return null
  return (
    <div className={`rec-sends ${className}`}>
      <p className="rec-sends-title">Sent from the Catalog</p>
      <ul>
        {sends.map(r => (
          <li key={r.id}>
            <span className="rec-sends-date">{fmtShortDate(r.send?.sent_at || r.created_at)}</span>
            <span className="rec-sends-what">{r.send?.resource?.title || 'Catalog item'}{r.send?.resource_version > 1 ? ` (v${r.send.resource_version})` : ''}</span>
            <span className="rec-sends-via">Outreach</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A self-contained block for a record that has no Documents list of its own (a school). */
export function RecordFilesBlock({ schoolName, enabled = true }) {
  // Records are keyed by the operative school name (src/lib/schoolIdentity.js).
  const { docs, sends, ready } = useRecordFiles({ schoolName: schoolName ? schoolGroupKey(schoolName) : null, enabled })
  const { open, busy } = useOpenRecordDocument()
  if (!ready || (!docs.length && !sends.length)) return null
  return (
    <div className="rec-block">
      {docs.length > 0 && (
        <>
          <p className="rec-sends-title">Documents on file</p>
          <ul className="rec-docs">
            {docs.map(d => (
              <li key={d.id}>
                <span>{d.title}<small>{SOURCE_NOTE[d.source] || 'On file'}, {fmtShortDate(d.created_at)}</small></span>
                <button type="button" disabled={busy === d.id} onClick={() => open(d, 'download')} aria-label={`Download ${d.title}`}>
                  {busy === d.id ? '…' : '↓ Download'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <CatalogSendsOnRecord sends={sends} />
    </div>
  )
}
