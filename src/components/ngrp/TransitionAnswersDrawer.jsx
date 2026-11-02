// ROW-ANSWERS-1 (Owner, 2026-11-01): Interest & Eligibility's row click. One alumnus's latest
// Transition Form answers, read-only, through the same review the binder's "Review submitted form"
// reads, so whoever can open the binder can open this and nobody else.
import { useEffect, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import NgrpStatusPill from './NgrpStatusPill'
import { FORM_STATES } from '../../lib/ngrp/ngrpStates'
import { postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { transitionAnswerRows, submittedLine, noAnswersLine } from '../../lib/ngrp/transitionSummary'
import { displayName } from '../../lib/utils'

export default function TransitionAnswersDrawer({ row, onClose }) {
  const hasAnswers = Boolean(row.candidate_id) && (row.form_revision_count || 0) > 0
  const [state, setState] = useState(hasAnswers ? 'loading' : 'none')
  const [revision, setRevision] = useState(null)

  useEffect(() => {
    if (!hasAnswers) return undefined
    let cancelled = false
    postNgrpManage('candidate_review', { candidate_id: row.candidate_id }).then(res => {
      if (cancelled) return
      if (res?.ok !== false && res?.latestRevision) { setRevision(res.latestRevision); setState('ready') }
      else setState('error')
    }).catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [hasAnswers, row.candidate_id])

  return (
    <DetailDrawer open title="Transition Form" width={620} trapFocus onClose={onClose}>
      <div className="ngrp-answers-head">
        <div className="ngrp-answers-name">{displayName(row.student)}</div>
        <NgrpStatusPill config={FORM_STATES} value={row.form_status || 'not_sent'} srPrefix="Transition Form" />
        {state === 'ready' && <span className="ngrp-answers-when">{submittedLine(revision)}</span>}
      </div>
      {state === 'none' && <p className="ngrp-answers-note">{noAnswersLine(row)}</p>}
      {state === 'loading' && <p className="ngrp-answers-note" role="status">Loading answers…</p>}
      {state === 'error' && <p className="ngrp-answers-note" role="alert">The answers could not load. Close this and try again.</p>}
      {state === 'ready' && (
        <dl className="ngrp-answers">
          {transitionAnswerRows(revision.payload).map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </DetailDrawer>
  )
}
