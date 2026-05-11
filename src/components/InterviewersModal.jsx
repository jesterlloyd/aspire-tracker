import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { RefreshCw } from 'lucide-react'

// ── Cache utilities ───────────────────────────────────────────
const INTERVIEWERS_CACHE_KEY = 'aspire_interviewers_v1'

const loadInterviewersFromCache = () => {
  try {
    const raw = localStorage.getItem(INTERVIEWERS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

const saveInterviewersToCache = (data) => {
  try { localStorage.setItem(INTERVIEWERS_CACHE_KEY, JSON.stringify(data)) } catch {}
}

export default function InterviewersModal({ isOpen, onClose, toast }) {
  const [interviewers, setInterviewers] = useState([])
  const [loading,      setLoading]      = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [editingEmail, setEditingEmail] = useState({})
  const [savingEmail,  setSavingEmail]  = useState({})

  // Cache-first fetch: show cached data instantly, refresh in background
  const fetchInterviewers = useCallback(async () => {
    // Step A: Load from cache immediately — no spinner if cache exists
    const cached = loadInterviewersFromCache()
    if (cached && cached.length > 0) {
      setInterviewers(cached)
      setLoading(false)
      const init = {}
      cached.forEach(i => { init[i.id] = i.email || '' })
      setEditingEmail(init)
    } else {
      setLoading(true)
    }

    // Step B: Fetch fresh from Supabase in background
    try {
      const { data, error } = await supabase
        .from('interviewers')
        .select('id, name, email, is_active')
        .order('name', { ascending: true })

      if (error) {
        console.error('Interviewers fetch error:', error.message)
        setLoading(false)
        return // Cache still shows — don't clear the list
      }

      if (data && data.length > 0) {
        setInterviewers(data)
        saveInterviewersToCache(data) // Seed/update cache with fresh data
        const init = {}
        data.forEach(i => { init[i.id] = i.email || '' })
        setEditingEmail(init)
      }
    } catch (err) {
      console.error('Interviewers fetch exception:', err.message)
      // Cache still shows — don't clear the list
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) fetchInterviewers()
  }, [isOpen, fetchInterviewers])

  // ── Mutation handlers — all update cache in sync ──────────────
  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    const { data, error } = await supabase
      .from('interviewers')
      .insert({ name, email: newEmail.trim() || '', is_active: true })
      .select('id, name, email, is_active')
      .single()
    setSaving(false)
    if (error) {
      console.error('Add error:', error.message)
      toast?.error('Add failed', error.message)
      return
    }
    const updated = [...interviewers, data].sort((a, b) => a.name.localeCompare(b.name))
    setInterviewers(updated)
    saveInterviewersToCache(updated)
    setEditingEmail(prev => ({ ...prev, [data.id]: data.email || '' }))
    setNewName('')
    setNewEmail('')
    toast?.success('Interviewer added', `${data.name} added.`)
  }

  const handleSaveEmail = async (id) => {
    const trimmedEmail = (editingEmail[id] ?? '').trim()
    setSavingEmail(p => ({ ...p, [id]: true }))
    const { data, error } = await supabase
      .from('interviewers')
      .update({ email: trimmedEmail })
      .eq('id', id)
      .select('id, name, email')
      .single()
    setSavingEmail(p => ({ ...p, [id]: false }))
    if (error) {
      console.error('Email update error:', error.message)
      toast?.error('Save failed', error.message)
      return
    }
    const updated = interviewers.map(i => i.id === id ? { ...i, email: trimmedEmail } : i)
    setInterviewers(updated)
    saveInterviewersToCache(updated)
    toast?.success('Email saved', `${data.name}'s email updated.`)
  }

  const handleToggleActive = async (id, currentActive) => {
    const { error } = await supabase
      .from('interviewers')
      .update({ is_active: !currentActive })
      .eq('id', id)
    if (error) { toast?.error('Failed', error.message); return }
    const updated = interviewers.map(i => i.id === id ? { ...i, is_active: !currentActive } : i)
    setInterviewers(updated)
    saveInterviewersToCache(updated)
    toast?.success(!currentActive ? 'Interviewer restored' : 'Interviewer removed', '')
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

          {/* Only show spinner when truly no data at all */}
          {loading && interviewers.length === 0 && (
            <div style={{ padding:'20px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>
              Loading interviewers...
            </div>
          )}

          {!loading && interviewers.length === 0 && (
            <div style={{ padding:'20px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>
              No interviewers yet. Add your first one below.
            </div>
          )}

          {/* List renders even while background refresh is in progress */}
          {interviewers.length > 0 && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr auto auto', gap:10, padding:'6px 0', marginBottom:4 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Name</div>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Email</div>
                <div /><div />
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
