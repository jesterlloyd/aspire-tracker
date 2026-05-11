import React, { useState, useEffect, useCallback } from 'react'
import { X, Save, Plus, Trash2, Check, Loader } from 'lucide-react'
import { supabase } from '../lib/supabase'

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

// Wraps any Supabase operation with an 8 second timeout
const withTimeout = (promise, ms = 8000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
    ),
  ])

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

    // Background refresh from Supabase
    try {
      const { data, error } = await supabase
        .from('interviewers')
        .select('id, name, email')
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
      const { data, error } = await withTimeout(
        supabase
          .from('interviewers')
          .update({ email: emailToSave })
          .eq('id', interviewer.id)
          .select('id, name, email')
          .single()
      )
      if (error) {
        console.error('Save email error:', JSON.stringify(error))
        alert(`Could not save email.\n\nError: ${error.message}\nCode: ${error.code}`)
        return
      }
      if (!data) {
        alert('Save appeared to succeed but no record was returned. Please refresh.')
        return
      }
      const updated = interviewers.map(i =>
        i.id === interviewer.id ? { ...i, email: emailToSave } : i
      )
      setInterviewers(updated)
      saveCache(updated)
      setSavedIds(prev => ({ ...prev, [interviewer.id]: true }))
      setTimeout(() => setSavedIds(prev => ({ ...prev, [interviewer.id]: false })), 2500)
    } catch (err) {
      console.error('Save email exception:', err)
      alert(`Save failed: ${err.message}`)
    } finally {
      setSavingIds(prev => ({ ...prev, [interviewer.id]: false }))
    }
  }

  const handleDelete = async (interviewer) => {
    if (!window.confirm(`Remove ${interviewer.name} from the interviewers list?`)) return
    try {
      const { error } = await withTimeout(
        supabase.from('interviewers').delete().eq('id', interviewer.id)
      )
      if (error) {
        console.error('Delete error:', JSON.stringify(error))
        alert(`Could not delete ${interviewer.name}.\n\nError: ${error.message}\nCode: ${error.code}`)
        return
      }
      const updated = interviewers.filter(i => i.id !== interviewer.id)
      setInterviewers(updated)
      saveCache(updated)
    } catch (err) {
      console.error('Delete exception:', err)
      alert(`Delete failed: ${err.message}`)
    }
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('interviewers')
          .insert({ name: newName.trim(), email: newEmail.trim() || '' })
          .select('id, name, email')
          .single()
      )
      if (error) {
        console.error('Add error:', JSON.stringify(error))
        alert(`Could not add interviewer.\n\nError: ${error.message}\nCode: ${error.code}`)
        return
      }
      const updated = [...interviewers, data].sort((a, b) => a.name.localeCompare(b.name))
      setInterviewers(updated)
      saveCache(updated)
      setEditEmails(prev => ({ ...prev, [data.id]: data.email || '' }))
      setNewName('')
      setNewEmail('')
      setShowAdd(false)
    } catch (err) {
      console.error('Add exception:', err)
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
                  <span style={{ fontWeight:700, fontSize:'14px', color:'#1D2567' }}>{interviewer.name}</span>
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
