import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin    from '@fullcalendar/daygrid'
import timeGridPlugin   from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { X, Trash2, CheckCircle, Clock } from 'lucide-react'
import CalendarSidebar from './CalendarSidebar'
import { CanonicalCalendarNav, CanonicalWeekdayHeader } from './shared/CanonicalCalendarFoundation'
import InterviewDayDrawer from './InterviewDayDrawer'
import AspireEventModal from './AspireEventModal'
import { toLocalDateStr } from '../lib/designTokens'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen } from '../lib/aspireEvents'
import { computeLegendPlacement } from './statusLegendPlacement'

// A zero-size rect at a viewport point, so a click position can anchor a popover the same way a
// trigger element's getBoundingClientRect() does (both feed computeLegendPlacement).
const rectFromPoint = (x, y) => ({ top: y, bottom: y, left: x, right: x, width: 0, height: 0 })
import { getUsHolidaysForRange } from '../lib/usHolidays'

// ASPIRE-EVENTS-CALENDAR-2B: local 'YYYY-MM-DD' for a Date (calendar range bounds).
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Distinct ASPIRE-event chip - filled left-accent bar + type color (never looks like an interview
// slot's pastel capacity card). Clicking opens the event modal (edit for owner/admin, else read-only).
function AspireEventChip({ ev, compact = false, onClick }) {
  const color = eventColor(ev)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(ev) }}
      title={`${ev.title}, ${eventTypeLabel(ev.event_type)}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left',
        background: hexToRgba(color, 0.12), borderLeft: `3px solid ${color}`,
        borderTop: 'none', borderRight: 'none', borderBottom: 'none',
        borderRadius: 4, padding: compact ? '1px 5px' : '3px 7px', cursor: 'pointer',
        overflow: 'hidden', fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {ev.is_milestone && <span style={{ color, fontSize: compact ? 8 : 10, flexShrink: 0 }}>★</span>}
      <span style={{ fontSize: compact ? 9 : 11, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {ev.title}
      </span>
    </button>
  )
}

// ASPIRE-EVENTS-CALENDAR-2B1: day-detail modal for a date's ASPIRE events (opened by clicking blank
// space on a day that has events). Read-only list; clicking an event opens the edit/read-only modal.
// If the day also has interviews, a link opens the existing InterviewDayDrawer (drawer untouched).
function AspireDayDetail({ date, events, isAdmin, hasSlots, onEventClick, onOpenInterviews, onAddEvent, onClose }) {
  const heading = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{heading}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>ASPIRE Events</div>
          {events.map(ev => {
            const color = eventColor(ev)
            return (
              <button key={ev.id} type="button" onClick={() => onEventClick(ev)}
                style={{ textAlign: 'left', border: '1px solid #eef0f2', borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '10px 12px', background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {ev.is_milestone && <span style={{ color, fontSize: 11 }}>★</span>}
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1D2567' }}>{ev.title}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#6b7280' }}>{eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}</div>
                {ev.location && <div style={{ fontSize: 11.5, color: '#6b7280' }}>📍 {ev.location}</div>}
                {ev.url && <div style={{ fontSize: 11.5, color: '#0E7490', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.url}</div>}
                {ev.description && <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.4 }}>{ev.description}</div>}
                {(ev.is_milestone || ev.show_on_welcome) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    {ev.is_milestone && <span style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', background: '#F3EEFE', padding: '1px 7px', borderRadius: 20 }}>Milestone</span>}
                    {ev.show_on_welcome && <span style={{ fontSize: 10, fontWeight: 600, color: '#3730A3', background: '#E0E7FF', padding: '1px 7px', borderRadius: 20 }}>On welcome</span>}
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>{isAdmin ? 'Click to edit' : 'Click to view'}</div>
              </button>
            )
          })}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div>{hasSlots && <button className="btn btn-outline-modal" onClick={onOpenInterviews}>View interview schedule</button>}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {isAdmin && <button className="btn btn-outline-modal" onClick={onAddEvent}>Add event</button>}
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const hexToRgba = (hex, alpha) => {
  if (!hex || !hex.startsWith('#')) return `rgba(29,37,103,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Popover: Create Block ────────────────────────────────────────────────────
function CreatePopover({ date, startTime, endTime, triggerRect, interviewerProfiles, isAdmin, cohortId, userProfile, onSave, onClose }) {
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
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/availability', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

  // Anchor near the trigger (a date cell or the header button) using the shared collision helper:
  // prefer below/beside, flip near a viewport edge, clamp within margins, and bound the height so the
  // body scrolls rather than the popover running off-screen. Recompute on resize/scroll; Escape closes;
  // focus returns to the trigger on close.
  const restoreFocusRef = useRef(typeof document !== 'undefined' ? document.activeElement : null)
  const computePlace = () => computeLegendPlacement({
    rect: triggerRect || rectFromPoint(window.innerWidth / 2, Math.min(180, window.innerHeight / 2)),
    viewportW: window.innerWidth, viewportH: window.innerHeight,
    position: 'bottom-left', margin: 12, gap: 8, desktopWidth: 280,
    maxDesired: Math.min(460, window.innerHeight - 24),
  })
  const [coords, setCoords] = useState(computePlace)
  useEffect(() => {
    const reposition = () => setCoords(computePlace())
    reposition()
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('keydown', onKey)
      restoreFocusRef.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerRect])

  return (
    <div role="dialog" aria-label="Add Availability" style={{
      position: 'fixed',
      top:    coords.top != null ? coords.top : undefined,
      bottom: coords.bottom != null ? coords.bottom : undefined,
      left:   coords.left,
      width:  coords.width,
      maxHeight: coords.maxHeight,
      background: '#ffffff',
      borderRadius: '16px', zIndex: 9999,
      boxShadow: '0 8px 40px rgba(29,37,103,0.22)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
        padding: '14px 16px', flexShrink: 0,
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

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
              {userProfile?.full_name || '-'}
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
                  : '-'
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

// ─── Custom Month Grid ────────────────────────────────────────────────────────
// Resolve slot status: use the status column if present (after migration),
// fall back to is_booked boolean for pre-migration rows.
const getSlotStatus = (s) => s.status || (s.is_booked ? 'booked' : 'available')

function getInitials(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length-1]?.[0] || '') : '')).toUpperCase()
}

// ─── Week View Helpers ─────────────────────────────────────────────────────────
const toMinutes = (t) => {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const minutesToTimeStr = (mins) => {
  const c = Math.max(0, Math.round(mins))
  return `${String(Math.floor(c/60)).padStart(2,'0')}:${String(c%60).padStart(2,'0')}`
}
function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); d.setHours(0,0,0,0); return d
}
function getWeekStart(date) {
  const d = new Date(date); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d
}
function fmtHour(h) {
  if (h === 0)  return '12 AM'
  if (h === 12) return '12 PM'
  return h > 12 ? `${h-12} PM` : `${h} AM`
}
function groupOverlapping(items) {
  const sorted = [...items].sort((a, b) => toMinutes(a._sT) - toMinutes(b._sT))
  const groups = []
  sorted.forEach(item => {
    const last = groups[groups.length - 1]
    if (last && last.some(g => toMinutes(g._eT) > toMinutes(item._sT))) {
      last.push(item)
    } else {
      groups.push([item])
    }
  })
  return groups
}
function slotBg(status) {
  if (status === 'booked')  return { bg:'#DCFCE7', bdr:'#86EFAC', txt:'#065F46' }
  if (status === 'blocked') return { bg:'#FEF3C7', bdr:'#FCD34D', txt:'#92400E' }
  return                           { bg:'#DBEAFE', bdr:'#BFDBFE', txt:'#1E3A8A' }
}

function CustomMonthGrid({ displayDate, blocks, slots, colorMap, selectedDate, onDayClick, onAddAvailability, events = [], onEventClick, isAdmin = false, onAddEvent, holidays = [] }) {
  const [hoveredDate, setHoveredDate] = useState(null)
  const year = displayDate.getFullYear()
  const month = displayDate.getMonth()
  const lastDayNum = new Date(year, month + 1, 0).getDate()
  const startDow = new Date(year, month, 1).getDay()
  const todayStr = new Date().toLocaleDateString('en-CA')
  const toStr = (y, m, d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const cells = []
  const prevMonthDays = new Date(year, month, 0).getDate()
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i
    const [py, pm] = month === 0 ? [year-1, 11] : [year, month-1]
    cells.push({ dateStr: toStr(py, pm, d), day: d, isOtherMonth: true })
  }
  for (let d = 1; d <= lastDayNum; d++) {
    cells.push({ dateStr: toStr(year, month, d), day: d, isOtherMonth: false })
  }
  let nextD = 1
  const [ny, nm] = month === 11 ? [year+1, 0] : [year, month+1]
  while (cells.length < 42) {
    cells.push({ dateStr: toStr(ny, nm, nextD), day: nextD, isOtherMonth: true })
    nextD++
  }

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  return (
    <div>
      <CanonicalWeekdayHeader days={DAYS} />
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)' }}>
        {cells.map((cell, idx) => {
          const { dateStr, day, isOtherMonth } = cell
          if (isOtherMonth) {
            return <div key={idx} style={{ height:88, borderRight:'1px solid #f3f4f6', borderBottom:'1px solid #f3f4f6', background:'#fafafa' }} />
          }

          const daySlots   = (slots||[]).filter(s => s.slot_date === dateStr)
          const dayEvents  = (events||[]).filter(ev => eventOnDate(ev, dateStr))
          const dayHolidays = (holidays||[]).filter(h => h.date === dateStr)
          const scheduled  = daySlots.filter(s => getSlotStatus(s) === 'booked')
          const available  = daySlots.filter(s => getSlotStatus(s) === 'available')
          const blocked    = daySlots.filter(s => getSlotStatus(s) === 'blocked')
          const hasActivity = daySlots.length > 0
          const isFullyBooked = scheduled.length > 0 && available.length === 0 && blocked.length === 0
          const isToday = dateStr === todayStr
          const isSel   = dateStr === selectedDate

          // Unique interviewers from slots on this day
          const ivMap = new Map()
          daySlots.forEach(s => {
            if (s.interviewer_name && !ivMap.has(s.interviewer_name)) {
              ivMap.set(s.interviewer_name, colorMap?.[s.interviewer_name] || '#9CA3AF')
            }
          })
          const interviewers = [...ivMap.entries()]

          // Card tint per dominant state
          const cardBg = isFullyBooked ? '#FEF2F2'
            : blocked.length > 0   ? '#FFF7ED'
            : scheduled.length > 0 ? '#EFF6FF'
            : '#F0FDF4'
          const accentColor = isFullyBooked ? '#7F1D1D'
            : blocked.length > 0   ? '#7C2D12'
            : scheduled.length > 0 ? '#1E3A8A'
            : '#065F46'

          const isHovered = hoveredDate === dateStr

          return (
            <div
              key={dateStr}
              onClick={e => onDayClick(dateStr, hasActivity, dayEvents.length > 0, e.currentTarget.getBoundingClientRect())}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
              style={{
                height:88,
                padding:'5px 6px',
                borderRight:'1px solid #f3f4f6',
                borderBottom:'1px solid #f3f4f6',
                cursor: 'pointer',
                borderLeft: isSel ? '3px solid #1D2567' : '1px solid transparent',
                background: isHovered ? '#f0f4ff' : isSel ? 'rgba(29,37,103,0.04)' : 'transparent',
                display:'flex', flexDirection:'column', gap:3, overflow:'hidden',
                position:'relative',
              }}
            >
              {/* Day number circle */}
              <div style={{
                width:22, height:22, display:'flex', alignItems:'center', justifyContent:'center',
                borderRadius:'50%',
                background: isToday ? '#1D2567' : isSel ? '#1D2567' : 'transparent',
                fontFamily:'DM Sans', fontWeight:600, fontSize:12,
                color: isToday || isSel ? '#fff' : '#374151', flexShrink:0,
              }}>{day}</div>

              {/* US holidays - subtle amber read-only chips (non-interactive; never open the ASPIRE
                  event modal; distinct from ASPIRE events and interview cards). */}
              {dayHolidays.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}>
                  {dayHolidays.slice(0, 1).map(h => (
                    <div key={h.name} title={h.name} onClick={e => e.stopPropagation()}
                      style={{ display:'flex', alignItems:'center', gap:3, background:'#FEF3C7', border:'1px solid #FDE68A', borderRadius:4, padding:'1px 5px', cursor:'default' }}>
                      <span style={{ width:5, height:5, borderRadius:'50%', background:'#D97706', flexShrink:0 }} />
                      <span style={{ fontSize:9, fontWeight:600, color:'#92400E', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{h.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ASPIRE events - distinct filled-accent chips, above the interview capacity card */}
              {dayEvents.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}>
                  {dayEvents.slice(0, 2).map(ev => (
                    <AspireEventChip key={ev.id} ev={ev} compact onClick={onEventClick} />
                  ))}
                  {dayEvents.length > 2 && (
                    <span style={{ fontSize:8, fontWeight:600, color:'#6B7280', paddingLeft:2 }}>+{dayEvents.length - 2} more</span>
                  )}
                </div>
              )}

              {/* Mini capacity card */}
              {hasActivity && (
                <div style={{
                  background: cardBg, borderRadius:5, padding:'3px 5px',
                  display:'flex', flexDirection:'column', gap:1,
                  flex:1, minHeight:0, overflow:'hidden',
                }}>
                  {isFullyBooked ? (
                    <>
                      <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, color:'#930045', lineHeight:1.2 }}>Fully Booked</div>
                      <div style={{ fontFamily:'DM Sans', fontSize:9, color:'#6B7280', lineHeight:1.2 }}>{scheduled.length} interview{scheduled.length!==1?'s':''}</div>
                    </>
                  ) : (
                    <>
                      {scheduled.length > 0 && (
                        <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:600, color:accentColor, lineHeight:1.2 }}>
                          {scheduled.length} scheduled
                        </div>
                      )}
                      {available.length > 0 && (
                        <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:500, color:accentColor, opacity:0.85, lineHeight:1.2 }}>
                          {available.length} available
                        </div>
                      )}
                      {blocked.length > 0 && (
                        <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:500, color:'#9A3412', lineHeight:1.2 }}>
                          {blocked.length} blocked
                        </div>
                      )}
                    </>
                  )}
                  {/* Interviewer initial chips */}
                  {interviewers.length > 0 && (
                    <div style={{ display:'flex', gap:2, marginTop:'auto', flexWrap:'wrap' }}>
                      {interviewers.slice(0,3).map(([name, color]) => (
                        <span key={name} title={name} style={{
                          background:color, color:'#fff',
                          fontSize:8, fontWeight:700,
                          padding:'1px 4px', borderRadius:3, lineHeight:1.3,
                        }}>{getInitials(name)}</span>
                      ))}
                      {interviewers.length > 3 && (
                        <span style={{ fontSize:8, color:'#6B7280', fontWeight:600 }}>+{interviewers.length-3}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Hover quick-add - only on empty cells; active cells use Day Manager's own footer.
                  Owner/admin also get Add Event (prefilled to this date). */}
              {isHovered && daySlots.length === 0 && (
                <div style={{ position:'absolute', bottom:4, right:4, display:'flex', gap:4, alignItems:'center' }}>
                  <button
                    onClick={e => { e.stopPropagation(); onAddAvailability(dateStr, e.currentTarget.getBoundingClientRect()) }}
                    style={{ background:'rgba(29,37,103,0.92)', color:'#fff', border:'none', borderRadius:999, padding:'3px 8px', fontSize:10, fontWeight:600, fontFamily:'DM Sans, sans-serif', cursor:'pointer', boxShadow:'0 2px 6px rgba(0,0,0,0.12)', lineHeight:1.4 }}
                  >
                    + Availability
                  </button>
                  {isAdmin && onAddEvent && (
                    <button
                      onClick={e => { e.stopPropagation(); onAddEvent(dateStr) }}
                      title="Add ASPIRE event"
                      style={{ background:'#7C3AED', color:'#fff', border:'none', borderRadius:999, padding:'3px 8px', fontSize:10, fontWeight:600, fontFamily:'DM Sans, sans-serif', cursor:'pointer', boxShadow:'0 2px 6px rgba(0,0,0,0.12)', lineHeight:1.4 }}
                    >
                      + Event
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Week View ─────────────────────────────────────────────────────────────────
// ── WeekPill - rich booking pill with copy-to-clipboard ────────────────────
function WeekPill({ item, top, height, colW, left, ivColor, onSlotClick, ds }) {
  const [copied, setCopied] = useState(false)
  const s       = slotBg(item._status)
  const student = Array.isArray(item.students) ? item.students[0] : item.students
  const startMins = toMinutes(item._sT)
  const isBooked  = item._status === 'booked'
  const isBlocked = item._status === 'blocked'

  const timeLabel = (() => {
    const h = Math.floor(startMins / 60)
    const m = startMins % 60
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hh   = h % 12 || 12
    return `${hh}${m ? `:${String(m).padStart(2,'0')}` : ''} ${ampm}`
  })()

  const schoolShort = (() => {
    if (!student?.school) return null
    const s = student.school
    if (s.includes('Cal State Long Beach') || s.includes('CSULB')) return 'Cal State LB'
    if (s.includes('Cal State LA') || s.includes('CSULA')) return 'Cal State LA'
    if (s.includes('Cal State Northridge') || s.includes('CSUN')) return 'Cal State NR'
    if (s.includes('West Coast University') && s.includes('North')) return 'WCU NoHo'
    if (s.includes('West Coast University')) return 'WCU Anaheim'
    if (s.includes('Azusa Pacific') || s.includes('APU')) return 'APU'
    if (s.includes('UCLA')) return 'UCLA'
    return s.split(' ').slice(0, 3).join(' ')
  })()

  const handleCopy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(student.school_email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div
      onClick={e => { e.stopPropagation(); onSlotClick(item, ds) }}
      style={{
        position:'absolute', top, height, left, width:colW,
        background: s.bg,
        border:`1px solid ${s.bdr}`,
        borderLeft:`3px solid ${ivColor}`,
        borderRadius:6,
        padding:'7px 8px',
        fontSize:11, color:s.txt,
        cursor:'pointer',
        overflow:'hidden',
        display:'flex', flexDirection:'column', gap:2,
        transition:'box-shadow 0.12s',
        boxSizing:'border-box',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 10px rgba(0,0,0,0.12)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow='none'}
    >
      {/* Row 1: time + interviewer initials */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <span style={{ fontWeight:700, fontSize:11, lineHeight:1 }}>{timeLabel}</span>
        <span style={{
          width:18, height:18, borderRadius:'50%',
          background: ivColor, color:'#fff',
          fontSize:7, fontWeight:800,
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          flexShrink:0,
        }}>
          {getInitials(item.interviewer_name)}
        </span>
      </div>

      {/* Booked: student name + school + email */}
      {isBooked && student && (
        <>
          <div style={{ fontWeight:700, fontSize:12, lineHeight:1.25, color:s.txt, wordBreak:'break-word' }}>
            {student.first_name} {student.last_name}
          </div>
          {schoolShort && (
            <div style={{ fontSize:10, opacity:0.75, lineHeight:1.2 }}>
              {schoolShort}{student.program_type ? ` · ${student.program_type.replace('Accelerated ','Accel. ')}` : ''}
            </div>
          )}
          {student.school_email && (
            <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:1 }}>
              <span style={{ fontSize:10, opacity:0.65, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>
                {student.school_email}
              </span>
              <button
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy email'}
                style={{
                  background: copied ? 'rgba(47,125,92,0.15)' : 'none',
                  border:'none', cursor:'pointer',
                  padding:'1px 3px', borderRadius:3,
                  color: copied ? '#2F7D5C' : 'inherit',
                  opacity: copied ? 1 : 0.55,
                  flexShrink:0,
                  display:'inline-flex', alignItems:'center',
                  transition:'all 0.15s',
                }}
                onMouseEnter={e => { if (!copied) e.currentTarget.style.opacity='1' }}
                onMouseLeave={e => { if (!copied) e.currentTarget.style.opacity='0.55' }}
              >
                {copied ? '✓' : '⎘'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Blocked: label only */}
      {isBlocked && (
        <div style={{ fontSize:10, fontWeight:600, opacity:0.8, lineHeight:1.2 }}>
          {item.blocked_reason || 'Blocked'}
        </div>
      )}

      {/* Available: minimal */}
      {!isBooked && !isBlocked && (
        <div style={{ fontSize:10, opacity:0.7 }}>Open</div>
      )}
    </div>
  )
}

function WeekView({ weekStart, slots, colorMap, onSlotClick, onEmptyClick, events = [], onEventClick }) {
  // Expanded row height so pills have room for 4 lines of content.
  // Outer container (maxHeight:500) is unchanged; users scroll more within it.
  const HOUR_HEIGHT = 140
  const START_HOUR  = 7
  const END_HOUR    = 20
  const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayStr = new Date().toLocaleDateString('en-CA')

  const normalize = (s) => {
    const sT = s.slot_time || s.start_time || '00:00'
    return { ...s, _sT: sT, _eT: minutesToTimeStr(toMinutes(sT) + (s.duration_minutes || 30)), _status: getSlotStatus(s) }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', fontFamily:'DM Sans, sans-serif', border:'1px solid #E5E7EB', borderRadius:8, overflow:'hidden' }}>
      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7, 1fr)', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', flexShrink:0 }}>
        <div />
        {days.map(day => {
          const ds = day.toLocaleDateString('en-CA')
          const isToday = ds === todayStr
          return (
            <div key={ds} style={{ borderLeft:'1px solid #E5E7EB', padding:'8px 0', textAlign:'center' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, color:'#6B7280' }}>
                {day.toLocaleDateString('en-US', { weekday:'short' })}
              </div>
              <div style={{ width:28, height:28, borderRadius:'50%', margin:'4px auto 0', background: isToday ? '#1D2567' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color: isToday ? '#fff' : '#1D2567' }}>
                {day.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* ASPIRE events row - all-day/point program events, kept out of the timed hour grid so they
          never read as interview slots. */}
      {events.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7, 1fr)', background:'#fff', borderBottom:'1px solid #E5E7EB', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:5, fontSize:8, fontWeight:700, letterSpacing:0.4, color:'#9CA3AF', textTransform:'uppercase' }}>Events</div>
          {days.map(day => {
            const ds = day.toLocaleDateString('en-CA')
            const dayEvents = (events||[]).filter(ev => eventOnDate(ev, ds))
            return (
              <div key={ds} style={{ borderLeft:'1px solid #E5E7EB', padding:4, display:'flex', flexDirection:'column', gap:3, minHeight:26 }}>
                {dayEvents.slice(0, 3).map(ev => <AspireEventChip key={ev.id} ev={ev} onClick={onEventClick} />)}
                {dayEvents.length > 3 && <span style={{ fontSize:9, fontWeight:600, color:'#6B7280' }}>+{dayEvents.length - 3}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Scrollable body - outer maxHeight unchanged; inner rows taller */}
      <div style={{ overflowY:'auto', maxHeight:500 }}>
        <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7, 1fr)' }}>
          {/* Hour labels */}
          <div>
            {HOURS.map(h => (
              <div key={h} style={{ height:HOUR_HEIGHT, borderBottom:'1px solid #F3F4F6', display:'flex', alignItems:'flex-start', justifyContent:'flex-end', paddingRight:5, paddingTop:5, fontSize:9, color:'#9CA3AF', fontWeight:600, letterSpacing:0.2 }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const ds = day.toLocaleDateString('en-CA')
            const daySlots = (slots||[]).filter(s => s.slot_date === ds).map(normalize)
            const groups   = groupOverlapping(daySlots)

            return (
              <div
                key={ds}
                style={{ borderLeft:'1px solid #E5E7EB', position:'relative', height: HOURS.length * HOUR_HEIGHT, cursor:'pointer' }}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const rawMins = (y / (HOURS.length * HOUR_HEIGHT)) * (END_HOUR - START_HOUR) * 60 + START_HOUR * 60
                  const snapped = Math.floor(rawMins / 30) * 30
                  const sT = minutesToTimeStr(Math.min(snapped, (END_HOUR-1)*60))
                  const eT = minutesToTimeStr(Math.min(toMinutes(sT) + 120, END_HOUR*60))
                  onEmptyClick(ds, sT, eT, rectFromPoint(e.clientX, e.clientY))
                }}
              >
                {/* Half-hour sub-lines */}
                {HOURS.map(h => (
                  <div key={h}>
                    <div style={{ position:'absolute', top:(h-START_HOUR)*HOUR_HEIGHT, left:0, right:0, height:HOUR_HEIGHT/2, borderBottom:'1px dashed #F3F4F6', pointerEvents:'none' }} />
                    <div style={{ position:'absolute', top:(h-START_HOUR)*HOUR_HEIGHT + HOUR_HEIGHT/2, left:0, right:0, height:HOUR_HEIGHT/2, borderBottom:'1px solid #F3F4F6', pointerEvents:'none' }} />
                  </div>
                ))}

                {groups.flatMap((group, gi) =>
                  group.map((item, idx) => {
                    const startMins = toMinutes(item._sT)
                    const endMins   = toMinutes(item._eT)
                    const top    = ((startMins - START_HOUR*60) / 60) * HOUR_HEIGHT
                    const height = Math.max(36, ((endMins - startMins) / 60) * HOUR_HEIGHT - 3)
                    const colW   = `calc((100% - ${group.length*2+2}px) / ${group.length})`
                    const left   = `calc(${idx} * (${colW} + 2px) + 2px)`
                    const ivColor = colorMap?.[item.interviewer_name] || '#9CA3AF'

                    return (
                      <WeekPill
                        key={item.id || `${gi}-${idx}`}
                        item={item}
                        top={top}
                        height={height}
                        colW={colW}
                        left={left}
                        ivColor={ivColor}
                        onSlotClick={onSlotClick}
                        ds={ds}
                      />
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Main Calendar ────────────────────────────────────────────────────────────
export default function InterviewCalendar({ cohortId, activeCohort, onDataChanged, onInterviewersLoaded, scheduleScope }) {
  const { userProfile, isAdmin } = useAuth()
  const calendarRef = useRef(null)
  const queryClient = useQueryClient()

  const [createPopover, setCreatePopover] = useState(null)
  const [blockPopover,  setBlockPopover]  = useState(null)
  const [selectedDate,   setSelectedDate]   = useState(() => toLocalDateStr())
  const [activeFilter,   setActiveFilter]   = useState(null)
  const [calendarTitle,  setCalendarTitle]  = useState('')
  const [currentView,    setCurrentView]    = useState('dayGridMonth')
  const [displayDate,       setDisplayDate]       = useState(() => new Date())
  const [weekStart,         setWeekStart]         = useState(() => getWeekStart(new Date()))
  const [dayDrawerDate,     setDayDrawerDate]     = useState(null)
  const [highlightedSlotId, setHighlightedSlotId] = useState(null)
  const [eventModal,        setEventModal]        = useState(null) // ASPIRE event create/edit/detail
  const [eventDayDetail,    setEventDayDetail]    = useState(null) // date string → ASPIRE day-detail modal

  const myName = userProfile?.full_name

  // Calendar data - blocks, slots, and interviewers in one cached query
  const { data: calData, refetch: fetchData } = useQuery({
    queryKey: ['interview_calendar', cohortId, isAdmin ? 'admin' : myName, scheduleScope || 'default'],
    queryFn: async () => {
      const [blocksRes, slotsRes, profilesRes] = await Promise.all([
        supabase.from('interview_availability_blocks')
          .select('*').eq('cohort_id', cohortId).eq('is_active', true),
        supabase.from('interview_slots')
          .select(`*, students!booked_by_student_id (id, first_name, last_name, school, school_email, program_type), interview_sessions!slot_id (id, teams_meeting_booked, teams_invite_sent_at)`)
          .eq('cohort_id', cohortId)
          .order('slot_date', { ascending: true })
          .order('slot_time', { ascending: true }),
        supabase.rpc('get_active_interviewers'),
      ])
      const profiles = profilesRes.data || []
      const cm = {}
      profiles.forEach(p => { cm[p.full_name] = p.interviewer_color || '#1D2567' })
      let allBlocks = blocksRes.data || []
      let allSlots  = slotsRes.data  || []
      // 'mine': show only current user's blocks (regardless of role)
      // 'all': show everyone's (regardless of role)
      // no scope prop: fall back to original role-based behavior
      const effectiveScope = scheduleScope || (isAdmin ? 'all' : 'mine')
      if (effectiveScope === 'mine' && myName) {
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

  // ─── ASPIRE custom events - separate query keyed by the visible range (never touches the
  // interview_calendar query). Active events only; writes go through the gated endpoint. ─────────
  const eventsRange = useMemo(() => {
    if (currentView === 'timeGridWeek') {
      return { from: ymd(weekStart), to: ymd(addDays(weekStart, 6)) }
    }
    const first = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1)
    const gridStart = addDays(first, -first.getDay())
    return { from: ymd(gridStart), to: ymd(addDays(gridStart, 41)) }
  }, [currentView, weekStart, displayDate])

  const { data: aspireEventsData } = useQuery({
    queryKey: ['aspire_events', eventsRange.from, eventsRange.to],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/aspire-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'list', from: eventsRange.from, to: eventsRange.to }),
      })
      if (!res.ok) return { events: [], recurrence_enabled: false }
      const json = await res.json().catch(() => ({}))
      return { events: json.events || [], recurrence_enabled: json.recurrence_enabled === true }
    },
    enabled: !!eventsRange.from,
  })
  const aspireEvents = aspireEventsData?.events || []
  // Server capability: recurrence is enabled only when the Owner migration is applied (fail-closed).
  const recurrenceEnabled = aspireEventsData?.recurrence_enabled === true
  const openEvent = (ev) => setEventModal({ event: ev })

  // US holidays for the visible range - computed client-side, read-only, never persisted.
  const holidays = useMemo(() => getUsHolidaysForRange(eventsRange.from, eventsRange.to), [eventsRange.from, eventsRange.to])

  // Notify parent when profiles load (for the legend row in InterviewRubricTab)
  useEffect(() => {
    if (interviewerProfiles.length > 0) onInterviewersLoaded?.(interviewerProfiles)
  }, [interviewerProfiles]) // eslint-disable-line
  // refetchOnWindowFocus: true in QueryClient config replaces the old visibilitychange listener

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

  // ─── Toolbar Navigation ───────────────────────────────────────────────────
  const navPrev = () => {
    if (currentView === 'dayGridMonth') {
      setDisplayDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    } else {
      setWeekStart(prev => addDays(prev, -7))
    }
  }
  const navNext = () => {
    if (currentView === 'dayGridMonth') {
      setDisplayDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
    } else {
      setWeekStart(prev => addDays(prev, 7))
    }
  }
  const navToday = () => {
    const today = new Date()
    setDisplayDate(new Date(today.getFullYear(), today.getMonth(), 1))
    setWeekStart(getWeekStart(today))
    setSelectedDate(toLocalDateStr(today))
    setHighlightedSlotId(null)
  }

  const handleDateClick = (info) => {
    const clickedDate = info.dateStr.split('T')[0]
    const currentView = calendarRef.current?.getApi()?.view?.type
    const isWeekView = currentView === 'timeGridWeek'

    setBlockPopover(null)

    if (isWeekView) {
      // existing week view logic (open CreatePopover with time)
      const clickedTime = info.dateStr.includes('T') ? info.dateStr.split('T')[1].slice(0, 5) : '09:00'
      const [h, m] = clickedTime.split(':').map(Number)
      const endH = Math.min(h + 2, 19)
      const endTime = `${endH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
      setCreatePopover({ date: clickedDate, startTime: clickedTime, endTime, triggerRect: rectFromPoint(info.jsEvent.clientX, info.jsEvent.clientY) })
    } else {
      // Month view: open drawer if day has blocks/slots; else open CreatePopover
      const dayBlocks = (blocks || []).filter(b => b.block_date === clickedDate)
      const daySlots = (slots || []).filter(s => s.slot_date === clickedDate)
      setSelectedDate(clickedDate)
      if (dayBlocks.length > 0 || daySlots.length > 0) {
        setDayDrawerDate(clickedDate)
      } else {
        setCreatePopover({ date: clickedDate, triggerRect: rectFromPoint(info.jsEvent.clientX, info.jsEvent.clientY) })
      }
    }
  }

  const handleEventClick = (info) => {
    info.jsEvent.stopPropagation()
    setCreatePopover(null)
    setBlockPopover(null)

    const { type, block, blockSlots, slot } = info.event.extendedProps
    const dateStr = block?.block_date
    if (!dateStr) return

    // Week view event click → open the Day Management drawer for that date.
    // Highlight the specific slot so the drawer scrolls to it and pulses.
    setSelectedDate(dateStr)
    setDayDrawerDate(dateStr)
    if (type === 'booked' && slot?.id) {
      setHighlightedSlotId(slot.id)
    } else if (type === 'availability' && blockSlots?.length > 0) {
      setHighlightedSlotId(blockSlots[0]?.id || null)
    } else {
      setHighlightedSlotId(null)
    }
  }

  const handleSaveBlock = () => {
    setCreatePopover(null)
    setTimeout(() => fetchData(), 300)   // fetchData is now refetch() from useQuery
    onDataChanged?.()
  }

  const handleDeleteBlock = async (blockId) => {
    console.log('handleDeleteBlock called with:', blockId)
    if (!blockId) {
      alert('Error: No block ID found. Please close this popover and try again.')
      return
    }
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res  = await fetch('/api/availability', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/availability', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

  const closeAll = () => { setCreatePopover(null); setBlockPopover(null); setDayDrawerDate(null); setHighlightedSlotId(null) }

  const handleMiniCalendarSelect = (dateStr) => {
    setSelectedDate(dateStr)
    const d = new Date(dateStr + 'T12:00:00')
    setDisplayDate(new Date(d.getFullYear(), d.getMonth(), 1))
    setWeekStart(getWeekStart(d))
  }

  const handleDatesSet = (info) => {
    setCalendarTitle(info.view.title)
    setCurrentView(info.view.type)
  }

  const handleAddAvailabilityClick = (e) => {
    // Anchor the popover to the header button; the placement helper handles below/above + clamping.
    setCreatePopover({
      date:        selectedDate || toLocalDateStr(),
      triggerRect: e.currentTarget.getBoundingClientRect(),
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

    // Single-line compact pill - 18px, time-first format
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

  // Derive display title
  const monthTitle = displayDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const weekEnd = addDays(weekStart, 6)
  const weekTitle = weekStart.getFullYear() === weekEnd.getFullYear() && weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.toLocaleDateString('en-US', { month:'long', day:'numeric' })} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : `${weekStart.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}`
  const displayTitle = currentView === 'dayGridMonth' ? monthTitle : weekTitle

  return (
    <div style={{ position: 'relative' }}>
      {(createPopover || blockPopover) && (
        <div onClick={closeAll} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
      )}

      {/* Single unified calendar module */}
      <div style={{
        display: 'flex', background: '#ffffff',
        borderRadius: '16px', border: '1px solid #f3f4f6',
        boxShadow: '0 2px 12px rgba(29,37,103,0.07)',
        overflow: 'hidden', marginBottom: '12px',
      }}>
        {/* Left sidebar panel - fixed height so TODAY pills can't push the card taller */}
        <div style={{
          width: '260px', flexShrink: 0,
          borderRight: '1px solid #f3f4f6',
          padding: '20px 18px',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          maxHeight: '620px',
        }}>
          <CalendarSidebar
            blocks={blocks}
            slots={slots}
            aspireEvents={aspireEvents}
            selectedDate={selectedDate}
            onSelectDate={handleMiniCalendarSelect}
          />
        </div>

        {/* Right calendar panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Custom Calendar Toolbar */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 12px', borderBottom:'1px solid #f3f4f6' }}>

            {/* Left: prev/next + Today. Rendered through the shared CanonicalCalendarNav
                so the main app and the Unit Leader calendar are one visual system. */}
            <CanonicalCalendarNav onPrev={navPrev} onNext={navNext} onToday={navToday} />

            {/* Center: title + filtered pill */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'15px', color:'#1D2567', letterSpacing:'-0.01em' }}>
                {displayTitle}
              </span>
              {scheduleScope === 'mine' && (
                <span style={{ fontSize:11, fontWeight:500, color:'#475467', padding:'3px 9px', borderRadius:999, background:'#EDEEF4', border:'1px solid rgba(29,37,103,0.08)', fontFamily:'DM Sans, sans-serif' }}>
                  Filtered to my blocks
                </span>
              )}
            </div>

            {/* Right: Add Event (owner/admin) + Add Availability + Month/Week toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              {isAdmin && (
                <button
                  onClick={() => setEventModal({ event: null, defaultDate: selectedDate })}
                  title="Add a custom ASPIRE event"
                  style={{ height:'32px', padding:'0 14px', background:'#1D2567', border:'none', borderRadius:'9px', cursor:'pointer', fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#ffffff', display:'flex', alignItems:'center', gap:'6px', transition:'background 0.15s ease' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141928'}
                  onMouseLeave={e => e.currentTarget.style.background = '#1D2567'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add Event
                </button>
              )}
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
                      onClick={() => {
                        if (view === 'timeGridWeek' && currentView === 'dayGridMonth') {
                          setWeekStart(getWeekStart(displayDate))
                          setCurrentView('timeGridWeek')
                        } else if (view === 'dayGridMonth') {
                          setCurrentView('dayGridMonth')
                        }
                      }}
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

            /* Fixed cell heights - every row identical */
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

          {/* Month view: custom grid */}
          {currentView === 'dayGridMonth' && (
            <CustomMonthGrid
              displayDate={displayDate}
              blocks={blocks}
              slots={slots}
              colorMap={colorMap}
              selectedDate={selectedDate}
              onDayClick={(dateStr, hasActivity, hasEvents, rect) => {
                setSelectedDate(dateStr)
                setHighlightedSlotId(null)
                if (hasEvents) {
                  // Date has ASPIRE events → open the ASPIRE day detail (links to interviews if present).
                  setEventDayDetail(dateStr)
                } else if (hasActivity) {
                  setDayDrawerDate(dateStr) // interviews only - existing behavior unchanged
                } else {
                  setCreatePopover({ date: dateStr, triggerRect: rect })
                }
              }}
              onAddAvailability={(dateStr, rect) => {
                setCreatePopover({ date: dateStr, triggerRect: rect })
              }}
              events={aspireEvents}
              onEventClick={openEvent}
              isAdmin={isAdmin}
              onAddEvent={(dateStr) => { setSelectedDate(dateStr); setEventModal({ event: null, defaultDate: dateStr }) }}
              holidays={holidays}
            />
          )}

          {/* Week view: custom time-positioned grid */}
          {currentView === 'timeGridWeek' && (
            <WeekView
              weekStart={weekStart}
              slots={slots}
              colorMap={colorMap}
              onSlotClick={(slot, dateStr) => {
                setSelectedDate(dateStr)
                setDayDrawerDate(dateStr)
                setHighlightedSlotId(slot.id)
              }}
              onEmptyClick={(dateStr, startTime, endTime, rect) => {
                setCreatePopover({ date: dateStr, startTime, endTime, triggerRect: rect })
              }}
              events={aspireEvents}
              onEventClick={openEvent}
            />
          )}

          {/* FullCalendar - kept hidden; no longer used for rendering */}
          <div style={{ display:'none' }}>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={false}
              datesSet={handleDatesSet}
              events={[]}
              height={0}
            />
          </div>
        </div>
      </div>


      {createPopover && (
        <CreatePopover
          date={createPopover.date}
          startTime={createPopover.startTime}
          endTime={createPopover.endTime}
          triggerRect={createPopover.triggerRect}
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

      {dayDrawerDate && (
        <InterviewDayDrawer
          date={dayDrawerDate}
          cohortId={cohortId}
          blocks={(blocks||[]).filter(b => b.block_date === dayDrawerDate)}
          slots={(slots||[]).filter(s => s.slot_date === dayDrawerDate)}
          colorMap={colorMap}
          isAdmin={isAdmin}
          userProfile={userProfile}
          highlightedSlotId={highlightedSlotId}
          onClose={() => { setDayDrawerDate(null); setHighlightedSlotId(null) }}
          onDeleteBlock={handleDeleteBlock}
          onCancelBooking={handleCancelBooking}
          onRefresh={fetchData}
          onAddAvailability={(date) => {
            setDayDrawerDate(null)
            // The drawer is closing, so anchor to a stable top-right point (no persistent trigger el).
            setCreatePopover({ date, triggerRect: rectFromPoint(window.innerWidth - 160, 140) })
          }}
        />
      )}

      {eventDayDetail && (
        <AspireDayDetail
          date={eventDayDetail}
          events={(aspireEvents || []).filter(ev => eventOnDate(ev, eventDayDetail))}
          isAdmin={isAdmin}
          hasSlots={(slots || []).some(s => s.slot_date === eventDayDetail)}
          onEventClick={(ev) => { setEventDayDetail(null); openEvent(ev) }}
          onOpenInterviews={() => { const d = eventDayDetail; setEventDayDetail(null); setDayDrawerDate(d) }}
          onAddEvent={() => { const d = eventDayDetail; setEventDayDetail(null); setEventModal({ event: null, defaultDate: d }) }}
          onClose={() => setEventDayDetail(null)}
        />
      )}

      {eventModal && (
        <AspireEventModal
          event={eventModal.event}
          canManage={isAdmin}
          defaultDate={eventModal.defaultDate}
          recurrenceEnabled={recurrenceEnabled}
          onClose={() => setEventModal(null)}
          onSaved={() => { setEventModal(null); queryClient.invalidateQueries({ queryKey: ['aspire_events'] }) }}
        />
      )}
    </div>
  )
}
