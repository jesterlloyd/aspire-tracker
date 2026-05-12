import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const TIME_SLOTS_15 = []
for (let h = 7; h <= 18; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 18 && m > 0) break
    TIME_SLOTS_15.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
  }
}

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}

function generateSlotTimes(startTime, endTime, durationMin) {
  const slots = []
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  let curr = sh * 60 + sm
  const end  = eh * 60 + em
  while (curr + durationMin <= end) {
    const h = Math.floor(curr / 60), mn = curr % 60
    slots.push(`${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`)
    curr += durationMin
  }
  return slots
}

export default function AvailabilityManagerModal({ cohortId, onClose, onBlockSaved }) {
  const { userProfile, isAdmin } = useAuth()
  const [blocks,       setBlocks]       = useState([])
  const [interviewers, setInterviewers] = useState([])  // full objects {id,name,email}
  const [saving,       setSaving]       = useState(false)
  const [form,         setForm]         = useState({
    block_date: '', start_time: '09:00', end_time: '12:00',
    interviewer_name: '', duration_minutes: 30,
  })

  // Match current user to their interviewer record by email or name
  const myInterviewerRecord = interviewers.find(i =>
    i.email?.toLowerCase() === userProfile?.email?.toLowerCase() ||
    (i.full_name || i.name)?.toLowerCase() === userProfile?.full_name?.toLowerCase()
  )

  useEffect(() => {
    loadBlocks()

    // Cache-first interviewer fetch
    try {
      const cached = localStorage.getItem('aspire_interviewers_v1')
      if (cached) {
        const data = JSON.parse(cached)
        if (data?.length > 0) setInterviewers(data)
      }
    } catch {}

    supabase.from('user_profiles').select('id, full_name, email, interviewer_color').eq('can_conduct_interviews', true).eq('is_active', true).order('full_name', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) {
          setInterviewers(data)
          try { localStorage.setItem('aspire_interviewers_v1', JSON.stringify(data)) } catch {}
        }
      })
  }, []) // eslint-disable-line

  // Pre-fill form with current user's interviewer name when records load
  useEffect(() => {
    if (myInterviewerRecord) {
      setForm(prev => ({
        ...prev,
        interviewer_name: prev.interviewer_name || myInterviewerRecord.full_name || myInterviewerRecord.name,
      }))
    }
  }, [myInterviewerRecord?.name]) // eslint-disable-line

  const loadBlocks = async () => {
    const { data } = await supabase.from('interview_availability_blocks')
      .select('*').eq('cohort_id', cohortId).order('block_date').order('start_time')
    setBlocks(data || [])
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const previewSlots = form.start_time && form.end_time && form.duration_minutes
    ? generateSlotTimes(form.start_time, form.end_time, Number(form.duration_minutes))
    : []

  const handleAddBlock = async () => {
    if (!form.block_date) { alert('Please select a date.'); return }
    if (!form.start_time || !form.end_time) { alert('Please set a start and end time.'); return }
    if (!form.duration_minutes) { alert('Please set a slot duration.'); return }

    const interviewerName = isAdmin
      ? form.interviewer_name
      : (myInterviewerRecord?.name || userProfile?.full_name || '')
    if (!interviewerName) { alert('Please select an interviewer.'); return }

    const [sh, sm] = form.start_time.split(':').map(Number)
    const [eh, em] = form.end_time.split(':').map(Number)
    if (eh * 60 + em <= sh * 60 + sm) { alert('End time must be after start time.'); return }

    setSaving(true)
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:             'create_block',
          cohort_id:          cohortId,
          interviewer_name:   interviewerName,
          block_date:         form.block_date,
          start_time:         form.start_time,
          end_time:           form.end_time,
          duration_minutes:   form.duration_minutes,
          created_by_user_id: userProfile?.id || null,
        }),
      })
      const data = await response.json()
      if (!response.ok) { alert(`Could not create block: ${data.error}`); return }

      const defaultName = isAdmin ? (form.interviewer_name || '') : (myInterviewerRecord?.name || userProfile?.full_name || '')
      setForm(p => ({ ...p, block_date: '', start_time: '09:00', end_time: '12:00', interviewer_name: defaultName }))
      await loadBlocks()
      onBlockSaved?.()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (block) => {
    await supabase.from('interview_availability_blocks').update({ is_active: !block.is_active }).eq('id', block.id)
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, is_active: !b.is_active } : b))
  }

  const canDeleteBlock = (block) => {
    if (isAdmin) return true
    return block.created_by_user_id === userProfile?.id
  }

  const deleteBlock = async (blockId) => {
    if (!window.confirm('Delete this availability block? Unbooked slots will be removed.')) return
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_block', block_id: blockId }),
      })
      const data = await response.json()
      if (!response.ok) { alert(data.error); return }
      await loadBlocks()
      onBlockSaved?.()
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:720, width:'95%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Interview Availability Manager</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight:'70vh', overflowY:'auto' }}>
          {/* Add block form */}
          <div style={{ background:'var(--sand)', borderRadius:8, padding:'16px 18px', marginBottom:20 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--nightfall)', marginBottom:12 }}>Add Availability Block</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
              <div className="form-field">
                <label className="form-label">Date *</label>
                <input className="form-input" type="date" value={form.block_date} onChange={e => set('block_date', e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">Start Time *</label>
                <select className="form-select" value={form.start_time} onChange={e => set('start_time', e.target.value)}>
                  {TIME_SLOTS_15.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">End Time *</label>
                <select className="form-select" value={form.end_time} onChange={e => set('end_time', e.target.value)}>
                  {TIME_SLOTS_15.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <div className="form-field">
                <label className="form-label">Your Name *</label>
                {isAdmin ? (
                  <select className="form-select" value={form.interviewer_name} onChange={e => set('interviewer_name', e.target.value)}>
                    <option value="">Select interviewer...</option>
                    {interviewers.map(i => <option key={i.id} value={i.full_name || i.name}>{i.full_name || i.name}</option>)}
                  </select>
                ) : (
                  <div style={{ padding:'8px 12px', border:'1px solid #e5e7eb', borderRadius:6, fontSize:13, color:'#374151', background:'#f9fafb' }}>
                    {myInterviewerRecord?.name || userProfile?.full_name || 'Your name'}
                  </div>
                )}
                <div style={{ fontSize:11, color:'#9ca3af', marginTop:3 }}>
                  Students see "ASPIRE Team" on the scheduling page. Internally assigned to you.
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Slot Duration</label>
                <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:6 }}>
                  {[30, 45].map(d => (
                    <label key={d} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
                      <input type="radio" name="duration" checked={Number(form.duration_minutes) === d}
                        onChange={() => set('duration_minutes', d)} />
                      {d} minutes
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {previewSlots.length > 0 && (
              <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:10 }}>
                Preview: <strong>{previewSlots.length} slot{previewSlots.length !== 1 ? 's' : ''}</strong> will be generated —{' '}
                {previewSlots.map(fmtTime).join(', ')}
              </div>
            )}
            <button onClick={handleAddBlock} disabled={saving}
              style={{
                width: '100%', padding: '11px',
                background: saving ? '#e5e7eb' : '#1D2567',
                border: 'none', borderRadius: '10px',
                fontFamily: 'DM Sans', fontWeight: 700,
                fontSize: '13px', color: '#ffffff',
                cursor: saving ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '8px',
              }}>
              {saving ? (
                <>
                  <span style={{
                    width: '12px', height: '12px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', borderRadius: '50%',
                    display: 'inline-block', animation: 'spin 0.8s linear infinite',
                  }} />
                  Creating slots...
                </>
              ) : `+ Add Block${previewSlots.length > 0 ? ` (${previewSlots.length} slots)` : ''}`}
            </button>
          </div>

          {/* Existing blocks — admins see all, interviewers see only their own */}
          {(() => {
            const visibleBlocks = isAdmin
              ? blocks
              : blocks.filter(b =>
                  b.interviewer_name === myInterviewerRecord?.name ||
                  b.interviewer_name === userProfile?.full_name
                )
            return visibleBlocks.length === 0 ? (
            <p style={{ textAlign:'center', color:'var(--text-secondary)', fontSize:14, padding:'16px 0' }}>
              No availability blocks yet. Add one above.
            </p>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--sand)' }}>
                  {['Date','Start','End','Interviewer','Duration','Active',''].map(h => (
                    <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'var(--text-secondary)', fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBlocks.map(b => (
                  <tr key={b.id} style={{ borderBottom:'1px solid var(--border-lt)', opacity: b.is_active ? 1 : 0.5 }}>
                    <td style={{ padding:'8px 10px' }}>{b.block_date}</td>
                    <td style={{ padding:'8px 10px' }}>{fmtTime(b.start_time)}</td>
                    <td style={{ padding:'8px 10px' }}>{fmtTime(b.end_time)}</td>
                    <td style={{ padding:'8px 10px' }}>
                      <span>{b.interviewer_name || 'ASPIRE Team'}</span>
                    </td>
                    <td style={{ padding:'8px 10px' }}>{b.duration_minutes} min</td>
                    <td style={{ padding:'8px 10px' }}>
                      <input type="checkbox" checked={b.is_active} onChange={() => toggleActive(b)} />
                    </td>
                    <td style={{ padding:'8px 10px' }}>
                      {canDeleteBlock(b) && (
                        <button onClick={() => deleteBlock(b.id)}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--cs-red)', fontSize:14 }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          })()}
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline-modal" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
