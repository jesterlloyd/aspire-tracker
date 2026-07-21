// ASPIRE-EVAL-PREVIEW-1: the survey definition preview.
//
// DISTINCT FROM THE EMAIL PREVIEW. AutomationEmailPreviewDrawer shows the invitation
// EMAIL a recipient would receive. This shows the SURVEY they would then fill in. Both
// use an eye icon in Review and Release, and they are labelled so an operator can tell
// them apart at a glance.
//
// READ ONLY BY CONSTRUCTION. This component performs exactly one network call, a GET to
// api/evaluation-instrument-content, and only for the three surveys whose prose lives in
// private Storage. It creates no assignment, no token, and no response; it cannot release,
// cannot email, cannot touch eligibility or certificate gating, and writes nothing at all.
// The one survey defined in code is rendered from that import with no request.
//
// The questions are never duplicated here. They are read from the same source the live
// survey renders from, so a change in Storage shows up in Preview immediately.

import { useEffect, useMemo, useState } from 'react'
import { X, Eye, Mail, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { surveyByKey, relationshipFor } from '../../lib/evaluation/surveyCatalog'
import { buildPreviewModel, countQuestions } from '../../lib/evaluation/surveyPreviewModel'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const TYPE_LABEL = {
  rating: 'Rating',
  text: 'Free text',
  select: 'Choice',
  yesno: 'Yes or no',
  display: 'Prefilled',
}

function Meta({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9ca3af' }}>{label}</div>
      <div style={{ fontSize: 12.5, color: '#191919', marginTop: 2, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  )
}

function Pill({ tone, children }) {
  const tones = {
    paused: { bg: '#fef3c7', fg: '#92400e' },
    gate: { bg: '#e0e7ff', fg: '#3730a3' },
    active: { bg: '#dcfce7', fg: '#166534' },
    neutral: { bg: '#f3f4f6', fg: '#374151' },
  }
  const t = tones[tone] || tones.neutral
  return (
    <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

/** One question row: order, text, type, required, and the scale labels when it has one. */
function ItemRow({ n, it }) {
  return (
    <li style={{ padding: '9px 0', borderTop: '1px solid #f3f4f6', listStyle: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: '#9ca3af', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{n}</span>
        <span style={{ fontSize: 13, color: '#191919', lineHeight: 1.5 }}>{it.label}</span>
      </div>
      {it.helper && (
        <div style={{ fontSize: 11.5, color: '#6b7280', margin: '3px 0 0 22px', lineHeight: 1.45 }}>{it.helper}</div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '5px 0 0 22px', alignItems: 'center' }}>
        <Pill tone="neutral">{TYPE_LABEL[it.type] || it.type}</Pill>
        <Pill tone={it.required ? 'gate' : 'neutral'}>{it.required ? 'Required' : 'Optional'}</Pill>
        {it.scale.length > 0 && (
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {it.scale.map(s => (typeof s === 'object' ? `${s.value} ${s.label}` : s)).join('  ·  ')}
          </span>
        )}
      </div>
    </li>
  )
}

export default function SurveyPreviewDrawer({ workflowKey, onClose }) {
  const survey = surveyByKey(workflowKey)

  // The in-code survey needs no request, so its model is DERIVED during render rather
  // than assigned from an effect (this repo forbids react-hooks/set-state-in-effect).
  const inlineModel = useMemo(
    () => (survey && survey.contentSource === 'inline' ? buildPreviewModel(survey.slug, null) : null),
    [survey])

  // Only the Storage-backed surveys need a fetch. `forSlug` records which slug the
  // response arrived for, so a slow response can never paint into a different survey.
  const [fetched, setFetched] = useState({ forSlug: null, model: null, error: '' })

  useEffect(() => {
    if (!survey || survey.contentSource === 'inline') return undefined
    let live = true
    ;(async () => {
      const fail = (error) => { if (live) setFetched({ forSlug: survey.slug, model: null, error }) }
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        if (!token) return fail('Please sign in again.')
        const res = await fetch(`/api/evaluation-instrument-content?slug=${encodeURIComponent(survey.slug)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!live) return undefined
        if (!res.ok) {
          return fail(res.status === 403
            ? 'You do not have permission to view this survey definition.'
            : 'The survey definition could not be loaded.')
        }
        const body = await res.json()
        if (!live) return undefined
        setFetched({ forSlug: survey.slug, model: buildPreviewModel(survey.slug, body?.content), error: '' })
      } catch {
        fail('The survey definition could not be loaded.')
      }
      return undefined
    })()
    return () => { live = false }
  }, [survey])

  // One derived status for the whole drawer.
  let status, model = null, error = ''
  if (!survey) {
    status = 'unsupported'
  } else if (survey.contentSource === 'inline') {
    status = inlineModel ? 'ready' : 'unsupported'
    model = inlineModel
  } else if (fetched.forSlug !== survey.slug) {
    status = 'loading'
  } else if (fetched.error) {
    status = 'error'
    error = fetched.error
  } else {
    status = fetched.model ? 'ready' : 'unsupported'
    model = fetched.model
  }

  if (!survey) return null
  const rel = relationshipFor(workflowKey)

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.42)', zIndex: 2998 }}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Survey preview: ${survey.title}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 620, zIndex: 2999,
          background: '#fff', boxShadow: '-8px 0 24px rgba(16,24,40,0.16)', display: 'flex',
          flexDirection: 'column', fontFamily: F,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid #f0ece3' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Eye size={15} color={NAVY} aria-hidden="true" />
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#191919' }}>Survey preview</h2>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#374151' }}>{survey.title}</p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close survey preview"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Identity and release facts, so the operator can confirm they are looking
              at the workflow they think they are. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Meta label="Workflow">{survey.label}</Meta>
            <Meta label="Workflow key"><code style={{ fontSize: 11.5 }}>{survey.key}</code></Meta>
            <Meta label="Survey slug"><code style={{ fontSize: 11.5 }}>{survey.slug}</code></Meta>
            <Meta label="Version">{survey.version || 'Not versioned'}</Meta>
            <Meta label="Status">
              <Pill tone={survey.status === 'paused' ? 'paused' : 'active'}>
                {survey.status === 'paused' ? 'Paused' : 'Active'}
              </Pill>
              {survey.certificateGate && <> <Pill tone="gate">Certificate gate</Pill></>}
            </Meta>
            <Meta label="Recipient">{survey.recipient}</Meta>
            <Meta label="Evaluated target">{survey.evaluatedTarget}</Meta>
            <Meta label="Response category"><code style={{ fontSize: 11.5 }}>{survey.formType}</code></Meta>
          </div>

          <div style={{ background: '#faf9f5', border: '1px solid #eee9df', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
            <Meta label="Trigger">{survey.trigger}</Meta>
          </div>

          {/* The shared-survey question, answered from the registry rather than asserted. */}
          <div style={{
            background: rel.kind === 'shared_survey' ? '#fef3c7' : '#f3f4f6',
            border: `1px solid ${rel.kind === 'shared_survey' ? '#fcd34d' : '#e5e7eb'}`,
            borderRadius: 10, padding: '10px 12px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#6b7280' }}>
              Relationship to other workflows
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#191919', lineHeight: 1.5 }}>{rel.note}</p>
            {rel.others.length > 0 && (
              <table style={{ width: '100%', marginTop: 9, borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                    <th style={{ padding: '4px 6px 4px 0', fontWeight: 600 }}>Workflow</th>
                    <th style={{ padding: '4px 6px', fontWeight: 600 }}>Survey</th>
                    <th style={{ padding: '4px 6px', fontWeight: 600 }}>Recipient</th>
                    <th style={{ padding: '4px 6px', fontWeight: 600 }}>Target</th>
                    <th style={{ padding: '4px 0 4px 6px', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[survey, ...rel.others].map(s => (
                    <tr key={s.key} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '5px 6px 5px 0', fontWeight: s.key === survey.key ? 700 : 400 }}>{s.label}</td>
                      <td style={{ padding: '5px 6px' }}><code style={{ fontSize: 11 }}>{s.slug}</code></td>
                      <td style={{ padding: '5px 6px' }}>{s.recipient}</td>
                      <td style={{ padding: '5px 6px' }}>{s.evaluatedTarget}</td>
                      <td style={{ padding: '5px 0 5px 6px' }}>{s.status === 'paused' ? 'Paused' : 'Active'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {status === 'loading' && (
            <p role="status" style={{ fontSize: 13, color: '#9ca3af' }}>Loading the survey definition…</p>
          )}

          {status === 'error' && (
            <div role="alert" style={{ display: 'flex', gap: 8, background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 12px' }}>
              <AlertTriangle size={16} color="#991b1b" aria-hidden="true" />
              <p style={{ margin: 0, fontSize: 12.5, color: '#991b1b' }}>{error}</p>
            </div>
          )}

          {/* An explicit unsupported state rather than an empty drawer, so a future
              workflow with an unrecognized shape says so instead of looking empty. */}
          {status === 'unsupported' && (
            <div style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ margin: 0, fontSize: 12.5, color: '#374151' }}>
                A question-by-question preview is not available for this survey definition yet.
                The workflow details above are accurate.
              </p>
            </div>
          )}

          {status === 'ready' && model && (
            <>
              {model.notes.map((n, i) => (
                <p key={i} style={{ fontSize: 11.5, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 10px', margin: '0 0 12px' }}>{n}</p>
              ))}

              {model.intro && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4 }}>
                    Introduction shown to the recipient
                  </div>
                  {model.intro.heading && <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#191919' }}>{model.intro.heading}</p>}
                  {model.intro.body && <p style={{ margin: 0, fontSize: 12.5, color: '#374151', lineHeight: 1.6 }}>{model.intro.body}</p>}
                  {model.intro.compliance_note && <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>{model.intro.compliance_note}</p>}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#191919' }}>Questions</h3>
                <span style={{ fontSize: 11.5, color: '#6b7280' }}>
                  {countQuestions(model)} in {model.sections.length} sections, in order
                </span>
              </div>

              {model.sections.map(sec => (
                <section key={sec.key} style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{sec.title || sec.key}</div>
                  {sec.instructions && (
                    <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>{sec.instructions}</p>
                  )}
                  <ul style={{ margin: '6px 0 0', padding: 0 }}>
                    {sec.items.map((it, i) => <ItemRow key={it.key} n={i + 1} it={it} />)}
                  </ul>
                </section>
              ))}

              {model.attestation && (
                <section style={{ marginTop: 14, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>Attestation</div>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#191919', lineHeight: 1.5 }}>{model.attestation.label}</p>
                  <div style={{ marginTop: 5 }}><Pill tone={model.attestation.required ? 'gate' : 'neutral'}>{model.attestation.required ? 'Required' : 'Optional'}</Pill></div>
                </section>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderTop: '1px solid #f0ece3', color: '#6b7280', fontSize: 11.5 }}>
          <Mail size={13} aria-hidden="true" />
          This preview is read only. Nothing is sent, released, or recorded.
        </div>
      </aside>
    </>
  )
}
