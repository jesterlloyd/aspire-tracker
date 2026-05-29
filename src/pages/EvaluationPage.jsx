import { useState, useEffect, useCallback } from 'react'

// Token format: 43-character base64url string after the #t= fragment
const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/

const F = 'DM Sans, system-ui, sans-serif'

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionBlock({ title, instructions, codes, items, anchors, scaleCount, responses, onChange }) {
  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>{title}</h2>
      {instructions && <p style={s.instructions}>{instructions}</p>}
      {anchors.length > 0 && (
        <div style={s.anchorRow}>
          {anchors.map((label, i) => (
            <span key={i} style={s.anchorLabel}>{label}</span>
          ))}
        </div>
      )}
      {codes.map(code => (
        <div key={code} style={s.itemRow}>
          <p style={s.itemText}>{items?.[code] || code}</p>
          <div style={s.radioGroup} role="radiogroup" aria-label={code}>
            {Array.from({ length: scaleCount }, (_, i) => {
              const val = i + 1
              const checked = responses[code] === val
              return (
                <label key={val} style={s.radioLabel}>
                  <input
                    type="radio"
                    name={code}
                    value={val}
                    checked={checked}
                    onChange={() => onChange(code, val)}
                  />
                  <span style={s.radioAnchor}>{anchors[i] ? anchors[i] : val}</span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function DemographicQuestion({ code, question, value, onChange }) {
  const { label, type, options } = question
  return (
    <div style={s.demoQuestion}>
      <label style={s.fieldLabel} htmlFor={code}>{label}</label>
      {type === 'select' ? (
        <select
          id={code}
          style={s.select}
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
          style={s.input}
          value={value}
          onChange={e => onChange(code, e.target.value === '' ? '' : Number(e.target.value))}
        />
      ) : (
        <input
          id={code}
          type="text"
          style={s.input}
          value={value}
          onChange={e => onChange(code, e.target.value)}
        />
      )}
    </div>
  )
}

// ── Minimal status views ────────────────────────────────────────────────────

function StatusView({ message }) {
  return (
    <div style={s.page}>
      <p style={s.statusMessage}>{message}</p>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function EvaluationPage() {
  const [view,         setView]         = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [surveyData,   setSurveyData]   = useState(null)
  const [responses,    setResponses]    = useState({})
  const [rawToken,     setRawToken]     = useState(null)
  const [submitting,   setSubmitting]   = useState(false)

  // Insert no-referrer meta tag for the lifetime of this page
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  // On mount: read token from URL hash, strip it from the address bar, call validate
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

  const allAnswered = surveyData
    ? surveyData.requiredItemCodes.every(code => {
        const val = responses[code]
        return val !== undefined && val !== null && val !== ''
      })
    : false

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

  // ── View routing ──────────────────────────────────────────────────────────

  if (view === 'loading')     return <StatusView message="Loading…" />
  if (view === 'completed')   return <StatusView message="Thank you. Your response has already been recorded." />
  if (view === 'thank_you')   return <StatusView message="Thank you. Your response has been recorded." />
  if (view === 'invalid')     return <StatusView message={errorMessage || 'This survey link is no longer valid.'} />
  if (view === 'unsupported') return <StatusView message="This survey link is not supported by the current application version." />
  if (view === 'rate_limited')return <StatusView message="Too many requests. Please try again in a minute." />
  if (view === 'rejected')    return <StatusView message="Please review your responses and try again." />
  if (view === 'error')       return <StatusView message="Something went wrong. Please try again later." />

  // ── Form view ─────────────────────────────────────────────────────────────

  const {
    firstName, instrumentDisplayName, timepointLabel,
    requiredItemCodes, optionalItemCodes, content,
  } = surveyData

  const s1Codes = requiredItemCodes.filter(c => c.startsWith('S1_'))
  const s2Codes = requiredItemCodes.filter(c => c.startsWith('S2_'))
  const s3Codes = requiredItemCodes.filter(c => c.startsWith('S3_'))
  const s4Codes = requiredItemCodes.filter(c => c.startsWith('S4_'))

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <p style={s.greeting}>Hello, {firstName}.</p>
        <p style={s.subtitle}>{instrumentDisplayName} — {timepointLabel}</p>
      </div>

      <form onSubmit={handleSubmit}>

        {/* Section I */}
        <SectionBlock
          title="Section I"
          instructions={content.sectionInstructions?.s1}
          codes={s1Codes}
          items={content.items}
          anchors={content.responseAnchors?.s1 || []}
          scaleCount={4}
          responses={responses}
          onChange={handleValueChange}
        />

        {/* Section II */}
        <SectionBlock
          title="Section II"
          instructions={content.sectionInstructions?.s2}
          codes={s2Codes}
          items={content.items}
          anchors={content.responseAnchors?.s2 || []}
          scaleCount={5}
          responses={responses}
          onChange={handleValueChange}
        />

        {/* Section III */}
        <SectionBlock
          title="Section III"
          instructions={content.sectionInstructions?.s3}
          codes={s3Codes}
          items={content.items}
          anchors={content.responseAnchors?.s3 || []}
          scaleCount={3}
          responses={responses}
          onChange={handleValueChange}
        />

        {/* Section IV */}
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Section IV</h2>
          {content.sectionInstructions?.s4 && (
            <p style={s.instructions}>{content.sectionInstructions.s4}</p>
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
          <div style={s.commentBlock}>
            <label style={s.fieldLabel} htmlFor="S4_COMMENT">
              {content.optionalCommentLabel || 'Additional comments (optional)'}
            </label>
            <textarea
              id="S4_COMMENT"
              style={s.textarea}
              maxLength={2000}
              value={responses['S4_COMMENT'] || ''}
              onChange={e => handleValueChange('S4_COMMENT', e.target.value)}
            />
          </div>
        )}

        {/* Submit */}
        <div style={s.submitRow}>
          <button
            type="submit"
            disabled={!allAnswered || submitting}
            style={{
              ...s.submitBtn,
              opacity:  (!allAnswered || submitting) ? 0.5 : 1,
              cursor:   (!allAnswered || submitting) ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Survey'}
          </button>
        </div>

      </form>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = {
  page: {
    fontFamily:    F,
    maxWidth:      720,
    margin:        '0 auto',
    padding:       '32px 20px 80px',
    color:         '#1f2937',
    lineHeight:    1.6,
  },
  statusMessage: {
    fontSize:    16,
    color:       '#4b5563',
    textAlign:   'center',
    marginTop:   80,
  },
  header: {
    marginBottom:  32,
    paddingBottom: 16,
    borderBottom:  '1px solid #e5e7eb',
  },
  greeting: {
    fontSize:   20,
    fontWeight: 700,
    color:      '#111827',
    margin:     '0 0 4px',
  },
  subtitle: {
    fontSize: 14,
    color:    '#6b7280',
    margin:   0,
  },
  section: {
    marginBottom: 40,
  },
  sectionTitle: {
    fontSize:     15,
    fontWeight:   700,
    color:        '#111827',
    marginBottom: 8,
    marginTop:    0,
  },
  instructions: {
    fontSize:     14,
    color:        '#4b5563',
    marginBottom: 12,
    lineHeight:   1.6,
  },
  anchorRow: {
    display:        'flex',
    justifyContent: 'flex-end',
    gap:            8,
    marginBottom:   8,
  },
  anchorLabel: {
    fontSize:   11,
    color:      '#6b7280',
    minWidth:   44,
    textAlign:  'center',
    lineHeight: 1.3,
  },
  itemRow: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid #f3f4f6',
  },
  itemText: {
    fontSize:     14,
    color:        '#1f2937',
    margin:       '0 0 10px',
    lineHeight:   1.5,
  },
  radioGroup: {
    display:  'flex',
    gap:      12,
    flexWrap: 'wrap',
  },
  radioLabel: {
    display:        'inline-flex',
    flexDirection:  'column',
    alignItems:     'center',
    gap:            4,
    cursor:         'pointer',
    minWidth:       44,
  },
  radioAnchor: {
    fontSize:   11,
    color:      '#6b7280',
    textAlign:  'center',
    lineHeight: 1.3,
  },
  demoQuestion: {
    marginBottom: 16,
  },
  fieldLabel: {
    display:      'block',
    fontSize:     14,
    fontWeight:   500,
    color:        '#1f2937',
    marginBottom: 6,
  },
  input: {
    border:      '1px solid #d1d5db',
    borderRadius: 6,
    padding:     '8px 12px',
    fontSize:    14,
    width:       '100%',
    boxSizing:   'border-box',
    fontFamily:  F,
    color:       '#1f2937',
  },
  select: {
    border:      '1px solid #d1d5db',
    borderRadius: 6,
    padding:     '8px 12px',
    fontSize:    14,
    width:       '100%',
    fontFamily:  F,
    color:       '#1f2937',
  },
  commentBlock: {
    marginBottom: 32,
  },
  textarea: {
    border:      '1px solid #d1d5db',
    borderRadius: 6,
    padding:     '8px 12px',
    fontSize:    14,
    width:       '100%',
    minHeight:   96,
    boxSizing:   'border-box',
    fontFamily:  F,
    color:       '#1f2937',
    resize:      'vertical',
  },
  submitRow: {
    display:        'flex',
    justifyContent: 'flex-end',
    paddingTop:     8,
  },
  submitBtn: {
    backgroundColor: '#1D2567',
    color:           '#fff',
    border:          'none',
    borderRadius:    8,
    padding:         '12px 32px',
    fontSize:        15,
    fontWeight:      600,
    fontFamily:      F,
  },
}
