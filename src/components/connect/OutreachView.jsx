import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const F = 'DM Sans, sans-serif'

const INSTRUMENTS = [
  { slug: 'casey_fink_readiness_2024', label: 'Casey-Fink Readiness for Practice Survey, 2024' },
]

const TIMEPOINTS = [
  { value: 'baseline',               label: 'Baseline' },
  { value: 'early_rotation_baseline', label: 'Early-Rotation Baseline' },
  { value: 'midpoint',               label: 'Mid-Rotation Check-In' },
  { value: 'post_rotation',          label: 'Post-Rotation' },
]

function defaultExpiresAt() {
  const d = new Date()
  d.setDate(d.getDate() + 28)
  return d.toISOString().split('T')[0]
}

function minExpiresAt() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: '#374151', marginBottom: 6, fontFamily: F,
}

const inputBase = {
  width: '100%', padding: '10px 13px',
  border: '1.5px solid #e5e7eb', borderRadius: 8,
  fontSize: 13, fontFamily: F, color: '#191919',
  background: '#fff', outline: 'none', boxSizing: 'border-box',
}

const fieldWrap = { marginBottom: 18 }

const railPanel = {
  background: 'var(--bg-card,#FAFAF7)',
  border: '1px solid var(--border-divider,rgba(29,37,103,0.08))',
  borderRadius: 12,
  padding: '18px 16px',
  fontFamily: F,
}

const railHeading = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.13em',
  marginBottom: 10, fontFamily: F,
}

const railBody = {
  fontSize: 12, color: '#9ca3af', lineHeight: 1.65,
  margin: 0, fontFamily: F,
}

export default function OutreachView({ cohortId, onNavigateToStudent }) {
  const [students,          setStudents]          = useState([])
  const [loadingStudents,   setLoadingStudents]   = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [instrument,        setInstrument]        = useState('casey_fink_readiness_2024')
  const [timepoint,         setTimepoint]         = useState('early_rotation_baseline')
  const [expiresAt,         setExpiresAt]         = useState(defaultExpiresAt)
  const [notes,             setNotes]             = useState('')
  const [duplicateExists,   setDuplicateExists]   = useState(false)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  // ── Generate Link state ───────────────────────────────────────────────────
  const [generating,    setGenerating]    = useState(false)
  const [generateError, setGenerateError] = useState(null)
  // surveyResult holds the returned payload — surveyUrl, assignmentId, expiresAt, student.
  // Never persisted to localStorage/sessionStorage. Cleared on form field changes.
  const [surveyResult,  setSurveyResult]  = useState(null)
  const [copied,        setCopied]        = useState(false)

  // ── Fetch students ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cohortId) return
    setLoadingStudents(true)
    supabase
      .from('students')
      .select('id, first_name, last_name, school, school_email, personal_email')
      .eq('cohort_id', cohortId)
      .order('last_name')
      .order('first_name')
      .then(({ data }) => {
        setStudents(data || [])
        setLoadingStudents(false)
      })
  }, [cohortId])

  // ── Duplicate guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedStudentId || !timepoint || !cohortId) {
      setDuplicateExists(false)
      return
    }
    setCheckingDuplicate(true)
    supabase
      .from('evaluation_assignments')
      .select('id')
      .eq('student_id', selectedStudentId)
      .eq('cohort_id', cohortId)
      .eq('timepoint', timepoint)
      .not('status', 'in', '(revoked,expired)')
      .limit(1)
      .then(({ data }) => {
        setDuplicateExists(!!(data && data.length > 0))
        setCheckingDuplicate(false)
      })
  }, [selectedStudentId, timepoint, cohortId])

  // ── Clear generated link when form identity changes ───────────────────────
  // Raw survey URL must not persist if the recipient, instrument, or timepoint change.
  useEffect(() => {
    setSurveyResult(null)
    setGenerateError(null)
    setCopied(false)
  }, [selectedStudentId, instrument, timepoint])

  // ── Derived values ────────────────────────────────────────────────────────
  const selectedStudent  = students.find(s => s.id === selectedStudentId) || null
  const resolvedEmail    = selectedStudent
    ? (selectedStudent.personal_email || selectedStudent.school_email || null)
    : null
  const emailSource      = selectedStudent
    ? (selectedStudent.personal_email
        ? 'personal email'
        : selectedStudent.school_email ? 'school email' : null)
    : null
  const firstName        = selectedStudent?.first_name || null
  const instrumentLabel  = INSTRUMENTS.find(i => i.slug === instrument)?.label || ''
  const expiresFormatted = fmtDate(expiresAt)

  const formValid = !!(selectedStudentId && instrument && timepoint)

  // ── Generate Link handler ─────────────────────────────────────────────────
  const handleGenerateLink = useCallback(async () => {
    if (!formValid || generating) return
    setGenerating(true)
    setGenerateError(null)
    setSurveyResult(null)
    setCopied(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setGenerateError('Session expired. Please refresh and try again.')
        return
      }

      const res = await fetch('/api/evaluation-create-invitation', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          studentId:  selectedStudentId,
          cohortId,
          timepoint,
          expiresAt,
          notes: notes.trim() || undefined,
        }),
      })

      // Parse JSON separately — if the server crashed before the handler ran
      // (e.g., missing env var), Vercel returns an HTML error page, not JSON.
      // Parsing that HTML as JSON throws, which would otherwise reach the catch
      // block and show the misleading "Network error" message.
      let payload = null
      try {
        payload = await res.json()
      } catch {
        // Non-JSON response — Vercel-level crash (likely missing env var in Production).
        setGenerateError(
          `Server error (HTTP ${res.status}). Check Vercel function logs for api/evaluation-create-invitation. Likely cause: missing Production environment variable.`
        )
        return
      }

      if (res.status === 409) {
        setGenerateError(
          payload?.error ||
          'An active invitation already exists for this student and timepoint. Review in the Evaluation tab.'
        )
        return
      }
      if (!res.ok) {
        setGenerateError(payload?.error || 'Failed to generate link. Please try again.')
        return
      }

      // Store returned payload in React state only.
      // Raw survey URL is never logged or persisted beyond this state variable.
      setSurveyResult(payload)
    } catch (err) {
      setGenerateError('Network error. Please check your connection and try again.')
    } finally {
      setGenerating(false)
    }
  }, [formValid, generating, selectedStudentId, cohortId, timepoint, expiresAt, notes])

  // ── Copy Link handler ─────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!surveyResult?.surveyUrl) return
    try {
      await navigator.clipboard.writeText(surveyResult.surveyUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard API unavailable — link is still selectable in the display field.
      setCopied(false)
    }
  }, [surveyResult])

  return (
    <div style={{ padding: '20px 24px', fontFamily: F }}>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* ── Zone 1: Recipient Context ─────────────────────────────────── */}
        <div style={{ ...railPanel, flex: '0 0 196px', minWidth: 160 }}>
          <div style={railHeading}>Survey Invitation Recipients</div>
          <p style={railBody}>
            Single-student selection is supported in this release. Recipient segments and saved groups will appear here in a future release.
          </p>
        </div>

        {/* ── Zone 2: Compose ───────────────────────────────────────────── */}
        <div style={{ flex: '2 1 320px', minWidth: 0 }}>

          {/* Template indicator */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 6,
                background: '#EDF5F4', color: '#275E63', border: '1px solid #c9e8e6',
                letterSpacing: 0.3, fontFamily: F,
              }}>
                Survey Invitation
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280', fontFamily: F }}>
              Send a pre-rotation readiness survey to a single student.
            </p>
          </div>

          {/* Field 1 — Recipient */}
          <div style={fieldWrap}>
            <label style={labelStyle}>
              Recipient <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
            </label>
            <select
              value={selectedStudentId}
              onChange={e => setSelectedStudentId(e.target.value)}
              style={inputBase}
            >
              <option value="">
                {loadingStudents ? 'Loading students…' : 'Select a student'}
              </option>
              {students.map(s => (
                <option key={s.id} value={s.id}>
                  {s.first_name} {s.last_name}{s.school ? ` — ${s.school}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Field 2 — Delivery email */}
          {selectedStudent && (
            <div style={fieldWrap}>
              <label style={labelStyle}>Delivery email</label>
              {resolvedEmail ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{
                    flex: 1, padding: '10px 13px',
                    background: '#f9fafb', border: '1.5px solid #e5e7eb',
                    borderRadius: 8, fontSize: 13, color: '#374151', fontFamily: F,
                  }}>
                    {resolvedEmail}
                  </div>
                  {emailSource && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px',
                      borderRadius: 5, background: '#f3f4f6', color: '#6b7280',
                      border: '1px solid #e5e7eb', whiteSpace: 'nowrap', fontFamily: F,
                    }}>
                      {emailSource}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{
                  padding: '10px 13px', background: '#fef2f2',
                  border: '1.5px solid #fecaca', borderRadius: 8,
                  fontSize: 12, color: '#dc2626', fontFamily: F, lineHeight: 1.5,
                }}>
                  No email address on file for this student.{' '}
                  {onNavigateToStudent
                    ? (
                      <button
                        onClick={() => onNavigateToStudent(selectedStudentId)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 12, color: '#dc2626', fontFamily: F,
                          fontWeight: 600, padding: 0,
                          textDecoration: 'underline', textUnderlineOffset: 2,
                        }}
                      >
                        Update student profile →
                      </button>
                    )
                    : 'Update the student profile before sending.'
                  }
                </div>
              )}
            </div>
          )}

          {/* Field 3 — Instrument */}
          <div style={fieldWrap}>
            <label style={labelStyle}>
              Instrument <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
            </label>
            <select
              value={instrument}
              onChange={e => setInstrument(e.target.value)}
              style={inputBase}
            >
              {INSTRUMENTS.map(i => (
                <option key={i.slug} value={i.slug}>{i.label}</option>
              ))}
            </select>
          </div>

          {/* Field 4 — Timepoint */}
          <div style={fieldWrap}>
            <label style={labelStyle}>
              Timepoint <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
            </label>
            <select
              value={timepoint}
              onChange={e => setTimepoint(e.target.value)}
              style={inputBase}
            >
              {TIMEPOINTS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Field 5 — Expires at */}
          <div style={fieldWrap}>
            <label style={labelStyle}>
              Expires <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              min={minExpiresAt()}
              onChange={e => setExpiresAt(e.target.value)}
              style={inputBase}
            />
          </div>

          {/* Field 6 — Notes */}
          <div style={fieldWrap}>
            <label style={labelStyle}>
              Notes{' '}
              <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 500))}
              placeholder="Optional message or context for this invitation."
              rows={3}
              style={{ ...inputBase, resize: 'vertical', lineHeight: 1.5, minHeight: 74 }}
            />
            <div style={{
              fontSize: 11, color: notes.length > 480 ? '#dc2626' : '#9ca3af',
              textAlign: 'right', marginTop: 4, fontFamily: F,
            }}>
              {notes.length}/500
            </div>
          </div>

          {/* Duplicate guard */}
          {selectedStudentId && timepoint && !checkingDuplicate && duplicateExists && (
            <div style={{
              padding: '11px 14px', marginBottom: 18,
              background: '#FBF5E8', border: '1px solid #f0c9b0',
              borderRadius: 8, fontSize: 12, color: '#8B5E1A',
              fontFamily: F, lineHeight: 1.6,
            }}>
              An assignment for this student and timepoint already exists. Review in the Evaluation tab before sending a new invitation.
            </div>
          )}

          {/* Error state */}
          {generateError && (
            <div style={{
              padding: '11px 14px', marginBottom: 18,
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 8, fontSize: 12, color: '#dc2626',
              fontFamily: F, lineHeight: 1.6,
            }}>
              {generateError}
            </div>
          )}

          {/* Action bar */}
          <div style={{ paddingTop: 4 }}>
            <button
              onClick={handleGenerateLink}
              disabled={!formValid || generating}
              style={{
                padding: '9px 20px',
                background: formValid && !generating ? 'var(--color-accent-primary,#1D2567)' : '#e5e7eb',
                border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: F,
                color: formValid && !generating ? '#fff' : '#9ca3af',
                cursor: formValid && !generating ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              {generating ? 'Generating…' : 'Generate Link'}
            </button>
            {!formValid && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', fontFamily: F, lineHeight: 1.5 }}>
                Select a student, instrument, and timepoint to generate a link.
              </div>
            )}
          </div>
        </div>

        {/* ── Zone 3: Message Preview + Generated Link ──────────────────── */}
        <div style={{ flex: '2 1 260px', minWidth: 0 }}>

          {/* Message preview — always visible so Owner can see full message context */}
          <div style={{
            background: '#fff', borderRadius: 12,
            border: surveyResult
              ? '1px solid rgba(29,37,103,0.16)'
              : '1px solid rgba(29,37,103,0.10)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
            overflow: 'hidden',
          }}>
            {/* Subject */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#9ca3af',
                letterSpacing: '0.13em', textTransform: 'uppercase',
                marginBottom: 6, fontFamily: F,
              }}>
                Subject
              </div>
              <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.5 }}>
                ASPIRE Program: Your Pre-Rotation Readiness Survey is ready
              </div>
            </div>

            {/* Message body */}
            <div style={{ padding: '14px 18px' }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#9ca3af',
                letterSpacing: '0.13em', textTransform: 'uppercase',
                marginBottom: 12, fontFamily: F,
              }}>
                Message preview
              </div>
              <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.8 }}>
                <p style={{ margin: '0 0 12px' }}>
                  Dear{' '}
                  {firstName
                    ? <strong>{firstName}</strong>
                    : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>[Student first name]</span>
                  },
                </p>
                <p style={{ margin: '0 0 12px' }}>
                  You are invited to complete the <em>{instrumentLabel}</em> as part of your participation in the ASPIRE Program.
                </p>
                {notes.trim() && (
                  <p style={{ margin: '0 0 12px' }}>{notes.trim()}</p>
                )}
                <p style={{ margin: '0 0 12px' }}>
                  Click the link below to begin. This survey expires on <strong>{expiresFormatted}</strong>.
                </p>

                {/* Survey link position — placeholder before generation, real URL after */}
                <p style={{ margin: '0 0 12px' }}>
                  {surveyResult ? (
                    <span style={{
                      display: 'block', padding: '6px 10px',
                      background: '#EEF7F0', border: '1px solid #c6d9a8', borderRadius: 6,
                      fontSize: 11, color: '#166534',
                      fontFamily: 'ui-monospace, monospace',
                      wordBreak: 'break-all', lineHeight: 1.6,
                      userSelect: 'text',
                    }}>
                      {surveyResult.surveyUrl}
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-block', padding: '3px 9px',
                      background: '#f3f4f6', borderRadius: 5,
                      fontSize: 12, color: '#6b7280', fontStyle: 'italic', fontFamily: F,
                    }}>
                      [Secure survey link will be generated]
                    </span>
                  )}
                </p>

                <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
                  Brawerman Nursing Institute · Cedars-Sinai<br />
                  ASPIRE Program
                </p>
              </div>
            </div>
          </div>

          {/* Generated link card — compact details, shown below preview after success */}
          {surveyResult && (
            <div style={{
              marginTop: 10,
              background: '#fff', borderRadius: 12,
              border: '1px solid rgba(29,37,103,0.10)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              overflow: 'hidden',
            }}>
              {/* Success header */}
              <div style={{
                background: '#EEF7F0', borderBottom: '1px solid #c6d9a8',
                padding: '10px 16px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 12, color: '#2F7D5C', fontWeight: 600, fontFamily: F }}>
                  ✓ Link generated
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 5,
                  background: '#c6d9a8', color: '#166534', fontFamily: F,
                }}>
                  {surveyResult.student?.firstName} {surveyResult.student?.lastName}
                </span>
              </div>

              <div style={{ padding: '14px 16px' }}>
                {/* One-time warning */}
                <div style={{
                  padding: '9px 12px', marginBottom: 12,
                  background: '#FBF5E8', border: '1px solid #f0c9b0',
                  borderRadius: 8, fontSize: 11, color: '#8B5E1A',
                  fontFamily: F, lineHeight: 1.6,
                }}>
                  This link is shown once. Copy it now before closing or changing the form.
                </div>

                {/* Copy button */}
                <button
                  onClick={handleCopy}
                  style={{
                    padding: '7px 16px', marginBottom: 12,
                    background: copied ? '#EEF7F0' : 'var(--color-accent-primary,#1D2567)',
                    border: `1px solid ${copied ? '#c6d9a8' : 'transparent'}`,
                    borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: copied ? '#2F7D5C' : '#fff', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy Link'}
                </button>

                {/* Assignment details */}
                <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, lineHeight: 1.7 }}>
                  <div><strong style={{ color: '#6b7280' }}>Assignment ID:</strong> {surveyResult.assignmentId}</div>
                  <div><strong style={{ color: '#6b7280' }}>Expires:</strong> {fmtDate(surveyResult.expiresAt?.split('T')[0])}</div>
                  <div><strong style={{ color: '#6b7280' }}>Timepoint:</strong> {TIMEPOINTS.find(t => t.value === surveyResult.timepoint)?.label || surveyResult.timepoint}</div>
                  {surveyResult.student?.email && (
                    <div><strong style={{ color: '#6b7280' }}>Delivery email:</strong> {surveyResult.student.email}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Zone 4: Activity ──────────────────────────────────────────── */}
        <div style={{ ...railPanel, flex: '0 0 176px', minWidth: 148 }}>
          <div style={railHeading}>Recent Outreach Activity</div>
          <p style={railBody}>
            Recent outreach activity will appear here once invitations are being sent (Stage 5.2+).
          </p>
        </div>

      </div>
    </div>
  )
}
