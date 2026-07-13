// All external navigation must use openLink helpers (src/lib/openLink.js)
import { useState, useEffect, useRef } from 'react'
import { SHIFT_LOG_STATUSES } from '../lib/shiftLogValidation'
import { openMailtoLink } from '../lib/openLink'
import { normalizeEmailForLookup } from '../lib/emailUtils'
import { getStudentPreferredGreetingName } from '../lib/studentNameFormatters'
import { useLookupStudent } from './shift-log-lifecycle/useLookupStudent'
// WS1e-A0b: past-shift submission now goes through /api/shift-log/submit-past-shift.
// The server resolves the student, classifies the shift, inserts the completed
// student_shift_logs row, recomputes approved/pending totals, applies the
// Placed→Active Rotation promotion, and logs events. (Was: direct student_shift_logs
// insert + proxyUpdateStudent aggregate writes + client-side program_events.)

const JESTER = 'JesterLloyd.Bautista@cshs.org'

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function parseLD(s) {
  if (!s) return null
  const [y,m,d] = s.split('-').map(Number)
  return new Date(y,m-1,d)
}
function fmtDisplayDate(s) {
  const d = parseLD(s); if (!d) return s
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})
}

export default function ShiftLogPage({ initialSchoolEmail = '' }) {
  // Student resolution goes through /api/shift-log/lookup-student (service role,
  // server-side) via the shared lifecycle hook. ShiftLogPage performs NO
  // browser-side read of public.students or public.units, so this public route
  // survives Phase 0B Wave D (anon students removal).
  const { lookup } = useLookupStudent()
  const [screen,   setScreen]   = useState('email') // email | form | confirm
  const [email,    setEmail]    = useState(initialSchoolEmail || '')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [student,  setStudent]  = useState(null)
  const [cohortId, setCohortId] = useState(null)
  const [unitName, setUnitName] = useState('')

  // Form fields
  const today = fmtLocalDate(new Date())
  const [shiftDate,         setShiftDate]         = useState(today)
  const [hours,             setHours]             = useState(12)
  const [shiftType,         setShiftType]         = useState('Day')
  const [isDiffUnit,        setIsDiffUnit]        = useState(false)
  const [diffUnitName,      setDiffUnitName]      = useState('')
  const [diffUnitReason,    setDiffUnitReason]    = useState('')
  const [preceptorName,     setPreceptorName]     = useState('')
  const [preceptorChanged,  setPreceptorChanged]  = useState(false)
  const [learningHighlight, setLearningHighlight] = useState('')
  const [supportNeeded,     setSupportNeeded]     = useState('')
  const [attestation,       setAttestation]       = useState(false)
  const [formErrors,        setFormErrors]        = useState([])
  const [submitting,        setSubmitting]        = useState(false)
  // WS1e-A0b: one stable idempotency key per deliberate submission attempt.
  const submissionIdRef = useRef(null)

  // Confirmation state
  const [submittedStatus,   setSubmittedStatus]   = useState(null)
  const [submittedReason,   setSubmittedReason]   = useState(null)
  const [newApproved,       setNewApproved]       = useState(0)
  const [celebration,       setCelebration]       = useState(false)

  useEffect(() => { document.title = 'ASPIRE Shift Log' }, [])

  // ── Email screen ──────────────────────────────────────────────
  // Resolve the student server-side through /api/shift-log/lookup-student. The
  // endpoint matches the school email exactly (case-insensitive, trimmed, no
  // wildcard broadening), decides eligibility (cohort not Archived AND status
  // Placed or Active Rotation), and returns only safe fields, including the
  // already-resolved assigned_unit_name. No browser-side students/units query.
  const handleEmailSubmit = async e => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const normEmail = normalizeEmailForLookup(email)
      if (!normEmail) {
        setError(`Please enter your school email. If you need help, contact ${JESTER}.`)
        setLoading(false); return
      }

      const result = await lookup(email)
      if (result._networkError) {
        setError('Something went wrong. Please try again.')
        setLoading(false); return
      }
      if (result.error === 'ambiguous_student_email') {
        setError(`We found more than one record for that email. Please contact ${JESTER}.`)
        setLoading(false); return
      }

      const stu = result.student
      if (!result.found || !result.eligible || !stu) {
        setError(`We could not find your email in the current ASPIRE cohort. Please check the spelling or contact ${JESTER}.`)
        setLoading(false); return
      }

      setCohortId(stu.cohort_id)
      setStudent(stu)
      // Preceptor prefill from the student's free-text matched_preceptor, the
      // same source as before (now resolved server-side by the endpoint).
      setPreceptorName(stu.matched_preceptor || '')
      // Unit name is resolved server-side (assigned_unit_name); no client units read.
      setUnitName(stu.assigned_unit_name || '')
      setScreen('form')
    } catch { setError('Something went wrong. Please try again.') }
    setLoading(false)
  }

  // Exception-flag classification, totals, status promotion, and events are all
  // computed server-side by /api/shift-log/submit-past-shift (WS1e-A0b).

  // ── Form submit ───────────────────────────────────────────────
  const handleFormSubmit = async e => {
    e.preventDefault()
    const errs = []
    if (shiftDate > today) errs.push('Shift date cannot be in the future.')
    if (hours < 1 || hours > 13) errs.push('Hours must be between 1 and 13.')
    if (!attestation) errs.push('You must confirm the attestation before submitting.')
    if (isDiffUnit && !diffUnitReason.trim()) errs.push('Please explain why you worked at a different unit.')
    setFormErrors(errs)
    if (errs.length > 0) return

    // WS1e-A0b: one stable idempotency key per deliberate submission attempt.
    // Reused on retry of THIS attempt; regenerated only on resetForm (new shift).
    if (!submissionIdRef.current) {
      submissionIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
    }

    setSubmitting(true)
    setFormErrors([])
    try {
      const payload = {
        submission_id:          submissionIdRef.current,
        school_email:           student.school_email,
        shift_date:             shiftDate,
        total_hours:            hours,
        shift_type:             shiftType,
        unit_name:              isDiffUnit ? diffUnitName.trim() : unitName,
        preceptor_name:         preceptorName.trim(),
        is_assigned_unit:       !isDiffUnit,
        is_assigned_preceptor:  preceptorName.trim() === (student.matched_preceptor || '').trim(),
        attestation:            true,
        ...(isDiffUnit && { unit_override_reason: diffUnitReason.trim() }),
        ...(learningHighlight.trim() && { learning_highlight: learningHighlight.trim() }),
        ...(supportNeeded.trim()    && { support_needed: supportNeeded.trim() }),
      }

      const res = await fetch('/api/shift-log/submit-past-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormErrors([data.message || 'Submission failed. Please try again.'])
        setSubmitting(false)
        return
      }

      // Server is authoritative for classification, totals, status promotion, events.
      const newStatus    = data.shift?.status || null
      const newReason    = data.shift?.review_reason || null
      const newApprovedV = parseFloat(data.totals?.approved_hours ?? 0)
      const prevApproved = parseFloat(student.approved_hours || 0)
      const requiredH    = parseFloat(student.hours_required || 0)

      submissionIdRef.current = null  // attempt complete - next submission gets a new key
      setNewApproved(newApprovedV)
      setSubmittedStatus(newStatus)
      setSubmittedReason(newReason)
      setCelebration(newStatus === SHIFT_LOG_STATUSES.AUTO_ACCEPTED && newApprovedV >= requiredH && prevApproved < requiredH)
      setScreen('confirm')
    } catch (err) {
      setFormErrors([err?.message || 'Submission failed. Please try again.'])
    } finally {
      setSubmitting(false)   // ALWAYS resets - no path can leave the button stuck
    }
  }

  const resetForm = () => {
    submissionIdRef.current = null  // a fresh submission gets a fresh idempotency key
    setShiftDate(today); setHours(12); setShiftType('Day')
    setIsDiffUnit(false); setDiffUnitName(''); setDiffUnitReason('')
    setPreceptorChanged(false)
    setLearningHighlight(''); setSupportNeeded(''); setAttestation(false)
    setFormErrors([]); setSubmittedStatus(null); setSubmittedReason(null); setCelebration(false)
    setScreen('form')
  }

  const approved  = parseFloat(student?.approved_hours||0)
  const pending   = parseFloat(student?.pending_hours||0)
  const required  = parseFloat(student?.hours_required||0)
  const remaining = Math.max(0, required - approved)
  const pct       = required > 0 ? Math.min(100, (approved/required)*100) : 0

  const INPUT = { width:'100%', maxWidth:'100%', height:52, fontSize:16, padding:'0 14px', borderRadius:12,
    border:'1px solid #e5e7eb', fontFamily:'DM Sans,sans-serif', outline:'none', boxSizing:'border-box',
    display:'block', WebkitAppearance:'none', appearance:'none', overflow:'hidden' }
  const BTN_PRIMARY = { width:'100%', height:52, fontSize:16, fontWeight:700, fontFamily:'DM Sans,sans-serif',
    background:'var(--nightfall)', color:'#fff', border:'none', borderRadius:12, cursor:'pointer' }

  return (
    <div style={{ minHeight:'100vh', background:'var(--sand)', padding:'24px 16px', fontFamily:'DM Sans,sans-serif' }}>
      <div style={{ maxWidth:480, margin:'0 auto' }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="36" />
        </div>

        {/* ── Email screen ── */}
        {screen === 'email' && (
          <div style={{ background:'#fff', borderRadius:16, padding:'28px 24px', boxShadow:'0 2px 12px rgba(0,0,0,0.08)' }}>
            <h1 style={{ fontSize:28, fontWeight:700, color:'var(--nightfall)', textAlign:'center', margin:'0 0 8px' }}>
              ASPIRE Shift Log
            </h1>
            <p style={{ fontSize:15, color:'#6b7280', textAlign:'center', margin:'0 0 24px', lineHeight:1.6 }}>
              Enter your school email to access your shift log.
            </p>
            {error && (
              <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, padding:'12px 14px', fontSize:14, color:'#991b1b', marginBottom:16 }}>
                {error}
              </div>
            )}
            <form onSubmit={handleEmailSubmit}>
              <input style={INPUT} type="email" required value={email}
                onChange={e => setEmail(e.target.value)} placeholder="your.name@school.edu" />
              <div style={{ marginTop:12 }}>
                <button style={BTN_PRIMARY} type="submit" disabled={loading || !email.trim()}>
                  {loading ? 'Looking up…' : 'Continue →'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Form screen ── */}
        {screen === 'form' && student && (
          <>
            {/* Student summary card */}
            <div style={{ background:'#fff', borderRadius:16, padding:'20px', marginBottom:16, boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize:22, fontWeight:700, color:'var(--nightfall)', marginBottom:10 }}>
                Welcome, {getStudentPreferredGreetingName(student)}!
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 16px', fontSize:13, color:'#6b7280', marginBottom:14 }}>
                <span><strong style={{color:'var(--raven)'}}>School:</strong> {student.school||'-'}</span>
                <span><strong style={{color:'var(--raven)'}}>Unit:</strong> {unitName||'-'}</span>
                <span><strong style={{color:'var(--raven)'}}>Rotation:</strong> {student.term_dates||'-'}</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, textAlign:'center', marginBottom:12 }}>
                {[['Required', required], ['Approved', approved], ['Remaining', remaining]].map(([lbl, val]) => (
                  <div key={lbl}>
                    <div style={{ fontSize:28, fontWeight:700, color:'var(--nightfall)', lineHeight:1 }}>{val}</div>
                    <div style={{ fontSize:11, fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:3 }}>{lbl}</div>
                  </div>
                ))}
              </div>
              <div style={{ height:8, borderRadius:12, background:'var(--marina)', overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:12, width:`${pct}%`,
                  background: pct >= 100 ? '#166534' : 'var(--nightfall)',
                  transition:'width 600ms ease' }} />
              </div>
            </div>

            {/* Shift form */}
            <div style={{ background:'#fff', borderRadius:16, padding:'20px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)', overflow:'hidden', boxSizing:'border-box', width:'100%' }}>
              {formErrors.length > 0 && (
                <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, padding:'12px 14px', fontSize:14, color:'#991b1b', marginBottom:16 }}>
                  {formErrors.map((e,i) => <div key={i}>• {e}</div>)}
                </div>
              )}
              <form onSubmit={handleFormSubmit}>
                {/* Date */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Date of Shift</label>
                  <input style={{ ...INPUT, color:'#374151', WebkitTextFillColor:'#374151',
                    fontWeight:500, textAlign:'center', background:'#f3f4f6',
                    lineHeight:'52px', display:'block' }}
                    type="date" value={shiftDate} max={today}
                    onChange={e => setShiftDate(e.target.value)} />
                </div>

                {/* Hours */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Hours Worked</label>
                  <div style={{ display:'flex', alignItems:'center', gap:12, width:'100%' }}>
                    <button type="button" onClick={() => setHours(h => Math.max(1, +(h-0.5).toFixed(1)))}
                      style={{ width:48, height:48, borderRadius:'50%', fontSize:22, border:'2px solid var(--nightfall)', background:'#fff', cursor:'pointer', fontWeight:700, color:'var(--nightfall)', flexShrink:0 }}>−</button>
                    <span style={{ flex:1, fontSize:28, fontWeight:700, color:'var(--nightfall)', textAlign:'center', minHeight:56, display:'flex', alignItems:'center', justifyContent:'center' }}>{hours}</span>
                    <button type="button" onClick={() => setHours(h => Math.min(13, +(h+0.5).toFixed(1)))}
                      style={{ width:48, height:48, borderRadius:'50%', fontSize:22, border:'2px solid var(--nightfall)', background:'#fff', cursor:'pointer', fontWeight:700, color:'var(--nightfall)', flexShrink:0 }}>+</button>
                  </div>
                </div>

                {/* Shift type */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Shift Type</label>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                    {['Day','Night','Mid'].map(t => (
                      <button key={t} type="button" onClick={() => setShiftType(t)}
                        style={{ padding:'12px 8px', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer',
                          border: `2px solid ${shiftType===t ? '#1D2567' : '#e5e7eb'}`,
                          background: shiftType===t ? '#1D2567' : '#f9fafb',
                          color: shiftType===t ? '#ffffff' : '#374151',
                          fontFamily:'DM Sans,sans-serif' }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Assigned Unit */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Unit</label>
                  <div style={{ fontSize:15, color:'var(--nightfall)', fontWeight:500, padding:'12px 14px', background:'var(--sand)', borderRadius:10 }}>
                    {unitName || 'Not assigned'}
                  </div>
                  {!isDiffUnit && (
                    <button type="button" onClick={() => setIsDiffUnit(true)}
                      style={{ fontSize:13, color:'var(--nightfall)', background:'none', border:'none', cursor:'pointer', marginTop:6, textDecoration:'underline', padding:0 }}>
                      Different unit?
                    </button>
                  )}
                  {isDiffUnit && (
                    <div style={{ marginTop:10 }}>
                      <input style={{...INPUT, height:44, fontSize:14}} placeholder="Unit name" value={diffUnitName}
                        onChange={e => setDiffUnitName(e.target.value)} />
                      <textarea style={{ width:'100%', marginTop:8, padding:'10px 14px', borderRadius:10, border:'1px solid #e5e7eb', fontSize:14, fontFamily:'DM Sans,sans-serif', resize:'none', boxSizing:'border-box' }}
                        rows={2} required placeholder="Please explain (e.g. floated with preceptor)"
                        value={diffUnitReason} onChange={e => setDiffUnitReason(e.target.value)} />
                    </div>
                  )}
                </div>

                {/* Preceptor */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Preceptor Name</label>
                  <input style={INPUT} type="text" value={preceptorName}
                    onChange={e => { setPreceptorName(e.target.value); setPreceptorChanged(e.target.value !== (student.matched_preceptor||'')) }} />
                  {preceptorChanged && (
                    <div style={{ marginTop:6, fontSize:13, color:'#92400e', background:'#fef3c7', borderRadius:8, padding:'8px 12px' }}>
                      Changed preceptor noted. Please inform the ASPIRE team by emailing{' '}
                      <a href={`mailto:${JESTER}`} target="_blank" rel="noopener noreferrer" style={{ color:'var(--nightfall)' }}>{JESTER}</a>.
                    </div>
                  )}
                </div>

                {/* Learning highlight */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Learning Highlight <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                  <textarea style={{ width:'100%', padding:'12px 14px', borderRadius:10, border:'1px solid #e5e7eb', fontSize:14, fontFamily:'DM Sans,sans-serif', resize:'none', boxSizing:'border-box' }}
                    rows={3} placeholder="What did you learn or practice today?"
                    value={learningHighlight} onChange={e => setLearningHighlight(e.target.value)} />
                </div>

                {/* Support needed */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:14, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:6 }}>Support Needed <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                  <textarea style={{ width:'100%', padding:'12px 14px', borderRadius:10, border:'1px solid #e5e7eb', fontSize:14, fontFamily:'DM Sans,sans-serif', resize:'none', boxSizing:'border-box' }}
                    rows={3} placeholder="Any concerns or support you need?"
                    value={supportNeeded} onChange={e => setSupportNeeded(e.target.value)} />
                </div>

                {/* Attestation */}
                <label style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:22, cursor:'pointer' }}>
                  <input type="checkbox" checked={attestation} onChange={e => setAttestation(e.target.checked)}
                    style={{ width:22, height:22, marginTop:2, flexShrink:0, accentColor:'var(--nightfall)' }} />
                  <span style={{ fontSize:15, color:'var(--raven)', lineHeight:1.5 }}>
                    I confirm that the hours logged above are accurate to the best of my knowledge.
                  </span>
                </label>

                <button style={BTN_PRIMARY} type="submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Shift Log'}
                </button>
              </form>
            </div>
          </>
        )}

        {/* ── Confirmation screen ── */}
        {screen === 'confirm' && student && (
          <div style={{ background:'#fff', borderRadius:16, padding:'28px 24px', textAlign:'center', boxShadow:'0 2px 12px rgba(0,0,0,0.08)' }}>
            {submittedStatus === SHIFT_LOG_STATUSES.AUTO_ACCEPTED ? (
              <div style={{ background:'#D1FAE5', borderRadius:10, padding:'16px 20px', marginBottom:16 }}>
                <div style={{ fontSize:40, marginBottom:6 }}>✅</div>
                <h2 style={{ fontSize:22, fontWeight:700, color:'#065F46', margin:'0 0 6px' }}>Shift Logged Successfully</h2>
                <p style={{ fontSize:14, color:'#065F46', margin:0 }}>Welcome, {getStudentPreferredGreetingName(student)}! Your shift has been added to your record.</p>
              </div>
            ) : submittedStatus === SHIFT_LOG_STATUSES.PENDING_REVIEW ? (
              <div style={{ background:'#FEF3C7', borderRadius:10, padding:'16px 20px', marginBottom:16 }}>
                <div style={{ fontSize:40, marginBottom:6 }}>🟡</div>
                <h2 style={{ fontSize:20, fontWeight:700, color:'#78350F', margin:'0 0 6px' }}>Shift Submitted for Review</h2>
                <p style={{ fontSize:14, color:'#92400e', marginBottom:6, lineHeight:1.5 }}>
                  Your shift has been logged but flagged for review by the ASPIRE team. It will be added to your total once approved.
                </p>
                {submittedReason && (
                  <p style={{ fontSize:13, color:'#78350F', background:'rgba(0,0,0,0.06)', borderRadius:6, padding:'6px 10px', marginTop:6, textAlign:'left', lineHeight:1.5 }}>
                    <strong>Reason: </strong>{submittedReason}
                  </p>
                )}
              </div>
            ) : (
              <div style={{ background:'#FEE2E2', borderRadius:10, padding:'16px 20px', marginBottom:16 }}>
                <div style={{ fontSize:40, marginBottom:6 }}>❌</div>
                <h2 style={{ fontSize:20, fontWeight:700, color:'#7F1D1D', margin:'0 0 6px' }}>Submission Issue</h2>
                <p style={{ fontSize:14, color:'#7F1D1D', margin:0 }}>Something unexpected happened. Please try again or contact the ASPIRE team.</p>
              </div>
            )}

            {/* Updated progress */}
            <div style={{ background:'var(--sand)', borderRadius:12, padding:'16px', marginBottom:16 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, textAlign:'center', marginBottom:10 }}>
                {[['Required', required], ['Approved', newApproved], ['Remaining', Math.max(0,required-newApproved)]].map(([lbl,val]) => (
                  <div key={lbl}>
                    <div style={{ fontSize:24, fontWeight:700, color:'var(--nightfall)' }}>{val}</div>
                    <div style={{ fontSize:11, fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>{lbl}</div>
                  </div>
                ))}
              </div>
              <div style={{ height:8, borderRadius:12, background:'#e5e7eb', overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:12,
                  width:`${required>0?Math.min(100,(newApproved/required)*100):0}%`,
                  background: newApproved>=required?'#166534':'var(--nightfall)' }} />
              </div>
            </div>

            {/* Milestone: just crossed the threshold this shift */}
            {celebration && newApproved >= required && (
              <div style={{ background:'#dcfce7', border:'1px solid #86efac', borderRadius:16, padding:'20px', marginBottom:16, textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:8 }}>⭐</div>
                <div style={{ fontSize:20, fontWeight:700, color:'#166534', marginBottom:8, fontFamily:'DM Sans,sans-serif' }}>
                  You've Completed Your Required Hours!
                </div>
                <p style={{ fontSize:14, color:'#166534', lineHeight:1.6, margin:'0 0 16px' }}>
                  Congratulations on completing your {required} required hours for ASPIRE at Cedars-Sinai. Your coordinator will be in touch soon with your Certificate of Completion.
                </p>
                <button
                  onClick={() => {
                    const subject = encodeURIComponent(`ASPIRE Hours Completed - ${student.first_name} ${student.last_name}`)
                    const body = encodeURIComponent(`Hi Jester,\n\nI have completed my required ${required} hours for ASPIRE rotation.\n\nStudent: ${student.last_name}, ${student.first_name}\nSchool: ${student.school}\nTotal Approved Hours: ${newApproved}\n\nThank you!`)
                    openMailtoLink(`mailto:JesterLloyd.Bautista@cshs.org?subject=${subject}&body=${body}`)
                  }}
                  style={{ background:'var(--nightfall)', color:'#fff', border:'none', borderRadius:10, padding:'12px 24px', fontSize:15, fontWeight:700, fontFamily:'DM Sans,sans-serif', cursor:'pointer' }}>
                  Remind My Coordinator
                </button>
              </div>
            )}
            {/* Already over required hours - logging additional shifts */}
            {!celebration && newApproved >= required && required > 0 && (
              <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 16px', marginBottom:16, fontSize:14, color:'#166534', lineHeight:1.6, textAlign:'center' }}>
                You have logged <strong>{newApproved}</strong> hours, exceeding your required <strong>{required}</strong>. Great dedication!
              </div>
            )}

            <button onClick={resetForm}
              style={{ width:'100%', height:48, borderRadius:12, fontSize:15, fontWeight:600, fontFamily:'DM Sans,sans-serif', background:'#fff', border:'2px solid var(--nightfall)', color:'var(--nightfall)', cursor:'pointer', marginBottom:12 }}>
              Log Another Shift
            </button>
            <p style={{ fontSize:13, color:'#6b7280', margin:0 }}>
              To edit or delete a previous entry, email <a href={`mailto:${JESTER}`} target="_blank" rel="noopener noreferrer" style={{ color:'var(--nightfall)' }}>{JESTER}</a>.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
