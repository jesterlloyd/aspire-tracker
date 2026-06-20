import React, { useEffect, useRef } from 'react'

const F = 'DM Sans, sans-serif'

// ── Display constants ─────────────────────────────────────────────────────────

const TIMEPOINT_LABELS = {
  baseline:                'Baseline',
  early_rotation_baseline: 'Baseline',
  mid_rotation:            'Mid-Rotation Check-In',
  post_rotation:           'Post-Rotation',
}

// Mirror of STATUS_CONFIG in EvaluationTab.jsx — inline so this component
// has no cross-file dependency on EvaluationTab internals.
const STATUS_CONFIG = {
  completed:    { bg: '#EDF2E2', text: '#166534', border: '#c6d9a8', label: 'Completed'    },
  opened:       { bg: '#DCEFF8', text: '#1D2567', border: '#9dd6f2', label: 'Opened'       },
  sent:         { bg: '#f3f4f6', text: '#374151', border: '#d1d5db', label: 'Sent'         },
  expired:      { bg: '#FCE9DA', text: '#583733', border: '#f0c9b0', label: 'Expired'      },
  revoked:      { bg: '#e5e7eb', text: '#6b7280', border: '#d1d5db', label: 'Revoked'      },
  draft:        { bg: '#f9fafb', text: '#9ca3af', border: '#e5e7eb', label: 'Draft'        },
}

// ── Item code lists ───────────────────────────────────────────────────────────

const S2_CODES = ['S2_Q01', 'S2_Q02', 'S2_Q03', 'S2_Q04']

const S3_CODES = [
  'S3_Q01','S3_Q02','S3_Q03','S3_Q04','S3_Q05','S3_Q06','S3_Q07','S3_Q08','S3_Q09',
  'S3_Q10','S3_Q11','S3_Q12','S3_Q13','S3_Q14','S3_Q15','S3_Q16','S3_Q17','S3_Q18',
  'S3_Q19','S3_Q20','S3_Q21','S3_Q22','S3_Q23','S3_Q24','S3_Q25','S3_Q26','S3_Q27',
  'S3_Q28','S3_Q29','S3_Q30','S3_Q31',
]

const S4_CODES = [
  'S4_Q01','S4_Q02','S4_Q03','S4_Q04','S4_Q05',
  'S4_Q06','S4_Q07','S4_Q08','S4_Q09','S4_Q10',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mirror of effectiveStatus in EvaluationTab.jsx — render-time projection only
function effectiveStatus(assignment) {
  if (
    (assignment.status === 'sent' || assignment.status === 'opened') &&
    assignment.expires_at &&
    new Date(assignment.expires_at) < new Date()
  ) {
    return 'expired'
  }
  return assignment.status
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Safely extracts the embedded evaluation_responses row (handles array or object shape)
function extractResponse(assignment) {
  const r = assignment.evaluation_responses
  if (!r) return null
  if (Array.isArray(r)) return r[0] || null
  return r
}

// ── Label resolution helpers ──────────────────────────────────────────────────
// Lookup patterns mirror EvaluationPage.jsx exactly:
//   items  → keyed object: content.items[code] → text string
//   anchors → keyed by section, 0-indexed array: content.responseAnchors.s2[value-1]
//   demographics → keyed object: content.demographicQuestions[code].label for question text;
//                  stored value IS the answer (option string or free text/number)

// Resolves item text for any S1/S2/S3 code. Falls back to the code itself.
function resolveItemText(code, content) {
  return content?.items?.[code] || code
}

// Resolves the anchor label for a given code + 1-indexed integer response value.
// Section is inferred from the code prefix; anchors are 0-indexed per-section arrays.
function resolveAnchorLabel(code, responseValue, content) {
  if (responseValue == null) return '—'
  let section
  if      (code.startsWith('S1_')) section = 's1'
  else if (code.startsWith('S2_')) section = 's2'
  else if (code.startsWith('S3_')) section = 's3'
  else return String(responseValue)
  const anchors = content?.responseAnchors?.[section]
  if (!Array.isArray(anchors) || anchors.length === 0) return String(responseValue)
  return anchors[responseValue - 1] ?? String(responseValue)
}

// Resolves the question label for a Section IV item code.
function resolveDemographicLabel(code, content) {
  return content?.demographicQuestions?.[code]?.label || code
}

// Resolves the display value for a Section IV response.
// For 'select' type items the stored value is the option string.
// For 'text' and 'number' types the stored value is the answer directly.
function resolveDemographicValue(responseValue) {
  if (responseValue == null || responseValue === '') return '—'
  return String(responseValue)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ItemRow({ label, value }) {
  return (
    <div style={{
      padding: '11px 0',
      borderBottom: '1px solid #f3f4f6',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, fontFamily: F }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#191919', fontFamily: F }}>
        {value}
      </div>
    </div>
  )
}

function SectionBlock({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#9ca3af',
        letterSpacing: '0.14em', textTransform: 'uppercase',
        marginBottom: 4, fontFamily: F,
        paddingBottom: 8, borderBottom: '2px solid #f3f4f6',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * EvaluationResponseDetail
 *
 * Props:
 *   assignment       — full assignment row from EvaluationTab (with embedded
 *                      evaluation_responses including the responses JSONB column)
 *   instrumentContent — { content: {...} } on success, { error: true } on failure,
 *                       undefined while loading
 *   isOpen           — boolean
 *   onClose          — callback
 */
export default function EvaluationResponseDetail({ assignment, instrumentContent, isOpen, onClose }) {
  const closeRef = useRef(null)
  const dialogId = 'eval-response-detail-dialog'
  const titleId  = 'eval-detail-title'

  // Focus close button when modal opens
  useEffect(() => {
    if (isOpen && closeRef.current) {
      closeRef.current.focus()
    }
  }, [isOpen])

  // Escape key dismissal
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Focus trap: cycle through focusable elements within the dialog
  useEffect(() => {
    if (!isOpen) return
    const dialog = document.getElementById(dialogId)
    if (!dialog) return
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getNodes = () => Array.from(dialog.querySelectorAll(sel))
    const handler = (e) => {
      if (e.key !== 'Tab') return
      const nodes = getNodes()
      if (!nodes.length) return
      const first = nodes[0]
      const last  = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  if (!isOpen || !assignment) return null

  const response   = extractResponse(assignment)
  const responses  = response?.responses || {}
  const es         = effectiveStatus(assignment)
  const statusCfg  = STATUS_CONFIG[es] || STATUS_CONFIG.draft
  const cps        = response?.score_s1_clinical_problem_solving
  const la         = response?.score_s1_learning_activities
  const pr         = response?.score_s1_practice_readiness

  const content    = instrumentContent?.content ?? null
  const isLoading  = instrumentContent === undefined || instrumentContent === null
  const isError    = instrumentContent?.error === true

  // Section titles from Storage JSON when available; generic labels as fallback.
  // No Casey-Fink section title is hardcoded anywhere in this source file.
  const s1Title = content?.sectionTitles?.s1 || 'Section I'
  const s2Title = content?.sectionTitles?.s2 || 'Section II'
  const s3Title = content?.sectionTitles?.s3 || 'Section III'
  const s4Title = content?.sectionTitles?.s4 || 'Section IV'

  const commentLabel = content?.optionalCommentLabel || 'Additional Comments'
  const commentValue = typeof responses?.S4_COMMENT === 'string'
    ? responses.S4_COMMENT.trim()
    : null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal modal-lg"
        style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}
        onMouseDown={e => e.stopPropagation()}
      >

        {/* ── Header (sticky) ── */}
        <div className="modal-header" style={{ flexShrink: 0, alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2
                id={titleId}
                style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1D2567', fontFamily: F, lineHeight: 1.2 }}
              >
                {assignment.students?.first_name} {assignment.students?.last_name}
              </h2>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9,
                background: statusCfg.bg, color: statusCfg.text, border: `1px solid ${statusCfg.border}`,
                fontFamily: F, letterSpacing: 0.1, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {statusCfg.label}
              </span>
            </div>
            <div style={{
              fontSize: 12, color: '#6b7280', fontFamily: F,
              display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 500, color: '#374151' }}>
                {assignment.evaluation_instruments?.display_name || '—'}
              </span>
              <span>·</span>
              <span>{TIMEPOINT_LABELS[assignment.timepoint] || assignment.timepoint}</span>
              <span>·</span>
              <span>Submitted {fmtDate(response?.submitted_at)}</span>
            </div>
          </div>
          <button
            ref={closeRef}
            className="modal-close"
            onClick={onClose}
            aria-label="Close response detail"
            style={{ flexShrink: 0, marginTop: 2 }}
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>

          {/* Section I — subscale means (no instrument content required) */}
          <SectionBlock title={s1Title}>
            {[
              ['Clinical Problem-Solving (CPS)', cps],
              ['Learning Activities (LA)',        la],
              ['Practice Readiness (PR)',         pr],
            ].map(([lbl, val]) => (
              <div
                key={lbl}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0', borderBottom: '1px solid #f3f4f6', fontFamily: F,
                }}
              >
                <span style={{ fontSize: 13, color: '#374151' }}>{lbl}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: '#0E1428',
                    fontVariantNumeric: 'tabular-nums', fontFamily: F,
                  }}>
                    {val != null ? Number(val).toFixed(2) : '—'}
                  </span>
                  {val != null && (
                    <div style={{
                      width: 60, height: 3, background: 'rgba(29,37,103,0.08)',
                      borderRadius: 2, overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, Math.round(((Number(val) - 1) / 3) * 100)))}%`,
                        background: 'rgba(29,37,103,0.28)', borderRadius: 2,
                      }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </SectionBlock>

          {/* Sections II–IV and comment require instrument content */}

          {isLoading && (
            <div style={{
              padding: '32px 0', textAlign: 'center',
              color: '#9ca3af', fontSize: 13, fontFamily: F,
            }}>
              Loading response detail…
            </div>
          )}

          {isError && (
            <div style={{
              padding: '14px 16px',
              background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca',
              fontSize: 13, color: '#dc2626', fontFamily: F,
            }}>
              Unable to load response detail. Please refresh and try again.
            </div>
          )}

          {!isLoading && !isError && content && (
            <>
              {/* Section II */}
              <SectionBlock title={s2Title}>
                {S2_CODES.map(code => (
                  <ItemRow
                    key={code}
                    label={resolveItemText(code, content)}
                    value={resolveAnchorLabel(code, responses[code], content)}
                  />
                ))}
              </SectionBlock>

              {/* Section III */}
              <SectionBlock title={s3Title}>
                {S3_CODES.map(code => (
                  <ItemRow
                    key={code}
                    label={resolveItemText(code, content)}
                    value={resolveAnchorLabel(code, responses[code], content)}
                  />
                ))}
              </SectionBlock>

              {/* Section IV */}
              <SectionBlock title={s4Title}>
                {S4_CODES.map(code => (
                  <ItemRow
                    key={code}
                    label={resolveDemographicLabel(code, content)}
                    value={resolveDemographicValue(responses[code])}
                  />
                ))}
              </SectionBlock>

              {/* Optional comment — only if present and non-empty */}
              {commentValue && (
                <SectionBlock title={commentLabel}>
                  <p style={{
                    margin: 0, fontSize: 13, color: '#374151',
                    lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: F,
                  }}>
                    {commentValue}
                  </p>
                </SectionBlock>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn-outline-modal" onClick={onClose}>
            Close
          </button>
        </div>

      </div>
    </div>
  )
}
