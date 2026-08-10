import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { buildUnitLeaderEmail } from '../lib/emailUtils'
import { buildOutlookComposeUrl } from '../lib/outlookCompose'
import { appUrl } from '../lib/appUrl'
import { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
export { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
import { useAuth } from '../contexts/AuthContext'
import { DISPOSITION_TYPES, FOLLOWUP_TYPES } from '../lib/dispositions'
import { deriveEagerAttention, deriveLazyAttention } from '../lib/attention'
import { describeAutomationState } from '../lib/automationOwnership'
import { useSupportRequestReads } from '../lib/support/useSupportRequestReads'
import { BADGE_COUNT_BG, BADGE_COUNT_FG } from '../lib/badgeTokens'
import StaffNotificationsPanel from './StaffNotificationsPanel'
import { unreadSupportShifts, buildSupportActionItem } from '../lib/support/supportRequests'
import { canSendSchedulingLink } from '../lib/schedulingLinkFlow'

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

// Honor the OS reduced-motion preference for the open/scrim transitions.
const REDUCED_MOTION = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false

// ── Triage taxonomy (presentation grouping only - NOT task triggers) ─────────
// Existing tasks keep their predicates/priority/actionType; we just regroup them
// into three reader-friendly sections plus a session-derived "Recently completed".
const PRIORITY_RANK = { urgent: 0, high: 1, routine: 2, fyi: 3 }

// Time-bound milestones that read as "coming due" rather than persistent gaps.
const DUE_SOON_TYPES = new Set([
  // ACTION-OWNERSHIP-1: this type now only ever carries an automation
  // EXCEPTION (send failed, window passed unsent, or automation off). A
  // reminder the cron still owns never becomes an item at all.
  'interview_reminder_overdue',
])

// Map one action item to its triage section. Pure function of existing fields.
function sectionFor(item) {
  if (item.priority === 'urgent' || item.category === 'disposition') return 'urgent'
  // Unread support requests are time-sensitive; group them in the amber "Due soon" section.
  if (item.isOrientation || item.actionType === 'support_request' || DUE_SOON_TYPES.has(item.actionType)) return 'due_soon'
  return 'needs_followup'
}

const SECTION_ORDER = [
  { key: 'urgent',         label: 'Urgent',          color: '#dc2626', hint: 'Needs a decision or compliance action' },
  { key: 'due_soon',       label: 'Due soon',        color: '#d97706', hint: 'Time-bound, coming due' },
  { key: 'needs_followup', label: 'Needs follow-up', color: '#1D2567', hint: 'Outstanding outreach and setup' },
]

// Action Center shell styles. Native ASPIRE look: a mostly-solid, high-contrast
// panel and a very light scrim - NO app-wide backdrop blur (which previously washed
// out the header/bell). Crisp cards and pills consistent with other app panels.
const AC_GLASS_STYLES = `
.ac-scrim {
  position: fixed; inset: 0; z-index: 499;
  background: rgba(15,23,42,0.06);
}
.ac-panel {
  background: rgba(255,255,255,0.97);
  border: 1px solid rgba(29,37,103,0.12);
  box-shadow: 0 12px 40px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.06);
}
/* Clean task cards - solid, crisp, lightweight. */
.ac-card {
  margin: 0 14px 7px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid rgba(29,37,103,0.09);
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
  transition: background 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.ac-card:hover { background: #fbfbfd; border-color: rgba(29,37,103,0.16); box-shadow: 0 2px 8px rgba(15,23,42,0.07); }
.ac-pill {
  flex-shrink: 0; padding: 5px 12px; border-radius: 16px; cursor: pointer;
  font-family: 'DM Sans, sans-serif'; font-size: 11.5px; font-weight: 600;
  transition: all 0.12s ease; white-space: nowrap;
  background: rgba(29,37,103,0.06); border: 1px solid transparent; color: #475467;
}
.ac-pill:hover { background: rgba(29,37,103,0.11); }
.ac-pill.on { background: #1D2567; border-color: #1D2567; color: #fff; }
.ac-close {
  background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.22); color: #fff;
  font-size: 18px; line-height: 1; cursor: pointer; width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; transition: background 0.14s ease;
}
.ac-close:hover { background: rgba(255,255,255,0.28); }
@keyframes acPanelIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes acScrimIn { from { opacity: 0; } to { opacity: 1; } }
.ac-anim-panel { animation: acPanelIn 0.15s cubic-bezier(0.22,0.61,0.36,1); }
.ac-anim-scrim { animation: acScrimIn 0.15s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .ac-anim-panel, .ac-anim-scrim { animation: none; }
}
[data-theme="dark"] .ac-scrim { background: rgba(0,0,0,0.22); }
[data-theme="dark"] .ac-panel { background: rgba(22,27,46,0.985); border-color: rgba(255,255,255,0.10); box-shadow: 0 12px 40px rgba(0,0,0,0.42), 0 2px 8px rgba(0,0,0,0.30); }
[data-theme="dark"] .ac-card { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.08); box-shadow: none; }
[data-theme="dark"] .ac-card:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.14); }
[data-theme="dark"] .ac-pill { background: rgba(255,255,255,0.07); color: #cdd3e6; }
[data-theme="dark"] .ac-pill.on { background: rgba(99,110,210,0.92); border-color: rgba(99,110,210,0.92); color: #fff; }
`

// ACTION-OWNERSHIP-1: "Handled automatically" - passive status, never a task.
//
// Rows here are deliberately OUTSIDE totalCount: a reminder the cron owns is
// visibility, not work. The section exists so the Owner can see the reminder is
// covered rather than wonder why it disappeared from the list.
//
// It lives in its own component on purpose. Mapping an eager-derived array to
// JSX inside ActionCenter stopped the React Compiler from preserving the
// existing useMemo over actionItems, which silently skipped optimizing the
// whole panel; the boundary keeps that optimization intact.
function AutomationStatusSection({ rows, expanded, onToggle }) {
  if (!rows.length) return null
  return (
    <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.30)' }}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4b5563' }}>
          Handled automatically
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#4b5563', background: 'rgba(75,85,99,0.12)', padding: '1px 7px', borderRadius: 20 }}>
          {rows.length}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8a93a3' }}>{expanded ? '\u25b4' : '\u25be'}</span>
      </button>
      {expanded && rows.map(a => (
        <div key={`${a.id}-ir-auto`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 16px 8px 36px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Interview reminder</div>
            <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.last_name}, {a.first_name} · Interview {fmtIvDate(a.interview_scheduled_date)}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '2px 7px', borderRadius: 20, flexShrink: 0 }}>Scheduled</span>
        </div>
      ))}
    </div>
  )
}

function getActionLabel(item) {
  if (item.isOrientation) return null
  if (item.actionType === 'support_request') return 'Open Details'
  if (item.actionType === 'selection_decision') return 'Open Interview Review'
  if (item.navigateToProfile && !item.canMarkDone) return 'Open Profile'
  if (item.markDoneType === 'update_field') return 'Mark Complete'
  // CONNECT-SCHEDULING-LINK-1: the scheduling task offers its action only when the launch is
  // available (Owner/Admin with a school email on file); otherwise the row shows its warning alone.
  if (item.actionType === 'interview_link_not_sent') return item.launchSchedulingLink ? 'Send Scheduling Link' : null
  if (item.warning && !item.emailHref) return null
  switch (item.actionType) {
    case 'student_form':               return 'Send Form Email'
    case 'interview_reminder_overdue': return 'Send Reminder'
    case 'unit_notification_needed':
      return item.title === 'Preceptor Welcome Email' ? 'Open in Outlook' : 'Notify Unit Leader'
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

// Opens Outlook Web compose (office.com) instead of the OS default mailto handler, so in-app staff
// email actions open under the Cedars-Sinai O365 account (not the OS default, e.g. IONOS).
// (Local builder kept for parity; the shared src/lib/outlookCompose.js helper is used for the
// bcc-bearing orientation action below and could fully replace this in a later consolidation.)
function outlookCompose(to, subject, body, cc = '') {
  const base = 'https://outlook.office.com/mail/deeplink/compose'
  let url = `${base}?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  if (cc) url += `&cc=${encodeURIComponent(cc)}`
  return url
}

function buildStudentFormEmail(s) {
  return outlookCompose(s.school_email, 'ASPIRE Student Form – Action Required',
`Dear ${s.first_name},

You have been identified as a potential candidate for ASPIRE (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai Medical Center.

To begin the process, please complete your ASPIRE Student Profile using the link below:

${appUrl('/student-form')}

This form collects your personal information, clinical interests, and unit preferences. It should take approximately 10 to 15 minutes to complete.

If you have any questions, please don't hesitate to reach out.

${SIG}`)
}

// CONNECT-SCHEDULING-LINK-1: the scheduling-link compose builder that used to live here is gone.
// This task now launches ASPIRE Connect through the shared flow (lib/schedulingLinkFlow.js), the same
// one the Interviews worklist and Student Profiles use, so the link email exists in exactly one place
// (the Interview Scheduling template) and the "sent" record is written only on confirmed evidence.

function buildInterviewReminderEmail(s) {
  const to = s.personal_email || s.school_email
  return outlookCompose(to, 'Reminder: Your ASPIRE Interview is Coming Up',
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

function buildPreceptorWelcomeEmail(s, unitContactEmail) {
  const prec = s.matched_preceptor || 'Preceptor'
  const precFirst = prec.split(' ')[0]
  const cc = unitContactEmail || ''
  return outlookCompose(s.preceptor_email, 'ASPIRE – Student Preceptor Assignment',
`Dear ${precFirst},

Thank you so much for agreeing to precept one of our senior nursing students through ASPIRE (Affiliate Students' Pathway from Internship to Residency Experience). Your willingness to teach, mentor, and support our students truly makes a difference in shaping the next generation of nurses at Cedars-Sinai.

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
      <div className="ac-card" style={{ padding: '12px 14px', boxSizing: 'border-box' }}>
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
              {`Student Name | Unit | Shift | Preceptor | Preceptor Email\n${placedStudents.map(s => `${s.last_name}, ${s.first_name} |, |, | ${s.matched_preceptor||'-'} | ${s.preceptor_email||'-'}`).join('\n')}`}
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
    <div className="ac-card" style={{ padding: '11px 14px', minHeight: 60, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%' }}>
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
  communications, onLogCommunication, onStudentUpdate, onMatchUpdate,
  reminderDeliveries = [], reminderDeliveriesLoaded = false,
  onNavigateToProfiles, onNavigateToActivityShift, onNavigateNotificationDestination,
  onLaunchSchedulingLink,
  onActionCountChange, toast,
  notifications = {},
}) {
  const { canEdit, userProfile } = useAuth()
  const notifUnread = notifications.unreadCount || 0
  const { receipts: supportReceipts } = useSupportRequestReads(userProfile?.id)
  const popoverRef = useRef(null)

  // UI state
  const [oriFields,      setOriFields]      = useState({ date: '', time: '', location: '' })
  const [copyOk,         setCopyOk]         = useState(false)
  const [oriDone,        setOriDone]        = useState(false)
  const [oriExpanded,    setOriExpanded]    = useState(false)
  const [activeFilter,   setActiveFilter]   = useState(null)
  const [acTab,          setAcTab]          = useState('actions')  // 'actions' | 'notifications'
  const [expandedStacks, setExpandedStacks] = useState({})
  const [confirmingId,   setConfirmingId]   = useState(null)
  const [actioning,      setActioning]      = useState(null)
  const [showCompleted,  setShowCompleted]  = useState(false)
  // ACTION-OWNERSHIP-1: the passive "Handled automatically" list, collapsed by
  // default so automation status never competes with real work.
  const [showAutomated,  setShowAutomated]  = useState(false)
  // "Recently completed": only tasks the user actually resolved in THIS session.
  // No durable store - derived from real actions taken, never invented.
  const [completedLog,   setCompletedLog]   = useState([])
  const logCompleted = (entry) => setCompletedLog(prev => {
    if (!entry?.title) return prev
    const next = [{ ...entry }, ...prev.filter(e => e.id !== entry.id)]
    return next.slice(0, 6)
  })

  // Shift log data (lazy-loaded on first open)
  const [shiftLogs,          setShiftLogs]          = useState([])
  const [shiftLogsLoaded,    setShiftLogsLoaded]    = useState(false)
  const [shiftLogsError,     setShiftLogsError]     = useState(null)
  const [shiftLogsLoading,   setShiftLogsLoading]   = useState(false)
  const [shiftLogsRetry,     setShiftLogsRetry]     = useState(0)

  useEffect(() => {
    if (!isOpen || !cohortId || shiftLogsLoaded) return
    setShiftLogsLoading(true)
    setShiftLogsError(null)
    supabase.from('student_shift_logs').select('*').eq('cohort_id', cohortId)
      .order('submitted_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setShiftLogsError(error.message || 'Failed to load shift logs') }
        else { setShiftLogs(data || []); setShiftLogsLoaded(true) }
      })
      .finally(() => setShiftLogsLoading(false))
  }, [isOpen, cohortId, shiftLogsLoaded, shiftLogsRetry])

  useEffect(() => { setShiftLogs([]); setShiftLogsLoaded(false); setShiftLogsError(null); setCompletedLog([]) }, [cohortId])

  // Disposition followups - reload fresh on every open so completion state stays current
  const [dispositionFollowups,        setDispositionFollowups]        = useState([])
  const [activeDispositionIds,        setActiveDispositionIds]        = useState([])
  const [dispositionFollowupsError,   setDispositionFollowupsError]   = useState(null)
  const [dispositionFollowupsLoading, setDispositionFollowupsLoading] = useState(false)
  const [dispositionFollowupsLoaded,  setDispositionFollowupsLoaded]  = useState(false)
  const [dispositionRetry,            setDispositionRetry]            = useState(0)

  useEffect(() => {
    if (!isOpen || !cohortId || !canEdit) return
    setDispositionFollowupsLoading(true)
    setDispositionFollowupsError(null)
    setDispositionFollowups([])
    setActiveDispositionIds([])
    setDispositionFollowupsLoaded(false)
    // Fetch pending follow-ups AND the set of currently-active dispositions. Clearing a
    // disposition (clear_student_disposition RPC) inactivates it WITHOUT deleting its
    // follow-ups or changing their 'pending' status, so a pending row can outlive its
    // disposition. We keep a follow-up only when its disposition_id is still active -
    // both queries run fresh on open, so the task self-clears after a clear/refresh.
    Promise.all([
      supabase
        .from('student_disposition_followups')
        .select('id, student_id, disposition_id, followup_type, created_at')
        .eq('cohort_id', cohortId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      supabase
        .from('student_active_disposition')
        .select('id, student_id')
        .eq('cohort_id', cohortId),
    ])
      .then(([fRes, aRes]) => {
        if (fRes.error) { setDispositionFollowupsError(fRes.error.message || 'Failed to load disposition follow-ups'); return }
        if (aRes.error) { setDispositionFollowupsError(aRes.error.message || 'Failed to load active dispositions'); return }
        setDispositionFollowups(fRes.data || [])
        setActiveDispositionIds((aRes.data || []).map(d => d.id))
        setDispositionFollowupsLoaded(true)
      })
      .finally(() => setDispositionFollowupsLoading(false))
  }, [isOpen, cohortId, dispositionRetry, canEdit])

  // Reset UI on open
  useEffect(() => {
    if (isOpen) {
      setActiveFilter(null)
      setExpandedStacks({})
      setConfirmingId(null)
      setOriExpanded(false)
      setShowCompleted(false)
    }
  }, [isOpen])

  // Right-side glass sheet: fixed to the right edge, opening from the bell area.
  const [pos, setPos] = useState({ top: 64, right: 20, width: 460, mobile: false })
  useLayoutEffect(() => {
    if (!isOpen) return
    const vw = window.innerWidth
    const mobile = vw < 640
    // Sit just below the header (clamped 56–76px), near where the bell lives.
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : null
    const bellBottom = rect ? rect.bottom + 8 : 64
    const top = Math.min(Math.max(bellBottom, 56), 76)
    if (mobile) {
      // Near-full-width sheet with comfortable side margins.
      setPos({ top, right: 10, width: vw - 20, mobile: true })
      return
    }
    const width = Math.min(432, vw - 48) // compact, aligned with the header icon area
    setPos({ top, right: 18, width, mobile: false })
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
    if (item.navigateToActivityShift) {
      // Navigate + focus + auto-open the exact shift. The receipt is written by the modal after the
      // support text renders, NOT here - clicking alone never marks the request read.
      onNavigateToActivityShift?.(item.studentId, item.shiftLogId)
      onClose()
      return
    }
    if (item.navigateToProfile) {
      onNavigateToProfiles?.(item.studentId)
      onClose()
      return
    }
    if (item.markDoneType === 'update_field') {
      setConfirmingId(item.id)
      return
    }
    // CONNECT-SCHEDULING-LINK-1: hand off to the shared launch and close the panel. NOTHING is
    // written here - unlike the log-on-compose branch below, which this task deliberately no longer
    // uses. The Scheduling Link Sent entry comes from the confirmed return.
    if (item.launchSchedulingLink) {
      onLaunchSchedulingLink?.(item.student)
      onClose()
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
      // Unit Leader Placement Notification self-clears on matches.notification_sent (the
      // predicate source, written by the Rotations unit card) - not on the comm log. Set
      // it here too, with the same fields/pattern, so the task clears and the two surfaces
      // stay consistent.
      if (type === 'unit_notification') {
        if (item.matchId && onMatchUpdate) {
          await onMatchUpdate(item.matchId, item.studentId, { notification_sent: true, notified_at: new Date().toISOString() })
        }
        toast?.success('Notified', 'Unit leader email marked as sent.')
      }
      logCompleted({ id: item.id, title: item.title, studentName: item.studentName })
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
      toast?.success('Completed', `${item.studentName}, task marked complete.`)
      logCompleted({ id: item.id, title: item.title, studentName: item.studentName })
    } else {
      toast?.error('Error', err.message || 'Could not complete.')
    }
  }

  // ── Orientation helpers ─────────────────────────────────────
  const placedStudents = students.filter(s => s.status === 'Placed')

  const buildOrientationBody = () => {
    const rows = placedStudents.map(s => {
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name}, ${s.first_name} | ${u?.unit_name||'-'} | ${s.shift_assigned||'-'} | ${s.matched_preceptor||'-'} | ${s.preceptor_email||'-'}`
    }).join('\n')
    const table = `Student Name | Unit | Shift | Preceptor | Preceptor Email\n${rows}`
    return `Dear ASPIRANTS,

Congratulations and welcome to ASPIRE (Affiliate Students' Pathway from Internship to Residency Experience)!

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
    openHref(buildOutlookComposeUrl({ bcc: bccs, subject: 'Welcome to ASPIRE – Orientation Details Inside' }))
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
    logCompleted({ id: 'orientation', title: 'Orientation Email', studentName: `${placedStudents.length} placed student${placedStudents.length !== 1 ? 's' : ''}` })
  }

  // ── Error / retry helpers ──────────────────────────────────
  const hasFetchError = !!shiftLogsError || !!dispositionFollowupsError

  const handleRetry = () => {
    if (shiftLogsError) {
      setShiftLogsError(null)
      setShiftLogsLoaded(false)
      setShiftLogsRetry(n => n + 1)
    }
    if (dispositionFollowupsError) {
      setDispositionFollowupsError(null)
      setDispositionRetry(n => n + 1)
    }
  }

  // ── Derived action items ────────────────────────────────────
  // ASPIRE-CHART: every predicate lives in lib/attention.js, the canonical
  // attention engine shared with App.jsx's closed-badge count. Do not add
  // task logic here - add it to the module so both surfaces stay identical.
  const now = new Date()
  const eager = deriveEagerAttention({
    students, matches, communications, activeCohort, canEdit, now,
    reminderDeliveries, deliveriesLoaded: reminderDeliveriesLoaded,
  })
  const lazy = deriveLazyAttention({
    students, shiftLogs, shiftLogsLoaded,
    dispositionFollowups, activeDispositionIds,
    dispositionLoaded: dispositionFollowupsLoaded,
    canEdit, now,
  })

  const act1  = eager.sendStudentForm
  const act2  = eager.schedulingLink
  const act3  = eager.interviewReminder
  const act4  = eager.unitLeaderNotification
  const act5  = eager.preceptorWelcome
  const act6  = eager.csLinkNotStarted
  const act15 = lazy.notLoggedRecently
  const act16 = eager.badgeNotCreated
  const act17 = eager.noPreceptor
  const act18 = eager.selectionDecision
  const act19 = lazy.dispositionFollowup
  // ACTION-OWNERSHIP-1: reminders the cron owns - passive STATUS, not a task.
  // Never spread into actionItems and never counted.
  const actAuto = eager.interviewReminderScheduled || []
  // The former act13 "Shift Log Needs Review" task is retired (approved
  // shift-log semantics): a plain submitted log is informational activity in
  // Rotation Activity, not a required action - the staff app deliberately
  // offers no per-shift approval action for it to point at. Shifts carrying
  // support-needed text remain actionable below.
  const showOrientation = eager.orientationDue && !oriDone

  // Unread support-request shifts for the current user (empty until shiftLogs load, like act13/act15).
  const supportUnread = !shiftLogsLoaded ? [] : unreadSupportShifts(shiftLogs, userProfile?.id, supportReceipts)

  const actionItems = [
    // Orientation special item in placement
    ...(showOrientation ? [{ id: 'orientation', isOrientation: true, category: 'placement', priority: 'high', title: 'Orientation Email', studentName: `${placedStudents.length} placed student${placedStudents.length !== 1 ? 's' : ''}`, description: 'Orientation email and pre-program survey not yet sent.', canMarkDone: false }] : []),
    // Interviews
    // CONNECT-SCHEDULING-LINK-1: launches ASPIRE Connect instead of opening a draft, and writes
    // nothing on click. The Scheduling Link Sent entry (which resolves this very task, via the
    // 'scheduling_link' communication the predicate now reads) is recorded only after the Owner
    // confirms on return. The item stays visible to every role so the panel and the bell badge keep
    // counting identically; only the ACTION is limited to the roles Connect lets send.
    // A student with no school email carries a warning instead of an action: the public scheduling
    // page resolves students by school email alone, so there is nothing valid to send.
    ...act2.map(s => {
      const gate = canSendSchedulingLink(s, communications)
      return { id:`${s.id}-sl`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'high', title:'Send Interview Scheduling Link', description:'Form received. Scheduling link not sent.', actionType:'interview_link_not_sent', canMarkDone:false, markDoneType:null, launchSchedulingLink:canEdit && gate.ok, warning:gate.shortReason }
    }),
    ...act3.map(s => ({ id:`${s.id}-ir`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'high', title:'Send Interview Reminder', description:`Interview ${fmtIvDate(s.interview_scheduled_date)}. ${describeAutomationState(s.automationState, s.automationSpec)}`, actionType:'interview_reminder_overdue', automationState:s.automationState, canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'interview_reminder'}, emailHref:buildInterviewReminderEmail(s) })),
    ...(canEdit ? act18.map(s => ({ id:`${s.id}-sd`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'interview', priority:'urgent', title:'Selection Decision Needed', description:'Rubric: Do Not Recommend · Awaiting selection decision', actionType:'selection_decision', canMarkDone:false, markDoneType:null, navigateToProfile:true })) : []),
    ...act19.map(({ student: s, followups }) => {
      const dispLabel = DISPOSITION_TYPES[s.active_disposition?.disposition_type] || 'Disposition'
      const pendingLabels = followups.map(f => FOLLOWUP_TYPES[f.followup_type] || f.followup_type).join(', ')
      return { id:`${s.id}-df`, studentId:s.id, studentName:`${s.last_name || ''}, ${s.first_name || ''}`.trim().replace(/^,\s*/, '') || s.name || '-', cohortId:s.cohort_id, student:s, category:'disposition', priority:'high', title:'Disposition Follow-up Required', description:`${dispLabel} · Pending: ${pendingLabels}`, actionType:'disposition_followup', canMarkDone:false, markDoneType:null, navigateToProfile:true }
    }),
    // Placement
    ...(canEdit ? act4.map(s => {
      const unit = units.find(u => u.id === s.matched_unit_id)
      const m    = matches.find(m => m.student_id === s.id)
      const href = unit ? buildUnitLeaderEmail({ contactPersons:unit.contact_person||'Unit Leader', contactEmails:unit.contact_email||'', unitName:unit.unit_name, students:[{ firstName:s.first_name, lastName:s.last_name||s.name, school:s.school||'', programType:s.program_type||'', termDates:s.term_dates||'', hoursRequired:s.hours_required||'', shiftPreference:s.shift_availability||'', preceptorAssigned:s.matched_preceptor||'' }], isMultiStudent:false }) : null
      return { id:`${s.id}-un`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'routine', title:'Unit Leader Placement Notification', description:`Placed in ${unit?.unit_name||'unit'}. Leader not yet notified.`, actionType:'unit_notification_needed', canMarkDone:!!href, markDoneType:'log_communication', markDonePayload:{type:'unit_notification'}, emailHref:href, matchId:m?.id }
    }) : []),
    ...act5.map(s => {
      const unit = units.find(u => u.id === s.matched_unit_id)
      return { id:`${s.id}-pw`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:'routine', title:'Preceptor Welcome Email', description:s.preceptor_email?`Preceptor: ${s.matched_preceptor}. Welcome email not sent.`:'Preceptor email missing, add it in the student profile.', actionType:'unit_notification_needed', canMarkDone:!!s.preceptor_email, markDoneType:'log_communication', markDonePayload:{type:'preceptor_welcome'}, emailHref:s.preceptor_email?buildPreceptorWelcomeEmail(s,unit?.contact_email):null, warning:!s.preceptor_email?'Missing preceptor email':null }
    }),
    ...(canEdit ? act17.map(s => ({ id:`${s.id}-prec`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'placement', priority:(s.status === 'Active Rotation' ? 'urgent' : 'high'), title:'No Preceptor Assigned', description:`${s.status}, no preceptor linked yet.`, actionType:'preceptor_needed', canMarkDone:false, markDoneType:null, navigateToProfile:true })) : []),
    // CS-Link
    ...(canEdit ? act6.map(s => ({ id:`${s.id}-cs`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'cslink', priority:'routine', title:'CS-Link Access Not Started', description:'Service Center Step 2 not yet submitted.', actionType:'cslink_incomplete', canMarkDone:false, markDoneType:null, navigateToProfile:true })) : []),
    // Badge
    ...(canEdit ? act16.map(s => ({ id:`${s.id}-badge`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'badge', priority:'routine', title:'Badge Not Created', description:'Student placed. CS badge not yet created.', actionType:'badge_needed', canMarkDone:true, markDoneType:'update_field', markDonePayload:{fields:{badge_created:true}}, navigateToProfile:false })) : []),
    // Hours (plain submitted logs are informational in Rotation Activity, not tasks)
    ...act15.map(s => ({ id:`${s.id}-nl`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'hours', priority:'routine', title:'Student Not Logged Recently', description:s.daysSince===null?'No shifts logged yet.':`${s.daysSince} days since last log.`, actionType:'shift_log_submitted', canMarkDone:false, navigateToProfile:true })),
    // Communications
    ...(canEdit ? act1.map(s => ({ id:`${s.id}-sf`, studentId:s.id, studentName:`${s.last_name}, ${s.first_name}`, cohortId:s.cohort_id, student:s, category:'communication', priority:'routine', title:'Send Student Form', description:'Pending outreach, form not yet sent.', actionType:'student_form', canMarkDone:true, markDoneType:'log_communication', markDonePayload:{type:'student_form'}, emailHref:buildStudentFormEmail(s) })) : []),
    // SUPPORT-REQUEST-ACTION-CENTER-2: one item per UNREAD support-request shift for the current user
    // (not collapsed by student). Uses the same shiftLogs (select('*')) + the shared unread helper as
    // the Rotation indicators and bell. Clicking navigates to Rotation > Activity and auto-opens the
    // exact shift's Details modal; the receipt is written there, after the text renders.
    ...supportUnread.map(log => {
      const st = students.find(s => s.id === log.student_id)
      const built = buildSupportActionItem(log, { studentName: st ? `${st.last_name}, ${st.first_name}` : '-' })
      const dateStr = log.shift_date ? new Date(log.shift_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
      return {
        id: `${log.id}-support`, studentId: log.student_id, shiftLogId: log.id,
        studentName: built.studentName, cohortId, student: st,
        category: 'support', priority: 'high', title: 'Support requested',
        description: [dateStr, log.unit_name, built.preview].filter(Boolean).join(' · '),
        actionType: 'support_request', navigateToActivityShift: true, canMarkDone: false, markDoneType: null,
      }
    }),
  ]

  const totalCount = actionItems.length

  // The lazy task data must be loaded before totalCount reflects the true visible set
  // (shift logs for act13/act15, disposition data for act19). Until then, totalCount is
  // eager-only and would be wrong, so we hold off reporting.
  const lazyReady = shiftLogsLoaded && (!canEdit || dispositionFollowupsLoaded)

  // Report the live visible-task count up so the bell badge matches the panel exactly,
  // including the lazy-loaded tasks (Disposition / Shift Log / Not Logged). Gated on
  // lazyReady so the badge keeps App's stable closed count until the exact count is known
  // - no transient inflated flash on open. Recently completed is NOT part of totalCount.
  useEffect(() => {
    if (!lazyReady) return
    onActionCountChange?.(totalCount)
  }, [totalCount, lazyReady, onActionCountChange])
  // Separate unmount-only signal: report null when the panel closes so the badge falls
  // back to App's (freshly refetched) count and never keeps a stale panel/cohort count.
  // Kept apart from the count effect so it does NOT fire on every in-panel count change.
  useEffect(() => {
    return () => onActionCountChange?.(null)
  }, [onActionCountChange])

  // Group into the three triage sections (presentation only - predicates untouched),
  // each ordered by priority. Cheap derivation over <=20 items, memoized for clarity.
  const grouped = useMemo(() => {
    const g = { urgent: [], due_soon: [], needs_followup: [] }
    for (const item of actionItems) g[sectionFor(item)].push(item)
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
    }
    return g
  }, [actionItems])

  // Section filter pills - All plus only the sections that currently have items.
  const pills = [
    { key: null, label: 'All', count: totalCount },
    ...SECTION_ORDER
      .map(s => ({ key: s.key, label: s.label, count: grouped[s.key].length }))
      .filter(p => p.count > 0),
  ]
  const visibleSections = SECTION_ORDER.filter(s => !activeFilter || activeFilter === s.key)

  if (!isOpen) return null

  return (
    <>
      <style>{AC_GLASS_STYLES}</style>

      {/* Soft semi-clear veil - app content stays visible but softened */}
      <div
        className={`ac-scrim${REDUCED_MOTION ? '' : ' ac-anim-scrim'}`}
        aria-hidden="true"
        onMouseDown={onClose}
      />

      <div
      ref={popoverRef}
      role="dialog"
      aria-label="Action Center"
      className={`ac-panel${REDUCED_MOTION ? '' : ' ac-anim-panel'}`}
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        width: pos.width,
        // Stop well above the Keith AI launcher (fixed bottom:24px, 60px tall) so the
        // sheet never collides with it; cap the column height too so it stays compact on
        // tall screens. The body scrolls internally past either limit.
        maxHeight: `min(600px, calc(100vh - ${pos.top + 116}px))`,
        borderRadius: pos.mobile ? 16 : 16,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 500,
        fontFamily: 'DM Sans, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header - solid Nightfall/Raven navy band, crisp against the panel */}
      <div style={{
        background: 'linear-gradient(135deg, #1D2567, #232C72)',
        padding: '15px 18px 13px', flexShrink: 0,
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>Action Center</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="ac-close">×</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.60)', marginBottom: 4 }}>
          Prioritized actions requiring attention
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
          {acTab === 'actions'
            ? `${totalCount} open action${totalCount !== 1 ? 's' : ''}`
            : `${notifUnread} unread`}
        </div>
      </div>

      {/* Two tabs under one bell: live-derived tasks vs durable staff notifications. Notification
          events are never mixed into the task list. One combined unread badge lives on the bell. */}
      <div role="tablist" aria-label="Action Center views" style={{
        display: 'flex', gap: 2, padding: '0 10px', flexShrink: 0,
        borderBottom: '1px solid rgba(0,0,0,0.08)', background: '#fff',
      }}>
        <button
          role="tab" aria-selected={acTab === 'actions'} onClick={() => setAcTab('actions')}
          style={{
            background: 'none', border: 'none', borderBottom: `2px solid ${acTab === 'actions' ? '#1D2567' : 'transparent'}`,
            padding: '10px 12px', fontSize: 12.5, fontWeight: acTab === 'actions' ? 700 : 600,
            color: acTab === 'actions' ? '#1D2567' : '#6b7280', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
          }}>
          Action Needed{totalCount > 0 ? ` (${totalCount})` : ''}
        </button>
        <button
          role="tab" aria-selected={acTab === 'notifications'} onClick={() => setAcTab('notifications')}
          style={{
            display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none',
            borderBottom: `2px solid ${acTab === 'notifications' ? '#1D2567' : 'transparent'}`,
            padding: '10px 12px', fontSize: 12.5, fontWeight: acTab === 'notifications' ? 700 : 600,
            color: acTab === 'notifications' ? '#1D2567' : '#6b7280', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
          }}>
          Notifications
          {notifUnread > 0 && (
            <span aria-hidden="true" style={{
              marginLeft: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
              background: BADGE_COUNT_BG, color: BADGE_COUNT_FG, fontSize: 10, fontWeight: 700,
            }}>{notifUnread >= 10 ? '9+' : notifUnread}</span>
          )}
        </button>
      </div>

      {acTab === 'actions' && (<>
      {/* Filter pills */}
      {totalCount > 0 && (
        <div style={{
          display: 'flex', gap: 7, padding: '11px 16px 4px',
          flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {pills.map(pill => (
            <button
              key={String(pill.key)}
              onClick={() => setActiveFilter(pill.key)}
              className={`ac-pill${activeFilter === pill.key ? ' on' : ''}`}>
              {pill.label} {pill.count}
            </button>
          ))}
        </div>
      )}

      {/* Error banner */}
      {hasFetchError && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', background: '#fef3c7',
          borderBottom: '1px solid #fde68a', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: '#92400e' }}>
            Some action items could not be loaded.
          </span>
          <button
            onClick={handleRetry}
            style={{
              fontSize: 11, fontWeight: 700, color: '#92400e',
              background: 'none', border: '1px solid #fcd34d', borderRadius: 6,
              padding: '3px 9px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
            }}>
            Retry
          </button>
        </div>
      )}

      {/* Triage sections body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 18px' }}>
        {totalCount === 0 && !hasFetchError && (shiftLogsLoading || dispositionFollowupsLoading) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
            <span style={{ fontSize: 13, color: '#6b7280', fontFamily: 'DM Sans, sans-serif' }}>Loading action items…</span>
          </div>
        ) : totalCount === 0 && !hasFetchError ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 28px', gap: 12 }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(123,168,107,0.14)', border: '1px solid rgba(123,168,107,0.30)',
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#7BA86B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1D2567' }}>All caught up</div>
            <div style={{ fontSize: 12.5, color: '#6b7280', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>No priority actions need your attention right now.</div>
          </div>
        ) : (
          visibleSections.map(section => {
            const items = grouped[section.key]
            if (!items.length) return null
            const isExpanded   = !!expandedStacks[section.key]
            const visibleItems = isExpanded ? items : items.slice(0, 3)
            const hiddenCount  = items.length - 3

            return (
              <div key={section.key} style={{ marginBottom: 11 }}>
                {/* Section header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 8px' }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: section.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: section.color }}>
                    {section.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: section.color, background: `${section.color}1A`, padding: '1px 7px', borderRadius: 20 }}>
                    {items.length}
                  </span>
                  <span style={{ fontSize: 10.5, color: '#8a93a3', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {section.hint}
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 16px 0' }}>
                    <span style={{ fontSize: 11, color: '#8a93a3' }}>
                      +{hiddenCount} more {section.label.toLowerCase()} item{hiddenCount !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setExpandedStacks(p => ({ ...p, [section.key]: !p[section.key] }))}
                      className="ac-pill"
                      style={{ fontSize: 11, padding: '4px 11px' }}>
                      {isExpanded ? 'Show less ▴' : 'Show all ▾'}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}

        <AutomationStatusSection
          rows={actAuto} expanded={showAutomated} onToggle={() => setShowAutomated(v => !v)} />

        {/* Recently completed - only tasks resolved in this session; collapsed; omitted when empty */}
        {completedLog.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.30)' }}>
            <button
              onClick={() => setShowCompleted(s => !s)}
              aria-expanded={showCompleted}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', textAlign: 'left' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7BA86B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4b5563' }}>
                Recently completed
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#4b5563', background: 'rgba(75,85,99,0.12)', padding: '1px 7px', borderRadius: 20 }}>
                {completedLog.length}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8a93a3' }}>{showCompleted ? '▴' : '▾'}</span>
            </button>
            {showCompleted && completedLog.map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 16px 8px 36px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.studentName}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 7px', borderRadius: 20, flexShrink: 0 }}>Done</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}

      {acTab === 'notifications' && (
        <StaffNotificationsPanel
          items={notifications.items || []}
          unreadCount={notifUnread}
          isLoading={notifications.isLoading}
          isError={notifications.isError}
          onMarkRead={notifications.markRead}
          onMarkAllRead={() => notifications.markRead?.(null)}
          onNavigateDestination={onNavigateNotificationDestination}
        />
      )}
    </div>
    </>
  )
}
