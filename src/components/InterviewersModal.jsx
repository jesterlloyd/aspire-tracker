import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function InterviewersModal({ onClose }) {
  const [interviewers, setInterviewers] = useState([])
  const [newName,      setNewName]      = useState('')
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    supabase.from('interviewers').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setInterviewers(data || []))
  }, [])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    const { data, error } = await supabase.from('interviewers').insert({ name }).select().single()
    if (!error && data) {
      setInterviewers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
    }
    setSaving(false)
  }

  const handleRemove = async id => {
    await supabase.from('interviewers').update({ is_active: false }).eq('id', id)
    setInterviewers(prev => prev.filter(i => i.id !== id))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Interviewers</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Only active interviewers appear in the interview form dropdown. Removing sets them as
            inactive and does not delete their records.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {interviewers.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No active interviewers.</p>
            )}
            {interviewers.map(i => (
              <div key={i.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 0', borderBottom: '1px solid var(--border-lt)',
              }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--raven)' }}>{i.name}</span>
                <button
                  onClick={() => handleRemove(i.id)}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                    color: 'var(--cs-red)', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', padding: '3px 10px', transition: 'border-color 0.12s',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer" style={{ gap: 8 }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            placeholder="Interviewer full name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd}
            disabled={saving || !newName.trim()}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
