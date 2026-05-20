import React, { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toLocalDateStr } from '../lib/designTokens'

// ─── Mini Calendar ────────────────────────────────────────────────────────────
function MiniCalendar({ blocks, slots, selectedDate, onSelectDate }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const activeDays = useMemo(() => {
    const days = new Set()
    ;(blocks || []).forEach(b => { if (b.block_date) days.add(b.block_date) })
    ;(slots  || []).filter(s => s.is_booked).forEach(s => { if (s.slot_date) days.add(s.slot_date) })
    return days
  }, [blocks, slots])

  const daysInMonth    = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate()
  const firstDayOfWeek = new Date(viewMonth.year, viewMonth.month, 1).getDay()

  const cells = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const monthLabel = new Date(viewMonth.year, viewMonth.month, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const go = (dir) => setViewMonth(p => {
    const raw = p.month + dir
    return { month: ((raw % 12) + 12) % 12, year: p.year + Math.floor(raw / 12) }
  })

  return (
    <div>
      <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'10px' }}>
        Mini Calendar
      </div>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
        <button onClick={() => go(-1)} style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280', padding:'2px', display:'flex' }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'12px', color:'#1D2567' }}>{monthLabel}</span>
        <button onClick={() => go(1)} style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280', padding:'2px', display:'flex' }}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', marginBottom:'4px' }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', color:'#d1d5db', textAlign:'center', paddingBottom:'3px' }}>{d}</div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'2px' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />
          const mm      = String(viewMonth.month + 1).padStart(2, '0')
          const dd      = String(day).padStart(2, '0')
          const dateStr = `${viewMonth.year}-${mm}-${dd}`
          const cellD   = new Date(viewMonth.year, viewMonth.month, day)
          cellD.setHours(0, 0, 0, 0)
          const isToday    = cellD.getTime() === today.getTime()
          const isSelected = dateStr === selectedDate
          const hasEvents  = activeDays.has(dateStr)
          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              style={{
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                height:'28px', borderRadius:'6px', cursor:'pointer',
                background: isSelected ? '#1D2567' : isToday ? '#e0e7ff' : 'transparent',
                transition:'background 0.1s',
              }}
              onMouseEnter={e => { if (!isSelected && !isToday) e.currentTarget.style.background = '#f3f4ff' }}
              onMouseLeave={e => { if (!isSelected && !isToday) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontFamily:'DM Sans', fontWeight: isToday||isSelected ? 700 : 400, fontSize:'11px', color: isSelected ? '#ffffff' : isToday ? '#1D2567' : '#374151', lineHeight:1 }}>
                {day}
              </span>
              {hasEvents && (
                <div style={{ width:'3px', height:'3px', borderRadius:'50%', marginTop:'2px', background: isSelected ? 'rgba(255,255,255,0.6)' : '#1D2567' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Today Snapshot ───────────────────────────────────────────────────────────
const MAX_VISIBLE_PILLS = 5

function TodaySnapshot({ slots }) {
  const today = toLocalDateStr()
  const [showAll, setShowAll] = useState(false)

  const todayLabel = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })

  const scheduledSlots = useMemo(() =>
    (slots || []).filter(s => s.slot_date === today && s.is_booked),
  [slots, today])

  const openSlots = useMemo(() =>
    (slots || []).filter(s => s.slot_date === today && !s.is_booked),
  [slots, today])

  const openByInterviewer = useMemo(() => {
    const groups = {}
    openSlots.forEach(s => {
      const key = s.interviewer_name || 'ASPIRE Team'
      if (!groups[key]) groups[key] = { interviewer: key, slots: [] }
      groups[key].slots.push(s)
    })
    return Object.values(groups).sort((a, b) =>
      (a.slots[0]?.slot_time || '').localeCompare(b.slots[0]?.slot_time || '')
    )
  }, [openSlots])

  const fmt = t => t
    ? new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
    : '—'

  return (
    <div style={{ marginTop:'20px', paddingTop:'16px', borderTop:'1px solid #f3f4f6' }}>
      <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px' }}>
        Today
      </div>
      <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'12px', color:'#1D2567', marginBottom:'4px' }}>
        {todayLabel}
      </div>
      <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#6b7280', marginBottom:'12px' }}>
        {scheduledSlots.length} scheduled · {openSlots.length} open slot{openSlots.length !== 1 ? 's' : ''}
      </div>

      {scheduledSlots.length === 0 && openSlots.length === 0 ? (
        <div style={{ background:'#f9fafb', borderRadius:'10px', padding:'12px', textAlign:'center' }}>
          <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#9ca3af', lineHeight:1.5 }}>
            No interviews today.
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
          {scheduledSlots.length > 0 && (() => {
            const visible = showAll ? scheduledSlots : scheduledSlots.slice(0, MAX_VISIBLE_PILLS)
            const hidden  = scheduledSlots.length - visible.length
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                {visible.map(s => {
                  const student = Array.isArray(s.students) ? s.students[0] : s.students
                  const name    = student ? `${student.first_name} ${student.last_name}` : 'Booked'
                  return (
                    <div key={s.id} style={{ padding:'8px 10px', background:'#f0fdf4', borderRadius:'8px', borderLeft:'3px solid #16a34a' }}>
                      <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color:'#166534', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {name}
                      </div>
                      <div style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#6b7280', marginTop:'2px' }}>
                        {fmt(s.slot_time)} · {s.interviewer_name || 'ASPIRE Team'}
                      </div>
                    </div>
                  )
                })}
                {hidden > 0 && (
                  <button
                    onClick={() => setShowAll(true)}
                    style={{ padding:'5px 10px', background:'#f3f4f6', border:'none', borderRadius:'8px', cursor:'pointer', fontFamily:'DM Sans', fontSize:'10px', fontWeight:600, color:'#6b7280', textAlign:'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#e5e7eb'}
                    onMouseLeave={e => e.currentTarget.style.background = '#f3f4f6'}
                  >
                    +{hidden} more interview{hidden !== 1 ? 's' : ''} today
                  </button>
                )}
              </div>
            )
          })()}

          {openByInterviewer.length > 0 && (
            <div style={{ marginTop: scheduledSlots.length > 0 ? '8px' : '0' }}>
              <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'4px' }}>
                Open Slots
              </div>
              {openByInterviewer.map((group, i) => (
                <div key={i} style={{ padding:'7px 10px', background:'#f0f3ff', borderRadius:'8px', borderLeft:'3px solid #1D2567', marginBottom:'3px' }}>
                  <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color:'#1D2567' }}>
                    {group.slots.length} open slot{group.slots.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#6b7280', marginTop:'2px' }}>
                    {fmt(group.slots[0]?.slot_time)} · {group.interviewer}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Sidebar Export ──────────────────────────────────────────────────────
export default function CalendarSidebar({ blocks, slots, selectedDate, onSelectDate }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <MiniCalendar blocks={blocks} slots={slots} selectedDate={selectedDate} onSelectDate={onSelectDate} />
      <TodaySnapshot slots={slots} />
    </div>
  )
}
