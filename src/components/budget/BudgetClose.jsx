// src/components/budget/BudgetClose.jsx
//
// BUDGET-V2 Phase 2, item 13 (2026-09-29): the Summary's Close card. Reference: "Close September"
// in docs/mockups/program-budget-v2.html. The server sends year.close: every month with its
// posted and expected totals and whether it is closed (and its note), the target month, and for
// the owner each open month's checklist (src/lib/budget/monthClose.js). Nothing is decided here.
//
// BUDGET-FIXES-1 item 2.4 (Owner, 2026-09-29): months close in order. The card works on the oldest
// open month; a later one cannot be chosen until it is closed (the server refuses it too).
// The owner sees the card from the 25th through the 10th, and while any earlier month is open: a
// strip of months, the checklist, Close (when every item passes) and Close with a note (always).
// A closed month can be reopened from the strip. A reader sees which months are reconciled and
// the notes they were closed with.
import { useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import { Pill } from '../shared/DataSheet'
import { usd, dateText, pacificToday } from '../../lib/budget/budgetModel'
import { monthStatus } from '../../lib/budget/monthClose'

// A timestamp, as the day it was where the reader is (never the UTC day).
const stamp = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const monthName = (m) => m?.name || ''

export default function BudgetClose({ year, canEdit, onWrite, onGo }) {
  const close = year.close
  const [pick, setPick] = useState(null)          // a month the owner chose from the strip
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [today] = useState(() => pacificToday())
  if (!close) return null
  if (close.enabled === false) {
    return canEdit && (year.state === 'current' || year.state === 'closed')
      ? <p className="bud-hint" role="note">Closing a month needs its database update (20261022000000_budget_v2_phase2.sql).</p>
      : null
  }
  // MONTH-CONTROL-1 (Owner, 2026-10-01): the Owner closes and reopens months in a closed year too.
  const owner = canEdit && (year.state === 'current' || year.state === 'closed')
  const months = close.months || []
  const closedAny = months.some(m => m.closed_at)
  const checklists = close.checklists || {}
  const canPick = (key) => key === close.target || !!months.find(m => m.key === key)?.closed_at
  const selectedKey = pick && canPick(pick) ? pick : close.target
  const selected = months.find(m => m.key === selectedKey) || null

  // A reader, a closed year, or an owner with nothing to close and nothing closed: say nothing more.
  if (!owner && !closedAny) return null
  if (owner && !close.target && !closedAny) return null

  // Every month to this one (the strip shows them all, item 2.4), then the next as Upcoming.
  const nowIdx = months.findIndex(m => m.key === String(today).slice(0, 7))
  const last = Math.max(nowIdx, months.findIndex(m => m.key === (close.target || selectedKey)), months.reduce((a, m, i) => (m.closed_at ? i : a), -1))
  const strip = months.slice(0, Math.min(months.length, (owner ? last + 2 : last + 1)))
  const closedSet = new Set(months.filter(m => m.closed_at).map(m => m.key))
  const statusOf = (m) => monthStatus(m.key, { closed: closedSet, target: owner ? selectedKey : null, today })
  const list = selectedKey ? checklists[selectedKey] : null
  // The ended months still open behind the one being closed: they wait their turn.
  const waiting = strip.filter(m => !m.closed_at && m.key !== close.target && statusOf(m).key === 'not_closed').map(m => m.name)
  const targetName = months.find(m => m.key === close.target)?.name

  const run = async (action, payload, done) => {
    setBusy(true)
    try { if (await onWrite.run(action, { fiscal_year: year.fy, ...payload })) done?.() } finally { setBusy(false) }
  }

  return (
    <SurfaceCard className="bud-card bud-close" aria-labelledby="bud-close-h">
      <div className="bud-close-head">
        <h2 id="bud-close-h">{owner && selected && !selected.closed_at ? `Close ${monthName(selected)}` : 'Months Reconciled'}</h2>
        {owner && selected && !selected.closed_at && <span className="bud-hint">Shown from the 25th through the 10th, or while a month is open{selectedKey === close.target && close.due ? ` · due ${dateText(close.due).replace(/, \d{4}$/, '')}` : ''}</span>}
      </div>
      <div className="bud-months" role="list">
        {strip.map(m => {
          const st = statusOf(m)
          const choosable = owner && canPick(m.key) && (checklists[m.key] || m.closed_at)
          const body = (
            <>
              <b>{m.label}</b>
              <span className="n">{m.posted || !m.expected ? usd(m.posted) : `${usd(m.expected)} expected`}</span>
              <Pill tone={st.tone}>{st.label}</Pill>
            </>
          )
          return choosable
            ? <button key={m.key} type="button" role="listitem" className={`bud-mo${m.key === selectedKey ? ' cur' : ''}`} aria-pressed={m.key === selectedKey} onClick={() => { setPick(m.key); setNoting(false) }}>{body}</button>
            : <div key={m.key} role="listitem" className={`bud-mo${m.key === selectedKey ? ' cur' : ''}${st.label === 'Upcoming' ? ' dim' : ''}`}>{body}</div>
        })}
      </div>

      {owner && selected && selected.closed_at && (
        <div className="bud-close-done">
          <Pill tone="ok">{selected.name} closed {stamp(selected.closed_at)}{selected.closed_by ? ` by ${selected.closed_by}` : ''}</Pill>
          {selected.note && <span className="bud-hint">Note: {selected.note}</span>}
          <button type="button" className="bud-btn bud-btn-txt bud-btn-sm" disabled={busy} onClick={() => run('month_reopen', { month: selected.key }, () => setPick(selected.key))}>Reopen</button>
        </div>
      )}

      {owner && list && selected && !selected.closed_at && (
        <>
          <ul className="bud-cl">
            {list.items.map(i => (
              <li key={i.key}>
                <span className={i.ok ? 'ok' : 'no'} aria-hidden="true">{i.ok ? '✓' : '!'}</span>
                <span><b className={i.ok ? undefined : 'todo'}>{i.title}</b><small>{i.detail}</small></span>
                <span>
                  {!i.ok && i.key === 'concur' && <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => run('concur_mark_submitted', { month: selected.key })}>Mark all Submitted to Concur</button>}
                  {!i.ok && i.key === 'review' && onGo && <button type="button" className="bud-btn bud-btn-sm" onClick={() => onGo('receipts')}>Review</button>}
                  {!i.ok && i.key === 'receipts' && onGo && <button type="button" className="bud-btn bud-btn-sm" onClick={() => onGo('sheet', 'missing-receipt')}>Show in Sheet</button>}
                </span>
              </li>
            ))}
          </ul>
          {noting ? (
            <div className="bud-close-note">
              <label className="bud-fld"><span>Note for leadership</span>
                <textarea className="bud-textarea" rows={2} maxLength={2000} value={note} autoFocus placeholder="Why this month is closing with items open, for example: the Supabase receipt is requested from the vendor."
                  onChange={e => setNote(e.target.value)} /></label>
              <div className="bud-close-acts">
                <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || !note.trim()} onClick={() => run('month_close', { month: selected.key, note: note.trim() }, () => { setNoting(false); setNote(''); setPick(selected.key) })}>Close {selected.name} with this note</button>
                <button type="button" className="bud-btn bud-btn-sm" onClick={() => setNoting(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="bud-close-acts">
              <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || !list.ready} title={list.ready ? undefined : 'Finish the items above, or close with a note'}
                onClick={() => run('month_close', { month: selected.key }, () => setPick(selected.key))}>Close {selected.name}</button>
              <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => setNoting(true)}>Close with a note</button>
              <span className="bud-hint">{list.ready ? 'Everything checks out.' : 'Finish the items above, or close with a note that leadership sees.'}</span>
            </div>
          )}
        </>
      )}

      {owner
        ? <p className="bud-hint">{waiting.length && targetName ? `Months close in order: ${waiting.join(' and ')} ${waiting.length === 1 ? 'closes' : 'close'} after ${targetName}. ` : ''}Closing a month locks its rows and adds it to Budget history. Leadership sees which months are reconciled.</p>
        : months.filter(m => m.closed_at && m.note).map(m => <p key={m.key} className="bud-hint"><b>{m.name}</b> closed with a note: {m.note}</p>)}
    </SurfaceCard>
  )
}
