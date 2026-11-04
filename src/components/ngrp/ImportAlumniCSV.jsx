// RESIDENCY-PROFILES-TOOLBAR-1 (Owner, 2026-11-03): Residency > Profiles & Interest > Import. A CSV
// of names or emails is matched to students already in the app (lib/server/ngrpAlumniImport.js);
// the review shows every row's result, and only the matched alumni are added, after a click. No
// student is ever created here: someone new goes through Add Alumnus > New to the app.
import { useRef, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import { parseCSV, downloadCSV } from '../../lib/utils'
import { postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { F, btn } from '../../lib/ngrp/ngrpCohortForm'

const note = { fontSize: 12, color: 'var(--text-caption)', fontFamily: F, lineHeight: 1.5, margin: 0 }
const IMPORT_STATUS_WORDS = Object.freeze({
  matched: 'Will be added',
  on_roster: 'Already on the roster',
  not_completed: 'Has not completed ASPIRE',
  ambiguous: 'More than one match',
  not_found: 'No match in the app',
  blank: 'No name or email',
})

export default function ImportAlumniCSV({ cycle, toast, onImported, onClose }) {
  const fileRef = useRef(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pick = e => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const { rows } = parseCSV(String(ev.target.result || ''))
      if (!rows.length) { setError('That file looks empty or could not be read.'); return }
      setBusy(true); setError(null)
      const r = await postNgrpManage('alumni_import_match', { cycle_id: cycle.id, rows: rows.slice(0, 500) })
      setBusy(false)
      if (!r.ok) { setError(r.status === 409 ? 'Add alumnus is not switched on yet.' : 'The file could not be checked. Please try again.'); return }
      setResults(r.results || [])
    }
    reader.readAsText(file)
  }

  const matched = (results || []).filter(r => r.status === 'matched')
  const add = async () => {
    setBusy(true)
    const r = await postNgrpManage('alumni_import_add', { cycle_id: cycle.id, student_ids: matched.map(m => m.student_id) })
    setBusy(false)
    if (!r.ok) { toast?.error?.('Not added', 'Please try again.'); return }
    toast?.success?.(`Added ${r.added} to the roster`, r.skipped ? `${r.skipped} skipped: already on the roster or not a completed alumnus.` : `They are on the ${cycle.name} roster.`)
    onImported?.()
    onClose()
  }

  return (
    <DetailDrawer open title="Import Alumni" width={680} trapFocus onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: F }}>
        <p style={note}>
          A CSV with a name (or first and last name) and an email for each alumnus. Each row is matched to a
          student already in the app and added to the {cycle.name} roster. Nobody new is created: add someone
          new with Add Alumnus.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn(true)} disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy && !results ? 'Checking…' : results ? 'Choose another file' : 'Choose a CSV file'}
          </button>
          <button type="button" style={btn(false)} onClick={() => downloadCSV('first_name,last_name,email\n', 'residency_alumni_import.csv')}>Download template</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={pick} />
        </div>
        {error && <p className="ngrp-add-error" role="alert">{error}</p>}

        {results && (<>
          <p style={{ ...note, color: 'var(--text-heading)', fontWeight: 600 }} aria-live="polite">
            {matched.length} of {results.length} row{results.length === 1 ? '' : 's'} will be added.
          </p>
          <div className="ngrp-import-list">
            {results.map(r => (
              <div key={r.row} className={`ngrp-add-row ngrp-import-${r.status}`}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{r.name || r.input || `Row ${r.row}`}</div>
                  <div style={note}>{[`Row ${r.row}`, r.name && r.input !== r.name ? r.input : null, r.cohort].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="ngrp-import-word">{IMPORT_STATUS_WORDS[r.status] || r.status}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" style={{ ...btn(true), ...(!matched.length || busy ? { opacity: 0.45, cursor: 'not-allowed' } : null) }}
              disabled={!matched.length || busy} onClick={add}>
              {busy ? 'Adding…' : `Add ${matched.length} to the roster`}
            </button>
          </div>
        </>)}
      </div>
    </DetailDrawer>
  )
}
