import React, { useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'

// Owner/Admin-only detail view for a submitted Preceptor Student Progress & Readiness
// Feedback response. Renders the section-keyed JSONB payload, INCLUDING the confidential
// ASPIRE-team comments. Visibility is enforced two ways: the underlying data is gated by
// the is_owner_or_admin() RLS SELECT policy, and this component additionally refuses to
// render for any non-Owner/Admin role (defense in depth). No student-facing surface.

const F = 'DM Sans, sans-serif'

const PERIOD_LABELS = {
  midpoint: 'Midpoint',
  end_of_rotation: 'End of Rotation',
  other_interim: 'Other / Interim Check-In',
}

const COMPETENCY_ORDER = [
  'clinical_judgment',
  'patient_centered_care',
  'safety_quality',
  'teamwork_communication_collaboration',
  'professionalism_accountability',
  'advanced_beginner_readiness',
]

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

export default function PreceptorResponseDetail({ assignment, instrumentContent, isOpen, onClose }) {
  const { isOwner, isAdmin } = useAuth()
  const closeRef = useRef(null)
  const dialogId = 'preceptor-response-detail-dialog'

  useEffect(() => { if (isOpen && closeRef.current) closeRef.current.focus() }, [isOpen])
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen || !assignment) return null
  // Defense in depth: never render preceptor feedback for non-Owner/Admin.
  if (!(isOwner || isAdmin)) return null

  const response = extractResponse(assignment)
  const responses = response?.responses || {}
  const content = instrumentContent?.content ?? null
  const isLoading = instrumentContent === undefined || instrumentContent === null
  const isError = instrumentContent?.error === true

  const df = responses.developmental_feedback || {}
  const ctx = df.context || {}
  const comp = df.competency || {}
  const narr = df.narrative || {}
  const re = responses.readiness_endorsement || {}
  const ctc = responses.confidential_team_comments || {}

  const ratingScale = content?.ratingScale || []
  const ratingLabel = (n) => (Number.isInteger(n) && n >= 1 && n <= ratingScale.length) ? `${n} · ${ratingScale[n - 1]}` : (n ?? '—')
  const periodLabel = PERIOD_LABELS[ctx.feedback_period] || ctx.feedback_period || '—'

  const compLabel = (code) => content?.section2?.items?.[code]?.label || code

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
              <span style={{ fontWeight: 500, color: '#374151' }}>Preceptor Student Readiness Assessment</span>
              <span>·</span>
              <span>{periodLabel}</span>
              <span>·</span>
              <span>Submitted {fmtDate(response?.submitted_at)}</span>
            </div>
            {assignment.respondent_name && (
              <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, marginTop: 3 }}>
                Preceptor: {assignment.respondent_name}
              </div>
            )}
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
              <SectionBlock title="Context">
                <Field label="Feedback period" value={periodLabel} />
                {ctx.shifts_observed && <Field label="Shifts observed" value={ctx.shifts_observed} />}
              </SectionBlock>

              <SectionBlock title="Clinical Progress and Competency">
                {COMPETENCY_ORDER.map(code => {
                  const item = comp[code] || {}
                  return (
                    <div key={code} style={{ marginBottom: 12 }}>
                      <Field label={compLabel(code)} value={ratingLabel(item.rating)} />
                      {item.comment && (
                        <div style={{ fontSize: 12.5, color: '#4b5563', fontFamily: F, padding: '6px 0 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                          {item.comment}
                        </div>
                      )}
                    </div>
                  )
                })}
              </SectionBlock>

              <SectionBlock title="Narrative Feedback">
                <Field label="Strengths observed" value={narr.strengths_observed} prewrap />
                <Field label="Areas for development or coaching" value={narr.areas_for_development} prewrap />
                <Field label="Suggested support plan" value={narr.suggested_support_plan} prewrap />
              </SectionBlock>

              <SectionBlock title="Readiness and Endorsement">
                <Field label="Transition readiness" value={re.transition_readiness} />
                <Field label="Unit endorsement (for consideration)" value={re.unit_endorsement_consideration} />
                <Field label="Endorsement explanation" value={re.endorsement_explanation} prewrap />
                <Field label="Cedars-Sinai consideration recommendation" value={re.cedars_consideration_recommendation} />
                <Field label="Best-fit environment" value={re.best_fit_environment} prewrap />
              </SectionBlock>

              <SectionBlock title="Confidential ASPIRE Team Comments">
                <div style={{
                  fontSize: 11, color: '#92400e', background: '#FBF5E8', border: '1px solid #f0e0c0',
                  borderRadius: 6, padding: '6px 10px', marginBottom: 10, fontFamily: F,
                }}>
                  Confidential — visible to Owner/Admin only. Not shared with the student.
                </div>
                <Field label="Confidential comments" value={ctc.confidential_comments} prewrap />
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
