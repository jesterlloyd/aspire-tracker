import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin    from '@fullcalendar/daygrid'
import timeGridPlugin   from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { X, Trash2, CheckCircle, Clock } from 'lucide-react'
import CalendarSidebar from './CalendarSidebar'
import { toLocalDateStr } from '../lib/designTokens'

const hexToRgba = (hex, alpha) => {
  if (!hex || !hex.startsWith('#')) return `rgba(29,37,103,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Popover: Create Block ────────────────────────────────────────────────────
function CreatePopover({ date, startTime, endTime, position, interviewerProfiles, isAdmin, cohortId, userProfile, onSave, onClose }) {
  const [form, setForm] = useState({
    block_date:       date || '',
    start_time:       startTime || '09:00',
    end_time:         endTime   || '12:00',
    duration_minutes: 30,
    interviewer_name: !isAdmin && userProfile?.can_conduct_interviews
      ? userProfile.full_name
      : (interviewerProfiles[0]?.full_name || ''),
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const handleSave = async () => {
    if (!form.block_date || !form.start_time || !form.end_time) {
      setError('Please fill in all fields.'); return
    }
    const [sh, sm] = form.start_time.split(':').map(Number)
    const [eh, em] = form.end_time.split(':').map(Number)
    if (eh * 60 + em <= sh * 60 + sm) {
      setError('End time must be after start time.'); return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/availability', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:             'create_block',
          cohort_id:          cohortId,
          interviewer_name:   form.interviewer_name,
          block_date:         form.block_date,
          start_time:         form.start_time,
          end_time:           form.end_time,
          duration_minutes:   form.duration_minutes,
          created_by_user_id: userProfile?.id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      onSave(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px',
    border: '1px solid #e5e7eb', borderRadius: '8px',
    fontFamily: 'DM Sans', fontSize: '13px',
    outline: 'none', boxSizing: 'border-box', color: '#374151',
  }
  const labelStyle = {
    fontFamily: 'DM Sans', fontWeight: 600, fontSize: '11px', color: '#6b7280',
    display: 'block', marginBottom: '4px',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  }

  const slotCount = (() => {
    if (!form.start_time || !form.end_time || !form.duration_minutes) return 0
    const [sh, sm] = form.start_time.split(':').map(Number)
    const [eh, em] = form.end_time.split(':').map(Number)
    const total = eh * 60 + em - (sh * 60 + sm)
    return total > 0 ? Math.floor(total / form.duration_minutes) : 0
  })()

  return (
    <div style={{
      position: 'fixed',
      top:  Math.min(position.y, window.innerHeight - 440),
      left: Math.min(position.x, window.innerWidth  - 300),
      width: '280px', background: '#ffffff',
      borderRadius: '16px', zIndex: 9999,
      boxShadow: '0 8px 40px rgba(29,37,103,0.22)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
          Add Availability
        </span>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px',
          width: '26px', height: '26px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', color: '#ffffff',
        }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" value={form.block_date}
            onChange={e => setForm(p => ({ ...p, block_date: e.target.value }))}
            style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label style={labelStyle}>Start</label>
            <input type="time" value={form.start_time}
              onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End</label>
            <input type="time" value={form.end_time}
              onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))}
              style={inputStyle} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Slot Duration</label>
          <select value={form.duration_minutes}
            onChange={e => setForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) }))}
            style={inputStyle}>
            <option value={15}>15 minutes</option>
            <option value={20}>20 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Interviewer</label>
          {isAdmin ? (
            <select value={form.interviewer_name}
              onChange={e => setForm(p => ({ ...p, interviewer_name: e.target.value }))}
              style={inputStyle}>
              <option value="">Select interviewer...</option>
              {interviewerProfiles.map(p => (
                <option key={p.id} value={p.full_name}>{p.full_name}</option>
              ))}
            </select>
          ) : (
            <div style={{ ...inputStyle, background: '#f9fafb', color: '#374151', fontWeight: 600 }}>
              {userProfile?.full_name || '—'}
            </div>
          )}
        </div>

        {slotCount > 0 && (
          <div style={{
            background: '#f0f3ff', borderRadius: '8px', padding: '8px 12px',
            fontFamily: 'DM Sans', fontSize: '12px', color: '#1D2567',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <CheckCircle size={13} color="#1D2567" />
            {slotCount} slot{slotCount !== 1 ? 's' : ''} will be created
          </div>
        )}

        {error && (
          <div style={{
            background: '#fef2f2', borderRadius: '8px', padding: '8px 12px',
            fontSize: '12px', color: '#991b1b', fontFamily: 'DM Sans',
          }}>
            {error}
          </div>
        )}

        <button onClick={handleSave} disabled={saving} style={{
          width: '100%', padding: '10px',
          background: saving ? '#e5e7eb' : '#1D2567',
          border: 'none', borderRadius: '10px',
          fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#ffffff',
          cursor: saving ? 'default' : 'pointer',
        }}>
          {saving ? 'Creating...' : 'Create Block'}
        </button>
      </div>
    </div>
  )
}

// ─── Popover: Block Details ───────────────────────────────────────────────────
function BlockPopover({ block, slots, position, canDelete, onDelete, onCancelBooking, onClose }) {
  const booked     = slots.filter(s => s.is_booked)
  const openCount  = slots.filter(s => !s.is_booked).length
  const [deleting,   setDeleting]   = useState(false)
  const [cancelling, setCancelling] = useState(null)

  const handleDelete = async () => {
    if (booked.length > 0) {
      alert(`Cancel all ${booked.length} booking${booked.length !== 1 ? 's' : ''} first before deleting this block.`)
      return
    }
    if (!window.confirm('Delete this availability block?')) return
    setDeleting(true)
    await onDelete(block.id)
    setDeleting(false)
  }

  const handleCancelBooking = async (slot) => {
    const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
    const name = student ? `${student.first_name} ${student.last_name}` : 'this student'
    if (!window.confirm(`Cancel ${name}'s booking?`)) return
    setCancelling(slot.id)
    await onCancelBooking(slot)
    setCancelling(null)
  }

  return (
    <div style={{
      position: 'fixed',
      top:  Math.min(position.y, window.innerHeight - 360),
      left: Math.min(position.x, window.innerWidth  - 270),
      width: '260px', background: '#ffffff',
      borderRadius: '14px', zIndex: 9999,
      boxShadow: '0 8px 32px rgba(29,37,103,0.20)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: block.color || '#1D2567',
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#ffffff' }}>
            {block.interviewer_name || 'ASPIRE Team'}
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>
            {new Date(block.block_date + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
            })} · {block.start_time} – {block.end_time}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '6px',
          width: '26px', height: '26px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', color: '#ffffff',
        }}>
          <X size={13} />
        </button>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Slot counts */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1, background: '#f0fdf4', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '20px', color: '#166534' }}>{openCount}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: '10px', color: '#16a34a' }}>Open</div>
          </div>
          <div style={{ flex: 1, background: '#eff6ff', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '20px', color: '#1e40af' }}>{booked.length}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: '10px', color: '#3b82f6' }}>Booked</div>
          </div>
        </div>

        {/* Booked students */}
        {booked.length > 0 && (
          <div>
            <div style={{
              fontFamily: 'DM Sans', fontWeight: 600, fontSize: '11px', color: '#6b7280',
              textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px',
            }}>Booked Students</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {booked.map(slot => {
                const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
                const name = student ? `${student.first_name} ${student.last_name}` : 'Unknown'
                const time = slot.slot_time
                  ? new Date(`2000-01-01T${slot.slot_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : '—'
                return (
                  <div key={slot.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', background: '#f8f9ff', borderRadius: '8px',
                  }}>
                    <div>
                      <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#374151' }}>{name}</div>
                      <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: '#9ca3af' }}>{time}</div>
                    </div>
                    {canDelete && (
                      <button
                        onClick={() => handleCancelBooking(slot)}
                        disabled={cancelling === slot.id}
                        title="Cancel booking"
                        style={{
                          background: cancelling === slot.id ? '#f3f4f6' : '#fef2f2',
                          border: '1px solid #fecaca', borderRadius: '6px',
                          padding: '4px 8px', fontFamily: 'DM Sans', fontWeight: 600,
                          fontSize: '10px', color: '#dc2626',
                          cursor: cancelling === slot.id ? 'default' : 'pointer',
                        }}
                      >
                        {cancelling === slot.id ? '...' : 'Cancel'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Delete block */}
        {canDelete && (
          <button onClick={handleDelete} disabled={deleting} style={{
            width: '100%', padding: '9px',
            background: deleting ? '#f3f4f6' : '#fef2f2',
            border: '1px solid #fecaca', borderRadius: '8px',
            fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#dc2626',
            cursor: deleting ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}>
            <Trash2 size={13} />
            {deleting ? 'Deleting...' : 'Delete Block'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Popover: Day Overview ────────────────────────────────────────────────────
function DayPopover({ date, blocks, slots, colorMap, position, canDelete, onDeleteBlock, onAddNew, onClose }) {
  const [deleting, setDeleting] = useState(null)

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const handleDelete = async (block) => {
    const blockSlots  = slots.filter(s => s.block_id === block.id)
    const bookedCount = blockSlots.filter(s => s.is_booked).length
    if (bookedCount > 0) {
      alert(`Cancel ${bookedCount} booking${bookedCount !== 1 ? 's' : ''} before deleting this block.`)
      return
    }
    if (!window.confirm(`Delete ${block.interviewer_name}'s block (${block.start_time}–${block.end_time})?`)) return
    setDeleting(block.id)
    await onDeleteBlock(block.id)
    setDeleting(null)
  }

  return (
    <div style={{
      position: 'fixed',
      top:  Math.max(10, Math.min(position.y - 20, window.innerHeight - 440)),
      left: Math.max(10, Math.min(position.x + 8, window.innerWidth - 320)),
      width: '300px', background: '#ffffff',
      borderRadius: '16px', zIndex: 9999,
      boxShadow: '0 8px 40px rgba(29,37,103,0.22)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
            {dateLabel}
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
            {blocks.length} block{blocks.length !== 1 ? 's' : ''} scheduled
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px',
          width: '26px', height: '26px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', color: '#ffffff',
        }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {blocks.map(block => {
          const blockSlots  = slots.filter(s => s.block_id === block.id)
          const openCount   = blockSlots.filter(s => !s.is_booked).length
          const bookedCount = blockSlots.filter(s => s.is_booked).length
          const color       = colorMap[block.interviewer_name] || '#1D2567'

          return (
            <div key={block.id} style={{ border: '1px solid #f3f4f6', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{
                background: color, padding: '8px 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '12px', color: '#ffffff' }}>
                    {block.interviewer_name}
                  </div>
                  <div style={{ fontFamily: 'DM Sans', fontSize: '10px', color: 'rgba(255,255,255,0.75)' }}>
                    {block.start_time} – {block.end_time} · {block.duration_minutes}min slots
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{
                    background: 'rgba(255,255,255,0.2)',
                    fontFamily: 'DM Sans', fontWeight: 700, fontSize: '10px', color: '#ffffff',
                    padding: '2px 7px', borderRadius: '20px',
                  }}>
                    {openCount} open · {bookedCount} booked
                  </span>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(block)}
                      disabled={deleting === block.id}
                      title="Delete block"
                      style={{
                        background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px',
                        width: '24px', height: '24px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: deleting === block.id ? 'default' : 'pointer', color: '#ffffff',
                      }}
                    >
                      {deleting === block.id ? <span style={{ fontSize: '10px' }}>...</span> : <Trash2 size={11} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        <button
          onClick={() => onAddNew(date)}
          style={{
            width: '100%', padding: '9px',
            background: '#f3f4ff', border: '1.5px dashed #c7d2fe',
            borderRadius: '10px', cursor: 'pointer',
            fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#1D2567',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            marginTop: '2px',
          }}
        >
          + Add availability for this day
        </button>
      </div>
    </div>
  )
}

// ─── Main Calendar ────────────────────────────────────────────────────────────
export default function InterviewCalendar({ cohortId, activeCohort, onDataChanged, onInterviewersLoaded }) {
  const { userProfile, isAdmin } = useAuth()
  const calendarRef = useRef(null)

  const [createPopover, setCreatePopover] = useState(null)
  const [blockPopover,  setBlockPopover]  = useState(null)
  const [dayPopover,    setDayPopover]    = useState(null)
  const [selectedDate,   setSelectedDate]   = useState(() => toLocalDateStr())
  const [activeFilter,   setActiveFilter]   = useState(null)
  const [calendarTitle,  setCalendarTitle]  = useState('')
  const [currentView,    setCurrentView]    = useState('dayGridMonth')

  // Calendar data — cached; refetchOnWindowFocus handles visibility changes
  const myName = userProfile?.full_name
  const { data: calData, refetch: fetchData } = useQuery({
    queryKey: ['interview_calendar', cohortId, isAdmin ? 'admin' : myName],
    queryFn:  async () => {
      const [blocksRes, slotsRes, profilesRes] = await Promise.all([
        supabase.from('interview_availability_blocks')
          .select('*').eq('cohort_id', cohortId).eq('is_active', true),
        supabase.from('interview_slots')
          .select(`*, students!booked_by_student_id (id, first_name, last_name, school)`)
          .eq('cohort_id', cohortId),
        supabase.rpc('get_active_interviewers'),
      ])
      const profiles = profilesRes.data || []
      const cm = {}
      profiles.forEach(p => { cm[p.full_name] = p.interviewer_color || '#1D2567' })
      let allBlocks = blocksRes.data || []
      let allSlots  = slotsRes.data  || []
      if (!isAdmin && myName) {
        allBlocks = allBlocks.filter(b => b.interviewer_name === myName)
        allSlots  = allSlots.filter(s => s.interviewer_name  === myName)
      }
      return { blocks: allBlocks, slots: allSlots, profiles, colorMap: cm }
    },
    enabled: !!cohortId,
  })

  const blocks             = calData?.blocks   || []
  const slots              = calData?.slots    || []
  const interviewerProfiles = calData?.profiles || []
  const colorMap           = calData?.colorMap || {}

  // Notify parent when profiles load (for the legend row)
  useEffect(() => {
    if (interviewerProfiles.length > 0) onInterviewersLoaded?.(interviewerProfiles)
  }, [interviewerProfiles]) // eslint-disable-line

  const calendarEvents = (blocks || []).flatMap(block => {
    const blockSlots  = (slots || []).filter(s => s.block_id === block.id)
    const bookedSlots = blockSlots.filter(s => s.is_booked)
    const openSlots   = blockSlots.filter(s => !s.is_booked)
    const color       = colorMap[block.interviewer_name] || '#1D2567'
    const firstName   = block.interviewer_name?.split(' ')[0] || 'ASPIRE'

    const bookedEvents = bookedSlots.map(slot => {
      const student     = Array.isArray(slot.students) ? slot.students[0] : slot.students
      const studentName = student ? `${student.first_name} ${student.last_name}` : 'Booked'
      const timeStr     = slot.slot_time
        ? new Date(`2000-01-01T${slot.slot_time}`).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
        : ''
      return {
        id:    `booked-${slot.id}`,
        title: studentName,
        start: `${slot.slot_date}T${slot.slot_time || '00:00'}`,
        end:   `${slot.slot_date}T${slot.slot_time || '00:00'}`,
        backgroundColor: 'transparent',
        borderColor:     'transparent',
        extendedProps:   {
          type: 'booked', color, interviewer: firstName,
          interviewerFullName: block.interviewer_name || '',
          studentName, time: timeStr, flag: slot.interview_flag || null, slot, block,
        },
      }
    })

    const availabilityEvent = openSlots.length > 0 ? {
      id:    block.id,
      title: `${openSlots.length} open · ${firstName}`,
      start: `${block.block_date}T${block.start_time}`,
      end:   `${block.block_date}T${block.end_time}`,
      backgroundColor: 'transparent',
      borderColor:     'transparent',
      extendedProps:   {
        type: 'availability', color, interviewer: firstName,
        interviewerFullName: block.interviewer_name || '',
        openCount: openSlots.length,
        startTime: block.start_time
          ? new Date(`2000-01-01T${block.start_time}`).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
          : '',
        block, blockSlots,
      },
    } : null

    return [...(availabilityEvent ? [availabilityEvent] : []), ...bookedEvents]
  })

  const handleDateClick = (info) => {
    const clickedDate = info.dateStr.split('T')[0]
    const currentView = calendarRef.current?.getApi()?.view?.type
    const isWeekView  = currentView === 'timeGridWeek'

    setBlockPopover(null)
    setDayPopover(null)

    if (isWeekView) {
      const clickedTime = info.dateStr.includes('T')
        ? info.dateStr.split('T')[1].slice(0, 5)
        : '09:00'
      const [h, m] = clickedTime.split(':').map(Number)
      const endH   = Math.min(h + 2, 19)
      const endTime = `${endH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
      setCreatePopover({
        date:      clickedDate,
        startTime: clickedTime,
        endTime,
        position:  { x: info.jsEvent.clientX, y: info.jsEvent.clientY },
      })
    } else {
      const dayBlocks = blocks.filter(b => b.block_date === clickedDate)
      if (dayBlocks.length > 0) {
        setDayPopover({
          date:     clickedDate,
          blocks:   dayBlocks,
          position: { x: info.jsEvent.clientX, y: info.jsEvent.clientY },
        })
      } else {
        setCreatePopover({
          date:     clickedDate,
          position: { x: info.jsEvent.clientX, y: info.jsEvent.clientY },
        })
      }
    }
  }

  const handleEventClick = (info) => {
    info.jsEvent.stopPropagation()
    setCreatePopover(null)
    setDayPopover(null)

    const { type, block, blockSlots, color } = info.event.extendedProps

    if (type === 'booked') {
      // Show block popover with all slots so user can cancel the booking
      const allBlockSlots = (slots || []).filter(s => s.block_id === block.id)
      setBlockPopover({
        block: { ...block, color },
        slots: allBlockSlots,
        position: { x: info.jsEvent.clientX + 8, y: info.jsEvent.clientY - 20 },
      })
      return
    }

    setBlockPopover({
      block: { ...block, color },
      slots: blockSlots,
      position: { x: info.jsEvent.clientX + 8, y: info.jsEvent.clientY - 20 },
    })
  }

  const handleSaveBlock = () => {
    setCreatePopover(null)
    setDayPopover(null)
    setTimeout(() => fetchData(), 300)
    onDataChanged?.()
  }

  const handleDeleteBlock = async (blockId) => {
    console.log('handleDeleteBlock called with:', blockId)
    if (!blockId) {
      alert('Error: No block ID found. Please close this popover and try again.')
      return
    }
    const res  = await fetch('/api/availability', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_block', block_id: blockId }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); return }
    setBlockPopover(null)
    fetchData()
    onDataChanged?.()
  }

  const handleCancelBooking = async (slot) => {
    const studentId = slot.booked_by_student_id
    const student   = Array.isArray(slot.students) ? slot.students[0] : slot.students
    const name      = student ? `${student.first_name} ${student.last_name}` : 'this student'

    if (!studentId) { alert('No student linked to this slot.'); return }

    if (!window.confirm(`Cancel ${name}'s booking? Their status will return to Form Received.`)) return

    try {
      const res = await fetch('/api/availability', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:       'cancel_booking',
          slot_id:      slot.id,
          student_id:   studentId,
          cohort_id:    cohortId,
          cancelled_by: userProfile?.full_name || 'Coordinator',
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert(`Could not cancel: ${data.error}`); return }
      setBlockPopover(null)
      fetchData()
      onDataChanged?.()
    } catch (err) {
      alert(`Cancel failed: ${err.message}`)
    }
  }

  const canDeleteBlock = (block) =>
    isAdmin ||
    block.created_by_user_id === userProfile?.id ||
    block.interviewer_name   === userProfile?.full_name

  const closeAll = () => { setCreatePopover(null); setBlockPopover(null); setDayPopover(null) }

  const handleMiniCalendarSelect = (dateStr) => {
    setSelectedDate(dateStr)
    if (calendarRef.current) calendarRef.current.getApi().gotoDate(dateStr)
  }

  const handleDatesSet = (info) => {
    setCalendarTitle(info.view.title)
    setCurrentView(info.view.type)
  }

  const handleAddAvailabilityClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCreatePopover({
      date:     selectedDate || toLocalDateStr(),
      position: {
        x: Math.max(8, rect.right - 280),
        y: rect.bottom + 8,
      },
    })
  }

  const renderEventContent = (info) => {
    const { type, color, interviewerFullName, openCount, startTime, time, flag } = info.event.extendedProps
    const ic = color || '#1D2567'

    // Helpers for compact month-view labels
    const fmtShort = (t) => t ? t.replace(/\s*(AM|PM)$/i, '').trim() : ''
    const ivInitials = (name) => {
      if (!name) return ''
      const parts = name.trim().split(/\s+/)
      return ((parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '')).toUpperCase()
    }

    // Single-line compact pill — 18px, time-first format
    const pill = (bg, border, textColor, label, opacity = 1) => (
      <div style={{
        borderRadius: '4px', padding: '0 5px', margin: '0 2px', cursor: 'pointer',
        overflow: 'hidden', width: '100%', boxSizing: 'border-box',
        height: '18px', lineHeight: '18px', display: 'block',
        background: bg, borderLeft: `3px solid ${border}`, opacity,
        fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10.5px',
        color: textColor, whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        letterSpacing: '-0.01em',
      }}>{label}</div>
    )

    if (type === 'availability') {
      const t = fmtShort(startTime)
      return pill('#DBEAFE', ic, '#1E3A8A', `${t ? t + ' ' : ''}Open`)
    }

    if (type === 'booked') {
      const t = fmtShort(time)
      const iv = ivInitials(interviewerFullName)
      if (flag === 'no_show')
        return pill('#FEE2E2', '#EF4444', '#7F1D1D', `${t} ✗`)
      if (flag === 'cancelled')
        return pill('#E5E7EB', '#9CA3AF', '#374151', `${t} ✗`, 0.75)
      if (flag === 'needs_reschedule' || flag === 'rescheduled')
        return pill('#FEF3C7', '#F59E0B', '#78350F', `${t} ↺`)
      // default scheduled
      return pill('#D1FAE5', ic, '#065F46', iv ? `${t} ${iv}` : t)
    }

    return (
      <div style={{ fontFamily:'DM Sans', fontSize:'10px', fontWeight:600, padding:'2px 6px', color:'#374151', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        {info.event.title}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      {(createPopover || blockPopover || dayPopover) && (
        <div onClick={closeAll} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
      )}

      {/* Single unified calendar module */}
      <div style={{
        display: 'flex', background: '#ffffff',
        borderRadius: '16px', border: '1px solid #f3f4f6',
        boxShadow: '0 2px 12px rgba(29,37,103,0.07)',
        overflow: 'hidden', marginBottom: '12px',
      }}>
        {/* Left sidebar panel */}
        <div style={{
          width: '260px', flexShrink: 0,
          borderRight: '1px solid #f3f4f6',
          padding: '20px 18px',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}>
          <CalendarSidebar
            blocks={blocks}
            slots={slots}
            selectedDate={selectedDate}
            onSelectDate={handleMiniCalendarSelect}
          />
        </div>

        {/* Right calendar panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Custom Calendar Toolbar */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 12px', borderBottom:'1px solid #f3f4f6' }}>

            {/* Left: prev/next + Today */}
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <div style={{ display:'flex', alignItems:'center', border:'1px solid #e5e7eb', borderRadius:'9px', overflow:'hidden', height:'32px' }}>
                <button
                  onClick={() => calendarRef.current?.getApi().prev()}
                  style={{ width:'34px', height:'32px', background:'none', border:'none', borderRight:'1px solid #e5e7eb', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#374151', transition:'background 0.15s ease' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  title="Previous"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button
                  onClick={() => calendarRef.current?.getApi().next()}
                  style={{ width:'34px', height:'32px', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#374151', transition:'background 0.15s ease' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  title="Next"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
              <button
                onClick={() => calendarRef.current?.getApi().today()}
                style={{ height:'32px', padding:'0 14px', background:'none', border:'1px solid #e5e7eb', borderRadius:'9px', cursor:'pointer', fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#374151', transition:'all 0.15s ease' }}
                onMouseEnter={e => { e.currentTarget.style.background='#f9fafb'; e.currentTarget.style.borderColor='#d1d5db' }}
                onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.borderColor='#e5e7eb' }}
              >Today</button>
            </div>

            {/* Center: title */}
            <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'15px', color:'#1D2567', letterSpacing:'-0.01em' }}>
              {calendarTitle}
            </div>

            {/* Right: Add Availability + Month/Week toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <button
                onClick={handleAddAvailabilityClick}
                style={{ height:'32px', padding:'0 14px', background:'#1D2567', border:'none', borderRadius:'9px', cursor:'pointer', fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#ffffff', display:'flex', alignItems:'center', gap:'6px', transition:'background 0.15s ease' }}
                onMouseEnter={e => e.currentTarget.style.background = '#141928'}
                onMouseLeave={e => e.currentTarget.style.background = '#1D2567'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Availability
              </button>

              <div style={{ display:'flex', alignItems:'center', background:'#f3f4f6', borderRadius:'9px', padding:'3px', gap:'2px', height:'32px', boxSizing:'border-box' }}>
                {[{ view:'dayGridMonth', label:'Month' }, { view:'timeGridWeek', label:'Week' }].map(({ view, label }) => {
                  const isActive = currentView === view
                  return (
                    <button
                      key={view}
                      onClick={() => { calendarRef.current?.getApi().changeView(view); setCurrentView(view) }}
                      style={{ height:'26px', padding:'0 14px', background: isActive ? '#1D2567' : 'transparent', border:'none', borderRadius:'7px', fontFamily:'DM Sans', fontWeight: isActive ? 700 : 500, fontSize:'12px', color: isActive ? '#ffffff' : '#6b7280', cursor:'pointer', transition:'all 0.15s ease', whiteSpace:'nowrap' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#e5e7eb' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >{label}</button>
                  )
                })}
              </div>
            </div>
          </div>

          <style>{`
            .fc { font-family: 'DM Sans', sans-serif; }

            /* Fixed cell heights — every row identical */
            .fc-daygrid-body tbody tr { height: 88px; }
            .fc-daygrid-day { overflow: hidden !important; }
            .fc-daygrid-day-frame { height: 88px !important; overflow: hidden !important; box-sizing: border-box; }
            .fc-daygrid-day-events { overflow: hidden; max-height: 55px; }

            /* Today: outlined number */
            .fc-day-today { background: #f8f9ff !important; }
            .fc-day-today .fc-daygrid-day-number {
              border: 1.5px solid #1D2567; color: #1D2567; border-radius: 50%;
              width: 24px; height: 24px; padding: 0;
              display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;
              background: transparent;
            }

            /* Selected day: filled number + cool-tint background */
            .fc-day-selected { background: #F5F7FB !important; border: 1px solid #C7D2FE !important; }
            .fc-day-selected .fc-daygrid-day-number {
              background: #1D2567 !important; color: #ffffff !important; border: none !important;
              border-radius: 50%; width: 24px; height: 24px; padding: 0;
              display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;
            }
            /* Today + selected: filled with ring */
            .fc-day-today.fc-day-selected .fc-daygrid-day-number {
              box-shadow: 0 0 0 2px rgba(29,37,103,0.2);
            }

            .fc-daygrid-day-number { font-weight: 600; font-size: 12px; color: #374151; padding: 4px 6px; }
            .fc-col-header-cell-cushion {
              font-weight: 700; font-size: 10px; text-transform: uppercase;
              letter-spacing: 0.06em; color: #6b7280;
            }
            .fc-daygrid-day { position: relative !important; }
            .fc-daygrid-day:hover { background: #f8f9ff !important; cursor: pointer; }
            .fc-daygrid-day:not(.fc-day-other):not(:has(.fc-daygrid-event)):hover::after {
              content: '+ Add availability';
              position: absolute; bottom: 6px; left: 50%;
              transform: translateX(-50%);
              font-family: 'DM Sans', sans-serif; font-size: 9px; font-weight: 600;
              color: #c7d2fe; white-space: nowrap; pointer-events: none;
              opacity: 0; animation: fadeInHint 0.2s ease forwards;
            }
            @keyframes fadeInHint { from { opacity: 0; } to { opacity: 1; } }
            .fc-daygrid-event-harness { margin-bottom: 2px !important; }
            .fc-daygrid-event {
              border: none !important; background: transparent !important;
              box-shadow: none !important; margin-bottom: 2px !important; padding: 0 !important;
            }
            .fc-event-title-container { width: 100%; }

            /* +N more overflow link */
            .fc-more-link {
              font-family: 'DM Sans', sans-serif !important; font-size: 11px !important;
              font-weight: 500 !important; color: #1D2567 !important;
              padding: 0 4px !important; border-radius: 3px !important;
            }
            .fc-more-link:hover { color: #4338ca !important; background: #e0e7ff !important; }
            .fc-popover { border-radius: 10px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important; }
            .fc-popover-header {
              font-family: 'DM Sans', sans-serif !important; font-size: 12px !important;
              font-weight: 700 !important; padding: 8px 12px !important;
              background: #1D2567 !important; color: #ffffff !important; border-radius: 10px 10px 0 0 !important;
            }

            .fc-timegrid-slot { cursor: pointer; height: 32px !important; }
            .fc-timegrid-slot:hover { background: #f0f3ff !important; }
            .fc-timegrid-slot-label { font-size: 10px !important; color: #9ca3af !important; }
            .fc th, .fc td { border-color: #f3f4f6 !important; }
          `}</style>

          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            datesSet={handleDatesSet}
            events={calendarEvents}
            eventContent={renderEventContent}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            height={432}
            slotMinTime="07:00:00"
            slotMaxTime="19:00:00"
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            expandRows={true}
            dayMaxEvents={2}
            moreLinkText={n => `+${n} more`}
            moreLinkClick={(info) => {
              const d = info.date
              const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
              const dayBlocks = (blocks || []).filter(b => b.block_date === dateStr)
              setCreatePopover(null); setBlockPopover(null)
              setDayPopover({ date: dateStr, blocks: dayBlocks, position: { x: info.jsEvent.clientX + 8, y: info.jsEvent.clientY - 20 } })
              return 'stop'
            }}
            dayCellClassNames={(arg) => {
              const d = arg.date
              const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
              return dateStr === selectedDate ? ['fc-day-selected'] : []
            }}
            nowIndicator={true}
            allDaySlot={false}
            scrollTime="08:00:00"
          />
        </div>
      </div>


      {createPopover && (
        <CreatePopover
          date={createPopover.date}
          startTime={createPopover.startTime}
          endTime={createPopover.endTime}
          position={createPopover.position}
          interviewerProfiles={interviewerProfiles}
          isAdmin={isAdmin}
          cohortId={cohortId}
          userProfile={userProfile}
          onSave={handleSaveBlock}
          onClose={closeAll}
        />
      )}

      {blockPopover && (
        <BlockPopover
          block={blockPopover.block}
          slots={blockPopover.slots}
          position={blockPopover.position}
          canDelete={canDeleteBlock(blockPopover.block)}
          onDelete={handleDeleteBlock}
          onCancelBooking={handleCancelBooking}
          onClose={closeAll}
        />
      )}

      {dayPopover && (
        <DayPopover
          date={dayPopover.date}
          blocks={dayPopover.blocks}
          slots={slots}
          colorMap={colorMap}
          position={dayPopover.position}
          canDelete={isAdmin}
          onDeleteBlock={async (blockId) => {
            await handleDeleteBlock(blockId)
            const remaining = blocks.filter(b => b.block_date === dayPopover.date && b.id !== blockId)
            if (remaining.length === 0) setDayPopover(null)
            else setDayPopover(prev => ({ ...prev, blocks: remaining }))
          }}
          onAddNew={(date) => {
            setDayPopover(null)
            setCreatePopover({ date, position: { x: 280, y: 120 } })
          }}
          onClose={closeAll}
        />
      )}
    </div>
  )
}
