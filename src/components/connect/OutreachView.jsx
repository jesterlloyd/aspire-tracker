import { useState, useEffect } from 'react'
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

export default function OutreachView({ cohortId }) {
  const [students,          setStudents]          = useState([])
  const [loadingStudents,   setLoadingStudents]   = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [instrument,        setInstrument]        = useState('casey_fink_readiness_2024')
  const [timepoint,         setTimepoint]         = useState('early_rotation_baseline')
  const [expiresAt,         setExpiresAt]         = useState(defaultExpiresAt)
  const [notes,             setNotes]             = useState('')
  const [duplicateExists,   setDuplicateExists]   = useState(false)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  // ── Fetch students for active cohort ──────────────────────────────────────
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

  // ── Duplicate guard — read-only check; no write ───────────────────────────
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

  // ── Derived values ─────────────────────────────────────────────────────────
  const selectedStudent = students.find(s => s.id === selectedStudentId) || null
  const resolvedEmail   = selectedStudent
    ? (selectedStudent.personal_email || selectedStudent.school_email || null)
    : null
  const emailSource     = selectedStudent
    ? (selectedStudent.personal_email
        ? 'personal email'
        : selectedStudent.school_email ? 'school email' : null)
    : null
  const firstName        = selectedStudent?.first_name || null
  const instrumentLabel  = INSTRUMENTS.find(i => i.slug === instrument)?.label || ''
  const expiresFormatted = fmtDate(expiresAt)

  return (
    <div style={{ padding: '20px 24px', fontFamily: F }}>

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

      {/* Two-column layout: form fields left, preview right */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* ── Left column: form fields ──────────────────────────────────── */}
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>

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

          {/* Field 2 — Delivery email (read-only, shown after recipient selected) */}
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
                  No email address on file for this student. Update the student profile before sending.
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

          {/* Duplicate guard — informational only, no write */}
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

          {/* Action bar */}
          <div style={{ paddingTop: 4 }}>
            <button
              disabled
              style={{
                padding: '9px 20px', background: '#e5e7eb',
                border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: F,
                color: '#9ca3af', cursor: 'not-allowed',
              }}
            >
              Send Invitation
            </button>
            <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', fontFamily: F, lineHeight: 1.5 }}>
              Sending will be enabled in Stage 5.2 once the invitation endpoint is wired. This is a Stage 5.1 preview.
            </div>
          </div>
        </div>

        {/* ── Right column: message preview ─────────────────────────────── */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{
            background: '#fff', borderRadius: 12,
            border: '1px solid rgba(29,37,103,0.10)',
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

            {/* Message body preview */}
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
                <p style={{ margin: '0 0 12px' }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 9px',
                    background: '#f3f4f6', borderRadius: 5,
                    fontSize: 12, color: '#6b7280', fontStyle: 'italic', fontFamily: F,
                  }}>
                    [Secure survey link will be generated when sent]
                  </span>
                </p>
                <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
                  Brawerman Nursing Institute · Cedars-Sinai<br />
                  ASPIRE Program
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
