import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import StudentAvatar from './StudentAvatar'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { buildUnitLeaderEmail } from '../lib/emailUtils'

// ── Type metadata (in commTypes.js to avoid bundler TDZ with StudentSidePanel) ─
import { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
export { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
import { logEvent, eventExists } from '../lib/logEvent'
import { updateStudent as proxyUpdateStudent } from '../lib/studentProxy'
import EmptyState from './EmptyState'
import SyncIndicator from './SyncIndicator'
import { Star } from 'lucide-react'
import { useLastSynced } from '../hooks/useLastSynced'
import { useAuth } from '../contexts/AuthContext'

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
// All external navigation must use openLink helpers (src/lib/openLink.js)
function openHref(href) { window.open(href, '_blank', 'noopener,noreferrer'); }

// ── Priority config ───────────────────────────────────────────
const PRIORITY_CONFIG = {
  urgent:  { label: 'Urgent',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  high:    { label: 'High',    color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  routine: { label: 'Routine', color: '#1D2567', bg: '#f0f3ff', border: '#e0e7ff' },
  fyi:     { label: 'FYI',     color: '#6b7280', bg: '#f9fafb', border: '#f3f4f6' },
}

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
      borderLeftWidth:4, borderRadius:8, marginBottom:8, background:'#fff', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 16px', cursor:'pointer',
        transition:'background 0.12s ease' }}
        onClick={() => setOpen(p=>!p)}
        onMouseEnter={e => e.currentTarget.style.background='#fafafa'}
        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ fontSize:13, fontWeight:600, color:'var(--raven)', flex:1 }}>{title}</span>
        <span style={{ background:badgeBg, color:'#ffffff', fontFamily:'DM Sans,sans-serif',
          fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:20,
          minWidth:24, textAlign:'center', flexShrink:0 }}>{count}</span>
        <span style={{ fontSize:12, color:'#9ca3af' }}>{open?'▾':'▸'}</span>
      </div>
      {open && <div style={{ borderTop:`1px solid ${borderColor}` }}>{children}</div>}
    </div>
  )
}

// ── Student row ───────────────────────────────────────────────
function SRow({ student, pending, onOpenMail, onMarkSent, noMail=false, warning=null, linkLabel=null, onLink=null }) {
  const cfg = ASPIRE_STATUS_CONFIG[student.status]||{bg:'#f3f4f6',text:'#6b7280',border:'#d1d5db'}
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
      borderBottom:'1px solid #f9fafb' }}>
      <StudentAvatar student={student} size={28} />
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
  return mailto(s.personal_email||s.school_email, 'Congratulations on Completing the ASPIRE Program!',
`Dear ${s.first_name},

Congratulations on successfully completing your ASPIRE Program rotation at Cedars-Sinai Medical Center! This is a tremendous milestone in your nursing journey, and we are incredibly proud of your dedication, commitment, and growth throughout this experience.

Please find your Certificate of Completion attached to this email. You are welcome to print or save a copy for your records.

Before we close out your rotation, we have two quick requests:

1. Post-Program Survey (for you): Please take 10 to 15 minutes to complete the ASPIRE Clinical Readiness Survey. Your feedback helps us improve the program:
https://forms.cloud.microsoft/r/GWAdKLuM8J

2. Preceptor Evaluation (for your preceptor): Please share this link with ${s.matched_preceptor || 'your preceptor'} and kindly ask them to complete the ASPIRE Preceptor Feedback Questionnaire:
https://forms.cloud.microsoft/r/brGDMzFXgy

We are honored to have been part of your nursing journey. Many ASPIRE graduates go on to become strong candidates for our New Graduate RN Residency Program, and we look forward to seeing where your career takes you.

Please remember to attach the Certificate of Completion PDF before sending.

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
  onNavigateToProfiles, toast,
}) {
  const [pending, setPending]     = useState({})
  const [oriFields, setOriFields] = useState({ date:'', time:'', location:'' })
  const [copyOk,    setCopyOk]    = useState(false)
  const [oriDone,         setOriDone]         = useState(false)
  const [showRecentComms, setShowRecentComms] = useState(false)
  const [doneItems,       setDoneItems]       = useState(new Set())
  const [markingDone,     setMarkingDone]     = useState(null)
  const [activeACFilter,  setActiveACFilter]  = useState(null)
  const drawerRef = useRef(null)

  // Shift log data for new action categories
  const { canEdit, userProfile } = useAuth()
  const { markSynced: markActionSynced, display: actionSyncDisplay } = useLastSynced()
  const [shiftLogs,     setShiftLogs]     = useState([])
  const [shiftLogsLoaded, setShiftLogsLoaded] = useState(false)
  useEffect(() => {
    if (!isOpen || !cohortId || shiftLogsLoaded) return
    supabase.from('student_shift_logs').select('*').eq('cohort_id', cohortId)
      .order('submitted_at', { ascending: false })
      .then(({ data }) => { setShiftLogs(data || []); setShiftLogsLoaded(true); markActionSynced() })
  }, [isOpen, cohortId]) // eslint-disable-line
  // Mark synced when Action Center opens with existing data
  useEffect(() => { if (isOpen && shiftLogsLoaded) markActionSynced() }, [isOpen]) // eslint-disable-line
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
    if (type === 'unit_notification') toast?.success('Notification sent', 'Unit leader email marked as sent.')
    if (type === 'certificate') toast?.success('Certificate sent', 'Email marked as sent. Remember to attach the PDF.')
  }

  const handleMarkDone = async (item) => {
    setMarkingDone(item.id)
    try {
      if (item.markDoneType === 'log_communication') {
        await fetch('/api/student-update', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:'log_communication', student_id:item.studentId, cohort_id:item.cohortId, type:item.markDonePayload?.type||item.actionType, notes:`Marked done by ${userProfile?.full_name}`, sent_by:userProfile?.full_name }),
        })
        if (item.emailHref) openHref(item.emailHref)
      }
      if (item.markDoneType === 'update_field') {
        await fetch('/api/student-update', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:'update', student_id:item.studentId, fields:item.markDonePayload?.fields||{} }),
        })
      }
      if (item.markDoneType === 'clear_flag') {
        await fetch('/api/student-update', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:'update', student_id:item.studentId, fields:{ interview_flag: null } }),
        })
      }
      try {
        await supabase.from('activity_logs').insert({ user_id:userProfile?.id, user_name:userProfile?.full_name, user_role:userProfile?.role, action_type:item.actionType, entity_type:'student', entity_id:item.studentId, cohort_id:item.cohortId, description:`${userProfile?.full_name} marked "${item.title}" complete for ${item.studentName}`, metadata:{ completed_at: new Date().toISOString() } })
      } catch (logErr) { console.warn('Activity log:', logErr.message) }
      setDoneItems(prev => new Set([...prev, item.id]))
    } catch (err) { alert(`Could not complete: ${err.message}`) }
    finally { setMarkingDone(null) }
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
  const orientationComplete = !!activeCohort?.orientation_sent_at ||
    communications.some(c => c.type === 'orientation_email')
  const showAct7 = activeCohort && !orientationComplete && placedStudents.length > 0 && !oriDone
  const act8  = students.filter(s => s.status === 'Active Rotation' && !hasSent(s.id, 'midpoint_checkin'))
  const act9  = students.filter(s => s.status === 'Active Rotation' && !hasSent(s.id, 'midpoint_eval'))
  const act10 = students.filter(s => s.status === 'Completed' && !hasSent(s.id, 'post_survey'))
  const act11 = students.filter(s =>
    !hasSent(s.id, 'certificate') && (
      s.status === 'Completed' ||
      (s.status === 'Active Rotation' &&
        parseFloat(s.approved_hours||0) >= parseFloat(s.hours_required||0) &&
        parseFloat(s.hours_required||0) > 0)
    )
  )
  const act12 = students.filter(s => s.status === 'Completed' && !hasSent(s.id, 'end_eval'))

  // ── New shift-log based actions ──────────────────────────────
  // Act 13: Shift logs needing review
  const act13 = shiftLogs.filter(l => l.status === 'Pending Review' && !l.reviewed_at)
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

  // ── Unified actionItems array ────────────────────────────
  const actionItems = [
    ...(canEdit ? act1.map(s => ({ id:`${s.id}-sf`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Send Student Form', description:'Pending outreach — form not yet sent.', actionType:'student_form', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'student_form'}, emailHref:buildStudentFormEmail(s) })) : []),
    ...act2.map(s => ({ id:`${s.id}-sl`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'high', title:'Send Interview Scheduling Link', description:'Form received. Scheduling link not sent.', actionType:'interview_link_not_sent', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'scheduling_link'}, emailHref:buildSchedulingLinkEmail(s) })),
    ...act3.map(s => ({ id:`${s.id}-ir`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'high', title:'Send Interview Reminder', description:`Interview on ${s.interview_scheduled_date}. Reminder not sent.`, actionType:'interview_reminder_overdue', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'interview_reminder'}, emailHref:buildInterviewReminderEmail(s) })),
    ...(canEdit ? act4.map(s => { const unit=units.find(u=>u.id===s.matched_unit_id); const m=matches.find(m=>m.student_id===s.id); const href=unit?buildUnitLeaderEmail({contactPersons:unit.contact_person||'Unit Leader',contactEmails:unit.contact_email||'',unitName:unit.unit_name,students:[{firstName:s.first_name,lastName:s.last_name||s.name,school:s.school||'',programType:s.program_type||'',termDates:s.term_dates||'',hoursRequired:s.hours_required||'',shiftPreference:s.shift_availability||'',preceptorAssigned:s.matched_preceptor||''}],isMultiStudent:false}):null; return { id:`${s.id}-un`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'routine', title:'Unit Leader Placement Notification', description:`Placed in ${unit?.unit_name||'unit'}. Leader not yet notified.`, actionType:'unit_notification_needed', canMarkDone:!!href, markDoneType:'log_communication', markDonePayload:{type:'unit_notification'}, emailHref:href, matchId:m?.id } }) : []),
    ...act5.map(s => { const unit=units.find(u=>u.id===s.matched_unit_id); return { id:`${s.id}-pw`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'routine', title:'Preceptor Welcome Email', description:s.preceptor_email?`Preceptor: ${s.matched_preceptor}. Welcome email not sent.`:'Preceptor email missing.', actionType:'unit_notification_needed', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'preceptor_welcome'}, emailHref:s.preceptor_email?buildPreceptorWelcomeEmail(s,unit?.contact_email):null, warning:!s.preceptor_email?'Missing preceptor email':null } }),
    ...(canEdit ? act6.map(s => ({ id:`${s.id}-cs`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'cslink', priority:'routine', title:'CS-Link Access Not Started', description:'Service Center request not yet submitted.', actionType:'cslink_incomplete', canMarkDone:false, markDoneType:null, markDonePayload:null, navigateToProfile:true })) : []),
    ...act8.map(s => ({ id:`${s.id}-mc`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Midpoint Student Check-In', description:'Active Rotation. Check-in email not sent.', actionType:'midpoint_checkin', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'midpoint_checkin'}, emailHref:buildMidpointCheckinEmail(s) })),
    ...act9.map(s => ({ id:`${s.id}-me`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Midpoint Preceptor Evaluation', description:s.preceptor_email?'Request midpoint eval from preceptor.':'Preceptor email missing.', actionType:'midpoint_eval', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'midpoint_eval'}, emailHref:s.preceptor_email?buildMidpointEvalEmail(s):null, warning:!s.preceptor_email?'Missing preceptor email':null })),
    ...act10.map(s => ({ id:`${s.id}-ps`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'fyi', title:'Post-Program Student Survey', description:'Program completed. Post-survey not sent.', actionType:'post_survey', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'post_survey'}, emailHref:buildPostSurveyEmail(s) })),
    ...act11.map(s => ({ id:`${s.id}-cert`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'badge', priority:'fyi', title:'Certificate of Completion', description:'Hours met. Certificate not yet sent.', actionType:'hours_completed', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'certificate'}, emailHref:buildCertificateEmail(s) })),
    ...act12.map(s => ({ id:`${s.id}-ee`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'End Preceptor Evaluation', description:s.preceptor_email?'Request final evaluation from preceptor.':'Preceptor email missing.', actionType:'end_eval', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'end_eval'}, emailHref:s.preceptor_email?buildEndEvalEmail(s):null, warning:!s.preceptor_email?'Missing preceptor email':null })),
    ...act13.map(item => ({ id:`${item.id}-sr`, studentId:item.student_id, studentName:item.student?`${item.student.last_name}, ${item.student.first_name}`:'—', cohortId, student:item.student, category:'hours', priority:'routine', title:'Shift Log Needs Review', description:`${item.shift_date} · ${item.total_hours}h`, actionType:'shift_log_submitted', canMarkDone:false, markDoneType:null, navigateToProfile:true })),
    ...act15.map(s => ({ id:`${s.id}-nl`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'hours', priority:'routine', title:'Student Not Logged Recently', description:s.daysSince===null?'No shifts logged yet.':`${s.daysSince} days since last log.`, actionType:'shift_log_submitted', canMarkDone:false, navigateToProfile:true })),
    ...(canEdit ? act16.map(s => ({ id:`${s.id}-badge`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'badge', priority:'routine', title:'Badge Not Created', description:'Student placed. CS badge not yet created.', actionType:'badge_needed', canMarkDone:true, markDoneType:'update_field', markDonePayload:{fields:{badge_created:true}}, navigateToProfile:false })) : []),
  ]

  const filteredActionItems = activeACFilter
    ? actionItems.filter(i => activeACFilter === 'urgent' ? i.priority === 'urgent' : i.category === activeACFilter)
    : actionItems

  const totalActionCount = actionItems.length
  const urgentCount      = actionItems.filter(i => i.priority === 'urgent').length
  const interviewCount   = actionItems.filter(i => i.category === 'interview').length
  const cslinkCount      = actionItems.filter(i => i.category === 'cslink').length
  const badgeCount       = actionItems.filter(i => i.category === 'badge').length

  const SECTION_CONFIG = [
    { key:'urgent',        label:'Urgent',          color:'#dc2626', filter: i => i.priority === 'urgent' },
    { key:'interview',     label:'Interview',        color:'#d97706', filter: i => i.category === 'interview' && i.priority !== 'urgent' },
    { key:'placement',     label:'Placement',        color:'#1D2567', filter: i => i.category === 'placement' && i.priority !== 'urgent' },
    { key:'cslink',        label:'CS-Link',          color:'#5b21b6', filter: i => i.category === 'cslink' && i.priority !== 'urgent' },
    { key:'badge',         label:'Badge & Hours',    color:'#0e7490', filter: i => ['badge','hours'].includes(i.category) && i.priority !== 'urgent' },
    { key:'communication', label:'Communications',   color:'#374151', filter: i => i.category === 'communication' && i.priority !== 'urgent' },
  ]

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
      await logComm({ type:'orientation_email', student:s, sentToEmail:s.personal_email||s.school_email, sentToName:`${s.last_name}, ${s.first_name}` })
      // Also mark individual student orientation_sent_at if column exists
      proxyUpdateStudent(s.id, { orientation_sent_at: now }).catch(err => console.warn('orientation update:', err.message))
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
          <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <span style={{ fontSize:16, fontWeight:700, color:'#fff' }}>Action Center</span>
            <div style={{ paddingTop:'2px' }}>
              <SyncIndicator display={actionSyncDisplay} align="left" dark={true} />
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:'#fff', fontSize:20, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        {/* Drawer body */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Action Items */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

            {/* Summary header */}
            <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #f3f4f6', background:'#fafbff', flexShrink:0 }}>
              <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'15px', color:'#1D2567', marginBottom:'6px' }}>
                Today's Action Center
              </div>
              <div style={{ fontFamily:'DM Sans', fontWeight:800, fontSize:'28px', color:'#1D2567', lineHeight:1, marginBottom:'8px' }}>
                {totalActionCount}
                <span style={{ fontFamily:'DM Sans', fontWeight:400, fontSize:'13px', color:'#9ca3af', marginLeft:'8px' }}>
                  open item{totalActionCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {[
                  { label:`${urgentCount} urgent`,       show: urgentCount > 0,   color:'#dc2626', bg:'#fef2f2' },
                  { label:`${interviewCount} interview`,  show: interviewCount > 0, color:'#d97706', bg:'#fffbeb' },
                  { label:`${cslinkCount} CS-Link`,       show: cslinkCount > 0,   color:'#1D2567', bg:'#f0f3ff' },
                  { label:`${badgeCount} badge`,          show: badgeCount > 0,    color:'#6b7280', bg:'#f3f4f6' },
                ].filter(p => p.show).map(pill => (
                  <span key={pill.label} style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color:pill.color, background:pill.bg, padding:'3px 10px', borderRadius:'20px' }}>
                    {pill.label}
                  </span>
                ))}
                {totalActionCount === 0 && (
                  <span style={{ fontFamily:'DM Sans', fontSize:'12px', color:'#9ca3af' }}>All clear — no actions needed right now.</span>
                )}
              </div>
            </div>

            {/* Filter tabs */}
            <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', padding:'10px 20px', borderBottom:'1px solid #f3f4f6', flexShrink:0 }}>
              {[{key:null,label:'All'},{key:'urgent',label:'Urgent'},{key:'interview',label:'Interview'},{key:'placement',label:'Placement'},{key:'cslink',label:'CS-Link'},{key:'badge',label:'Badge'},{key:'hours',label:'Hours'},{key:'communication',label:'Comms'}].map(tab => {
                const isActive = activeACFilter === tab.key
                return (
                  <button key={String(tab.key)} onClick={() => setActiveACFilter(tab.key)}
                    style={{ padding:'4px 12px', background: isActive ? '#1D2567' : '#f3f4f6', border:'none', borderRadius:'20px', fontFamily:'DM Sans', fontWeight: isActive ? 700 : 500, fontSize:'11px', color: isActive ? '#ffffff' : '#6b7280', cursor:'pointer', transition:'all 0.15s ease' }}>
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'0 0 12px' }}>

              {/* All-clear state */}
              {totalActionCount === 0 && (
                <EmptyState compact icon={<Star />}
                  heading="All caught up!"
                  subtext="No pending action items for this cohort right now." />
              )}

              {/* Orientation — special cohort-level action, kept separate */}

              {/* 7: Orientation (cohort-level) — admin/owner only */}
              {canEdit && showAct7 && (
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
              {canEdit && !showAct7 && (
                <ActionCard title="Orientation Email + Pre-Program Survey" borderColor="#d1fae5" icon="🎉" count={0} />
              )}

              {/* SECTION_CONFIG rendering */}
              {SECTION_CONFIG.map(section => {
                const items = filteredActionItems.filter(section.filter)
                if (items.length === 0) return null
                return (
                  <div key={section.key} style={{ marginBottom:'4px' }}>
                    <div style={{ padding:'8px 20px 6px', background:'#f9fafb', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', gap:'8px' }}>
                      <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color:section.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{section.label}</span>
                      <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'10px', color:section.color, background:`${section.color}18`, padding:'1px 7px', borderRadius:'20px' }}>{items.length}</span>
                    </div>
                    {items.map(item => (
                      <div key={item.id} style={{ padding:'12px 16px', borderBottom:'1px solid #f9fafb', borderLeft:`3px solid ${PRIORITY_CONFIG[item.priority].color}`, background: doneItems.has(item.id) ? '#f9fafb' : '#ffffff', opacity: doneItems.has(item.id) ? 0.6 : 1, transition:'opacity 0.2s ease' }}>
                        <div style={{ display:'flex', alignItems:'flex-start', gap:'10px' }}>
                          <span style={{ flexShrink:0, fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', textTransform:'uppercase', letterSpacing:'0.05em', color:PRIORITY_CONFIG[item.priority].color, background:PRIORITY_CONFIG[item.priority].bg, padding:'2px 7px', borderRadius:'20px', marginTop:'1px' }}>
                            {PRIORITY_CONFIG[item.priority].label}
                          </span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'13px', color:'#1D2567', marginBottom:'2px' }}>{item.studentName}</div>
                            <div style={{ fontFamily:'DM Sans', fontSize:'12px', color:'#374151', marginBottom:'2px' }}>{item.title}</div>
                            <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#9ca3af' }}>{item.warning || item.description}</div>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:'4px', flexShrink:0 }}>
                            {item.navigateToProfile && !doneItems.has(item.id) && (
                              <button onClick={() => { onClose(); onNavigateToProfiles?.(item.studentId) }}
                                style={{ padding:'5px 10px', background:'#f0f3ff', border:'1px solid #e0e7ff', borderRadius:'7px', fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color:'#1D2567', cursor:'pointer', whiteSpace:'nowrap' }}>
                                → Profile
                              </button>
                            )}
                            {item.canMarkDone && !doneItems.has(item.id) && (
                              <button onClick={() => handleMarkDone(item)} disabled={markingDone === item.id}
                                style={{ padding:'5px 12px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'7px', fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color:'#166534', cursor:'pointer', whiteSpace:'nowrap', transition:'all 0.15s ease' }}
                                onMouseEnter={e => e.currentTarget.style.background='#dcfce7'}
                                onMouseLeave={e => e.currentTarget.style.background='#f0fdf4'}>
                                {markingDone === item.id ? '...' : '✓ Done'}
                              </button>
                            )}
                            {doneItems.has(item.id) && (
                              <span style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#16a34a', fontWeight:600 }}>✓ Done</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}

            </div>
          </div>

          {/* Recent Communications — centered pill toggle, clear of Keith orb */}
          {recentComms.length > 0 && (
            <div style={{ flexShrink:0 }}>
              <div onClick={() => setShowRecentComms(p => !p)}
                style={{ display:'flex', flexDirection:'column', alignItems:'center', cursor:'pointer', padding:'12px 0 8px', borderTop:'1px solid #f3f4f6', marginTop:'8px', position:'relative', zIndex:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'4px 14px', background:'#f3f4f6', borderRadius:'20px', transition:'background 0.15s ease' }}
                  onMouseEnter={e => e.currentTarget.style.background='#e5e7eb'}
                  onMouseLeave={e => e.currentTarget.style.background='#f3f4f6'}>
                  <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    Recent Communications
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round"
                    style={{ transform: showRecentComms ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s ease' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
              </div>
              {showRecentComms && (
                <div style={{ maxHeight:220, overflowY:'auto', padding:'0 16px 80px' }}>
                  {recentComms.map((c) => (
                    <div key={c.id} style={{ padding:'8px 0', borderBottom:'1px solid #f3f4f6' }}>
                      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ width:6, height:6, borderRadius:'50%', background: TYPE_COLORS[c.type]||'#9ca3af', flexShrink:0, display:'inline-block' }} />
                          <span style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>{TYPE_LABELS[c.type]||c.type}</span>
                        </div>
                        <span style={{ fontSize:11, color:'#9ca3af', whiteSpace:'nowrap', flexShrink:0 }}>{fmtTs(c.sent_at)}</span>
                      </div>
                      {c.sent_to_name && (
                        <div style={{ fontSize:12, color:'#6b7280', marginLeft:14, marginTop:2 }}>{c.sent_to_name}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  )
}
