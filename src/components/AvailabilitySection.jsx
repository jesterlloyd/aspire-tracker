import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
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

export default function AvailabilitySection({ cohortId }) {
  const { userProfile } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [blocks,   setBlocks]   = useState([])
  const [saving,   setSaving]   = useState(false)
  const [form,     setForm]     = useState({
    block_date: '', start_time: '09:00', end_time: '12:00',
    duration_minutes: 30,
  })

  useEffect(() => {
    if (!expanded) return
    loadData()
  }, [expanded, cohortId]) // eslint-disable-line

  const loadData = async () => {
    const { data } = await supabase.from('interview_availability_blocks')
      .select('*').eq('cohort_id', cohortId).order('block_date').order('start_time')
    setBlocks(data || [])
  }

  // Always fetch block count for the header badge (lightweight)
  useEffect(() => {
    if (!cohortId) return
    supabase.from('interview_availability_blocks')
      .select('id', { count:'exact', head:true }).eq('cohort_id', cohortId).eq('is_active', true)
      .then(({ count }) => setActiveCount(count || 0))
  }, [cohortId])

  const [activeCount, setActiveCount] = useState(0)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const previewSlots = form.start_time && form.end_time && form.duration_minutes
    ? generateSlotTimes(form.start_time, form.end_time, Number(form.duration_minutes))
    : []

  const handleAddBlock = async () => {
    if (!userProfile?.full_name) { alert('You must be signed in to create a block.'); return }
    if (!form.block_date || !form.start_time || !form.end_time || previewSlots.length === 0) return
    setSaving(true)
    const { data: block, error } = await safeWrite(
      () => supabase.from('interview_availability_blocks').insert({
        ...form,
        cohort_id:              cohortId,
        duration_minutes:       Number(form.duration_minutes),
        interviewer_name:       userProfile.full_name,
        interviewer_profile_id: userProfile.id,
        created_by_user_id:     userProfile.id,
      }).select().single(),
      { name: 'create availability block' }
    )
    if (!error && block) {
      await safeWrite(
        () => supabase.from('interview_slots').insert(previewSlots.map(t => ({
          block_id:         block.id,
          cohort_id:        cohortId,
          slot_date:        form.block_date,
          slot_time:        t,
          duration_minutes: Number(form.duration_minutes),
          interviewer_name: userProfile.full_name,
          is_booked:        false,
          status:           'available',
        }))),
        { name: 'create interview slots' }
      )
      setActiveCount(c => c + 1)
      setForm(p => ({ ...p, block_date: '', start_time: '09:00', end_time: '12:00' }))
      await loadData()
    }
    setSaving(false)
  }

  const toggleActive = async (block) => {
    await safeWrite(
      () => supabase.from('interview_availability_blocks').update({ is_active: !block.is_active }).eq('id', block.id),
      { name: 'toggle availability block' }
    )
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, is_active: !b.is_active } : b))
    setActiveCount(c => block.is_active ? c - 1 : c + 1)
  }

  const deleteBlock = async (blockId) => {
    await safeWrite(
      () => supabase.from('interview_availability_blocks').delete().eq('id', blockId),
      { name: 'delete availability block' }
    )
    const removed = blocks.find(b => b.id === blockId)
    setBlocks(prev => prev.filter(b => b.id !== blockId))
    if (removed?.is_active) setActiveCount(c => c - 1)
  }

  return (
    <div className="avail-section">
      {/* Header - always visible */}
      <div className="avail-section-hdr" onClick={() => setExpanded(p => !p)}>
        <span className="avail-section-title">Interview Availability</span>
        <span className="avail-section-count">{activeCount} block{activeCount !== 1 ? 's' : ''} active</span>
        <span className="avail-section-chevron">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="avail-section-body">
          {/* Add block form */}
          <div style={{ background:'var(--sand)', borderRadius:6, padding:'12px 14px', marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--nightfall)', marginBottom:10 }}>Add Availability Block</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:8 }}>
              <div className="form-field">
                <label className="form-label" style={{ fontSize:11 }}>Date *</label>
                <input className="form-input" type="date" value={form.block_date} onChange={e => set('block_date', e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label" style={{ fontSize:11 }}>Start</label>
                <select className="form-select" value={form.start_time} onChange={e => set('start_time', e.target.value)}>
                  {TIME_SLOTS_15.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label" style={{ fontSize:11 }}>End</label>
                <select className="form-select" value={form.end_time} onChange={e => set('end_time', e.target.value)}>
                  {TIME_SLOTS_15.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'end', marginBottom:8 }}>
              <div className="form-field">
                <label className="form-label" style={{ fontSize:11 }}>Hosted by</label>
                <div style={{ padding:'8px 12px', border:'1px solid #e5e7eb', borderRadius:6, fontSize:13, color:'#1D2567', background:'#F4F1EC', fontWeight:500 }}>
                  {userProfile?.full_name || '-'}
                </div>
              </div>
              <div style={{ display:'flex', gap:12, padding:'0 0 4px' }}>
                {[30, 45].map(d => (
                  <label key={d} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, cursor:'pointer' }}>
                    <input type="radio" name="avail-dur" checked={Number(form.duration_minutes) === d} onChange={() => set('duration_minutes', d)} />
                    {d} min
                  </label>
                ))}
              </div>
            </div>
            {previewSlots.length > 0 && (
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:8 }}>
                Preview: <strong>{previewSlots.length} slot{previewSlots.length !== 1 ? 's' : ''}</strong>, {previewSlots.map(fmtTime).join(', ')}
              </div>
            )}
            <button className="btn btn-primary" style={{ fontSize:12 }}
              disabled={saving || !form.block_date || previewSlots.length === 0}
              onClick={handleAddBlock}>
              {saving ? 'Saving…' : `+ Add Block${previewSlots.length > 0 ? ` (${previewSlots.length} slots)` : ''}`}
            </button>
          </div>

          {/* Blocks table */}
          {blocks.length === 0 ? (
            <p style={{ fontSize:13, color:'var(--text-secondary)', padding:'8px 0' }}>No availability blocks yet.</p>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--sand)' }}>
                  {['Date','Start','End','Interviewer','Duration','Active',''].map(h => (
                    <th key={h} className="aspire-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blocks.map(b => (
                  <tr key={b.id} style={{ borderBottom:'1px solid var(--border-lt)', opacity: b.is_active ? 1 : 0.45 }}>
                    <td style={{ padding:'6px 8px' }}>{b.block_date}</td>
                    <td style={{ padding:'6px 8px' }}>{fmtTime(b.start_time)}</td>
                    <td style={{ padding:'6px 8px' }}>{fmtTime(b.end_time)}</td>
                    <td style={{ padding:'6px 8px' }}>{b.interviewer_name || 'ASPIRE Team'}</td>
                    <td style={{ padding:'6px 8px' }}>{b.duration_minutes} min</td>
                    <td style={{ padding:'6px 8px' }}>
                      <input type="checkbox" checked={b.is_active} onChange={() => toggleActive(b)} />
                    </td>
                    <td style={{ padding:'6px 8px' }}>
                      <button onClick={() => deleteBlock(b.id)}
                        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--cs-red)', fontSize:13 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
