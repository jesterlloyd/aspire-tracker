import { useState, useEffect, useMemo } from 'react'

// ── Local date helpers ────────────────────────────────────────
function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function parseLD(s) {
  if (!s) return null
  const [y,m,d] = s.split('-').map(Number)
  return new Date(y, m-1, d)
}
function fmtDisplayDate(dateStr) {
  const d = parseLD(dateStr)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
}
function fmtTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}
function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`
}
function fmtTimeRange(timeStr, durationMin) {
  return `${fmtTime(timeStr)} – ${fmtTime(addMinutes(timeStr, durationMin))}`
}

// ── Month grid (Sunday-first) ─────────────────────────────────
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const last  = new Date(year, month+1, 0)
  const start = new Date(first); start.setDate(first.getDate() - first.getDay())
  const end   = new Date(last);  end.setDate(last.getDate() + (6 - last.getDay()))
  const days = []; const cur = new Date(start)
  while (cur <= end) { days.push(new Date(cur)); cur.setDate(cur.getDate()+1) }
  return days
}

const JESTER_EMAIL = 'JesterLloyd.Bautista@cshs.org'
const ASPIRE_TEAM_EMAIL = 'aspire@cshs.org'

// Student-friendly mailto - addressed to JESTER_EMAIL, composed as if from the student
function buildStudentMailtoUrl(student, slot) {
  const name = `${student.first_name} ${student.last_name}`
  const subject = `ASPIRE Interview Booked: ${name} on ${slot.slot_date} at ${fmtTime(slot.slot_time)}`
  const body =
`Hi ASPIRE Team,

This is to confirm that I have scheduled my ASPIRE interview.

Student: ${name}
School: ${student.school || 'N/A'}
Program: ${student.program_type || 'N/A'}
Date: ${slot.slot_date}
Time: ${fmtTime(slot.slot_time)} Pacific Time
Duration: ${slot.duration_minutes} minutes

I look forward to it.

Thank you,
${student.first_name}`
  return `mailto:${JESTER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// .ics calendar file generator - pure client-side, no backend needed
function buildIcsDataUri(student, slot) {
  const { slot_date, slot_time, duration_minutes } = slot
  const [h, m] = slot_time.split(':').map(Number)
  const dtStart = `${slot_date.replace(/-/g,'')}T${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}00`
  const endMins = h * 60 + m + (duration_minutes || 30)
  const eH = Math.floor(endMins / 60), eM = endMins % 60
  const dtEnd = `${slot_date.replace(/-/g,'')}T${String(eH).padStart(2,'0')}${String(eM).padStart(2,'0')}00`
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@aspire-program.com`
  const stamp = new Date().toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z'
  const studentEmail = student.school_email || 'your school email'

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ASPIRE Intelligence//Cedars-Sinai//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/Los_Angeles:${dtStart}`,
    `DTEND;TZID=America/Los_Angeles:${dtEnd}`,
    'SUMMARY:ASPIRE Interview',
    `DESCRIPTION:Your ASPIRE interview with Cedars-Sinai Brawerman Nursing Institute.\\n\\nMicrosoft Teams meeting link will be sent to ${studentEmail} within 24 hours.\\n\\nTo reschedule\\, email ${JESTER_EMAIL} at least 24 hours before your interview.`,
    'LOCATION:Microsoft Teams (link to follow)',
    `ORGANIZER;CN=ASPIRE:MAILTO:${JESTER_EMAIL}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: ASPIRE interview in 1 hour',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics)
}


export default function InterviewSchedulePage() {
  const [screen,      setScreen]      = useState('identify')
  const [email,       setEmail]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [student,     setStudent]     = useState(null)
  const [cohortId,    setCohortId]    = useState(null)
  const [slots,       setSlots]       = useState([])
  const [booking,         setBooking]         = useState(false)
  const [bookedSlot,      setBookedSlot]      = useState(null)
  const [existingBooking, setExistingBooking] = useState(null)
  const [errorMessage,    setErrorMessage]    = useState('')
  const [mailtoUrl,       setMailtoUrl]       = useState(null)

  // Calendar state
  const [calMonth,     setCalMonth]     = useState(null) // { year, month }
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedCard, setSelectedCard] = useState(null) // { time, duration, slots[] }

  useEffect(() => { document.title = 'Schedule Your ASPIRE Interview' }, [])

  // ── Screen 1: Look up student ─────────────────────────────────
  const handleIdentify = async e => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const res = await fetch('/api/interview-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong. Please try again.'); setLoading(false); return }

      if (data.hasExistingBooking) {
        setStudent(data.student)
        setExistingBooking(data.booking)
        setScreen('existing')
        setLoading(false)
        return
      }
      if (data.noSlots) {
        setStudent(data.student)
        setScreen('no_slots')
        setLoading(false)
        return
      }
      setStudent(data.student)
      setCohortId(data.cohortId)
      setSlots(data.slots)
      const n = new Date()
      setCalMonth({ year: n.getFullYear(), month: n.getMonth() })
      setSelectedDate(null); setSelectedCard(null)
      setScreen('select')
    } catch (err) {
      setScreen('error')
      setErrorMessage(err.message || 'Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  // ── Calendar helpers ──────────────────────────────────────────
  const todayStr  = fmtLocalDate(new Date())
  const today     = new Date()
  const in42      = new Date(today.getTime() + 42*24*3600*1000)
  const in42Str   = fmtLocalDate(in42)
  const availDays = useMemo(() => new Set(slots.map(sl => sl.slot_date)), [slots])

  const canGoPrev = calMonth
    ? (calMonth.year > today.getFullYear() || calMonth.month > today.getMonth())
    : false
  const canGoNext = calMonth
    ? fmtLocalDate(new Date(calMonth.year, calMonth.month+1, 1)) <= in42Str
    : false

  const prevMonth = () => {
    if (!canGoPrev) return
    setCalMonth(p => { const m=p.month-1; return m<0?{year:p.year-1,month:11}:{...p,month:m} })
    setSelectedDate(null); setSelectedCard(null)
  }
  const nextMonth = () => {
    if (!canGoNext) return
    setCalMonth(p => { const m=p.month+1; return m>11?{year:p.year+1,month:0}:{...p,month:m} })
    setSelectedDate(null); setSelectedCard(null)
  }

  // ── Part B: slot grouping for selected date ───────────────────
  const slotCards = useMemo(() => {
    if (!selectedDate) return []
    const daySlots = slots.filter(sl => sl.slot_date === selectedDate)
    // Group by slot_time, then by duration
    const byTime = {}
    daySlots.forEach(sl => {
      if (!byTime[sl.slot_time]) byTime[sl.slot_time] = []
      byTime[sl.slot_time].push(sl)
    })
    const cards = []
    Object.entries(byTime).sort(([a],[b]) => a.localeCompare(b)).forEach(([time, sls]) => {
      const durations = [...new Set(sls.map(s => s.duration_minutes))]
      if (durations.length === 1) {
        // All same duration - one card with count
        cards.push({ time, duration: durations[0], slots: sls, count: sls.length })
      } else {
        // Mixed durations - one card per duration
        durations.sort((a,b) => a-b).forEach(dur => {
          const matching = sls.filter(s => s.duration_minutes === dur)
          cards.push({ time, duration: dur, slots: matching, count: matching.length })
        })
      }
    })
    return cards
  }, [selectedDate, slots])

  // ── Part C: Confirm booking ───────────────────────────────────
  const handleBook = async () => {
    if (!selectedCard || !student || !cohortId) return
    setBooking(true)
    try {
      const sorted = [...selectedCard.slots].sort((a,b) => (a.created_at||'').localeCompare(b.created_at||''))
      const chosen = sorted[0]

      // S-07: the server re-resolves the student from the school email and derives the cohort
      // itself, so it no longer accepts a student id or a cohort id from here. Sending them would
      // be pointless: they are not read.
      const res = await fetch('/api/interview-book', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: student.school_email, slotId: chosen.id }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Booking failed. Please try again.'); setBooking(false); return }

      setBookedSlot(data.slot)
      setScreen('confirmed')

      // Build student-friendly mailto (opt-in only - no auto-trigger)
      setMailtoUrl(buildStudentMailtoUrl(student, data.slot))

      // Server-side notification is sent in-process by /api/interview-book
    } catch (err) { console.error('Booking error:', err) }
    setBooking(false)
  }

  const monthDays    = calMonth ? getMonthGrid(calMonth.year, calMonth.month) : []
  const monthLabel   = calMonth
    ? new Date(calMonth.year, calMonth.month, 1).toLocaleDateString('en-US',{month:'long',year:'numeric'})
    : ''
  const hasAnySlots  = slots.length > 0

  return (
    <div className="uf-page">
      <div className="uf-card" style={{ maxWidth:480 }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />

        {/* ── Screen 1: Identify ── */}
        {screen === 'identify' && (
          <>
            <div className="uf-header">
              <h1 className="uf-title" style={{ fontSize:26 }}>Schedule Your ASPIRE Interview</h1>
              <p style={{ fontSize:15, color:'var(--raven)', textAlign:'center', lineHeight:1.7, marginTop:8 }}>
                Thank you for completing your ASPIRE Student Profile. The next step is to schedule
                your interview with the Nursing Professional Development team. This interview helps
                us learn more about your clinical interests, unit preferences, and professional goals
                so we can match you with the best possible preceptor and unit.
              </p>
            </div>
            <form onSubmit={handleIdentify} className="uf-form">
              {error && <div className="error-msg" style={{ marginBottom:12 }}>{error}</div>}
              <div className="uf-field">
                <label className="uf-label">Your School Email Address</label>
                <input className="uf-input" type="email" required value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="your.name@school.edu" />
              </div>
              <div className="uf-submit-row">
                <button type="submit" className="uf-submit-btn" disabled={loading || !email.trim()}>
                  {loading ? 'Looking up your record…' : 'Continue →'}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── Screen 2: Calendar slot selection ── */}
        {screen === 'select' && student && calMonth && (
          <>
            <div className="uf-header">
              <h1 className="uf-title" style={{ fontSize:22 }}>Welcome, {student.first_name}.</h1>
              <p style={{ fontSize:15, color:'var(--raven)', textAlign:'center', lineHeight:1.6, marginTop:6 }}>
                Select a date, then choose an interview time.
              </p>
              <div style={{ background:'var(--marina)', borderRadius:6, padding:'8px 16px', marginTop:10, fontSize:13, color:'var(--nightfall)', textAlign:'left' }}>
                <strong>{student.last_name}, {student.first_name}</strong> · {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
              </div>
            </div>

            {/* Part A: Calendar grid */}
            <div className="uf-cal" style={{ marginTop:20, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
              {/* Calendar header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #f3f4f6' }}>
                <button onClick={prevMonth} disabled={!canGoPrev}
                  style={{ width:44, height:44, borderRadius:'50%', background:'none', border:'none', fontSize:20,
                    cursor:canGoPrev?'pointer':'default', color:canGoPrev?'var(--nightfall)':'#d1d5db',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>‹</button>
                <span style={{ fontSize:15, fontWeight:700, color:'var(--nightfall)' }}>{monthLabel}</span>
                <button onClick={nextMonth} disabled={!canGoNext}
                  style={{ width:44, height:44, borderRadius:'50%', background:'none', border:'none', fontSize:20,
                    cursor:canGoNext?'pointer':'default', color:canGoNext?'var(--nightfall)':'#d1d5db',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>›</button>
              </div>
              {/* Day headers */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'#f9fafb' }}>
                {DAYS_SHORT.map(d => (
                  <div key={d} style={{ textAlign:'center', padding:'6px 0', fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase' }}>{d}</div>
                ))}
              </div>
              {/* Day cells */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderLeft:'1px solid #f3f4f6' }}>
                {monthDays.map((d, i) => {
                  const ds       = fmtLocalDate(d)
                  const inMonth  = d.getMonth() === calMonth.month
                  const isPast   = ds < todayStr
                  const isToday  = ds === todayStr
                  const hasSlots = availDays.has(ds)
                  const isSel    = selectedDate === ds
                  const clickable = inMonth && !isPast && hasSlots

                  let bg   = '#fff'
                  let numColor = '#9ca3af'
                  if (!inMonth || isPast)    { bg = '#f9fafb'; numColor = '#d1d5db' }
                  else if (isSel)            { bg = '#dceff8' }
                  else if (hasSlots)         { numColor = 'var(--nightfall)' }

                  return (
                    <div key={i}
                      onClick={() => { if (!clickable) return; setSelectedDate(ds); setSelectedCard(null) }}
                      style={{
                        minHeight:52, padding:'6px 0 4px', textAlign:'center',
                        background: bg,
                        border:`1px solid ${isSel?'var(--nightfall)':'#f3f4f6'}`,
                        borderWidth: isSel ? '2px' : '0 1px 1px 0',
                        cursor: clickable ? 'pointer' : 'default',
                        transition:'background 0.1s',
                      }}
                      onMouseEnter={e => { if (clickable && !isSel) e.currentTarget.style.background='#f0f7fc' }}
                      onMouseLeave={e => { if (clickable && !isSel) e.currentTarget.style.background=bg }}>
                      {/* Date number */}
                      <div style={{ display:'flex', justifyContent:'center', marginBottom:3 }}>
                        <span style={{
                          width:24, height:24, borderRadius:'50%', display:'flex',
                          alignItems:'center', justifyContent:'center',
                          background: isToday ? 'var(--nightfall)' : 'transparent',
                          color: isToday ? '#fff' : numColor,
                          fontSize:13, fontWeight: hasSlots||isToday ? 700 : 400,
                        }}>{d.getDate()}</span>
                      </div>
                      {/* Availability dot */}
                      {inMonth && !isPast && hasSlots && (
                        <div style={{ width:6, height:6, borderRadius:'50%', background:'#9dd6f2', margin:'0 auto' }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Part D: Empty state */}
            {!hasAnySlots && (
              <div style={{ textAlign:'center', padding:'24px 0', fontSize:14, color:'#6b7280' }}>
                No interview times are currently available. Please check back soon or contact the ASPIRE team at{' '}
                <a href={`mailto:${JESTER_EMAIL}`} target="_blank" rel="noopener noreferrer" style={{ color:'var(--nightfall)' }}>{JESTER_EMAIL}</a>.
              </div>
            )}

            {/* Part B: Slot cards for selected date */}
            {selectedDate && (
              <div style={{ marginTop:20 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--nightfall)', marginBottom:12 }}>
                  {fmtDisplayDate(selectedDate)}
                </div>
                {slotCards.length === 0 ? (
                  <div style={{ fontSize:13, color:'#9ca3af', padding:'8px 0' }}>No available times for this day.</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {slotCards.map((card, ci) => {
                      const isSel = selectedCard && selectedCard.time === card.time && selectedCard.duration === card.duration
                      return (
                        <button key={ci} type="button" onClick={() => setSelectedCard(card)}
                          style={{
                            padding:16, borderRadius:12, textAlign:'left', cursor:'pointer',
                            border: isSel ? '2px solid var(--nightfall)' : '1px solid #e5e7eb',
                            background: isSel ? 'var(--nightfall)' : '#fff',
                            color: isSel ? '#fff' : 'var(--raven)',
                            transition:'all 0.12s',
                          }}
                          onMouseEnter={e => { if (!isSel) { e.currentTarget.style.background='#dceff8'; e.currentTarget.style.borderColor='var(--nightfall)' } }}
                          onMouseLeave={e => { if (!isSel) { e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#e5e7eb' } }}>
                          <div style={{ fontSize:15, fontWeight:600 }}>
                            {fmtTimeRange(card.time, card.duration)}
                          </div>
                          <div style={{ fontSize:13, marginTop:4, opacity:0.8 }}>
                            {card.duration} minutes · {card.count} spot{card.count!==1?'s':''} available
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Confirm button */}
            {selectedCard && (
              <div style={{ marginTop:20, display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ background:'var(--sand)', borderRadius:8, padding:'12px 16px', fontSize:14, color:'var(--nightfall)' }}>
                  Selected: <strong>{fmtDisplayDate(selectedDate)} · {fmtTimeRange(selectedCard.time, selectedCard.duration)}</strong>
                </div>
                <button onClick={handleBook} disabled={booking}
                  style={{ width:'100%', minHeight:52, borderRadius:12, background:'var(--nightfall)', color:'#fff', fontSize:16, fontWeight:700, border:'none', cursor:'pointer' }}>
                  {booking ? 'Booking your slot…' : 'Confirm This Time →'}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Screen 3: Confirmed ── */}
        {screen === 'confirmed' && bookedSlot && student && (() => {
          const icsUrl = buildIcsDataUri(student, bookedSlot)
          const btnPrimary = { padding:'10px 18px', borderRadius:8, background:'#1D2567', color:'#fff', fontSize:13, fontWeight:500, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6, fontFamily:'DM Sans, sans-serif', border:'none', cursor:'pointer' }
          const btnSecondary = { ...btnPrimary, background:'#fff', color:'#1D2567', border:'1px solid rgba(29,37,103,0.12)' }
          const DetailRow = ({ label, value, last }) => (
            <div style={{ display:'flex', padding:'8px 0', borderBottom: last ? 'none' : '1px dashed rgba(29,37,103,0.08)', fontSize:13.5 }}>
              <div style={{ width:90, color:'#98A2B3', fontWeight:500 }}>{label}</div>
              <div style={{ color:'#0E1428', flex:1 }}>{value}</div>
            </div>
          )
          return (
            <div style={{ maxWidth:540, margin:'0 auto', padding:'24px 0', fontFamily:'DM Sans, sans-serif', color:'#0E1428' }}>
              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
                <div style={{ width:44, height:44, borderRadius:'50%', background:'#EEF7F0', color:'#2F7D5C', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>✓</div>
                <div>
                  <div style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.14em', color:'#475467', fontWeight:600 }}>Confirmed</div>
                  <h2 style={{ fontSize:22, fontWeight:600, color:'#1D2567', margin:'4px 0 0', letterSpacing:'-0.01em' }}>Your interview is scheduled</h2>
                </div>
              </div>

              {/* Booking details */}
              <div style={{ background:'#FAFAF7', border:'1px solid rgba(29,37,103,0.06)', borderRadius:10, padding:18, marginBottom:24 }}>
                <DetailRow label="Date"     value={fmtDisplayDate(bookedSlot.slot_date)} />
                <DetailRow label="Time"     value={`${fmtTime(bookedSlot.slot_time)} Pacific Time`} />
                <DetailRow label="Duration" value={`${bookedSlot.duration_minutes} minutes`} />
                <DetailRow label="Format"   value="Microsoft Teams (link will be sent to your school email)" last />
              </div>

              {/* What happens next */}
              <div style={{ marginBottom:24 }}>
                <h3 style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.14em', color:'#475467', fontWeight:600, marginBottom:12 }}>What happens next</h3>
                <ol style={{ fontSize:13.5, color:'#475467', lineHeight:1.6, paddingLeft:18, margin:0 }}>
                  <li>The ASPIRE team has been automatically notified.</li>
                  <li>You'll receive a Microsoft Teams meeting invitation at <strong style={{ color:'#1D2567' }}>{student.school_email}</strong> within 24 hours.</li>
                  <li>If you don't see the Teams invite within 24 hours, email <a href={`mailto:${JESTER_EMAIL}`} style={{ color:'#1D2567', textDecoration:'underline' }}>{JESTER_EMAIL}</a>.</li>
                </ol>
              </div>

              {/* Action buttons */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', paddingTop:20, borderTop:'1px solid rgba(29,37,103,0.06)' }}>
                <a href={icsUrl} download={`aspire-interview-${bookedSlot.slot_date}.ics`} style={btnPrimary}>
                  📅 Add to calendar
                </a>
                {mailtoUrl && (
                  <a href={mailtoUrl} style={btnSecondary}>
                    📧 Notify ASPIRE team
                  </a>
                )}
              </div>

              <p style={{ fontSize:12, color:'#98A2B3', marginTop:20, marginBottom:0, lineHeight:1.5 }}>
                Need to reschedule? Email <a href={`mailto:${JESTER_EMAIL}`} style={{ color:'#475467' }}>{JESTER_EMAIL}</a> at least 24 hours before your interview.
              </p>
            </div>
          )
        })()}

        {/* ── Screen 4: Already scheduled ── */}
        {screen === 'existing' && student && (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📅</div>
            <h2 style={{ fontSize:22, fontWeight:700, color:'var(--nightfall)', marginBottom:16 }}>
              You Already Have an Interview Scheduled
            </h2>
            <div style={{ background:'var(--marina)', border:'1px solid #9dd6f2', borderRadius:8, padding:'20px 24px', textAlign:'left', lineHeight:1.8, fontSize:14 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'6px', fontWeight:500 }}>
                <span style={{ color:'#6b7280' }}>Date:</span>
                <span>{fmtDisplayDate(existingBooking?.slot_date || student.interview_scheduled_date)}</span>
                <span style={{ color:'#6b7280' }}>Time:</span>
                <span>{fmtTime(existingBooking?.slot_time || student.interview_scheduled_time)} Pacific Time</span>
                <span style={{ color:'#6b7280' }}>Format:</span>
                <span>Microsoft Teams</span>
              </div>
              <p style={{ marginTop:14, fontSize:13, color:'var(--text-secondary)' }}>
                To reschedule, please email{' '}
                <a href="mailto:JesterLloyd.Bautista@cshs.org" target="_blank" rel="noopener noreferrer" style={{ color:'var(--nightfall)' }}>
                  JesterLloyd.Bautista@cshs.org
                </a>{' '}
                at least 24 hours before your interview.
              </p>
            </div>
          </div>
        )}
        {/* ── Screen 5: No slots available ── */}
        {screen === 'no_slots' && (
          <div style={{ textAlign:'center', padding:'32px', fontFamily:'DM Sans' }}>
            <div style={{ fontSize:'32px', marginBottom:'12px' }}>📅</div>
            <div style={{ fontWeight:700, fontSize:'16px', color:'#374151', marginBottom:'8px' }}>
              No interview slots available yet
            </div>
            <div style={{ fontSize:'13px', color:'#6b7280', lineHeight:1.6 }}>
              Interview slots have not been posted yet for your cohort.
              Please check back soon. If you have questions, contact the ASPIRE Team at{' '}
              <a href={`mailto:${ASPIRE_TEAM_EMAIL}`} target="_blank" rel="noopener noreferrer" style={{ color:'var(--nightfall)' }}>
                {ASPIRE_TEAM_EMAIL}
              </a>.
            </div>
          </div>
        )}

        {/* ── Screen 6: Error / timeout ── */}
        {screen === 'error' && (
          <div style={{ textAlign:'center', padding:'32px', fontFamily:'DM Sans' }}>
            <div style={{ fontSize:'32px', marginBottom:'12px' }}>⚠️</div>
            <div style={{ fontWeight:700, fontSize:'16px', color:'#dc2626', marginBottom:'8px' }}>
              Something went wrong
            </div>
            <div style={{ fontSize:'13px', color:'#6b7280', lineHeight:1.6, marginBottom:'16px' }}>
              {errorMessage || 'An unexpected error occurred. Please try again.'}
            </div>
            <button
              onClick={() => { setScreen('identify'); setError(null); setErrorMessage('') }}
              style={{
                padding:'9px 20px', background:'#1D2567', border:'none', borderRadius:'8px',
                fontFamily:'DM Sans', fontWeight:600, fontSize:'13px', color:'#ffffff', cursor:'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
