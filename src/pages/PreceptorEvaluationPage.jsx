import { useState, useEffect, useCallback, useMemo } from 'react'

// Public tokenized renderer for the ASPIRE Preceptor Student Progress & Readiness
// Feedback survey. Fully isolated from EvaluationPage.jsx (Casey-Fink/student), which is
// not modified. Mounted at /evaluation/feedback. Submits the section-keyed payload to
// /api/evaluation-preceptor-submit, which calls submit_preceptor_evaluation_response.
//
// This survey is developmental/readiness feedback, NOT a hiring tool. Endorsement is
// "endorse for consideration" only.

const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/

// Page-scoped CSS. Inputs use font-size:16px to avoid mobile zoom; large touch targets.
const PE_CSS = `
  .pe-page { background:#F4F1EC; min-height:100vh; }
  .pe-container { max-width:880px; margin:0 auto; padding:24px 16px 80px; font-family:'DM Sans',system-ui,sans-serif; color:#191919; }
  .pe-card { background:#fff; border-radius:12px; border:1px solid #e8e4dc; padding:24px 24px; margin-bottom:20px; }
  .pe-section-title { font-size:17px; font-weight:700; color:#191919; margin:0 0 6px; }
  .pe-section-instr { font-size:13.5px; color:#4b5563; line-height:1.6; margin:0 0 18px; }
  .pe-field { margin-bottom:22px; }
  .pe-label { display:block; font-size:14px; font-weight:600; color:#191919; margin-bottom:4px; }
  .pe-prompt { font-size:13px; color:#6b7280; line-height:1.55; margin:0 0 10px; }
  .pe-req { color:#b91c1c; margin-left:3px; }
  .pe-readonly { font-size:15px; color:#191919; font-weight:600; }
  .pe-input, .pe-select, .pe-textarea {
    width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:8px;
    padding:11px 12px; font-size:16px; font-family:'DM Sans',system-ui,sans-serif; color:#191919;
  }
  .pe-textarea { min-height:96px; resize:vertical; line-height:1.5; }
  .pe-input:focus, .pe-select:focus, .pe-textarea:focus { outline:2px solid #1D2567; outline-offset:1px; }
  .pe-scale { display:flex; flex-direction:column; gap:8px; margin:4px 0 10px; }
  .pe-scale-opt {
    display:flex; align-items:center; gap:10px; min-height:44px; padding:8px 12px;
    border:1px solid #e5e7eb; border-radius:8px; cursor:pointer; font-size:14px; color:#374151;
  }
  .pe-scale-opt:hover { background:#f6f5f2; }
  .pe-scale-opt.sel { border-color:#1D2567; background:#eef1fb; color:#1D2567; font-weight:600; }
  .pe-scale-opt input { width:18px; height:18px; accent-color:#1D2567; flex-shrink:0; }
  .pe-comment-label { font-size:12.5px; color:#6b7280; margin:2px 0 6px; }
  .pe-attest { display:flex; gap:12px; align-items:flex-start; padding:14px; border:1px solid #e5e7eb; border-radius:8px; background:#fafaf9; }
  .pe-attest input { width:20px; height:20px; margin-top:2px; accent-color:#1D2567; flex-shrink:0; }
  .pe-attest label { font-size:14px; color:#374151; line-height:1.55; cursor:pointer; }
  .pe-submit {
    background:#1D2567; color:#fff; border:none; border-radius:10px; padding:15px 32px;
    font-size:16px; font-weight:600; font-family:'DM Sans',system-ui,sans-serif; cursor:pointer;
    width:100%; max-width:100%; min-height:52px;
  }
  .pe-submit:disabled { opacity:0.4; cursor:not-allowed; }
  .pe-note { font-size:12.5px; color:#6b7280; line-height:1.6; }
  .pe-band { background:linear-gradient(180deg,#1D2567 0%,#161D52 100%); }
  .pe-band-inner { max-width:880px; margin:0 auto; padding:13px 16px; display:flex; align-items:center; gap:12px; }
  .pe-divider { width:1px; height:26px; background:rgba(255,255,255,0.22); flex-shrink:0; }
  .pe-title-block { background:#fff; border-bottom:1px solid #e8e4dc; }
  .pe-title-inner { max-width:880px; margin:0 auto; padding:18px 16px 14px; }
  .pe-helper-list { margin:6px 0 0; padding-left:18px; font-size:12.5px; color:#6b7280; line-height:1.6; }
`

function ScaleField({ name, options, value, onChange }) {
  return (
    <div className="pe-scale" role="radiogroup" aria-label={name}>
      {options.map((label, i) => {
        const val = i + 1
        const sel = value === val
        return (
          <label key={val} className={`pe-scale-opt${sel ? ' sel' : ''}`}>
            <input type="radio" name={name} value={val} checked={sel} onChange={() => onChange(val)} />
            <span>{label}</span>
          </label>
        )
      })}
    </div>
  )
}

function SelectField({ id, label, required, options, value, onChange }) {
  return (
    <div className="pe-field">
      <label className="pe-label" htmlFor={id}>{label}{required && <span className="pe-req">*</span>}</label>
      <select id={id} className="pe-select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  )
}

function TextareaField({ id, label, prompt, required, value, onChange, examples }) {
  return (
    <div className="pe-field">
      <label className="pe-label" htmlFor={id}>{label}{required && <span className="pe-req">*</span>}</label>
      {prompt && <p className="pe-prompt">{prompt}</p>}
      <textarea id={id} className="pe-textarea" value={value} onChange={e => onChange(e.target.value)} maxLength={4000} />
      {examples && examples.length > 0 && (
        <ul className="pe-helper-list">{examples.map(ex => <li key={ex}>{ex}</li>)}</ul>
      )}
    </div>
  )
}

export default function PreceptorEvaluationPage() {
  const [view, setView] = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [meta, setMeta] = useState(null)
  const [rawToken, setRawToken] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [feedbackPeriod, setFeedbackPeriod] = useState('')
  const [shiftsObserved, setShiftsObserved] = useState('')
  const [competency, setCompetency] = useState({})       // { code: { rating, comment } }
  const [strengths, setStrengths] = useState('')
  const [areas, setAreas] = useState('')
  const [supportPlan, setSupportPlan] = useState('')
  const [transitionReadiness, setTransitionReadiness] = useState('')
  const [unitEndorsement, setUnitEndorsement] = useState('')
  const [endorsementExplanation, setEndorsementExplanation] = useState('')
  const [cedarsRecommendation, setCedarsRecommendation] = useState('')
  const [bestFit, setBestFit] = useState('')
  const [confidential, setConfidential] = useState('')
  const [attestation, setAttestation] = useState(false)

  // Inject no-referrer + page CSS
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m)
    const s = document.createElement('style'); s.id = 'pe-page-css'; s.textContent = PE_CSS; document.head.appendChild(s)
    return () => { document.head.removeChild(m); const el = document.getElementById('pe-page-css'); if (el) document.head.removeChild(el) }
  }, [])

  // Validate token on mount
  useEffect(() => {
    const match = TOKEN_PATTERN.exec(window.location.hash)
    if (!match) { setErrorMessage('This feedback link is no longer valid.'); setView('invalid'); return }
    const token = match[1]
    setRawToken(token)
    window.history.replaceState(null, '', window.location.pathname)

    fetch('/api/evaluation-preceptor-token-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (res.status === 200) {
          if (body.completed === true) { setView('completed') }
          else if (body.content) {
            setMeta(body)
            setFeedbackPeriod(body.periodValue || '')
            setView('form')
          } else { setView('error') }
        } else if (res.status === 410) { setErrorMessage(body.error || 'This feedback link is no longer valid.'); setView('invalid') }
        else if (res.status === 422) { setView('unsupported') }
        else if (res.status === 429) { setView('rate_limited') }
        else { setView('error') }
      })
      .catch(() => setView('error'))
  }, [])

  const setCompItem = useCallback((code, patch) => {
    setCompetency(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...patch } }))
  }, [])

  const content = meta?.content || null
  const competencyItems = meta?.competencyItems || []
  const ratingScale = meta?.ratingScale || []

  const allComplete = useMemo(() => {
    if (!content) return false
    if (!feedbackPeriod) return false
    for (const code of competencyItems) {
      const r = competency[code]?.rating
      if (!Number.isInteger(r) || r < 1 || r > 5) return false
    }
    if (!strengths.trim() || !areas.trim()) return false
    if (!transitionReadiness || !unitEndorsement || !cedarsRecommendation) return false
    if (!endorsementExplanation.trim()) return false
    if (!attestation) return false
    return true
  }, [content, feedbackPeriod, competency, competencyItems, strengths, areas,
      transitionReadiness, unitEndorsement, cedarsRecommendation, endorsementExplanation, attestation])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!rawToken || submitting || !allComplete) return
    setSubmitting(true)

    const competencyPayload = {}
    for (const code of competencyItems) {
      competencyPayload[code] = {
        rating: competency[code].rating,
        comment: (competency[code].comment || '').trim(),
      }
    }
    const responses = {
      developmental_feedback: {
        context: {
          feedback_period: feedbackPeriod,
          ...(shiftsObserved ? { shifts_observed: shiftsObserved } : {}),
        },
        competency: competencyPayload,
        narrative: {
          strengths_observed: strengths.trim(),
          areas_for_development: areas.trim(),
          suggested_support_plan: supportPlan.trim(),
        },
      },
      readiness_endorsement: {
        transition_readiness: transitionReadiness,
        unit_endorsement_consideration: unitEndorsement,
        endorsement_explanation: endorsementExplanation.trim(),
        cedars_consideration_recommendation: cedarsRecommendation,
        best_fit_environment: bestFit.trim(),
      },
      confidential_team_comments: {
        confidential_comments: confidential.trim(),
      },
      attestation: { attestation_confirmed: true },
    }

    try {
      const res = await fetch('/api/evaluation-preceptor-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, responses }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 200) { setView('thank_you') }
      else if (res.status === 410) { setErrorMessage(body.error || 'This feedback link is no longer valid.'); setView('invalid') }
      else if (res.status === 422) { setView('rejected') }
      else if (res.status === 429) { setView('rate_limited') }
      else { setView('error') }
    } catch { setView('error') }
    finally { setSubmitting(false) }
  }, [rawToken, submitting, allComplete, competencyItems, competency, feedbackPeriod, shiftsObserved,
      strengths, areas, supportPlan, transitionReadiness, unitEndorsement, endorsementExplanation,
      cedarsRecommendation, bestFit, confidential])

  const s1 = content?.section1, s2 = content?.section2, s3 = content?.section3
  const s4 = content?.section4, s5 = content?.section5, att = content?.attestation
  const periodOptions = s1?.fields?.feedback_period?.options || []

  return (
    <div className="pe-page">
      <header>
        <div className="pe-band">
          <div className="pe-band-inner">
            <img src="/cs-logo-large.png" alt="Cedars-Sinai" style={{ height: 36, width: 'auto', display: 'block', flexShrink: 0 }} />
            <div className="pe-divider" />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Brawerman Nursing Institute
            </span>
          </div>
        </div>
        <div className="pe-title-block">
          <div className="pe-title-inner">
            <h1 style={{ fontSize: 21, fontWeight: 700, color: '#191919', margin: '0 0 4px', fontFamily: 'DM Sans, system-ui, sans-serif', lineHeight: 1.3 }}>
              Preceptor Student Readiness Assessment
            </h1>
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Developmental and readiness feedback to support student growth
            </p>
          </div>
        </div>
      </header>

      {view !== 'form' && (
        <div className="pe-container">
          <p style={{ fontSize: 16, color: '#4b5563', textAlign: 'center', marginTop: 80, lineHeight: 1.6 }}>
            {view === 'loading'       ? 'Loading…'
            : view === 'completed'    ? 'Thank you. This feedback has already been submitted.'
            : view === 'thank_you'    ? 'Thank you. Your feedback has been recorded and will support this student’s development.'
            : view === 'invalid'      ? (errorMessage || 'This feedback link is no longer valid.')
            : view === 'unsupported'  ? 'This feedback link is not supported by the current application version.'
            : view === 'rate_limited' ? 'Too many requests. Please try again in a minute.'
            : view === 'rejected'     ? 'Please review the required fields and try again.'
            :                           'Something went wrong. Please try again later.'}
          </p>
        </div>
      )}

      {view === 'form' && content && (
        <div className="pe-container">
          {/* Intro / compliance */}
          {content.intro && (
            <div className="pe-card">
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, margin: '0 0 8px' }}>{content.intro.body}</p>
              {content.intro.compliance_note && (
                <p className="pe-note" style={{ margin: 0 }}>{content.intro.compliance_note}</p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit}>

            {/* Section 1 — details */}
            <div className="pe-card">
              <h2 className="pe-section-title">{s1?.title || 'Student and Preceptor Details'}</h2>
              {s1?.instructions && <p className="pe-section-instr">{s1.instructions}</p>}

              <div className="pe-field">
                <span className="pe-label">{s1?.fields?.student_name?.label || 'Student Name'}</span>
                <div className="pe-readonly">{meta.studentName || '—'}</div>
              </div>
              <div className="pe-field">
                <span className="pe-label">{s1?.fields?.preceptor_name?.label || 'Preceptor Name'}</span>
                <div className="pe-readonly">{meta.preceptorName || '—'}</div>
              </div>
              {meta.rotationUnit && (
                <div className="pe-field">
                  <span className="pe-label">{s1?.fields?.rotation_unit?.label || 'Rotation Unit / Area'}</span>
                  <div className="pe-readonly">{meta.rotationUnit}</div>
                </div>
              )}
              <div className="pe-field">
                <label className="pe-label" htmlFor="feedback_period">
                  {s1?.fields?.feedback_period?.label || 'Feedback Period'}<span className="pe-req">*</span>
                </label>
                <select id="feedback_period" className="pe-select" value={feedbackPeriod} onChange={e => setFeedbackPeriod(e.target.value)}>
                  <option value="">Select…</option>
                  {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <SelectField
                id="shifts_observed"
                label={s1?.fields?.shifts_observed?.label || 'Approximate Number of Shifts Observed With This Student'}
                required={false}
                options={s1?.fields?.shifts_observed?.options || []}
                value={shiftsObserved}
                onChange={setShiftsObserved}
              />
            </div>

            {/* Section 2 — competency */}
            <div className="pe-card">
              <h2 className="pe-section-title">{s2?.title || 'Clinical Progress and Competency'}</h2>
              {s2?.instructions && <p className="pe-section-instr">{s2.instructions}</p>}
              {competencyItems.map(code => {
                const def = s2?.items?.[code] || {}
                return (
                  <div key={code} className="pe-field">
                    <span className="pe-label">{def.label || code}<span className="pe-req">*</span></span>
                    {def.prompt && <p className="pe-prompt">{def.prompt}</p>}
                    <ScaleField
                      name={code}
                      options={ratingScale}
                      value={competency[code]?.rating}
                      onChange={(r) => setCompItem(code, { rating: r })}
                    />
                    <div className="pe-comment-label">{s2?.commentLabel || 'What examples support your rating?'}</div>
                    <textarea
                      className="pe-textarea"
                      style={{ minHeight: 64 }}
                      maxLength={2000}
                      value={competency[code]?.comment || ''}
                      onChange={e => setCompItem(code, { comment: e.target.value })}
                    />
                  </div>
                )
              })}
            </div>

            {/* Section 3 — narrative */}
            <div className="pe-card">
              <h2 className="pe-section-title">{s3?.title || 'Narrative Feedback'}</h2>
              <TextareaField id="strengths" label={s3?.fields?.strengths_observed?.label || 'Strengths Observed'}
                prompt={s3?.fields?.strengths_observed?.prompt} required value={strengths} onChange={setStrengths} />
              <TextareaField id="areas" label={s3?.fields?.areas_for_development?.label || 'Areas for Development or Coaching'}
                prompt={s3?.fields?.areas_for_development?.prompt} required value={areas} onChange={setAreas} />
              <TextareaField id="support" label={s3?.fields?.suggested_support_plan?.label || 'Suggested Support Plan'}
                prompt={s3?.fields?.suggested_support_plan?.prompt} required={false} value={supportPlan} onChange={setSupportPlan}
                examples={s3?.fields?.suggested_support_plan?.examples} />
            </div>

            {/* Section 4 — readiness + endorsement */}
            <div className="pe-card">
              <h2 className="pe-section-title">{s4?.title || 'Readiness and Endorsement'}</h2>
              <SelectField id="transition_readiness" label={s4?.fields?.transition_readiness?.label}
                required options={s4?.fields?.transition_readiness?.options || []} value={transitionReadiness} onChange={setTransitionReadiness} />
              <SelectField id="unit_endorsement" label={s4?.fields?.unit_endorsement_consideration?.label}
                required options={s4?.fields?.unit_endorsement_consideration?.options || []} value={unitEndorsement} onChange={setUnitEndorsement} />
              <TextareaField id="endorsement_explanation" label={s4?.fields?.endorsement_explanation?.label}
                prompt={s4?.fields?.endorsement_explanation?.prompt} required value={endorsementExplanation} onChange={setEndorsementExplanation} />
              <SelectField id="cedars_recommendation" label={s4?.fields?.cedars_consideration_recommendation?.label}
                required options={s4?.fields?.cedars_consideration_recommendation?.options || []} value={cedarsRecommendation} onChange={setCedarsRecommendation} />
              <TextareaField id="best_fit" label={s4?.fields?.best_fit_environment?.label}
                required={false} value={bestFit} onChange={setBestFit} />
            </div>

            {/* Section 5 — confidential */}
            <div className="pe-card">
              <h2 className="pe-section-title">{s5?.title || 'Confidential ASPIRE Team Comments'}</h2>
              <TextareaField id="confidential" label={s5?.fields?.confidential_comments?.label}
                prompt={s5?.fields?.confidential_comments?.prompt} required={false} value={confidential} onChange={setConfidential} />
            </div>

            {/* Attestation */}
            <div className="pe-card">
              <div className="pe-attest">
                <input id="attestation" type="checkbox" checked={attestation} onChange={e => setAttestation(e.target.checked)} />
                <label htmlFor="attestation">{att?.label || 'I confirm this feedback is based on my direct observations and is intended to support student development, safe practice, and transition readiness.'}<span className="pe-req">*</span></label>
              </div>
            </div>

            {/* Submit */}
            <div style={{ paddingTop: 4 }}>
              {!allComplete && (
                <p className="pe-note" style={{ marginBottom: 10 }}>Complete all required fields (marked *) to submit.</p>
              )}
              <button type="submit" className="pe-submit" disabled={!allComplete || submitting}>
                {submitting ? 'Submitting…' : 'Submit Feedback'}
              </button>
            </div>

          </form>
        </div>
      )}
    </div>
  )
}
