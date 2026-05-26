import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { buildUnitLeaderEmail } from '../lib/emailUtils'
import { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
export { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
import { updateStudent as proxyUpdateStudent } from '../lib/studentProxy'
import { useAuth } from '../contexts/AuthContext'

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtIvDate(s) {
  if (!s) return ''
  const [y,m,d] = s.split('-').map(Number)
  return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
}
function openHref(href) { window.open(href, '_blank', 'noopener,noreferrer') }

const PRIORITY_CONFIG = {
  urgent:  { label: 'URGENT',  color: '#dc2626', bg: '#fef2f2' },
  high:    { label: 'HIGH',    color: '#d97706', bg: '#fffbeb' },
  routine: { label: 'ROUTINE', color: '#1D2567', bg: '#eef1ff' },
  fyi:     { label: 'FYI',     color: '#6b7280', bg: '#f9fafb' },
}

// Priority-ordered stack definitions
const STACK_ORDER = [
  { key: 'urgent',        label: 'Urgent',        color: '#dc2626', filter: i => i.priority === 'urgent' },
  { key: 'interview',     label: 'Interviews',     color: '#d97706', filter: i => i.category === 'interview' },
  { key: 'placement',     label: 'Placement',      color: '#1D2567', filter: i => i.category === 'placement' },
  { key: 'cslink',        label: 'CS-Link',        color: '#5b21b6', filter: i => i.category === 'cslink' },
  { key: 'badge',         label: 'Badge',          color: '#0e7490', filter: i => i.category === 'badge' },
  { key: 'hours',         label: 'Hours',          color: '#92400e', filter: i => i.category === 'hours' },
  { key: 'communication', label: 'Communications', color: '#374151', filter: i => i.category === 'communication' },
]

function getActionLabel(item) {
  if (item.isOrientation) return null
  if (item.actionType === 'selection_decision') return 'Open Interview Review'
  if (item.navigateToProfile && !item.canMarkDone) return 'Open Profile'
  if (item.markDoneType === 'update_field') return 'Mark Complete'
  if (item.warning && !item.emailHref) return null
  switch (item.actionType) {
    case 'student_form':               return 'Send Form Email'
    case 'interview_link_not_sent':    return 'Send Scheduling Link'
    case 'interview_reminder_overdue': return 'Send Reminder'
    case 'unit_notification_needed':
      return item.title === 'Preceptor Welcome Email' ? 'Send Welcome Email' : 'Notify Unit Leader'
    case 'midpoint_checkin':           return 'Send Check-In'
    case 'midpoint_eval':              return 'Request Eval'
    case 'end_eval':                   return 'Request Final Eval'
    case 'post_survey':                return 'Send Survey'
    case 'hours_completed':            return 'Send Certificate'
    default:                           return item.emailHref ? 'Send Email' : null
  }
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

// ── Item card ──────────────────────────────────────────────────
function ItemCard({
  item,
  isConfirming, isActioning,
  onAction, onConfirm, onCancelConfirm,
  // Orientation-specific props
  oriExpanded, onOriExpand,
  oriFields, onOriFieldChange,
  copyOk,
  onCopyOrientation, onOpenOrientationMailto, onMarkOrientationSent,
  placedStudents,
}) {
  const pCfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.routine
  const actionLabel = getActionLabel(item)

  // Special orientation card
  if (item.isOrientation) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(29,37,103,0.05)', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
            color: pCfg.color, background: pCfg.bg, padding: '2px 7px', borderRadius: 20, flexShrink: 0, marginTop: 1 }}>
            {pCfg.label}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1D2567' }}>Cohort Orientation</div>
            <div style={{ fontSize: 12, color: '#374151' }}>Orientation Email + Pre-Program Survey</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{item.studentName} will receive this email.</div>
          </div>
          <button onClick={onOriExpand}
            style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 7, border: '1px solid #e0e7ff',
              fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
              background: '#f0f3ff', color: '#1D2567' }}>
            {oriExpanded ? 'Close ▴' : 'Compose ▾'}
          </button>
        </div>
        {oriExpanded && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
            {[
              ['date', 'Orientation Date', 'e.g. Tuesday, June 3, 2026'],
              ['time', 'Orientation Time', 'e.g. 8:00 AM – 12:00 NN'],
              ['location', 'Location', 'e.g. Starbucks, South Tower, Plaza Level'],
            ].map(([k, lbl, ph]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 3 }}>{lbl}</label>
                <input className="form-input" style={{ fontSize: 12 }} placeholder={ph}
                  value={oriFields[k]} onChange={e => onOriFieldChange(k, e.target.value)} />
              </div>
            ))}
            <div style={{ background: '#f8f9fb', borderRadius: 6, padding: '8px 10px', marginBottom: 10,
              fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 100, overflowY: 'auto', color: '#374151' }}>
              {`Student Name | Unit | Shift | Preceptor | Preceptor Email\n${placedStudents.map(s => `${s.last_name}, ${s.first_name} | — | — | ${s.matched_preceptor||'—'} | ${s.preceptor_email||'—'}`).join('\n')}`}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={onCopyOrientation}
                style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, background: '#1D2567', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                {copyOk ? '✓ Copied' : 'Copy Full Email'}
              </button>
              <button onClick={onOpenOrientationMailto}
                style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, background: '#fff', color: '#1D2567', border: '1.5px solid #1D2567', borderRadius: 6, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                Open Outlook
              </button>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#166534' }}>
              <input type="checkbox" onChange={e => e.target.checked && onMarkOrientationSent()} />
              <span>Mark Orientation Email as Sent</span>
            </label>
          </div>
        )}
      </div>
    )
  }

  // Standard item card
  return (
    <div style={{ padding: '11px 16px', borderBottom: '1px solid rgba(29,37,103,0.05)', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          color: pCfg.color, background: pCfg.bg, padding: '2px 7px', borderRadius: 20, flexShrink: 0, marginTop: 1 }}>
          {pCfg.label}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1D2567', marginBottom: 1 }}>{item.studentName}</div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 1 }}>{item.title}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.warning || item.description}
          </div>
        </div>
        <div style={{ flexShrink: 0, minWidth: 0 }}>
          {isConfirming ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 11, color: '#374151', fontWeight: 500, whiteSpace: 'nowrap' }}>Mark complete?</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={onCancelConfirm}
                  style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, background: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#6b7280', fontFamily: 'DM Sans, sans-serif' }}>
                  Cancel
                </button>
                <button onClick={onConfirm} disabled={isActioning}
                  style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, cursor: 'pointer', color: '#166534', fontFamily: 'DM Sans, sans-serif' }}>
                  {isActioning ? '…' : 'Confirm'}
                </button>
              </div>
            </div>
          ) : actionLabel ? (
            <button onClick={onAction} disabled={isActioning}
              style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(29,37,103,0.15)',
                fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 11, cursor: 'pointer',
                whiteSpace: 'nowrap', transition: 'all 0.12s',
                background: item.markDoneType === 'update_field' ? '#f0fdf4' : '#f0f3ff',
                color: item.markDoneType === 'update_field' ? '#166534' : '#1D2567' }}>
              {isActioning ? '…' : actionLabel}
            </button>
          ) : item.warning ? (
            <span style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', padding: '3px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
              {item.warning}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── Main ActionCenter component ───────────────────────────────
export default function ActionCenter({
  isOpen, onClose, anchorEl,
  students, units, matches, cohortId, activeCohort,
  communications, onLogCommunication, onStudentUpdate,
  onNavigateToProfiles, toast,
}) {
  const { canEdit } = useAuth()
  const popoverRef = useRef(null)

  // UI state
  const [oriFields,      setOriFields]      = useState({ date: '', time: '', location: '' })
  const [copyOk,         setCopyOk]         = useState(false)
  const [oriDone,        setOriDone]        = useState(false)
  const [oriExpanded,    setOriExpanded]    = useState(false)
  const [activeFilter,   setActiveFilter]   = useState(null)
  const [expandedStacks, setExpandedStacks] = useState({})
  const [confirmingId,   setConfirmingId]   = useState(null)
  const [actioning,      setActioning]      = useState(null)

  // Shift log data (lazy-loaded on first open)
  const [shiftLogs,       setShiftLogs]       = useState([])
  const [shiftLogsLoaded, setShiftLogsLoaded] = useState(false)

  useEffect(() => {
    if (!isOpen || !cohortId || shiftLogsLoaded) return
    supabase.from('student_shift_logs').select('*').eq('cohort_id', cohortId)
      .order('submitted_at', { ascending: false })
      .then(({ data }) => { setShiftLogs(data || []); setShiftLogsLoaded(true) })
  }, [isOpen, cohortId, shiftLogsLoaded])

  useEffect(() => { setShiftLogs([]); setShiftLogsLoaded(false) }, [cohortId])

  // Reset UI on open
  useEffect(() => {
    if (isOpen) {
      setActiveFilter(null)
      setExpandedStacks({})
      setConfirmingId(null)
      setOriExpanded(false)
    }
  }, [isOpen])

  // Popover positioning: anchored below bell button, right-aligned to it
  const [pos, setPos] = useState({ top: 68, right: 12, width: 464 })
  useLayoutEffect(() => {
    if (!anchorEl || !isOpen) return
    const rect = anchorEl.getBoundingClientRect()
    const w = Math.min(464, window.innerWidth - 16)
    const right = Math.max(8, window.innerWidth - rect.right)
    setPos({ top: rect.bottom + 8, right, width: w })
  }, [anchorEl, isOpen])

  // Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Click outside (excludes bell button itself)
  useEffect(() => {
    if (!isOpen) return
    const handler = e => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        (!anchorEl || !anchorEl.contains(e.target))
      ) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose, anchorEl])

  // ── Communication helpers ──────────────────────────────────
  const hasSent = (sid, type) => communications.some(c => c.student_id === sid && c.type === type)

  const logComm = async ({ type, student, sentToEmail, sentToName }) => {
    const { data } = await safeWrite(
      () => supabase.from('communications').insert({
        student_id: student?.id || null,
        cohort_id: cohortId,
        type,
        sent_to_email: sentToEmail || '',
        sent_to_name: sentToName || (student ? `${student.last_name}, ${student.first_name}` : ''),
        sent_by: 'ASPIRE Team',
      }).select().single(),
      { name: 'log communication' }
    )
    if (data && onLogCommunication) onLogCommunication(data)
  }

  // ── Action handler ──────────────────────────────────────────
  const handleAction = async (item) => {
    if (item.navigateToProfile) {
      onNavigateToProfiles?.(item.studentId)
      onClose()
      return
    }
    if (item.markDoneType === 'update_field') {
      setConfirmingId(item.id)
      return
    }
    if (item.emailHref && item.markDoneType === 'log_communication') {
      setActioning(item.id)
      openHref(item.emailHref)
      const type = item.markDonePayload?.type || item.actionType
      await logComm({
        type,
        student: item.student,
        sentToEmail: item.student?.school_email || item.student?.personal_email || item.student?.preceptor_email || '',
        sentToName: item.studentName,
      })
      if (type === 'unit_notification') toast?.success('Notified', 'Unit leader email marked as sent.')
      if (type === 'certificate')       toast?.success('Certificate', 'Email marked as sent. Attach the PDF before sending.')
      setActioning(null)
    }
  }

  // ── Mark Complete confirmation ──────────────────────────────
  const handleConfirmComplete = async (item) => {
    if (!item.markDonePayload?.fields) { setConfirmingId(null); return }
    setActioning(item.id)
    const err = await onStudentUpdate?.(item.studentId, item.markDonePayload.fields)
    setActioning(null)
    setConfirmingId(null)
    if (!err) {
      toast?.success('Completed', `${item.studentName} — task marked complete.`)
    } else {
      toast?.error('Error', err.message || 'Could not complete.')
    }
  }

  // ── Orientation helpers ─────────────────────────────────────
  const placedStudents = students.filter(s => s.status === 'Placed')

  const buildOrientationBody = () => {
    const rows = placedStudents.map(s => {
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name}, ${s.first_name} | ${u?.unit_name||'—'} | ${s.shift_assigned||'—'} | ${s.matched_preceptor||'—'} | ${s.preceptor_email||'—'}`
    }).join('\n')
    const table = `Student Name | Unit | Shift | Preceptor | Preceptor Email\n${rows}`
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

What to Expect
- Orientation session covering policies, expectations, and tips for success
- Time to ask questions
- Optional unit tours if your preceptor is available

Before your rotation begins, please take 5 to 10 minutes to complete our Pre-Program Clinical Readiness Survey:
https://forms.cloud.microsoft/r/6TX6sV76ga

If you have any questions before orientation, feel free to reach out anytime.

${KR_SIG}`
  }

  const handleCopyOrientation = async () => {
    await navigator.clipboard.writeText(buildOrientationBody())
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 2000)
  }

  const handleOpenOrientationMailto = () => {
    const bccs = placedStudents.map(s => s.personal_email||s.school_email).filter(Boolean).join(',')
    openHref(`mailto:?bcc=${encodeURIComponent(bccs)}&subject=${encodeURIComponent('Welcome to the ASPIRE Program – Orientation Details Inside')}`)
  }

  const handleMarkOrientationSent = async () => {
    const nowTs = new Date().toISOString()
    await safeWrite(
      () => supabase.from('cohorts').update({ orientation_sent_at: nowTs }).eq('id', cohortId),
      { name: 'mark orientation sent' }
    )
    for (const s of placedStudents) {
      await logComm({ type: 'orientation_email', student: s, sentToEmail: s.personal_email||s.school_email, sentToName: `${s.last_name}, ${s.first_name}` })
    }
    setOriDone(true)
  }

  // ── Derived action items ────────────────────────────────────
  const now   = new Date()
  const td    = fmtLocalDate(now)
  const in48d = new Date(now.getTime() + 48*3600*1000)
  const t48   = fmtLocalDate(in48d)

  const act2 = students.filter(s => s.status === 'Form Received' && !s.interview_scheduled_date)
  const act3 = students.filter(s =>
    s.interview_scheduled_date >= td && s.interview_scheduled_date <= t48 &&
    !hasSent(s.id, 'interview_reminder')
  )
  const act4 = students.filter(s => {
    if (s.status !== 'Placed' || !s.matched_unit_id) return false
    const m = matches.find(m => m.student_id === s.id)
    return m && !m.notification_sent
  })
  const act5 = students.filter(s => s.status === 'Placed' && s.matched_preceptor && !hasSent(s.id, 'preceptor_welcome'))
  const act6 = students.filter(s =>
    ['Form Received','Interview Scheduled','Interviewed','Placed','Active Rotation'].includes(s.status) &&
    (!s.cs_cedars_status || !s.cs_stage1_submitted)
  )
  const orientationComplete = !!activeCohort?.orientation_sent_at ||
    communications.some(c => c.type === 'orientation_email')
  const showOrientation = canEdit && activeCohort && !orientationComplete && placedStudents.length > 0 && !oriDone

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

  const sevenDaysAgo = new Date(Date.now() - 7*24*3600*1000).toISOString()
  const act13 = shiftLogs
    .filter(l => l.status === 'Pending Review' && !l.reviewed_at)
    .map(l => ({ ...l, student: students.find(s => s.id === l.student_id) }))
    .filter(l => l.student)
  const act15 = students
    .filter(s => {
      if (s.status !== 'Active Rotation') return false
      return !shiftLogs.find(l => l.student_id === s.id && l.submitted_at >= sevenDaysAgo)
    })
    .map(s => {
      const lastLog = shiftLogs
        .filter(l => l.student_id === s.id)
        .sort((a,b) => (b.submitted_at||'').localeCompare(a.submitted_at||''))[0]
      const daysSince = lastLog
        ? Math.floor((Date.now() - new Date(lastLog.submitted_at).getTime()) / (24*3600*1000))
        : null
      return { ...s, daysSince }
    })

  const act16 = students.filter(s => s.status === 'Placed' && !s.badge_created)
  const act17 = students.filter(s =>
    ['Placed','Active Rotation'].includes(s.status) &&
    !s.preceptor_id &&
    (!s.matched_preceptor || !s.matched_preceptor.trim())
  )
  const act18 = students.filter(s =>
    s.interview_outcome === 'Do Not Recommend' &&
    s.status === 'Interviewed'
  )
  const act1  = students.filter(s => s.status === 'Pending Outreach')

  const actionItems = [
    // Orientation special item in placement
    ...(showOrientation ? [{ id: 'orientation', isOrientation: true, category: 'placement', priority: 'high', title: 'Orientation Email', studentName: `${placedStudents.length} placed student${placedStudents.length !== 1 ? 's' : ''}`, description: 'Orientation email and pre-program survey not yet sent.', canMarkDone: false }] : []),
    // Interviews
    ...act2.map(s => ({ id:`${s.id}-sl`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'high', title:'Send Interview Scheduling Link', description:'Form received. Scheduling link not sent.', actionType:'interview_link_not_sent', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'scheduling_link'}, emailHref:buildSchedulingLinkEmail(s) })),
    ...act3.map(s => ({ id:`${s.id}-ir`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'high', title:'Send Interview Reminder', description:`Interview ${fmtIvDate(s.interview_scheduled_date)}. Reminder not sent.`, actionType:'interview_reminder_overdue', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'interview_reminder'}, emailHref:buildInterviewReminderEmail(s) })),
    ...(canEdit ? act18.map(s => ({ id:`${s.id}-sd`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'urgent', title:'Selection Decision Needed', description:'Rubric: Do Not Recommend · Awaiting selection decision', actionType:'selection_decision', canMarkDone:false, markDoneType:null, navigateToProfile:true })) : []),
    // Placement
    ...(canEdit ? act4.map(s => {
      const unit = units.find(u => u.id === s.matched_unit_id)
      const m    = matches.find(m => m.student_id === s.id)
      const href = unit ? buildUnitLeaderEmail({ contactPersons:unit.contact_person||'Unit Leader', contactEmails:unit.contact_email||'', unitName:unit.unit_name, students:[{ firstName:s.first_name, lastName:s.last_name||s.name, school:s.school||'', programType:s.program_type||'', termDates:s.term_dates||'', hoursRequired:s.hours_required||'', shiftPreference:s.shift_availability||'', preceptorAssigned:s.matched_preceptor||'' }], isMultiStudent:false }) : null
      return { id:`${s.id}-un`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'routine', title:'Unit Leader Placement Notification', description:`Placed in ${unit?.unit_name||'unit'}. Leader not yet notified.`, actionType:'unit_notification_needed', canMarkDone:!!href, markDoneType:'log_communication', markDonePayload:{type:'unit_notification'}, emailHref:href, matchId:m?.id }
    }) : []),
    ...act5.map(s => {
      const unit = units.find(u => u.id === s.matched_unit_id)
      return { id:`${s.id}-pw`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'routine', title:'Preceptor Welcome Email', description:s.preceptor_email?`Preceptor: ${s.matched_preceptor}. Welcome email not sent.`:'Preceptor email missing — add it in the student profile.', actionType:'unit_notification_needed', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'preceptor_welcome'}, emailHref:s.preceptor_email?buildPreceptorWelcomeEmail(s,unit?.contact_email):null, warning:!s.preceptor_email?'Missing preceptor email':null }
    }),
    ...(canEdit ? act17.map(s => ({ id:`${s.id}-prec`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'high', title:'No Preceptor Assigned', description:`${s.status} — no preceptor linked yet.`, actionType:'preceptor_needed', canMarkDone:false, markDoneType:null, navigateToProfile:true })) : []),
    // CS-Link
    ...(canEdit ? act6.map(s => ({ id:`${s.id}-cs`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'cslink', priority:'routine', title:'CS-Link Access Not Started', description:'Service Center Step 2 not yet submitted.', actionType:'cslink_incomplete', canMarkDone:false, markDoneType:null, navigateToProfile:true })) : []),
    // Badge
    ...act11.map(s => ({ id:`${s.id}-cert`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'badge', priority:'fyi', title:'Certificate of Completion', description:'Hours met. Certificate not yet sent.', actionType:'hours_completed', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'certificate'}, emailHref:buildCertificateEmail(s) })),
    ...(canEdit ? act16.map(s => ({ id:`${s.id}-badge`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'badge', priority:'routine', title:'Badge Not Created', description:'Student placed. CS badge not yet created.', actionType:'badge_needed', canMarkDone:true, markDoneType:'update_field', markDonePayload:{fields:{badge_created:true}}, navigateToProfile:false })) : []),
    // Hours
    ...act13.map(item => ({ id:`${item.id}-sr`, studentId:item.student_id, studentName:item.student?`${item.student.last_name}, ${item.student.first_name}`:'—', cohortId, student:item.student, category:'hours', priority:'routine', title:'Shift Log Needs Review', description:`${item.shift_date} · ${item.total_hours}h`, actionType:'shift_log_submitted', canMarkDone:false, markDoneType:null, navigateToProfile:true })),
    ...act15.map(s => ({ id:`${s.id}-nl`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'hours', priority:'routine', title:'Student Not Logged Recently', description:s.daysSince===null?'No shifts logged yet.':`${s.daysSince} days since last log.`, actionType:'shift_log_submitted', canMarkDone:false, navigateToProfile:true })),
    // Communications
    ...(canEdit ? act1.map(s => ({ id:`${s.id}-sf`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Send Student Form', description:'Pending outreach — form not yet sent.', actionType:'student_form', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'student_form'}, emailHref:buildStudentFormEmail(s) })) : []),
    ...act8.map(s => ({ id:`${s.id}-mc`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Midpoint Student Check-In', description:'Active Rotation. Check-in email not sent.', actionType:'midpoint_checkin', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'midpoint_checkin'}, emailHref:buildMidpointCheckinEmail(s) })),
    ...act9.map(s => ({ id:`${s.id}-me`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Midpoint Preceptor Evaluation', description:s.preceptor_email?'Request midpoint eval from preceptor.':'Preceptor email missing.', actionType:'midpoint_eval', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'midpoint_eval'}, emailHref:s.preceptor_email?buildMidpointEvalEmail(s):null, warning:!s.preceptor_email?'Missing preceptor email':null })),
    ...act10.map(s => ({ id:`${s.id}-ps`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'fyi', title:'Post-Program Student Survey', description:'Program completed. Post-survey not sent.', actionType:'post_survey', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'post_survey'}, emailHref:buildPostSurveyEmail(s) })),
    ...act12.map(s => ({ id:`${s.id}-ee`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'End Preceptor Evaluation', description:s.preceptor_email?'Request final evaluation from preceptor.':'Preceptor email missing.', actionType:'end_eval', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'end_eval'}, emailHref:s.preceptor_email?buildEndEvalEmail(s):null, warning:!s.preceptor_email?'Missing preceptor email':null })),
  ]

  const totalCount = actionItems.length

  // Filter pills — only show categories with items
  const categoryCounts = {}
  for (const item of actionItems) {
    const key = item.priority === 'urgent' ? 'urgent' : item.category
    categoryCounts[key] = (categoryCounts[key] || 0) + 1
  }
  const pills = [
    { key: null,            label: 'All',          count: totalCount },
    { key: 'urgent',        label: 'Urgent',       count: categoryCounts.urgent        || 0 },
    { key: 'interview',     label: 'Interviews',   count: categoryCounts.interview     || 0 },
    { key: 'placement',     label: 'Placement',    count: categoryCounts.placement     || 0 },
    { key: 'cslink',        label: 'CS-Link',      count: categoryCounts.cslink        || 0 },
    { key: 'badge',         label: 'Badge',        count: categoryCounts.badge         || 0 },
    { key: 'hours',         label: 'Hours',        count: categoryCounts.hours         || 0 },
    { key: 'communication', label: 'Comms',        count: categoryCounts.communication || 0 },
  ].filter(p => p.key === null || p.count > 0)

  const filteredItems = activeFilter
    ? actionItems.filter(i => activeFilter === 'urgent' ? i.priority === 'urgent' : i.category === activeFilter)
    : actionItems

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Action Center"
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        width: pos.width,
        maxHeight: 'min(640px, calc(100vh - 80px))',
        background: 'var(--bg-card,#fff)',
        borderRadius: 14,
        boxShadow: '0 8px 40px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)',
        border: '1px solid var(--border-card,rgba(29,37,103,0.10))',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 500,
        fontFamily: 'DM Sans, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ background: '#1D2567', padding: '14px 16px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>Action Center</span>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'rgba(255,255,255,0.10)', border: 'none', color: '#fff', fontSize: 18, lineHeight: 1, cursor: 'pointer', width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.18)'}
            onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.10)'}>
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
          Prioritized actions requiring attention
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
          {totalCount} open action{totalCount !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Filter pills */}
      {totalCount > 0 && (
        <div style={{
          display: 'flex', gap: 5, padding: '9px 14px',
          borderBottom: '1px solid var(--border-card,rgba(29,37,103,0.08))',
          flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {pills.map(pill => {
            const isActive = activeFilter === pill.key
            return (
              <button
                key={String(pill.key)}
                onClick={() => setActiveFilter(pill.key)}
                style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 20, border: 'none',
                  cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontSize: 11, fontWeight: 600,
                  transition: 'all 0.12s',
                  background: isActive ? '#1D2567' : 'rgba(29,37,103,0.07)',
                  color: isActive ? '#fff' : '#475467',
                }}>
                {pill.label} {pill.count}
              </button>
            )
          })}
        </div>
      )}

      {/* Stacks body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0 20px' }}>
        {totalCount === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 10 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C8D5C0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>All caught up.</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>No open actions right now.</div>
          </div>
        ) : (
          STACK_ORDER.map(stack => {
            const items = filteredItems.filter(stack.filter)
            if (items.length === 0) return null
            const isExpanded   = !!expandedStacks[stack.key]
            const visibleItems = isExpanded ? items : items.slice(0, 2)
            const hiddenCount  = items.length - 2

            return (
              <div key={stack.key} style={{ marginBottom: 2 }}>
                {/* Stack header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px 5px', background: 'var(--pearl,#FAFAF7)', borderBottom: '1px solid rgba(29,37,103,0.04)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: stack.color }}>
                    {stack.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: stack.color, background: `${stack.color}18`, padding: '1px 7px', borderRadius: 20 }}>
                    {items.length}
                  </span>
                </div>

                {/* Items */}
                {visibleItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    isConfirming={confirmingId === item.id}
                    isActioning={actioning === item.id}
                    onAction={() => handleAction(item)}
                    onConfirm={() => handleConfirmComplete(item)}
                    onCancelConfirm={() => setConfirmingId(null)}
                    oriExpanded={oriExpanded}
                    onOriExpand={() => setOriExpanded(p => !p)}
                    oriFields={oriFields}
                    onOriFieldChange={(k, v) => setOriFields(p => ({ ...p, [k]: v }))}
                    copyOk={copyOk}
                    onCopyOrientation={handleCopyOrientation}
                    onOpenOrientationMailto={handleOpenOrientationMailto}
                    onMarkOrientationSent={handleMarkOrientationSent}
                    placedStudents={placedStudents}
                  />
                ))}

                {/* Expand / collapse */}
                {hiddenCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px', borderBottom: '1px solid rgba(29,37,103,0.04)', background: '#fff' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>
                      +{hiddenCount} more {stack.label.toLowerCase()} action{hiddenCount !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setExpandedStacks(p => ({ ...p, [stack.key]: !p[stack.key] }))}
                      style={{ fontSize: 11, fontWeight: 600, color: '#1D2567', background: 'rgba(29,37,103,0.07)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                      {isExpanded ? 'Collapse ▴' : 'Expand ▾'}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
