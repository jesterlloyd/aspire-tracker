import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { setAspireStatus } from '../lib/statusUtils'
import { updateStudent as proxyUpdateStudent } from '../lib/studentProxy'

const TIME_SLOTS = []
for (let h = 7; h <= 18; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 18 && m > 0) break
    TIME_SLOTS.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
  }
}

export default function EditScheduleModal({ student, onClose, onSaved, onOpenRubric }) {
  const [date,           setDate]           = useState(student.interview_scheduled_date || '')
  const [time,           setTime]           = useState(student.interview_scheduled_time || '09:00')
  const [duration,       setDuration]       = useState(student.interview_duration_minutes || 45)
  const [assigned,       setAssigned]       = useState(
    student.interview_assigned_interviewers
      ? student.interview_assigned_interviewers.split(',').map(s => s.trim()).filter(Boolean)
      : []
  )
  const [interviewers,   setInterviewers]   = useState([])
  const [saving,         setSaving]         = useState(false)
  const [deleting,       setDeleting]       = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [error,          setError]          = useState(null)

  useEffect(() => {
    supabase.from('user_profiles').select('id, full_name').eq('can_conduct_interviews', true).eq('is_active', true).order('full_name', { ascending: true })
      .then(({ data }) => setInterviewers((data || []).map(p => p.full_name)))
  }, [])

  const toggleInterviewer = name =>
    setAssigned(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])

  const handleSave = async () => {
    if (!date) { setError('Please select a date.'); return }
    setSaving(true); setError(null)
    try {
      await proxyUpdateStudent(student.id, {
        interview_scheduled_date: date, interview_scheduled_time: time,
        interview_duration_minutes: duration, interview_assigned_interviewers: assigned.join(', '),
      })
    } catch (err) { setError(err.message); setSaving(false); return }
    await setAspireStatus(student.id, 'Interview Scheduled')
    await onSaved()
    onClose()
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await proxyUpdateStudent(student.id, {
        interview_scheduled_date: '', interview_scheduled_time: '',
        interview_duration_minutes: null, interview_assigned_interviewers: '',
      })
    } catch (err) { setError(err.message); setDeleting(false); setConfirmDelete(false); return }
    await onSaved()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Edit Schedule</h2>
            <div style={{ fontSize:13, color:'var(--text-secondary)', marginTop:2 }}>{displayName(student)}</div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {error && <div className="error-msg">{error}</div>}

          {confirmDelete && (
            <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:6, padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
              <p style={{ fontSize:13, color:'#991b1b', fontWeight:600, margin:0 }}>
                Remove the scheduled interview for {displayName(student)}?
              </p>
              <p style={{ fontSize:12, color:'#991b1b', margin:0 }}>
                This will clear their scheduled date, time, and interviewer assignments.
              </p>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-destructive-filled" onClick={handleDelete} disabled={deleting}
                  style={{ fontSize:12, padding:'5px 14px' }}>
                  {deleting ? 'Removing…' : 'Yes, Remove'}
                </button>
                <button className="btn btn-outline-modal" onClick={() => setConfirmDelete(false)}
                  style={{ fontSize:12, padding:'5px 14px' }}>
                  Keep It
                </button>
              </div>
            </div>
          )}

          <div className="form-field">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="form-field">
              <label className="form-label">Time</label>
              <select className="form-select" value={time} onChange={e => setTime(e.target.value)}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Duration</label>
              <select className="form-select" value={duration} onChange={e => setDuration(Number(e.target.value))}>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
              </select>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Assigned Interviewers</label>
            {interviewers.length === 0 ? (
              <p style={{ fontSize:12, color:'var(--text-secondary)' }}>No interviewers found.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:140, overflowY:'auto' }}>
                {interviewers.map(name => (
                  <label key={name} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
                    <input type="checkbox" checked={assigned.includes(name)} onChange={() => toggleInterviewer(name)}
                      style={{ accentColor:'var(--nightfall)', width:15, height:15 }} />
                    {name}
                  </label>
                ))}
              </div>
            )}
            {assigned.length > 0 && (
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:4 }}>
                Assigned: {assigned.join(', ')}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent:'space-between' }}>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="btn btn-outline-modal"
              style={{ color:'var(--nightfall)', borderColor:'var(--nightfall)' }}
              onClick={() => { onClose(); onOpenRubric(student.id) }}>
              Open Interview Rubric →
            </button>
            <button
              style={{ background:'var(--pearl)', border:'1.5px solid var(--cs-red)', color:'var(--cs-red)', borderRadius:4, padding:'6px 14px', fontSize:13, fontWeight:600, cursor:'pointer', transition:'background 0.12s' }}
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}>
              Delete Interview
            </button>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !date}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
