// HIRE-HISTORY-1 (Owner, 2026-11-04): Record past hires. The team's spreadsheet of hired alumni
// (the intake export's Hired / As / Unit / Applied for Cohort columns, or any list) becomes hire
// records on residency cohorts that ran before the app held them. Three steps in one drawer:
// the file, the columns and the cohorts, then every row. Nothing is written until Record, and a
// row is recorded only when it matched exactly one Completed alumnus here. Owner and Admin, in
// the staff app. No Keith: a one-time step over a handful of columns the person confirms.
import { useMemo, useRef, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import { supabase } from '../../lib/supabase'
import { HIRE_FIELDS, IGNORE, REASON_WORDS } from '../../lib/ngrp/hireImportModel'
import { MAX_FILE_BYTES } from '../../lib/studentImport/importModel'
import '../studentImport/studentImport.css'

async function post(action, payload) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  const res = await fetch('/api/student-import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  if (!res.ok || !body?.ok) return { ok: false, status: res.status, message: body?.message || null, error: body?.error || null }
  return body
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

const NEW = '__new__'

export default function PastHiresDrawer({ toast, onRecorded, onClose }) {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [columns, setColumns] = useState({}) // index -> field
  const [cohorts, setCohorts] = useState({}) // file value -> { cycle_id } | { create: {...} }
  const [decisions, setDecisions] = useState({}) // row -> 'record' | 'skip'
  const [dates, setDates] = useState({}) // row -> hire date for an "ask" row
  const [step, setStep] = useState('file')
  const [done, setDone] = useState(null)

  const mapping = useMemo(() => (analysis ? {
    columns: analysis.file.headers.map((h, index) => ({ index, field: columns[index] ?? analysis.mapping.columns[index]?.field ?? IGNORE })),
    nameFormat: analysis.mapping.nameFormat,
  } : null), [analysis, columns])

  const pick = async (f) => {
    setError(null)
    if (!f) return
    if (f.size > MAX_FILE_BYTES) { setError('That file is over 3 MB. Save a smaller copy and try again.'); return }
    setFile({ name: f.name, base64: await readBase64(f) })
  }

  const analyze = async (withMapping = null, withCohorts = null) => {
    setBusy('analyze'); setError(null)
    const res = await post('hires_analyze', { file_name: file.name, file_base64: file.base64, mapping: withMapping, cohorts: withCohorts })
    setBusy(null)
    if (!res.ok) { setError(res.message || 'The file could not be read.'); return }
    setAnalysis(res)
    if (!withMapping) {
      setColumns({})
      const seed = {}
      for (const v of res.cohortValues) seed[v.value] = v.suggestion ? { cycle_id: v.suggestion } : { create: { name: v.value, application_open_date: '', residency_start_date: '' } }
      setCohorts(seed)
      setStep('columns')
    } else setStep('rows')
  }

  const toRows = () => analyze(mapping, cohorts)

  const commit = async () => {
    setBusy('commit'); setError(null)
    const res = await post('hires_commit', { file_name: file.name, file_base64: file.base64, mapping, cohorts, decisions, dates })
    setBusy(null)
    if (!res.ok) { setError(res.message || 'The hires could not be recorded.'); return }
    setDone(res)
    setStep('done')
    toast?.success?.('Past hires recorded', `${res.recorded} recorded${res.created_cohorts.length ? `, ${res.created_cohorts.length} residency cohort${res.created_cohorts.length === 1 ? '' : 's'} created` : ''}.`)
    onRecorded?.()
  }

  const cohortProblem = useMemo(() => {
    if (!analysis) return null
    for (const v of analysis.cohortValues) {
      const c = cohorts[v.value]
      if (!c) return `Choose a residency cohort for "${v.value}".`
      if (c.create && !c.create.application_open_date) return `Enter when applications opened for "${c.create.name || v.value}".`
    }
    return null
  }, [analysis, cohorts])

  const rows = analysis?.rows || []
  const recordRows = rows.filter(r => r.action === 'record')
  const askRows = rows.filter(r => r.action === 'ask')
  const skipRows = rows.filter(r => r.action === 'skip')
  const willRecord = recordRows.filter(r => decisions[r.row] !== 'skip').length + askRows.filter(r => decisions[r.row] === 'record' && dates[r.row]).length

  return (
    <DetailDrawer open title="Record Past Hires" width={760} trapFocus onClose={onClose}>
      <div className="ski">
        <p className="ski-note">
          For alumni hired through a residency cohort that ran before the app held it. Each row is matched to one
          Completed alumnus here and recorded as a hire in the residency cohort you choose; a cohort that does not
          exist is created as Completed with the dates you enter. Nothing is written until Record.
        </p>

        {step === 'file' && (
          <div className="ski-step">
            <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={e => pick(e.target.files?.[0])} />
            <button type="button" className="ski-btn" onClick={() => fileRef.current?.click()}>{file ? `Chosen: ${file.name}` : 'Choose a file'}</button>
            <p className="ski-note">.xlsx or .csv, up to 3 MB. Columns it reads: name or first and last name, an email, Hired, hire date, unit, hired as, residency cohort, current title, separated on.</p>
            {error && <p className="ski-error">{error}</p>}
            <div className="ski-foot">
              <button type="button" className="ski-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="ski-btn ski-btn-primary" disabled={!file || busy} onClick={() => analyze()}>{busy ? 'Reading…' : 'Read the file'}</button>
            </div>
          </div>
        )}

        {step === 'columns' && analysis && (
          <div className="ski-step">
            <section className="ski-section">
              <h3 className="ski-h">Columns</h3>
              <div className="ski-cols">
                {analysis.file.headers.map((h, index) => (
                  <div key={index} className="ski-col">
                    <div className="ski-col-name"><span className="ski-q-header">{h || `Column ${index + 1}`}</span></div>
                    <select className="ski-select" value={mapping.columns[index].field} onChange={e => setColumns(c => ({ ...c, [index]: e.target.value }))} aria-label={`What "${h}" holds`}>
                      <option value={IGNORE}>Leave out</option>
                      {HIRE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </section>
            <section className="ski-section">
              <h3 className="ski-h">Residency Cohorts in the File</h3>
              {analysis.cohortValues.length === 0 && <p className="ski-note">No residency cohort values were found. Point a column at “Residency cohort” above, then read the file again.</p>}
              {analysis.cohortValues.map(v => {
                const c = cohorts[v.value] || {}
                const sel = c.cycle_id || (c.create ? NEW : '')
                return (
                  <div key={v.value} className="ski-q" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 300px)' }}>
                    <div className="ski-q-label">
                      <span className="ski-q-header">{v.value}</span>
                      <span className="ski-note">{v.count} hire{v.count === 1 ? '' : 's'}</span>
                      {sel === NEW && (
                        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                          <input className="ski-select" value={c.create?.name || ''} placeholder="Cohort name" aria-label="New cohort name"
                            onChange={e => setCohorts(x => ({ ...x, [v.value]: { create: { ...x[v.value].create, name: e.target.value } } }))} />
                          <label className="ski-note">Applications opened
                            <input type="date" className="ski-select" value={c.create?.application_open_date || ''} aria-label="Applications opened"
                              onChange={e => setCohorts(x => ({ ...x, [v.value]: { create: { ...x[v.value].create, application_open_date: e.target.value } } }))} />
                          </label>
                          <label className="ski-note">Residency started
                            <input type="date" className="ski-select" value={c.create?.residency_start_date || ''} aria-label="Residency started"
                              onChange={e => setCohorts(x => ({ ...x, [v.value]: { create: { ...x[v.value].create, residency_start_date: e.target.value } } }))} />
                          </label>
                        </div>
                      )}
                    </div>
                    <select className="ski-select" value={sel} aria-label={`Residency cohort for "${v.value}"`}
                      onChange={e => setCohorts(x => ({ ...x, [v.value]: e.target.value === NEW ? { create: { name: v.value, application_open_date: '', residency_start_date: '' } } : { cycle_id: e.target.value } }))}>
                      <option value="" disabled>Choose…</option>
                      <option value={NEW}>Create a Completed cohort</option>
                      {analysis.cycles.map(cy => <option key={cy.id} value={cy.id}>{cy.name} ({cy.status})</option>)}
                    </select>
                  </div>
                )
              })}
              <p className="ski-note">A created cohort needs the date its applications opened, so it sorts before the cohorts that came after it and its hires drop out of their rosters.</p>
            </section>
            {(error || cohortProblem) && <p className="ski-error">{error || cohortProblem}</p>}
            <div className="ski-foot">
              <button type="button" className="ski-btn" onClick={() => setStep('file')}>Back</button>
              <button type="button" className="ski-btn ski-btn-primary" disabled={busy || Boolean(cohortProblem)} onClick={toRows}>{busy ? 'Checking…' : 'Check the rows'}</button>
            </div>
          </div>
        )}

        {step === 'rows' && analysis && (
          <div className="ski-step">
            <p className="ski-summary">
              {recordRows.length} ready to record, {askRows.length} need a hire date, {skipRows.length} skipped.
            </p>
            {askRows.length > 0 && (
              <section className="ski-section">
                <h3 className="ski-h">Need a Hire Date</h3>
                <div className="ski-list">
                  {askRows.map(r => (
                    <div key={r.row} className="ski-row ski-row-ask" style={{ display: 'block' }}>
                      <div className="ski-row-name">{r.name} <span className="ski-note">Row {r.row} · {r.match?.cohort || ''}</span></div>
                      <div className="ski-note">{REASON_WORDS[r.reason]}{r.hired_note ? ` · the file says "${r.hired_note}"` : ''} · {r.cohort}{r.hired_unit ? ` · ${r.hired_unit}` : ''}</div>
                      <div className="ski-options">
                        <label className="ski-option">Hired on <input type="date" className="ski-select" style={{ width: 'auto' }} value={dates[r.row] || ''} onChange={e => { setDates(d => ({ ...d, [r.row]: e.target.value })); setDecisions(d => ({ ...d, [r.row]: e.target.value ? 'record' : 'skip' })) }} /></label>
                        <label className="ski-option"><input type="checkbox" checked={decisions[r.row] !== 'record'} onChange={e => setDecisions(d => ({ ...d, [r.row]: e.target.checked ? 'skip' : 'record' }))} /> Skip</label>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className="ski-section">
              <h3 className="ski-h">Will Be Recorded</h3>
              <div className="ski-list">
                {recordRows.length === 0 && <p className="ski-note">No row is ready. Check the columns, the cohorts and the rows below.</p>}
                {recordRows.map(r => (
                  <label key={r.row} className="ski-row ski-row-add">
                    <span style={{ minWidth: 0 }}>
                      <span className="ski-row-name">{r.name}</span>
                      <span className="ski-note" style={{ display: 'block' }}>Row {r.row} · {r.match?.cohort || ''} → {r.cohort}{r.hired_on ? ` · ${r.hired_on}` : ' · the cohort\'s date'}{r.hired_unit ? ` · ${r.hired_unit}` : ''}{r.hired_as ? ` · ${r.hired_as === 'Other' ? r.hired_as_other : r.hired_as}` : ''}{r.separated_on ? ` · separated ${r.separated_on}` : ''}</span>
                    </span>
                    <span className="ski-option"><input type="checkbox" checked={decisions[r.row] !== 'skip'} onChange={e => setDecisions(d => ({ ...d, [r.row]: e.target.checked ? 'record' : 'skip' }))} /> Record</span>
                  </label>
                ))}
              </div>
            </section>
            <section className="ski-section">
              <h3 className="ski-h">Skipped</h3>
              <div className="ski-list">
                {skipRows.map(r => (
                  <div key={r.row} className="ski-row ski-row-skip">
                    <div style={{ minWidth: 0 }}>
                      <div className="ski-row-name">{r.name || `Row ${r.row}`}</div>
                      <div className="ski-note">Row {r.row} · {REASON_WORDS[r.reason] || r.reason}{r.repeatOf ? ` (row ${r.repeatOf})` : ''}{r.matches ? `: ${r.matches.map(m => `${m.name}${m.cohort ? ` (${m.cohort})` : ''}`).join('; ')}` : ''}</div>
                    </div>
                    <span className="ski-word">Skip</span>
                  </div>
                ))}
              </div>
            </section>
            {error && <p className="ski-error">{error}</p>}
            <div className="ski-foot">
              <span className="ski-foot-note">{willRecord} will be recorded</span>
              <button type="button" className="ski-btn" onClick={() => setStep('columns')}>Back</button>
              <button type="button" className="ski-btn ski-btn-primary" disabled={busy || willRecord === 0} onClick={commit}>{busy ? 'Recording…' : `Record ${willRecord} hire${willRecord === 1 ? '' : 's'}`}</button>
            </div>
          </div>
        )}

        {step === 'done' && done && (
          <div className="ski-step">
            <p className="ski-summary">
              {done.recorded} hire{done.recorded === 1 ? '' : 's'} recorded, {done.skipped} skipped.
              {done.created_cohorts.length ? ` Created: ${done.created_cohorts.join(', ')}.` : ''}
            </p>
            {done.failed.length > 0 && (
              <section className="ski-section">
                <h3 className="ski-h">Not Recorded</h3>
                <div className="ski-list">
                  {done.failed.map(f => <div key={f.row} className="ski-row"><div><div className="ski-row-name">{f.name || `Row ${f.row}`}</div><div className="ski-note">{f.why}</div></div></div>)}
                </div>
              </section>
            )}
            <div className="ski-foot"><button type="button" className="ski-btn ski-btn-primary" onClick={onClose}>Done</button></div>
          </div>
        )}
      </div>
    </DetailDrawer>
  )
}
