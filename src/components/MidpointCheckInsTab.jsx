import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Toggle from './ui/Toggle'

const CHECKIN_TYPE = 'midpoint_checkin'

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

export default function MidpointCheckInsTab({ cohortId, students = [], toast }) {

  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [togglingAuto, setTogglingAuto]           = useState(false)

  const [sentLog, setSentLog]       = useState([])
  const [failedLog, setFailedLog]   = useState([])
  const [loadingLog, setLoadingLog] = useState(true)

  const [sending, setSending]       = useState({})
  const [previewing, setPreviewing] = useState(null)
  const [previewHtml, setPreviewHtml] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Fetch cohort automation setting
  useEffect(() => {
    if (!cohortId) return
    supabase
      .from('cohorts')
      .select('midpoint_checkin_automation_enabled')
      .eq('id', cohortId)
      .single()
      .then(({ data }) => {
        if (data) setAutomationEnabled(!!data.midpoint_checkin_automation_enabled)
      })
  }, [cohortId])

  // Fetch notification_log for sent/failed midpoint check-ins
  const fetchLog = useCallback(async () => {
    if (!cohortId) return
    setLoadingLog(true)
    const { data } = await supabase
      .from('notification_log')
      .select('id, student_id, recipient_email, recipient_name, status, error_message, sent_at, metadata')
      .eq('notification_type', CHECKIN_TYPE)
      .eq('cohort_id', cohortId)
      .order('sent_at', { ascending: false })
    const all = data || []
    setSentLog(all.filter(r => r.status === 'sent'))
    setFailedLog(all.filter(r => r.status === 'failed'))
    setLoadingLog(false)
  }, [cohortId])

  useEffect(() => { fetchLog() }, [fetchLog])

  // Students eligible for check-in: Active Rotation, ≥50% hours
  const eligibleStudents = students.filter(s => {
    if (s.status !== 'Active Rotation') return false
    const req  = parseFloat(s.hours_required || 0)
    const done = parseFloat(s.approved_hours || 0)
    return req > 0 && done >= req * 0.5
  })

  // Students with missing email
  const missingEmail = students.filter(s =>
    s.status === 'Active Rotation' && !s.school_email && !s.personal_email
  )

  // Sent student ids for display
  const sentStudentIds = new Set(sentLog.map(r => r.student_id))

  // Toggle automation
  const handleToggleAutomation = async (val) => {
    if (togglingAuto) return
    setTogglingAuto(true)
    const { error } = await supabase
      .from('cohorts')
      .update({ midpoint_checkin_automation_enabled: val })
      .eq('id', cohortId)
    if (error) {
      toast?.('Failed to update automation setting', 'error')
    } else {
      setAutomationEnabled(val)
      toast?.(val ? 'Automation enabled' : 'Automation paused', 'success')
    }
    setTogglingAuto(false)
  }

  // Manual send to a single student
  const handleSend = async (student) => {
    const key = student.id
    setSending(p => ({ ...p, [key]: true }))
    try {
      const token = await getAccessToken()
      const resp = await fetch('/api/send-midpoint-checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ studentId: student.id, cohortId }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Send failed')
      toast?.(`Check-in sent to ${student.first_name}`, 'success')
      fetchLog()
    } catch (err) {
      toast?.(err.message, 'error')
    } finally {
      setSending(p => ({ ...p, [key]: false }))
    }
  }

  // Preview email HTML
  const handlePreview = async (student) => {
    setPreviewing(student.id)
    setPreviewLoading(true)
    setPreviewHtml(null)
    try {
      const token = await getAccessToken()
      const resp = await fetch('/api/send-midpoint-checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ studentId: student.id, cohortId, preview: true }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Preview failed')
      setPreviewHtml(data.html)
    } catch (err) {
      toast?.(err.message, 'error')
      setPreviewing(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => { setPreviewing(null); setPreviewHtml(null) }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = {
    background: 'var(--bg-card, #fff)',
    border: '1px solid var(--border-card, rgba(29,37,103,0.08))',
    borderRadius: 10,
    padding: '16px 20px',
    marginBottom: 16,
  }

  const sectionLabel = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    color: 'var(--text-caption, #6b7280)',
    marginBottom: 10,
  }

  const tableHeader = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-caption, #6b7280)',
    padding: '0 0 8px',
    borderBottom: '1px solid var(--border-card, rgba(29,37,103,0.08))',
    textAlign: 'left',
  }

  const tableCell = {
    fontSize: 13,
    color: 'var(--text-primary, #191919)',
    padding: '10px 8px 10px 0',
    borderBottom: '1px solid var(--border-card, rgba(29,37,103,0.06))',
    verticalAlign: 'middle',
  }

  const pill = (label, color, bg) => (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: bg, borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )

  return (
    <div style={{ padding: '0 20px 24px', fontFamily: 'DM Sans, sans-serif', maxWidth: 900 }}>

      {/* ── Automation toggle ── */}
      <div style={card}>
        <div style={sectionLabel}>Automation</div>
        <Toggle
          checked={automationEnabled}
          onChange={handleToggleAutomation}
          disabled={togglingAuto}
          size="md"
          label="Auto-send midpoint check-ins"
          description="Sends a check-in email to each Active Rotation student once they reach 50% of their required hours. Runs daily."
        />
        {automationEnabled && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#16a34a', fontWeight: 500 }}>
            Automation active. Emails send automatically at 8 AM each morning for newly eligible students.
          </div>
        )}
      </div>

      {/* ── Missing email warning ── */}
      {missingEmail.length > 0 && (
        <div style={{ ...card, borderColor: '#fbbf24', background: '#fffbeb' }}>
          <div style={{ ...sectionLabel, color: '#92400e' }}>Missing Email Address</div>
          <div style={{ fontSize: 13, color: '#78350f', marginBottom: 10 }}>
            {missingEmail.length} student{missingEmail.length > 1 ? 's' : ''} in Active Rotation have no email on file and cannot receive check-ins automatically.
          </div>
          {missingEmail.map(s => (
            <div key={s.id} style={{ fontSize: 13, color: '#92400e', marginBottom: 4 }}>
              · {s.last_name}, {s.first_name}
            </div>
          ))}
        </div>
      )}

      {/* ── Eligible students ── */}
      <div style={card}>
        <div style={sectionLabel}>
          Eligible Students ({eligibleStudents.length})
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            — Active Rotation, ≥50% hours completed
          </span>
        </div>
        {eligibleStudents.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-caption, #6b7280)', padding: '8px 0' }}>
            No students have reached 50% hours yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={tableHeader}>Student</th>
                <th style={{ ...tableHeader, textAlign: 'right' }}>Hours</th>
                <th style={{ ...tableHeader, textAlign: 'center' }}>Status</th>
                <th style={{ ...tableHeader, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {eligibleStudents.map(s => {
                const req  = parseFloat(s.hours_required || 0)
                const done = parseFloat(s.approved_hours || 0)
                const pct  = req > 0 ? Math.round((done / req) * 100) : 0
                const sent = sentStudentIds.has(s.id)
                const isSending = sending[s.id]
                return (
                  <tr key={s.id}>
                    <td style={tableCell}>
                      <div style={{ fontWeight: 600 }}>{s.last_name}, {s.first_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-caption, #6b7280)', marginTop: 1 }}>
                        {s.school_email || s.personal_email || <span style={{ color: '#dc2626' }}>No email</span>}
                      </div>
                    </td>
                    <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {done.toFixed(0)}/{req.toFixed(0)}
                      <span style={{ fontSize: 11, color: 'var(--text-caption, #6b7280)', marginLeft: 4 }}>{pct}%</span>
                    </td>
                    <td style={{ ...tableCell, textAlign: 'center' }}>
                      {sent
                        ? pill('Sent', '#166534', '#dcfce7')
                        : pill('Pending', '#92400e', '#fef3c7')}
                    </td>
                    <td style={{ ...tableCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handlePreview(s)}
                        disabled={isSending}
                        style={{ fontSize: 12, fontFamily: 'DM Sans, sans-serif', fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid var(--border-input, rgba(29,37,103,0.12))', borderRadius: 5, padding: '4px 10px', color: 'var(--text-secondary, #4A5560)', marginRight: 6 }}
                      >
                        Preview
                      </button>
                      {!sent && (
                        <button
                          onClick={() => handleSend(s)}
                          disabled={isSending || !s.school_email && !s.personal_email}
                          style={{ fontSize: 12, fontFamily: 'DM Sans, sans-serif', fontWeight: 600, cursor: isSending ? 'default' : 'pointer', background: '#1D2567', border: 'none', borderRadius: 5, padding: '4px 12px', color: '#fff', opacity: isSending ? 0.6 : 1 }}
                        >
                          {isSending ? 'Sending…' : 'Send Now'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Failed sends ── */}
      {failedLog.length > 0 && (
        <div style={{ ...card, borderColor: '#fca5a5' }}>
          <div style={{ ...sectionLabel, color: '#991b1b' }}>Failed Sends ({failedLog.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={tableHeader}>Student</th>
                <th style={tableHeader}>Email</th>
                <th style={tableHeader}>Error</th>
                <th style={{ ...tableHeader, textAlign: 'right' }}>Date</th>
                <th style={{ ...tableHeader, textAlign: 'right' }}>Retry</th>
              </tr>
            </thead>
            <tbody>
              {failedLog.map(entry => {
                const student = students.find(s => s.id === entry.student_id)
                const isSending = student && sending[student.id]
                return (
                  <tr key={entry.id}>
                    <td style={tableCell}>
                      {student ? `${student.last_name}, ${student.first_name}` : entry.recipient_name || '—'}
                    </td>
                    <td style={{ ...tableCell, fontSize: 12 }}>{entry.recipient_email || '—'}</td>
                    <td style={{ ...tableCell, fontSize: 11, color: '#dc2626', maxWidth: 200 }}>
                      {entry.error_message || 'Unknown error'}
                    </td>
                    <td style={{ ...tableCell, fontSize: 11, textAlign: 'right', color: 'var(--text-caption, #6b7280)', whiteSpace: 'nowrap' }}>
                      {entry.sent_at ? new Date(entry.sent_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ ...tableCell, textAlign: 'right' }}>
                      {student ? (
                        <button
                          onClick={() => handleSend(student)}
                          disabled={isSending}
                          style={{ fontSize: 12, fontFamily: 'DM Sans, sans-serif', fontWeight: 600, cursor: isSending ? 'default' : 'pointer', background: '#dc2626', border: 'none', borderRadius: 5, padding: '4px 12px', color: '#fff', opacity: isSending ? 0.6 : 1 }}
                        >
                          {isSending ? 'Sending…' : 'Retry'}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Sent log ── */}
      {!loadingLog && (
        <div style={card}>
          <div style={sectionLabel}>Sent Log ({sentLog.length})</div>
          {sentLog.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-caption, #6b7280)', padding: '4px 0' }}>
              No check-ins sent yet this rotation.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeader}>Student</th>
                  <th style={tableHeader}>Sent To</th>
                  <th style={{ ...tableHeader, textAlign: 'right' }}>Date</th>
                  <th style={{ ...tableHeader, textAlign: 'right' }}>Trigger</th>
                </tr>
              </thead>
              <tbody>
                {sentLog.map(entry => {
                  const student = students.find(s => s.id === entry.student_id)
                  const triggerMode = entry.metadata?.context?.triggerMode || '—'
                  return (
                    <tr key={entry.id}>
                      <td style={tableCell}>
                        {student ? `${student.last_name}, ${student.first_name}` : entry.recipient_name || '—'}
                      </td>
                      <td style={{ ...tableCell, fontSize: 12 }}>{entry.recipient_email || '—'}</td>
                      <td style={{ ...tableCell, fontSize: 11, textAlign: 'right', color: 'var(--text-caption, #6b7280)', whiteSpace: 'nowrap' }}>
                        {entry.sent_at ? new Date(entry.sent_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...tableCell, fontSize: 11, textAlign: 'right' }}>
                        {triggerMode === 'cron'
                          ? pill('Auto', '#166534', '#dcfce7')
                          : triggerMode === 'manual'
                            ? pill('Manual', '#1e3a8a', '#dbeafe')
                            : pill(triggerMode, '#374151', '#f3f4f6')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Email preview modal ── */}
      {previewing && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={closePreview}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, maxWidth: 680, width: '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #eee' }}>
              <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'DM Sans, sans-serif', color: '#191919' }}>
                Email Preview
              </div>
              <button onClick={closePreview} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {previewLoading ? (
                <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#6b7280', fontFamily: 'DM Sans, sans-serif' }}>
                  Loading preview…
                </div>
              ) : previewHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  style={{ width: '100%', height: '100%', minHeight: 500, border: 'none' }}
                  title="Email preview"
                  sandbox="allow-same-origin"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
