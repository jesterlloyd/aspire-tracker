import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { X, Save, Plus, Trash2, Check, Loader } from 'lucide-react'

// Dedicated lightweight client for interviewers table only.
// No auth overhead — interviewers table has public access policy.
const db = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
)

const CACHE_KEY = 'aspire_interviewers_v1'

const loadCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

const saveCache = (data) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch {}
}

export default function InterviewersModal({ isOpen, onClose }) {
  const [interviewers, setInterviewers] = useState([])
  const [loading,      setLoading]      = useState(false)
  const [editEmails,   setEditEmails]   = useState({})  // { [id]: emailString }
  const [savingIds,    setSavingIds]    = useState({})  // { [id]: bool }
  const [savedIds,     setSavedIds]     = useState({})  // { [id]: bool }
  const [showAdd,      setShowAdd]      = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [adding,       setAdding]       = useState(false)

  const fetchInterviewers = useCallback(async () => {
    // Cache-first: show instantly if available
    const cached = loadCache()
    if (cached?.length > 0) {
      setInterviewers(cached)
      setLoading(false)
      const emailMap = {}
      cached.forEach(i => { emailMap[i.id] = i.email || '' })
      setEditEmails(emailMap)
    } else {
      setLoading(true)
    }

    // Background refresh from Supabase via dedicated client
    try {
      const { data, error } = await db
        .from('interviewers')
        .select('id, name, email, color')
        .order('name', { ascending: true })
      if (!error && data) {
        setInterviewers(data)
        saveCache(data)
        const emailMap = {}
        data.forEach(i => { emailMap[i.id] = i.email || '' })
        setEditEmails(emailMap)
      }
    } catch (err) {
      console.error('Fetch interviewers:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchInterviewers()
      setSavedIds({})
    }
  }, [isOpen, fetchInterviewers])

  const handleSaveEmail = async (interviewer) => {
    const emailToSave = (editEmails[interviewer.id] ?? interviewer.email ?? '').trim()
    setSavingIds(prev => ({ ...prev, [interviewer.id]: true }))
    try {
      const { error } = await db.rpc('update_interviewer_email', {
        p_id: interviewer.id,
        p_email: emailToSave,
      })
      if (error) { alert(`Could not save: ${error.message}`); return }
      const updated = interviewers.map(i =>
        i.id === interviewer.id ? { ...i, email: emailToSave } : i
      )
      setInterviewers(updated)
      saveCache(updated)
      setSavedIds(prev => ({ ...prev, [interviewer.id]: true }))
      setTimeout(() => setSavedIds(prev => ({ ...prev, [interviewer.id]: false })), 2500)
    } catch (err) {
      alert(`Save failed: ${err.message}`)
    } finally {
      setSavingIds(prev => ({ ...prev, [interviewer.id]: false }))
    }
  }

  const handleDelete = async (interviewer) => {
    if (!window.confirm(`Remove ${interviewer.name}?`)) return
    try {
      const { error } = await db
        .from('interviewers')
        .delete()
        .eq('id', interviewer.id)
      if (error) { alert(`Could not delete: ${error.message}`); return }
      const updated = interviewers.filter(i => i.id !== interviewer.id)
      setInterviewers(updated)
      saveCache(updated)
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      const { data, error } = await db.rpc('add_interviewer', {
        p_name: newName.trim(),
        p_email: newEmail.trim() || '',
      })
      if (error) { alert(`Could not add: ${error.message}`); return }
      const newRecord = Array.isArray(data) ? data[0] : data
      if (!newRecord) {
        alert('Interviewer may have been added. Refreshing list.')
        await fetchInterviewers()
        return
      }
      const updated = [...interviewers, newRecord].sort((a, b) => a.name.localeCompare(b.name))
      setInterviewers(updated)
      saveCache(updated)
      setEditEmails(prev => ({ ...prev, [newRecord.id]: newRecord.email || '' }))
      setNewName('')
      setNewEmail('')
      setShowAdd(false)
    } catch (err) {
      alert(`Add failed: ${err.message}`)
    } finally {
      setAdding(false)
    }
  }

  const emailChanged = (interviewer) =>
    (editEmails[interviewer.id] ?? interviewer.email ?? '') !== (interviewer.email ?? '')

  if (!isOpen) return null

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1998 }} />
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, width:'440px',
        background:'#ffffff', zIndex:1999, display:'flex', flexDirection:'column',
        boxShadow:'-8px 0 32px rgba(29,37,103,0.18)', fontFamily:'DM Sans, sans-serif',
      }}>
        {/* Header */}
        <div style={{
          background:'linear-gradient(180deg, #1c2452 0%, #141928 100%)',
          padding:'20px 24px', flexShrink:0,
          display:'flex', alignItems:'flex-start', justifyContent:'space-between',
        }}>
          <div>
            <div style={{ fontWeight:700, fontSize:'16px', color:'#ffffff' }}>Manage Interviewers</div>
            <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.5)', marginTop:'3px' }}>
              People who conduct ASPIRE interviews. Separate from app login accounts.
            </div>
          </div>
          <button onClick={onClose} style={{
            background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'8px',
            width:'32px', height:'32px', display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', color:'#ffffff', flexShrink:0,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
          <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'16px', lineHeight:1.5 }}>
            Interviewers appear in the availability manager and rubric dropdown.
            Email addresses are used for scheduling notifications.
          </div>

          {loading && interviewers.length === 0 && (
            <div style={{ textAlign:'center', padding:'32px', color:'#9ca3af', fontSize:'13px' }}>Loading...</div>
          )}

          {/* Interviewer list */}
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            {interviewers.map(interviewer => (
              <div key={interviewer.id} style={{ border:'1px solid #f3f4f6', borderRadius:'12px', padding:'14px 16px', background:'#fafafa' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <input
                      type="color"
                      value={interviewer.color || '#1D2567'}
                      title="Interviewer color"
                      style={{ width:'22px', height:'22px', border:'none', background:'none', cursor:'pointer', padding:0, borderRadius:'4px' }}
                      onChange={async (e) => {
                        const newColor = e.target.value
                        await db.rpc('update_interviewer_color', {
                          p_id: interviewer.id,
                          p_color: newColor,
                        })
                        const updated = interviewers.map(i =>
                          i.id === interviewer.id ? { ...i, color: newColor } : i
                        )
                        setInterviewers(updated)
                        saveCache(updated)
                      }}
                    />
                    <span style={{ fontWeight:700, fontSize:'14px', color:'#1D2567' }}>{interviewer.name}</span>
                  </div>
                  <button onClick={() => handleDelete(interviewer)} style={{
                    background:'none', border:'none', cursor:'pointer', color:'#dc1e34',
                    padding:'4px', borderRadius:'6px', display:'flex', alignItems:'center',
                  }}>
                    <Trash2 size={14} />
                  </button>
                </div>

                <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                  <input
                    type="email"
                    value={editEmails[interviewer.id] ?? interviewer.email ?? ''}
                    onChange={e => setEditEmails(prev => ({ ...prev, [interviewer.id]: e.target.value }))}
                    placeholder="Email address"
                    style={{
                      flex:1, padding:'8px 12px',
                      border:`1px solid ${emailChanged(interviewer) ? '#9FAFF8' : '#e5e7eb'}`,
                      borderRadius:'8px', fontFamily:'DM Sans', fontSize:'13px',
                      outline:'none', color:'#374151',
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEmail(interviewer) }}
                  />
                  {emailChanged(interviewer) && (
                    <button
                      onClick={() => handleSaveEmail(interviewer)}
                      disabled={savingIds[interviewer.id]}
                      style={{
                        padding:'8px 14px', borderRadius:'8px',
                        background: savedIds[interviewer.id] ? '#dcfce7' : '#1D2567',
                        border:'none', cursor:'pointer', flexShrink:0,
                        display:'flex', alignItems:'center', gap:'5px',
                        fontFamily:'DM Sans', fontWeight:600, fontSize:'12px',
                        color: savedIds[interviewer.id] ? '#166534' : '#ffffff',
                        transition:'all 0.2s ease',
                      }}
                    >
                      {savingIds[interviewer.id]
                        ? <Loader size={13} />
                        : savedIds[interviewer.id]
                        ? <><Check size={13} /> Saved</>
                        : <><Save size={13} /> Save</>}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add Interviewer */}
          <div style={{ marginTop:'20px' }}>
            {!showAdd ? (
              <button onClick={() => setShowAdd(true)} style={{
                width:'100%', padding:'11px',
                background:'#f3f4ff', border:'1.5px dashed #9FAFF8', borderRadius:'10px',
                cursor:'pointer', fontFamily:'DM Sans', fontWeight:600, fontSize:'13px',
                color:'#1D2567', display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
              }}>
                <Plus size={15} /> Add Interviewer
              </button>
            ) : (
              <div style={{ border:'1px solid #e0e7ff', borderRadius:'12px', padding:'16px', background:'#f8faff' }}>
                <div style={{ fontWeight:700, fontSize:'13px', color:'#1D2567', marginBottom:'12px' }}>New Interviewer</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                  <input placeholder="Full name *" value={newName} onChange={e => setNewName(e.target.value)}
                    style={{ width:'100%', padding:'10px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontFamily:'DM Sans', fontSize:'13px', outline:'none', boxSizing:'border-box' }} />
                  <input placeholder="Email address (optional)" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                    style={{ width:'100%', padding:'10px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontFamily:'DM Sans', fontSize:'13px', outline:'none', boxSizing:'border-box' }} />
                  <div style={{ display:'flex', gap:'8px' }}>
                    <button onClick={() => { setShowAdd(false); setNewName(''); setNewEmail('') }} style={{
                      flex:1, padding:'9px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px',
                      fontFamily:'DM Sans', fontSize:'13px', cursor:'pointer',
                    }}>Cancel</button>
                    <button onClick={handleAdd} disabled={adding || !newName.trim()} style={{
                      flex:2, padding:'9px', border:'none', borderRadius:'8px',
                      background: !newName.trim() ? '#e5e7eb' : '#1D2567',
                      fontFamily:'DM Sans', fontWeight:700, fontSize:'13px', color:'#ffffff',
                      cursor: newName.trim() ? 'pointer' : 'default',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
                    }}>
                      {adding ? <Loader size={13} /> : <Plus size={13} />}
                      {adding ? 'Adding...' : 'Add Interviewer'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
