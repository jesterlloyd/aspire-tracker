import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { RefreshCw } from 'lucide-react'

export default function InterviewersModal({ onClose, toast }) {
  const [interviewers, setInterviewers] = useState([])
  const [loading,      setLoading]      = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [editingEmail, setEditingEmail] = useState({}) // { [id]: value }
  const [savingEmail,  setSavingEmail]  = useState({}) // { [id]: bool }

  // Bug A fixed: no is_active filter — show all interviewers in management panel
  const fetchInterviewers = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('interviewers')
      .select('id, name, email, is_active')
      .order('name', { ascending: true })
    if (error) {
      console.error('Fetch interviewers error:', error.message, error.details)
      toast?.error('Load failed', error.message)
      setLoading(false)
      return
    }
    const list = data || []
    setInterviewers(list)
    // Seed local email edits
    const init = {}
    list.forEach(i => { init[i.id] = i.email || '' })
    setEditingEmail(init)
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchInterviewers()
  }, [fetchInterviewers])

  // Bug D fixed: email is optional
  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    const { error } = await supabase.from('interviewers').insert({
      name,
      email: newEmail.trim() || '',
      is_active: true,
    })
    if (error) {
      console.error('Insert error:', error.message, error.details)
      toast?.error('Failed to add', error.message)
      setSaving(false)
      return
    }
    setNewName('')
    setNewEmail('')
    setSaving(false)
    toast?.success('Interviewer added', `${name} added.`)
    fetchInterviewers()
  }

  // Bug C fixed: explicit save with feedback, no debounce timer
  const handleSaveEmail = async (id) => {
    const value = editingEmail[id] ?? ''
    setSavingEmail(p => ({ ...p, [id]: true }))
    const { error } = await supabase
      .from('interviewers')
      .update({ email: value.trim() })
      .eq('id', id)
    setSavingEmail(p => ({ ...p, [id]: false }))
    if (error) {
      console.error('Update email error:', error.message)
      toast?.error('Update failed', error.message)
      return
    }
    toast?.success('Email saved', 'Interviewer email updated.')
    fetchInterviewers()
  }

  // Bug E: already correct — uses id
  const handleToggleActive = async (id, currentActive) => {
    const { error } = await supabase
      .from('interviewers')
      .update({ is_active: !currentActive })
      .eq('id', id)
    if (error) { toast?.error('Failed', error.message); return }
    toast?.success(!currentActive ? 'Interviewer restored' : 'Interviewer removed', '')
    fetchInterviewers()
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

          {/* Step 4: loading and empty states */}
          {loading ? (
            <div style={{ padding:'24px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>
              Loading interviewers...
            </div>
          ) : interviewers.length === 0 ? (
            <div style={{ padding:'24px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>
              No interviewers found. Add your first interviewer below.
            </div>
          ) : (
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
