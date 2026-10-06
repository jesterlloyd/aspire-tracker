// NGRP-INTERVIEWS-1 Phase 3 (Owner, 2026-10-05): the residency interview rubric, in the Unit Leader
// Portal. "Reuse the same graphics as the internship, so you don't have to invent new ones": this
// is the internship rubric book's own markup and classes (src/components/rubric/rubricBook.css, the
// cognac cover, the candidate page, the seam, the head with Completion / Scoring Guide / Composite,
// the 1 to 5 scale, the recommendations and the index down the fore edge), holding the Owner's NGRP
// scoring sheet (src/lib/ngrp/ngrpRubric.js) instead of the internship's questions.
//
// It saves to the caller's OWN rubric through /api/portal/unit-interviews (one per interviewer per
// applicant, enforced by the table). A choice saves at once; typing saves after a pause. Marking it
// complete asks first, and a completed rubric is read-only until Unlock to Edit.
import { useEffect, useRef, useState } from 'react'
import BackButton from '../../components/BackButton'
import { NavigationPill } from '../../components/ui/NavigationPill'
import StudentAvatar from '../../components/StudentAvatar'
import { confirmDialog } from '../../components/shared/confirmDialog'
import { useBookScale } from '../../components/rubric/useBookScale'
import '../../components/rubric/rubricBook.css'
import {
  NGRP_DOMAINS, SCORE_LEGEND, SCORING_NOTE, RECOMMENDATIONS, OTHER_QUESTION, COMPOSITE_RANGES,
  compositeOf, rangeFor, closerLookDomains, missingForComplete,
} from '../../lib/ngrp/ngrpRubric'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { fetchRubricBook, saveNgrpRubric } from './unitInterviewsApi'

// The internship book's recommendation colours (fixed pairs).
const REC_STYLE = {
  recommend: { bg: '#dcfce7', color: '#166534' },
  recommend_with_reservations: { bg: '#fef3c7', color: '#92400e' },
  do_not_recommend: { bg: '#fee2e2', color: '#991b1b' },
}
const STEPS = [
  { id: 'n1', label: 'Info' },
  ...NGRP_DOMAINS.map((d, i) => ({ id: `n${i + 2}`, label: d.title.split(' ')[0] })),
  { id: 'n5', label: 'Recommendation' },
]
const REQUIRED = 7 // three questions, three scores, one recommendation
const fmtWhen = v => (v ? new Date(v).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : '')
const EMPTY = Object.fromEntries([
  ...NGRP_DOMAINS.flatMap(d => [[`${d.key}_question`, ''], [`${d.key}_question_other`, ''], [`${d.key}_score`, null], [`${d.key}_notes`, '']]),
  ['individual_recommendation', ''], ['suggested_unit', ''], ['summary_comments', ''], ['status', 'in_progress'],
])

export default function NgrpRubricBook({ candidateId, onBack, readOnly = false, toast = null }) {
  const { shellRef, stageRef, shellHeight, mode } = useBookScale()
  const [page, setPage] = useState('right')
  const [state, setState] = useState('loading')
  const [applicant, setApplicant] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [legendOpen, setLegendOpen] = useState(false)
  const [headLifted, setHeadLifted] = useState(false)
  const [activeStep, setActiveStep] = useState('n1')
  const scrollRef = useRef(null)
  const timer = useRef(null)
  const pending = useRef({})

  useEffect(() => {
    let live = true
    fetchRubricBook(candidateId).then(r => {
      if (!live) return
      if (!r.ok) { setState(r.status === 404 ? 'not_found' : 'error'); return }
      setApplicant(r.data.applicant)
      const mine = r.data.rubric || {}
      setForm(f => ({ ...f, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, mine[k] ?? EMPTY[k]])) }))
      setState(r.data.rubricsProvisioned === false ? 'not_enabled' : 'ready')
    })
    return () => { live = false; clearTimeout(timer.current) }
  }, [candidateId])

  // The index follows whichever section is being read, and the head lifts once the page scrolls.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]?.target?.id) setActiveStep(visible[0].target.id)
    }, { root, rootMargin: '0px 0px -72% 0px', threshold: 0 })
    STEPS.forEach(s => { const el = root.querySelector(`#${s.id}`); if (el) io.observe(el) })
    const onScroll = () => setHeadLifted(root.scrollTop > 2)
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => { io.disconnect(); root.removeEventListener('scroll', onScroll) }
  }, [state])

  const locked = readOnly || form.status === 'completed'

  const persist = async (fields) => {
    setSaveStatus('saving')
    const r = await saveNgrpRubric(candidateId, fields)
    if (!r.ok) {
      setSaveStatus('error')
      toast?.error?.('Not saved', (r.data?.errors || []).map(e => e.message).join(' ') || 'Your rubric could not be saved. Try again in a moment.')
      return false
    }
    setSaveStatus('saved')
    return r.data.rubric
  }
  const flush = () => {
    clearTimeout(timer.current)
    const fields = pending.current
    pending.current = {}
    if (Object.keys(fields).length) persist(fields)
  }
  const saveNow = (key, value) => { setForm(f => ({ ...f, [key]: value })); pending.current = { ...pending.current, [key]: value }; flush() }
  const saveLater = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
    pending.current = { ...pending.current, [key]: value }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 800)
  }

  const missing = missingForComplete(form)
  const questionsMissing = NGRP_DOMAINS.filter(d => !form[`${d.key}_question`] || (form[`${d.key}_question`] === OTHER_QUESTION && !form[`${d.key}_question_other`]))
  const toDo = [...questionsMissing.map(d => `A question for ${d.title}`), ...missing]
  const completion = locked ? 100 : Math.round(((REQUIRED - Math.min(REQUIRED, toDo.length)) / REQUIRED) * 100)
  const composite = compositeOf(form)
  const range = rangeFor(composite)
  const closer = closerLookDomains(form)

  const markComplete = async () => {
    if (toDo.length) { toast?.error?.('Not complete yet', `Still needed: ${toDo.join(', ')}.`); return }
    if (!(await confirmDialog(`Submit your rubric for ${applicant.preferred_first_name || applicant.first_name} ${applicant.last_name}? Your scores join the panel's averaged result.`, { confirmLabel: 'Submit Rubric' }))) return
    // The whole form travels with the completion, so a typed comment still waiting for its pause
    // cannot arrive after the rubric was judged complete.
    clearTimeout(timer.current)
    pending.current = {}
    const saved = await persist({ ...form, status: 'completed' })
    if (saved) setForm(f => ({ ...f, status: 'completed' }))
  }
  const unlock = async () => {
    if (!(await confirmDialog('Unlock your rubric to edit it? It leaves the panel average until you submit it again.', { confirmLabel: 'Unlock to Edit' }))) return
    const saved = await persist({ status: 'in_progress' })
    if (saved) setForm(f => ({ ...f, status: 'in_progress' }))
  }
  const goToSection = id => {
    const el = scrollRef.current?.querySelector(`#${id}`)
    if (!el) return
    if (mode === 'single') setPage('right')
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveStep(id)
  }

  if (state === 'loading') return <div className="ptl-card" role="status">Opening the rubric…</div>
  if (state === 'not_found') return <div className="ptl-card"><BackButton label="Back to Interviews" onClick={onBack} /><p>This applicant is not paired with your unit.</p></div>
  if (state === 'error') return <div className="ptl-card"><BackButton label="Back to Interviews" onClick={onBack} /><p>The rubric could not be loaded. Try again in a moment.</p></div>

  const student = { first_name: applicant.first_name, last_name: applicant.last_name, preferred_first_name: applicant.preferred_first_name }
  const name = `${applicant.preferred_first_name || applicant.first_name} ${applicant.last_name}`.trim()

  return (
    <div className="rb-shell" ref={shellRef} data-rubric-book="" data-rb-mode={mode} data-rb-page={page} data-rb-readonly={locked ? 'true' : 'false'}
      style={shellHeight ? { '--rb-shell-h': `${shellHeight}px` } : undefined}>
      <div className="rb-toolbar">
        <BackButton label="Back to Interviews" onClick={() => { flush(); onBack() }} />
        {saveStatus === 'saving' && <span className="rb-save">Saving…</span>}
        {saveStatus === 'saved' && <span className="rb-save rb-save-ok">Saved</span>}
        {saveStatus === 'error' && <span className="rb-save-err">Save failed</span>}
        {mode === 'single' && (
          <div className="rb-switch" role="group" aria-label="Which page">
            <button type="button" aria-pressed={page === 'left'} onClick={() => setPage('left')}>Candidate</button>
            <button type="button" aria-pressed={page === 'right'} onClick={() => setPage('right')}>Rubric</button>
          </div>
        )}
        {!readOnly && form.status === 'completed' && (
          <div className="rb-toolbar-right"><NavigationPill onClick={unlock}>Unlock to Edit</NavigationPill></div>
        )}
      </div>

      <div className="rb-stage" ref={stageRef}>
        <div className="rb-book">
          <div className="rb-cover material-leather-cognac material-forestack">
            <span className="material-cover-tooling" aria-hidden="true" />
            <div className="rb-spread">
              <i className="rb-spine material-book-spine" aria-hidden="true" />

              {/* ── Left page: the applicant ── */}
              <section className="rb-page rb-page-left" aria-label="Candidate">
                <div className="rb-id">
                  <div className="rb-avatar"><StudentAvatar student={student} size={96} style={{ fontSize: '30px' }} /></div>
                  <div className="rb-name">{name}</div>
                  <div className="rb-sub">{[applicant.school, applicant.program_type].filter(Boolean).join(' · ')}</div>
                  <div className="rb-chiprow">
                    {applicant.aspire_cohort && <span className="rb-chip rb-chip-quiet">ASPIRE · {applicant.aspire_cohort}</span>}
                    <span className="rb-chip rb-chip-quiet">{applicant.cycle_name}</span>
                  </div>
                </div>
                <div className="rb-block">
                  <div className="rb-block-label">Interview</div>
                  <div className="rb-kv"><span className="rb-kv-key">Unit</span><span className="rb-kv-val">{applicant.unit}</span></div>
                  <div className="rb-kv"><span className="rb-kv-key">When</span><span className="rb-kv-val">{fmtWhen(applicant.interview_at) || 'Not booked yet'}</span></div>
                  <div className="rb-kv"><span className="rb-kv-key">Format</span><span className="rb-kv-val">{INTERVIEW_MODE_LABELS[applicant.interview_mode] || 'Not recorded'}</span></div>
                </div>
                <div className="rb-block">
                  <div className="rb-block-label">Unit Choices</div>
                  {applicant.preferences.length === 0 && <div className="rb-empty">Not submitted</div>}
                  {applicant.preferences.map((u, i) => (
                    <div className="rb-pref" key={u}><div className="rb-pref-top"><div className="rb-pref-name"><span className="rb-pref-rank">{['1st', '2nd', '3rd'][i]}</span>{u}</div></div></div>
                  ))}
                </div>
                <div className="rb-block">
                  <div className="rb-block-label">Transition Form</div>
                  {applicant.form.shared
                    ? applicant.form.rows.map(([k, v]) => (
                      <div className="rb-kv" key={k}><span className="rb-kv-key">{k}</span><span className="rb-kv-val">{v}</span></div>
                    ))
                    : <div className="rb-empty">Shared with interviewing units once the alumnus submits the form with that consent.</div>}
                </div>
              </section>

              <div className="rb-seam" aria-hidden="true" />

              <header className={`rb-head${headLifted ? ' rb-head-lifted' : ''}`}>
                <span className="rb-head-side"><span className="rb-head-key">Completion</span><span className="rb-head-pct">{completion}%</span></span>
                <button type="button" className="rb-head-guide" aria-expanded={legendOpen} onClick={() => setLegendOpen(p => !p)}>
                  {legendOpen ? '▾' : '▸'} Scoring Guide
                </button>
                <span className="rb-head-score"><span className="rb-head-key">Composite</span><span className="rb-head-num">{composite ?? 0}</span><span className="rb-head-den">/ 15</span></span>
              </header>

              {/* ── Right page: the NGRP rubric ── */}
              <section className="rb-page rb-page-right" aria-label="Rubric">
                {legendOpen && (
                  <div className="rb-guide-drawer">
                    {SCORE_LEGEND.map(s => <p key={s.score}><span className="rb-guide-head">{s.score} · {s.label}:</span> {s.meaning}</p>)}
                    <p>{SCORING_NOTE}</p>
                  </div>
                )}
                <div className="rb-scroll" ref={scrollRef}>
                  {state === 'not_enabled' && <p className="rb-note-band">The residency rubric is not enabled yet. Nothing here can be saved.</p>}
                  {readOnly && <p className="rb-note-band">This is a preview. A unit leader scores here; nothing is saved from a preview.</p>}

                  <section className="rb-section" id="n1">
                    <div className="rb-title">Section 1: Interview Info</div>
                    <div className="rb-kv"><span className="rb-kv-key">Applicant</span><span className="rb-kv-val">{name}</span></div>
                    <div className="rb-kv"><span className="rb-kv-key">Unit</span><span className="rb-kv-val">{applicant.unit}</span></div>
                    <div className="rb-kv"><span className="rb-kv-key">Date and time</span><span className="rb-kv-val">{fmtWhen(applicant.interview_at) || 'Not booked yet'}</span></div>
                    <p className="rb-label" style={{ marginTop: 10 }}>Score each domain on its own. Score the quality of the reasoning and the safety of the thinking, not whether the candidate has specific unit experience.</p>
                  </section>

                  {NGRP_DOMAINS.map((d, i) => {
                    const qKey = `${d.key}_question`, sKey = `${d.key}_score`, nKey = `${d.key}_notes`, oKey = `${d.key}_question_other`
                    const isOther = form[qKey] === OTHER_QUESTION
                    return (
                      <section className="rb-section" id={`n${i + 2}`} key={d.key}>
                        <div className="rb-eyebrow">Domain {i + 1} · {d.reference}</div>
                        <div className="rb-title">Section {i + 2}: {d.title}</div>
                        <p className="rb-label">{d.focus}</p>
                        <p className="rb-label">Ask at least one. Choose the question you used:</p>
                        <div className="rb-choices" role="radiogroup" aria-label={`Question asked for ${d.title}`}>
                          {d.questions.map(q => {
                            const sel = form[qKey] === q.key
                            if (locked && !sel) return null
                            return (
                              <button type="button" key={q.key} role="radio" aria-checked={sel} disabled={locked}
                                className={`rb-choice${sel ? ' rb-choice-sel' : ''}`} onClick={() => saveNow(qKey, q.key)}>{q.text}</button>
                            )
                          })}
                          {(!locked || isOther) && (
                            <button type="button" role="radio" aria-checked={isOther} disabled={locked}
                              className={`rb-choice${isOther ? ' rb-choice-sel' : ''}`} onClick={() => saveNow(qKey, OTHER_QUESTION)}>Other</button>
                          )}
                        </div>
                        {isOther && (
                          <div className="rb-field" style={{ marginTop: 14 }}>
                            <label className="rb-label" htmlFor={`ngrp-${oKey}`}>The question you asked</label>
                            {locked ? <div className="rb-readonly">{form[oKey] || '-'}</div>
                              : <textarea id={`ngrp-${oKey}`} className="rb-textarea" rows={2} value={form[oKey] || ''} onChange={e => saveLater(oKey, e.target.value)} />}
                          </div>
                        )}
                        <div className="rb-field" style={{ marginTop: 14 }}>
                          <label className="rb-label" htmlFor={`ngrp-${nKey}`}>Comments</label>
                          {locked ? <div className="rb-readonly rb-readonly-tall">{form[nKey] || '-'}</div>
                            : <textarea id={`ngrp-${nKey}`} className="rb-textarea" rows={3} value={form[nKey] || ''} placeholder="Key points from the response…" onChange={e => saveLater(nKey, e.target.value)} />}
                        </div>
                        <div className="rb-field">
                          <span className="rb-label">Rate this domain</span>
                          <div className="rb-scale" role="radiogroup" aria-label={`Rate ${d.title}`}>
                            {SCORE_LEGEND.map(s => {
                              const sel = form[sKey] === s.score
                              return (
                                <button type="button" key={s.score} role="radio" aria-checked={sel} disabled={locked}
                                  className={`rb-score${sel ? ' rb-score-sel' : ''}`} onClick={() => saveNow(sKey, s.score)}>
                                  <span className="rb-score-num">{s.score}</span><span className="rb-score-lbl">{s.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </section>
                    )
                  })}

                  <div className="rb-scores-line">
                    {NGRP_DOMAINS.map(d => <span key={d.key}>{d.title} <strong>{form[`${d.key}_score`] || 0}/5</strong></span>)}
                  </div>

                  <section className="rb-section" id="n5">
                    <div className="rb-title">Section 5: Composite and Your Recommendation</div>
                    <p className="rb-label">
                      Composite {composite ?? '-'} / 15{range ? `: ${range.label}. ${range.meaning}. The sheet suggests ${RECOMMENDATIONS.find(r => r.key === range.recommendation)?.label}.` : '.'}
                    </p>
                    {closer.length > 0 && (
                      <p className="rb-warn">{closer.map(k => NGRP_DOMAINS.find(d => d.key === k).title).join(' and ')} scored 1 or 2: this warrants a closer look and a brief discussion before a final decision.</p>
                    )}
                    <p className="rb-label">Your individual recommendation. Do not share your decision with the candidate.</p>
                    <div className="rb-recs" role="radiogroup" aria-label="Your recommendation">
                      {RECOMMENDATIONS.map(opt => {
                        const sel = form.individual_recommendation === opt.key
                        if (locked && !sel) return null
                        return (
                          <button type="button" key={opt.key} role="radio" aria-checked={sel} disabled={locked}
                            className={`rb-rec${sel ? ' rb-rec-sel' : ''}`} style={sel ? { background: REC_STYLE[opt.key].bg, color: REC_STYLE[opt.key].color } : undefined}
                            onClick={() => saveNow('individual_recommendation', opt.key)}>{opt.label}</button>
                        )
                      })}
                    </div>
                    <p className="rb-note-band">
                      Each interviewer scores independently. The panel's result averages every completed composite and applies the ranges below; the final recommendation rests with the panel and hiring leader.
                    </p>
                    <div className="rb-guide">
                      {COMPOSITE_RANGES.map(r => <p key={r.label}><span className="rb-guide-head">{Math.floor(r.min)} to {Math.floor(r.max)} · {r.label}:</span> {r.meaning}</p>)}
                    </div>
                    <div className="rb-field" style={{ marginTop: 16 }}>
                      <label className="rb-label" htmlFor="ngrp-suggested">Suggested unit or service line</label>
                      {locked ? <div className="rb-readonly">{form.suggested_unit || '-'}</div>
                        : <input id="ngrp-suggested" className="rb-input" value={form.suggested_unit || ''} onChange={e => saveLater('suggested_unit', e.target.value)} />}
                    </div>
                    <div className="rb-field">
                      <label className="rb-label" htmlFor="ngrp-summary">Summary comments (strengths and areas for development)</label>
                      {locked ? <div className="rb-readonly rb-readonly-tall">{form.summary_comments || '-'}</div>
                        : <textarea id="ngrp-summary" className="rb-textarea" rows={4} value={form.summary_comments || ''} onChange={e => saveLater('summary_comments', e.target.value)} />}
                    </div>
                  </section>

                  {!locked && state === 'ready' && (
                    <div className="rb-actions">
                      <button type="button" className="rb-btn rb-btn-primary" style={{ opacity: toDo.length ? 0.55 : 1 }} onClick={markComplete}>Mark My Rubric Complete</button>
                    </div>
                  )}
                  {!readOnly && form.status === 'completed' && <div className="rb-locked">Your rubric is marked Complete. Use Unlock to Edit to make changes.</div>}
                </div>
              </section>

              <nav className="rb-index" aria-label="Rubric sections">
                {STEPS.map((s, i) => (
                  <button type="button" key={s.id} className={`rb-tab${activeStep === s.id ? ' rb-tab-active' : ''}`}
                    style={{ flexGrow: s.label.length + 5 }} aria-current={activeStep === s.id ? 'true' : undefined}
                    aria-label={`Section ${i + 1}: ${s.label}`} onClick={() => goToSection(s.id)}>
                    <span className="rb-tab-num">{String(i + 1).padStart(2, '0')}</span><span>{s.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
