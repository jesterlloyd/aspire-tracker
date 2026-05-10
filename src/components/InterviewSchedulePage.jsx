import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

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

function buildNotificationMailto(student, slot, interviewerEmail) {
  const toEmail = interviewerEmail || JESTER_EMAIL
  const noEmailNote = !interviewerEmail
    ? '\n\nNote: Interviewer email not found. Please forward to the assigned interviewer.' : ''
  const subject = `New ASPIRE Interview Booking – ${student.last_name}, ${student.first_name} | ${slot.slot_date} at ${slot.slot_time}`
  const body = `A student has self-scheduled an ASPIRE interview. Please create a Teams meeting for this appointment.

Student: ${student.last_name}, ${student.first_name}
School: ${student.school || 'N/A'}
Program: ${student.program_type || 'N/A'}
Interview Date: ${slot.slot_date}
Interview Time: ${fmtTime(slot.slot_time)} Pacific Time
Duration: ${slot.duration_minutes} minutes

Please create the Microsoft Teams meeting and send the student the link at their school email: ${student.school_email}

This is an automated notification from the ASPIRE Intelligence.${noEmailNote}`
  const bcc = toEmail === JESTER_EMAIL ? 'Krystal.Rodriguez@cshs.org' : `${JESTER_EMAIL},Krystal.Rodriguez@cshs.org`
  return `mailto:${encodeURIComponent(toEmail)}?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

const ELIGIBLE_STATUSES = new Set([
  'Form Received', 'Interview Scheduled', 'Interviewed',
  'Placed', 'Active Rotation', 'Completed',
])

export default function InterviewSchedulePage() {
  const [screen,      setScreen]      = useState('identify')
  const [email,       setEmail]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [student,     setStudent]     = useState(null)
  const [cohortId,    setCohortId]    = useState(null)
  const [slots,       setSlots]       = useState([])
  const [booking,     setBooking]     = useState(false)
  const [bookedSlot,  setBookedSlot]  = useState(null)

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
      const { data: cohort } = await supabase.from('cohorts')
        .select('id, name').eq('accepting_submissions', true).limit(1).single()
      if (!cohort) { setError('Scheduling is not currently open. Please contact the ASPIRE team.'); setLoading(false); return }
      setCohortId(cohort.id)

      const { data: stu } = await supabase.from('students')
        .select('*').eq('cohort_id', cohort.id).ilike('school_email', email.trim()).limit(1).maybeSingle()
      if (!stu) {
        setError('We could not find your information. Please confirm your school email address or contact the ASPIRE team.')
        setLoading(false); return
      }
      if (!ELIGIBLE_STATUSES.has(stu.status)) {
        setError('You are not yet eligible to schedule an interview. Please complete the ASPIRE Student Profile first.')
        setLoading(false); return
      }
      setStudent(stu)
      if (stu.interview_scheduled_date) { setScreen('existing'); setLoading(false); return }

      const now = fmtLocalDate(new Date())
      const { data: available } = await supabase.from('interview_slots')
        .select('*').eq('cohort_id', cohort.id).eq('is_booked', false).gte('slot_date', now)
        .order('slot_date').order('slot_time')
      setSlots(available || [])
      const n = new Date()
      setCalMonth({ year: n.getFullYear(), month: n.getMonth() })
      setSelectedDate(null); setSelectedCard(null)
      setScreen('select')
    } catch (err) { setError('Something went wrong. Please try again.') }
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
        // All same duration — one card with count
        cards.push({ time, duration: durations[0], slots: sls, count: sls.length })
      } else {
        // Mixed durations — one card per duration
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
      // Assign earliest created_at slot in the selected card
      const sorted = [...selectedCard.slots].sort((a,b) => (a.created_at||'').localeCompare(b.created_at||''))
      const chosen = sorted[0]
      const now = new Date().toISOString()

      await supabase.from('interview_slots').update({
        is_booked: true, booked_by_student_id: student.id, booked_at: now,
      }).eq('id', chosen.id)

      const { data: existing } = await supabase.from('interview_sessions')
        .select('id').eq('student_id', student.id).eq('cohort_id', cohortId).limit(1).maybeSingle()
      if (existing) {
        await supabase.from('interview_sessions').update({ self_scheduled:true, slot_id:chosen.id }).eq('id', existing.id)
      } else {
        await supabase.from('interview_sessions').insert({
          student_id: student.id, cohort_id: cohortId,
          self_scheduled: true, slot_id: chosen.id, session_number: 1,
        })
      }

      await supabase.from('students').update({
        interview_scheduled_date:   chosen.slot_date,
        interview_scheduled_time:   chosen.slot_time,
        interview_duration_minutes: chosen.duration_minutes,
        status:                     'Interview Scheduled',
        scheduling_viewed_at:       now,
      }).eq('id', student.id)

      setBookedSlot(chosen)
      setScreen('confirmed')

      let interviewerEmail = null
      if (chosen.interviewer_name?.trim()) {
        const { data: iv } = await supabase.from('interviewers')
          .select('email').ilike('name', chosen.interviewer_name.trim()).limit(1).maybeSingle()
        interviewerEmail = iv?.email?.trim() || null
      }
      const mailto = buildNotificationMailto(student, chosen, interviewerEmail)
      const a = document.createElement('a'); a.href = mailto; a.click()
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
      <div className="uf-card" style={{ maxWidth:600 }}>
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
            <div style={{ marginTop:20, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
              {/* Calendar header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #f3f4f6' }}>
                <button onClick={prevMonth} disabled={!canGoPrev}
                  style={{ background:'none', border:'none', fontSize:18, cursor:canGoPrev?'pointer':'default',
                    color:canGoPrev?'var(--nightfall)':'#d1d5db', lineHeight:1, padding:'0 4px' }}>‹</button>
                <span style={{ fontSize:15, fontWeight:700, color:'var(--nightfall)' }}>{monthLabel}</span>
                <button onClick={nextMonth} disabled={!canGoNext}
                  style={{ background:'none', border:'none', fontSize:18, cursor:canGoNext?'pointer':'default',
                    color:canGoNext?'var(--nightfall)':'#d1d5db', lineHeight:1, padding:'0 4px' }}>›</button>
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
                <a href={`mailto:${JESTER_EMAIL}`} style={{ color:'var(--nightfall)' }}>{JESTER_EMAIL}</a>.
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
                  style={{ padding:13, borderRadius:8, background:'var(--nightfall)', color:'#fff', fontSize:15, fontWeight:700, border:'none', cursor:'pointer' }}>
                  {booking ? 'Booking your slot…' : 'Confirm This Time →'}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Screen 3: Confirmed ── */}
        {screen === 'confirmed' && bookedSlot && student && (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:56, marginBottom:12 }}>✅</div>
            <h2 style={{ fontSize:24, fontWeight:700, color:'#166534', marginBottom:16 }}>
              Your Interview Is Scheduled
            </h2>
            <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'20px 24px', textAlign:'left', lineHeight:1.8, fontSize:14, color:'var(--raven)' }}>
              <p style={{ marginBottom:12 }}>Your ASPIRE interview has been scheduled successfully. Here are your details:</p>
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'4px 16px', fontWeight:500 }}>
                <span style={{ color:'#6b7280' }}>Date:</span>       <span>{fmtDisplayDate(bookedSlot.slot_date)}</span>
                <span style={{ color:'#6b7280' }}>Time:</span>       <span>{fmtTime(bookedSlot.slot_time)} Pacific Time</span>
                <span style={{ color:'#6b7280' }}>Duration:</span>   <span>{bookedSlot.duration_minutes} minutes</span>
                <span style={{ color:'#6b7280' }}>Format:</span>     <span>Microsoft Teams (link to be sent separately)</span>
                <span style={{ color:'#6b7280' }}>Interviewer:</span><span>ASPIRE Team</span>
              </div>
              <p style={{ marginTop:16, fontSize:13 }}>
                Please watch your email for further instructions including the Teams meeting link.
                If you need to reschedule, please email{' '}
                <a href="mailto:JesterLloyd.Bautista@cshs.org" style={{ color:'var(--nightfall)' }}>JesterLloyd.Bautista@cshs.org</a>{' '}
                at least 24 hours before your interview.
              </p>
              <p style={{ marginTop:8, fontSize:13 }}>
                We look forward to learning more about your clinical interests and goals. See you soon.
              </p>
            </div>
          </div>
        )}

        {/* ── Screen 4: Already scheduled ── */}
        {screen === 'existing' && student && (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📅</div>
            <h2 style={{ fontSize:22, fontWeight:700, color:'var(--nightfall)', marginBottom:16 }}>
              You Already Have an Interview Scheduled
            </h2>
            <div style={{ background:'var(--marina)', border:'1px solid #9dd6f2', borderRadius:8, padding:'20px 24px', textAlign:'left', lineHeight:1.8, fontSize:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'4px 16px', fontWeight:500 }}>
                <span style={{ color:'#6b7280' }}>Date:</span>
                <span>{fmtDisplayDate(student.interview_scheduled_date)}</span>
                <span style={{ color:'#6b7280' }}>Time:</span>
                <span>{fmtTime(student.interview_scheduled_time)} Pacific Time</span>
                <span style={{ color:'#6b7280' }}>Format:</span>
                <span>Microsoft Teams</span>
              </div>
              <p style={{ marginTop:14, fontSize:13, color:'var(--text-secondary)' }}>
                To reschedule, please email{' '}
                <a href="mailto:JesterLloyd.Bautista@cshs.org" style={{ color:'var(--nightfall)' }}>
                  JesterLloyd.Bautista@cshs.org
                </a>{' '}
                at least 24 hours before your interview.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
