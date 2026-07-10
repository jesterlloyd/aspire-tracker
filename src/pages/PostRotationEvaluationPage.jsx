import { useState, useEffect, useCallback, useMemo } from 'react'

// Public tokenized renderer for the ASPIRE Post-Rotation Evaluation (slug:
// post_rotation_evaluation). Mounted at /evaluation/post-rotation. Fully isolated from the
// Casey-Fink, preceptor, and student-experience pages, none of which is modified. Submits the
// flat response object to /api/evaluation-post-rotation-submit, which calls
// submit_post_rotation_evaluation_response and then issues the Certificate of Participation
// metadata. This page never shows a certificate download link (that arrives in a later phase).

const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/

const PR_CSS = `
  .pr-page { background:#F4F1EC; min-height:100vh; }
  .pr-container { max-width:880px; margin:0 auto; padding:24px 16px 80px; font-family:'DM Sans',system-ui,sans-serif; color:#191919; }
  .pr-card { background:#fff; border-radius:12px; border:1px solid #e8e4dc; padding:24px 24px; margin-bottom:20px; }
  .pr-section-title { font-size:17px; font-weight:700; color:#191919; margin:0 0 14px; }
  .pr-field { margin-bottom:22px; }
  .pr-field:last-child { margin-bottom:0; }
  .pr-label { display:block; font-size:14px; font-weight:600; color:#191919; margin-bottom:8px; line-height:1.5; }
  .pr-req { color:#b91c1c; margin-left:3px; }
  .pr-helper { font-size:12.5px; color:#6b7280; margin:0 0 8px; line-height:1.55; }
  .pr-textarea {
    width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:8px;
    padding:11px 12px; font-size:16px; font-family:'DM Sans',system-ui,sans-serif; color:#191919;
    min-height:88px; resize:vertical; line-height:1.5;
  }
  .pr-textarea:focus { outline:2px solid #1D2567; outline-offset:1px; }
  .pr-scale { display:flex; flex-wrap:wrap; gap:8px; margin:4px 0; }
  .pr-opt {
    display:flex; align-items:center; gap:8px; min-height:44px; padding:7px 12px;
    border:1px solid #e5e7eb; border-radius:8px; cursor:pointer; font-size:13.5px; color:#374151;
  }
  .pr-opt:hover { background:#f6f5f2; }
  .pr-opt.sel { border-color:#1D2567; background:#eef1fb; color:#1D2567; font-weight:600; }
  .pr-opt input { width:17px; height:17px; accent-color:#1D2567; flex-shrink:0; }
  .pr-submit {
    background:#1D2567; color:#fff; border:none; border-radius:10px; padding:15px 32px;
    font-size:16px; font-weight:600; font-family:'DM Sans',system-ui,sans-serif; cursor:pointer;
    width:100%; min-height:52px;
  }
  .pr-submit:disabled { opacity:0.4; cursor:not-allowed; }
  .pr-note { font-size:12.5px; color:#6b7280; line-height:1.6; }
  .pr-band { background:linear-gradient(180deg,#1D2567 0%,#161D52 100%); }
  .pr-band-inner { max-width:880px; margin:0 auto; padding:13px 16px; display:flex; align-items:center; gap:12px; }
  .pr-divider { width:1px; height:26px; background:rgba(255,255,255,0.22); flex-shrink:0; }
  .pr-title-block { background:#fff; border-bottom:1px solid #e8e4dc; }
  .pr-title-inner { max-width:880px; margin:0 auto; padding:18px 16px 14px; }
`

// One rating (Likert) item: prompt + a radiogroup of scale options (values 1-5).
function RatingItem({ name, label, required, scale, value, onChange }) {
  return (
    <div className="pr-field">
      <span className="pr-label">{label}{required && <span className="pr-req">*</span>}</span>
      <div className="pr-scale" role="radiogroup" aria-label={label}>
        {scale.map(opt => {
          const sel = value === opt.value
          return (
            <label key={String(opt.value)} className={`pr-opt${sel ? ' sel' : ''}`}>
              <input type="radio" name={name} checked={sel} onChange={() => onChange(opt.value)} />
              <span>{opt.value}. {opt.label}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// One yes/no item: prompt + optional helper + two radio options mapping to boolean true/false.
function YesNoItem({ name, label, required, helper, value, onChange }) {
  return (
    <div className="pr-field">
      <span className="pr-label">{label}{required && <span className="pr-req">*</span>}</span>
      {helper && <p className="pr-helper">{helper}</p>}
      <div className="pr-scale" role="radiogroup" aria-label={label}>
        {[{ v: true, t: 'Yes' }, { v: false, t: 'No' }].map(opt => {
          const sel = value === opt.v
          return (
            <label key={opt.t} className={`pr-opt${sel ? ' sel' : ''}`}>
              <input type="radio" name={name} checked={sel} onChange={() => onChange(opt.v)} />
              <span>{opt.t}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export default function PostRotationEvaluationPage() {
  // Parse the one-time token from the URL hash during initial render (lazy initializer). This lets
  // the validation effect below run only the async fetch, with no synchronous setState in its body.
  const [initial] = useState(() => {
    const match = TOKEN_PATTERN.exec(window.location.hash)
    return { rawToken: match ? match[1] : null, valid: !!match }
  })
  const rawToken = initial.rawToken

  const [view, setView] = useState(initial.valid ? 'loading' : 'invalid')
  const [errorMessage, setErrorMessage] = useState(initial.valid ? null : 'This evaluation link is no longer valid.')
  const [meta, setMeta] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [answers, setAnswers] = useState({})
  const [certificateNumber, setCertificateNumber] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m)
    const s = document.createElement('style'); s.id = 'pr-page-css'; s.textContent = PR_CSS; document.head.appendChild(s)
    return () => { document.head.removeChild(m); const el = document.getElementById('pr-page-css'); if (el) document.head.removeChild(el) }
  }, [])

  useEffect(() => {
    // No token: the initial state already renders the invalid view, so there is nothing to fetch.
    if (!rawToken) return
    // Strip the token from the address bar, then validate it server-side. All state updates happen
    // inside the async promise callbacks (never synchronously in this effect body).
    window.history.replaceState(null, '', window.location.pathname)

    fetch('/api/evaluation-post-rotation-token-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (res.status === 200) {
          if (body.completed === true) { setView('completed') }
          else if (body.content) { setMeta(body); setView('form') }
          else { setView('error') }
        } else if (res.status === 410) { setErrorMessage(body.error || 'This evaluation link is no longer valid.'); setView('invalid') }
        else if (res.status === 422) { setView('unsupported') }
        else if (res.status === 429) { setView('rate_limited') }
        else { setView('error') }
      })
      .catch(() => setView('error'))
  }, [rawToken])

  const content = meta?.content || null
  const sections = useMemo(() => content?.sections || [], [content])
  const ratingScale = content?.ratingScale || []

  const allItems = useMemo(() => sections.flatMap(s => s.items || []), [sections])

  const setAnswer = useCallback((key, value) => {
    setAnswers(prev => ({ ...prev, [key]: value }))
  }, [])

  // All REQUIRED items answered: ratings 1-5, texts non-empty after trim, yes/no boolean.
  const allComplete = useMemo(() => {
    if (!content) return false
    for (const item of allItems) {
      if (!item.required) continue
      const v = answers[item.key]
      if (item.type === 'rating') {
        if (!Number.isInteger(v)) return false
      } else if (item.type === 'yesno') {
        if (v !== true && v !== false) return false
      } else {
        if (typeof v !== 'string' || v.trim() === '') return false
      }
    }
    return true
  }, [content, allItems, answers])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!rawToken || submitting || !allComplete) return
    setSubmitting(true)

    // Build the flat, canonical response object. Text answers are trimmed; optional blanks omitted.
    const responses = {}
    for (const item of allItems) {
      const v = answers[item.key]
      if (item.type === 'rating') {
        if (Number.isInteger(v)) responses[item.key] = v
      } else if (item.type === 'yesno') {
        if (v === true || v === false) responses[item.key] = v
      } else {
        const s = typeof v === 'string' ? v.trim() : ''
        if (s !== '') responses[item.key] = s
      }
    }

    try {
      const res = await fetch('/api/evaluation-post-rotation-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, responses }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 200) { setCertificateNumber(body.certificateNumber || null); setView('thank_you') }
      else if (res.status === 410) { setErrorMessage(body.error || 'This evaluation link is no longer valid.'); setView('invalid') }
      else if (res.status === 422) { setView('rejected') }
      else if (res.status === 429) { setView('rate_limited') }
      else { setView('error') }
    } catch { setView('error') }
    finally { setSubmitting(false) }
  }, [rawToken, submitting, allComplete, allItems, answers])

  // Download the certificate on demand using the token already in page state. The server derives
  // the assignment from the token hash and generates the PDF; nothing is stored client-side.
  const handleDownloadCertificate = useCallback(async () => {
    if (!rawToken || downloading) return
    setDownloading(true); setDownloadError(null)
    try {
      const res = await fetch('/api/certificate-participation-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      })
      if (!res.ok) { setDownloadError('The certificate could not be downloaded right now. Please try again in a moment.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ASPIRE-Certificate-of-Participation-${certificateNumber || 'certificate'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError('Network error. Please try again.')
    } finally {
      setDownloading(false)
    }
  }, [rawToken, downloading, certificateNumber])

  const thankYouCopy = certificateNumber
    ? 'Your Certificate of Participation has been unlocked. You may download it below.'
    : 'Your response has been submitted. Your Certificate of Participation will be available after certificate access is finalized in ASPIRE Intelligence.'

  return (
    <div className="pr-page">
      <header>
        <div className="pr-band">
          <div className="pr-band-inner">
            <img src="/cs-logo-large.png" alt="Cedars-Sinai" style={{ height: 36, width: 'auto', display: 'block', flexShrink: 0 }} />
            <div className="pr-divider" />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Brawerman Nursing Institute
            </span>
          </div>
        </div>
        <div className="pr-title-block">
          <div className="pr-title-inner">
            <h1 style={{ fontSize: 21, fontWeight: 700, color: '#191919', margin: '0 0 4px', fontFamily: 'DM Sans, system-ui, sans-serif', lineHeight: 1.3 }}>
              {content?.title || 'ASPIRE Post-Rotation Evaluation'}
            </h1>
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Your feedback helps improve ASPIRE for future students and academic partners
            </p>
          </div>
        </div>
      </header>

      {view !== 'form' && (
        <div className="pr-container">
          {view === 'thank_you' ? (
            <div className="pr-card" style={{ textAlign: 'center', marginTop: 40 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, color: '#191919', margin: '0 0 12px' }}>
                Thank you for completing your post-rotation evaluation.
              </h2>
              <p style={{ fontSize: 15, color: '#4b5563', lineHeight: 1.65, margin: certificateNumber ? '0 0 18px' : 0 }}>
                {thankYouCopy}
              </p>
              {certificateNumber && (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadCertificate}
                    disabled={downloading}
                    className="pr-submit"
                    style={{ maxWidth: 360, margin: '0 auto', opacity: downloading ? 0.6 : 1, cursor: downloading ? 'default' : 'pointer' }}
                  >
                    {downloading ? 'Preparing…' : 'Download Certificate of Participation'}
                  </button>
                  {downloadError && (
                    <p style={{ fontSize: 13, color: '#991b1b', margin: '12px 0 0' }}>{downloadError}</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 16, color: '#4b5563', textAlign: 'center', marginTop: 80, lineHeight: 1.6 }}>
              {view === 'loading'       ? 'Loading…'
              : view === 'completed'    ? 'Thank you. This evaluation has already been submitted.'
              : view === 'invalid'      ? (errorMessage || 'This evaluation link is no longer valid.')
              : view === 'unsupported'  ? 'This evaluation link is not supported by the current application version.'
              : view === 'rate_limited' ? 'Too many requests. Please try again in a minute.'
              : view === 'rejected'     ? 'Please review the required fields and try again.'
              :                           'Something went wrong. Please try again later.'}
            </p>
          )}
        </div>
      )}

      {view === 'form' && content && (
        <div className="pr-container">
          {content.intro && (
            <div className="pr-card">
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, margin: 0 }}>{content.intro}</p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {sections.map(section => (
              <div className="pr-card" key={section.key}>
                <h2 className="pr-section-title">{section.title}</h2>
                {(section.items || []).map(item => {
                  if (item.type === 'rating') {
                    return (
                      <RatingItem
                        key={item.key}
                        name={item.key}
                        label={item.label}
                        required={item.required}
                        scale={ratingScale}
                        value={answers[item.key]}
                        onChange={(v) => setAnswer(item.key, v)}
                      />
                    )
                  }
                  if (item.type === 'yesno') {
                    return (
                      <YesNoItem
                        key={item.key}
                        name={item.key}
                        label={item.label}
                        required={item.required}
                        helper={item.helper}
                        value={answers[item.key]}
                        onChange={(v) => setAnswer(item.key, v)}
                      />
                    )
                  }
                  return (
                    <div className="pr-field" key={item.key}>
                      <label className="pr-label" htmlFor={`pr-${item.key}`}>
                        {item.label}{item.required ? <span className="pr-req">*</span> : <span style={{ color: '#9ca3af', fontWeight: 400 }}> (optional)</span>}
                      </label>
                      <textarea
                        id={`pr-${item.key}`}
                        className="pr-textarea"
                        maxLength={4000}
                        value={answers[item.key] || ''}
                        onChange={e => setAnswer(item.key, e.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
            ))}

            <div style={{ paddingTop: 4 }}>
              {!allComplete && (
                <p className="pr-note" style={{ marginBottom: 10 }}>Answer all required items to submit.</p>
              )}
              <button type="submit" className="pr-submit" disabled={!allComplete || submitting}>
                {submitting ? 'Submitting…' : 'Submit Evaluation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
