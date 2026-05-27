import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { toLocalDateStr } from '../lib/designTokens'
import {
  DISPOSITION_TYPES,
  PRE_PLACEMENT_DISPOSITION_TYPES,
  REASON_CATEGORIES_BY_TYPE,
  FOLLOWUP_TYPES,
  AVAILABLE_FOLLOWUPS_BY_TYPE,
  DEFAULT_FOLLOWUPS_BY_TYPE,
} from '../lib/dispositions'

// Phase 2B.2a — standalone modal for recording pre-placement dispositions.
// Not yet wired into StudentSidePanel (Phase 2B.2b).
// Only renders for owner/admin; RPC enforces authorization server-side as well.

const labelStyle = {
  display: 'block',
  fontFamily: 'DM Sans',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text-secondary, #374151)',
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export default function DispositionModal({
  isOpen,
  onClose,
  student,
  cohort,
  onSuccess,
  toast,
}) {
  const { canEdit, isOwner, isAdmin, userProfile } = useAuth()

  const [selectedType,      setSelectedType]      = useState('')
  const [selectedReason,    setSelectedReason]    = useState('')
  const [effectiveDate,     setEffectiveDate]      = useState('')
  const [internalNote,      setInternalNote]       = useState('')
  const [selectedFollowups, setSelectedFollowups]  = useState([])
  const [submitting,        setSubmitting]         = useState(false)
  const [error,             setError]              = useState(null)

  const canSeePrivateNote = isOwner || isAdmin

  useEffect(() => {
    if (!isOpen) return
    setSelectedType('')
    setSelectedReason('')
    setEffectiveDate(toLocalDateStr(new Date()))
    setInternalNote('')
    setSelectedFollowups([])
    setError(null)
    setSubmitting(false)
  }, [isOpen])

  const handleTypeChange = (type) => {
    setSelectedType(type)
    setSelectedReason('')
    setSelectedFollowups(DEFAULT_FOLLOWUPS_BY_TYPE[type] || [])
    setError(null)
  }

  const toggleFollowup = (type) => {
    setSelectedFollowups(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }

  const handleSubmit = async () => {
    if (!selectedType)   { setError('Please select a disposition type.');   return }
    if (!selectedReason) { setError('Please select a reason category.');    return }
    if (selectedReason === 'other' && canSeePrivateNote && !internalNote.trim()) {
      setError('An internal note is required when the reason is "Other".')
      return
    }

    setError(null)
    setSubmitting(true)

    const rpcBuilder = supabase.rpc('record_student_disposition', {
      p_student_id:           student.id,
      p_cohort_id:            cohort.id,
      p_disposition_type:     selectedType,
      p_stage_at_disposition: 'post_interview',
      p_decision_origin:      'student_profile',
      p_reason_category:      selectedReason,
      p_decided_by_name:      userProfile?.full_name || '',
      p_effective_date:       effectiveDate,
      p_followup_types:       selectedFollowups,
      p_private_note:         canSeePrivateNote ? (internalNote.trim() || null) : null,
    })

    try {
      const result = await Promise.race([
        rpcBuilder,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Disposition RPC timed out before response')), 10000)
        ),
      ])

      if (result.error) {
        setError(result.error.message)
        toast?.error('Failed to record disposition', result.error.message)
        return
      }

      const dispositionId = result.data
      toast?.success('Disposition recorded', 'Student disposition has been recorded successfully.')
      onSuccess?.(dispositionId)
      onClose()
    } catch (err) {
      setError(err.message || 'Unable to record disposition.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen || !canEdit) return null

  const availableFollowups = AVAILABLE_FOLLOWUPS_BY_TYPE[selectedType] || []
  const reasonCategories   = selectedType ? REASON_CATEGORIES_BY_TYPE[selectedType] : null
  const canSubmit          = !!(selectedType && selectedReason && !submitting)

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        onMouseDown={e => e.stopPropagation()}
        style={{ maxWidth: 520, width: '90vw', maxHeight: '90vh', overflowY: 'auto' }}
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="modal-header">
          <h2 style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 18 }}>
            Update Program Disposition
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">

          {/* ── Student Context ─────────────────────────────────────────── */}
          <div style={{
            background: 'var(--surface-2, #f9fafb)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 20,
          }}>
            <div style={{
              fontFamily: 'DM Sans', fontWeight: 700, fontSize: 16,
              color: 'var(--text-primary, #111827)', marginBottom: 2,
            }}>
              {student?.first_name} {student?.last_name}
            </div>
            {(student?.school || student?.program_type) && (
              <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: 'var(--text-secondary, #6b7280)' }}>
                {[student.school, student.program_type].filter(Boolean).join(' · ')}
              </div>
            )}
            {cohort?.name && (
              <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: 'var(--text-tertiary, #9ca3af)', marginTop: 2 }}>
                {cohort.name}
              </div>
            )}
            {student?.status && (
              <div style={{ marginTop: 8 }}>
                <span style={{
                  fontFamily: 'DM Sans', fontSize: 11, fontWeight: 600,
                  padding: '2px 9px', borderRadius: 12,
                  background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d',
                  display: 'inline-block',
                }}>
                  {student.status}
                </span>
              </div>
            )}
          </div>

          {/* ── Disposition Type ─────────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Disposition Type <span style={{ color: '#ef4444', textTransform: 'none' }}>*</span>
            </label>
            <select
              className="form-select"
              value={selectedType}
              onChange={e => handleTypeChange(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Select disposition type…</option>
              {PRE_PLACEMENT_DISPOSITION_TYPES.map(type => (
                <option key={type} value={type}>{DISPOSITION_TYPES[type]}</option>
              ))}
            </select>
          </div>

          {/* ── Reason Category ──────────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Reason Category <span style={{ color: '#ef4444', textTransform: 'none' }}>*</span>
            </label>
            <select
              className="form-select"
              value={selectedReason}
              onChange={e => { setSelectedReason(e.target.value); setError(null) }}
              disabled={!selectedType}
              style={{ width: '100%', opacity: selectedType ? 1 : 0.45 }}
            >
              <option value="">Select reason…</option>
              {reasonCategories && Object.entries(reasonCategories).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          {/* ── Effective Date ───────────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Effective Date <span style={{ color: '#ef4444', textTransform: 'none' }}>*</span>
            </label>
            <input
              type="date"
              className="form-input"
              value={effectiveDate}
              onChange={e => setEffectiveDate(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* ── Follow-up Tasks ──────────────────────────────────────────── */}
          {selectedType && availableFollowups.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Follow-up Tasks</label>
              <div style={{
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                {availableFollowups.map((type, idx) => (
                  <label
                    key={type}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: idx < availableFollowups.length - 1
                        ? '1px solid var(--border, #e5e7eb)'
                        : 'none',
                      background: selectedFollowups.includes(type)
                        ? 'var(--surface-2, #f9fafb)'
                        : 'transparent',
                      fontFamily: 'DM Sans',
                      fontSize: 13,
                      color: 'var(--text-primary, #374151)',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFollowups.includes(type)}
                      onChange={() => toggleFollowup(type)}
                      style={{ accentColor: '#1d2567', width: 15, height: 15, flexShrink: 0 }}
                    />
                    {FOLLOWUP_TYPES[type]}
                  </label>
                ))}
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text-tertiary, #9ca3af)', marginTop: 5,
              }}>
                Follow-up tasks will be created as pending. Communications are not sent automatically.
              </div>
            </div>
          )}

          {/* ── Internal Note (Owner/Admin only) ─────────────────────────── */}
          {canSeePrivateNote && selectedType && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>
                Internal Note
                {selectedReason === 'other' && (
                  <span style={{ color: '#ef4444', textTransform: 'none' }}> *</span>
                )}
              </label>
              <textarea
                className="form-input"
                value={internalNote}
                onChange={e => setInternalNote(e.target.value)}
                placeholder="Add a private note about this disposition decision…"
                rows={3}
                maxLength={1000}
                style={{
                  width: '100%', resize: 'vertical',
                  fontFamily: 'DM Sans', fontSize: 13,
                  lineHeight: 1.5,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary, #9ca3af)', maxWidth: '75%' }}>
                  Visible only to Owner and Admin. Not shared with student, school, or other staff.
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary, #9ca3af)' }}>
                  {internalNote.length}/1000
                </div>
              </div>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {error && (
            <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>
          )}

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                border: '1px solid var(--border, #e5e7eb)',
                background: 'transparent',
                fontFamily: 'DM Sans',
                fontSize: 14,
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
                color: 'var(--text-secondary, #6b7280)',
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            >
              {submitting ? 'Recording…' : 'Confirm Disposition'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
