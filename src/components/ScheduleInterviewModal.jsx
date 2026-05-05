import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'

const TIME_SLOTS = []
for (let h = 7; h <= 18; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2,'0')}:00`)
  if (h < 18) TIME_SLOTS.push(`${String(h).padStart(2,'0')}:30`)
}

export default function ScheduleInterviewModal({ students, onClose, onSaved }) {
  const [studentId, setStudentId] = useState('')
  const [date,      setDate]      = useState('')
  const [time,      setTime]      = useState('09:00')
  const [duration,  setDuration]  = useState(45)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)

  // Only offer students not yet scheduled or without a completed interview
  const eligible = students.filter(s => !s.interview_scheduled_date || !s.interview_scheduled_date.trim())

  const handleSave = async () => {
    if (!studentId || !date) { setError('Please select a student and date.'); return }
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('students').update({
      interview_scheduled_date: date,
      interview_scheduled_time: time,
      interview_duration_minutes: duration,
    }).eq('id', studentId)
    if (err) { setError(err.message); setSaving(false); return }
    await onSaved()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Schedule Interview</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {error && <div className="error-msg">{error}</div>}
          <div className="form-field">
            <label className="form-label">Student *</label>
            <select className="form-select" value={studentId} onChange={e => setStudentId(e.target.value)}>
              <option value="">Select student…</option>
              {eligible.map(s => <option key={s.id} value={s.id}>{displayName(s)} — {s.school || ''}</option>)}
            </select>
            {eligible.length === 0 && (
              <p style={{ fontSize:12, color:'var(--text-secondary)', marginTop:4 }}>
                All students already have interviews scheduled.
              </p>
            )}
          </div>
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
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !studentId || !date}>
            {saving ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
