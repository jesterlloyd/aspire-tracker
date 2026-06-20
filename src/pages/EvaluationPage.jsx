import { useState, useEffect, useCallback } from 'react'

// Token format: 43-character base64url string after the #t= fragment
const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/

// ── Page-scoped CSS (injected into <head> at mount, removed on unmount) ───────
// Uses className-based selectors only. No Casey-Fink content anywhere.
// Section content (instructions, anchors, item prose) comes from Storage JSON.
const EVAL_CSS = `
  .eval-page { background: #F4F1EC; min-height: 100vh; }
  .eval-container { max-width: 1040px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', system-ui, sans-serif; color: #191919; }
  .eval-card { background: #ffffff; border-radius: 12px; border: 1px solid #e8e4dc; padding: 28px 32px; margin-bottom: 24px; }

  /* Sticky progress bar */
  .eval-progress-bar { position: sticky; top: 0; z-index: 20; background: #1D2567; }
  .eval-progress-inner { max-width: 1040px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 10px; font-family: 'DM Sans', system-ui, sans-serif; font-size: 14px; color: #ffffff; }
  .eval-progress-count { font-weight: 700; font-size: 18px; line-height: 1; }

  /* Typography */
  .eval-section-title { font-size: 17px; font-weight: 700; color: #191919; margin: 0 0 8px; }
  .eval-instructions { font-size: 14px; color: #4b5563; line-height: 1.7; margin: 0 0 20px; }
  .eval-field-label { display: block; font-size: 14px; font-weight: 500; color: #191919; margin-bottom: 6px; }

  /* Matrix table (Sections I, II, III) */
  .eval-matrix { width: 100%; border-collapse: collapse; }
  .eval-matrix th {
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    text-align: center;
    border-bottom: 2px solid #e5e7eb;
    background: #fafaf9;
    line-height: 1.4;
  }
  .eval-matrix th.th-stmt { text-align: left; font-size: 13px; color: #374151; }
  .eval-matrix td {
    padding: 10px 12px;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: middle;
  }
  .eval-matrix tbody tr:nth-child(even) td { background: #fafafa; }
  .eval-matrix tbody tr:hover td { background: #f0ede8; transition: background 0.1s ease; }
  .eval-matrix td.td-stmt { font-size: 14px; color: #191919; line-height: 1.6; }
  .eval-matrix td.td-radio { text-align: center; width: 72px; }
  .eval-matrix td.td-radio label {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: 44px;
    cursor: pointer;
  }
  .eval-matrix td.td-radio input[type="radio"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #1D2567;
  }

  /* Section IV fields */
  .eval-input, .eval-select {
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 9px 12px;
    font-size: 14px;
    font-family: 'DM Sans', system-ui, sans-serif;
    color: #191919;
    box-sizing: border-box;
    width: 100%;
    max-width: 420px;
    display: block;
  }
  .eval-input:focus, .eval-select:focus { outline: 2px solid #1D2567; outline-offset: 1px; }
  .eval-textarea {
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 9px 12px;
    font-size: 14px;
    font-family: 'DM Sans', system-ui, sans-serif;
    color: #191919;
    width: 100%;
    min-height: 96px;
    box-sizing: border-box;
    resize: vertical;
  }
  .eval-textarea:focus { outline: 2px solid #1D2567; outline-offset: 1px; }

  /* Submit button */
  .eval-submit-btn {
    background: #1D2567;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 13px 40px;
    font-size: 15px;
    font-weight: 600;
    font-family: 'DM Sans', system-ui, sans-serif;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .eval-submit-btn:not(:disabled):hover { opacity: 0.88; }
  .eval-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .eval-submit-btn:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }

  /* Mobile: table collapses to stacked per-question cards */
  @media (max-width: 768px) {
    .eval-card { padding: 20px 16px; }
    .eval-matrix thead { display: none; }
    .eval-matrix tbody tr {
      display: block;
      padding: 12px 0;
      border-bottom: 1px solid #e8e4dc;
    }
    /* Remove desktop striping on mobile */
    .eval-matrix tbody tr:nth-child(even) td,
    .eval-matrix tbody tr:hover td { background: transparent; }
    .eval-matrix td {
      display: flex;
      align-items: center;
      border-bottom: none;
      padding: 5px 0;
      gap: 10px;
    }
    .eval-matrix td.td-stmt {
      display: block;
      font-weight: 500;
      padding-bottom: 8px;
    }
    .eval-matrix td.td-radio {
      text-align: left;
      width: auto;
    }
    /* Show anchor label before each radio using data-label attribute */
    .eval-matrix td.td-radio::before {
      content: attr(data-label);
      font-size: 12px;
      color: #6b7280;
      min-width: 90px;
      flex-shrink: 0;
    }
    .eval-matrix td.td-radio label {
      justify-content: flex-start;
      min-height: 32px;
    }
    .eval-input, .eval-select { max-width: 100%; }
  }

  /* Branded survey header — renders across all page states */

  /* Dark band — mirrors app navbar gradient treatment */
  .eval-branded-band {
    background: linear-gradient(180deg, #1D2567 0%, #161D52 100%);
  }
  .eval-branded-band-inner {
    max-width: 1040px;
    margin: 0 auto;
    padding: 13px 20px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-family: 'DM Sans', system-ui, sans-serif;
  }
  .eval-branded-divider {
    width: 1px; height: 28px;
    background: rgba(255,255,255,0.22);
    flex-shrink: 0;
  }

  /* Light title block — below the dark band */
  .eval-branded-title {
    background: #ffffff;
    border-bottom: 1px solid #e8e4dc;
  }
  .eval-branded-title-inner {
    max-width: 1040px;
    margin: 0 auto;
    padding: 20px 20px 16px;
    font-family: 'DM Sans', system-ui, sans-serif;
  }
  @media (max-width: 768px) {
    .eval-branded-title-inner h1 { font-size: 18px; }
  }
`

// ── Sub-components ────────────────────────────────────────────────────────────

// Renders a Likert-scale section as a matrix table on desktop.
// On mobile (≤768px), thead is hidden and each radio cell uses
// data-label + CSS ::before to show its anchor label inline.
function SectionMatrix({ title, instructions, codes, items, anchors, scaleCount, responses, onChange }) {
  return (
    <div className="eval-card">
      <h2 className="eval-section-title">{title}</h2>
      {instructions && <p className="eval-instructions">{instructions}</p>}
      <table className="eval-matrix">
        <thead>
          <tr>
            <th className="th-stmt">Statement</th>
            {Array.from({ length: scaleCount }, (_, i) => (
              <th key={i}>{anchors[i] || String(i + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {codes.map(code => (
            <tr key={code}>
              <td className="td-stmt">{items?.[code] || code}</td>
              {Array.from({ length: scaleCount }, (_, i) => {
                const val = i + 1
                const dataLabel = anchors[i] || String(val)
                return (
                  <td key={val} className="td-radio" data-label={dataLabel}>
                    <label>
                      <input
                        type="radio"
                        name={code}
                        value={val}
                        checked={responses[code] === val}
                        onChange={() => onChange(code, val)}
                      />
                    </label>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DemographicQuestion({ code, question, value, onChange }) {
  const { label, type, options } = question
  return (
    <div style={{ marginBottom: 20 }}>
      <label className="eval-field-label" htmlFor={code}>{label}</label>
      {type === 'select' ? (
        <select
          id={code}
          className="eval-select"
          value={value}
          onChange={e => onChange(code, e.target.value)}
        >
          <option value="">Select…</option>
          {(options || []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : type === 'number' ? (
        <input
          id={code}
          type="number"
          className="eval-input"
          value={value}
          onChange={e => onChange(code, e.target.value === '' ? '' : Number(e.target.value))}
        />
      ) : (
        <input
          id={code}
          type="text"
          className="eval-input"
          value={value}
          onChange={e => onChange(code, e.target.value)}
        />
      )}
    </div>
  )
}


// ── Main component ────────────────────────────────────────────────────────────

export default function EvaluationPage() {
  const [view,         setView]         = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [surveyData,   setSurveyData]   = useState(null)
  const [responses,    setResponses]    = useState({})
  const [rawToken,     setRawToken]     = useState(null)
  const [submitting,   setSubmitting]   = useState(false)

  // Insert no-referrer meta tag + page CSS; both removed on unmount
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)

    const style = document.createElement('style')
    style.id = 'eval-page-css'
    style.textContent = EVAL_CSS
    document.head.appendChild(style)

    return () => {
      document.head.removeChild(meta)
      const el = document.getElementById('eval-page-css')
      if (el) document.head.removeChild(el)
    }
  }, [])

  // On mount: read token from URL hash, strip it from address bar, call validate
  useEffect(() => {
    const hash = window.location.hash
    const match = TOKEN_PATTERN.exec(hash)

    if (!match) {
      setErrorMessage('This survey link is no longer valid.')
      setView('invalid')
      return
    }

    const token = match[1]
    setRawToken(token)
    window.history.replaceState(null, '', window.location.pathname)

    fetch('/api/evaluation-token-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (res.status === 200) {
          if (body.completed === true) {
            setView('completed')
          } else if (body.content) {
            setSurveyData(body)
            setView('form')
          } else {
            setView('error')
          }
        } else if (res.status === 410) {
          setErrorMessage(body.error || 'This survey link is no longer valid.')
          setView('invalid')
        } else if (res.status === 422) {
          setView('unsupported')
        } else if (res.status === 429) {
          setView('rate_limited')
        } else {
          setView('error')
        }
      })
      .catch(() => setView('error'))
  }, [])

  const handleValueChange = useCallback((code, value) => {
    setResponses(prev => ({ ...prev, [code]: value }))
  }, [])

  // Progress: count of required codes that have a non-empty value
  const completedCount = surveyData
    ? surveyData.requiredItemCodes.filter(code => {
        const val = responses[code]
        return val !== undefined && val !== null && val !== ''
      }).length
    : 0
  const totalCount = surveyData ? surveyData.requiredItemCodes.length : 60
  const allAnswered = totalCount > 0 && completedCount === totalCount

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!rawToken || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/evaluation-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, responses }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 200) {
        setView('thank_you')
      } else if (res.status === 410) {
        setErrorMessage(body.error || 'This survey link is no longer valid.')
        setView('invalid')
      } else if (res.status === 422) {
        setView('rejected')
      } else if (res.status === 429) {
        setView('rate_limited')
      } else {
        setView('error')
      }
    } catch {
      setView('error')
    } finally {
      setSubmitting(false)
    }
  }, [rawToken, responses, submitting])

  // ── Render ────────────────────────────────────────────────────────────────
  // Branded header is rendered across ALL page states.
  // Destructure surveyData with defaults so code-paths are null-safe when not in form view.

  const {
    firstName = null, instrumentDisplayName = null, timepointLabel = null,
    requiredItemCodes = [], optionalItemCodes = [], content = null,
  } = surveyData || {}

  const s1Codes = requiredItemCodes.filter(c => c.startsWith('S1_'))
  const s2Codes = requiredItemCodes.filter(c => c.startsWith('S2_'))
  const s3Codes = requiredItemCodes.filter(c => c.startsWith('S3_'))
  const s4Codes = requiredItemCodes.filter(c => c.startsWith('S4_'))

  return (
    <div className="eval-page">

      {/* Branded header — always visible regardless of page state */}
      <header>
        {/* Dark identity band — Nightfall gradient matching app navbar */}
        <div className="eval-branded-band">
          <div className="eval-branded-band-inner">
            <img
              src="/cs-logo-large.png"
              alt="Cedars-Sinai"
              style={{ height: 38, width: 'auto', display: 'block', flexShrink: 0 }}
            />
            <div className="eval-branded-divider" />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.90)', fontWeight: 500, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Brawerman Nursing Institute
            </span>
          </div>
        </div>
        {/* Light title block — survey identity below the brand band */}
        <div className="eval-branded-title">
          <div className="eval-branded-title-inner">
            <h1 style={{
              fontSize: 22, fontWeight: 700, color: '#191919',
              margin: '0 0 6px', fontFamily: 'DM Sans, system-ui, sans-serif', lineHeight: 1.3,
            }}>
              Casey-Fink Readiness for Practice Survey
            </h1>
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
              Instrument: Casey-Fink Readiness for Practice Survey
            </p>
          </div>
        </div>
      </header>

      {/* Non-form state messages — same text as existing state screens */}
      {view !== 'form' && (
        <div className="eval-container">
          <p style={{ fontSize: 16, color: '#4b5563', textAlign: 'center', marginTop: 80 }}>
            {view === 'loading'       ? 'Loading…'
            : view === 'completed'   ? 'Thank you. Your response has already been recorded.'
            : view === 'thank_you'   ? 'Thank you. Your response has been recorded.'
            : view === 'invalid'     ? (errorMessage || 'This survey link is no longer valid.')
            : view === 'unsupported' ? 'This survey link is not supported by the current application version.'
            : view === 'rate_limited'? 'Too many requests. Please try again in a minute.'
            : view === 'rejected'    ? 'Please review your responses and try again.'
            :                          'Something went wrong. Please try again later.'
            }
          </p>
        </div>
      )}

      {/* Form view — rendered only when view === 'form' and surveyData is loaded */}
      {view === 'form' && surveyData && (
      <>

      {/* Sticky progress bar — spans full viewport width */}
      <div className="eval-progress-bar" role="status" aria-live="polite" aria-label="Survey progress">
        <div className="eval-progress-inner">
          <span>Required responses completed:</span>
          <span className="eval-progress-count">{completedCount}</span>
          <span>of {totalCount}</span>
        </div>
      </div>

      <div className="eval-container">

        {/* Page header */}
        <div className="eval-card">
          <p style={{ fontSize: 22, fontWeight: 700, color: '#191919', margin: '0 0 6px', lineHeight: 1.3 }}>
            Hello, {firstName}.
          </p>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
            {instrumentDisplayName} — {timepointLabel}
          </p>
        </div>

        <form onSubmit={handleSubmit}>

          {/* Section I — 4-point scale, 15 items */}
          <SectionMatrix
            title="Section I"
            instructions={content.sectionInstructions?.s1}
            codes={s1Codes}
            items={content.items}
            anchors={content.responseAnchors?.s1 || []}
            scaleCount={4}
            responses={responses}
            onChange={handleValueChange}
          />

          {/* Section II — 5-point scale, 4 items */}
          <SectionMatrix
            title="Section II"
            instructions={content.sectionInstructions?.s2}
            codes={s2Codes}
            items={content.items}
            anchors={content.responseAnchors?.s2 || []}
            scaleCount={5}
            responses={responses}
            onChange={handleValueChange}
          />

          {/* Section III — 3-point scale, 31 items */}
          <SectionMatrix
            title="Section III"
            instructions={content.sectionInstructions?.s3}
            codes={s3Codes}
            items={content.items}
            anchors={content.responseAnchors?.s3 || []}
            scaleCount={3}
            responses={responses}
            onChange={handleValueChange}
          />

          {/* Section IV — demographic questions */}
          <div className="eval-card">
            <h2 className="eval-section-title">Section IV</h2>
            {content.sectionInstructions?.s4 && (
              <p className="eval-instructions">{content.sectionInstructions.s4}</p>
            )}
            {s4Codes.map(code => {
              const q = content.demographicQuestions?.[code]
              if (!q) return null
              return (
                <DemographicQuestion
                  key={code}
                  code={code}
                  question={q}
                  value={responses[code] ?? ''}
                  onChange={handleValueChange}
                />
              )
            })}
          </div>

          {/* Optional comment */}
          {optionalItemCodes?.includes('S4_COMMENT') && (
            <div className="eval-card">
              <label className="eval-field-label" htmlFor="S4_COMMENT">
                {content.optionalCommentLabel || 'Additional comments (optional)'}
              </label>
              <textarea
                id="S4_COMMENT"
                className="eval-textarea"
                maxLength={2000}
                value={responses['S4_COMMENT'] || ''}
                onChange={e => handleValueChange('S4_COMMENT', e.target.value)}
              />
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 6, marginBottom: 0 }}>
                Maximum 2000 characters. Optional.
              </p>
            </div>
          )}

          {/* Submit row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, paddingTop: 8 }}>
            {!allAnswered && (
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                Complete all {totalCount} required responses to submit.
              </span>
            )}
            <button
              type="submit"
              disabled={!allAnswered || submitting}
              className="eval-submit-btn"
            >
              {submitting ? 'Submitting…' : 'Submit Survey'}
            </button>
          </div>

        </form>
      </div>

      </>
      )}
    </div>
  )
}
