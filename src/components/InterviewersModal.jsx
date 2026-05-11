import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { RefreshCw } from 'lucide-react'

export default function InterviewersModal({ isOpen, onClose, toast }) {
  const [interviewers, setInterviewers] = useState([])
  const [loading,      setLoading]      = useState(false)
  const [fetchError,   setFetchError]   = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [editingEmail, setEditingEmail] = useState({})
  const [savingEmail,  setSavingEmail]  = useState({})

  const fetchWithRetry = async (maxAttempts = 3) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, error } = await supabase
          .from('interviewers')
          .select('id, name, email, is_active')
          .order('name', { ascending: true })
        if (error) {
          console.warn(`Interviewers fetch attempt ${attempt} error:`, error.message)
          if (attempt < maxAttempts) { await new Promise(r => setTimeout(r, 800 * attempt)); continue }
          return null
        }
        return data || []
      } catch (err) {
        console.warn(`Interviewers fetch attempt ${attempt} exception:`, err.message)
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 800 * attempt))
      }
    }
    return null
  }

  const fetchInterviewers = useCallback(async () => {
    setLoading(true)
    setFetchError(false)
    const data = await fetchWithRetry(3)
    if (data === null) {
      setFetchError(true)
      setInterviewers([])
    } else {
      setInterviewers(data)
      setFetchError(false)
      const init = {}
      data.forEach(i => { init[i.id] = i.email || '' })
      setEditingEmail(init)
    }
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch every time the modal opens
  useEffect(() => {
    if (isOpen) fetchInterviewers()
  }, [isOpen, fetchInterviewers])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    let saved = false
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { data, error } = await supabase
        .from('interviewers')
        .insert({ name, email: newEmail.trim() || '', is_active: true })
        .select('id, name, email, is_active')
        .single()
      if (!error && data) {
        saved = true
        setInterviewers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
        setEditingEmail(prev => ({ ...prev, [data.id]: data.email || '' }))
        setNewName('')
        setNewEmail('')
        toast?.success('Interviewer added', `${data.name} added.`)
        break
      }
      console.warn(`Add attempt ${attempt} failed:`, error?.message)
      if (attempt < 2) await new Promise(r => setTimeout(r, 800))
    }
    if (!saved) toast?.error('Add failed', 'Could not add interviewer. Please try again.')
    setSaving(false)
  }

  const handleSaveEmail = async (id) => {
    const trimmedEmail = (editingEmail[id] ?? '').trim()
    setSavingEmail(p => ({ ...p, [id]: true }))
    let saved = false
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { data, error } = await supabase
        .from('interviewers')
        .update({ email: trimmedEmail })
        .eq('id', id)
        .select('id, name, email')
        .single()
      if (!error && data) {
        saved = true
        setInterviewers(prev => prev.map(i => i.id === id ? { ...i, email: trimmedEmail } : i))
        toast?.success('Email saved', `${data.name}'s email updated.`)
        break
      }
      console.warn(`Email save attempt ${attempt} failed:`, error?.message)
      if (attempt < 2) await new Promise(r => setTimeout(r, 800))
    }
    if (!saved) toast?.error('Save failed', 'Could not save email. Please try again.')
    setSavingEmail(p => ({ ...p, [id]: false }))
  }

  const handleToggleActive = async (id, currentActive) => {
    const { error } = await supabase
      .from('interviewers')
      .update({ is_active: !currentActive })
      .eq('id', id)
    if (error) { toast?.error('Failed', error.message); return }
    toast?.success(!currentActive ? 'Interviewer restored' : 'Interviewer removed', '')
    // Direct state update — no re-fetch to avoid hang
    setInterviewers(prev => prev.map(i => i.id === id ? { ...i, is_active: !currentActive } : i))
  }

  const canAdd = newName.trim()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:560 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 style={{ margin:0 }}>Manage Interviewers</h2>
            <div style={{ fontSize:12, color:'rgba(0,0,0,0.45)', marginTop:3 }}>
              People who conduct ASPIRE interviews. Separate from app login accounts.
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {/* Refresh button — Step 3 */}
            <button onClick={fetchInterviewers} title="Refresh list"
              style={{ background:'var(--nightfall)', border:'none', borderRadius:6, padding:'5px 10px', cursor:'pointer', color:'#fff', fontFamily:'DM Sans,sans-serif', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
              <RefreshCw size={12} />
              Refresh
            </button>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-body">
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14 }}>
            Interviewers appear in the rubric form dropdown. Email addresses are used for scheduling notifications.
          </p>

          {loading && (
            <div style={{ padding:'20px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>
              Loading interviewers...
            </div>
          )}

          {!loading && fetchError && (
            <div style={{ padding:'20px', textAlign:'center' }}>
              <div style={{ fontFamily:'DM Sans,sans-serif', fontSize:'13px', color:'#991b1b', marginBottom:'12px' }}>
                Could not load interviewers. This is usually a temporary connection issue.
              </div>
              <button onClick={fetchInterviewers}
                style={{ padding:'8px 18px', background:'#1D2567', border:'none', borderRadius:'8px', fontFamily:'DM Sans,sans-serif', fontWeight:600, fontSize:'13px', color:'#ffffff', cursor:'pointer' }}>
                Try Again
              </button>
            </div>
          )}

          {!loading && !fetchError && interviewers.length === 0 && (
            <div style={{ padding:'20px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>
              No interviewers yet. Add your first one below.
            </div>
          )}

          {!loading && !fetchError && interviewers.length > 0 && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr auto auto', gap:10, padding:'6px 0', marginBottom:4 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Name</div>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Email</div>
                <div />
                <div />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                {interviewers.map(i => (
                  <div key={i.id} style={{
                    display:'grid', gridTemplateColumns:'1fr 1.2fr auto auto',
                    alignItems:'center', gap:10,
                    padding:'9px 0', borderBottom:'1px solid var(--border-lt)',
                    opacity: i.is_active ? 1 : 0.5,
                  }}>
                    <span style={{ fontSize:14, fontWeight:500, color:'var(--raven)' }}>
                      {i.name}
                      {!i.is_active && <span style={{ fontSize:10, color:'#9ca3af', marginLeft:6 }}>(inactive)</span>}
                    </span>
                    <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                      <input
                        className="form-input"
                        style={{ fontSize:13, padding:'5px 9px', flex:1 }}
                        type="email"
                        placeholder="email@cshs.org"
                        value={editingEmail[i.id] ?? ''}
                        onChange={e => setEditingEmail(p => ({ ...p, [i.id]: e.target.value }))}
                        onBlur={() => handleSaveEmail(i.id)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveEmail(i.id)}
                      />
                      {savingEmail[i.id] && <span style={{ fontSize:11, color:'#9ca3af' }}>…</span>}
                    </div>
                    <button onClick={() => handleToggleActive(i.id, i.is_active)}
                      style={{ background:'none', border:'1px solid var(--border)', borderRadius:4,
                        color: i.is_active ? 'var(--cs-red)' : '#166534',
                        fontSize:12, fontWeight:600, cursor:'pointer', padding:'3px 10px', whiteSpace:'nowrap' }}>
                      {i.is_active ? 'Remove' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Add new interviewer */}
        <div className="modal-footer" style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <input className="form-input" placeholder="Full name *"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canAdd && handleAdd()} />
            <input className="form-input" type="email" placeholder="Email address (optional)"
              value={newEmail} onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canAdd && handleAdd()} />
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
