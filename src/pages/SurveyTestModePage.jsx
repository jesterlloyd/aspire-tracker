// ASPIRE-EVAL-TEST-MODE-1: the non-persistent survey test renderer.
//
// WHAT THIS IS. An Owner/Admin fills in a real survey, from the real question
// definitions, and nothing is written anywhere. There is no token, no assignment, and no
// submit endpoint. "Submit" validates locally and shows what WOULD have been sent.
//
// WHY NOT THE PRODUCTION SURVEY PAGE. The four production pages are bound to token
// validation from their first render, and they are the single most sensitive surface in
// the system: they are what students and preceptors actually see. Adding a no-token
// branch to all four in order to support staff QA would put that path at risk for a
// testing convenience. This renderer instead reads the SAME definitions through the same
// preview model, so the questions, order, types, required flags, and scale labels are
// guaranteed to match production. The honest limitation is that the visual form chrome is
// this component's, not the production page's, so this validates CONTENT and FLOW rather
// than pixel-level production layout.
//
// SAFETY, by construction rather than by flag:
//   - no assignment row exists, so the release queue and every student's slot are untouched
//   - no token exists, so nothing can be submitted against a real instrument
//   - no response row is written, so analytics, exports, the school portal, and the
//     student portal cannot see it
//   - the certificate gate reads assignments and instruments, so it cannot fire
//   - nothing is emailed to any student or preceptor

import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { surveyByKey } from '../lib/evaluation/surveyCatalog'
import { buildPreviewModel, countQuestions } from '../lib/evaluation/surveyPreviewModel'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'

const input = {
  width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8,
  fontSize: 14, color: '#374151', outline: 'none', boxSizing: 'border-box', fontFamily: F,
  background: '#fff',
}

function Banner() {
  return (
    <div
      role="status"
      style={{
        position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 9,
        background: '#fef3c7', borderBottom: '1px solid #fcd34d', color: '#92400e',
        padding: '10px 16px', fontSize: 13, fontWeight: 700, fontFamily: F,
      }}
    >
      <AlertTriangle size={16} aria-hidden="true" />
      <span>
        TEST MODE. Nothing you enter is saved. No response is recorded, no certificate is
        issued, and no student or preceptor is contacted.
      </span>
    </div>
  )
}

export default function SurveyTestModePage() {
  const { workflowKey } = useParams()
  const navigate = useNavigate()
  const { user, userProfile, loading } = useAuth()
  const survey = surveyByKey(workflowKey)

  const inlineModel = useMemo(
    () => (survey?.contentSource === 'inline' ? buildPreviewModel(survey.slug, null) : null),
    [survey])
  const [fetched, setFetched] = useState({ forSlug: null, model: null, error: '' })
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)

  const isStaff = !!userProfile &&
    (userProfile.is_owner === true || userProfile.role === 'owner' || userProfile.role === 'admin')

  useEffect(() => {
    if (!survey || survey.contentSource === 'inline' || !isStaff) return undefined
    let live = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        if (!token) { if (live) setFetched({ forSlug: survey.slug, model: null, error: 'Please sign in again.' }); return }
        const res = await fetch(`/api/evaluation-instrument-content?slug=${encodeURIComponent(survey.slug)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!live) return
        if (!res.ok) { setFetched({ forSlug: survey.slug, model: null, error: 'The survey could not be loaded.' }); return }
        const body = await res.json()
        if (!live) return
        setFetched({ forSlug: survey.slug, model: buildPreviewModel(survey.slug, body?.content), error: '' })
      } catch {
        if (live) setFetched({ forSlug: survey.slug, model: null, error: 'The survey could not be loaded.' })
      }
    })()
    return () => { live = false }
  }, [survey, isStaff])

  if (loading) return <Shell><p style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</p></Shell>

  // Test mode is staff-only. A signed-out or non-staff visitor is told nothing about
  // whether the workflow exists.
  if (!user || !isStaff) {
    return (
      <Shell>
        <h1 style={{ fontSize: 16, color: NAVY, margin: '0 0 8px' }}>Not available</h1>
        <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
          Survey test mode is available to ASPIRE program leads who are signed in.
        </p>
      </Shell>
    )
  }

  if (!survey) {
    return (
      <Shell>
        <h1 style={{ fontSize: 16, color: NAVY, margin: '0 0 8px' }}>Unknown survey</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>That workflow is not registered.</p>
      </Shell>
    )
  }

  const model = survey.contentSource === 'inline'
    ? inlineModel
    : (fetched.forSlug === survey.slug ? fetched.model : null)
  const error = survey.contentSource === 'inline' ? '' : (fetched.forSlug === survey.slug ? fetched.error : '')

  const set = (k, v) => { setAnswers(a => ({ ...a, [k]: v })); setResult(null) }

  const onSubmit = (e) => {
    e.preventDefault()
    // Local validation only. There is no endpoint to call and no row to write.
    const missing = []
    for (const sec of model?.sections || []) {
      for (const it of sec.items) {
        if (it.required && it.type !== 'display') {
          const v = answers[it.key]
          if (v === undefined || v === null || String(v).trim() === '') missing.push(it.label)
        }
      }
    }
    setResult({ missing, answered: Object.keys(answers).length })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EC', fontFamily: F }}>
      <Banner />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 60px' }}>
        <button
          type="button"
          onClick={() => navigate('/evaluation')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: NAVY, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 12, fontFamily: F }}
        >
          <ArrowLeft size={14} aria-hidden="true" /> Back to Evaluation
        </button>

        <div style={{ background: '#fff', borderRadius: 14, padding: '22px 24px', boxShadow: '0 1px 3px rgba(25,25,25,0.08)' }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 700, color: '#191919' }}>{survey.title}</h1>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: '#9ca3af' }}>
            Test rendering of <code>{survey.slug}</code>
            {survey.status === 'paused' && ' · this workflow is paused for production release'}
          </p>

          {error && (
            <p role="alert" style={{ fontSize: 13, color: '#991b1b', background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 12px' }}>{error}</p>
          )}
          {!model && !error && <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading the survey…</p>}

          {model && (
            <form onSubmit={onSubmit}>
              {model.intro?.body && (
                <p style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.65, margin: '0 0 18px' }}>{model.intro.body}</p>
              )}

              {model.sections.map(sec => (
                <section key={sec.key} style={{ marginBottom: 22 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: '0 0 4px' }}>{sec.title || sec.key}</h2>
                  {sec.instructions && <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 10px', lineHeight: 1.5 }}>{sec.instructions}</p>}

                  {sec.items.map(it => (
                    <div key={it.key} style={{ marginBottom: 14 }}>
                      <label style={{ display: 'block', fontSize: 13, color: '#191919', marginBottom: 5, lineHeight: 1.5 }}>
                        {it.label}
                        {it.required && <span style={{ color: '#b91c1c' }}> *</span>}
                      </label>
                      {it.helper && <p style={{ fontSize: 11.5, color: '#6b7280', margin: '0 0 5px' }}>{it.helper}</p>}

                      {it.type === 'display' && (
                        <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>Prefilled from the student record in a real send.</p>
                      )}
                      {(it.type === 'rating' || it.type === 'select') && (
                        <select style={input} value={answers[it.key] ?? ''} onChange={e => set(it.key, e.target.value)}>
                          <option value="">Select…</option>
                          {it.scale.map(s => {
                            const v = typeof s === 'object' ? s.value : s
                            const l = typeof s === 'object' ? `${s.value} · ${s.label}` : s
                            return <option key={String(v)} value={String(v)}>{l}</option>
                          })}
                        </select>
                      )}
                      {it.type === 'yesno' && (
                        <select style={input} value={answers[it.key] ?? ''} onChange={e => set(it.key, e.target.value)}>
                          <option value="">Select…</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      )}
                      {it.type === 'text' && (
                        <textarea rows={3} style={{ ...input, resize: 'vertical' }} value={answers[it.key] ?? ''} onChange={e => set(it.key, e.target.value)} />
                      )}
                    </div>
                  ))}
                </section>
              ))}

              {model.attestation && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#191919', marginBottom: 18 }}>
                  <input type="checkbox" checked={!!answers.__attestation} onChange={e => set('__attestation', e.target.checked ? 'yes' : '')} />
                  <span>{model.attestation.label}</span>
                </label>
              )}

              <button
                type="submit"
                style={{ padding: '12px 22px', background: NAVY, border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: F }}
              >
                Check this test response
              </button>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: '8px 0 0' }}>
                {countQuestions(model)} questions. This button validates locally. There is no
                submit endpoint in test mode and nothing is saved.
              </p>
            </form>
          )}

          {result && (
            <div
              role="status"
              style={{
                marginTop: 16, borderRadius: 10, padding: '12px 14px',
                background: result.missing.length ? '#fff1f2' : '#dcfce7',
                border: `1px solid ${result.missing.length ? '#fca5a5' : '#86efac'}`,
              }}
            >
              {result.missing.length > 0 ? (
                <>
                  <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: '#991b1b' }}>
                    {result.missing.length} required {result.missing.length === 1 ? 'question is' : 'questions are'} unanswered
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#991b1b' }}>
                    {result.missing.slice(0, 8).map(m => <li key={m}>{m}</li>)}
                  </ul>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: '#166534' }}>
                  <strong>Valid.</strong> A real response would be accepted. {result.answered} fields
                  were filled in, and none of them were saved.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: F }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '24px 26px', maxWidth: 420, boxShadow: '0 1px 3px rgba(25,25,25,0.08)' }}>
        {children}
      </div>
    </div>
  )
}
