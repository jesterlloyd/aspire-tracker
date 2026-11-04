// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): "Could Keith intelligently scour the details to put
// into the student profile? ... create student profiles, and ask me if it isn't sure ... a Keith
// popup. then doesn't add duplicates."
//
// Three steps in one drawer: choose a file, answer what Keith was not sure of, review every row,
// then import. Keith reads the COLUMNS only (api/student-import.js); the app applies his mapping
// to every row and checks each against the students already here. Nothing is written until
// Import, and a row that might be someone already here is never created without an answer.
import { useMemo, useRef, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import { KeithGlyph } from '../keith/KeithMark'
import { supabase } from '../../lib/supabase'
import { IMPORT_FIELDS, FIELD_BY_KEY, IGNORE, REASON_WORDS, OPTION_WORDS, MAX_FILE_BYTES } from '../../lib/studentImport/importModel'
import { ASPIRE_STATUSES } from '../../lib/constants'
import './studentImport.css'

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

const SHOWN_WORDS = { values: 'its list of values', items: 'its choices', samples: 'masked samples', withheld: 'nothing (withheld)' }
const fieldLabel = k => (k === IGNORE ? 'Leave out' : FIELD_BY_KEY[k]?.label || k)

function FieldSelect({ value, onChange, id }) {
  return (
    <select id={id} className="ski-select" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="" disabled>Choose…</option>
      <option value={IGNORE}>Leave out</option>
      {IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
    </select>
  )
}

function ValueSelect({ q, value, onChange, allowNew }) {
  return (
    <select className="ski-select" value={value ?? ''} onChange={e => onChange(e.target.value)} aria-label={`What "${q.value}" means`}>
      <option value="" disabled>Choose…</option>
      <option value="-">Leave blank</option>
      {allowNew && <option value={`new:${q.value}`}>Create a past cohort named “{q.value}”</option>}
      {q.choices.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

/**
 * target: 'internship' (into `cohortId`, named `cohortName`) or 'residency' (onto `cycle`'s roster).
 */
export default function KeithImportDrawer({ target, cohortId, cohortName, cycle, isOwner, toast, onImported, onClose }) {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null) // { name, base64 }
  const [busy, setBusy] = useState(null) // 'analyze' | 'plan' | 'commit'
  const [error, setError] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [answers, setAnswers] = useState({})
  const [plan, setPlan] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [result, setResult] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const where = target === 'internship' ? { target, cohort_id: cohortId } : { target, cycle_id: cycle?.id }
  const destName = target === 'internship' ? cohortName : cycle?.name
  const step = result ? 'done' : plan ? 'rows' : analysis ? 'questions' : 'file'

  const answer = (id, v) => setAnswers(a => ({ ...a, [id]: v }))
  // A value answer of "-" means "leave blank", which the server reads as no value.
  const sentAnswers = useMemo(() => Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v === '-' ? '' : v])), [answers])

  const pick = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_FILE_BYTES) { setError('That file is over 3 MB. Save a smaller copy and try again.'); return }
    setError(null); setBusy('analyze'); setAnalysis(null); setPlan(null); setAnswers({}); setDecisions({})
    try {
      const base64 = await readBase64(f)
      setFile({ name: f.name, base64 })
      const r = await post('analyze', { ...where, file_name: f.name, file_base64: base64 })
      if (!r.ok) setError(r.message || 'Keith could not read that file. Please try again.')
      else setAnalysis(r)
    } catch {
      setError('That file could not be read.')
    }
    setBusy(null)
  }

  const unsure = (analysis?.questions || []).filter(q => q.kind === 'column')
  const valueQs = [...(analysis?.questions || []), ...(plan?.questions || [])].filter((q, i, all) => q.kind === 'value' && all.findIndex(x => x.id === q.id) === i)
  const statusQ = (analysis?.questions || []).find(q => q.kind === 'status')
  const columnOf = i => answers[`col:${i}`] ?? analysis?.mapping.columns[i]?.field
  const missing = [...unsure.map(q => q.id), ...valueQs.map(q => q.id)].filter(id => answers[id] === undefined)

  const checkRows = async () => {
    setBusy('plan'); setError(null)
    const r = await post('plan', { ...where, file_name: file.name, file_base64: file.base64, mapping: analysis.mapping, answers: sentAnswers })
    setBusy(null)
    if (!r.ok) { setError(r.message || 'The rows could not be checked. Please try again.'); return }
    setPlan(r)
  }

  const doImport = async () => {
    setBusy('commit'); setError(null)
    const r = await post('commit', { ...where, file_name: file.name, file_base64: file.base64, mapping: analysis.mapping, answers: sentAnswers, decisions })
    setBusy(null)
    if (!r.ok) { setError(r.message || 'Nothing was imported. Please try again.'); return }
    setResult(r)
    const bits = [r.created && `${r.created} created`, r.updated && `${r.updated} updated`, r.added && `${r.added} added to the roster`].filter(Boolean)
    toast?.success?.('Import finished', bits.length ? `${bits.join(', ')}.` : 'Nothing needed to change.')
    onImported?.()
  }

  const asks = (plan?.rows || []).filter(r => r.action === 'ask')
  const others = (plan?.rows || []).filter(r => r.action !== 'ask')
  const pendingValues = (plan?.questions || []).filter(q => answers[q.id] === undefined)
  const willWrite = (plan?.rows || []).filter(r => (r.action === 'ask' ? (decisions[r.row] || r.options[0]) : r.action) !== 'skip').length

  const footer = step === 'questions' ? (
    <div className="ski-foot">
      <span className="ski-foot-note">{missing.length ? `${missing.length} answer${missing.length === 1 ? '' : 's'} left` : 'Nothing is written yet.'}</span>
      <button type="button" className="ski-btn ski-btn-primary" disabled={!!missing.length || busy === 'plan'} onClick={checkRows}>
        {busy === 'plan' ? 'Checking every row…' : 'Check the rows'}
      </button>
    </div>
  ) : step === 'rows' ? (
    <div className="ski-foot">
      <button type="button" className="ski-btn" onClick={() => setPlan(null)} disabled={!!busy}>Back</button>
      <button type="button" className="ski-btn ski-btn-primary" disabled={!willWrite || !!pendingValues.length || !!busy} onClick={doImport}>
        {busy === 'commit' ? 'Importing…' : `Import ${willWrite} row${willWrite === 1 ? '' : 's'}`}
      </button>
    </div>
  ) : null

  return (
    <DetailDrawer open title={target === 'internship' ? 'Import Students' : 'Import Alumni'} width={760} trapFocus onClose={onClose} footer={footer}>
      <div className="ski">
        <div className="ski-keith">
          <KeithGlyph state={null} size="lg" />
          <div>
            <div className="ski-keith-head">Keith reads the file, you decide.</div>
            <p className="ski-note">
              Keith looks at the columns (headers, lists of choices and masked samples, never a whole row or anyone's
              details), works out which student field each one fills, and asks you where he is not sure. The app then
              checks every row against the students already here, so nobody is added twice. Nothing is written until you
              press Import. {target === 'internship' ? `New students go into ${destName}.` : `Alumni go on the ${destName} roster.`}
            </p>
          </div>
        </div>

        {step === 'file' && (
          <div className="ski-step">
            <button type="button" className="ski-btn ski-btn-primary" disabled={busy === 'analyze'} onClick={() => fileRef.current?.click()}>
              {busy === 'analyze' ? 'Keith is reading the columns…' : 'Choose an Excel or CSV file'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pick} />
            {busy === 'analyze' && <p className="ski-note" aria-live="polite">{isOwner ? 'On Opus this can take up to a minute.' : 'This usually takes under a minute.'}</p>}
            <p className="ski-note">An export of the intake form from Microsoft Forms works as it is, and so does any list with a name and an email per student. Up to 1,000 rows.</p>
          </div>
        )}

        {error && <p className="ski-error" role="alert">{error}</p>}

        {step === 'questions' && analysis && (
          <div className="ski-step">
            <p className="ski-lead">
              {file?.name} · {analysis.file.rowCount} row{analysis.file.rowCount === 1 ? '' : 's'} · {analysis.file.headers.length} columns
              {analysis.file.truncated ? ' (only the first 1,000 rows are read)' : ''}
            </p>
            {analysis.keith.used
              ? analysis.mapping.summary && <p className="ski-summary">{analysis.mapping.summary}</p>
              : <p className="ski-warn">Keith could not read this file{analysis.keith.reason === 'off' ? ' because his import skill is off' : ''}, so these are guesses from the headers alone. Check each one.</p>}

            {!!unsure.length && (
              <section className="ski-section">
                <h3 className="ski-h">Columns Keith Is Not Sure Of</h3>
                {unsure.map(q => (
                  <div key={q.id} className="ski-q">
                    <label htmlFor={q.id} className="ski-q-label">
                      <span className="ski-q-header">“{q.header}”</span>
                      <span className="ski-note">
                        {q.reason === 'clash' ? 'Another column fills the same field. ' : ''}
                        {q.suggested && q.suggested !== IGNORE ? `Keith suggests ${fieldLabel(q.suggested)}.` : 'Keith suggests leaving it out.'}
                        {q.note ? ` ${q.note}` : ''}
                      </span>
                    </label>
                    <FieldSelect id={q.id} value={answers[q.id]} onChange={v => answer(q.id, v)} />
                  </div>
                ))}
              </section>
            )}

            {!!valueQs.length && (
              <section className="ski-section">
                <h3 className="ski-h">Values Keith Could Not Match</h3>
                {valueQs.map(q => (
                  <div key={q.id} className="ski-q">
                    <div className="ski-q-label">
                      <span className="ski-q-header">“{q.value}”</span>
                      <span className="ski-note">in {fieldLabel(q.field)}</span>
                    </div>
                    <ValueSelect q={q} value={answers[q.id]} onChange={v => answer(q.id, v)} allowNew={q.allowNew && target === 'residency'} />
                  </div>
                ))}
              </section>
            )}

            {statusQ && (
              <section className="ski-section">
                <h3 className="ski-h">Status for New Students</h3>
                <div className="ski-q">
                  <label htmlFor="ski-status" className="ski-q-label"><span className="ski-note">Keith suggests {statusQ.suggested}. Students already here keep their status.</span></label>
                  <select id="ski-status" className="ski-select" value={answers.status ?? statusQ.suggested} onChange={e => answer('status', e.target.value)}>
                    {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </section>
            )}

            <section className="ski-section">
              <button type="button" className="ski-link" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Hide' : 'Show'} every column ({analysis.mapping.columns.filter(c => columnOf(c.index) !== IGNORE).length} filled, the rest left out)
              </button>
              {showAll && (
                <div className="ski-cols">
                  {analysis.mapping.columns.map(c => (
                    <div key={c.index} className="ski-col">
                      <div className="ski-col-name">
                        <span>{analysis.file.headers[c.index]}</span>
                        <span className="ski-note">Keith saw {SHOWN_WORDS[analysis.shown[c.index]?.as] || 'masked samples'}{c.confidence !== 'high' && analysis.keith.used ? ` · ${c.confidence} confidence` : ''}</span>
                      </div>
                      <FieldSelect value={columnOf(c.index)} onChange={v => answer(`col:${c.index}`, v)} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {step === 'rows' && plan && (
          <div className="ski-step">
            <p className="ski-lead" aria-live="polite">
              {[plan.counts.create && `${plan.counts.create} new`, plan.counts.update && `${plan.counts.update} to update`, plan.counts.add && `${plan.counts.add} to add to the roster`, plan.counts.skip && `${plan.counts.skip} skipped`, asks.length && `${asks.length} need you`].filter(Boolean).join(' · ')}
            </p>

            {!!pendingValues.length && (
              <section className="ski-section">
                <h3 className="ski-h">New Values to Match</h3>
                <p className="ski-note">A column you changed has values Keith did not see. Match them, then check the rows again.</p>
                {pendingValues.map(q => (
                  <div key={q.id} className="ski-q">
                    <div className="ski-q-label"><span className="ski-q-header">“{q.value}”</span><span className="ski-note">in {fieldLabel(q.field)}</span></div>
                    <ValueSelect q={q} value={answers[q.id]} onChange={v => answer(q.id, v)} allowNew={q.allowNew && target === 'residency'} />
                  </div>
                ))}
                <button type="button" className="ski-btn" disabled={busy === 'plan'} onClick={checkRows}>Check the rows again</button>
              </section>
            )}

            {!!asks.length && (
              <section className="ski-section">
                <h3 className="ski-h">Rows That Need You</h3>
                {asks.map(r => (
                  <fieldset key={r.row} className="ski-row ski-row-ask">
                    <legend className="ski-row-name">{r.name} <span className="ski-note">Row {r.row}</span></legend>
                    <p className="ski-note">
                      {REASON_WORDS[r.reason]}
                      {r.match ? `: ${r.match.name}${r.match.cohort ? `, ${r.match.cohort}` : ''}${r.match.status ? `, ${r.match.status}` : ''}` : ''}
                      {r.matches ? `: ${r.matches.map(m => `${m.name}${m.cohort ? ` (${m.cohort})` : ''}`).join('; ')}` : ''}
                    </p>
                    {!!r.conflicts.length && (
                      <ul className="ski-diff">
                        {r.conflicts.map(c => <li key={c.field}>{c.label}{'from' in c ? `: “${String(c.from)}” here, “${String(c.to)}” in the file` : ' differs'}</li>)}
                      </ul>
                    )}
                    <div className="ski-options" role="radiogroup">
                      {r.options.map((o, i) => (
                        <label key={o} className="ski-option">
                          <input type="radio" name={`row-${r.row}`} checked={(decisions[r.row] || r.options[0]) === o} onChange={() => setDecisions(d => ({ ...d, [r.row]: o }))} />
                          <span>{OPTION_WORDS[o]}{i === 0 ? ' (default)' : ''}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </section>
            )}

            <section className="ski-section">
              <h3 className="ski-h">Every Other Row</h3>
              <div className="ski-list">
                {others.map(r => (
                  <div key={r.row} className={`ski-row ski-row-${r.action}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ski-row-name">{r.name || `Row ${r.row}`}</div>
                      <div className="ski-note">
                        Row {r.row} · {REASON_WORDS[r.reason] || r.reason}
                        {r.repeatOf ? ` (row ${r.repeatOf})` : ''}
                        {r.cohort ? ` · ${r.cohort}` : ''}
                        {r.fill.length && r.action !== 'create' ? ` · adds ${r.fill.join(', ')}` : ''}
                        {r.problems.length ? ` · not read: ${r.problems.join('; ')}` : ''}
                      </div>
                    </div>
                    <span className="ski-word">{r.action === 'create' ? 'Create' : r.action === 'update' ? 'Update' : r.action === 'add' ? 'Add' : 'Skip'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {step === 'done' && result && (
          <div className="ski-step">
            <p className="ski-lead" aria-live="polite">
              {result.created} created · {result.updated} updated{target === 'residency' ? ` · ${result.added} added to the roster` : ''} · {result.skipped} skipped
            </p>
            {!!result.failed.length && (
              <ul className="ski-diff">
                {result.failed.map(f => <li key={f.row}>Row {f.row}, {f.name}: {f.why}</li>)}
              </ul>
            )}
            <button type="button" className="ski-btn ski-btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </DetailDrawer>
  )
}
