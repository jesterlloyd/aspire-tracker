import { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import ProfileActionButton from './ui/ProfileActionButton'
import Tooltip from './ui/Tooltip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { displayName, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import StudentAvatar from './StudentAvatar'
import {
  ASPIRE_STATUSES, ASPIRE_STATUS_CONFIG, NGRP_OUTCOMES, INTERVIEW_OUTCOMES,
  SHIFT_OPTIONS, COHORTS,
} from '../lib/constants'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { TYPE_LABELS, TYPE_COLORS } from '../lib/commTypes'
import { downloadFile, buildStudentFilename } from '../lib/fileUtils'
import { DECLINE_REASONS } from '../lib/statuses'
import { EVENT_TYPES, EVENT_TYPE_LABELS, getEventColor } from '../lib/eventTypes'
import { logEvent, eventExists } from '../lib/logEvent'
import { updatePreceptorAssignment, updateInterviewOutcome } from '../lib/studentProxy'
import { calculateProfileCompletion, getCompletionColor } from '../lib/profileCompletion'
import { formatWeekdays, formatDates, formatBooleanYesNo, formatBooleanAvailable, formatText, formatMinDays } from '../lib/availability'
import { generateStudentSummary } from '../lib/generateSummary'
import { Copy, Check, Mail, User, GraduationCap, Briefcase, MapPin, FileText, MessageSquare, CheckCircle2, Award, ClipboardList, CalendarDays, Flag } from 'lucide-react'
import ClinicalHoursPanel from './ClinicalHoursPanel'
// All external navigation must use openLink helpers (src/lib/openLink.js)
import { openOutlookCompose } from '../lib/outlookCompose'
import SyncIndicator from './SyncIndicator'
import { useLastSynced } from '../hooks/useLastSynced'
import { useAuth } from '../contexts/AuthContext'
import { logActivity } from '../lib/logActivity'
import ConflictDialog from './ConflictDialog'
import { generateBadgePNGs, calculateBadgeDates } from '../lib/badgeGenerator'
import { getStudentLegalDisplayName } from '../lib/studentNameFormatters'
import { isLegacyNonIsoDateValue, dateInputValue } from '../lib/csLinkDateUtils'
import { usePreceptors } from '../hooks/usePreceptors'
import { resolvePreceptor } from '../lib/preceptor'
import PreceptorAssignmentModal from './PreceptorAssignmentModal'
import AdditionalPreceptors from './AdditionalPreceptors'
import DispositionModal from './DispositionModal'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS, DECISION_ORIGINS, FOLLOWUP_TYPES, REASON_CATEGORIES_BY_TYPE } from '../lib/dispositions'

function fmtCommTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' at ' +
    d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})
}

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New to Cedars-Sinai (no prior rotation or employment)' },
  { value: 'former',   label: 'Former Student or Rotation (has been here before)' },
  { value: 'employee', label: 'Current Cedars-Sinai Employee or Volunteer' },
]

const STAGE1_ACTION_OPTIONS = [
  { value: 'assignment_change', label: 'Assignment Change' },
  { value: 'extend_end_date',   label: 'Extend Project End Date' },
  { value: 'reactivate',        label: 'Reactivate Former Non-Employee' },
]

const STAGE1_ACTION_LABELS = {
  add_non_employee: 'Add Non-Employee',
  assignment_change: 'Assignment Change',
  extend_end_date: 'Extend Project End Date',
  reactivate: 'Reactivate',
  not_applicable: 'Not Applicable',
}

const PROGRAM_TYPES = [
  'BSN (Semester)',
  'BSN (Trimester)',
  'BSN (Quarter)',
  'Accelerated BSN',
  'ABSN',
  'LVN to BSN',
  'RN to BSN',
  'MECN',
  "Master's Entry Clinical Nurse (MECN)",
  'ELMN',
  "Entry-Level Master's in Nursing (ELMN)",
  'Other',
]

const CS_AFFILIATIONS = ['Current Employee','Former Employee','Volunteer','No prior affiliation']
const CS_WITH_DEPT    = ['Current Employee','Former Employee','Volunteer']
const GENDER_OPTIONS  = ['Male','Female','Non-binary','Prefer not to say','Other']

// Field-level save indicator context — populated by the drawer when a save succeeds
const FieldSavedCtx = createContext(null)

// Tiny "✓ Saved" badge that appears next to the field label after a successful save
function SavedBadge() {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:2, fontSize:9.5, fontWeight:700,
      color:'#166534', padding:'1px 5px', borderRadius:6, background:'#dcfce7', marginLeft:6 }}>
      <Check size={9} /> Saved
    </span>
  )
}

// Friendly labels for notification_log rows in the Recent Communications list
// (Phase D.2). Mirrors the labels used in SentHistory; falls back to the raw type.
const COMM_TYPE_LABELS = {
  direct_message_sent:              'Direct Message',
  evaluation_invitation_sent:       'Survey Invitation',
  evaluation_invitation_test:       'Survey Invitation (Test)',
  coordinator_weekly_digest:        'Weekly Digest',
  coordinator_weekly_digest_test:   'Weekly Digest (Test)',
  interview_reminder:               'Interview Reminder',
  midpoint_checkin:                 'Midpoint Check-In',
  form_received:                    'Form Received',
  unit_form_received:               'Unit Form Received',
  teams_invite_reminder:            'Teams Invite Reminder',
  teams_invite_reminder_escalation: 'Teams Invite Escalation',
}
function commTypeLabel(t) { return COMM_TYPE_LABELS[t] || t || '—' }
function fmtCommDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function SectionHeader({ title, icon, children }) {
  return (
    // STUDENT-PROFILE-UX-1B: flexWrap so the right-slot (SourceTag + Edit/actions) drops cleanly
    // below the title on narrow panel widths instead of overflowing.
    <div className="sp-section-hdr" style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', rowGap:6 }}>
      {icon && <span style={{ opacity:0.65, flexShrink:0 }}>{icon}</span>}
      <span style={{ flex:1, textTransform:'uppercase', letterSpacing:'0.1em', fontSize:11 }}>{title}</span>
      {children}
    </div>
  )
}

// STUDENT-PROFILE-CANON-1F: compact, de-emphasized section-level provenance label. Makes the
// data owner of each major profile section obvious (student form / coordinator school form /
// ASPIRE-admin) without labeling every field or adding heavy UI.
// STUDENT-PROFILE-UX-1B: softer, calmer tones (lower-contrast text + gentler backgrounds) while
// keeping each owner's color cue legible. Same tone keys, same meaning — provenance preserved.
const SOURCE_TAG_TONES = {
  student:     { bg:'#f3f5fc', color:'#4750a0', border:'#e4e8f6' },
  coordinator: { bg:'#f4f7fb', color:'#3a4673', border:'#e1e8f1' },
  admin:       { bg:'#f5f4f2', color:'#5a626c', border:'#e8e4dd' },
  pending:     { bg:'#fdf6ec', color:'#9a6312', border:'#f1d6b4' },
  muted:       { bg:'#f5f4f2', color:'#7a8089', border:'#e8e4dd' },
}
function SourceTag({ label, tone = 'muted' }) {
  const c = SOURCE_TAG_TONES[tone] || SOURCE_TAG_TONES.muted
  return (
    <span style={{ fontSize:9.5, fontWeight:600, letterSpacing:'0.02em', padding:'2px 8px',
      borderRadius:10, background:c.bg, color:c.color, border:`1px solid ${c.border}`,
      whiteSpace:'nowrap', flexShrink:0, textTransform:'none' }}>
      {label}
    </span>
  )
}

// Pastel section card — wraps each profile section with icon + uppercase header + subtle bg
function SectionCard({ icon: Icon, title, bg, iconColor, children, headerExtra }) {
  return (
    <div style={{
      borderRadius: 12, background: bg || '#fafafa',
      border: '1px solid rgba(25,25,25,0.05)',
      marginBottom: 12, overflow: 'hidden',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 16px 10px', borderBottom:'1px solid rgba(25,25,25,0.05)' }}>
        {Icon && <Icon size={14} color={iconColor || '#6b7280'} strokeWidth={2} style={{ flexShrink:0 }} />}
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--text-caption,#6b7280)', flex:1 }}>{title}</span>
        {headerExtra}
      </div>
      <div style={{ padding:'12px 16px' }}>{children}</div>
    </div>
  )
}
// CSLINK-DATE-PICKER-DATA-RECOVERY: a CS-Link date input that surfaces a LEGACY non-ISO stored
// value (which <input type="date"> cannot display) as visible text instead of a silent blank.
// The picker stays cleanly empty for legacy values; selecting a real date saves it as ISO. Opening
// the profile never saves, and the legacy value is never auto-blanked (onChange only fires on a
// deliberate pick/clear).
function CsLinkDateField({ value, onChange }) {
  const legacy = isLegacyNonIsoDateValue(value)
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <input className="csw-date-input" type="date" placeholder="Date"
        value={dateInputValue(value)} onChange={onChange} />
      {legacy && (
        <span style={{ fontSize: 11, color: '#92400e', fontFamily: 'DM Sans, sans-serif' }}>
          Existing value: {value} — re-enter to update.
        </span>
      )}
    </span>
  )
}

function Field({ label, children, fieldKey }) {
  const savedField = useContext(FieldSavedCtx)
  const isSaved = fieldKey && savedField === fieldKey
  return (
    <div className="sp-field">
      <label className="sp-field-lbl" style={{ display:'flex', alignItems:'center' }}>
        {label}
        {isSaved && <SavedBadge />}
      </label>
      {children}
    </div>
  )
}

export default function StudentSidePanel({
  student, sortedStudents, onSelectStudent, onClose,
  onUpdate, onDelete, units, toast,
}) {
  const [data,             setData]             = useState({ ...student })
  const [saveStatus,       setSaveStatus]       = useState('idle')
  const [fieldSaved,       setFieldSaved]       = useState(null)  // tracks which field just saved
  const [showSSN,          setShowSSN]          = useState(false)
  const [confirmDelete,    setConfirmDelete]    = useState(false)
  const [showDeclineModal,     setShowDeclineModal]     = useState(false)
  const [declineReason,        setDeclineReason]        = useState('')
  const [showDispositionModal, setShowDispositionModal] = useState(false)
  const [summaryCopied,    setSummaryCopied]    = useState(false)
  const { canEdit, canInterview, userProfile } = useAuth()
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const [uploadingRes,  setUploadingRes]  = useState(false)
  const [uploadingHead, setUploadingHead] = useState(false)
  const [resumeMsg,     setResumeMsg]     = useState(null)
  const [headMsg,       setHeadMsg]       = useState(null)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const timerRef        = useRef(null)
  const pendingNameSave = useRef(null)
  const resumeRef       = useRef(null)
  const headshotRef     = useRef(null)

  const { data: preceptors = [] } = usePreceptors()
  const resolved = resolvePreceptor(data, preceptors)

  // ── Rotation Dates panel ─────────────────────────────────────────────────
  const [editingRotation,       setEditingRotation]       = useState(false)
  const [rotEditStart,          setRotEditStart]          = useState('')
  const [rotEditEnd,            setRotEditEnd]            = useState('')
  const [rotEditError,          setRotEditError]          = useState(null)
  const [rotSaving,             setRotSaving]             = useState(false)
  const [rotConfirmModal,       setRotConfirmModal]       = useState(null)
  // rotConfirmModal: { start, end, count } when open

  const { data: rotationRow, refetch: refetchRotation, isLoading: rotationLoading } = useQuery({
    queryKey: ['cohort_school_rotation', student.cohort_school_rotation_id],
    queryFn: async () => {
      if (!student.cohort_school_rotation_id) return null
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        // AVAILABILITY-CANON-1C: also load coordinator-owned availability for the Availability & Scheduling section.
        .select('id, school_name, rotation_start_date, rotation_end_date, coordinator_name, coordinator_email, unavailable_weekdays, min_days_per_week, weekends_allowed, nights_allowed, blackout_dates, scheduling_notes')
        .eq('id', student.cohort_school_rotation_id)
        .single()
      if (error) {
        console.warn('[StudentSidePanel] rotation fetch error:', error.message)
        throw error
      }
      return data
    },
    enabled: !!student.cohort_school_rotation_id,
    staleTime: 5 * 60_000,       // rotation dates change rarely; 5-min freshness is correct
    refetchOnWindowFocus: false,  // prevents tab-switch from greying the badge during refetch
    retry: 0,                     // fail fast; cohort-switch invalidation handles legitimate refresh
  })

  const handleOpenRotationEdit = async () => {
    if (!rotationRow) return
    setRotEditStart(rotationRow.rotation_start_date || '')
    setRotEditEnd(rotationRow.rotation_end_date || '')
    setRotEditError(null)
    setEditingRotation(true)
  }

  const handleSaveRotationDates = async () => {
    if (!rotEditStart || !rotEditEnd) {
      setRotEditError('Both dates are required.'); return
    }
    if (rotEditEnd <= rotEditStart) {
      setRotEditError('End date must be after start date.'); return
    }
    // Count affected students before showing confirmation
    const { count } = await supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('cohort_school_rotation_id', student.cohort_school_rotation_id)
    setRotConfirmModal({ start: rotEditStart, end: rotEditEnd, count: count ?? 0 })
  }

  const handleConfirmRotationSave = async () => {
    setRotSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/update-rotation-dates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          rotation_id:         student.cohort_school_rotation_id,
          rotation_start_date: rotConfirmModal.start,
          rotation_end_date:   rotConfirmModal.end,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast?.error('Update failed', data.error || 'Could not save rotation dates.')
        setRotSaving(false); setRotConfirmModal(null); return
      }
      refetchRotation()
      setEditingRotation(false); setRotConfirmModal(null)
      toast?.success('Rotation updated', `Dates updated for ${data.affected_student_count} student(s).`)
    } catch (e) {
      toast?.error('Update failed', e.message)
    }
    setRotSaving(false)
  }

  const fmtRotDate = (d) => {
    if (!d) return 'Not set'
    if (d === '1900-01-01') return 'Pending'
    const dt = new Date(d + 'T12:00:00Z')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
  }
  const isSentinel = rotationRow?.rotation_start_date === '1900-01-01'
  // STUDENT-PROFILE-CANON-1B: canonical Rotation Dates are "pending" when there is no linked
  // coordinator rotation row, or the linked row still holds the 1900-01-01 sentinel.
  const rotationPending = !rotationRow || isSentinel

  // STUDENT-PROFILE-CANON-1F: student-form provenance/completion signal. Conservative — a
  // received student form is signalled by submitted_via === 'student_form' (no new DB field).
  const studentFormReceived = (data.submitted_via || student.submitted_via) === 'student_form'
  const studentSourceTone   = studentFormReceived ? 'student' : 'pending'
  const studentSourceLabel  = studentFormReceived ? 'Source: Student form' : 'Awaiting student form'

  // ── Optimistic concurrency control ───────────────────────────────────────
  // Tracks the updated_at value the user had when they last loaded this student.
  // Sent with every save; API returns 409 if the row changed in the meantime.
  const [loadedUpdatedAt,  setLoadedUpdatedAt]  = useState(student.updated_at || null)
  // Pending conflict: { field, value } of the edit that hit the 409
  const [conflict,         setConflict]         = useState(null)
  // Set to true when a real-time update arrives from another user/tab
  const [remoteUpdateBanner, setRemoteUpdateBanner] = useState(false)

  const [dlHeadshotHeader, setDlHeadshotHeader] = useState(false)
  const [dlResume,         setDlResume]         = useState(false)
  const [dlPhotoDoc,       setDlPhotoDoc]       = useState(false)
  const [downloadErr,      setDownloadErr]      = useState(null)
  const [generatingBadge,  setGeneratingBadge]  = useState(false)

  const showDlError = () => {
    setDownloadErr('Download failed. The file may have been removed. Try re-uploading.')
    setTimeout(() => setDownloadErr(null), 4000)
  }
  const doDownload = async (url, filename, setter) => {
    setter(true)
    try {
      const ext = url.split('.').pop().split('?')[0] || 'bin'
      await downloadFile(url, `${filename}.${ext}`)
    } catch { showDlError() }
    setTimeout(() => setter(false), 1000)
  }

  // Reset data when student changes (prev/next navigation)
  useEffect(() => {
    setData({ ...student })
    setSaveStatus('idle')
    setLoadedUpdatedAt(student.updated_at || null)
    setConflict(null)
    setRemoteUpdateBanner(false)
  }, [student.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [editingInterest, setEditingInterest] = useState(false)
  const [interestDraft,   setInterestDraft]   = useState(student?.interest_statement || '')
  useEffect(() => {
    setInterestDraft(student?.interest_statement || '')
    setEditingInterest(false)
    setSummaryCopied(false)
  }, [student?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time subscription: student row ──────────────────────────────────
  // When another user (or another tab) saves this student's record, show a
  // non-intrusive banner.  We never auto-apply the remote change over an
  // active edit — the user decides when to reload.
  useEffect(() => {
    if (!student.id) return
    const channel = supabase
      .channel(`student_profile_${student.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'students', filter: `id=eq.${student.id}` },
        (payload) => {
          if (saveStatus === 'idle') {
            // No pending edit — silently absorb the remote data
            setData(d => ({ ...d, ...payload.new }))
            setLoadedUpdatedAt(payload.new.updated_at || null)
          } else {
            // User is mid-edit — show a gentle banner
            setRemoteUpdateBanner(true)
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [student.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopySummary = async () => {
    const unitNameForSummary = matchedUnitName !== '—' ? matchedUnitName : null
    const summary = generateStudentSummary(student, unitNameForSummary, student.aspire_cohort)
    await navigator.clipboard.writeText(summary)
    setSummaryCopied(true)
    toast?.success('Summary copied', 'Student summary is ready to paste.')
    setTimeout(() => setSummaryCopied(false), 2500)
  }

  const [adjustingId,  setAdjustingId]  = useState(null)
  const [adjustHours,  setAdjustHours]  = useState('')
  const [adminNote,    setAdminNote]    = useState('')
  const adminNoteTimer = useRef(null)

  const { markSynced: markHoursSynced, display: hoursSyncDisplay } = useLastSynced()

  // Shift logs — cached per student
  const { data: shiftLogs = [] } = useQuery({
    queryKey: ['student_shift_logs', student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_shift_logs')
        .select('*').eq('student_id', student.id)
        .order('shift_date', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!student.id,
  })
  // Mark synced when shift log data loads
  useEffect(() => { markHoursSynced() }, [shiftLogs]) // eslint-disable-line

  // WS1e-A4: earned-hour aggregate mutation is prohibited (approved/pending hours are
  // derived from submitted shift logs). The per-shift approve/reject/adjust controls
  // are disabled in the UI; these handlers are retained but no longer mutate aggregates.
  const handleApproveShift = async (_log) => { /* disabled — see WS1e-A4 */ }
  const handleRejectShift = async (_log) => { /* disabled — see WS1e-A4 */ }
  const handleAdjustShift = async (_log) => { /* disabled — see WS1e-A4 */ }

  // Communications — cached per student
  const { data: studentComms = [] } = useQuery({
    queryKey: ['student_communications', student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('communications')
        .select('*').eq('student_id', student.id)
        .order('sent_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!student.id,
  })

  // Recent communications (Phase D.2) — notification_log, ALL-TIME, latest 5.
  // Reads notification_log (the Sent History source) by top-level student_id, so
  // it stays consistent with Outreach → Sent History. Not date-limited, so older
  // communications are never hidden.
  const { data: recentComms = [] } = useQuery({
    queryKey: ['student_recent_comms', student.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_log')
        .select('id, notification_type, subject, status, sent_at')
        .eq('student_id', student.id)
        .order('sent_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data || []
    },
    enabled: !!student.id,
  })

  // Program events — cached per student
  const { data: studentEvents = [] } = useQuery({
    queryKey: ['student_program_events', student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('program_events')
        .select('*').eq('student_id', student.id)
        .order('event_date', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!student.id,
  })

  // Active disposition — reads from student_active_disposition view (Pattern A RLS: all authenticated)
  const { data: activeDisposition, refetch: refetchDisposition } = useQuery({
    queryKey: ['student_active_disposition', student.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_active_disposition')
        .select('*')
        .eq('student_id', student.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!student.id,
  })

  // Follow-ups for the active disposition — only fetched when a disposition exists
  const { data: dispositionFollowups = [], refetch: refetchFollowups } = useQuery({
    queryKey: ['student_disposition_followups', activeDisposition?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_disposition_followups')
        .select('*')
        .eq('disposition_id', activeDisposition.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!activeDisposition?.id && canEdit,
  })

  // Private internal note for the active disposition (Phase 2B.2f).
  // student_disposition_private_notes is Owner/Admin RLS — unauthorized users get
  // null, so the Internal Note section simply does not render for them.
  const { data: privateNote, refetch: refetchPrivateNote } = useQuery({
    queryKey: ['disposition_private_note', activeDisposition?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_disposition_private_notes')
        .select('internal_note, created_by_name, created_at, updated_at')
        .eq('disposition_id', activeDisposition.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!activeDisposition?.id && canEdit,
  })

  const handleUpdateDisposition = () => setShowDispositionModal(true)

  const handleDispositionSuccess = () => {
    setShowDispositionModal(false)
    setData(p => ({ ...p, status: 'Not Proceeding' }))
    onUpdate(student.id, { status: 'Not Proceeding' })
    refetchDisposition()
    refetchPrivateNote()
  }

  // STUDENT-PROFILE-CANON-1E: clear (inactivate) the active disposition without hard delete.
  // Clearing NEVER changes student.status / interview_outcome / ngrp_outcome — if the admin
  // wants to change status they do it separately. History is preserved; an audit event is logged.
  const [showClearModal, setShowClearModal] = useState(false)
  const [clearReason,    setClearReason]    = useState('')
  const [clearing,       setClearing]       = useState(false)
  const [clearError,     setClearError]     = useState(null)

  const handleOpenClearDisposition = () => {
    setClearReason('')
    setClearError(null)
    setShowClearModal(true)
  }

  const handleConfirmClearDisposition = async () => {
    setClearing(true)
    setClearError(null)
    try {
      const { data: result, error } = await supabase.rpc('clear_student_disposition', {
        p_student_id: student.id,
        p_reason:     clearReason.trim() || null,
      })
      if (error) { setClearError(error.message || 'Could not clear disposition.'); setClearing(false); return }
      if (result && result.cleared === false) {
        toast?.info('No active disposition', 'There was no active disposition to clear.')
      } else {
        toast?.success('Disposition cleared', 'The active disposition was cleared. Student status was not changed.')
      }
      await refetchDisposition()
      // Refresh any list/other surfaces reading the active-disposition view.
      queryClient.invalidateQueries({ queryKey: ['student_active_disposition'] })
      setShowClearModal(false)
    } catch (e) {
      setClearError(e.message || 'Could not clear disposition.')
    }
    setClearing(false)
  }

  // Follow-up completion inline state
  const [completingFollowupId, setCompletingFollowupId] = useState(null)
  const [completionNote,       setCompletionNote]       = useState('')
  const [completionMethod,     setCompletionMethod]     = useState('')
  const [completingFollowup,   setCompletingFollowup]   = useState(false)

  const handleCompleteFollowup = async (followupId) => {
    setCompletingFollowup(true)
    const { error } = await supabase.rpc('complete_disposition_followup', {
      p_followup_id:       followupId,
      p_completion_method: completionMethod || null,
      p_note:              completionNote.trim() || null,
    })
    setCompletingFollowup(false)
    if (error) {
      toast?.error('Update failed', error.message || 'Could not mark follow-up complete.')
      return
    }
    setCompletingFollowupId(null)
    setCompletionNote('')
    setCompletionMethod('')
    toast?.success('Follow-up complete', 'Follow-up marked as complete.')
    refetchFollowups()
  }

  const [showEventForm,   setShowEventForm]   = useState(false)
  const [savingEvent,     setSavingEvent]     = useState(false)
  const [newEvent, setNewEvent] = useState({ event_type: 'note', event_date: '', event_time: '', notes: '' })

  const handleAddEvent = async () => {
    if (!newEvent.event_date) return
    setSavingEvent(true)
    const { data } = await safeWrite(
      () => supabase.from('program_events').insert({
        student_id:  student.id,
        cohort_id:   student.cohort_id,
        event_type:  newEvent.event_type,
        event_date:  newEvent.event_date,
        event_time:  newEvent.event_time || null,
        notes:       newEvent.notes,
        created_by:  'coordinator',
      }).select().single(),
      { name: 'add program event' }
    )
    if (data) {
      queryClient.setQueryData(['student_program_events', student.id], (prev = []) => [data, ...prev])
    }
    setNewEvent({ event_type: 'note', event_date: '', event_time: '', notes: '' })
    setShowEventForm(false)
    setSavingEvent(false)
  }

  const handleDeleteEvent = async (id) => {
    await safeWrite(
      () => supabase.from('program_events').delete().eq('id', id),
      { name: 'delete program event' }
    )
    queryClient.setQueryData(['student_program_events', student.id], (prev = []) =>
      prev.filter(e => e.id !== id))
  }

  const currentIndex = sortedStudents.findIndex(s => s.id === student.id)
  const prevStudent  = currentIndex > 0 ? sortedStudents[currentIndex - 1] : null
  const nextStudent  = currentIndex < sortedStudents.length - 1 ? sortedStudents[currentIndex + 1] : null

  // doSave — OCC-protected field save.
  // Passes loadedUpdatedAt so the API can detect concurrent edits.
  // On HTTP 409 (conflict): shows ConflictDialog instead of silently overwriting.
  const doSave = useCallback(async (field, value) => {
    setSaveStatus('saving')
    // WS1e-A2: preceptor/shift assignment is migrated off the generic update to the
    // explicit placement action (no OCC guard on that narrow operation).
    // WS1e-A3b: manual interview_outcome override goes through its explicit action.
    if (field === 'interview_outcome') {
      try {
        await updateInterviewOutcome(student.id, value)
        setSaveStatus('saved')
        const { data: fresh } = await supabase.from('students').select('updated_at').eq('id', student.id).single()
        if (fresh?.updated_at) setLoadedUpdatedAt(fresh.updated_at)
        setTimeout(() => setSaveStatus('idle'), 1800)
        setFieldSaved(field)
        setTimeout(() => setFieldSaved(prev => prev === field ? null : prev), 1800)
      } catch (e) {
        setSaveStatus('error')
        toast?.error('Save failed', 'Unable to save changes. Please try again.')
      }
      return
    }
    if (field === 'matched_preceptor' || field === 'shift_assigned') {
      try {
        await updatePreceptorAssignment(student.id, { [field]: value })
        setSaveStatus('saved')
        const { data: fresh } = await supabase.from('students').select('updated_at').eq('id', student.id).single()
        if (fresh?.updated_at) setLoadedUpdatedAt(fresh.updated_at)
        setTimeout(() => setSaveStatus('idle'), 1800)
        setFieldSaved(field)
        setTimeout(() => setFieldSaved(prev => prev === field ? null : prev), 1800)
      } catch (e) {
        setSaveStatus('error')
        toast?.error('Save failed', 'Unable to save changes. Please try again.')
      }
      return
    }
    const err = await onUpdate(student.id, { [field]: value }, loadedUpdatedAt)
    if (err?.conflict) {
      setSaveStatus('idle')
      setConflict({ field, value })
      return
    }
    setSaveStatus(err ? 'error' : 'saved')
    if (!err) {
      // Refresh loadedUpdatedAt from DB so the next save has the correct baseline
      const { data: fresh } = await supabase.from('students').select('updated_at').eq('id', student.id).single()
      if (fresh?.updated_at) setLoadedUpdatedAt(fresh.updated_at)
      setTimeout(() => setSaveStatus('idle'), 1800)
      setFieldSaved(field)
      setTimeout(() => setFieldSaved(prev => prev === field ? null : prev), 1800)
    }
    if (err) toast?.error('Save failed', 'Unable to save changes. Please try again.')
  }, [student.id, onUpdate, toast, loadedUpdatedAt])

  const handleText = (field, value) => {
    setData(p => ({ ...p, [field]: value }))
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 800)
  }
  const handleNameField = (field, value) => {
    setData(prev => {
      const updated = { ...prev, [field]: value }
      updated.name = `${updated.first_name||''} ${updated.last_name||''}`.trim() // local display only
      // WS1e-A4 (corr.2): persist only first/last; server composes the authoritative name.
      pendingNameSave.current = { first_name: updated.first_name||'', last_name: updated.last_name||'' }
      return updated
    })
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    // Capture loadedUpdatedAt at scheduling time so the timer closure uses the
    // value that was current when the user finished typing.
    const snapUpdatedAt = loadedUpdatedAt
    timerRef.current = setTimeout(async () => {
      if (pendingNameSave.current) {
        const err = await onUpdate(student.id, pendingNameSave.current, snapUpdatedAt)
        if (err?.conflict) {
          setSaveStatus('idle')
          setConflict({ field: 'name', value: pendingNameSave.current })
          pendingNameSave.current = null
          return
        }
        setSaveStatus(err ? 'error' : 'saved')
        if (!err) {
          const { data: fresh } = await supabase.from('students').select('updated_at').eq('id', student.id).single()
          if (fresh?.updated_at) setLoadedUpdatedAt(fresh.updated_at)
          setTimeout(() => setSaveStatus('idle'), 1800)
          setFieldSaved(field)
          setTimeout(() => setFieldSaved(prev => prev === field ? null : prev), 1800)
        }
        pendingNameSave.current = null
      }
    }, 800)
  }
  const handleSelect = (field, value) => { setData(p => ({ ...p, [field]: value })); doSave(field, value) }
  const handleCheck  = (field, value) => { setData(p => ({ ...p, [field]: value })); doSave(field, value) }
  const handleDecimal = (field, raw) => {
    const value = raw === '' ? null : parseFloat(raw)
    setData(p => ({ ...p, [field]: value }))
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 800)
  }

  const handleDownloadBadge = async () => {
    setGeneratingBadge(true)
    try {
      const { frontBlob, backBlob } = await generateBadgePNGs({
        student:     data,
        rotation:    rotationRow ?? null,
        headshotUrl: data.headshot_url,
      })
      const lastName  = (data.last_name  || '').replace(/\s+/g, '_')
      const firstName = (data.first_name || '').replace(/\s+/g, '_')
      const base = `${lastName}_${firstName}_ASPIRE_Badge`
      const triggerDownload = (blob, filename) => {
        const url = URL.createObjectURL(blob)
        const a   = document.createElement('a')
        a.href     = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      }
      triggerDownload(frontBlob, `${base}_Front.png`)
      await new Promise(r => setTimeout(r, 800))
      triggerDownload(backBlob, `${base}_Back.png`)
      toast?.success('Badge downloaded', 'Front and back badge files saved.')
    } catch (err) {
      toast?.error('Badge generation failed', err.message)
    }
    setGeneratingBadge(false)
  }

  // Compute badge button disabled reason (shown as tooltip)
  const badgeDates         = rotationRow ? calculateBadgeDates(rotationRow) : null
  const badgeDisabledReason = !student.headshot_url
    ? 'Headshot required'
    : rotationLoading
    ? null                        // in-flight: don't show false "Rotation dates pending"
    : !rotationRow || !badgeDates
    ? 'Rotation dates pending'
    : null

  const handleResumeUpload = async file => {
    if (!file || file.size > 10*1024*1024) { setResumeMsg('File too large (max 10 MB)'); return }
    if (!student.id || !student.cohort_id) {
      console.error('Missing student id or cohort_id for resume upload', { id: student.id, cohort_id: student.cohort_id })
      setResumeMsg('Upload failed: student record not found')
      return
    }
    setUploadingRes(true)
    setResumeMsg(null)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/resume.${ext}`
    const { error } = await supabase.storage
      .from('student-files')
      .upload(path, file, { cacheControl: '3600', upsert: true })
    if (error) {
      console.error('Resume upload error:', error)
      setUploadingRes(false)
      setResumeMsg(`Upload failed: ${error.message}`)
      return
    }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setData(p => ({ ...p, resume_url: url }))
    onUpdate(student.id, { resume_url: url })
    setUploadingRes(false)
    setResumeMsg('success')
    setTimeout(() => setResumeMsg(null), 3000)
    if (resumeRef.current) resumeRef.current.value = ''
  }

  const handleHeadshotUpload = async file => {
    if (!file || file.size > 5*1024*1024) { setHeadMsg('File too large (max 5 MB)'); return }
    if (!student.id || !student.cohort_id) {
      console.error('Missing student id or cohort_id for headshot upload', { id: student.id, cohort_id: student.cohort_id })
      setHeadMsg('Upload failed: student record not found')
      return
    }
    setUploadingHead(true)
    setHeadMsg(null)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/headshot.${ext}`
    const { error } = await supabase.storage
      .from('student-files')
      .upload(path, file, { cacheControl: '3600', upsert: true })
    if (error) {
      console.error('Headshot upload error:', error)
      setUploadingHead(false)
      setHeadMsg(`Upload failed: ${error.message}`)
      return
    }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    // Cache-bust so browser doesn't serve the old cached image
    setData(p => ({ ...p, headshot_url: `${url}?t=${Date.now()}` }))
    onUpdate(student.id, { headshot_url: url })
    setUploadingHead(false)
    setHeadMsg('success')
    setTimeout(() => setHeadMsg(null), 3000)
    if (headshotRef.current) headshotRef.current.value = ''
  }

  const participatingUnits = units.filter(u => u.is_participating).map(u => u.unit_name)
  const matchedUnitName    = data.matched_unit_id && units.length > 0
    ? (units.find(u => u.id === data.matched_unit_id)?.unit_name || '—') : '—'

  const csStatus    = getCsLinkStatus(data)
  const csStatusCfg = CS_LINK_STATUS_CONFIG[csStatus]

  // ── Conflict resolution handlers ─────────────────────────────────────────

  const handleConflictDiscard = async () => {
    const { data: fresh } = await supabase.from('students').select('*').eq('id', student.id).single()
    if (fresh) { setData(fresh); setLoadedUpdatedAt(fresh.updated_at || null) }
    setConflict(null)
    setSaveStatus('idle')
    toast?.info('Changes discarded', 'Profile reloaded with the latest data.')
  }

  const handleConflictForce = async () => {
    if (!conflict) return
    // Force save without the updated_at guard (no loadedUpdatedAt passed)
    const updates = conflict.field === 'name'
      ? conflict.value
      : { [conflict.field]: conflict.value }
    const err = await onUpdate(student.id, updates)
    await logEvent(supabase, {
      studentId: student.id, cohortId: student.cohort_id,
      eventType: 'conflict_override',
      notes: `Field '${conflict.field}' force-saved by ${userProfile?.full_name || 'unknown'} over a concurrent edit.`,
      auto: true,
    })
    if (!err) {
      const { data: fresh } = await supabase.from('students').select('updated_at').eq('id', student.id).single()
      if (fresh?.updated_at) setLoadedUpdatedAt(fresh.updated_at)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1800)
      toast?.success('Force saved', 'Your changes were saved and the conflict was logged.')
    }
    setConflict(null)
  }

  const handleConflictContinue = () => setConflict(null)

  const confirmDecline = async () => {
    const updates = { status: 'Declined', decline_reason: declineReason }
    setData(p => ({ ...p, ...updates }))
    setSaveStatus('saving')
    const err = await onUpdate(student.id, updates)
    setSaveStatus(err ? 'error' : 'saved')
    if (!err) setTimeout(() => setSaveStatus('idle'), 1800)
    setShowDeclineModal(false)
    setDeclineReason('')
    toast?.info('Student declined', `${student.first_name} has been marked as declined.`)
  }

  return (
    <>
      {/* OCC conflict dialog — rendered above everything else */}
      {conflict && (
        <ConflictDialog
          studentName={`${data.first_name || ''} ${data.last_name || ''}`.trim()}
          fieldName={conflict.field}
          onDiscard={handleConflictDiscard}
          onForce={handleConflictForce}
          onContinue={handleConflictContinue}
        />
      )}

      <div className="sp-container" style={{ position:'relative' }}>
        {/* Scrollable content */}
        <FieldSavedCtx.Provider value={fieldSaved}>
        <div className="sp-content">

          {/* Remote-update banner — shown when another user saved while this user is editing */}
          {remoteUpdateBanner && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 8, padding: '8px 14px', margin: '0 0 12px',
              fontFamily: 'DM Sans, sans-serif', fontSize: 12,
            }}>
              <span style={{ color: '#92400e', fontWeight: 600 }}>
                ⚠ This record was just updated by another user.
              </span>
              <button
                onClick={handleConflictDiscard}
                style={{
                  marginLeft: 12, fontSize: 11, fontWeight: 700, color: '#1D2567',
                  background: 'none', border: '1px solid #1D2567', borderRadius: 6,
                  padding: '3px 10px', cursor: 'pointer',
                }}
              >
                Reload
              </button>
            </div>
          )}

          {/* ── Compact hero card ── */}
          {(() => {
            const completion = calculateProfileCompletion(data)
            const compColors = getCompletionColor(completion.status)

            // Next recommended action
            const nextAction = (() => {
              if (!data.cs_cedars_status && !data.cs_link_complete)
                return 'Complete CS-Link account activation'
              if (['Pending Outreach', 'Form Sent'].includes(data.status))
                return 'Send intake form to student'
              if (data.status === 'Form Received')
                return 'Schedule interview'
              if (data.status === 'Interview Scheduled')
                return 'Conduct interview'
              if (data.status === 'Interviewed' && !data.matched_unit_id)
                return 'Match to a unit'
              if (data.matched_unit_id && data.status === 'Placed')
                return 'Confirm rotation start date'
              if (completion.percentage === 100)
                return null // complete
              return null
            })()

            const interviewLabel = (() => {
              if (['Interviewed', 'Placed', 'Active Rotation', 'Completed'].includes(data.status)) return 'Completed'
              if (data.status === 'Interview Scheduled') return 'Scheduled'
              return 'Not scheduled'
            })()

            const matchedUnitInDrawer = data.matched_unit_id
              ? (typeof units?.find === 'function' ? units.find(u => u.id === data.matched_unit_id)?.unit_name : null) || '(loading)'
              : null

            return (
              <>
                {/* ── Hero — fills the top of the drawer card; gradient flows into rounded corners ── */}
                <div style={{
                  margin:0, borderRadius:'16px 16px 0 0',
                  background:'linear-gradient(160deg, #dceff8 0%, #f0f6fb 50%, #ffffff 100%)',
                  padding:'28px 24px 20px',
                  textAlign:'center', position:'relative' }}>
                  {/* Large photo */}
                  <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
                    <StudentAvatar student={data} size={96}
                      style={{ border:'4px solid var(--pearl)', boxShadow:'0 4px 18px rgba(29,37,103,0.16)', fontSize:'34px' }} />
                  </div>
                  {/* Name — legal display, surfacing the preferred first name as First “Preferred” Last. */}
                  <div style={{ fontSize:22, fontWeight:700, color:'var(--nightfall)', marginBottom:4, lineHeight:1.2 }}>
                    {getStudentLegalDisplayName(data)}
                  </div>
                  {/* School · Program */}
                  <div style={{ fontSize:13, color:'#6b7280', marginBottom:8 }}>
                    {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
                  </div>
                  {/* ASPIRE status pill — precise disposition for Not Proceeding */}
                  {data.status && (() => {
                    const heroPillDispType = data.status === 'Not Proceeding' ? activeDisposition?.disposition_type : null
                    if (heroPillDispType) {
                      const c = DISPOSITION_PILL_COLORS[heroPillDispType] || DISPOSITION_PILL_COLORS['not_selected']
                      return <div style={{ marginBottom:12 }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                          background:c.bg, color:c.text, border:`1px solid ${c.border}` }}>
                          {DISPOSITION_TYPES[heroPillDispType] || data.status}
                        </span>
                      </div>
                    }
                    const cfg = ASPIRE_STATUS_CONFIG[data.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']
                    return <div style={{ marginBottom:12 }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                        background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}` }}>
                        {data.status}
                      </span>
                    </div>
                  })()}
                  {/* Contact actions */}
                  <div style={{ display:'flex', justifyContent:'center', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                    <ProfileActionButton
                      variant="primary"
                      icon="✉"
                      label="Email"
                      onClick={() => navigate(
                        `/connect/outreach?mode=message&recipientType=student&recipientId=${data.id}`,
                        { state: { fromStudent: {
                            id:    data.id,
                            name:  `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                            email: data.personal_email || data.school_email || null,
                            school: data.school || null,
                          }
                        }}
                      )}
                      disabled={!data.personal_email && !data.school_email}
                      disabledReason="No email on file"
                    />
                    <ProfileActionButton
                      variant="secondary"
                      icon="📞"
                      label="Call"
                      href={data.phone ? `tel:${data.phone}` : undefined}
                      disabled={!data.phone}
                      disabledReason="No phone on file"
                    />
                    {canEdit && (
                      <ProfileActionButton
                        variant="secondary"
                        icon="✏"
                        label="Edit"
                        onClick={() => {
                          const inp = document.querySelector('.sp-content .sp-input')
                          if (inp) { inp.scrollIntoView({ behavior:'smooth', block:'center' }); inp.focus() }
                        }}
                      />
                    )}
                  </div>
                  {canEdit && <button onClick={handleCopySummary}
                    style={{
                      display:'flex', alignItems:'center', gap:'6px',
                      padding:'6px 14px', borderRadius:'8px',
                      border:`1px solid ${summaryCopied ? '#86efac' : '#e5e7eb'}`,
                      background: summaryCopied ? '#f0fdf4' : '#f9fafb',
                      fontFamily:'DM Sans,sans-serif', fontWeight:600, fontSize:'12px',
                      color: summaryCopied ? '#166534' : '#374151',
                      cursor:'pointer', transition:'all 0.2s ease',
                      width:'100%', justifyContent:'center',
                    }}>
                    {summaryCopied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Student Summary</>}
                  </button>}
                </div>

                {/* ── Status snapshot — 5 chips (no ASPIRE status; hero pill carries it) ── */}
                <div style={{ margin:'22px 18px 0', display:'flex', flexWrap:'wrap', gap:6 }}>
                  {(() => {
                    const gpaVal = parseFloat(data.cumulative_gpa)
                    const gpaOk  = !isNaN(gpaVal) && gpaVal > 0
                    const csAcc  = CS_LINK_STATUS_CONFIG[getCsLinkStatus(data)]

                    // Interview chip: show actual date if available, else status text
                    const ivChip = (() => {
                      const isComplete = ['Interviewed','Placed','Active Rotation','Completed'].includes(data.status)
                      const isScheduled = data.status === 'Interview Scheduled'
                      if (isComplete) {
                        const dateStr = data.interview_scheduled_date
                          ? new Date(data.interview_scheduled_date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
                          : null
                        return { label:`Interview: ${dateStr||'Completed'}`, bg:'#dcfce7', color:'#166534' }
                      }
                      if (isScheduled) {
                        const dateStr = data.interview_scheduled_date
                          ? new Date(data.interview_scheduled_date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
                          : null
                        return { label:`Interview: ${dateStr||'Scheduled'}`, bg:'#dbeafe', color:'#1d4ed8' }
                      }
                      return { label:'Interview: Not Scheduled', bg:'#f3f4f6', color:'#6b7280' }
                    })()

                    // Placement chip: unit name + match quality
                    const plChip = (() => {
                      if (!matchedUnitInDrawer) return { label:'Not placed', bg:'#f3f4f6', color:'#6b7280' }
                      const uname = matchedUnitInDrawer
                      const q = data.unit_preference_1 === uname ? '1st'
                        : data.unit_preference_2 === uname ? '2nd'
                        : data.unit_preference_3 === uname ? '3rd' : null
                      const qLabel = q ? ` (${q} choice)` : ''
                      return { label:`${uname}${qLabel}`, bg:'#dcfce7', color:'#166534' }
                    })()

                    const chips = [
                      gpaOk ? { label:`GPA ${gpaVal.toFixed(2)}`, bg:gpaVal>=3.5?'#dcfce7':'#f3f4f6', color:gpaVal>=3.5?'#166534':'#6b7280' } : null,
                      ivChip,
                      plChip,
                      { label:csAcc?.label||'CS-Link Unknown', bg:csAcc?.bg||'#f3f4f6', color:csAcc?.text||'#6b7280' },
                      data.hours_required>0 ? { label:`${data.hours_completed||0}/${data.hours_required} hrs`, bg:'#f0f6fa', color:'#1e3a5f' } : null,
                    ].filter(Boolean)

                    return chips.map((c,i) => (
                      <span key={i} style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:12, whiteSpace:'nowrap', background:c.bg, color:c.color, border:c.border?`1px solid ${c.border}`:'1px solid rgba(25,25,25,0.05)' }}>
                        {c.label}
                      </span>
                    ))
                  })()}
                </div>

                {/* ── Profile Completion block ── */}
                {(() => {
                  const pct = completion.percentage
                  const barClr = pct >= 100 ? '#16a34a' : pct >= 67 ? '#f59e0b' : '#E2569C'
                  const blockBg = pct >= 100 ? 'rgba(22,163,74,0.06)' : pct >= 67 ? 'rgba(245,158,11,0.08)' : 'rgba(226,86,156,0.06)'
                  return (
                    <div style={{ margin:'18px 18px 0', padding:'12px 14px', background:blockBg, border:`1px solid ${barClr}33`, borderRadius:10 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:7 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:barClr }}>Profile Completion</span>
                        <span style={{ fontSize:13, fontWeight:800, color:barClr }}>{pct}%</span>
                      </div>
                      <div style={{ height:5, borderRadius:3, background:'rgba(0,0,0,0.10)', marginBottom:9 }}>
                        <div style={{ width:`${pct}%`, height:'100%', borderRadius:3, background:barClr, transition:'width 0.3s ease' }} />
                      </div>
                      {/* STUDENT-PROFILE-CANON-1F: student-form completion indicator (conservative). */}
                      <div style={{ marginBottom:8 }}>
                        {(() => {
                          const chip = studentFormReceived
                            ? { label: 'Student form received', tone: 'student' }
                            : (pct > 0
                                ? { label: 'Profile partially complete', tone: 'pending' }
                                : { label: 'Student form pending', tone: 'muted' })
                          return <SourceTag label={chip.label} tone={chip.tone} />
                        })()}
                      </div>
                      {completion.missing.length > 0 && (
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:10.5, fontWeight:600, color:'var(--text-muted,#6b7280)', marginBottom:4 }}>Missing</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                            {completion.missing.map(m => (
                              <span key={m} style={{ fontSize:10, padding:'1px 7px', borderRadius:10, background:'rgba(0,0,0,0.06)', color:'var(--text-muted,#6b7280)', fontWeight:600 }}>{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {pct === 100
                        ? <div style={{ fontSize:11, fontWeight:600, color:'#166534' }}>✓ Ready to proceed</div>
                        : nextAction && <div style={{ fontSize:11, color:'var(--text-caption,#475467)', fontStyle:'italic' }}>Next: {nextAction}</div>
                      }
                    </div>
                  )
                })()}
              </>
            )
          })()}

          {/* ── Unified section container with pastel section cards ── */}
          <div style={{ margin:'22px 14px 0', background:'var(--bg-card,#fff)', borderRadius:14, padding:'12px 12px 4px', boxShadow:'0 1px 4px rgba(29,37,103,0.05)' }}>

          {/* 1. Contact Information */}
          <div className="sp-section sp-card sp-zone-contact">
            <SectionHeader title="Contact Information" icon={<Mail size={13} />} />
            <Field label="School Email">
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <div className="sp-readonly">{data.school_email || '—'}</div>
                {data.school_email && (
                  <Tooltip label="Copy email" placement="top"><button className="sp-copy-btn" aria-label="Copy email" onClick={() => navigator.clipboard?.writeText(data.school_email)}>⎘</button></Tooltip>
                )}
              </div>
            </Field>
            {data.status === 'Form Received' && data.school_email && (
              <div style={{ marginTop:8 }}>
                <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px' }}
                  onClick={() => {
                    const subject = 'Schedule Your ASPIRE Interview'
                    const body = `Dear ${data.first_name || 'ASPIRE Student'},\n\nThank you for completing your ASPIRE Student Profile. The next step in the process is to schedule your interview with the Nursing Professional Development team.\n\nPlease use the link below to view available times and select one that works for your schedule:\n\nhttps://aspire-tracker.vercel.app/interview-schedule\n\nWhen prompted, enter your school email address to access your scheduling page.\n\nYour interview will be conducted via Microsoft Teams. The meeting link will be sent to you separately after you book your slot.\n\nIf you have any questions, please don't hesitate to reach out.\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nBrawerman Nursing Institute | Cedars-Sinai Medical Center\nJesterLloyd.Bautista@cshs.org | 310-248-8964`
                    openOutlookCompose({ to: data.school_email, subject, body })
                  }}>
                  ✉ Send Scheduling Link
                </button>
              </div>
            )}
            <Field label="Personal Email" fieldKey="personal_email">
              <input className="sp-input" value={data.personal_email||''} onChange={e => handleText('personal_email', e.target.value)} />
            </Field>
            <Field label="Phone" fieldKey="phone">
              <input className="sp-input" value={data.phone||''} onChange={e => handleText('phone', e.target.value)} />
            </Field>
          </div>

          {/* 2. Personal Information */}
          <div className="sp-section sp-card sp-zone-contact">
            <SectionHeader title="Personal Information" icon={<User size={13} />} />
            <div className="sp-grid-2">
              <Field label="First Name" fieldKey="first_name">
                <input className="sp-input" value={data.first_name||''} onChange={e => handleNameField('first_name', e.target.value)} />
              </Field>
              <Field label="Last Name" fieldKey="last_name">
                <input className="sp-input" value={data.last_name||''} onChange={e => handleNameField('last_name', e.target.value)} />
              </Field>
              {/* STUDENT-PREFERRED-FIRST-NAME-1A: optional preferred FIRST name. Uses the generic
                  text-save path (NOT handleNameField) — it is independent of the composed legal name. */}
              <Field label={<>Preferred First Name <SourceTag label={studentSourceLabel} tone={studentSourceTone} /></>} fieldKey="preferred_first_name">
                <input className="sp-input" value={data.preferred_first_name||''} placeholder="Optional (e.g. Emi)"
                  onChange={e => handleText('preferred_first_name', e.target.value)} />
              </Field>
              <Field label="Date of Birth" fieldKey="date_of_birth">
                <input className="sp-input" type="date" value={data.date_of_birth||''} onChange={e => handleText('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Last 4 SSN">
                <div style={{ display:'flex', gap:6 }}>
                  {/* WS1e-A4: ssn_last4 is read-only (no longer staff-editable; set at intake). */}
                  <input className="sp-input" type={showSSN ? 'text' : 'password'} maxLength={4}
                    value={data.ssn_last4||''} readOnly title="Read-only — set during student intake." />
                  <button className="btn-clear" style={{ fontSize:11, padding:'4px 8px' }} onClick={() => setShowSSN(p => !p)}>
                    {showSSN ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>
              <Field label="Gender" fieldKey="gender">
                <select className="sp-select" value={data.gender||''} onChange={e => handleSelect('gender', e.target.value)}>
                  <option value="">Select…</option>
                  {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label="Cumulative GPA" fieldKey="cumulative_gpa">
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input className="sp-input" type="text" inputMode="decimal" pattern="[0-9.]*"
                    style={{ maxWidth:80 }} value={data.cumulative_gpa??''} placeholder="0.00"
                    onChange={e => handleDecimal('cumulative_gpa', e.target.value)} />
                  {data.cumulative_gpa != null && (
                    <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
                      {parseFloat(data.cumulative_gpa).toFixed(2)} / 4.0
                    </span>
                  )}
                </div>
              </Field>
              <Field label="Shift Preference">
                <select className="sp-select" value={data.shift_availability||''} onChange={e => handleSelect('shift_availability', e.target.value)}>
                  <option value="">Select…</option>
                  {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Information Acknowledgment (read-only) — STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT.
              Captured at /student-form submit; server-set version + timestamp. Display only. */}
          <div className="sp-section sp-card sp-zone-contact">
            <SectionHeader title="Information Acknowledgment" icon={<CheckCircle2 size={13} />} />
            {data.student_form_privacy_ack_at ? (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  ['Acknowledged on', new Date(data.student_form_privacy_ack_at).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' })],
                  ['Typed name', data.student_form_privacy_ack_name || '—'],
                  ['Version', data.student_form_privacy_ack_version || '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display:'flex', gap:10, fontSize:13 }}>
                    <span style={{ color:'var(--text-muted,#9ca3af)', minWidth:120, flexShrink:0 }}>{k}</span>
                    <span style={{ color:'var(--text-primary,#191919)' }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize:13, color:'var(--text-muted,#9ca3af)', fontStyle:'italic' }}>Not on file</div>
            )}
          </div>

          {/* 3. Program Details */}
          <div className="sp-section sp-card sp-zone-program">
            <SectionHeader title="Program Details" icon={<GraduationCap size={13} />} />
            <div className="sp-grid-2">
              <Field label="School"><div className="sp-readonly">{data.school||'—'}</div></Field>
              <Field label="Program Type" fieldKey="program_type">
                <select className="sp-select" value={data.program_type||''} onChange={e => handleSelect('program_type', e.target.value)}>
                  <option value="">Select…</option>
                  {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  {data.program_type && !PROGRAM_TYPES.includes(data.program_type) && (
                    <option value={data.program_type}>{data.program_type}</option>
                  )}
                </select>
              </Field>
              {/* STUDENT-PROFILE-CANON-1B: legacy students.term_dates is intentionally NOT shown in the
                  profile — the canonical placement window is the coordinator-owned "Rotation Dates"
                  section below (cohort_school_rotations). The term_dates column is left untouched in
                  the database (Phase 1C will address shift-log/Keith paths that still read it). */}
              <Field label="Hours Required" fieldKey="hours_required">
                <input className="sp-input" type="text" inputMode="numeric" pattern="[0-9]*"
                  value={data.hours_required??''} onChange={e => handleText('hours_required', e.target.value)} />
              </Field>
              <Field label="Est. Graduation"><div className="sp-readonly">{data.estimated_graduation||'—'}</div></Field>
            </div>
          </div>

          {/* 3b. Rotation Dates — STUDENT-PROFILE-CANON-1B: the single canonical placement-window
              block, sourced from the coordinator-owned cohort_school_rotations row. Always rendered
              (shows "pending review" when no linked/valid row) so it is the one date source of truth. */}
          <div className="sp-section sp-card sp-zone-program">
              <SectionHeader title="Rotation Dates" icon={<CalendarDays size={13} />}>
                <SourceTag label="Source: Coordinator school form" tone="coordinator" />
                {canEdit && rotationRow && !isSentinel && !editingRotation && (
                  <button
                    onClick={handleOpenRotationEdit}
                    style={{ fontSize:11, fontWeight:600, padding:'2px 10px', borderRadius:6,
                      background:'#f0f3ff', border:'1px solid #e0e7ff', color:'#1D2567',
                      cursor:'pointer', fontFamily:'DM Sans,sans-serif' }}>
                    Edit
                  </button>
                )}
              </SectionHeader>

              {(rotationLoading && student.cohort_school_rotation_id) ? (
                <div style={{ fontSize:12, color:'var(--text-caption,#6b7280)', fontFamily:'DM Sans' }}>Loading…</div>
              ) : rotationPending ? (
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px',
                  background:'#fdf6ec', border:'1px solid #f0c9b0', borderRadius:8,
                  fontFamily:'DM Sans', fontSize:12.5, color:'#583733', fontWeight:600 }}>
                  <span>&#9651;</span>
                  Rotation Dates: Pending coordinator/admin review
                </div>
              ) : !editingRotation ? (
                <>
                  <div className="sp-grid-2">
                    <div>
                      <div style={{ fontSize:10.5, fontWeight:600, color:'var(--text-caption,#6b7280)',
                        textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Start</div>
                      <div style={{ fontSize:13, color:'var(--text-heading,#191919)' }}>
                        {fmtRotDate(rotationRow?.rotation_start_date)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:10.5, fontWeight:600, color:'var(--text-caption,#6b7280)',
                        textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>End</div>
                      <div style={{ fontSize:13, color:'var(--text-heading,#191919)' }}>
                        {fmtRotDate(rotationRow?.rotation_end_date)}
                      </div>
                    </div>
                    {rotationRow?.school_name && (
                      <div style={{ gridColumn:'1 / -1' }}>
                        <div style={{ fontSize:10.5, fontWeight:600, color:'var(--text-caption,#6b7280)',
                          textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>School</div>
                        <div style={{ fontSize:13, color:'var(--text-heading,#191919)' }}>
                          {rotationRow.school_name}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Coordinator provenance — this date window is coordinator-owned (school form). */}
                  <div style={{ marginTop:8, fontSize:11, color:'var(--text-caption,#6b7280)',
                    fontFamily:'DM Sans', fontStyle:'italic' }}>
                    {rotationRow?.coordinator_name
                      ? `Submitted by ${rotationRow.coordinator_name}${rotationRow.coordinator_email ? `, ${rotationRow.coordinator_email}` : ''}`
                      : 'Coordinator-submitted via school form'}
                  </div>
                </>
              ) : (
                <div>
                  {rotEditError && (
                    <div style={{ fontSize:12, color:'#991b1b', background:'#fee2e2', border:'1px solid #fca5a5',
                      borderRadius:6, padding:'6px 10px', marginBottom:8 }}>{rotEditError}</div>
                  )}
                  <div className="sp-grid-2" style={{ marginBottom:10 }}>
                    <div>
                      <label style={{ fontSize:11, fontWeight:600, color:'var(--text-caption,#6b7280)',
                        textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>
                        Start *
                      </label>
                      <input type="date" className="sp-input"
                        value={rotEditStart} onChange={e => { setRotEditStart(e.target.value); setRotEditError(null) }}
                        style={{ colorScheme:'light' }} />
                    </div>
                    <div>
                      <label style={{ fontSize:11, fontWeight:600, color:'var(--text-caption,#6b7280)',
                        textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>
                        End *
                      </label>
                      <input type="date" className="sp-input"
                        value={rotEditEnd} onChange={e => { setRotEditEnd(e.target.value); setRotEditError(null) }}
                        style={{ colorScheme:'light' }} />
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={handleSaveRotationDates}
                      style={{ padding:'6px 16px', background:'#1D2567', border:'none', borderRadius:8,
                        fontFamily:'DM Sans', fontWeight:700, fontSize:12, color:'#fff', cursor:'pointer' }}>
                      Save
                    </button>
                    <button onClick={() => { setEditingRotation(false); setRotEditError(null) }}
                      style={{ padding:'6px 14px', background:'#f9fafb', border:'1px solid #e5e7eb',
                        borderRadius:8, fontFamily:'DM Sans', fontWeight:600, fontSize:12,
                        color:'#374151', cursor:'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Confirmation modal: shows affected student count */}
              {rotConfirmModal && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:2999,
                  display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                  <div style={{ background:'#fff', borderRadius:14, maxWidth:420, width:'100%',
                    padding:'24px 24px 20px', fontFamily:'DM Sans, sans-serif',
                    boxShadow:'0 20px 50px rgba(0,0,0,0.18)' }}>
                    <div style={{ fontWeight:700, fontSize:15, color:'#1D2567', marginBottom:10 }}>
                      Update rotation dates?
                    </div>
                    <p style={{ fontSize:13, color:'#374151', lineHeight:1.6, margin:'0 0 16px' }}>
                      This will update rotation dates for{' '}
                      <strong>{rotConfirmModal.count} student{rotConfirmModal.count !== 1 ? 's' : ''}</strong>
                      {rotationRow?.school_name ? ` from ${rotationRow.school_name}` : ''}.
                    </p>
                    <div style={{ display:'flex', gap:10 }}>
                      <button onClick={() => setRotConfirmModal(null)} disabled={rotSaving}
                        style={{ flex:1, height:38, borderRadius:8, border:'1px solid #e5e7eb',
                          background:'#f9fafb', fontFamily:'DM Sans', fontWeight:600, fontSize:13,
                          cursor:'pointer', color:'#374151' }}>Cancel</button>
                      <button onClick={handleConfirmRotationSave} disabled={rotSaving}
                        style={{ flex:1, height:38, borderRadius:8, border:'none',
                          background:'#1D2567', fontFamily:'DM Sans', fontWeight:700, fontSize:13,
                          cursor:'pointer', color:'#fff' }}>
                        {rotSaving ? 'Saving...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          {/* 3c. Availability & Scheduling (AVAILABILITY-CANON-1C) — display only, two
              provenance-labeled sub-blocks: coordinator program constraints (cohort_school_rotations)
              and student availability (students). Null-safe; no risk logic in this phase. */}
          <div className="sp-section sp-card sp-zone-program">
            <SectionHeader title="Availability & Scheduling" icon={<CalendarDays size={13} />} />
            <p style={{ fontSize:11.5, color:'var(--text-caption,#6b7280)', lineHeight:1.5, margin:'0 0 12px' }}>
              Availability is considered during matching but does not guarantee a specific unit, preceptor, or shift.
            </p>

            {/* Sub-block 1: Coordinator Program Constraints */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <span style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-caption,#6b7280)' }}>
                Coordinator Program Constraints
              </span>
              <SourceTag label="Source: Coordinator school form" tone="coordinator" />
            </div>
            <div className="sp-grid-2">
              <Field label="Program unavailable weekdays"><div className="sp-readonly">{formatWeekdays(rotationRow?.unavailable_weekdays)}</div></Field>
              <Field label="Minimum clinical days/week"><div className="sp-readonly">{formatMinDays(rotationRow?.min_days_per_week)}</div></Field>
              <Field label="Weekend rotations allowed"><div className="sp-readonly">{formatBooleanYesNo(rotationRow?.weekends_allowed)}</div></Field>
              <Field label="Night shifts allowed"><div className="sp-readonly">{formatBooleanYesNo(rotationRow?.nights_allowed)}</div></Field>
              <Field label="School blackout dates"><div className="sp-readonly">{formatDates(rotationRow?.blackout_dates)}</div></Field>
              <Field label="Coordinator scheduling notes"><div className="sp-readonly">{formatText(rotationRow?.scheduling_notes)}</div></Field>
            </div>

            {/* Sub-block 2: Student Availability */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:14, marginBottom:8,
              paddingTop:12, borderTop:'1px solid var(--border-lt,#e5e7eb)' }}>
              <span style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-caption,#6b7280)' }}>
                Student Availability
              </span>
              <SourceTag label="Source: Student form" tone="student" />
            </div>
            {data.availability_ack !== true && (
              <div style={{ fontSize:11.5, color:'#92400e', fontStyle:'italic', marginBottom:8 }}>
                Student availability not yet confirmed
              </div>
            )}
            <div className="sp-grid-2">
              <Field label="Shift preference"><div className="sp-readonly">{formatText(data.shift_availability)}</div></Field>
              <Field label="Student unavailable weekdays"><div className="sp-readonly">{formatWeekdays(data.unavailable_weekdays)}</div></Field>
              <Field label="Reason / details"><div className="sp-readonly">{formatText(data.unavailable_weekdays_reason)}</div></Field>
              <Field label="Personal blackout dates"><div className="sp-readonly">{formatDates(data.personal_blackout_dates)}</div></Field>
              <Field label="Weekend availability"><div className="sp-readonly">{formatBooleanAvailable(data.weekends_available)}</div></Field>
              <Field label="Night availability"><div className="sp-readonly">{formatBooleanAvailable(data.nights_available)}</div></Field>
              <Field label="Preferred days"><div className="sp-readonly">{formatWeekdays(data.preferred_days)}</div></Field>
              <Field label="Availability acknowledgment"><div className="sp-readonly">{data.availability_ack === true ? 'Completed' : 'Not completed'}</div></Field>
              <Field label="Student availability notes"><div className="sp-readonly">{formatText(data.availability_notes)}</div></Field>
            </div>
          </div>

          {/* 4. Background and Affiliation */}
          <div className="sp-section sp-card sp-zone-student">
            <SectionHeader title="Background and Affiliation" icon={<Briefcase size={13} />}>
              <SourceTag label={studentSourceLabel} tone={studentSourceTone} />
            </SectionHeader>
            <Field label="Prior Healthcare Experience">
              <input className="sp-input" value={data.prior_healthcare_experience||''} onChange={e => handleText('prior_healthcare_experience', e.target.value)} placeholder="e.g. CNA, EMT" />
            </Field>
            <Field label="CS Affiliation">
              <select className="sp-select" value={data.cs_affiliation||''} onChange={e => handleSelect('cs_affiliation', e.target.value)}>
                <option value="">Select…</option>
                {CS_AFFILIATIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            {CS_WITH_DEPT.includes(data.cs_affiliation) && (
              <div className="sp-grid-2">
                <Field label="CS Department">
                  <input className="sp-input" value={data.cs_department||''} onChange={e => handleText('cs_department', e.target.value)} />
                </Field>
                <Field label="CS Role / Job Title">
                  <input className="sp-input" value={data.cs_role||''} onChange={e => handleText('cs_role', e.target.value)} />
                </Field>
              </div>
            )}
          </div>

          {/* 5. Unit Placement Preferences */}
          <div className="sp-section sp-card sp-zone-student">
            <SectionHeader title="Unit Placement Preferences" icon={<MapPin size={13} />}>
              <SourceTag label={studentSourceLabel} tone={studentSourceTone} />
            </SectionHeader>
            <div className="sp-grid-3">
              {['unit_preference_1','unit_preference_2','unit_preference_3'].map((f,i) => (
                <Field key={f} label={`Preference ${i+1}`} fieldKey={f}>
                  <select className="sp-select" value={data[f]||''} onChange={e => handleSelect(f, e.target.value)}>
                    <option value="">Not specified</option>
                    {participatingUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          {/* 6. Documents */}
          <div className="sp-section sp-card sp-zone-student">
            <SectionHeader title="Documents" icon={<FileText size={13} />}>
              <SourceTag label={studentSourceLabel} tone={studentSourceTone} />
            </SectionHeader>
            <div className="doc-section">
              <div className="doc-upload-area">
                <div className="doc-area-label">Resume</div>
                <input ref={resumeRef} type="file" style={{ display:'none' }} accept=".pdf,.doc,.docx" onChange={e => handleResumeUpload(e.target.files[0])} />
                {data.resume_url ? (
                  <div className="doc-existing-file">
                    <a className="doc-file-link" href={data.resume_url} target="_blank" rel="noopener noreferrer">
                      {decodeURIComponent(data.resume_url.split('/').pop()?.split('?')[0] || 'Resume')}
                    </a>
                    <button onClick={() => doDownload(data.resume_url, buildStudentFilename(student,'resume'), setDlResume)} disabled={dlResume}
                      style={{ background:'var(--pearl)', border:'1px solid var(--nightfall)', color:'var(--nightfall)', fontSize:11, fontWeight:600, borderRadius:6, padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>
                      {dlResume ? '…' : '↓ Resume'}
                    </button>
                    <button className="doc-replace-btn" disabled={uploadingRes} onClick={() => resumeRef.current?.click()}>Replace</button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => resumeRef.current?.click()}>
                    <span className="doc-zone-icon">📄</span>
                    <span className="doc-zone-text">Upload Resume (PDF/Word, max 10MB)</span>
                    <button type="button" className="doc-zone-btn" onClick={e=>{ e.stopPropagation(); resumeRef.current?.click() }}>Choose File</button>
                  </div>
                )}
                {uploadingRes && <span className="doc-status doc-uploading">Uploading…</span>}
                {resumeMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded</span>}
                {resumeMsg && resumeMsg !== 'success' && <span className="doc-status doc-error" style={{ color:'var(--cs-red)' }}>{resumeMsg}</span>}
              </div>
              <div className="doc-upload-area">
                <div className="doc-area-label">Headshot</div>
                <input ref={headshotRef} type="file" style={{ display:'none' }} accept=".jpg,.jpeg,.png" onChange={e => handleHeadshotUpload(e.target.files[0])} />
                {data.headshot_url ? (
                  <div className="doc-existing-file">
                    <img src={data.headshot_url} alt="Headshot" className="doc-headshot-preview" />
                    {/* Download Badge — owner/admin/interviewer only; replaces the old raw-photo download */}
                    {canInterview && (
                      <Tooltip label={badgeDisabledReason || 'Download badge'} placement="top">
                      <button
                        onClick={handleDownloadBadge}
                        disabled={!!badgeDisabledReason || generatingBadge}
                        aria-label={badgeDisabledReason || 'Download badge'}
                        style={{
                          background: badgeDisabledReason ? '#f3f4f6' : 'var(--nightfall)',
                          border: badgeDisabledReason ? '1px solid #e5e7eb' : '1px solid var(--nightfall)',
                          color: badgeDisabledReason ? '#9ca3af' : '#fff',
                          fontSize:11, fontWeight:600, borderRadius:6, padding:'4px 10px',
                          cursor: (badgeDisabledReason || generatingBadge) ? 'not-allowed' : 'pointer',
                          flexShrink:0, fontFamily:'DM Sans,sans-serif',
                        }}>
                        {generatingBadge ? 'Generating...' : 'Download Badge'}
                      </button>
                      </Tooltip>
                    )}
                    <button className="doc-replace-btn" disabled={uploadingHead} onClick={() => headshotRef.current?.click()}>Replace</button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => headshotRef.current?.click()}>
                    <span className="doc-zone-icon">🖼</span>
                    <span className="doc-zone-text">Upload Headshot (JPG/PNG, max 5MB)</span>
                    <button type="button" className="doc-zone-btn" onClick={e=>{ e.stopPropagation(); headshotRef.current?.click() }}>Choose File</button>
                  </div>
                )}
                {uploadingHead && <span className="doc-status doc-uploading">Uploading…</span>}
                {headMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded</span>}
                {headMsg && headMsg !== 'success' && <span className="doc-status doc-error" style={{ color:'var(--cs-red)' }}>{headMsg}</span>}
              </div>
            </div>
          </div>

          {/* 7. Interest Statement */}
          <div className="sp-section sp-card sp-zone-student">
            <SectionHeader title="Interest Statement" icon={<MessageSquare size={13} />}>
              <SourceTag label={studentSourceLabel} tone={studentSourceTone} />
            </SectionHeader>
            {!editingInterest ? (
              <div onClick={() => setEditingInterest(true)}
                style={{ fontFamily:'DM Sans', fontSize:'13px', color:data.interest_statement?'#374151':'#9ca3af', lineHeight:1.6, padding:'10px 12px', borderRadius:'8px', border:'1px solid transparent', cursor:'text', minHeight:'80px', transition:'border-color 0.15s ease, background 0.15s ease' }}
                onMouseEnter={e=>{ e.currentTarget.style.borderColor='#e5e7eb'; e.currentTarget.style.background='#f9fafb' }}
                onMouseLeave={e=>{ e.currentTarget.style.borderColor='transparent'; e.currentTarget.style.background='transparent' }}>
                {data.interest_statement || 'Click to add interest statement...'}
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <textarea value={interestDraft} onChange={e=>setInterestDraft(e.target.value)} autoFocus rows={5}
                  style={{ width:'100%', padding:'10px 12px', border:'1px solid #0ea5e9', borderRadius:8, fontFamily:'DM Sans', fontSize:13, color:'#374151', lineHeight:1.6, resize:'vertical', outline:'none', boxSizing:'border-box' }} />
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button onClick={() => { setInterestDraft(data.interest_statement||''); setEditingInterest(false) }}
                    style={{ padding:'6px 14px', borderRadius:8, border:'1px solid #e5e7eb', background:'#f9fafb', fontFamily:'DM Sans', fontSize:12, cursor:'pointer' }}>Cancel</button>
                  <button onClick={async () => { const err = await onUpdate(student.id, { interest_statement: interestDraft }); if (!err) setData(p=>({...p, interest_statement:interestDraft})); setEditingInterest(false) }}
                    style={{ padding:'6px 14px', borderRadius:8, border:'none', background:'#0ea5e9', color:'#fff', fontFamily:'DM Sans', fontSize:12, fontWeight:600, cursor:'pointer' }}>Save</button>
                </div>
              </div>
            )}
          </div>

          {/* 9. Placement and Outcomes — appears after CS-Link per spec order */}
          {false && <div className="sp-section sp-card" style={{ background:'rgba(200,213,192,0.22)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Placement and Outcomes [MOVED]" icon={<Award size={13} />} />
            <div className="sp-grid-2">
              <Field label="ASPIRE Status">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.status && (() => { const cfg = ASPIRE_STATUS_CONFIG[data.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']; return <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, alignSelf:'flex-start' }}>{data.status}</span> })()}
                  {canEdit && <select className="sp-select" value={data.status||''} onChange={async e => {
                    const newStatus = e.target.value
                    if (newStatus === 'Declined') { setShowDeclineModal(true) }
                    else {
                      const oldStatus = data.status
                      handleSelect('status', newStatus)
                      toast?.success('Status updated', `${student.first_name} moved to ${newStatus}.`)
                      logActivity({ userProfile, actionType:'student_profile_updated', entityType:'student', entityId:student.id, cohortId:student.cohort_id, description:`${userProfile?.full_name} changed ${student.first_name} ${student.last_name}'s status to ${newStatus}`, metadata:{ from:oldStatus, to:newStatus } })
                      const statusEventMap = { 'Form Sent': 'form_sent', 'Form Received': 'form_received', 'Placed': 'placement', 'Completed': 'completion' }
                      const eventType = statusEventMap[newStatus]
                      if (eventType) {
                        const already = await eventExists(supabase, student.id, eventType)
                        if (!already) await logEvent(supabase, { studentId: student.id, cohortId: student.cohort_id, eventType, notes: `Manual status change to ${newStatus}`, auto: false })
                      }
                    }
                  }}>
                    <option value="">Select status…</option>
                    {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>}
                  {data.decline_reason && (
                    <div style={{ fontSize:11, color:'#991b1b', marginTop:2 }}>
                      Reason: {data.decline_reason}
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Interview Recommendation">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.interview_outcome && (
                    <span className={`interview-pill ${ data.interview_outcome === 'Recommend' ? 'pill-green' : data.interview_outcome === 'Recommend with Reservations' ? 'pill-yellow' : data.interview_outcome === 'Do Not Recommend' ? 'pill-red' : 'pill-gray' }`}>{data.interview_outcome}</span>
                  )}
                  <select className="sp-select" value={data.interview_outcome||''} onChange={e => handleSelect('interview_outcome', e.target.value)}>
                    {INTERVIEW_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Matched Unit"><div className="sp-readonly">{matchedUnitName}</div></Field>
              <Field label="Matched Preceptor">
                <input className="sp-input" value={data.matched_preceptor||''} onChange={e => handleText('matched_preceptor', e.target.value)} placeholder="Assign preceptor…" />
              </Field>
              <Field label="Shift">
                <select className="sp-select" value={data.shift_assigned||''} onChange={e => handleSelect('shift_assigned', e.target.value)}>
                  <option value="">Select shift...</option>
                  <option value="Day">Day</option>
                  <option value="Night">Night</option>
                  <option value="Mid">Mid</option>
                  <option value="Variable">Variable</option>
                </select>
              </Field>
              <Field label="Preceptor Email">
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <input className="sp-input" type="email" value={data.preceptor_email||''} onChange={e => handleText('preceptor_email', e.target.value)} placeholder="preceptor@cshs.org" />
                  {data.preceptor_email && (
                    <Tooltip label="Email preceptor" placement="top"><button className="sp-copy-btn" aria-label="Email preceptor"
                      onClick={() => { openOutlookCompose({ to: data.preceptor_email }) }}>✉</button></Tooltip>
                  )}
                </div>
              </Field>
              <Field label="NGRP Cohort Target">
                <input className="sp-input" value={data.ngrp_cohort_target||''} onChange={e => handleText('ngrp_cohort_target', e.target.value)} placeholder="e.g. Spring 2027" />
              </Field>
              <Field label="NGRP Outcome">
                <select className="sp-select" value={data.ngrp_outcome||''} onChange={e => handleSelect('ngrp_outcome', e.target.value)}>
                  {NGRP_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
            {/* Badge Created — bottom of Placement section */}
            <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, cursor:'pointer', fontSize:13, color:'var(--raven)' }}>
              <input type="checkbox" checked={!!data.badge_created}
                onChange={e => { handleSelect('badge_created', e.target.checked); if (e.target.checked) { toast?.success('Badge issued', `Badge marked as created for ${student.first_name}.`); logActivity({ userProfile, actionType:'badge_issued', entityType:'student', entityId:student.id, cohortId:student.cohort_id, description:`${userProfile?.full_name} marked badge as created for ${student.first_name} ${student.last_name}` }) } }}
                style={{ width:16, height:16, accentColor:'#16a34a' }} />
              <span>Badge Created</span>
              {data.badge_created && <span style={{ fontSize:12, color:'#166534', fontWeight:600 }}>✓ Badge Created</span>}
            </label>
          </div>}

          {/* 8. CS-Link Access Workflow — editors only */}
          {canEdit && <div className="sp-section sp-card sp-zone-admin">
            <SectionHeader title="CS-Link Access" icon={<CheckCircle2 size={13} />}>
              <SourceTag label="Source: ASPIRE/admin" tone="admin" />
              <span style={{ fontSize:11, fontWeight:600, padding:'2px 9px', borderRadius:20, background:csStatusCfg.bg, color:csStatusCfg.text }}>
                {csStatusCfg.label}
              </span>
            </SectionHeader>

            {/* Step 1: Cedars-Sinai History */}
            <div className="csw-step">
              <div className="csw-step-label">Step 1: Cedars-Sinai Status</div>
              <select className="sp-select" value={data.cs_cedars_status||''}
                onChange={e => {
                  const v = e.target.value
                  const extras = v === 'employee'
                    ? { cs_stage1_action:'not_applicable', cs_stage1_submitted:true, cs_stage1_complete:true }
                    : v === 'new'
                    ? { cs_stage1_action:'add_non_employee', cs_stage1_submitted:false, cs_stage1_complete:false }
                    : { cs_stage1_action:'', cs_stage1_submitted:false, cs_stage1_complete:false }
                  setData(p => ({ ...p, cs_cedars_status:v, ...extras }))
                  onUpdate(student.id, { cs_cedars_status:v, ...extras })
                }}>
                <option value="">Select status…</option>
                {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Step 2: Stage 1 Action */}
            {data.cs_cedars_status && (
              <div className={`csw-step${!data.cs_cedars_status ? ' csw-step-dim' : ''}`}>
                <div className="csw-step-label">Step 2: Service Center Request</div>

                {data.cs_cedars_status === 'employee' && (
                  <div className="csw-info-green">Stage 1 not required. Current Cedars-Sinai employees already have a worker record. Proceed directly to adding CS-Link access.</div>
                )}

                {data.cs_cedars_status === 'new' && (
                  <>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', marginBottom:8 }}>Add Non-Employee</div>
                    <p className="csw-note">Submit an Add Non-Employee request in the Service Center for this student.</p>
                    <div className="csw-check-row">
                      <label className="csw-check-label">
                        <input type="checkbox" checked={data.cs_stage1_submitted||false}
                          onChange={e => { handleCheck('cs_stage1_submitted', e.target.checked) }}
                          style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                        Submitted to Service Center
                      </label>
                      {data.cs_stage1_submitted && (
                        <CsLinkDateField value={data.cs_stage1_submitted_date}
                          onChange={e => handleText('cs_stage1_submitted_date', e.target.value)} />
                      )}
                    </div>
                  </>
                )}

                {data.cs_cedars_status === 'former' && (
                  <>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', marginBottom:8 }}>Update Non-Employee</div>
                    <Field label="Request Type:">
                      <select className="sp-select" value={data.cs_stage1_action||''}
                        onChange={e => handleSelect('cs_stage1_action', e.target.value)}>
                        <option value="">Select type…</option>
                        {STAGE1_ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <div className="csw-check-row">
                      <label className="csw-check-label">
                        <input type="checkbox" checked={data.cs_stage1_submitted||false}
                          onChange={e => handleCheck('cs_stage1_submitted', e.target.checked)}
                          style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                        Submitted to Service Center
                      </label>
                      {data.cs_stage1_submitted && (
                        <CsLinkDateField value={data.cs_stage1_submitted_date}
                          onChange={e => handleText('cs_stage1_submitted_date', e.target.value)} />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 3: Account Active Confirmation */}
            {(data.cs_stage1_submitted || data.cs_cedars_status === 'employee') && (
              <div className="csw-step">
                <div className="csw-step-label">Step 3: Contingent Worker Account Active</div>
                {data.cs_cedars_status === 'employee' ? (
                  <div className="csw-info-gray">Not applicable for current employees.</div>
                ) : (
                  <>
                    <div className="csw-check-row">
                      <label className="csw-check-label">
                        <input type="checkbox" checked={data.cs_stage1_complete||false}
                          onChange={e => handleCheck('cs_stage1_complete', e.target.checked)}
                          style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                        Account is active in the system
                      </label>
                      {data.cs_stage1_complete && (
                        <CsLinkDateField value={data.cs_stage1_complete_date}
                          onChange={e => handleText('cs_stage1_complete_date', e.target.value)} />
                      )}
                    </div>
                    <p className="csw-note">Confirm the Service Center request was processed and the student's account is active before adding CS-Link.</p>
                  </>
                )}
              </div>
            )}

            {/* Step 4: CS-Link Access */}
            {(data.cs_stage1_complete || data.cs_cedars_status === 'employee') && (
              <div className="csw-step">
                <div className="csw-step-label">Step 4: Add CS-Link Access</div>
                <div className="csw-check-row">
                  <label className="csw-check-label">
                    <input type="checkbox" checked={data.cs_link_requested||false}
                      onChange={e => handleCheck('cs_link_requested', e.target.checked)}
                      style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                    CS-Link access requested
                  </label>
                  {data.cs_link_requested && (
                    <CsLinkDateField value={data.cs_link_requested_date}
                      onChange={e => handleText('cs_link_requested_date', e.target.value)} />
                  )}
                </div>
                {data.cs_link_requested && (
                  <div className="csw-check-row" style={{ marginTop:6 }}>
                    <label className="csw-check-label">
                      <input type="checkbox" checked={data.cs_link_complete||false}
                        onChange={e => handleCheck('cs_link_complete', e.target.checked)}
                        style={{ accentColor:'#16a34a', width:14, height:14 }} />
                      CS-Link confirmed active and working
                    </label>
                    {data.cs_link_complete && (
                      <CsLinkDateField value={data.cs_link_complete_date}
                        onChange={e => handleText('cs_link_complete_date', e.target.value)} />
                    )}
                  </div>
                )}
                <p className="csw-note">Only mark as complete once the student has confirmed their CS-Link access is working.</p>
                {data.cs_link_complete && (
                  <div className="csw-success-banner">✓ Access setup complete for this student.</div>
                )}
              </div>
            )}

            {/* Notes */}
            <div style={{ marginTop:12 }}>
              <Field label="Access Notes">
                <textarea className="sp-textarea" rows={2} value={data.cs_access_notes||''}
                  onChange={e => handleText('cs_access_notes', e.target.value)} placeholder="Add notes…" />
              </Field>
            </div>
          </div>}

          {/* 9. Placement and Outcomes */}
          <div className="sp-section sp-card sp-zone-admin">
            <SectionHeader title="Placement and Outcomes" icon={<Award size={13} />}>
              <SourceTag label="Source: ASPIRE/admin" tone="admin" />
            </SectionHeader>
            <div className="sp-grid-2">
              <Field label="ASPIRE Status">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.status && (() => { const cfg = ASPIRE_STATUS_CONFIG[data.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']; return <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, alignSelf:'flex-start' }}>{data.status}</span> })()}
                  {canEdit && <select className="sp-select" value={data.status||''} onChange={async e => {
                    const newStatus = e.target.value
                    if (newStatus === 'Declined') { setShowDeclineModal(true) }
                    else {
                      const oldStatus = data.status
                      handleSelect('status', newStatus)
                      toast?.success('Status updated', `${student.first_name} moved to ${newStatus}.`)
                      logActivity({ userProfile, actionType:'student_profile_updated', entityType:'student', entityId:student.id, cohortId:student.cohort_id, description:`${userProfile?.full_name} changed ${student.first_name} ${student.last_name}'s status to ${newStatus}`, metadata:{ from:oldStatus, to:newStatus } })
                      const statusEventMap = { 'Form Sent': 'form_sent', 'Form Received': 'form_received', 'Placed': 'placement', 'Completed': 'completion' }
                      const eventType = statusEventMap[newStatus]
                      if (eventType) {
                        const already = await eventExists(supabase, student.id, eventType)
                        if (!already) await logEvent(supabase, { studentId: student.id, cohortId: student.cohort_id, eventType, notes: `Manual status change to ${newStatus}`, auto: false })
                      }
                    }
                  }}>
                    <option value="">Select status…</option>
                    {/* Phase 2B.2b: 'Declined' removed from new selections. Use Program Disposition section to record dispositions. */}
                    {ASPIRE_STATUSES.filter(s => s !== 'Declined').map(s => <option key={s} value={s}>{s}</option>)}
                  </select>}
                  {data.decline_reason && <div style={{ fontSize:11, color:'#991b1b', marginTop:2 }}>Reason: {data.decline_reason}</div>}
                </div>
              </Field>
              <Field label="Interview Recommendation">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.interview_outcome && (
                    <span className={`interview-pill ${ data.interview_outcome === 'Recommend' ? 'pill-green' : data.interview_outcome === 'Recommend with Reservations' ? 'pill-yellow' : data.interview_outcome === 'Do Not Recommend' ? 'pill-red' : 'pill-gray' }`}>{data.interview_outcome}</span>
                  )}
                  <select className="sp-select" value={data.interview_outcome||''} onChange={e => handleSelect('interview_outcome', e.target.value)}>
                    {INTERVIEW_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Matched Unit"><div className="sp-readonly">{matchedUnitName}</div></Field>
              {/* Preceptor — shows normalized record when linked, free-text fields otherwise */}
              <div className="sp-field" style={{ gridColumn: '1 / -1' }}>
                <label className="sp-field-lbl">Preceptor</label>
                {resolved.source === 'normalized' ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                      <span style={{ fontSize:13, fontWeight:600, color:'#111' }}>{resolved.name}</span>
                      {resolved.shift_type && (
                        <span style={{ fontSize:11, color:'#6b7280', background:'#f3f4f6', padding:'1px 6px', borderRadius:4 }}>{resolved.shift_type}</span>
                      )}
                    </div>
                    {resolved.email && (
                      <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'#6b7280' }}>
                        <Tooltip label="Email preceptor" placement="top"><button className="sp-copy-btn" aria-label="Email preceptor" onClick={() => openOutlookCompose({ to: resolved.email })}>✉</button></Tooltip>
                        {resolved.email}
                      </div>
                    )}
                    {resolved.unit_name && (
                      <div style={{ fontSize:12, color:'#9ca3af' }}>{resolved.unit_name}</div>
                    )}
                    {canEdit && (
                      <button onClick={() => setAssignModalOpen(true)}
                        style={{ alignSelf:'flex-start', marginTop:2, fontSize:11, color:'#1D2567', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0, fontFamily:'DM Sans,sans-serif' }}>
                        Change preceptor
                      </button>
                    )}
                  </div>
                ) : resolved.name || resolved.email ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    <input className="sp-input" value={data.matched_preceptor||''} onChange={e => handleText('matched_preceptor', e.target.value)} placeholder="Preceptor name…" />
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <input className="sp-input" type="email" value={data.preceptor_email||''} onChange={e => handleText('preceptor_email', e.target.value)} placeholder="preceptor@cshs.org" />
                      {data.preceptor_email && <Tooltip label="Email preceptor" placement="top"><button className="sp-copy-btn" aria-label="Email preceptor" onClick={() => openOutlookCompose({ to: data.preceptor_email })}>✉</button></Tooltip>}
                    </div>
                    {canEdit && (
                      <button onClick={() => setAssignModalOpen(true)}
                        style={{ alignSelf:'flex-start', fontSize:11, color:'#1D2567', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0, fontFamily:'DM Sans,sans-serif' }}>
                        Link to preceptor record
                      </button>
                    )}
                  </div>
                ) : (
                  canEdit ? (
                    <button onClick={() => setAssignModalOpen(true)}
                      style={{ fontSize:12, color:'#1D2567', background:'#f0f3ff', border:'1px solid #e0e7ff', borderRadius:6, padding:'5px 12px', cursor:'pointer', fontFamily:'DM Sans,sans-serif', fontWeight:600 }}>
                      + Assign preceptor
                    </button>
                  ) : (
                    <span style={{ fontSize:13, color:'#9ca3af' }}>No preceptor assigned</span>
                  )
                )}
                {/* PRECEPTOR-MODEL-3: additive secondary/coverage display + Owner/Admin assign flow.
                    Primary above stays sourced from students.preceptor_id (unchanged). */}
                <AdditionalPreceptors student={data} preceptors={preceptors} canEdit={canEdit} />
              </div>
              <Field label="Shift">
                <select className="sp-select" value={data.shift_assigned||''} onChange={e => handleSelect('shift_assigned', e.target.value)}>
                  <option value="">Select shift...</option>
                  {['Day','Night','Mid','Variable'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="NGRP Cohort Target">
                <input className="sp-input" value={data.ngrp_cohort_target||''} onChange={e => handleText('ngrp_cohort_target', e.target.value)} placeholder="e.g. Spring 2027" />
              </Field>
              <Field label="NGRP Outcome">
                <select className="sp-select" value={data.ngrp_outcome||''} onChange={e => handleSelect('ngrp_outcome', e.target.value)}>
                  {NGRP_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
            <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, cursor:'pointer', fontSize:13, color:'var(--raven)' }}>
              <input type="checkbox" checked={!!data.badge_created}
                onChange={e => { handleSelect('badge_created', e.target.checked); if (e.target.checked) { toast?.success('Badge issued', `Badge marked as created for ${student.first_name}.`); logActivity({ userProfile, actionType:'badge_issued', entityType:'student', entityId:student.id, cohortId:student.cohort_id, description:`${userProfile?.full_name} marked badge as created for ${student.first_name} ${student.last_name}` }) } }}
                style={{ width:16, height:16, accentColor:'#16a34a' }} />
              <span>Badge Created</span>
              {data.badge_created && <span style={{ fontSize:12, color:'#166534', fontWeight:600 }}>✓ Badge Created</span>}
            </label>
          </div>

          {/* ── Program Disposition (Phase 2B.2b) ─────────────────────────── */}
          <div className="sp-section sp-card sp-zone-admin">
            <SectionHeader title="Program Disposition" icon={<Flag size={13} />}>
              <SourceTag label="Source: ASPIRE/admin" tone="admin" />
            </SectionHeader>
            {activeDisposition ? (
              <>
                <Field label="Disposition Type">
                  <div className="sp-readonly">{DISPOSITION_TYPES[activeDisposition.disposition_type] || activeDisposition.disposition_type}</div>
                </Field>
                <Field label="Reason">
                  <div className="sp-readonly">{REASON_CATEGORIES_BY_TYPE[activeDisposition.disposition_type]?.[activeDisposition.reason_category] || activeDisposition.reason_category}</div>
                </Field>
                <Field label="Effective Date">
                  <div className="sp-readonly">
                    {activeDisposition.effective_date
                      ? (() => { const [y,m,d] = activeDisposition.effective_date.split('-'); return new Date(+y,+m-1,+d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) })()
                      : '—'}
                  </div>
                </Field>
                <Field label="Decision Origin">
                  <div className="sp-readonly">{DECISION_ORIGINS[activeDisposition.decision_origin] || activeDisposition.decision_origin}</div>
                </Field>
                <Field label="Recorded By">
                  <div className="sp-readonly">{activeDisposition.recorded_by_name || activeDisposition.decided_by_name || '—'}</div>
                </Field>
                {canEdit && dispositionFollowups.length > 0 && (
                  <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--border-lt,#e5e7eb)' }}>
                    <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', color:'var(--text-secondary,#6b7280)', marginBottom:8 }}>
                      Follow-up Tasks
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {dispositionFollowups.map(f => (
                        <div key={f.id}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13 }}>
                            <span style={{ fontSize:15, lineHeight:1, flexShrink:0 }}>{f.status === 'completed' ? '☑' : '☐'}</span>
                            <span style={{ color: f.status === 'completed' ? 'var(--text-secondary,#6b7280)' : 'var(--raven,#111827)', textDecoration: f.status === 'completed' ? 'line-through' : 'none', flex:1 }}>
                              {FOLLOWUP_TYPES[f.followup_type] || f.followup_type}
                            </span>
                            {f.status === 'completed' && (
                              <span style={{ fontSize:11, color:'var(--text-secondary,#6b7280)', whiteSpace:'nowrap' }}>
                                {[
                                  f.completion_method
                                    ? `Documented via ${{ email:'Email', phone:'Phone', in_person:'In Person', other:'Other' }[f.completion_method] || f.completion_method}`
                                    : 'Documented',
                                  f.completed_at && new Date(f.completed_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}),
                                  f.completed_by_name,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {f.status === 'pending' && !canEdit && (
                              <span style={{ fontSize:11, color:'var(--text-secondary,#6b7280)' }}>Pending</span>
                            )}
                            {f.status === 'pending' && canEdit && (
                              ['notify_student','notify_school_coordinator','notify_unit_leader','leadership_review','documentation_review'].includes(f.followup_type) ? (
                                <button
                                  onClick={() => {
                                    setCompletingFollowupId(completingFollowupId === f.id ? null : f.id)
                                    setCompletionNote('')
                                    setCompletionMethod('')
                                  }}
                                  style={{ fontSize:11, color:'#1D2567', background:'#f0f3ff', border:'1px solid #e0e7ff', borderRadius:5, padding:'2px 8px', cursor:'pointer', fontFamily:'DM Sans,sans-serif', fontWeight:600, whiteSpace:'nowrap', flexShrink:0 }}
                                >
                                  {['notify_student','notify_school_coordinator','notify_unit_leader'].includes(f.followup_type)
                                    ? 'Document Notification'
                                    : f.followup_type === 'leadership_review'
                                      ? 'Document Review'
                                      : 'Confirm Review'}
                                </button>
                              ) : (
                                <span style={{ fontSize:11, color:'var(--text-secondary,#6b7280)', fontStyle:'italic', flexShrink:0 }}>Manual action required</span>
                              )
                            )}
                            {f.status === 'waived'        && <span style={{ fontSize:11, color:'var(--text-secondary,#6b7280)' }}>Waived</span>}
                            {f.status === 'cancelled'     && <span style={{ fontSize:11, color:'var(--text-secondary,#6b7280)' }}>Cancelled</span>}
                            {f.status === 'not_applicable'&& <span style={{ fontSize:11, color:'var(--text-secondary,#6b7280)' }}>N/A</span>}
                          </div>
                          {/* Type-specific completion form — explicit 4-branch routing */}
                          {completingFollowupId === f.id && (
                            <div style={{ marginTop:6, marginLeft:23, background:'#f9fafb', borderRadius:8, padding:'10px 12px', border:'1px solid #e5e7eb' }}>
                              {['notify_student','notify_school_coordinator','notify_unit_leader'].includes(f.followup_type) ? (
                                <>
                                  <div style={{ fontSize:11, fontWeight:600, color:'#374151', marginBottom:4 }}>
                                    How was this sent? <span style={{ color:'#ef4444' }}>*</span>
                                  </div>
                                  <div style={{ display:'flex', gap:5, marginBottom:8, flexWrap:'wrap' }}>
                                    {[['email','Email'],['phone','Phone'],['in_person','In Person'],['other','Other']].map(([val, label]) => (
                                      <button
                                        key={val}
                                        onClick={() => setCompletionMethod(val)}
                                        style={{
                                          fontSize:11, padding:'3px 9px', borderRadius:5, cursor:'pointer',
                                          fontFamily:'DM Sans,sans-serif', fontWeight:600,
                                          background: completionMethod === val ? '#1D2567' : '#f0f3ff',
                                          color: completionMethod === val ? '#fff' : '#1D2567',
                                          border: `1px solid ${completionMethod === val ? '#1D2567' : '#e0e7ff'}`,
                                        }}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  <div style={{ fontSize:11, fontWeight:600, color:'#374151', marginBottom:4 }}>
                                    Note <span style={{ color:'#ef4444' }}>*</span>
                                  </div>
                                  <textarea
                                    value={completionNote}
                                    onChange={e => setCompletionNote(e.target.value)}
                                    placeholder="e.g. Email sent 05/28/2026…"
                                    rows={2}
                                    style={{ width:'100%', fontSize:12, borderRadius:6, border:'1px solid #d1d5db', padding:'5px 8px', resize:'vertical', fontFamily:'DM Sans,sans-serif', boxSizing:'border-box', background:'#fff' }}
                                  />
                                  <div style={{ fontSize:11, color:'#6b7280', marginTop:6, marginBottom:6, fontStyle:'italic' }}>
                                    I confirm this notification has already occurred and is being documented here.
                                  </div>
                                  <div style={{ display:'flex', gap:6 }}>
                                    <button
                                      onClick={() => handleCompleteFollowup(f.id)}
                                      disabled={completingFollowup || !completionMethod || !completionNote.trim()}
                                      style={{
                                        flex:1, padding:'5px', fontSize:12, fontWeight:600, borderRadius:6,
                                        cursor: (completingFollowup || !completionMethod || !completionNote.trim()) ? 'default' : 'pointer',
                                        fontFamily:'DM Sans,sans-serif',
                                        background: (!completionMethod || !completionNote.trim()) ? '#f3f4f6' : '#f0fdf4',
                                        color:      (!completionMethod || !completionNote.trim()) ? '#9ca3af' : '#166534',
                                        border:     `1px solid ${(!completionMethod || !completionNote.trim()) ? '#e5e7eb' : '#bbf7d0'}`,
                                      }}
                                    >
                                      {completingFollowup ? '…' : 'Document Notification Completed'}
                                    </button>
                                    <button
                                      onClick={() => { setCompletingFollowupId(null); setCompletionNote(''); setCompletionMethod('') }}
                                      style={{ padding:'5px 12px', fontSize:12, fontWeight:600, background:'#f3f4f6', color:'#6b7280', border:'none', borderRadius:6, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              ) : f.followup_type === 'leadership_review' ? (
                                <>
                                  <div style={{ fontSize:11, fontWeight:600, color:'#374151', marginBottom:4 }}>
                                    Note <span style={{ color:'#ef4444' }}>*</span>
                                  </div>
                                  <textarea
                                    value={completionNote}
                                    onChange={e => setCompletionNote(e.target.value)}
                                    placeholder="e.g. Reviewed by leadership on 05/28/2026…"
                                    rows={2}
                                    style={{ width:'100%', fontSize:12, borderRadius:6, border:'1px solid #d1d5db', padding:'5px 8px', resize:'vertical', fontFamily:'DM Sans,sans-serif', boxSizing:'border-box', background:'#fff' }}
                                  />
                                  <div style={{ display:'flex', gap:6, marginTop:6 }}>
                                    <button
                                      onClick={() => handleCompleteFollowup(f.id)}
                                      disabled={completingFollowup || !completionNote.trim()}
                                      style={{
                                        flex:1, padding:'5px', fontSize:12, fontWeight:600, borderRadius:6,
                                        cursor: (completingFollowup || !completionNote.trim()) ? 'default' : 'pointer',
                                        fontFamily:'DM Sans,sans-serif',
                                        background: !completionNote.trim() ? '#f3f4f6' : '#f0fdf4',
                                        color:      !completionNote.trim() ? '#9ca3af' : '#166534',
                                        border:     `1px solid ${!completionNote.trim() ? '#e5e7eb' : '#bbf7d0'}`,
                                      }}
                                    >
                                      {completingFollowup ? '…' : 'Document Review Completed'}
                                    </button>
                                    <button
                                      onClick={() => { setCompletingFollowupId(null); setCompletionNote(''); setCompletionMethod('') }}
                                      style={{ padding:'5px 12px', fontSize:12, fontWeight:600, background:'#f3f4f6', color:'#6b7280', border:'none', borderRadius:6, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              ) : f.followup_type === 'documentation_review' ? (
                                <>
                                  <div style={{ fontSize:11, fontWeight:600, color:'#374151', marginBottom:4 }}>
                                    Note <span style={{ color:'#ef4444' }}>*</span>
                                  </div>
                                  <textarea
                                    value={completionNote}
                                    onChange={e => setCompletionNote(e.target.value)}
                                    placeholder="e.g. Documentation reviewed and filed…"
                                    rows={2}
                                    style={{ width:'100%', fontSize:12, borderRadius:6, border:'1px solid #d1d5db', padding:'5px 8px', resize:'vertical', fontFamily:'DM Sans,sans-serif', boxSizing:'border-box', background:'#fff' }}
                                  />
                                  <div style={{ display:'flex', gap:6, marginTop:6 }}>
                                    <button
                                      onClick={() => handleCompleteFollowup(f.id)}
                                      disabled={completingFollowup || !completionNote.trim()}
                                      style={{
                                        flex:1, padding:'5px', fontSize:12, fontWeight:600, borderRadius:6,
                                        cursor: (completingFollowup || !completionNote.trim()) ? 'default' : 'pointer',
                                        fontFamily:'DM Sans,sans-serif',
                                        background: !completionNote.trim() ? '#f3f4f6' : '#f0fdf4',
                                        color:      !completionNote.trim() ? '#9ca3af' : '#166534',
                                        border:     `1px solid ${!completionNote.trim() ? '#e5e7eb' : '#bbf7d0'}`,
                                      }}
                                    >
                                      {completingFollowup ? '…' : 'Confirm Documentation Reviewed'}
                                    </button>
                                    <button
                                      onClick={() => { setCompletingFollowupId(null); setCompletionNote(''); setCompletionMethod('') }}
                                      style={{ padding:'5px 12px', fontSize:12, fontWeight:600, background:'#f3f4f6', color:'#6b7280', border:'none', borderRadius:6, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              ) : null /* safety — button guard blocks unsupported types from reaching this */}
                            </div>
                          )}
                          {/* Completion note display (for completed followups with notes) */}
                          {f.status === 'completed' && f.note && (
                            <div style={{ marginLeft:23, marginTop:2, fontSize:11, color:'var(--text-secondary,#6b7280)', fontStyle:'italic' }}>
                              "{f.note}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* All follow-ups complete badge */}
                    {dispositionFollowups.every(f => f.status !== 'pending') && (
                      <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#166534', fontWeight:600 }}>
                        <span>✓</span><span>All follow-ups complete</span>
                      </div>
                    )}
                  </div>
                )}
                {/* Internal note (Owner/Admin only — RLS-gated) — Phase 2B.2f */}
                {canEdit && privateNote?.internal_note && (
                  <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--border-lt,#e5e7eb)' }}>
                    <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', color:'var(--text-secondary,#6b7280)', marginBottom:8 }}>
                      Internal Note · Owner/Admin only
                    </div>
                    <div style={{ background:'rgba(244,220,176,0.18)', border:'1px solid #f0c9b0', borderRadius:8, padding:'10px 12px', fontSize:13, lineHeight:1.55, color:'var(--raven,#111827)', whiteSpace:'pre-wrap' }}>
                      {privateNote.internal_note}
                    </div>
                    <div style={{ fontSize:11, color:'var(--text-secondary,#6b7280)', marginTop:6 }}>
                      Recorded by {privateNote.created_by_name || '—'} on {new Date(privateNote.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                      {privateNote.updated_at && privateNote.updated_at !== privateNote.created_at && (
                        <> · Updated {new Date(privateNote.updated_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</>
                      )}
                    </div>
                  </div>
                )}
                {canEdit && (
                  <div style={{ marginTop:14, display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button
                      onClick={handleUpdateDisposition}
                      style={{ fontSize:12, color:'#1D2567', background:'#f0f3ff', border:'1px solid #e0e7ff', borderRadius:6, padding:'5px 14px', cursor:'pointer', fontFamily:'DM Sans,sans-serif', fontWeight:600 }}
                    >
                      Update Disposition
                    </button>
                    <button
                      onClick={handleOpenClearDisposition}
                      style={{ fontSize:12, color:'#92400e', background:'#fdf6ec', border:'1px solid #f0c9b0', borderRadius:6, padding:'5px 14px', cursor:'pointer', fontFamily:'DM Sans,sans-serif', fontWeight:600 }}
                    >
                      Clear Disposition
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:10, padding:'4px 0' }}>
                {/* STUDENT-PROFILE-CANON-1E: status/disposition inconsistency warning (non-blocking). */}
                {data.status === 'Not Proceeding' && (
                  <div style={{ background:'#fdf6ec', border:'1px solid #f0c9b0', borderRadius:8, padding:'8px 12px', fontSize:12.5, lineHeight:1.5, color:'#583733', fontWeight:600 }}>
                    This student’s status is Not Proceeding but there is no active disposition. Verify this is intentional.
                  </div>
                )}
                <span style={{ fontSize:13, color:'var(--text-secondary,#6b7280)' }}>No disposition recorded.</span>
                {canEdit && (
                  <button
                    onClick={handleUpdateDisposition}
                    style={{ fontSize:12, color:'#1D2567', background:'#f0f3ff', border:'1px solid #e0e7ff', borderRadius:6, padding:'5px 14px', cursor:'pointer', fontFamily:'DM Sans,sans-serif', fontWeight:600 }}
                  >
                    Update Program Disposition
                  </button>
                )}
              </div>
            )}
          </div>

          {/* (Old Documents section below — hidden since moved above) */}
          {false && <div className="sp-section sp-card" style={{ background:'rgba(244,220,176,0.12)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Documents (duplicate — hidden)" icon={<FileText size={13} />} />
            <div className="doc-section">
              <div className="doc-upload-area">
                <div className="doc-area-label">Resume</div>
                <input ref={resumeRef} type="file" style={{ display:'none' }} accept=".pdf,.doc,.docx"
                  onChange={e => handleResumeUpload(e.target.files[0])} />
                {data.resume_url ? (
                  <div className="doc-existing-file">
                    <a className="doc-file-link" href={data.resume_url} target="_blank" rel="noopener noreferrer">
                      {decodeURIComponent(data.resume_url.split('/').pop()?.split('?')[0] || 'Resume')}
                    </a>
                    <button onClick={() => doDownload(data.resume_url, buildStudentFilename(student,'resume'), setDlResume)}
                      disabled={dlResume}
                      style={{ background:'var(--pearl)', border:'1px solid var(--nightfall)', color:'var(--nightfall)',
                        fontSize:11, fontWeight:600, borderRadius:6, padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>
                      {dlResume ? '…' : '↓ Resume'}
                    </button>
                    <button className="doc-replace-btn" disabled={uploadingRes} onClick={() => resumeRef.current?.click()}>Replace</button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => resumeRef.current?.click()}>
                    <span className="doc-zone-icon">📄</span>
                    <span className="doc-zone-text">Upload Resume (PDF/Word, max 10MB)</span>
                    <button type="button" className="doc-zone-btn" onClick={e => { e.stopPropagation(); resumeRef.current?.click() }}>Choose File</button>
                  </div>
                )}
                {uploadingRes && <span className="doc-status doc-uploading">Uploading…</span>}
                {resumeMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded</span>}
                {resumeMsg && resumeMsg !== 'success' && <span className="doc-status doc-error" style={{ color:'var(--cs-red)' }}>{resumeMsg}</span>}
              </div>
              <div className="doc-upload-area">
                <div className="doc-area-label">Headshot</div>
                <input ref={headshotRef} type="file" style={{ display:'none' }} accept=".jpg,.jpeg,.png"
                  onChange={e => handleHeadshotUpload(e.target.files[0])} />
                {data.headshot_url ? (
                  <div className="doc-existing-file">
                    <img src={data.headshot_url} alt="Headshot" className="doc-headshot-preview" />
                    <button onClick={() => doDownload(data.headshot_url, buildStudentFilename(student,'headshot'), setDlPhotoDoc)}
                      disabled={dlPhotoDoc}
                      style={{ background:'var(--pearl)', border:'1px solid var(--nightfall)', color:'var(--nightfall)',
                        fontSize:11, fontWeight:600, borderRadius:6, padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>
                      {dlPhotoDoc ? '…' : '↓ Photo'}
                    </button>
                    <button className="doc-replace-btn" disabled={uploadingHead} onClick={() => headshotRef.current?.click()}>Replace</button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => headshotRef.current?.click()}>
                    <span className="doc-zone-icon">🖼</span>
                    <span className="doc-zone-text">Upload Headshot (JPG/PNG, max 5MB)</span>
                    <button type="button" className="doc-zone-btn" onClick={e => { e.stopPropagation(); headshotRef.current?.click() }}>Choose File</button>
                  </div>
                )}
                {uploadingHead && <span className="doc-status doc-uploading">Uploading…</span>}
                {headMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded</span>}
                {headMsg && headMsg !== 'success' && <span className="doc-status doc-error" style={{ color:'var(--cs-red)' }}>{headMsg}</span>}
              </div>
            </div>
          </div>}

          {/* Clinical Hours */}
          <div className="sp-section">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontFamily:'DM Sans,sans-serif', fontWeight:700, fontSize:12, color:'#374151', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Clinical Hours
              </span>
              <SyncIndicator display={hoursSyncDisplay} align="right" />
            </div>
            {/* ROTATION-ACTIVITY-CLINICAL-HOURS-DETAILS: extracted to the shared ClinicalHoursPanel
                (totals + shift-log table + Shift Details modal). Same component now also powers
                Rotation > Activity > Active Rotation Progress. */}
            <ClinicalHoursPanel student={data} shiftLogs={shiftLogs} />
          </div>

          {/* 10. Notes */}
          <div className="sp-section sp-card sp-zone-records">
            <SectionHeader title="Notes" icon={<ClipboardList size={13} />} />
            <Field label="" fieldKey="notes">
              <textarea className="sp-textarea" rows={4} value={data.notes||''} onChange={e => handleText('notes', e.target.value)} placeholder="Add notes…" />
            </Field>
          </div>

          {/* Program Timeline — data collection in program_events continues; UI not rendered */}
          {false && <div className="sp-section">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Program Timeline
              </div>
              <button onClick={() => setShowEventForm(p => !p)}
                style={{ fontSize:12, color:'var(--nightfall)', background:'none', border:'1px solid var(--nightfall)', borderRadius:6, padding:'3px 10px', cursor:'pointer', fontFamily:'DM Sans,sans-serif' }}>
                {showEventForm ? 'Cancel' : '+ Add Event'}
              </button>
            </div>

            {showEventForm && (
              <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:12, marginBottom:12 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{ fontSize:11, fontWeight:600, color:'#6b7280', display:'block', marginBottom:3 }}>Event Type</label>
                    <select className="sp-select" value={newEvent.event_type}
                      onChange={e => setNewEvent(p => ({ ...p, event_type: e.target.value }))}>
                      {EVENT_TYPES.filter(t => t.manual).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:600, color:'#6b7280', display:'block', marginBottom:3 }}>Date *</label>
                    <input className="sp-input" type="date" value={newEvent.event_date}
                      onChange={e => setNewEvent(p => ({ ...p, event_date: e.target.value }))} />
                  </div>
                </div>
                <div style={{ marginBottom:8 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#6b7280', display:'block', marginBottom:3 }}>Time (optional)</label>
                  <input className="sp-input" type="time" value={newEvent.event_time}
                    onChange={e => setNewEvent(p => ({ ...p, event_time: e.target.value }))} style={{ maxWidth:130 }} />
                </div>
                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#6b7280', display:'block', marginBottom:3 }}>Notes (optional)</label>
                  <input className="sp-input" type="text" value={newEvent.notes}
                    onChange={e => setNewEvent(p => ({ ...p, notes: e.target.value }))} placeholder="Optional note…" />
                </div>
                <button onClick={handleAddEvent} disabled={!newEvent.event_date || savingEvent}
                  style={{ background:'var(--nightfall)', color:'#fff', border:'none', borderRadius:6, padding:'6px 14px', fontFamily:'DM Sans,sans-serif', fontWeight:600, fontSize:13, cursor:'pointer' }}>
                  {savingEvent ? 'Saving…' : 'Save Event'}
                </button>
              </div>
            )}

            {studentEvents.length === 0 ? (
              <p style={{ fontSize:13, color:'#9ca3af', fontStyle:'italic', margin:0 }}>No events logged yet.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {studentEvents.map(ev => (
                  <div key={ev.id} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                    <div style={{ width:10, height:10, borderRadius:'50%', background:getEventColor(ev.event_type), marginTop:3, flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#1d2567', fontFamily:'DM Sans,sans-serif', display:'flex', alignItems:'center', gap:4 }}>
                        {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                        {ev.created_by === 'system' && (
                          <span style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:600, background:'#f0f9ff', color:'#0369a1', border:'1px solid #bae6fd', borderRadius:4, padding:'1px 5px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Auto</span>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:'#6b7280', fontFamily:'DM Sans,sans-serif' }}>
                        {ev.event_date}{ev.event_time ? ` · ${ev.event_time}` : ''}{ev.notes ? ` · ${ev.notes}` : ''}
                      </div>
                    </div>
                    <Tooltip label="Delete event" placement="top">
                    <button onClick={() => handleDeleteEvent(ev.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#d1d5db', padding:'0 2px', lineHeight:1 }}
                      aria-label="Delete event"
                      onMouseEnter={e => e.currentTarget.style.color='#991b1b'}
                      onMouseLeave={e => e.currentTarget.style.color='#d1d5db'}>✕</button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>}

          {/* Communication History (Phase D.2) — recent notification_log sends, all-time, latest 5 */}
          {/* STUDENT-PROFILE-UX-1B: wrapped as a records-zone card to match Notes (styling only). */}
          <div className="sp-section sp-card sp-zone-records">
            <SectionHeader title="Recent Communications" icon={<MessageSquare size={13} />} />
            {recentComms.length === 0 ? (
              <div style={{ fontSize:12, color:'var(--text-secondary,#6b7280)', fontFamily:'DM Sans,sans-serif', padding:'2px 0 8px' }}>
                No communications recorded yet for this student.
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:8 }}>
                {recentComms.map(c => (
                  <div key={c.id} style={{ display:'flex', flexDirection:'column', gap:2 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'#374151', fontFamily:'DM Sans,sans-serif', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.subject || commTypeLabel(c.notification_type)}
                    </div>
                    <div style={{ fontSize:11, color:'#9ca3af', fontFamily:'DM Sans,sans-serif' }}>
                      {commTypeLabel(c.notification_type)} · {c.status || 'unknown'} · {fmtCommDate(c.sent_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => navigate(`/connect/outreach?tab=sent_history&student_id=${student.id}`)}
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:11, fontWeight:600, color:'#1D2567', fontFamily:'DM Sans,sans-serif' }}
            >
              View all communications for this student →
            </button>
          </div>

          </div>{/* end unified section container */}

          {/* Delete — STUDENT-PROFILE-UX-1B: intentional, labeled danger zone, visually separated
              from the Prev/Next footer. Button behavior + confirm modal unchanged. */}
          <div className="sp-danger-zone">
            <div className="sp-danger-zone-label">Danger Zone</div>
            <button className="btn btn-destructive" onClick={() => setConfirmDelete(true)}>Delete Student</button>
          </div>

          {/* Prev / Next */}
          {/* Download error toast */}
          {downloadErr && (
            <div style={{ margin:'8px 16px', padding:'10px 14px', background:'#fee2e2',
              border:'1px solid #fca5a5', borderRadius:8, fontSize:13, color:'#991b1b', lineHeight:1.5 }}>
              {downloadErr}
            </div>
          )}

          <div className="sp-nav-row">
            <button className="sp-nav-btn" disabled={!prevStudent} onClick={() => prevStudent && onSelectStudent(prevStudent.id)}>
              ← {prevStudent ? displayName(prevStudent) : 'No previous'}
            </button>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
              {currentIndex + 1} / {sortedStudents.length}
            </span>
            <button className="sp-nav-btn" disabled={!nextStudent} onClick={() => nextStudent && onSelectStudent(nextStudent.id)}>
              {nextStudent ? displayName(nextStudent) : 'No next'} →
            </button>
          </div>
        </div>
        </FieldSavedCtx.Provider>
      </div>

      <PreceptorAssignmentModal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        student={data}
        onAssigned={(preceptor) => {
          setData(prev => ({
            ...prev,
            preceptor_id:      preceptor.id,
            matched_preceptor: preceptor.full_name,
            preceptor_email:   preceptor.email,
          }))
          toast?.success('Preceptor assigned', `${preceptor.full_name} linked to ${student.first_name}.`)
          setAssignModalOpen(false)
        }}
      />

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`Delete ${displayName(student)}?`}
          warning="This action cannot be undone. Any match assignments for this student will also be cleared."
          onConfirm={() => { setConfirmDelete(false); onDelete(student.id); onClose() }}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      {showDispositionModal && (
        <DispositionModal
          isOpen={showDispositionModal}
          onClose={() => setShowDispositionModal(false)}
          student={{
            id:           student.id,
            first_name:   student.first_name,
            last_name:    student.last_name,
            school:       student.school,
            program_type: student.program_type,
            status:       data.status,
          }}
          cohort={{
            id:   student.cohort_id,
            name: student.aspire_cohort,
          }}
          toast={toast}
          onSuccess={handleDispositionSuccess}
          initialValues={activeDisposition ? {
            disposition_type: activeDisposition.disposition_type,
            reason_category:  activeDisposition.reason_category,
            effective_date:   activeDisposition.effective_date,
            internal_note:    privateNote?.internal_note || '',
          } : null}
        />
      )}

      {/* STUDENT-PROFILE-CANON-1E: Clear Disposition confirmation. Clearing inactivates the
          active disposition (no hard delete, history preserved) and does NOT change status. */}
      {showClearModal && activeDisposition && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:3000,
          display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onMouseDown={() => !clearing && setShowClearModal(false)}>
          <div style={{ background:'#fff', borderRadius:14, maxWidth:460, width:'100%',
            padding:'22px 24px 20px', fontFamily:'DM Sans, sans-serif',
            boxShadow:'0 20px 50px rgba(0,0,0,0.18)' }}
            onMouseDown={e => e.stopPropagation()}>
            <div style={{ fontWeight:700, fontSize:16, color:'#1D2567', marginBottom:10 }}>
              Clear Disposition
            </div>
            <div style={{ fontSize:13, color:'#374151', lineHeight:1.6, marginBottom:12 }}>
              <div style={{ marginBottom:6 }}>
                <strong>{student.first_name} {student.last_name}</strong>
              </div>
              <div style={{ marginBottom:10 }}>
                Active disposition:{' '}
                <strong>{DISPOSITION_TYPES[activeDisposition.disposition_type] || activeDisposition.disposition_type}</strong>
              </div>
              This will clear the active disposition. It will not change the student’s status.
              The previous record is preserved in the audit trail.
            </div>

            {data.status === 'Not Proceeding' && (
              <div style={{ background:'#fdf6ec', border:'1px solid #f0c9b0', borderRadius:8,
                padding:'8px 12px', fontSize:12.5, lineHeight:1.5, color:'#583733', fontWeight:600, marginBottom:12 }}>
                This student’s status will remain Not Proceeding. If that is no longer accurate,
                update status separately after clearing.
              </div>
            )}

            <label style={{ display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
              letterSpacing:'0.05em', color:'#6b7280', marginBottom:5 }}>
              Reason (optional)
            </label>
            <textarea
              className="form-input"
              value={clearReason}
              onChange={e => setClearReason(e.target.value)}
              placeholder="Why is this disposition being cleared?"
              rows={3}
              maxLength={1000}
              style={{ width:'100%', resize:'vertical', fontFamily:'DM Sans', fontSize:13, lineHeight:1.5, marginBottom:12 }}
            />

            {clearError && (
              <div className="error-msg" style={{ marginBottom:12 }}>{clearError}</div>
            )}

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button onClick={() => setShowClearModal(false)} disabled={clearing}
                style={{ padding:'9px 18px', borderRadius:8, border:'1px solid #e5e7eb',
                  background:'#f9fafb', fontFamily:'DM Sans', fontWeight:600, fontSize:13,
                  cursor: clearing ? 'not-allowed' : 'pointer', color:'#374151' }}>
                Cancel
              </button>
              <button onClick={handleConfirmClearDisposition} disabled={clearing}
                style={{ padding:'9px 18px', borderRadius:8, border:'none',
                  background:'#92400e', fontFamily:'DM Sans', fontWeight:700, fontSize:13,
                  cursor: clearing ? 'not-allowed' : 'pointer', color:'#fff' }}>
                {clearing ? 'Clearing…' : 'Clear Disposition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeclineModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16,
            padding: 28, width: 400,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 18, color: '#1d2567', marginBottom: 8 }}>
              Decline Student
            </div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
              Please select a reason for declining this student. This will be recorded for program reporting.
            </div>
            <select
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px',
                border: '1px solid #e5e7eb', borderRadius: 8,
                fontFamily: 'DM Sans', fontSize: 14,
                marginBottom: 20,
              }}
            >
              <option value="">Select a reason...</option>
              {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowDeclineModal(false); setDeclineReason('') }}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  border: '1px solid #e5e7eb', background: '#f9fafb',
                  fontFamily: 'DM Sans', cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={confirmDecline}
                disabled={!declineReason}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: declineReason ? '#dc1e34' : '#e5e7eb',
                  border: 'none', color: '#fff',
                  fontFamily: 'DM Sans', fontWeight: 600,
                  cursor: declineReason ? 'pointer' : 'default',
                }}
              >Confirm Decline</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
