import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}

function getInitials(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length-1]?.[0] || '') : '')).toUpperCase()
}

function MBtn({ variant, disabled, onClick, children, title }) {
  const styles = {
    primary: { background:'#1D2567', color:'#fff', border:'none' },
    outline: { background:'#fff', color:'#1D2567', border:'1px solid #D1D5DB' },
    danger:  { background:'#fff', color:'#991B1B', border:'1px solid #FECACA' },
  }
  const s = styles[variant] || styles.outline
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...s,
        padding:'4px 10px', borderRadius:6,
        fontSize:11, fontWeight:600, cursor: disabled ? 'default' : 'pointer',
        fontFamily:'DM Sans, sans-serif', opacity: disabled ? 0.6 : 1,
        display:'inline-flex', alignItems:'center', gap:4,
      }}
    >{children}</button>
  )
}

export default function InterviewDayDrawer({
  date, blocks, slots, colorMap,
  isAdmin, userProfile,
  onClose, onDeleteBlock, onCancelBooking, onAddAvailability,
}) {
  const [deleting,   setDeleting]   = useState(null)
  const [cancelling, setCancelling] = useState(null)

  if (!date) return null

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  })

  const bookedSlots = (slots||[]).filter(s => s.is_booked)
  const openSlots   = (slots||[]).filter(s => !s.is_booked)

  const canDelete = (block) =>
    isAdmin ||
    block.created_by_user_id === userProfile?.id ||
    block.interviewer_name   === userProfile?.full_name

  const handleDelete = async (block) => {
    const blockSlots = (slots||[]).filter(s => s.block_id === block.id)
    const booked = blockSlots.filter(s => s.is_booked).length
    if (booked > 0) {
      alert(`Cancel ${booked} booking${booked!==1?'s':''} before deleting this block.`)
      return
    }
    if (!window.confirm(`Delete ${block.interviewer_name}'s block (${block.start_time}–${block.end_time})?`)) return
    setDeleting(block.id)
    await onDeleteBlock(block.id)
    setDeleting(null)
  }

  const handleCancel = async (slot) => {
    const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
    const name = student ? `${student.first_name} ${student.last_name}` : 'this student'
    if (!window.confirm(`Cancel ${name}'s booking? Their status will return to Form Received.`)) return
    setCancelling(slot.id)
    await onCancelBooking(slot)
    setCancelling(null)
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.15)', zIndex:59 }} />
      <div style={{
        position:'fixed',
        ...(isMobile
          ? { left:0, right:0, bottom:0, maxHeight:'80vh', borderRadius:'16px 16px 0 0' }
          : { top:0, right:0, bottom:0, width:420 }),
        background:'#fff',
        boxShadow: isMobile ? '0 -4px 24px rgba(0,0,0,0.1)' : '-4px 0 24px rgba(0,0,0,0.08)',
        overflowY:'auto',
        zIndex:60,
        fontFamily:'DM Sans, sans-serif',
      }}>
        {/* Header */}
        <div style={{ padding:'20px 20px 12px', position:'sticky', top:0, background:'#fff', borderBottom:'1px solid #F3F4F6', zIndex:1 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
            <h2 style={{ fontSize:17, fontWeight:700, color:'#1D2567', margin:0, lineHeight:1.3 }}>{dateLabel}</h2>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#6B7280', lineHeight:0, flexShrink:0 }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize:12, color:'#6B7280' }}>
            {bookedSlots.length} interview{bookedSlots.length!==1?'s':''} scheduled · {openSlots.length} slot{openSlots.length!==1?'s':''} open
          </div>
        </div>

        <div style={{ padding:'16px 20px 32px' }}>

          {/* Scheduled Interviews */}
          {bookedSlots.length > 0 && (
            <section style={{ marginBottom:24 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#1D2567' }}>Scheduled Interviews</span>
                <span style={{ background:'#E0E7FF', color:'#3730A3', padding:'1px 7px', borderRadius:999, fontSize:10, fontWeight:600 }}>{bookedSlots.length}</span>
              </div>
              {bookedSlots.map(slot => {
                const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
                const color = colorMap?.[slot.interviewer_name] || '#1D2567'
                return (
                  <div key={slot.id} style={{ padding:'10px 0', borderBottom:'1px solid #F3F4F6', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, color:'#6B7280', marginBottom:2 }}>{fmtTime(slot.slot_time)} · {slot.duration_minutes} min</div>
                      <div style={{ fontSize:13, fontWeight:600, color:'#1D2567' }}>{student ? `${student.first_name} ${student.last_name}` : '—'}</div>
                      {student?.school && <div style={{ fontSize:11, color:'#6B7280', marginTop:1 }}>{student.school}</div>}
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:4 }}>
                        <span style={{ width:13, height:13, borderRadius:'50%', background:color, flexShrink:0, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:8, color:'#fff', fontWeight:700 }}>{getInitials(slot.interviewer_name)}</span>
                        <span style={{ fontSize:11, color:'#6B7280' }}>{slot.interviewer_name}</span>
                      </div>
                    </div>
                    <MBtn variant="danger" disabled={cancelling===slot.id} onClick={() => handleCancel(slot)}>
                      {cancelling===slot.id ? '…' : 'Cancel'}
                    </MBtn>
                  </div>
                )
              })}
            </section>
          )}

          {/* Open Blocks */}
          {(blocks||[]).some(b => (slots||[]).some(s => s.block_id===b.id && !s.is_booked)) && (
            <section style={{ marginBottom:24 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#1D2567' }}>Open Availability Blocks</span>
                <span style={{ background:'#D1FAE5', color:'#065F46', padding:'1px 7px', borderRadius:999, fontSize:10, fontWeight:600 }}>{openSlots.length} open</span>
              </div>
              {(blocks||[]).map(block => {
                const blockOpenSlots = (slots||[]).filter(s => s.block_id===block.id && !s.is_booked)
                if (blockOpenSlots.length === 0) return null
                const color = colorMap?.[block.interviewer_name] || '#1D2567'
                return (
                  <div key={block.id} style={{ padding:'10px 0', borderBottom:'1px solid #F3F4F6', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, color:'#6B7280', marginBottom:4 }}>
                        {fmtTime(block.start_time)} – {fmtTime(block.end_time)}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ width:10, height:10, borderRadius:'50%', background:color, flexShrink:0 }} />
                        <span style={{ fontSize:12, fontWeight:500, color:'#1D2567' }}>{block.interviewer_name}</span>
                      </div>
                      <div style={{ fontSize:11, color:'#6B7280', marginTop:3 }}>
                        {blockOpenSlots.length} open slot{blockOpenSlots.length!==1?'s':''} · {block.duration_minutes} min each
                      </div>
                    </div>
                    {canDelete(block) && (
                      <MBtn variant="danger" disabled={deleting===block.id} onClick={() => handleDelete(block)} title="Delete block">
                        {deleting===block.id ? '…' : <><Trash2 size={11} /> Delete</>}
                      </MBtn>
                    )}
                  </div>
                )
              })}
            </section>
          )}

          {bookedSlots.length === 0 && openSlots.length === 0 && (
            <div style={{ textAlign:'center', padding:'32px 0', color:'#9CA3AF', fontSize:13 }}>No activity on this day</div>
          )}

          {/* Quick Actions */}
          <div style={{ paddingTop:16, borderTop:'1px solid #E5E7EB', marginTop:8 }}>
            <MBtn variant="outline" onClick={() => onAddAvailability(date)} style={{ width:'100%', padding:'10px 14px', fontSize:13, justifyContent:'center' }}>
              + Add Availability for This Day
            </MBtn>
          </div>
        </div>
      </div>
    </>
  )
}
