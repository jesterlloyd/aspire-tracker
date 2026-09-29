// src/components/placement/SuggestionSlip.jsx
//
// KEITH-PLACEMENT-1 (2026-09-29): Keith's suggestion on a unit board. A dashed slip inside an open slot:
// "Suggested by Keith" with the Keith mark, the student's paper note with the preceptor and the match
// rank, Keith's reason, the rule checks as chips, and Accept, Swap and Reject. Swap opens the next
// two candidates (each on its own unit) with their reasons. A slip is something you act on, never a
// table row (table canon section 2). Reference: 3 · Placement suggestions in
// docs/mockups/keith-workflow.html, drawn in the board's own materials.
import { useState } from 'react'
import KeithMark from '../keith/KeithMark'
import { RANK_WORD } from '../../lib/placementBoardView'

const rankText = (r) => (r ? `${RANK_WORD[r]} choice match` : 'Not among their choices')

function Chips({ checks }) {
  return (
    <div className="pb-sugg-rules" aria-label="Checked by the placement rules">
      {checks.filter(c => c.ok).map(c => <span key={c.key}>✓ {c.label}</span>)}
    </div>
  )
}

export default function SuggestionSlip({ suggestion, busy = false, canAct = true, onAccept, onReject }) {
  const [swap, setSwap] = useState(false)
  const s = suggestion
  const stop = (e) => e.stopPropagation()
  return (
    <div className="pb-sugg" data-testid="keith-suggestion" onClick={stop} onKeyDown={stop}>
      <span className="pb-sugg-head"><KeithMark provenanceId={s.provenanceId} /> Suggested by Keith</span>
      <div className="paper-note pb-note pb-sugg-note">
        <div className="pb-note-name">{s.studentName}</div>
        <div className="pb-sugg-meta">Preceptor: {s.preceptorName || 'Not named'}</div>
        <div className="pb-sugg-rank">{rankText(s.prefRank)}</div>
      </div>
      {s.reason && <p className="pb-sugg-reason">{s.reason}</p>}
      <Chips checks={s.checks} />
      {canAct && (
        <div className="pb-sugg-acts">
          <button type="button" className="pb-sugg-btn pb-sugg-pri" disabled={busy} onClick={() => onAccept(s)}>{busy ? 'Working…' : 'Accept'}</button>
          <button type="button" className="pb-sugg-btn" disabled={busy || !s.alternatives?.length} aria-expanded={swap} onClick={() => setSwap(v => !v)}
            title={s.alternatives?.length ? undefined : 'No other unit passes the rules for this student'}>Swap</button>
          <button type="button" className="pb-sugg-btn" disabled={busy} onClick={() => onReject(s)}>Reject</button>
        </div>
      )}
      {swap && (
        <div className="pb-sugg-alts" aria-label={`Other options for ${s.studentName}`}>
          {s.alternatives.map(a => (
            <div key={a.id} className="pb-sugg-alt">
              <div className="pb-sugg-alt-head">
                <KeithMark provenanceId={a.provenanceId} />
                <b>{a.unitName}</b>
                <span className="pb-sugg-meta">{rankText(a.prefRank)} · {a.preceptorName || 'Preceptor not named'}</span>
              </div>
              {a.reason && <p className="pb-sugg-reason">{a.reason}</p>}
              <Chips checks={a.checks} />
              {canAct && <button type="button" className="pb-sugg-btn pb-sugg-pri" disabled={busy} onClick={() => onAccept({ ...a, studentId: s.studentId, studentName: s.studentName })}>Place on {a.unitName}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
