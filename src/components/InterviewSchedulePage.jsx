import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function fmtDisplayDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
}

function fmtTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2,'0')} ${ampm}`
}

const JESTER_EMAIL = 'JesterLloyd.Bautista@cshs.org'

function buildNotificationMailto(student, slot, interviewerEmail) {
  // TO = interviewer if known, else fall back to Jester
  const toEmail = interviewerEmail || JESTER_EMAIL
  const noEmailNote = !interviewerEmail
    ? '\n\nNote: Interviewer email not found. Please forward to the assigned interviewer.'
    : ''

  const subject = `New ASPIRE Interview Booking – ${student.last_name}, ${student.first_name} | ${slot.slot_date} at ${slot.slot_time}`
  const body = `A student has self-scheduled an ASPIRE interview. Please create a Teams meeting for this appointment.

Student: ${student.last_name}, ${student.first_name}
School: ${student.school || 'N/A'}
Program: ${student.program_type || 'N/A'}
Interview Date: ${slot.slot_date}
Interview Time: ${fmtTime(slot.slot_time)} Pacific Time
Duration: ${slot.duration_minutes} minutes

Please create the Microsoft Teams meeting and send the student the link at their school email: ${student.school_email}

This is an automated notification from the ASPIRE Program Tracker.${noEmailNote}`

  // Jester always in BCC as program lead; TO is the interviewer (or Jester if unknown)
  const bcc = toEmail === JESTER_EMAIL ? 'Krystal.Rodriguez@cshs.org' : `${JESTER_EMAIL},Krystal.Rodriguez@cshs.org`
  return `mailto:${encodeURIComponent(toEmail)}?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// Statuses that qualify a student for scheduling
const ELIGIBLE_STATUSES = new Set([
  'Form Received', 'Interview Scheduled', 'Interviewed',
  'Placed', 'Active Rotation', 'Completed',
])

export default function InterviewSchedulePage() {
  const [screen,   setScreen]   = useState('identify') // identify | select | confirmed | existing
  const [email,    setEmail]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [student,  setStudent]  = useState(null)
  const [cohortId, setCohortId] = useState(null)
  const [slots,    setSlots]    = useState([])      // available slots
  const [selected, setSelected] = useState(null)   // selected slot
  const [booking,  setBooking]  = useState(false)
  const [bookedSlot, setBookedSlot] = useState(null)

  useEffect(() => { document.title = 'Schedule Your ASPIRE Interview' }, [])

  // ── Screen 1: Look up student by email ──────────────────────
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

      // Check eligibility
      if (!ELIGIBLE_STATUSES.has(stu.status)) {
        setError('You are not yet eligible to schedule an interview. Please complete the ASPIRE Student Profile first.')
        setLoading(false); return
      }

      setStudent(stu)

      // Already scheduled → Screen 4
      if (stu.interview_scheduled_date) {
        setScreen('existing'); setLoading(false); return
      }

      // Fetch available slots
      const now = new Date().toISOString().slice(0, 10)
      const { data: available } = await supabase.from('interview_slots')
        .select('*').eq('cohort_id', cohort.id).eq('is_booked', false).gte('slot_date', now)
        .order('slot_date').order('slot_time')
      setSlots(available || [])
      setScreen('select')
    } catch (err) {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  // ── Screen 3: Confirm booking ────────────────────────────────
  const handleBook = async () => {
    if (!selected || !student || !cohortId) return
    setBooking(true)
    try {
      const now = new Date().toISOString()

      // Mark slot as booked
      await supabase.from('interview_slots').update({
        is_booked: true, booked_by_student_id: student.id, booked_at: now,
      }).eq('id', selected.id)

      // Upsert interview_sessions
      const { data: existing } = await supabase.from('interview_sessions')
        .select('id').eq('student_id', student.id).eq('cohort_id', cohortId).limit(1).maybeSingle()
      const sessionData = {
        student_id: student.id, cohort_id: cohortId,
        self_scheduled: true, slot_id: selected.id,
        session_number: 1,
      }
      if (existing) {
        await supabase.from('interview_sessions').update({ self_scheduled: true, slot_id: selected.id }).eq('id', existing.id)
      } else {
        await supabase.from('interview_sessions').insert(sessionData)
      }

      // Update student record
      await supabase.from('students').update({
        interview_scheduled_date:      selected.slot_date,
        interview_scheduled_time:      selected.slot_time,
        interview_duration_minutes:    selected.duration_minutes,
        status:                        'Interview Scheduled',
        scheduling_viewed_at:          now,
      }).eq('id', student.id)

      setBookedSlot(selected)
      setScreen('confirmed')

      // Look up interviewer email by matching slot's interviewer_name
      let interviewerEmail = null
      if (selected.interviewer_name?.trim()) {
        const { data: iviewr } = await supabase.from('interviewers')
          .select('email').ilike('name', selected.interviewer_name.trim()).limit(1).maybeSingle()
        interviewerEmail = iviewr?.email?.trim() || null
      }

      // Open notification mailto — TO: interviewer (or Jester fallback), BCC: Jester always
      const mailto = buildNotificationMailto(student, selected, interviewerEmail)
      const a = document.createElement('a')
      a.href = mailto; a.click()
    } catch (err) {
      console.error('Booking error:', err)
    }
    setBooking(false)
  }

  // ── Group slots by date ──────────────────────────────────────
  const slotsByDate = {}
  slots.forEach(sl => {
    if (!slotsByDate[sl.slot_date]) slotsByDate[sl.slot_date] = []
    slotsByDate[sl.slot_date].push(sl)
  })

  return (
    <div className="uf-page">
      <div className="uf-card" style={{ maxWidth: 600 }}>
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
                <input className="uf-input" type="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="your.name@school.edu" />
              </div>
              <div className="uf-submit-row">
                <button type="submit" className="uf-submit-btn" disabled={loading || !email.trim()}>
                  {loading ? 'Looking up your record…' : 'Continue →'}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── Screen 2: Slot selection ── */}
        {screen === 'select' && student && (
          <>
            <div className="uf-header">
              <h1 className="uf-title" style={{ fontSize:22 }}>
                Welcome, {student.first_name}.
              </h1>
              <p style={{ fontSize:15, color:'var(--raven)', textAlign:'center', lineHeight:1.6, marginTop:6 }}>
                Please select an interview time that works for your schedule.
              </p>
              <div style={{ background:'var(--marina)', borderRadius:6, padding:'8px 16px', marginTop:10, fontSize:13, color:'var(--nightfall)', textAlign:'left' }}>
                <strong>{student.last_name}, {student.first_name}</strong> · {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
              </div>
            </div>

            {slots.length === 0 ? (
              <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text-secondary)', fontSize:14 }}>
                No interview times are currently available. Please check back soon or contact the ASPIRE team directly.
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:16, marginTop:16 }}>
                {Object.entries(slotsByDate).map(([date, daySlots]) => (
                  <div key={date}>
                    <div style={{ fontSize:14, fontWeight:700, color:'var(--nightfall)', marginBottom:8, paddingBottom:4, borderBottom:'1px solid var(--border-lt)' }}>
                      {fmtDisplayDate(date)}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8 }}>
                      {daySlots.map(sl => {
                        const isSel = selected?.id === sl.id
                        return (
                          <button key={sl.id} type="button"
                            onClick={() => setSelected(sl)}
                            style={{
                              padding:'12px 14px', borderRadius:8, textAlign:'left', cursor:'pointer',
                              border: isSel ? '2px solid var(--nightfall)' : '1.5px solid var(--border)',
                              background: isSel ? 'var(--nightfall)' : 'var(--pearl)',
                              color: isSel ? '#fff' : 'var(--raven)',
                              transition:'all 0.12s',
                            }}>
                            <div style={{ fontSize:15, fontWeight:600 }}>{fmtTime(sl.slot_time)}</div>
                            <div style={{ fontSize:13, opacity:0.75, marginTop:2 }}>{sl.duration_minutes} min · ASPIRE Team</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selected && (
              <div style={{ marginTop:20, display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ background:'var(--sand)', borderRadius:8, padding:'12px 16px', fontSize:14, color:'var(--nightfall)' }}>
                  Selected: <strong>{fmtDisplayDate(selected.slot_date)} at {fmtTime(selected.slot_time)}</strong>
                  <span style={{ color:'var(--text-secondary)', marginLeft:8 }}>({selected.duration_minutes} min)</span>
                </div>
                <button onClick={handleBook} disabled={booking}
                  style={{ padding:'13px', borderRadius:8, background:'var(--nightfall)', color:'#fff', fontSize:15, fontWeight:700, border:'none', cursor:'pointer' }}>
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
