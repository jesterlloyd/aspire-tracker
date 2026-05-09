import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { buildUnitLeaderEmail } from '../lib/emailUtils'

// ── Type metadata (in commTypes.js to avoid bundler TDZ with StudentSidePanel) ─
import { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
export { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' at ' +
    d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})
}
function fmtIvDate(s) {
  if (!s) return ''
  const [y,m,d] = s.split('-').map(Number)
  return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
}
function openHref(href) { const a=document.createElement('a'); a.href=href; a.click() }

// ── Reusable card wrapper ────────────────────────────────────
function ActionCard({ title, borderColor, icon, count, children, badgeBg = '#6b7280' }) {
  const [open, setOpen] = useState(count > 0)
  if (count === 0) return (
    <div style={{ borderLeft:`4px solid #e5e7eb`, background:'#f9fafb', borderRadius:6,
      marginBottom:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
      <span>{icon}</span>
      <span style={{ fontSize:13, fontWeight:600, color:'#9ca3af', flex:1 }}>{title}</span>
      <span style={{ fontSize:11, color:'#9ca3af' }}>All clear ✓</span>
    </div>
  )
  return (
    <div style={{ borderLeft:`4px solid ${borderColor}`, border:`1px solid ${borderColor}`,
      borderLeftWidth:4, borderRadius:6, marginBottom:8, background:'#fff', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer' }}
        onClick={() => setOpen(p=>!p)}>
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ fontSize:14, fontWeight:600, color:'var(--raven)', flex:1 }}>{title}</span>
        <span style={{ background:badgeBg, color:'#ffffff', fontFamily:'DM Sans,sans-serif',
          fontWeight:700, fontSize:11, minWidth:20, height:20, borderRadius:10,
          display:'flex', alignItems:'center', justifyContent:'center',
          padding:'0 6px', flexShrink:0 }}>{count}</span>
        <span style={{ fontSize:12, color:'#9ca3af' }}>{open?'▾':'▸'}</span>
      </div>
      {open && <div style={{ borderTop:`1px solid ${borderColor}` }}>{children}</div>}
    </div>
  )
}

// ── Student row ───────────────────────────────────────────────
function SRow({ student, pending, onOpenMail, onMarkSent, noMail=false, warning=null, linkLabel=null, onLink=null }) {
  const initials = `${(student.first_name||'')[0]||''}${(student.last_name||'')[0]||''}`.toUpperCase()||'?'
  const cfg = ASPIRE_STATUS_CONFIG[student.status]||{bg:'#f3f4f6',text:'#6b7280',border:'#d1d5db'}
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
      borderBottom:'1px solid #f9fafb' }}>
      <div style={{ width:28,height:28,borderRadius:'50%',background:'var(--nightfall)',color:'#fff',
        display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0 }}>
        {initials}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13,fontWeight:500,color:'var(--raven)',whiteSpace:'nowrap',
          overflow:'hidden',textOverflow:'ellipsis' }}>
          {student.last_name}{student.last_name&&student.first_name?', ':''}{student.first_name}
        </div>
        <div style={{ fontSize:12,color:'#6b7280',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>
          {student.school}
        </div>
      </div>
      <span style={{ fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:10,
        background:cfg.bg,color:cfg.text,border:`1px solid ${cfg.border}`,
        whiteSpace:'nowrap',flexShrink:0 }}>{student.status}</span>
      <div style={{ flexShrink:0, minWidth:80, textAlign:'right' }}>
        {warning ? (
          <span style={{ fontSize:11,color:'#92400e',background:'#fef3c7',padding:'2px 6px',borderRadius:4 }}>{warning}</span>
        ) : noMail && linkLabel ? (
          <button onClick={onLink} style={{ fontSize:11,color:'var(--nightfall)',background:'none',
            border:'none',cursor:'pointer',textDecoration:'underline' }}>{linkLabel}</button>
        ) : noMail ? null : pending ? (
          <label style={{ display:'flex',alignItems:'center',gap:4,fontSize:12,cursor:'pointer',color:'#166534' }}>
            <input type="checkbox" onChange={e=>e.target.checked&&onMarkSent()} />
            <span>Mark sent</span>
          </label>
        ) : (
          <button onClick={onOpenMail}
            style={{ background:'none',border:'1px solid var(--border)',borderRadius:4,
              cursor:'pointer',padding:'3px 10px',fontSize:13 }}>✉</button>
        )}
      </div>
    </div>
  )
}

// ── Email builders ────────────────────────────────────────────
const SIG = `Warm regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964`

const KR_SIG = `Kind regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964`

function mailto(to, subject, body, cc='') {
  return `mailto:${encodeURIComponent(to)}${cc?`?cc=${encodeURIComponent(cc)}&`:'?'}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function buildStudentFormEmail(s) {
  return mailto(s.school_email, 'ASPIRE Program Student Form – Action Required',
`Dear ${s.first_name},

You have been identified as a potential candidate for the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai Medical Center.

To begin the process, please complete your ASPIRE Student Profile using the link below:

https://aspire-tracker.vercel.app/student-form

This form collects your personal information, clinical interests, and unit preferences. It should take approximately 10 to 15 minutes to complete.

If you have any questions, please don't hesitate to reach out.

${SIG}`)
}

function buildSchedulingLinkEmail(s) {
  return mailto(s.school_email, 'Schedule Your ASPIRE Interview',
`Dear ${s.first_name},

Thank you for completing your ASPIRE Student Profile. The next step is to schedule your interview with our Nursing Professional Development team.

Please use the link below to view available times and select one that works for your schedule:

https://aspire-tracker.vercel.app/interview-schedule

When prompted, enter your school email address to access the scheduling page.

Your interview will be conducted via Microsoft Teams. The meeting link will be sent to you separately after you book your slot.

If you have any questions, please don't hesitate to reach out.

${SIG}`)
}

function buildInterviewReminderEmail(s) {
  const to = s.personal_email || s.school_email
  return mailto(to, 'Reminder: Your ASPIRE Interview is Coming Up',
`Dear ${s.first_name},

This is a friendly reminder that your ASPIRE interview is scheduled for:

Date: ${fmtIvDate(s.interview_scheduled_date)}
Time: ${s.interview_scheduled_time||'TBD'} Pacific Time
Duration: ${s.interview_duration_minutes||30} minutes
Format: Microsoft Teams

Please make sure you are in a quiet, professional setting with a stable internet connection. If you need to reschedule, please email JesterLloyd.Bautista@cshs.org as soon as possible.

We look forward to speaking with you!

${SIG}`)
}

function buildMidpointCheckinEmail(s) {
  const to = s.personal_email || s.school_email
  return mailto(to, 'Checking In on Your ASPIRE Rotation',
`Dear ${s.first_name},

We hope your rotation at Cedars-Sinai is going well! We wanted to take a moment to check in and see how things are going on the unit.

A few things to reflect on:

- How are you feeling about your clinical experience so far?
- Are you getting the hands-on learning opportunities you were hoping for?
- Is there anything you need from the ASPIRE team to support you?

Feel free to reply to this email with anything on your mind. We are here to support you throughout your rotation and want to make sure you are thriving.

If you have not already done so, please remember to reach out regularly to your preceptor and communicate openly about your learning goals and schedule.

Keep up the great work. We are proud of the commitment and dedication you are showing.

${SIG}`)
}

function buildMidpointEvalEmail(s) {
  const prec = s.matched_preceptor || 'Preceptor'
  const precFirst = prec.split(' ')[0]
  return mailto(s.preceptor_email, `ASPIRE Midpoint Evaluation – ${s.last_name}, ${s.first_name}`,
`Dear ${precFirst},

Thank you for mentoring ${s.first_name} through their senior rotation at Cedars-Sinai. We hope the experience has been rewarding for both of you.

We are reaching out to request your midpoint feedback on ${s.first_name}'s clinical performance. This evaluation helps us provide coaching and support to the student during the remaining weeks of their rotation.

Please complete the brief ASPIRE Preceptor Feedback Questionnaire using the link below. When prompted, please select "Midpoint" as the Feedback Period:

https://forms.cloud.microsoft/r/brGDMzFXgy

This should take approximately 5 to 10 minutes. Your responses are confidential and will not be shared with the student.

Thank you again for your dedication to clinical nursing education. Your guidance makes a meaningful difference in ${s.first_name}'s journey toward professional practice.

${KR_SIG}`)
}

function buildPostSurveyEmail(s) {
  return mailto(s.personal_email||s.school_email, 'Complete Your ASPIRE Post-Program Survey',
`Dear ${s.first_name},

Congratulations on completing your ASPIRE rotation at Cedars-Sinai! We are so proud of everything you have accomplished.

As part of program completion, we ask that you take 10 to 15 minutes to complete the ASPIRE Clinical Readiness Survey. Your feedback helps us evaluate and improve the program for future students:

https://forms.cloud.microsoft/r/GWAdKLuM8J

Please complete this survey as soon as possible. Your certificate of completion will follow shortly.

Thank you for being part of ASPIRE. We wish you continued success as you prepare for licensure and your nursing career.

${SIG}`)
}

function buildCertificateEmail(s) {
  return mailto(s.personal_email||s.school_email, 'Your ASPIRE Program Certificate of Completion',
`Dear ${s.first_name},

Thank you for completing the ASPIRE Program Evaluation. We truly appreciate your feedback!

Please find your Certificate of Completion attached to this email. You are welcome to print or save a copy for your records.

Please remember to attach the certificate PDF before sending.

We are honored to have been part of your nursing journey and wish you continued success as you prepare for licensure and future practice.

${KR_SIG}`)
}

function buildEndEvalEmail(s) {
  const prec = s.matched_preceptor || 'Preceptor'
  const precFirst = prec.split(' ')[0]
  return mailto(s.preceptor_email, `ASPIRE End-of-Rotation Evaluation – ${s.last_name}, ${s.first_name}`,
`Dear ${precFirst},

Thank you so much for serving as a preceptor for ${s.first_name} this rotation cycle. Your mentorship has made a lasting impact on their development as a future nurse.

Now that ${s.first_name}'s rotation has concluded, we kindly ask that you complete the final ASPIRE Preceptor Feedback Questionnaire. Please select "End" as the Feedback Period when completing the form:

https://forms.cloud.microsoft/r/brGDMzFXgy

This evaluation takes approximately 5 to 10 minutes and helps us assess student readiness for professional practice and continuously improve the ASPIRE Program.

Your responses are confidential and will not be shared with the student.

Thank you again for everything you have contributed to ASPIRE and to the future of nursing at Cedars-Sinai.

${KR_SIG}`)
}

function buildPreceptorWelcomeEmail(s, unitContactEmail) {
  const prec = s.matched_preceptor || 'Preceptor'
  const precFirst = prec.split(' ')[0]
  const cc = unitContactEmail || ''
  return mailto(s.preceptor_email, 'ASPIRE Program – Student Preceptor Assignment',
`Dear ${precFirst},

Thank you so much for agreeing to precept one of our senior nursing students through the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience). Your willingness to teach, mentor, and support our students truly makes a difference in shaping the next generation of nurses at Cedars-Sinai.

Below is your student assignment for this rotation:

Student: ${s.last_name}, ${s.first_name}
School: ${s.school||'N/A'}
Program: ${s.program_type||'N/A'}
Rotation Dates: ${s.term_dates||'TBD'}
Shifts to Complete: ${s.hours_required||'TBD'}
Student Email: ${s.personal_email||'N/A'}
Student Phone: ${s.phone||'N/A'}

${s.first_name} will reach out to you directly to introduce themselves so you can coordinate your schedules together. They can begin their shifts at any time after orientation. They may also share their individual learning objectives with you to help guide their experience.

Please remember to attach before sending:
- ASPIRE Brochure
- Pre-licensure Student General Guidelines

A few quick reminders:
- Preceptor pay: If eligible, please feel free to reach out to Dr. Krystal Rodriguez with any questions.
- Coverage: If possible, please avoid being in charge while precepting so you can focus on teaching.
- Floating: Students may float with you if you are comfortable and it is appropriate for safety and learning.

We truly appreciate the time, effort, and heart you invest in mentoring our students. If you have any questions, please don't hesitate to reach out.

${KR_SIG}`, cc)
}

// ── Main ActionCenter component ───────────────────────────────
export default function ActionCenter({
  isOpen, onClose,
  students, units, matches, cohortId, activeCohort,
  communications, onLogCommunication, onMatchUpdate, onStudentUpdate,
  onNavigateToProfiles,
}) {
  const [pending, setPending]     = useState({})
  const [oriFields, setOriFields] = useState({ date:'', time:'', location:'' })
  const [copyOk,    setCopyOk]    = useState(false)
  const [oriDone,   setOriDone]   = useState(false)
  const drawerRef = useRef(null)

  // Shift log data for new action categories
  const [shiftLogs,     setShiftLogs]     = useState([])
  const [shiftLogsLoaded, setShiftLogsLoaded] = useState(false)
  useEffect(() => {
    if (!isOpen || !cohortId || shiftLogsLoaded) return
    supabase.from('student_shift_logs').select('*').eq('cohort_id', cohortId)
      .order('submitted_at', { ascending: false })
      .then(({ data }) => { setShiftLogs(data || []); setShiftLogsLoaded(true) })
  }, [isOpen, cohortId]) // eslint-disable-line
  // Reset when cohort changes
  useEffect(() => { setShiftLogs([]); setShiftLogsLoaded(false) }, [cohortId])

  const hasSent = (sid, type) =>
    communications.some(c => c.student_id === sid && c.type === type)

  const setPend = (sid, type) =>
    setPending(p => ({ ...p, [`${sid}_${type}`]: true }))

  const isPend = (sid, type) => !!pending[`${sid}_${type}`]

  const logComm = async ({ type, student, sentToEmail, sentToName, after }) => {
    const { data } = await supabase.from('communications').insert({
      student_id: student?.id || null, cohort_id: cohortId, type,
      sent_to_email: sentToEmail || '',
      sent_to_name: sentToName || (student ? `${student.last_name}, ${student.first_name}` : ''),
      sent_by: 'ASPIRE Team',
    }).select().single()
    if (data && onLogCommunication) onLogCommunication(data)
    if (after) await after()
    if (student) setPending(p => { const n={...p}; delete n[`${student.id}_${type}`]; return n })
  }

  // ── Action category queries ──────────────────────────────
  const now   = new Date()
  const td    = fmtLocalDate(now)
  const in48d = new Date(now.getTime() + 48*3600*1000)
  const t48   = fmtLocalDate(in48d)

  const act1  = students.filter(s => s.status === 'Pending Outreach')
  const act2  = students.filter(s => s.status === 'Form Received' && !s.interview_scheduled_date)
  const act3  = students.filter(s =>
    s.interview_scheduled_date >= td && s.interview_scheduled_date <= t48 &&
    !hasSent(s.id, 'interview_reminder')
  )
  const act4  = students.filter(s => {
    if (s.status !== 'Placed' || !s.matched_unit_id) return false
    const m = matches.find(m => m.student_id === s.id)
    return m && !m.notification_sent
  })
  const act5  = students.filter(s => s.status === 'Placed' && s.matched_preceptor && !hasSent(s.id, 'preceptor_welcome'))
  // Show when ASPIRE is progressing but Service Center Step 2 has not been submitted yet.
  // Clears when cs_stage1_submitted = true (Step 2 checkbox ticked).
  const act6  = students.filter(s =>
    ['Form Received','Interview Scheduled','Interviewed','Placed','Active Rotation'].includes(s.status) &&
    (!s.cs_cedars_status || !s.cs_stage1_submitted)
  )
  const placedStudents = students.filter(s => s.status === 'Placed')
  const showAct7 = activeCohort && !activeCohort.orientation_sent_at && placedStudents.length > 0 && !oriDone
  const act8  = students.filter(s => s.status === 'Active Rotation' && !hasSent(s.id, 'midpoint_checkin'))
  const act9  = students.filter(s => s.status === 'Active Rotation' && !hasSent(s.id, 'midpoint_eval'))
  const act10 = students.filter(s => s.status === 'Completed' && !hasSent(s.id, 'post_survey'))
  const act11 = students.filter(s => s.status === 'Completed' && !hasSent(s.id, 'certificate'))
  const act12 = students.filter(s => s.status === 'Completed' && !hasSent(s.id, 'end_eval'))

  // ── New shift-log based actions ──────────────────────────────
  // Act 13: Shift logs needing review
  const act13 = shiftLogs.filter(l => l.status === 'needs_review' && !l.reviewed_at)
    .map(l => ({ ...l, student: students.find(s => s.id === l.student_id) }))
    .filter(l => l.student)

  // Act 14: Completed required hours (need certificate)
  const act14 = students.filter(s =>
    ['Active Rotation','Completed'].includes(s.status) &&
    parseFloat(s.approved_hours||0) >= parseFloat(s.hours_required||0) &&
    parseFloat(s.hours_required||0) > 0 &&
    !hasSent(s.id, 'certificate')
  )

  // Act 15: Not logged recently (Active Rotation, no log in 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7*24*3600*1000).toISOString()
  const act15 = students.filter(s => {
    if (s.status !== 'Active Rotation') return false
    const recentLog = shiftLogs.find(l => l.student_id === s.id && l.submitted_at >= sevenDaysAgo)
    return !recentLog
  }).map(s => {
    const lastLog = shiftLogs.filter(l => l.student_id === s.id).sort((a,b) => b.submitted_at?.localeCompare(a.submitted_at||'')||0)[0]
    const daysSince = lastLog ? Math.floor((Date.now() - new Date(lastLog.submitted_at).getTime()) / (24*3600*1000)) : null
    return { ...s, daysSince }
  })

  // Act 16: Badge not created (Placed, badge_created = false)
  const act16 = students.filter(s => s.status === 'Placed' && !s.badge_created)

  // ── Orientation email builder ────────────────────────────
  const buildOrientationTable = () => {
    const rows = placedStudents.map(s => {
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name}, ${s.first_name} | ${u?.unit_name||'—'} | ${s.shift_assigned||'—'} | ${s.matched_preceptor||'—'} | ${s.preceptor_email||'—'}`
    }).join('\n')
    return `Student Name | Unit | Shift | Preceptor | Preceptor Email\n${rows}`
  }

  const buildOrientationBody = () => {
    const table = buildOrientationTable()
    return `Dear ASPIRANTS,

Congratulations and welcome to the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience)!

We are so excited to have you join us at Cedars-Sinai for your senior rotation. This is a huge milestone in your nursing journey, and we are here to support you every step of the way as you build confidence, sharpen your clinical skills, and prepare for practice.

Your Unit and Preceptor

Below are your assigned units and preceptors:

${table}

Your next step: please reach out to your preceptor via email to introduce yourself and begin coordinating your schedule. You may start planning your shifts, but please remember you cannot begin your clinical rotation until after orientation is completed.

Orientation Details

${oriFields.date||'[Date TBD]'}
${oriFields.time||'[Time TBD]'}
Meet at 7:50 AM: ${oriFields.location||'[Location TBD]'}

We will walk through everything you need to know to feel prepared and confident before stepping onto your unit.

What to Bring
- Wear your school uniform
- Student ID badge
- Completed Student Parking Data Form
- $20 for parking (covers your entire rotation)

Parking Info
Park at P4 Visitor Parking
127 S. Sherbourne Dr., Los Angeles, CA 90048
Cedars employees and volunteers: park in your usual assigned area.

What to Expect
- Orientation session covering policies, expectations, and tips for success
- Time to ask questions
- Optional unit tours if your preceptor is available

Attachments (print and bring with you)
- Student Parking Data Form
- Pre-licensure Student General Guidelines
- Campus Map
- Orientation Agenda

Helpful Resources (for reference)
- Unit Specialty Resource Chart
- HealthStream eLearning Instructions
- If applicable: ScrubEx Request Form (OR/Mother-Baby only)

Quick Tip: If your unit has a brochure, just ask during orientation. If you have not done so already, please email me your professional headshot as soon as possible so we can create your Cedars-Sinai badge.

Before your rotation begins, please take 5 to 10 minutes to complete our Pre-Program Clinical Readiness Survey. Your responses help us personalize your experience and measure program impact:

https://forms.cloud.microsoft/r/6TX6sV76ga

If you have any questions before orientation, feel free to reach out anytime. We are truly excited to meet you and kick off your ASPIRE experience!

${KR_SIG.replace('Warm regards,','').replace('Kind regards,','Kind regards,\nThe ASPIRE Team\n\n')}`
  }

  const handleCopyOrientation = async () => {
    await navigator.clipboard.writeText(buildOrientationBody())
    setCopyOk(true); setTimeout(() => setCopyOk(false), 2000)
  }

  const handleOpenOrientationMailto = () => {
    const bccs = placedStudents.map(s => s.personal_email||s.school_email).filter(Boolean).join(',')
    const href = `mailto:?bcc=${encodeURIComponent(bccs)}&subject=${encodeURIComponent('Welcome to the ASPIRE Program – Orientation Details Inside')}`
    openHref(href)
  }

  const handleMarkOrientationSent = async () => {
    const now = new Date().toISOString()
    await supabase.from('cohorts').update({ orientation_sent_at: now }).eq('id', cohortId)
    for (const s of placedStudents) {
      await logComm({ type:'orientation_survey', student:s, sentToEmail:s.personal_email||s.school_email, sentToName:`${s.last_name}, ${s.first_name}` })
    }
    setOriDone(true)
  }

  // Click-outside to close
  useEffect(() => {
    if (!isOpen) return
    const handler = e => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const recentComms = [...communications].sort((a,b) => b.sent_at?.localeCompare(a.sent_at||'')).slice(0,15)

  return (
    <>
      {/* Overlay */}
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', zIndex:300 }} />

      {/* Drawer */}
      <div ref={drawerRef} style={{
        position:'fixed', top:0, right:0, bottom:0, width:440,
        background:'var(--pearl)', borderLeft:'1px solid #e5e7eb',
        zIndex:301, display:'flex', flexDirection:'column',
        animation:'cal-popover-in 150ms ease',
      }}>
        {/* Drawer header */}
        <div style={{ background:'var(--nightfall)', height:56, padding:'0 20px',
          display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span style={{ fontSize:16, fontWeight:700, color:'#fff', flex:1 }}>Action Center</span>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:'#fff', fontSize:20, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        {/* Drawer body */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Action Items — 65% */}
          <div style={{ flex:'0 0 65%', display:'flex', flexDirection:'column', overflow:'hidden', borderBottom:'1px solid #e5e7eb' }}>
            <div style={{ padding:'12px 16px 6px', flexShrink:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Action Items
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'0 16px 12px' }}>

              {/* 1: Student Form */}
              <ActionCard title="Send Student Form" borderColor="#e5e7eb" icon="📧" count={act1.length} badgeBg="#6b7280">
                {act1.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'student_form')}
                    onOpenMail={() => { openHref(buildStudentFormEmail(s)); setPend(s.id,'student_form') }}
                    onMarkSent={() => logComm({ type:'student_form', student:s,
                      sentToEmail:s.school_email,
                      after: () => onStudentUpdate?.(s.id,{status:'Form Sent'}) })} />
                ))}
              </ActionCard>

              {/* 2: Scheduling Link */}
              <ActionCard title="Send Interview Scheduling Link" borderColor="#dbeafe" icon="📅" count={act2.length} badgeBg="#1d4ed8">
                {act2.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'scheduling_link')}
                    onOpenMail={() => { openHref(buildSchedulingLinkEmail(s)); setPend(s.id,'scheduling_link') }}
                    onMarkSent={() => logComm({ type:'scheduling_link', student:s, sentToEmail:s.school_email })} />
                ))}
              </ActionCard>

              {/* 3: Interview Reminder */}
              <ActionCard title="Interview Reminder" borderColor="#ede9fe" icon="🔔" count={act3.length} badgeBg="#7c3aed">
                {act3.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'interview_reminder')}
                    onOpenMail={() => { openHref(buildInterviewReminderEmail(s)); setPend(s.id,'interview_reminder') }}
                    onMarkSent={() => logComm({ type:'interview_reminder', student:s, sentToEmail:s.personal_email||s.school_email })} />
                ))}
              </ActionCard>

              {/* 4: Unit Leader Notification */}
              <ActionCard title="Unit Leader Placement Notification" borderColor="#dcfce7" icon="✅" count={act4.length} badgeBg="#166534">
                {act4.map(s => {
                  const unit = units.find(u => u.id === s.matched_unit_id)
                  const m    = matches.find(m => m.student_id === s.id)
                  const href = unit ? buildUnitLeaderEmail({
                    contactPersons: unit.contact_person||'Unit Leader',
                    contactEmails:  unit.contact_email||'',
                    unitName: unit.unit_name,
                    students: [{ firstName:s.first_name, lastName:s.last_name||s.name, school:s.school||'',
                      programType:s.program_type||'', termDates:s.term_dates||'', hoursRequired:s.hours_required||'',
                      shiftPreference:s.shift_availability||'', preceptorAssigned:s.matched_preceptor||'' }],
                    isMultiStudent: false,
                  }) : null
                  return (
                    <SRow key={s.id} student={s} pending={isPend(s.id,'unit_notification')}
                      onOpenMail={() => { if(href) { openHref(href); setPend(s.id,'unit_notification') } }}
                      onMarkSent={() => logComm({ type:'unit_notification', student:s,
                        sentToEmail: unit?.contact_email||'',
                        after: () => m && onMatchUpdate?.(m.id, s.id, { notification_sent:true }) })} />
                  )
                })}
              </ActionCard>

              {/* 5: Preceptor Welcome */}
              <ActionCard title="Preceptor Welcome Email" borderColor="#fef3c7" icon="👋" count={act5.length} badgeBg="#92400e">
                {act5.map(s => {
                  const unit = units.find(u => u.id === s.matched_unit_id)
                  const missingEmail = !s.preceptor_email
                  return (
                    <SRow key={s.id} student={s} pending={isPend(s.id,'preceptor_welcome')}
                      warning={missingEmail ? 'Preceptor email missing' : null}
                      linkLabel={missingEmail ? 'Add in Profile →' : null}
                      onLink={() => { onClose(); onNavigateToProfiles?.(s.id) }}
                      onOpenMail={missingEmail ? undefined : () => {
                        openHref(buildPreceptorWelcomeEmail(s, unit?.contact_email))
                        setPend(s.id,'preceptor_welcome')
                      }}
                      onMarkSent={() => logComm({ type:'preceptor_welcome', student:s, sentToEmail:s.preceptor_email })} />
                  )
                })}
              </ActionCard>

              {/* 6: CS-Link (internal flag only) */}
              <ActionCard title="CS-Link Access Not Started" borderColor="#fee2e2" icon="🔗" count={act6.length} badgeBg="#991b1b">
                <div style={{ padding:'8px 14px 4px', fontSize:12, color:'#6b7280', lineHeight:1.5 }}>
                  These students need a CS-Link access request submitted in the Service Center. Go to their Student Profile and complete Step 2 under CS-Link Access.
                </div>
                {act6.map(s => (
                  <SRow key={s.id} student={s} noMail
                    linkLabel="Go to Profile →"
                    onLink={() => { onClose(); onNavigateToProfiles?.(s.id) }} />
                ))}
              </ActionCard>

              {/* 7: Orientation (cohort-level) */}
              {showAct7 && (
                <div style={{ borderLeft:'4px solid #d1fae5', border:'1px solid #d1fae5',
                  borderLeftWidth:4, borderRadius:6, marginBottom:8, background:'#fff' }}>
                  <div style={{ padding:'10px 14px', borderBottom:'1px solid #d1fae5',
                    display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, flex:1 }}>
                      <span style={{ fontSize:16 }}>🎉</span>
                      <span style={{ fontSize:14, fontWeight:600, color:'var(--raven)', flex:1 }}>
                        Orientation Email + Pre-Program Survey
                      </span>
                    </div>
                    <span style={{ background:'#065f46', color:'#ffffff', fontFamily:'DM Sans,sans-serif',
                      fontWeight:700, fontSize:11, minWidth:20, height:20, borderRadius:10,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      padding:'0 6px', flexShrink:0, marginLeft:8 }}>1</span>
                  </div>
                  <div style={{ padding:'12px 14px' }}>
                    <div style={{ fontSize:12, color:'#6b7280', marginBottom:10 }}>
                      {placedStudents.length} placed student{placedStudents.length!==1?'s':''} will receive this email.
                    </div>
                    {/* Fields */}
                    {[['date','Orientation Date','e.g. Tuesday, June 3, 2026'],
                      ['time','Orientation Time','e.g. 8:00 AM – 12:00 NN'],
                      ['location','Meeting Location','e.g. Starbucks, South Tower, Plaza Level']
                    ].map(([k,lbl,ph]) => (
                      <div key={k} style={{ marginBottom:8 }}>
                        <label style={{ fontSize:12, fontWeight:600, color:'var(--raven)', display:'block', marginBottom:3 }}>{lbl}</label>
                        <input className="form-input" style={{ fontSize:12 }} placeholder={ph}
                          value={oriFields[k]} onChange={e => setOriFields(p=>({...p,[k]:e.target.value}))} />
                      </div>
                    ))}
                    {/* Table preview */}
                    <div style={{ background:'var(--marina)', borderRadius:6, padding:'10px 12px', marginBottom:12, fontSize:11, fontFamily:'monospace', whiteSpace:'pre-wrap', overflowX:'auto', maxHeight:120, overflowY:'auto' }}>
                      {buildOrientationTable()}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={handleCopyOrientation}
                        style={{ flex:1, padding:'8px', fontSize:13, fontWeight:600, background:'var(--nightfall)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
                        {copyOk ? 'Copied! ✓' : 'Copy Full Email'}
                      </button>
                      <button onClick={handleOpenOrientationMailto}
                        style={{ flex:1, padding:'8px', fontSize:13, fontWeight:600, background:'var(--pearl)', color:'var(--nightfall)', border:'1.5px solid var(--nightfall)', borderRadius:6, cursor:'pointer' }}>
                        Open in Outlook
                      </button>
                    </div>
                    <label style={{ display:'flex', alignItems:'center', gap:6, marginTop:10, fontSize:12, cursor:'pointer', color:'#166534' }}>
                      <input type="checkbox" onChange={e => e.target.checked && handleMarkOrientationSent()} />
                      <span>Mark Orientation Email as Sent</span>
                    </label>
                  </div>
                </div>
              )}
              {!showAct7 && (
                <ActionCard title="Orientation Email + Pre-Program Survey" borderColor="#d1fae5" icon="🎉" count={0} />
              )}

              {/* 8: Midpoint Check-In */}
              <ActionCard title="Midpoint Student Check-In" borderColor="#eff6ff" icon="💬" count={act8.length} badgeBg="#1e40af">
                {act8.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'midpoint_checkin')}
                    onOpenMail={() => { openHref(buildMidpointCheckinEmail(s)); setPend(s.id,'midpoint_checkin') }}
                    onMarkSent={() => logComm({ type:'midpoint_checkin', student:s, sentToEmail:s.personal_email||s.school_email })} />
                ))}
              </ActionCard>

              {/* 9: Midpoint Preceptor Eval */}
              <ActionCard title="Midpoint Preceptor Evaluation" borderColor="#fef3c7" icon="📊" count={act9.length} badgeBg="#92400e">
                {act9.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'midpoint_eval')}
                    warning={!s.preceptor_email ? 'Preceptor email missing' : null}
                    onOpenMail={s.preceptor_email ? () => { openHref(buildMidpointEvalEmail(s)); setPend(s.id,'midpoint_eval') } : undefined}
                    onMarkSent={() => logComm({ type:'midpoint_eval', student:s, sentToEmail:s.preceptor_email })} />
                ))}
              </ActionCard>

              {/* 10: Post-Program Survey */}
              <ActionCard title="Post-Program Student Survey" borderColor="#dcfce7" icon="📋" count={act10.length} badgeBg="#166534">
                {act10.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'post_survey')}
                    onOpenMail={() => { openHref(buildPostSurveyEmail(s)); setPend(s.id,'post_survey') }}
                    onMarkSent={() => logComm({ type:'post_survey', student:s, sentToEmail:s.personal_email||s.school_email })} />
                ))}
              </ActionCard>

              {/* 11: Certificate */}
              <ActionCard title="Certificate of Completion" borderColor="#d1fae5" icon="🎓" count={act11.length} badgeBg="#065f46">
                {act11.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'certificate')}
                    onOpenMail={() => { openHref(buildCertificateEmail(s)); setPend(s.id,'certificate') }}
                    onMarkSent={() => logComm({ type:'certificate', student:s, sentToEmail:s.personal_email||s.school_email })} />
                ))}
              </ActionCard>

              {/* 12: End Preceptor Eval */}
              <ActionCard title="End Preceptor Evaluation" borderColor="#e5e7eb" icon="📝" count={act12.length} badgeBg="#374151">
                {act12.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'end_eval')}
                    warning={!s.preceptor_email ? 'Preceptor email missing' : null}
                    onOpenMail={s.preceptor_email ? () => { openHref(buildEndEvalEmail(s)); setPend(s.id,'end_eval') } : undefined}
                    onMarkSent={() => logComm({ type:'end_eval', student:s, sentToEmail:s.preceptor_email })} />
                ))}
              </ActionCard>

              {/* 13: Shift Log Needs Review */}
              <ActionCard title="Shift Log Needs Review" borderColor="#fef3c7" icon="📋" count={act13.length} badgeBg="#92400e">
                {act13.map(item => item.student && (
                  <SRow key={item.id} student={item.student} noMail
                    warning={`${item.shift_date} · ${item.total_hours}h${Array.isArray(item.exception_flags)&&item.exception_flags.length>0?' · '+item.exception_flags.map(f=>f.replace(/_/g,' ')).join(', '):''}`}
                    linkLabel="Review →"
                    onLink={() => { onClose(); onNavigateToProfiles?.(item.student.id) }} />
                ))}
              </ActionCard>

              {/* 14: Completed Required Hours */}
              <ActionCard title="Student Completed Required Hours" borderColor="#dcfce7" icon="🏆" count={act14.length} badgeBg="#166534">
                {act14.map(s => (
                  <SRow key={s.id} student={s} pending={isPend(s.id,'certificate')}
                    onOpenMail={() => { openHref(buildCertificateEmail(s)); setPend(s.id,'certificate') }}
                    onMarkSent={() => logComm({ type:'certificate', student:s, sentToEmail:s.personal_email||s.school_email })} />
                ))}
              </ActionCard>

              {/* 15: Not Logged Recently */}
              <ActionCard title="Student Not Logged Recently" borderColor="#fee2e2" icon="⏰" count={act15.length} badgeBg="#991b1b">
                {act15.map(s => (
                  <SRow key={s.id} student={s} noMail
                    warning={s.daysSince === null ? 'No shifts logged yet' : `${s.daysSince} days since last log`}
                    linkLabel="Go to Profile →"
                    onLink={() => { onClose(); onNavigateToProfiles?.(s.id) }} />
                ))}
              </ActionCard>

              {/* 16: Badge Not Created */}
              <ActionCard title="Badge Not Created" borderColor="#f3f4f6" icon="🪪" count={act16.length} badgeBg="#6b7280">
                {act16.map(s => (
                  <SRow key={s.id} student={s} noMail
                    linkLabel="Mark Created →"
                    onLink={() => { onClose(); onNavigateToProfiles?.(s.id) }} />
                ))}
              </ActionCard>

            </div>
          </div>

          {/* Recent Communications — 35% */}
          <div style={{ flex:'0 0 35%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'12px 16px 6px', flexShrink:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Recent Communications
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'0 16px 12px' }}>
              {recentComms.length === 0 ? (
                <div style={{ textAlign:'center', padding:'20px 0', fontSize:13, color:'#9ca3af' }}>
                  No communications sent yet for this cohort.
                </div>
              ) : recentComms.map((c, i) => (
                <div key={c.id} style={{ padding:'8px 0', borderBottom:'1px solid #f3f4f6' }}>
                  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:6, height:6, borderRadius:'50%',
                        background: TYPE_COLORS[c.type]||'#9ca3af', flexShrink:0, display:'inline-block' }} />
                      <span style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>
                        {TYPE_LABELS[c.type]||c.type}
                      </span>
                    </div>
                    <span style={{ fontSize:11, color:'#9ca3af', whiteSpace:'nowrap', flexShrink:0 }}>
                      {fmtTs(c.sent_at)}
                    </span>
                  </div>
                  {c.sent_to_name && (
                    <div style={{ fontSize:12, color:'#6b7280', marginLeft:14, marginTop:2 }}>
                      {c.sent_to_name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
