// CANDIDATE-SCORE-1 (Owner, 2026-11-01): the candidate score on screen. One chip, read by the
// Interest & Eligibility table, the Interview Board cards and the binder's Application sheet, and
// the section that explains it. The number is the app's (src/lib/ngrp/candidateScoreModel.js),
// worked out on the server for every applicant; Keith only rates the statements and says why.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import KeithMark from '../keith/KeithMark'
import { STATEMENT_CATEGORIES, basedOnLine } from '../../lib/ngrp/candidateScoreModel'
import { postNgrpCandidateAssess } from '../../lib/ngrp/useNgrpData'

const fmtDay = ts => (ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

const FAIL_WORDS = {
  skill_off: 'Assess Candidate is switched off in Settings > Keith > Skills.',
  skill_denied: 'Your account cannot run Assess Candidate.',
  form_not_submitted: 'Keith assesses an applicant once they submit the Transition Form.',
  not_enabled: 'Assessments are available once the pending database update is applied.',
  timed_out: 'The last assessment did not finish.',
}

/** The score as a chip: "82 Strong fit", or the reason there is none. */
export function CandidateFitChip({ score, compact = false, withMark = true }) {
  if (!score) return <span className="ngrp-cellmute">Not scored</span>
  const band = score.ineligible ? 'none' : (score.band || 'none')
  const mark = withMark && score.assessment?.provenanceId ? <KeithMark provenanceId={score.assessment.provenanceId} /> : null
  if (score.score == null) {
    return <span className="ngrp-fitwrap"><span className="ngrp-cellmute">{score.label}</span>{mark}</span>
  }
  return (
    <span className="ngrp-fitwrap">
      <span className={`ngrp-fit ngrp-fit-${band}`} aria-label={`Candidate score ${score.score} of 100, ${score.label}`}>
        <b>{score.score}</b>{!compact && <span>{score.label}</span>}
      </span>
      {mark}
    </span>
  )
}

/** The binder's Candidate Score section (Application sheet). */
export function CandidateScoreSection({ row, cycleId, available = false, onChanged, Section, smallBtn }) {
  const score = row.candidate_score || null
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const status = useQuery({
    queryKey: ['ngrp_workspace', 'assess_status'],
    queryFn: () => postNgrpCandidateAssess('status'),
    enabled: available,
    staleTime: 5 * 60 * 1000,
  })
  const canRun = available && status.data?.ok && status.data.available
  const submitted = row.form_status === 'submitted' || row.form_status === 'revised'
  const a = score?.assessment || null
  const last = score?.lastRun || null
  const inFlight = running || last?.status === 'assessing'

  const run = async () => {
    setRunning(true); setError(null)
    const res = await postNgrpCandidateAssess('assess', { cycle_id: cycleId, candidate_id: row.candidate_id })
    setRunning(false)
    if (!res.ok) setError(res.code || 'upstream_error')
    await onChanged?.()
  }

  const button = canRun && submitted && row.candidate_id ? (
    <button type="button" style={{ ...smallBtn(!a), height: 24, padding: '0 9px', fontSize: 11 }} disabled={inFlight} onClick={run}>
      {inFlight ? 'Assessing…' : a ? 'Assess Again' : 'Assess with Keith'}
    </button>
  ) : null

  return (
    <Section title="Candidate Score" right={button}>
      <div className="ngrp-score-head">
        <CandidateFitChip score={score} />
        {score?.basedOn != null && <span className="ngrp-cellsub">{basedOnLine(score)}</span>}
      </div>
      {score && (
        <div className="ngrp-score-factors">
          {score.factors.map(f => (
            <div key={f.key} className="ngrp-score-factor">
              <span className="ngrp-score-name">{f.label}</span>
              <span className="ngrp-score-pts">{f.points == null ? 'Not counted' : `${Math.round(f.points)} of ${f.max}`}</span>
              <span className="ngrp-score-detail">{f.detail}</span>
            </div>
          ))}
        </div>
      )}
      <p className="ngrp-score-note">
        The score is worked out the same way for every applicant. A factor with nothing on file is left out rather
        than counted as low. It helps decide who to pair for an interview, and the interview decides the rest.
      </p>
      {inFlight && <p className="ngrp-score-note" role="status">Keith is reading the record. This usually takes under a minute.</p>}
      {!inFlight && (error || last?.status === 'failed') && (
        <p className="ngrp-score-note ngrp-score-bad" role="alert">
          {FAIL_WORDS[error || last?.errorReason] || 'Keith could not finish the assessment. Try again.'}
        </p>
      )}
      {!a && !inFlight && available && !submitted && (
        <p className="ngrp-score-note">{FAIL_WORDS.form_not_submitted}</p>
      )}
      {a && (
        <div className="ngrp-assess">
          <div className="ngrp-assess-title">
            <KeithMark provenanceId={a.provenanceId} />
            <span>Keith&rsquo;s Read{a.assessedAt ? `, ${fmtDay(a.assessedAt)}` : ''}</span>
          </div>
          {a.stale && <p className="ngrp-score-note ngrp-score-warn">Something Keith read has changed since. Assess again for a current read.</p>}
          {a.summary && <p className="ngrp-assess-p">{a.summary}</p>}
          {a.recommendation && (
            <>
              <div className="ngrp-assess-h">Interview Pairing</div>
              <p className="ngrp-assess-p">{a.recommendation}</p>
            </>
          )}
          <div className="ngrp-assess-h">Statement, {a.statementTotal} of 30</div>
          {STATEMENT_CATEGORIES.map(c => (
            <div key={c.key} className="ngrp-score-factor">
              <span className="ngrp-score-name">{c.label}</span>
              <span className="ngrp-score-pts">{a.statement?.[c.key]?.score ?? '—'} of 10</span>
              {a.statement?.[c.key]?.note && <span className="ngrp-score-detail">{a.statement[c.key].note}</span>}
            </div>
          ))}
          {[['Strengths', a.strengths], ['To Weigh', a.considerations], ['Interview Focus', a.interviewFocus]].map(([title, items]) => (
            items?.length ? (
              <div key={title}>
                <div className="ngrp-assess-h">{title}</div>
                <ul className="ngrp-assess-list">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null
          ))}
        </div>
      )}
    </Section>
  )
}
