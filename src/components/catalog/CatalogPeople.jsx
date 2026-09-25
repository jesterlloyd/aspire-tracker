// src/components/catalog/CatalogPeople.jsx
//
// CATALOG-PEOPLE-1 (Owner, 2026-09-24): the detail panel of a form or signature template lists
// everyone it went to, the way the mockup drew it: a name, a state (done or signed, overdue,
// opened, not opened) and Remind right there, so tracking completion never needs another
// screen. The states are catalogModel.completionStatus, the same words the counts use.
//
// A form lists one row per link; a signature template one row per request, named by its first
// signer ("+ 1 more" when the request has others). Remind is the engine's own reminder: a form
// link through form-staff, a signature request through sig-staff.
import { useEffect, useMemo, useState } from 'react'
import { completionStatus } from '../../lib/catalog/catalogModel'
import { formStaff } from '../forms/formsApi'
import { sigStaff } from '../signatures/sigApi'

const WORD = { done: 'Done', overdue: 'Overdue', opened: 'Opened', not_opened: 'Not opened' }
const FILTERS = [['all', 'Everyone'], ['waiting', 'Not done'], ['overdue', 'Overdue'], ['done', 'Done']]
const short = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

export default function CatalogPeople({ row, kind, notify, onResponses, sigAllowed }) {
  const [people, setPeople] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(null)   // a person's id, or 'all'

  // The panel keys this by item, so a new item starts empty; `round` refetches after a Remind.
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    formStaff('people', { catalog_resource_id: row.id })
      .then(r => { if (live) { setPeople(r.people || []); setError(null) } })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [row.id, round])

  const rows = useMemo(() => (people || []).map(p => ({ ...p, state: p.closed && !p.completed_at ? 'closed' : completionStatus(p) })), [people])
  const counts = useMemo(() => {
    const c = { all: rows.length, done: 0, overdue: 0, waiting: 0 }
    for (const p of rows) { if (p.state === 'done') c.done++; else if (p.state !== 'closed') c.waiting++; if (p.state === 'overdue') c.overdue++ }
    return c
  }, [rows])
  const shown = rows.filter(p => filter === 'all' || (filter === 'done' ? p.state === 'done' : filter === 'overdue' ? p.state === 'overdue' : p.state !== 'done' && p.state !== 'closed'))
  const doneWord = kind === 'signature' ? 'Signed' : 'Done'
  // A closed link (a form closed past due, a request expired or declined) is not reminded, and a
  // signature request is reminded only while the signatures flag admits this person.
  const remindable = (p) => (p.state === 'overdue' || p.state === 'opened' || p.state === 'not_opened') && (p.kind !== 'signature' || sigAllowed)

  const remind = async (list, key) => {
    setBusy(key)
    try {
      const forms = list.filter(p => p.kind === 'form').map(p => p.id)
      let n = 0
      if (forms.length) n += (await formStaff('remind', { ids: forms })).reminded || 0
      for (const p of list.filter(x => x.kind === 'signature')) n += (await sigStaff('remind', { id: p.id })).reminded || 0
      notify?.(n ? `Reminder sent to ${n} ${n === 1 ? 'person' : 'people'}.` : 'No reminder was sent. Their link may have closed.', n ? 'ok' : 'err')
      setRound(n => n + 1)
    } catch (e) { notify?.(e.message, 'err') } finally { setBusy(null) }
  }

  if (error) return <p className="ctl-hint" role="alert">{error}</p>
  if (!people) return <p className="ctl-hint">Loading who it went to…</p>
  if (!rows.length) return <p className="ctl-hint">Not sent to anyone yet. Use Send above.</p>

  const waiting = rows.filter(remindable)
  return (
    <section className="ctl-people" aria-label="Who it went to">
      <div className="ctl-people-head">
        <h3>Who it went to</h3>
        <span>{counts.done} of {rows.length} {kind === 'signature' ? 'signed' : 'done'}</span>
      </div>
      <div className="ctl-people-bar" role="img" aria-label={`${counts.done} of ${rows.length} ${kind === 'signature' ? 'signed' : 'done'}${counts.overdue ? `, ${counts.overdue} overdue` : ''}`}>
        <i className="ctl-pb-done" style={{ width: `${(counts.done / rows.length) * 100}%` }} />
        <i className="ctl-pb-over" style={{ width: `${(counts.overdue / rows.length) * 100}%` }} />
      </div>
      <div className="ctl-people-tools">
        <div className="ctl-people-filters" role="group" aria-label="Show">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'done' ? doneWord : l}<b>{counts[k] ?? 0}</b></button>
          ))}
        </div>
        {waiting.length > 0 && (
          <button type="button" className="ctl-btn ctl-btn-sm" disabled={!!busy} onClick={() => remind(waiting, 'all')}>
            {busy === 'all' ? 'Reminding…' : `Remind all not done (${waiting.length})`}</button>
        )}
      </div>
      <ul className="ctl-people-list">
        {!shown.length && <li className="ctl-people-none">No one in this group.</li>}
        {shown.map(p => (
          <li key={`${p.kind}-${p.id}`} className="ctl-person">
            <span className="ctl-person-who">
              <b>{p.name}{p.others ? <small> + {p.others} more</small> : null}</b>
              <small>{p.email}{p.school ? ` · ${p.school}` : ''}</small>
            </span>
            <span className={`ctl-pstate ctl-pstate-${p.state}`}>{p.state === 'done' ? doneWord : p.state === 'closed' ? p.closed : WORD[p.state]}</span>
            <span className="ctl-person-when">
              {p.state === 'done' ? `${doneWord} ${short(p.completed_at)}` : p.due_at ? `Due ${short(p.due_at)}` : `Sent ${short(p.sent_at)}`}
              {p.reminders ? <small>{p.reminders} reminder{p.reminders === 1 ? '' : 's'}</small> : null}
            </span>
            <span className="ctl-person-act">
              {remindable(p) && <button type="button" className="ctl-btn ctl-btn-sm" disabled={!!busy} onClick={() => remind([p], p.id)} aria-label={`Remind ${p.name}`}>{busy === p.id ? '…' : 'Remind'}</button>}
            </span>
          </li>
        ))}
      </ul>
      {onResponses && <button type="button" className="ctl-link" onClick={onResponses}>{kind === 'signature' ? 'Open Signature requests' : 'Open Responses for answers and the Sheet'}</button>}
    </section>
  )
}
