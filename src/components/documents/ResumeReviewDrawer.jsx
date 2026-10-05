// src/components/documents/ResumeReviewDrawer.jsx
//
// RESUME-REVIEW-1 (résumé review build, Phase 3): one Keith review of one résumé version.
// Reference: docs/mockups/support-resume-review.html, the review modal. Two columns: the
// résumé Keith read (with the top fixes highlighted) and its score history on the left; the
// missing information, the score, the six categories, the fixes, the full report and the
// draft reply on the right. Every figure comes from resumeReviewModel; nothing is computed here.
//
// Phase 4 adds Open in Outreach (and logging Résumé Review on send). Until then the draft is
// copied, and copying never logs support.
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, RefreshCw, Send } from 'lucide-react'
import DetailDrawer from '../ui/DetailDrawer'
import { Pill } from '../shared/DataSheet'
import KeithMark from '../keith/KeithMark'
import { displayName } from '../../lib/utils'
import {
  getResumeReview, reviseResumeDraft, saveResumeDraft, openStudentDocumentVersion, studentDocumentsKey, reviewErrorText,
} from '../../lib/documents/studentDocumentsClient'
import {
  CATEGORIES, LOW_CATEGORY, MISSING_INFO, composeDraft, copyScoreLine, scoreChange, highlightRuns, trackerSteps, reviewState,
} from '../../lib/documents/resumeReviewModel'
import { shortDay } from '../../lib/documents/documentChecklist'
import { writeLaunchContext } from '../../lib/connect/launchContext'
import { resumeReviewHandoff, outreachHandoffPath } from '../../lib/documents/supportHandoffModel'
import './resumeReview.css'

const firstName = s => s?.preferred_first_name || s?.first_name || displayName(s)
const READINESS_TONE = { 'Highly Competitive': 'ok', Competitive: 'info', 'Needs Improvement': 'warn' }
const signed = n => (n > 0 ? `+${n}` : String(n))

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

function ScoreRing({ score }) {
  const r = 34
  const c = 2 * Math.PI * r
  const share = Math.max(0, Math.min(100, score || 0)) / 100
  return (
    <div className="rr-ring">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} className="rr-ring-track" />
        <circle cx="42" cy="42" r={r} className="rr-ring-fill" strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 42 42)" />
      </svg>
      <div className="rr-ring-text"><b>{score}</b><small>of 100</small></div>
    </div>
  )
}

function FullReport({ review }) {
  const r = review.full_report || {}
  const rec = r.recommendations || {}
  const recGroups = [['Before submitting', rec.before_submitting], ['Consider adding', rec.consider_adding], ['Do not include', rec.do_not_include], ['Interview prep', rec.interview_prep]]
  return (
    <div className="rr-report">
      <h4>1. Overall score</h4>
      <p>{review.score} of 100. {review.summary}</p>
      <h4>2. Category scores</h4>
      <ul>{CATEGORIES.map(c => <li key={c.key}><b>{c.label}: {review.categories?.[c.key]?.score}/10.</b> {review.categories?.[c.key]?.note}</li>)}</ul>
      <h4>3. Strengths</h4>
      <ul>{(review.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
      <h4>4. High-priority improvements</h4>
      <ol>{(review.top_fixes || []).map((f, i) => <li key={i}>{f.fix}</li>)}</ol>
      <h4>5. Section by section</h4>
      <ul>{(r.section_review || []).map((s, i) => <li key={i}><b>{s.section}.</b> {s.comment}</li>)}</ul>
      <h4 id="rr-bullets">6. Rewritten bullets</h4>
      <ul className="rr-bullets">{(r.rewritten_bullets || []).map((b, i) => (
        <li key={i}>{b.original && <span className="rr-orig">{b.original}</span>}<span>{b.rewrite}</span></li>
      ))}</ul>
      <h4>7. Keywords</h4>
      <p>{(r.keywords || []).join(', ') || '–'}</p>
      <h4>8. Recruiter perspective</h4>
      <p>{r.recruiter_perspective || '–'}</p>
      <h4>9. Readiness</h4>
      <p><b>{review.readiness}.</b> {review.readiness_reason}</p>
      <h4>10. Final recommendations</h4>
      {recGroups.filter(([, l]) => l?.length).map(([t, l]) => (
        <div key={t}><div className="rr-mono">{t}</div><ul>{l.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      ))}
    </div>
  )
}

function DraftBox({ review, student, sender, canWrite, toast, onSaved, cycle, version }) {
  const navigate = useNavigate()
  const [subject, setSubject] = useState(review.draft_subject || '')
  const [body, setBody] = useState(review.draft_body || '')
  const [includeScore, setIncludeScore] = useState(review.include_score !== false)
  const [includeBullets, setIncludeBullets] = useState(review.include_bullets === true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(null)
  const [live, setLive] = useState('')
  const composed = composeDraft({
    body, score: review.score, readiness: review.readiness, includeScore,
    bullets: review.full_report?.rewritten_bullets || [], includeBullets, sender: sender || {},
  })
  const save = (patch) => { if (canWrite) saveResumeDraft(review.id, patch).then(r => { if (!r.ok) toast?.error?.('Draft not saved', 'Your change shows here but was not saved.') }) }

  const revise = async (style) => {
    setBusy(style)
    const r = await reviseResumeDraft(review.id, style)
    setBusy(null)
    if (!r.ok) { toast?.error?.('Draft not changed', reviewErrorText(r)); return }
    setBody(r.draft.body)
    if (r.draft.subject) setSubject(r.draft.subject)
    setLive(`Draft ${style === 'fresh' ? 'regenerated' : `made ${style}`}.`)
    onSaved?.()
  }
  const copyDraft = async () => {
    const ok = await copyText(`Subject: ${subject}\n\n${composed}`)
    if (ok) {
      toast?.info?.('Draft copied', 'Copying does not log support.')
      setLive('Draft copied.')
    } else toast?.error?.('Could not copy', 'Select the text and copy it instead.')
  }

  // SUPPORT-OUTREACH-1: the draft as it reads here, the résumé attached, tagged to this
  // alumnus. Sending it from Outreach logs Résumé Review with the send date.
  const canHandoff = canWrite && Boolean(cycle?.id) && Boolean(version)
  const openInOutreach = () => {
    const ctx = writeLaunchContext(resumeReviewHandoff({ review, student, cycle, version, includeScore, includeBullets, subject, body }))
    if (!ctx) { toast?.error?.('Could not open Outreach', 'This browser blocked the hand-off. Copy the draft instead.'); return }
    navigate(outreachHandoffPath(student.id))
  }

  return (
    <section className="rr-box" aria-labelledby="rr-draft-title">
      <div className="rr-boxh">
        <h3 id="rr-draft-title" className="rr-titlemark">{review.provenance_id && <KeithMark provenanceId={review.provenance_id} />}Draft Response to {firstName(student)}</h3>
        {canWrite && (
          <div className="rr-btnrow">
            {[['warmer', 'Warmer'], ['shorter', 'Shorter'], ['fresh', 'Regenerate']].map(([k, l]) => (
              <button key={k} type="button" className="rr-btn rr-btn-sm" disabled={Boolean(busy)} onClick={() => revise(k)}>
                {k === 'fresh' && <RefreshCw size={13} aria-hidden="true" />}{busy === k ? 'Working…' : l}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rr-pad">
        <label className="rr-field">
          <span className="rr-mono">Subject</span>
          <input className="rr-input" value={subject} readOnly={!canWrite} onChange={e => setSubject(e.target.value)} onBlur={() => save({ subject })} />
        </label>
        {editing ? (
          <label className="rr-field">
            <span className="rr-mono">Keith’s text (the score sentence, bullets and your sign-off are added around it)</span>
            <textarea className="rr-textarea" value={body} rows={12} onChange={e => setBody(e.target.value)} onBlur={() => save({ body })} />
          </label>
        ) : (
          <div className="rr-draft" aria-label="Draft email as it will be copied">{composed}</div>
        )}
        <div className="rr-toggles">
          <label><input type="checkbox" checked={includeScore} onChange={e => { setIncludeScore(e.target.checked); save({ include_score: e.target.checked }) }} /> Include readiness</label>
          <label><input type="checkbox" checked={includeBullets} disabled={!(review.full_report?.rewritten_bullets || []).length}
            onChange={e => { setIncludeBullets(e.target.checked); save({ include_bullets: e.target.checked }) }} /> Add rewritten bullets</label>
          {canWrite && <button type="button" className="rr-link" onClick={() => setEditing(v => !v)}>{editing ? 'Done editing' : 'Edit text'}</button>}
        </div>
      </div>
      <div className="rr-foot">
        <span className="rr-muted">
          {canHandoff
            ? `Opens a pre-filled Outreach message to ${firstName(student)} with a link to their full feedback. Sending it shares that feedback in their Student Portal (in words, never the number) and logs Résumé Review with the date. Copying does neither.`
            : 'Copying the draft does not log Résumé Review as support.'}
        </span>
        <span className="rr-btnrow">
          <button type="button" className={canHandoff ? 'rr-btn' : 'rr-btn rr-btn-pri'} onClick={copyDraft}><Copy size={14} aria-hidden="true" /> Copy draft</button>
          {canHandoff && <button type="button" className="rr-btn rr-btn-pri" onClick={openInOutreach}><Send size={14} aria-hidden="true" /> Open in Outreach</button>}
        </span>
      </div>
      <span className="sr-only" aria-live="polite">{live}</span>
    </section>
  )
}

export default function ResumeReviewDrawer({ open, reviewId, student, reviews = [], versions = [], sender, canWrite, onClose, toast, cycle = null }) {
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['resume_review', reviewId],
    queryFn: async () => { const r = await getResumeReview(reviewId); if (!r.ok) throw new Error(r.error); return r.review },
    enabled: Boolean(open && reviewId),
    staleTime: 10_000,
  })
  const review = q.data || null
  const version = versions.find(v => v.id === review?.document_version_id) || null
  const [live, setLive] = useState('')
  const titleRef = useRef(null)
  const history = useMemo(() => {
    const versionDay = id => versions.find(v => v.id === id)?.uploaded_at
    return reviews.filter(r => ['scored', 'sent'].includes(r.status)).map(r => ({ ...r, at: r.scored_at || versionDay(r.document_version_id) }))
  }, [reviews, versions])
  const change = scoreChange(history)
  const runs = useMemo(() => highlightRuns(review?.resume_text || '', (review?.top_fixes || []).map(f => f.quote)), [review])

  if (!open || !student) return null
  const state = reviewState(review)
  const steps = review ? trackerSteps(review, version) : []
  const copyScore = async () => {
    const ok = await copyText(copyScoreLine({ name: displayName(student), score: review.score, readiness: review.readiness, when: shortDay(review.scored_at) }))
    setLive(ok ? 'Score copied.' : '')
    if (ok) toast?.info?.('Score copied', 'One line with the name, score and readiness.')
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: studentDocumentsKey(student.id) })

  return (
    <DetailDrawer open={open} onClose={onClose} title={`${displayName(student)}${student.aspire_cohort ? ` · ${student.aspire_cohort}` : ''}`} width={1180} trapFocus>
      <div className="rr-root">
        {q.isPending && <p className="rr-muted" aria-live="polite">Loading the review…</p>}
        {q.isError && <p className="rr-error" role="alert">The review could not load. <button type="button" className="rr-link" onClick={() => q.refetch()}>Try again</button></p>}
        {review && (
          <>
            <div className="rr-sub" ref={titleRef}>
              {version?.file_name || 'Résumé'}{review.scored_at ? ` · scored by Keith ${shortDay(review.scored_at)}` : ''}
            </div>

            <ol className="rr-tracker" aria-label="Review progress">
              {steps.map((s, i) => (
                <li key={s.key} className={s.done ? 'rr-done' : s.current ? 'rr-cur' : ''} aria-current={s.current ? 'step' : undefined}>
                  <span className="rr-dot" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
                  <span><b>{s.label}</b>{s.done && s.at ? shortDay(s.at) : s.current ? (s.key === 'send' ? 'Waiting on you' : 'Waiting') : s.key === 'logged' ? 'On send' : ''}</span>
                </li>
              ))}
            </ol>

            {state === 'failed' && <p className="rr-error" role="alert">This review did not finish ({review.error_reason || 'unknown'}). Close this and choose Retry on the résumé.</p>}

            {['scored', 'sent'].includes(state) && (
              <div className="rr-two">
                <div className="rr-left">
                  <div className="rr-sheet" aria-label="The résumé text Keith read. Highlights mark the top fixes.">
                    <span className="rr-stamp" aria-hidden="true">SCORED {review.score}</span>
                    {runs.map((r, i) => (r.fix
                      ? <mark key={i} className="rr-hl" title={`Fix ${r.fix}`}>{r.text}<sup>{r.fix}</sup></mark>
                      : <span key={i}>{r.text}</span>))}
                  </div>
                  <p className="rr-muted rr-small">Contact details were removed before Keith read it.</p>
                  {version && (
                    <div className="rr-btnrow">
                      <button type="button" className="rr-btn rr-btn-sm" onClick={() => openStudentDocumentVersion(version.id)}>View original</button>
                    </div>
                  )}
                  <div className="rr-box rr-history">
                    <div className="rr-boxh"><h3>Score History</h3>{change != null && <span className="rr-delta">{signed(change)}</span>}</div>
                    <ul>
                      {history.map(h => (
                        <li key={h.id} aria-current={h.id === review.id ? 'true' : undefined}>
                          <span>{shortDay(h.at)}</span><b>{h.score}</b>
                          <span><Pill tone={READINESS_TONE[h.readiness] || 'off'}>{h.readiness}</Pill>{h.status === 'sent' && <span className="rr-muted"> email sent</span>}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="rr-right">
                  {(review.missing_info || []).length > 0 && (
                    <div className="rr-alert" role="note">
                      <b>Missing from the résumé:</b> {review.missing_info.map(k => MISSING_INFO.find(m => m.key === k)?.label || k).join(', ')}.
                      {' '}Keith scored without them and the draft asks {firstName(student)} for each one. Keith never fills these in.
                    </div>
                  )}

                  <section className="rr-box" aria-labelledby="rr-score-title">
                    <div className="rr-boxh">
                      <h3 id="rr-score-title" className="rr-titlemark">{review.provenance_id && <KeithMark provenanceId={review.provenance_id} />}Score</h3>
                      <button type="button" className="rr-btn rr-btn-sm" onClick={copyScore} aria-label="Copy the score as one line">Copy score</button>
                    </div>
                    <div className="rr-pad">
                      <div className="rr-scorehead">
                        <ScoreRing score={review.score} />
                        <div className="rr-scoretext">
                          <div className="rr-btnrow">
                            <Pill tone={READINESS_TONE[review.readiness] || 'off'}>{review.readiness}</Pill>
                            {change != null && history[0]?.id === review.id && <span className="rr-delta">{signed(change)} since the last review</span>}
                          </div>
                          <p>{review.summary}</p>
                        </div>
                      </div>
                      <div className="rr-cats">
                        {CATEGORIES.map(c => {
                          const v = review.categories?.[c.key]?.score ?? 0
                          return (
                            <div key={c.key} className="rr-cat" title={review.categories?.[c.key]?.note || undefined}>
                              <span>{c.label}</span>
                              <span className="rr-bar" aria-hidden="true"><i className={v <= LOW_CATEGORY ? 'rr-low' : ''} style={{ width: `${v * 10}%` }} /></span>
                              <b>{v}/10</b>
                            </div>
                          )
                        })}
                      </div>
                      <div className="rr-mono">Top 3 fixes</div>
                      <ol className="rr-fixes">{(review.top_fixes || []).map((f, i) => <li key={i}>{f.fix}</li>)}</ol>
                      <details className="rr-details">
                        <summary>Full report (10 sections) and rewritten bullets</summary>
                        <FullReport review={review} />
                      </details>
                    </div>
                  </section>

                  <DraftBox key={review.id} review={review} student={student} sender={sender} canWrite={canWrite} toast={toast} onSaved={refresh} cycle={cycle} version={version} />
                </div>
              </div>
            )}
          </>
        )}
        <span className="sr-only" aria-live="polite">{live}</span>
      </div>
    </DetailDrawer>
  )
}
