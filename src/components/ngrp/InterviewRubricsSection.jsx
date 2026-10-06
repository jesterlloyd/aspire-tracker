// NGRP-INTERVIEWS-1 Phase 2 (Owner, 2026-10-05): the applicant binder's Interview sheet shows every
// interviewer's NGRP rubric and the panel result, for the ASPIRE team and Talent Acquisition (who
// see every rubric in full; an interviewer sees only their own, in the Unit Leader Portal).
// Reused, not redrawn: the internship rubric book's "All Rubrics for This Student" cards
// (`rub-rubric-card`, `rub-rc-*`, `rub-avg-display` in index.css) and its recommendation pill
// colours. The rules (composite, ranges, panel average, divergence, closer look) are
// src/lib/ngrp/ngrpRubric.js, the same module the unit leader's rubric book uses.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCandidateRubrics } from '../../lib/ngrp/useNgrpData'
import {
  NGRP_DOMAINS, compositeOf, panelSummary, recommendationLabel, questionText, SCORE_LEGEND, domainOf,
} from '../../lib/ngrp/ngrpRubric'

// The internship card's pill pairs (fixed ink on a fixed ground, both themes).
const REC_PILL = {
  recommend: ['#dcfce7', '#166534'],
  recommend_with_reservations: ['#fef3c7', '#92400e'],
  do_not_recommend: ['#fee2e2', '#991b1b'],
}
const note = { margin: '4px 0 0', fontSize: 12, color: 'var(--text-caption)' }
const day = v => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : '')

function RecPill({ rec }) {
  if (!rec || !REC_PILL[rec]) return null
  const [bg, ink] = REC_PILL[rec]
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: bg, color: ink }}>{recommendationLabel(rec)}</span>
}

function RubricCard({ r }) {
  const [open, setOpen] = useState(false)
  const comp = compositeOf(r)
  const done = r.status === 'completed'
  return (
    <div className="rub-rubric-card">
      <div className="rub-rc-top">
        <span className="rub-rc-name">{r.interviewer_name || 'Unknown'}</span>
        <span className="rub-rc-date">{day(r.completed_at || r.interview_at || r.updated_at)}</span>
        <span className="rub-rc-score">{comp !== null ? `${comp}/15` : '-/15'}</span>
        {done ? <RecPill rec={r.individual_recommendation} /> : (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: '#EEF0F2', color: '#454C55' }}>In progress</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
          <button type="button" className="btn btn-outline-modal" style={{ fontSize: 11, padding: '2px 10px' }}
            aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'View'}</button>
        </div>
      </div>
      <div className="rub-rc-scores">
        {NGRP_DOMAINS.map(d => <span key={d.key}>{d.key.toUpperCase()}: {r[`${d.key}_score`] || 0}/5</span>)}
        {r.suggested_unit && (
          <span style={{ marginLeft: 8, paddingLeft: 8, borderLeft: '1px solid #e5e7eb', color: 'var(--text-caption)', fontWeight: 400 }}>
            Suggested: <strong style={{ color: 'var(--text-heading)', fontWeight: 600 }}>{r.suggested_unit.trim()}</strong>
          </span>
        )}
      </div>
      {r.summary_comments && <p className="rub-rc-comments">{r.summary_comments}</p>}
      {open && (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          {NGRP_DOMAINS.map(d => {
            const s = r[`${d.key}_score`]
            const asked = questionText(d.key, r[`${d.key}_question`], r[`${d.key}_question_other`])
            return (
              <div key={d.key} style={{ fontSize: 12.5 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-heading)' }}>
                  {d.title}: {s ? `${s} · ${SCORE_LEGEND.find(x => x.score === s)?.label}` : 'not scored'}
                </div>
                {asked && <div style={{ color: 'var(--text-caption)', marginTop: 2 }}>Asked: {asked}</div>}
                {r[`${d.key}_notes`] && <div style={{ color: 'var(--text-heading)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{r[`${d.key}_notes`]}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function InterviewRubricsSection({ row, cycle, provisioned = false }) {
  const candidateId = row?.candidate_id || null
  const q = useQuery({
    queryKey: ['ngrp_workspace', 'rubrics', cycle?.id, candidateId],
    queryFn: () => fetchCandidateRubrics(cycle.id, candidateId),
    enabled: Boolean(provisioned && cycle?.id && candidateId),
    placeholderData: undefined,
  })
  if (!provisioned) return null
  const rubrics = q.data?.ok ? q.data.rubrics : []
  const panel = panelSummary(rubrics)
  const inProgress = rubrics.filter(r => r.status !== 'completed').length

  return (
    <section className="sp-section sp-card ngrp-rubrics" data-testid="ngrp-interview-rubrics">
      <h3 className="sp-section-hdr" style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0 }}>
        <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11 }}>Interview Rubrics</span>
      </h3>
      {!candidateId && <p style={note}>Rubrics appear once this alumnus is paired with a unit and interviewed.</p>}
      {candidateId && q.isLoading && <p style={note}>Loading rubrics…</p>}
      {candidateId && !q.isLoading && !q.data?.ok && <p style={note}>Rubrics could not be loaded. Refresh to try again.</p>}
      {candidateId && q.data?.ok && rubrics.length === 0 && (
        <p style={note}>No rubrics yet. The unit's interviewers score in the Unit Leader Portal's Interviews tab.</p>
      )}
      {rubrics.length > 0 && (
        <div className="rb-others" style={{ marginTop: 6 }}>
          {rubrics.map(r => <RubricCard key={r.id} r={r} />)}
          <div className="rub-avg-display">
            <span>Average Composite: <strong>{panel.average !== null ? `${panel.average.toFixed(1)}/15` : '-'}</strong></span>
            {panel.recommendation && <span style={{ marginLeft: 16 }}><RecPill rec={panel.recommendation} /></span>}
            {panel.range && <span style={{ marginLeft: 10, color: 'var(--text-caption)' }}>{panel.range.label}</span>}
          </div>
          <p style={note}>
            {panel.count} completed{inProgress ? ` · ${inProgress} in progress` : ''}. The panel average applies the sheet's ranges; the final
            recommendation rests with the panel and hiring leader.
          </p>
          {panel.diverged && (
            <p style={{ ...note, color: 'var(--aspire-warn)' }}>
              The interviewers differ by 4 points or more, or recommend differently: compare domain by domain before deciding.
            </p>
          )}
          {panel.closerLook.length > 0 && (
            <p style={{ ...note, color: 'var(--aspire-warn)' }}>
              {panel.closerLook.map(k => domainOf(k)?.title).join(' and ')} scored 1 or 2 by an interviewer: discuss it before a final decision.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
