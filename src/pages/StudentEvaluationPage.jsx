import { useState, useEffect, useCallback, useMemo } from 'react'

// Public tokenized renderer for the ASPIRE Student Evaluation of Preceptor/Unit Experience
// survey (slug: student_preceptor_eval). Fully isolated from EvaluationPage.jsx (Casey-Fink)
// and PreceptorEvaluationPage.jsx (preceptor), neither of which is modified. Mounted at
// /evaluation/experience. Submits the section-keyed payload to
// /api/evaluation-student-eval-submit, which calls submit_student_preceptor_evaluation_response.
//
// The student is the subject and respondent. The preceptor/unit is the evaluated_target,
// shown READ-ONLY and echoed into responses.evaluated_target - never edited by the student.

const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/

const SE_CSS = `
  .se-page { background:#F4F1EC; min-height:100vh; }
  .se-container { max-width:880px; margin:0 auto; padding:24px 16px 80px; font-family:'DM Sans',system-ui,sans-serif; color:#191919; }
  .se-card { background:#fff; border-radius:12px; border:1px solid #e8e4dc; padding:24px 24px; margin-bottom:20px; }
  .se-section-title { font-size:17px; font-weight:700; color:#191919; margin:0 0 6px; }
  .se-section-instr { font-size:13.5px; color:#4b5563; line-height:1.6; margin:0 0 18px; }
  .se-field { margin-bottom:22px; }
  .se-label { display:block; font-size:14px; font-weight:600; color:#191919; margin-bottom:8px; }
  .se-readonly { font-size:15px; color:#191919; font-weight:600; }
  .se-req { color:#b91c1c; margin-left:3px; }
  .se-textarea {
    width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:8px;
    padding:11px 12px; font-size:16px; font-family:'DM Sans',system-ui,sans-serif; color:#191919;
    min-height:88px; resize:vertical; line-height:1.5;
  }
  .se-textarea:focus { outline:2px solid #1D2567; outline-offset:1px; }
  .se-scale { display:flex; flex-wrap:wrap; gap:8px; margin:4px 0 4px; }
  .se-opt {
    display:flex; align-items:center; gap:8px; min-height:44px; padding:7px 12px;
    border:1px solid #e5e7eb; border-radius:8px; cursor:pointer; font-size:13.5px; color:#374151;
  }
  .se-opt:hover { background:#f6f5f2; }
  .se-opt.sel { border-color:#1D2567; background:#eef1fb; color:#1D2567; font-weight:600; }
  .se-opt input { width:17px; height:17px; accent-color:#1D2567; flex-shrink:0; }
  .se-item { padding:14px 0; border-bottom:1px solid #f3f4f6; }
  .se-item:last-child { border-bottom:none; }
  .se-item-text { font-size:14px; color:#191919; line-height:1.5; margin-bottom:8px; }
  .se-comment-label { font-size:12.5px; color:#6b7280; margin:8px 0 6px; }
  .se-attest { display:flex; gap:12px; align-items:flex-start; padding:14px; border:1px solid #e5e7eb; border-radius:8px; background:#fafaf9; }
  .se-attest input { width:20px; height:20px; margin-top:2px; accent-color:#1D2567; flex-shrink:0; }
  .se-attest label { font-size:14px; color:#374151; line-height:1.55; cursor:pointer; }
  .se-submit {
    background:#1D2567; color:#fff; border:none; border-radius:10px; padding:15px 32px;
    font-size:16px; font-weight:600; font-family:'DM Sans',system-ui,sans-serif; cursor:pointer;
    width:100%; min-height:52px;
  }
  .se-submit:disabled { opacity:0.4; cursor:not-allowed; }
  .se-note { font-size:12.5px; color:#6b7280; line-height:1.6; }
  .se-band { background:linear-gradient(180deg,#1D2567 0%,#161D52 100%); }
  .se-band-inner { max-width:880px; margin:0 auto; padding:13px 16px; display:flex; align-items:center; gap:12px; }
  .se-divider { width:1px; height:26px; background:rgba(255,255,255,0.22); flex-shrink:0; }
  .se-title-block { background:#fff; border-bottom:1px solid #e8e4dc; }
  .se-title-inner { max-width:880px; margin:0 auto; padding:18px 16px 14px; }
`

// One Likert item: prompt + a radiogroup of scale options (value may be a number or 'na').
function LikertItem({ name, text, scale, value, onChange }) {
  return (
    <div className="se-item">
      <div className="se-item-text">{text}<span className="se-req">*</span></div>
      <div className="se-scale" role="radiogroup" aria-label={text}>
        {scale.map(opt => {
          const sel = value === opt.value
          return (
            <label key={String(opt.value)} className={`se-opt${sel ? ' sel' : ''}`}>
              <input type="radio" name={name} checked={sel} onChange={() => onChange(opt.value)} />
              <span>{opt.label}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export default function StudentEvaluationPage() {
  const [view, setView] = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [meta, setMeta] = useState(null)
  const [rawToken, setRawToken] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Form state: one object per domain (itemCode -> value), plus comments/narrative/attestation
  const [support, setSupport] = useState({})
  const [environment, setEnvironment] = useState({})
  const [safety, setSafety] = useState({})
  const [overall, setOverall] = useState({})            // valuable_experience, would_recommend, overall_rating
  const [supportComment, setSupportComment] = useState('')
  const [environmentComment, setEnvironmentComment] = useState('')
  const [strengths, setStrengths] = useState('')
  const [suggestions, setSuggestions] = useState('')
  const [openComment, setOpenComment] = useState('')
  const [attestation, setAttestation] = useState(false)

  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m)
    const s = document.createElement('style'); s.id = 'se-page-css'; s.textContent = SE_CSS; document.head.appendChild(s)
    return () => { document.head.removeChild(m); const el = document.getElementById('se-page-css'); if (el) document.head.removeChild(el) }
  }, [])

  useEffect(() => {
    const match = TOKEN_PATTERN.exec(window.location.hash)
    if (!match) { setErrorMessage('This survey link is no longer valid.'); setView('invalid'); return }
    const token = match[1]
    setRawToken(token)
    window.history.replaceState(null, '', window.location.pathname)

    fetch('/api/evaluation-student-eval-token-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (res.status === 200) {
          if (body.completed === true) { setView('completed') }
          else if (body.content) { setMeta(body); setView('form') }
          else { setView('error') }
        } else if (res.status === 410) { setErrorMessage(body.error || 'This survey link is no longer valid.'); setView('invalid') }
        else if (res.status === 422) { setView('unsupported') }
        else if (res.status === 429) { setView('rate_limited') }
        else { setView('error') }
      })
      .catch(() => setView('error'))
  }, [])

  const content = meta?.content || null
  const ratingScale = content?.ratingScale || []
  const overallScale = content?.section4?.ratingItem?.overall_rating?.scale || []

  const s1 = content?.section1, s2 = content?.section2, s3 = content?.section3
  const s4 = content?.section4, s5 = content?.section5, att = content?.attestation
  const et = content?.evaluatedTarget

  const s1Items = s1?.items || {}, s2Items = s2?.items || {}, s3Items = s3?.items || {}, s4Items = s4?.items || {}

  const allComplete = useMemo(() => {
    if (!content) return false
    const ratingSet = (obj, items) => Object.keys(items).every(code => obj[code] !== undefined)
    if (!ratingSet(support, s1Items)) return false
    if (!ratingSet(environment, s2Items)) return false
    if (!ratingSet(safety, s3Items)) return false
    if (!ratingSet(overall, s4Items)) return false
    if (overall.overall_rating === undefined) return false
    if (!attestation) return false
    return true
  }, [content, support, environment, safety, overall, s1Items, s2Items, s3Items, s4Items, attestation])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!rawToken || submitting || !allComplete) return
    setSubmitting(true)

    const responses = {
      evaluated_target: {
        preceptor_name: meta.evaluatedTarget?.preceptor_name || '',
        preceptor_id:   meta.evaluatedTarget?.preceptor_id || '',
        unit:           meta.evaluatedTarget?.unit || '',
      },
      preceptor_support:    { ...support,     ...(supportComment.trim()     ? { preceptor_support_comment: supportComment.trim() }       : {}) },
      learning_environment: { ...environment, ...(environmentComment.trim() ? { learning_environment_comment: environmentComment.trim() } : {}) },
      psychological_safety: { ...safety },
      overall_experience:   { ...overall },
      narrative: {
        strengths: strengths.trim(),
        suggestions: suggestions.trim(),
        open_comment: openComment.trim(),
      },
      attestation: { attestation_confirmed: true },
    }

    try {
      const res = await fetch('/api/evaluation-student-eval-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, responses }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 200) { setView('thank_you') }
      else if (res.status === 410) { setErrorMessage(body.error || 'This survey link is no longer valid.'); setView('invalid') }
      else if (res.status === 422) { setView('rejected') }
      else if (res.status === 429) { setView('rate_limited') }
      else { setView('error') }
    } catch { setView('error') }
    finally { setSubmitting(false) }
  }, [rawToken, submitting, allComplete, meta, support, environment, safety, overall,
      supportComment, environmentComment, strengths, suggestions, openComment])

  return (
    <div className="se-page">
      <header>
        <div className="se-band">
          <div className="se-band-inner">
            <img src="/cs-logo-large.png" alt="Cedars-Sinai" style={{ height: 36, width: 'auto', display: 'block', flexShrink: 0 }} />
            <div className="se-divider" />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Brawerman Nursing Institute
            </span>
          </div>
        </div>
        <div className="se-title-block">
          <div className="se-title-inner">
            <h1 style={{ fontSize: 21, fontWeight: 700, color: '#191919', margin: '0 0 4px', fontFamily: 'DM Sans, system-ui, sans-serif', lineHeight: 1.3 }}>
              Student Feedback: Preceptor & Unit
            </h1>
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Your feedback helps improve the ASPIRE learning environment
            </p>
          </div>
        </div>
      </header>

      {view !== 'form' && (
        <div className="se-container">
          <p style={{ fontSize: 16, color: '#4b5563', textAlign: 'center', marginTop: 80, lineHeight: 1.6 }}>
            {view === 'loading'       ? 'Loading…'
            : view === 'completed'    ? 'Thank you. This survey has already been submitted.'
            : view === 'thank_you'    ? 'Thank you. Your feedback has been recorded and will help improve the ASPIRE learning environment.'
            : view === 'invalid'      ? (errorMessage || 'This survey link is no longer valid.')
            : view === 'unsupported'  ? 'This survey link is not supported by the current application version.'
            : view === 'rate_limited' ? 'Too many requests. Please try again in a minute.'
            : view === 'rejected'     ? 'Please review the required fields and try again.'
            :                           'Something went wrong. Please try again later.'}
          </p>
        </div>
      )}

      {view === 'form' && content && (
        <div className="se-container">
          {content.intro && (
            <div className="se-card">
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, margin: '0 0 8px' }}>{content.intro.body}</p>
              {content.intro.compliance_note && <p className="se-note" style={{ margin: 0 }}>{content.intro.compliance_note}</p>}
            </div>
          )}

          <form onSubmit={handleSubmit}>

            {/* Evaluated target - read-only context */}
            <div className="se-card">
              <h2 className="se-section-title">{et?.title || 'Preceptor / Unit'}</h2>
              {et?.instructions && <p className="se-section-instr">{et.instructions}</p>}
              <div className="se-field">
                <span className="se-label">{et?.fields?.preceptor_name?.label || 'Preceptor'}</span>
                <div className="se-readonly">{meta.evaluatedTarget?.preceptor_name || '-'}</div>
              </div>
              {meta.evaluatedTarget?.unit && (
                <div className="se-field" style={{ marginBottom: 0 }}>
                  <span className="se-label">{et?.fields?.unit?.label || 'Unit / Area'}</span>
                  <div className="se-readonly">{meta.evaluatedTarget.unit}</div>
                </div>
              )}
            </div>

            {/* Likert domains 1–3 */}
            {[
              { sec: s1, items: s1Items, state: support, setState: setSupport, comment: supportComment, setComment: setSupportComment },
              { sec: s2, items: s2Items, state: environment, setState: setEnvironment, comment: environmentComment, setComment: setEnvironmentComment },
              { sec: s3, items: s3Items, state: safety, setState: setSafety, comment: null, setComment: null },
            ].map(({ sec, items, state, setState, comment, setComment }) => sec && (
              <div className="se-card" key={sec.key}>
                <h2 className="se-section-title">{sec.title}</h2>
                {sec.instructions && <p className="se-section-instr">{sec.instructions}</p>}
                {Object.entries(items).map(([code, text]) => (
                  <LikertItem
                    key={code}
                    name={`${sec.key}__${code}`}
                    text={text}
                    scale={ratingScale}
                    value={state[code]}
                    onChange={(v) => setState(prev => ({ ...prev, [code]: v }))}
                  />
                ))}
                {sec.commentLabel && setComment && (
                  <div style={{ marginTop: 8 }}>
                    <div className="se-comment-label">{sec.commentLabel}</div>
                    <textarea className="se-textarea" style={{ minHeight: 64 }} maxLength={4000}
                      value={comment} onChange={e => setComment(e.target.value)} />
                  </div>
                )}
              </div>
            ))}

            {/* Overall experience */}
            {s4 && (
              <div className="se-card">
                <h2 className="se-section-title">{s4.title}</h2>
                {s4.instructions && <p className="se-section-instr">{s4.instructions}</p>}
                {Object.entries(s4Items).map(([code, text]) => (
                  <LikertItem
                    key={code}
                    name={`overall__${code}`}
                    text={text}
                    scale={ratingScale}
                    value={overall[code]}
                    onChange={(v) => setOverall(prev => ({ ...prev, [code]: v }))}
                  />
                ))}
                <LikertItem
                  name="overall__overall_rating"
                  text={s4.ratingItem?.overall_rating?.label || 'Overall rating of the rotation experience'}
                  scale={overallScale}
                  value={overall.overall_rating}
                  onChange={(v) => setOverall(prev => ({ ...prev, overall_rating: v }))}
                />
              </div>
            )}

            {/* Narrative (optional) */}
            {s5 && (
              <div className="se-card">
                <h2 className="se-section-title">{s5.title}</h2>
                {[
                  { key: 'strengths', value: strengths, set: setStrengths },
                  { key: 'suggestions', value: suggestions, set: setSuggestions },
                  { key: 'open_comment', value: openComment, set: setOpenComment },
                ].map(({ key, value, set }) => (
                  <div className="se-field" key={key}>
                    <label className="se-label">{s5.fields?.[key]?.label || key}</label>
                    <textarea className="se-textarea" maxLength={4000} value={value} onChange={e => set(e.target.value)} />
                  </div>
                ))}
              </div>
            )}

            {/* Attestation */}
            <div className="se-card">
              <div className="se-attest">
                <input id="attestation" type="checkbox" checked={attestation} onChange={e => setAttestation(e.target.checked)} />
                <label htmlFor="attestation">{att?.label || 'I confirm this feedback reflects my genuine experience and is intended to help improve the ASPIRE learning environment.'}<span className="se-req">*</span></label>
              </div>
            </div>

            <div style={{ paddingTop: 4 }}>
              {!allComplete && (
                <p className="se-note" style={{ marginBottom: 10 }}>Answer all rated items and confirm the attestation to submit.</p>
              )}
              <button type="submit" className="se-submit" disabled={!allComplete || submitting}>
                {submitting ? 'Submitting…' : 'Submit Feedback'}
              </button>
            </div>

          </form>
        </div>
      )}
    </div>
  )
}
