// src/components/placement/KeithPlacementBar.jsx
//
// KEITH-PLACEMENT-1: one line above the Placement Board.
//   SHADOW  "Shadow mode, [cohort]. Keith suggests in the background. You place as usual." and the
//           comparison: students placed, how many matched Keith's first choice, how many were a
//           different unit at the same preference rank, "Hard rules broken: 0", and each
//           disagreement with both choices so the weights can be tuned. The Owner turns suggestions on.
//   ON      "[N] suggestions waiting." with Suggest for all unplaced, and the Owner's Turn off.
import { useState } from 'react'
import { RANK_WORD } from '../../lib/placementBoardView'

const rankWord = (r) => (r ? `${RANK_WORD[r]} choice` : 'not a choice')

export default function KeithPlacementBar({ keith, cohortName, canRun, isOwner, busy, onSuggestAll, onSetMode }) {
  const [open, setOpen] = useState(false)
  if (!keith?.available || keith.mode === 'off') return null
  const c = keith.comparison
  if (keith.mode === 'shadow') {
    return (
      <section className="pb-keith-bar" aria-label="Keith placement suggestions, shadow mode">
        <span><b>Shadow mode, {cohortName || 'this cohort'}.</b> Keith suggests in the background. You place as usual.</span>
        <span className="pb-keith-sp">
          {c && <button type="button" className="pb-sugg-btn" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Hide comparison' : 'Show comparison'}</button>}
          {isOwner && <button type="button" className="pb-sugg-btn pb-sugg-pri" disabled={busy} onClick={() => onSetMode('on')}>Turn on suggestions</button>}
        </span>
        {open && c && (
          <>
            <dl className="pb-keith-cmp">
              <div><dt>Students placed</dt><dd>{c.placed}</dd></div>
              <div><dt>You placed where Keith suggested</dt><dd>{c.matchedFirst} of {c.placed}{c.placed ? ` (${Math.round((c.matchedFirst / c.placed) * 100)}%)` : ''}</dd></div>
              <div><dt>Different unit, same preference rank</dt><dd>{c.sameRank}</dd></div>
              <div><dt>Hard rules broken</dt><dd>{c.hardRulesBroken}</dd></div>
            </dl>
            {c.disagreements.length > 0 && (
              <ul className="pb-keith-dis" aria-label="Where you and Keith differed">
                {c.disagreements.map((d, i) => <li key={i}>{d.student}: Keith {d.keith} ({rankWord(d.keithRank)}), placed {d.placed} ({rankWord(d.placedRank)})</li>)}
              </ul>
            )}
          </>
        )}
      </section>
    )
  }
  const n = keith.suggestions?.length || 0
  return (
    <section className="pb-keith-bar" aria-label="Keith placement suggestions">
      <span><b>{n} {n === 1 ? 'suggestion' : 'suggestions'} waiting.</b> Code checks the hard rules. Keith reads goals and notes and writes the reason.</span>
      <span className="pb-keith-sp">
        {canRun && <button type="button" className="pb-sugg-btn pb-sugg-pri" disabled={busy} onClick={onSuggestAll}>{busy ? 'Working…' : 'Suggest for all unplaced'}</button>}
        {isOwner && <button type="button" className="pb-sugg-btn" disabled={busy} onClick={() => onSetMode('shadow')}>Turn off suggestions</button>}
      </span>
    </section>
  )
}
