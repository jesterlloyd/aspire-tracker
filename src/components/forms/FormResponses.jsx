// src/components/forms/FormResponses.jsx
//
// FORMS-PHASE3: /catalog/forms/:id/responses, the completion tracker (brief section 5):
// every person a form was sent to, their state (submitted, overdue, opened, sent, closed,
// withdrawn), Remind and Remind all overdue, each answer with its filed PDF, and the CSV
// export. Overdue is computed from the due date, never stored (assignmentState).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { assignmentState, takesAnswer, answerText } from '../../lib/forms/formModel'
import { completionStats, progressLabel } from '../../lib/catalog/catalogModel'
import { formStaff, downloadCsv } from './formsApi'
import FormSheet from './FormSheet'
import FormSummary from './FormSummary'

const WORD = { submitted: 'Submitted', overdue: 'Overdue', opened: 'Opened', sent: 'Not opened', closed: 'Closed', voided: 'Withdrawn' }
const FILTERS = [['all', 'Everyone'], ['submitted', 'Submitted'], ['overdue', 'Overdue'], ['opened', 'Opened'], ['sent', 'Not opened'], ['closed', 'Closed']]
const short = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

export default function FormResponses({ formId, notify, onBack, onEdit }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [picked, setPicked] = useState(() => new Set())
  const [open, setOpen] = useState(null)      // a submission being read
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('people')   // People (who and status) | Sheet (the answers) | Summary (FORM-SUMMARY-1)

  const load = useCallback(async () => {
    try { setData(await formStaff('assignments', { id: formId })); setError(null) } catch (e) { setError(e.message) }
  }, [formId])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => (data?.assignments || []).map(a => ({ ...a, state: assignmentState(a) })), [data])
  const counts = useMemo(() => { const c = { all: rows.length }; for (const r of rows) c[r.state] = (c[r.state] || 0) + 1; return c }, [rows])
  const stats = useMemo(() => completionStats(rows.filter(r => r.state !== 'voided' && r.state !== 'closed').map(r => ({ due_at: r.due_at, opened_at: r.opened_at, completed_at: r.submitted_at }))), [rows])
  const shown = rows.filter(r => filter === 'all' || r.state === filter)
  // FORM-FORWARD-1: a filled PDF the office's inbox did not accept can be sent again.
  const resend = async (a) => {
    try { await formStaff('forward', { assignment_id: a.id }); notify?.(`Sent ${a.name}'s form to ${a.forward.to}.`); await load() }
    catch (e) { notify?.(e.message, 'err') }
  }
  const remindable = [...picked].filter(id => ['sent', 'opened', 'overdue'].includes(rows.find(r => r.id === id)?.state))

  const act = async (fn, ok) => {
    setBusy(true)
    try { const out = await fn(); if (ok) notify?.(typeof ok === 'function' ? ok(out) : ok); setPicked(new Set()); await load() }
    catch (e) { notify?.(e.message, 'err') } finally { setBusy(false) }
  }
  const openAnswer = async (a) => {
    try { setOpen({ loading: true, a }); setOpen({ ...(await formStaff('submission', { assignment_id: a.id })), a }) }
    catch (e) { setOpen(null); notify?.(e.message, 'err') }
  }

  if (error) return <div className="fm"><p className="fm-err" role="alert">{error}</p><button type="button" className="fm-btn" onClick={onBack}>‹ Catalog</button></div>
  if (!data) return <div className="fm"><p className="fm-hint">Loading responses…</p></div>
  const form = data.form

  return (
    <div className="fm">
      <div className="fm-head">
        <div>
          <div className="fm-crumb"><button type="button" onClick={onBack}>‹ Catalog</button><span>/</span><span>Forms</span><span>/</span><span>Responses</span></div>
          <h1>{form.draft?.title} <span className="fm-tag">Responses</span></h1>
          <p className="fm-save">{rows.length ? progressLabel('form', stats) : 'Nothing has been sent yet. Send it from the Catalog.'}</p>
        </div>
        <div className="fm-row">
          <button type="button" className="fm-btn" onClick={onEdit}>Edit form</button>
          {form.settings?.exportCsv !== false && form.current_version > 0 && (
            <button type="button" className="fm-btn" onClick={() => act(() => downloadCsv(form.id, form.current_version))} disabled={busy}>Export answers (CSV)</button>
          )}
          <button type="button" className="fm-btn fm-pri" disabled={busy || !counts.overdue}
            onClick={() => act(() => formStaff('remind_overdue', { id: form.id }), (o) => `Reminders sent to ${o.reminded} ${o.reminded === 1 ? 'person' : 'people'}.`)}>
            Remind all overdue{counts.overdue ? ` (${counts.overdue})` : ''}</button>
        </div>
      </div>

      <div className="fm-tabs fs-views" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={view === 'people'} onClick={() => setView('people')}>People</button>
        <button type="button" role="tab" aria-selected={view === 'sheet'} onClick={() => setView('sheet')}>Sheet</button>
        <button type="button" role="tab" aria-selected={view === 'summary'} onClick={() => setView('summary')}>Summary</button>
      </div>

      {view === 'summary' ? <FormSummary formId={form.id} onSheet={() => setView('sheet')} />
        : view === 'sheet' ? <FormSheet formId={form.id} notify={notify} onOpen={openAnswer} /> : (<>
      {rows.length > 0 && (
        <div className="fm-bar" role="img" aria-label={progressLabel('form', stats)}>
          {['done', 'overdue', 'opened', 'not_opened'].map(k => <i key={k} className={`fm-bar-${k}`} style={{ width: `${stats.total ? (stats[k] / stats.total) * 100 : 0}%` }} />)}
        </div>
      )}

      <div className="fm-chips" role="group" aria-label="Show">
        {FILTERS.map(([k, l]) => <button key={k} type="button" className="fm-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}<b>{counts[k] || 0}</b></button>)}
      </div>

      {picked.size > 0 && (
        <div className="fm-sel" role="status">
          <span>{picked.size} selected</span>
          <button type="button" className="fm-btn fm-sm" disabled={busy || !remindable.length}
            onClick={() => act(() => formStaff('remind', { ids: remindable }), (o) => `Reminders sent to ${o.reminded} ${o.reminded === 1 ? 'person' : 'people'}.`)}>Remind</button>
          <button type="button" className="fm-btn fm-sm fm-danger" disabled={busy || !remindable.length}
            onClick={() => act(() => formStaff('void', { ids: remindable }), 'Withdrawn. Those links no longer open.')}>Withdraw</button>
          <button type="button" className="fm-link" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      <div className="fm-card fm-tablewrap">
        <table className="fm-table">
          <thead><tr>
            <th scope="col" className="aspire-th fm-cb"><span className="fm-sr">Select</span></th>
            <th scope="col" className="aspire-th">Person</th><th scope="col" className="aspire-th">Status</th><th scope="col" className="aspire-th">Due</th><th scope="col" className="aspire-th">Sent</th><th scope="col" className="aspire-th">Answered</th><th scope="col" className="aspire-th"><span className="fm-sr">Actions</span></th>
          </tr></thead>
          <tbody>
            {!shown.length && <tr><td colSpan={7} className="fm-emptycell">{rows.length ? 'No one in this group.' : 'No one yet.'}</td></tr>}
            {shown.map(a => (
              <tr key={a.id}>
                <td className="fm-cb">{['sent', 'opened', 'overdue'].includes(a.state) && (
                  <input type="checkbox" aria-label={`Select ${a.name}`} checked={picked.has(a.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n })} />
                )}</td>
                <td><b>{a.name}</b><small>{a.email}{a.school_name ? ` · ${a.school_name}` : ''}</small></td>
                <td><span className={`fm-st fm-st-${a.state}`}>{WORD[a.state]}</span>{a.delivery_ok === false && <small className="fm-warn">Email not accepted</small>}</td>
                <td>{short(a.due_at) || '-'}</td>
                <td>{short(a.sent_at)}{a.reminder_count ? <small>{a.reminder_count} reminder{a.reminder_count === 1 ? '' : 's'}</small> : null}</td>
                <td>{short(a.submitted_at) || '-'}{a.form_version !== form.current_version ? <small>version {a.form_version}</small> : null}
                  {a.forward && (a.forward.ok
                    ? <small>Sent to {a.forward.to}</small>
                    : <small className="fm-warn">Not sent to {a.forward.to} <button type="button" className="fm-link" onClick={() => resend(a)}>Resend</button></small>)}</td>
                <td>{a.state === 'submitted' && <button type="button" className="fm-btn fm-sm" onClick={() => openAnswer(a)}>View</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>)}

      {open && (
        <div className="fm-scrim" onMouseDown={() => setOpen(null)}>
          <div className="fm-modal" role="dialog" aria-modal="true" aria-label={`Answers from ${open.a.name}`} onMouseDown={e => e.stopPropagation()}>
            <div className="fm-prevbar"><b>{open.a.name}</b><button type="button" className="fm-btn fm-sm" onClick={() => setOpen(null)}>Close</button></div>
            {open.loading ? <p className="fm-hint">Loading…</p> : (
              <>
                <p className="fm-hint">Submitted {new Date(open.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}{open.filed ? ", and filed to their record." : '.'}</p>
                <dl className="fm-answers">
                  {open.definition.questions.filter(takesAnswer).map(q => (
                    <div key={q.id}><dt>{q.label}</dt><dd>
                      {q.type === 'file' && open.answers[q.id]?.path
                        ? <button type="button" className="fm-link" onClick={async () => { const r = await formStaff('file_url', { assignment_id: open.a.id, path: open.answers[q.id].path }); if (r.url) window.open(r.url, '_blank', 'noopener') }}>{open.answers[q.id].name || 'Open file'}</button>
                        : q.type === 'signature' && open.answers[q.id]?.kind === 'draw'
                          ? <svg viewBox="0 0 100 30" className="fm-sigprev" aria-label="Drawn signature"><path d={open.answers[q.id].path} /></svg>
                          : (answerText(q, open.answers[q.id]) || <span className="fm-none">No answer</span>)}
                    </dd></div>
                  ))}
                </dl>
                {open.pdfUrl && <a className="fm-btn" href={open.pdfUrl} target="_blank" rel="noopener">Open the PDF</a>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
