import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function InterviewersModal({ onClose }) {
  const [interviewers, setInterviewers] = useState([])
  const [newName,      setNewName]      = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [emailEdits,   setEmailEdits]   = useState({}) // { [id]: email }
  const emailTimers = useRef({})

  useEffect(() => {
    supabase.from('interviewers').select('*').eq('is_active', true).order('name')
      .then(({ data }) => {
        const list = data || []
        setInterviewers(list)
        // Seed local email edits from DB values
        const init = {}
        list.forEach(i => { init[i.id] = i.email || '' })
        setEmailEdits(init)
      })
  }, [])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name || !newEmail.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('interviewers')
      .insert({ name, email: newEmail.trim() }).select().single()
    if (!error && data) {
      setInterviewers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setEmailEdits(prev => ({ ...prev, [data.id]: data.email || '' }))
      setNewName(''); setNewEmail('')
    }
    setSaving(false)
  }

  const handleEmailChange = (id, value) => {
    setEmailEdits(prev => ({ ...prev, [id]: value }))
    clearTimeout(emailTimers.current[id])
    emailTimers.current[id] = setTimeout(async () => {
      await supabase.from('interviewers').update({ email: value.trim() }).eq('id', id)
    }, 600)
  }

  const handleRemove = async id => {
    await supabase.from('interviewers').update({ is_active: false }).eq('id', id)
    setInterviewers(prev => prev.filter(i => i.id !== id))
  }

  const canAdd = newName.trim() && newEmail.trim()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Interviewers</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14 }}>
            Only active interviewers appear in the interview form dropdown. Email addresses are
            used for automated scheduling notifications. Removing sets an interviewer as inactive.
          </p>

          {/* Column headers */}
          {interviewers.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:10, padding:'6px 0', marginBottom:4 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Name</div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Email Address</div>
              <div />
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
            {interviewers.length === 0 && (
              <p style={{ fontSize:13, color:'var(--text-secondary)' }}>No active interviewers.</p>
            )}
            {interviewers.map(i => (
              <div key={i.id} style={{
                display:'grid', gridTemplateColumns:'1fr 1fr auto',
                alignItems:'center', gap:10,
                padding:'9px 0', borderBottom:'1px solid var(--border-lt)',
              }}>
                <span style={{ fontSize:14, fontWeight:500, color:'var(--raven)' }}>{i.name}</span>
                <input
                  className="form-input"
                  style={{ fontSize:13, padding:'5px 9px' }}
                  type="email"
                  placeholder="email@cshs.org"
                  value={emailEdits[i.id] ?? ''}
                  onChange={e => handleEmailChange(i.id, e.target.value)}
                />
                <button onClick={() => handleRemove(i.id)}
                  style={{ background:'none', border:'1px solid var(--border)', borderRadius:4,
                    color:'var(--cs-red)', fontSize:12, fontWeight:600,
                    cursor:'pointer', padding:'3px 10px', whiteSpace:'nowrap' }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Add new interviewer */}
        <div className="modal-footer" style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <input
              className="form-input"
              placeholder="Full name *"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canAdd && handleAdd()}
            />
            <input
              className="form-input"
              type="email"
              placeholder="Email address *"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canAdd && handleAdd()}
            />
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-primary" onClick={handleAdd}
              disabled={saving || !canAdd} style={{ minWidth:80 }}>
              {saving ? 'Adding…' : '+ Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
