import React, { useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'

// Owner/Admin-only detail view for a submitted Student Evaluation of Preceptor/Unit
// Experience response (slug/form_type: student_preceptor_eval). Renders the section-keyed
// JSONB payload. Isolated from EvaluationResponseDetail (Casey-Fink) and
// PreceptorResponseDetail (preceptor), neither of which is modified.
//
// Visibility is enforced two ways: the underlying data is gated by the is_owner_or_admin()
// RLS SELECT policy, and this component additionally refuses to render for any non-Owner/
// Admin role (defense in depth). The evaluated_target shown here comes from the response
// JSON (server-canonicalized at submit time).

const F = 'DM Sans, sans-serif'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function extractResponse(assignment) {
  const r = assignment?.evaluation_responses
  if (!r) return null
  if (Array.isArray(r)) return r[0] || null
  return r
}

function Field({ label, value, prewrap }) {
  return (
    <div style={{ padding: '11px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, fontFamily: F, marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 600, color: '#191919', fontFamily: F,
        whiteSpace: prewrap ? 'pre-wrap' : 'normal', lineHeight: prewrap ? 1.6 : 1.4,
      }}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  )
}

function SectionBlock({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.14em',
        textTransform: 'uppercase', marginBottom: 4, fontFamily: F,
        paddingBottom: 8, borderBottom: '2px solid #f3f4f6',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// Build a value→label resolver for a scale of [{ value, label }]. Falls back to the raw value.
function makeScaleLabel(scale) {
  const map = new Map((Array.isArray(scale) ? scale : []).map(o => [o.value, o.label]))
  return (v) => {
    if (v == null || v === '') return '—'
    const label = map.get(v)
    return label ? `${v} · ${label}` : String(v)
  }
}

export default function StudentEvalResponseDetail({ assignment, instrumentContent, isOpen, onClose }) {
  const { isOwner, isAdmin } = useAuth()
  const closeRef = useRef(null)
  const dialogId = 'student-eval-response-detail-dialog'

  useEffect(() => { if (isOpen && closeRef.current) closeRef.current.focus() }, [isOpen])
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen || !assignment) return null
  // Defense in depth: never render student survey responses for non-Owner/Admin.
  if (!(isOwner || isAdmin)) return null

  const response = extractResponse(assignment)
  const responses = response?.responses || {}
  const content = instrumentContent?.content ?? null
  const isLoading = instrumentContent === undefined || instrumentContent === null
  const isError = instrumentContent?.error === true

  const et   = responses.evaluated_target || {}
  const narr = responses.narrative || {}
  const att  = responses.attestation || {}

  const ratingLabel = makeScaleLabel(content?.ratingScale)
  const overallLabel = makeScaleLabel(content?.section4?.ratingItem?.overall_rating?.scale)

  // Likert domains, content-driven: [{ section node, response key }].
  const likertDomains = [content?.section1, content?.section2, content?.section3].filter(Boolean)

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        id={dialogId}
        role="dialog"
        aria-modal="true"
        className="modal modal-lg"
        style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0, alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#1D2567', fontFamily: F, lineHeight: 1.2 }}>
              {assignment.students?.first_name} {assignment.students?.last_name}
            </h2>
            <div style={{ fontSize: 12, color: '#6b7280', fontFamily: F, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontWeight: 500, color: '#374151' }}>Student Evaluation of Preceptor/Unit Experience</span>
              <span>·</span>
              <span>Submitted {fmtDate(response?.submitted_at)}</span>
            </div>
          </div>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close response detail" style={{ flexShrink: 0, marginTop: 2 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
          {isLoading && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13, fontFamily: F }}>
              Loading response detail…
            </div>
          )}
          {isError && (
            <div style={{ padding: '14px 16px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 13, color: '#dc2626', fontFamily: F }}>
              Unable to load response detail. Please refresh and try again.
            </div>
          )}

          {!isLoading && !isError && (
            <>
              {/* Evaluated target — the preceptor/unit this student evaluated (from response JSON) */}
              <SectionBlock title="Evaluated Preceptor / Unit">
                <Field label="Preceptor" value={et.preceptor_name} />
                <Field label="Unit / Area" value={et.unit} />
                {et.preceptor_id && (
                  <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, paddingTop: 6 }}>
                    Preceptor ID: {et.preceptor_id}
                  </div>
                )}
              </SectionBlock>

              {/* Likert domains (preceptor_support, learning_environment, psychological_safety) */}
              {likertDomains.map(sec => {
                const domainObj = responses[sec.key] || {}
                const items = sec.items || {}
                const commentKey = sec.commentKey
                return (
                  <SectionBlock key={sec.key} title={sec.title || sec.key}>
                    {Object.entries(items).map(([code, label]) => (
                      <Field key={code} label={label} value={ratingLabel(domainObj[code])} />
                    ))}
                    {commentKey && domainObj[commentKey] && (
                      <div style={{ fontSize: 12.5, color: '#4b5563', fontFamily: F, padding: '8px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                        {domainObj[commentKey]}
                      </div>
                    )}
                  </SectionBlock>
                )
              })}

              {/* Overall experience: 2 Likert items + overall_rating (own scale) */}
              {content?.section4 && (() => {
                const oe = responses.overall_experience || {}
                const items = content.section4.items || {}
                return (
                  <SectionBlock title={content.section4.title || 'Overall Experience'}>
                    {Object.entries(items).map(([code, label]) => (
                      <Field key={code} label={label} value={ratingLabel(oe[code])} />
                    ))}
                    <Field
                      label={content.section4.ratingItem?.overall_rating?.label || 'Overall rating'}
                      value={overallLabel(oe.overall_rating)}
                    />
                  </SectionBlock>
                )
              })()}

              {/* Narrative */}
              <SectionBlock title={content?.section5?.title || 'Comments'}>
                <Field label={content?.section5?.fields?.strengths?.label    || 'Strengths'}        value={narr.strengths} prewrap />
                <Field label={content?.section5?.fields?.suggestions?.label   || 'Suggestions'}      value={narr.suggestions} prewrap />
                <Field label={content?.section5?.fields?.open_comment?.label  || 'Additional comments'} value={narr.open_comment} prewrap />
              </SectionBlock>

              {/* Attestation */}
              <SectionBlock title="Attestation">
                <Field label={content?.attestation?.label || 'Confirmed'} value={att.attestation_confirmed === true ? 'Confirmed' : 'Not confirmed'} />
              </SectionBlock>
            </>
          )}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn-outline-modal" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
