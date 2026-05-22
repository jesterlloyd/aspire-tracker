import { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
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
import { calculateProfileCompletion, getCompletionColor } from '../lib/profileCompletion'
import { generateStudentSummary } from '../lib/generateSummary'
import { Copy, Check, Mail, User, GraduationCap, Briefcase, MapPin, FileText, MessageSquare, CheckCircle2, Award, ClipboardList, CalendarDays } from 'lucide-react'
// All external navigation must use openLink helpers (src/lib/openLink.js)
import { openMailtoLink } from '../lib/openLink'
import SyncIndicator from './SyncIndicator'
import { useLastSynced } from '../hooks/useLastSynced'
import { useAuth } from '../contexts/AuthContext'
import { logActivity } from '../lib/logActivity'
import ConflictDialog from './ConflictDialog'
import { generateBadgePNGs, calculateBadgeDates } from '../lib/badgeGenerator'

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

function SectionHeader({ title, icon, children }) {
  return (
    <div className="sp-section-hdr" style={{ display:'flex', alignItems:'center', gap:7 }}>
      {icon && <span style={{ opacity:0.65, flexShrink:0 }}>{icon}</span>}
      <span style={{ flex:1, textTransform:'uppercase', letterSpacing:'0.1em', fontSize:11 }}>{title}</span>
      {children}
    </div>
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
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [declineReason,    setDeclineReason]    = useState('')
  const [summaryCopied,    setSummaryCopied]    = useState(false)
  const { canEdit, canInterview, userProfile } = useAuth()
  const queryClient = useQueryClient()
  const [uploadingRes,  setUploadingRes]  = useState(false)
  const [uploadingHead, setUploadingHead] = useState(false)
  const [resumeMsg,     setResumeMsg]     = useState(null)
  const [headMsg,       setHeadMsg]       = useState(null)
  const timerRef        = useRef(null)
  const pendingNameSave = useRef(null)
  const resumeRef       = useRef(null)
  const headshotRef     = useRef(null)

  // ── Rotation Dates panel ─────────────────────────────────────────────────
  const [editingRotation,       setEditingRotation]       = useState(false)
  const [rotEditStart,          setRotEditStart]          = useState('')
  const [rotEditEnd,            setRotEditEnd]            = useState('')
  const [rotEditError,          setRotEditError]          = useState(null)
  const [rotSaving,             setRotSaving]             = useState(false)
  const [rotConfirmModal,       setRotConfirmModal]       = useState(null)
  // rotConfirmModal: { start, end, count } when open

  const { data: rotationRow, refetch: refetchRotation } = useQuery({
    queryKey: ['cohort_school_rotation', student.cohort_school_rotation_id],
    queryFn: async () => {
      if (!student.cohort_school_rotation_id) return null
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('id, school_name, rotation_start_date, rotation_end_date, coordinator_name, coordinator_email')
        .eq('id', student.cohort_school_rotation_id)
        .single()
      if (error) { console.warn('rotation row fetch:', error.message); return null }
      return data
    },
    enabled: !!student.cohort_school_rotation_id,
    staleTime: 60_000,
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
      const res = await fetch('/api/update-rotation-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const handleApproveShift = async (log) => {
    const hours = parseFloat(log.total_hours||0)
    await supabase.from('student_shift_logs').update({
      status: 'Approved', reviewed_at: new Date().toISOString(), reviewed_by: 'Admin',
    }).eq('id', log.id)
    const newApproved = parseFloat(data.approved_hours||0) + hours
    const newPending  = Math.max(0, parseFloat(data.pending_hours||0) - hours)
    await onUpdate(student.id, { approved_hours: newApproved, pending_hours: newPending })
    setData(p => ({ ...p, approved_hours: newApproved, pending_hours: newPending }))
    queryClient.setQueryData(['student_shift_logs', student.id], (prev = []) =>
      prev.map(l => l.id===log.id ? { ...l, status:'Approved', reviewed_at: new Date().toISOString() } : l))
    toast?.success('Shift approved', `${hours} hours approved for ${student.first_name}.`)
  }

  const handleRejectShift = async (log) => {
    const hours = parseFloat(log.total_hours||0)
    await supabase.from('student_shift_logs').update({
      status: 'Rejected', reviewed_at: new Date().toISOString(), reviewed_by: 'Admin',
    }).eq('id', log.id)
    const newPending = Math.max(0, parseFloat(data.pending_hours||0) - hours)
    await onUpdate(student.id, { pending_hours: newPending })
    setData(p => ({ ...p, pending_hours: newPending }))
    queryClient.setQueryData(['student_shift_logs', student.id], (prev = []) =>
      prev.map(l => l.id===log.id ? { ...l, status:'Rejected' } : l))
  }

  const handleAdjustShift = async (log) => {
    const newHours = parseFloat(adjustHours)
    if (isNaN(newHours) || newHours <= 0) return
    const oldHours = parseFloat(log.total_hours||0)
    const diff = newHours - oldHours
    await supabase.from('student_shift_logs').update({ total_hours: newHours, reviewed_at: new Date().toISOString(), reviewed_by: 'Admin' }).eq('id', log.id)
    if (['Auto-Accepted', 'Approved'].includes(log.status)) {
      const newApproved = Math.max(0, parseFloat(data.approved_hours||0) + diff)
      await onUpdate(student.id, { approved_hours: newApproved })
      setData(p => ({ ...p, approved_hours: newApproved }))
    } else if (log.status === 'Pending Review') {
      const newApproved = parseFloat(data.approved_hours||0) + newHours
      const newPending  = Math.max(0, parseFloat(data.pending_hours||0) - oldHours)
      await onUpdate(student.id, { approved_hours: newApproved, pending_hours: newPending })
      setData(p => ({ ...p, approved_hours: newApproved, pending_hours: newPending }))
    }
    queryClient.setQueryData(['student_shift_logs', student.id], (prev = []) =>
      prev.map(l => l.id===log.id ? { ...l, total_hours: newHours, status:'Approved' } : l))
    setAdjustingId(null); setAdjustHours('')
  }

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
  const [showEventForm,   setShowEventForm]   = useState(false)
  const [savingEvent,     setSavingEvent]     = useState(false)
  const [newEvent, setNewEvent] = useState({ event_type: 'note', event_date: '', event_time: '', notes: '' })

  const handleAddEvent = async () => {
    if (!newEvent.event_date) return
    setSavingEvent(true)
    const { data } = await supabase.from('program_events').insert({
      student_id:  student.id,
      cohort_id:   student.cohort_id,
      event_type:  newEvent.event_type,
      event_date:  newEvent.event_date,
      event_time:  newEvent.event_time || null,
      notes:       newEvent.notes,
      created_by:  'coordinator',
    }).select().single()
    if (data) {
      queryClient.setQueryData(['student_program_events', student.id], (prev = []) => [data, ...prev])
    }
    setNewEvent({ event_type: 'note', event_date: '', event_time: '', notes: '' })
    setShowEventForm(false)
    setSavingEvent(false)
  }

  const handleDeleteEvent = async (id) => {
    await supabase.from('program_events').delete().eq('id', id)
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
      updated.name = `${updated.first_name||''} ${updated.last_name||''}`.trim()
      pendingNameSave.current = { first_name: updated.first_name||'', last_name: updated.last_name||'', name: updated.name }
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
  const badgeDisabledReason = !data.headshot_url
    ? 'Headshot required'
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
                  {/* Name */}
                  <div style={{ fontSize:22, fontWeight:700, color:'var(--nightfall)', marginBottom:4, lineHeight:1.2 }}>
                    {student.first_name} {student.last_name}
                  </div>
                  {/* School · Program */}
                  <div style={{ fontSize:13, color:'#6b7280', marginBottom:8 }}>
                    {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
                  </div>
                  {/* ASPIRE status pill */}
                  {data.status && (() => {
                    const cfg = ASPIRE_STATUS_CONFIG[data.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']
                    return <div style={{ marginBottom:12 }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                        background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}` }}>
                        {data.status}
                      </span>
                    </div>
                  })()}
                  {/* Contact icons */}
                  <div style={{ display:'flex', justifyContent:'center', gap:22, marginBottom:10 }}>
                    <button title="Send email" onClick={() => openMailtoLink(`mailto:${data.personal_email||data.school_email||''}`)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:17, color:'#6b7280', lineHeight:1 }}>✉</button>
                    <button title="Call" onClick={() => { if(data.phone){ const a=document.createElement('a'); a.href=`tel:${data.phone}`; a.click() } }}
                      style={{ background:'none', border:'none', cursor:data.phone?'pointer':'default', fontSize:17, color:data.phone?'#6b7280':'#d1d5db', lineHeight:1 }}>📞</button>
                    <button title="Edit profile" onClick={() => { const inp=document.querySelector('.sp-content .sp-input'); if(inp){inp.scrollIntoView({behavior:'smooth',block:'center'}); inp.focus()} }}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:17, color:'#6b7280', lineHeight:1 }}>✏</button>
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
          <div className="sp-section sp-card" style={{ background:'rgba(100,130,200,0.06)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Contact Information" icon={<Mail size={13} />} />
            <Field label="School Email">
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <div className="sp-readonly">{data.school_email || '—'}</div>
                {data.school_email && (
                  <button className="sp-copy-btn" onClick={() => navigator.clipboard?.writeText(data.school_email)} title="Copy">⎘</button>
                )}
              </div>
            </Field>
            {data.status === 'Form Received' && data.school_email && (
              <div style={{ marginTop:8 }}>
                <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px' }}
                  onClick={() => {
                    const subject = 'Schedule Your ASPIRE Interview'
                    const body = `Dear ${data.first_name || 'ASPIRE Student'},\n\nThank you for completing your ASPIRE Student Profile. The next step in the process is to schedule your interview with the Nursing Professional Development team.\n\nPlease use the link below to view available times and select one that works for your schedule:\n\nhttps://aspire-tracker.vercel.app/interview-schedule\n\nWhen prompted, enter your school email address to access your scheduling page.\n\nYour interview will be conducted via Microsoft Teams. The meeting link will be sent to you separately after you book your slot.\n\nIf you have any questions, please don't hesitate to reach out.\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nBrawerman Nursing Institute | Cedars-Sinai Medical Center\nJesterLloyd.Bautista@cshs.org | 310-248-8964`
                    openMailtoLink(`mailto:${encodeURIComponent(data.school_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
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
          <div className="sp-section sp-card" style={{ background:'rgba(244,241,236,0.6)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Personal Information" icon={<User size={13} />} />
            <div className="sp-grid-2">
              <Field label="First Name" fieldKey="first_name">
                <input className="sp-input" value={data.first_name||''} onChange={e => handleNameField('first_name', e.target.value)} />
              </Field>
              <Field label="Last Name" fieldKey="last_name">
                <input className="sp-input" value={data.last_name||''} onChange={e => handleNameField('last_name', e.target.value)} />
              </Field>
              <Field label="Date of Birth" fieldKey="date_of_birth">
                <input className="sp-input" type="date" value={data.date_of_birth||''} onChange={e => handleText('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Last 4 SSN">
                <div style={{ display:'flex', gap:6 }}>
                  <input className="sp-input" type={showSSN ? 'text' : 'password'} maxLength={4}
                    value={data.ssn_last4||''} onChange={e => handleText('ssn_last4', e.target.value.replace(/\D/g,'').slice(0,4))} />
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

          {/* 3. Program Details */}
          <div className="sp-section sp-card" style={{ background:'rgba(200,213,192,0.12)', borderRadius:12, marginBottom:10 }}>
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
              {/* term_dates kept for legacy read-only display; new submissions use cohort_school_rotation_id */}
              {data.term_dates && <Field label="Term Dates (legacy)"><div className="sp-readonly">{data.term_dates}</div></Field>}
              <Field label="Hours Required" fieldKey="hours_required">
                <input className="sp-input" type="text" inputMode="numeric" pattern="[0-9]*"
                  value={data.hours_required??''} onChange={e => handleText('hours_required', e.target.value)} />
              </Field>
              <Field label="Est. Graduation"><div className="sp-readonly">{data.estimated_graduation||'—'}</div></Field>
            </div>
          </div>

          {/* 3b. Rotation Dates */}
          {(rotationRow || student.cohort_school_rotation_id) && (
            <div className="sp-section sp-card" style={{ background:'rgba(199,219,230,0.18)', borderRadius:12, marginBottom:10 }}>
              <SectionHeader title="Rotation Dates" icon={<CalendarDays size={13} />}
                children={canEdit && !editingRotation && (
                  <button
                    onClick={handleOpenRotationEdit}
                    style={{ fontSize:11, fontWeight:600, padding:'2px 10px', borderRadius:6,
                      background:'#f0f3ff', border:'1px solid #e0e7ff', color:'#1D2567',
                      cursor:'pointer', fontFamily:'DM Sans,sans-serif' }}>
                    Edit
                  </button>
                )}
              />

              {isSentinel && (
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px',
                  background:'#fdf6ec', border:'1px solid #f0c9b0', borderRadius:8, marginBottom:8,
                  fontFamily:'DM Sans', fontSize:12, color:'#583733', fontWeight:600 }}>
                  <span>&#9651;</span>
                  Rotation dates pending: please set actual dates
                </div>
              )}

              {!editingRotation ? (
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
          )}

          {/* 4. Background and Affiliation */}
          <div className="sp-section sp-card" style={{ background:'rgba(234,220,196,0.20)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Background and Affiliation" icon={<Briefcase size={13} />} />
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
          <div className="sp-section sp-card" style={{ background:'rgba(79,109,168,0.06)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Unit Placement Preferences" icon={<MapPin size={13} />} />
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
          <div className="sp-section sp-card" style={{ background:'rgba(244,220,176,0.12)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Documents" icon={<FileText size={13} />} />
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
                      <button
                        onClick={handleDownloadBadge}
                        disabled={!!badgeDisabledReason || generatingBadge}
                        title={badgeDisabledReason || 'Download front + back badge PNGs'}
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
          <div className="sp-section sp-card" style={{ background:'rgba(226,86,156,0.05)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Interest Statement" icon={<MessageSquare size={13} />} />
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
              <Field label="Interview Outcome">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.interview_outcome && (
                    <span className={`interview-pill ${ data.interview_outcome === 'Accepted' ? 'pill-green' : data.interview_outcome === 'Accepted with Reservations' ? 'pill-yellow' : data.interview_outcome === 'Declined' ? 'pill-red' : 'pill-gray' }`}>{data.interview_outcome}</span>
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
                    <button className="sp-copy-btn" title="Email preceptor"
                      onClick={() => { openMailtoLink(`mailto:${data.preceptor_email}`) }}>✉</button>
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
          {canEdit && <div className="sp-section sp-card" style={{ background:'rgba(250,250,250,0.9)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="CS-Link Access" icon={<CheckCircle2 size={13} />}>
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
                        <input className="csw-date-input" value={data.cs_stage1_submitted_date||''}
                          placeholder="Date" onChange={e => handleText('cs_stage1_submitted_date', e.target.value)} />
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
                        <input className="csw-date-input" value={data.cs_stage1_submitted_date||''}
                          placeholder="Date" onChange={e => handleText('cs_stage1_submitted_date', e.target.value)} />
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
                        <input className="csw-date-input" value={data.cs_stage1_complete_date||''}
                          placeholder="Date" onChange={e => handleText('cs_stage1_complete_date', e.target.value)} />
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
                    <input className="csw-date-input" value={data.cs_link_requested_date||''}
                      placeholder="Date" onChange={e => handleText('cs_link_requested_date', e.target.value)} />
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
                      <input className="csw-date-input" value={data.cs_link_complete_date||''}
                        placeholder="Date" onChange={e => handleText('cs_link_complete_date', e.target.value)} />
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
          <div className="sp-section sp-card" style={{ background:'rgba(200,213,192,0.22)', borderRadius:12, marginBottom:10 }}>
            <SectionHeader title="Placement and Outcomes" icon={<Award size={13} />} />
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
                  {data.decline_reason && <div style={{ fontSize:11, color:'#991b1b', marginTop:2 }}>Reason: {data.decline_reason}</div>}
                </div>
              </Field>
              <Field label="Interview Outcome">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.interview_outcome && (
                    <span className={`interview-pill ${ data.interview_outcome === 'Accepted' ? 'pill-green' : data.interview_outcome === 'Accepted with Reservations' ? 'pill-yellow' : data.interview_outcome === 'Declined' ? 'pill-red' : 'pill-gray' }`}>{data.interview_outcome}</span>
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
                  {['Day','Night','Mid','Variable'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Preceptor Email">
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <input className="sp-input" type="email" value={data.preceptor_email||''} onChange={e => handleText('preceptor_email', e.target.value)} placeholder="preceptor@cshs.org" />
                  {data.preceptor_email && <button className="sp-copy-btn" title="Email preceptor" onClick={() => openMailtoLink(`mailto:${data.preceptor_email}`)}>✉</button>}
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
            <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, cursor:'pointer', fontSize:13, color:'var(--raven)' }}>
              <input type="checkbox" checked={!!data.badge_created}
                onChange={e => { handleSelect('badge_created', e.target.checked); if (e.target.checked) { toast?.success('Badge issued', `Badge marked as created for ${student.first_name}.`); logActivity({ userProfile, actionType:'badge_issued', entityType:'student', entityId:student.id, cohortId:student.cohort_id, description:`${userProfile?.full_name} marked badge as created for ${student.first_name} ${student.last_name}` }) } }}
                style={{ width:16, height:16, accentColor:'#16a34a' }} />
              <span>Badge Created</span>
              {data.badge_created && <span style={{ fontSize:12, color:'#166534', fontWeight:600 }}>✓ Badge Created</span>}
            </label>
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
            {/* Summary numbers */}
            {(() => {
              const req = parseFloat(data.hours_required||0)
              const apv = parseFloat(data.approved_hours||0)
              const pnd = parseFloat(data.pending_hours||0)
              const rem = Math.max(0, req - apv)
              const pct = req > 0 ? Math.min(100, (apv/req)*100) : 0
              return (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:10 }}>
                    {[['Required',req],['Approved',apv],['Pending',pnd],['Remaining',rem]].map(([lbl,val]) => (
                      <div key={lbl} style={{ textAlign:'center' }}>
                        <div style={{ fontSize:20, fontWeight:700, color:'var(--nightfall)', lineHeight:1 }}>{val}</div>
                        <div style={{ fontSize:11, fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.04em', marginTop:2 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ height:10, borderRadius:12, background:'#f3f4f6', overflow:'hidden', marginBottom:12 }}>
                    <div style={{ height:'100%', borderRadius:12, width:`${pct}%`,
                      background: pct>=100?'#166534':pct>=80?'#166534':'var(--nightfall)',
                      transition:'width 600ms ease' }}>
                      {pct>=100 && <span style={{fontSize:9,color:'#fff',paddingLeft:4}}>✓</span>}
                    </div>
                  </div>
                </>
              )
            })()}
            {/* Shift log table */}
            {shiftLogs.length === 0 ? (
              <p style={{ fontSize:13, color:'#9ca3af', fontStyle:'italic', margin:0 }}>No shifts logged yet.</p>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'var(--sand)' }}>
                      {['Date','Hrs','Unit','Preceptor','Type','Status',''].map(h => (
                        <th key={h} style={{ padding:'5px 8px', textAlign:'left', fontWeight:700, color:'#6b7280', fontSize:10, textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shiftLogs.map(log => (
                      <tr key={log.id} style={{ borderBottom:'1px solid var(--border-lt)' }}>
                        <td style={{ padding:'6px 8px', whiteSpace:'nowrap' }}>
                          {log.shift_date ? new Date(log.shift_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}
                        </td>
                        <td style={{ padding:'6px 8px', fontWeight:600, color:'var(--nightfall)' }}>{log.total_hours}</td>
                        <td style={{ padding:'6px 8px', color:'#6b7280', maxWidth:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.unit_name||'—'}</td>
                        <td style={{ padding:'6px 8px', color:'#6b7280', maxWidth:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.preceptor_name||'—'}</td>
                        <td style={{ padding:'6px 8px' }}>
                          <span style={{ fontSize:10, padding:'1px 6px', borderRadius:10,
                            background:log.shift_type==='Night'?'#1d2567':'#eff6ff',
                            color:log.shift_type==='Night'?'#fff':'#1d4ed8' }}>{log.shift_type||'Day'}</span>
                        </td>
                        <td style={{ padding:'6px 8px' }}>
                          {(() => {
                            const STATUS_STYLES = {
                              'Auto-Accepted':  { bg:'#D1FAE5', text:'#065F46', label:'Auto-Accepted' },
                              'Pending Review': { bg:'#FEF3C7', text:'#78350F', label:'Pending Review' },
                              'Approved':       { bg:'#DBEAFE', text:'#1E40AF', label:'Approved' },
                              'Rejected':       { bg:'#FEE2E2', text:'#7F1D1D', label:'Rejected' },
                              'Edited':         { bg:'#E0E7FF', text:'#3730A3', label:'Edited' },
                              // legacy values (pre-migration rows)
                              'approved':       { bg:'#D1FAE5', text:'#065F46', label:'Approved' },
                              'needs_review':   { bg:'#FEF3C7', text:'#78350F', label:'Pending Review' },
                              'rejected':       { bg:'#FEE2E2', text:'#7F1D1D', label:'Rejected' },
                            }
                            const s = STATUS_STYLES[log.status] || { bg:'#F3F4F6', text:'#6B7280', label: log.status || '—' }
                            return (
                              <span style={{ fontSize:10, padding:'2px 8px', borderRadius:999, background:s.bg, color:s.text, fontWeight:600, fontFamily:'DM Sans, sans-serif', whiteSpace:'nowrap' }}>
                                {s.label}
                              </span>
                            )
                          })()}
                        </td>
                        <td style={{ padding:'6px 8px', whiteSpace:'nowrap' }}>
                          {['Pending Review', 'needs_review'].includes(log.status) && (
                            adjustingId===log.id ? (
                              <span style={{ display:'flex', gap:4, alignItems:'center' }}>
                                <input type="number" step="0.5" min="0.5" max="14" value={adjustHours}
                                  onChange={e=>setAdjustHours(e.target.value)}
                                  style={{ width:52, padding:'2px 4px', fontSize:12, border:'1px solid #e5e7eb', borderRadius:4 }} />
                                <button onClick={()=>handleAdjustShift(log)} style={{ fontSize:11, padding:'2px 6px', background:'#166534', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}>✓</button>
                                <button onClick={()=>setAdjustingId(null)} style={{ fontSize:11, padding:'2px 6px', background:'#9ca3af', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}>✕</button>
                              </span>
                            ) : (
                              <span style={{ display:'flex', gap:4 }}>
                                <button onClick={()=>handleApproveShift(log)} style={{ fontSize:11, padding:'2px 6px', background:'#166534', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}>Approve</button>
                                <button onClick={()=>{ setAdjustingId(log.id); setAdjustHours(log.total_hours) }} style={{ fontSize:11, padding:'2px 6px', background:'var(--nightfall)', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}>Adjust</button>
                                <button onClick={()=>handleRejectShift(log)} style={{ fontSize:11, padding:'2px 6px', background:'#991b1b', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}>Reject</button>
                              </span>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 10. Notes */}
          <div className="sp-section sp-card" style={{ background:'rgba(244,241,236,0.4)', borderRadius:12, marginBottom:10 }}>
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
                    <button onClick={() => handleDeleteEvent(ev.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#d1d5db', padding:'0 2px', lineHeight:1 }}
                      title="Delete event"
                      onMouseEnter={e => e.currentTarget.style.color='#991b1b'}
                      onMouseLeave={e => e.currentTarget.style.color='#d1d5db'}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>}

          {/* Communication History — data collection in communications table continues; UI not rendered */}

          </div>{/* end unified section container */}

          {/* Delete */}
          <div style={{ padding:'16px 12px', marginTop:4 }}>
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

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`Delete ${displayName(student)}?`}
          warning="This action cannot be undone. Any match assignments for this student will also be cleared."
          onConfirm={() => { setConfirmDelete(false); onDelete(student.id); onClose() }}
          onClose={() => setConfirmDelete(false)}
        />
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
