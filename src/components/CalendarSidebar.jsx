import React, { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, ClipboardList, Plus, Calendar } from 'lucide-react'

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
    ;(slots  || []).forEach(s => { if (s.slot_date && s.is_booked) days.add(s.slot_date) })
    return days
  }, [blocks, slots])

  const daysInMonth   = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate()
  const firstDayOfWeek = new Date(viewMonth.year, viewMonth.month, 1).getDay()

  const cells = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const monthLabel = new Date(viewMonth.year, viewMonth.month, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const prevMonth = () => setViewMonth(p => {
    const m = p.month === 0 ? 11 : p.month - 1
    const y = p.month === 0 ? p.year - 1 : p.year
    return { year: y, month: m }
  })
  const nextMonth = () => setViewMonth(p => {
    const m = p.month === 11 ? 0 : p.month + 1
    const y = p.month === 11 ? p.year + 1 : p.year
    return { year: y, month: m }
  })

  return (
    <div style={{ padding: '0 0 12px 0' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <button onClick={prevMonth} style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280', padding:'2px', display:'flex', alignItems:'center' }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'12px', color:'#1D2567' }}>{monthLabel}</span>
        <button onClick={nextMonth} style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280', padding:'2px', display:'flex', alignItems:'center' }}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', marginBottom:'4px' }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', color:'#9ca3af', textAlign:'center', padding:'2px 0', textTransform:'uppercase' }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'1px' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />
          const dateStr  = `${viewMonth.year}-${String(viewMonth.month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const cellDate = new Date(viewMonth.year, viewMonth.month, day)
          cellDate.setHours(0, 0, 0, 0)
          const isToday    = cellDate.getTime() === today.getTime()
          const isSelected = dateStr === selectedDate
          const hasEvents  = activeDays.has(dateStr)
          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              style={{
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                padding:'3px 0', cursor:'pointer', borderRadius:'6px',
                background: isSelected ? '#1D2567' : isToday ? '#e0e7ff' : 'transparent',
                transition:'background 0.1s ease',
              }}
              onMouseEnter={e => { if (!isSelected && !isToday) e.currentTarget.style.background = '#f3f4ff' }}
              onMouseLeave={e => { if (!isSelected && !isToday) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontFamily:'DM Sans', fontWeight: isToday||isSelected ? 700 : 400, fontSize:'11px', color: isSelected ? '#ffffff' : isToday ? '#1D2567' : '#374151' }}>
                {day}
              </span>
              {hasEvents && (
                <div style={{ width:'4px', height:'4px', borderRadius:'50%', background: isSelected ? 'rgba(255,255,255,0.7)' : '#1D2567', marginTop:'1px' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Today Combined View ──────────────────────────────────────────────────────
function TodayCombined({ slots, blocks, onStartRubric }) {
  const today = new Date().toISOString().split('T')[0]

  const todayItems = useMemo(() => {
    const items = []

    ;(slots || [])
      .filter(s => s.slot_date === today && s.is_booked)
      .forEach(s => {
        const student = Array.isArray(s.students) ? s.students[0] : s.students
        items.push({
          type: 'interview', time: s.slot_time || '',
          student, slot: s,
          name: student ? `${student.first_name} ${student.last_name}` : 'Booked',
          interviewer: s.interviewer_name || 'ASPIRE Team',
        })
      })

    const openByBlock = {}
    ;(slots || [])
      .filter(s => s.slot_date === today && !s.is_booked)
      .forEach(s => {
        const key = s.block_id || s.interviewer_name
        if (!openByBlock[key]) {
          openByBlock[key] = { type:'open', time: s.slot_time || '', interviewer: s.interviewer_name || 'ASPIRE Team', count:0, firstSlot:s }
        }
        openByBlock[key].count++
        if ((s.slot_time || '') < (openByBlock[key].time || 'ZZ')) openByBlock[key].time = s.slot_time
      })

    Object.values(openByBlock).forEach(item => items.push(item))
    items.sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    return items
  }, [slots, today])

  const formatTime = t => t
    ? new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
    : '—'

  const todayLabel = new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })

  return (
    <div style={{ borderTop:'1px solid #f3f4f6', paddingTop:'14px' }}>
      <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color:'#1D2567', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>
        Today
      </div>
      <div style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#9ca3af', marginBottom:'10px' }}>{todayLabel}</div>

      {todayItems.length === 0 ? (
        <div style={{ textAlign:'center', padding:'16px 8px', background:'#f9fafb', borderRadius:'10px' }}>
          <Calendar size={20} color="#d1d5db" style={{ marginBottom:'6px' }} />
          <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#9ca3af' }}>No interviews scheduled today.</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
          {todayItems.map((item, i) => (
            <div key={i} style={{
              padding:'8px 10px', background: item.type === 'interview' ? '#f0fdf4' : '#f8f9ff',
              borderRadius:'8px', borderLeft:`3px solid ${item.type === 'interview' ? '#16a34a' : '#1D2567'}`,
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'4px' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color: item.type === 'interview' ? '#166534' : '#1D2567', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {item.type === 'interview' ? item.name : `${item.count} open slot${item.count !== 1 ? 's' : ''}`}
                  </div>
                  <div style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#6b7280', marginTop:'1px' }}>
                    {formatTime(item.time)} · {item.interviewer}
                  </div>
                </div>
                {item.type === 'interview' && (
                  <button
                    onClick={() => onStartRubric?.(item.slot)}
                    title="Open rubric"
                    style={{ background:'#1D2567', border:'none', borderRadius:'5px', padding:'3px 7px', cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', gap:'3px' }}
                  >
                    <ClipboardList size={10} color="#ffffff" />
                    <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', color:'#ffffff' }}>Rubric</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
export default function CalendarSidebar({
  blocks, slots, interviewerProfiles,
  selectedDate, onSelectDate,
  activeFilter, onFilterChange,
  onAddAvailability, onStartRubric,
}) {
  const filters = [
    { key: null,        label: 'All'       },
    { key: 'open',      label: 'Available' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'completed', label: 'Completed' },
    { key: 'flagged',   label: 'Flagged'   },
  ]

  return (
    <div style={{
      width:'260px', flexShrink:0,
      background:'#ffffff', border:'1px solid #f3f4f6', borderRadius:'16px',
      boxShadow:'0 2px 12px rgba(29,37,103,0.07)',
      padding:'16px', display:'flex', flexDirection:'column', gap:'0',
      overflowY:'auto', maxHeight:'700px',
    }}>
      <MiniCalendar blocks={blocks} slots={slots} selectedDate={selectedDate} onSelectDate={onSelectDate} />

      <TodayCombined slots={slots} blocks={blocks} onStartRubric={onStartRubric} />

      {/* Quick filters */}
      <div style={{ borderTop:'1px solid #f3f4f6', paddingTop:'14px', marginTop:'14px' }}>
        <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color:'#1D2567', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px' }}>
          Filter
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
          {filters.map(f => (
            <button
              key={String(f.key)}
              onClick={() => onFilterChange(f.key)}
              style={{
                padding:'6px 10px', textAlign:'left',
                background: activeFilter === f.key ? '#f0f3ff' : 'transparent',
                border:'none', borderRadius:'7px',
                fontFamily:'DM Sans', fontWeight: activeFilter === f.key ? 700 : 400,
                fontSize:'12px', color: activeFilter === f.key ? '#1D2567' : '#6b7280',
                cursor:'pointer', transition:'all 0.15s ease',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interviewer legend */}
      {interviewerProfiles?.length > 0 && (
        <div style={{ borderTop:'1px solid #f3f4f6', paddingTop:'14px', marginTop:'14px' }}>
          <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color:'#1D2567', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px' }}>
            Interviewers
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
            {interviewerProfiles.map(p => (
              <div key={p.id} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <div style={{ width:'10px', height:'10px', borderRadius:'50%', background: p.interviewer_color || '#1D2567', flexShrink:0 }} />
                <span style={{ fontFamily:'DM Sans', fontSize:'12px', color:'#374151' }}>
                  {p.full_name.split(' ')[0]} {p.full_name.split(' ')[1]?.[0]}.
                </span>
                {!p.login_enabled && (
                  <span style={{ fontFamily:'DM Sans', fontSize:'9px', color:'#9ca3af', fontStyle:'italic' }}>pending</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Availability */}
      <button
        onClick={onAddAvailability}
        style={{
          marginTop:'16px', width:'100%', padding:'9px',
          background:'#1D2567', border:'none', borderRadius:'10px',
          fontFamily:'DM Sans', fontWeight:700, fontSize:'12px', color:'#ffffff',
          cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
          transition:'background 0.15s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#141928'}
        onMouseLeave={e => e.currentTarget.style.background = '#1D2567'}
      >
        <Plus size={13} /> Add Availability
      </button>
    </div>
  )
}
