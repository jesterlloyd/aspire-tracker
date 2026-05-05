import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'

const TIME_SLOTS = []
for (let h = 7; h <= 18; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 18 && m > 0) break
    TIME_SLOTS.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
  }
}

export default function EditScheduleModal({ student, onClose, onSaved, onOpenRubric }) {
  const [date,         setDate]         = useState(student.interview_scheduled_date || '')
  const [time,         setTime]         = useState(student.interview_scheduled_time || '09:00')
  const [duration,     setDuration]     = useState(student.interview_duration_minutes || 45)
  const [assigned,     setAssigned]     = useState(
    student.interview_assigned_interviewers
      ? student.interview_assigned_interviewers.split(',').map(s => s.trim()).filter(Boolean)
      : []
  )
  const [interviewers, setInterviewers] = useState([])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)

  useEffect(() => {
    supabase.from('interviewers').select('name').eq('is_active', true).order('name')
      .then(({ data }) => setInterviewers((data || []).map(i => i.name)))
  }, [])

  const toggleInterviewer = name =>
    setAssigned(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])

  const handleSave = async () => {
    if (!date) { setError('Please select a date.'); return }
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('students').update({
      interview_scheduled_date: date,
      interview_scheduled_time: time,
      interview_duration_minutes: duration,
      interview_assigned_interviewers: assigned.join(', '),
    }).eq('id', student.id)
    if (err) { setError(err.message); setSaving(false); return }
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
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent:'space-between' }}>
          <button className="btn btn-outline-modal"
            style={{ color:'var(--nightfall)', borderColor:'var(--nightfall)' }}
            onClick={() => { onClose(); onOpenRubric(student.id) }}>
            Open Interview Rubric →
          </button>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !date}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
