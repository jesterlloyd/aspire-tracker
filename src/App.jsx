import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './lib/supabase'
import { updateStudent as proxyUpdateStudent } from './lib/studentProxy'
import { displayName } from './lib/utils'
import { ASPIRE_STATUS_CONFIG } from './lib/constants'
import StudentAvatar from './components/StudentAvatar'
import OverviewTab from './components/OverviewTab'
import StudentProfilesTab from './components/StudentProfilesTab'
import InterviewRubricTab from './components/InterviewRubricTab'
import RotationTab from './components/RotationTab'
import EvaluationTab from './components/EvaluationTab'
import AddStudentModal from './components/AddStudentModal'
import UnifiedNav from './components/UnifiedNav'
import NewCohortModal from './components/NewCohortModal'
import ManageCohortModal from './components/ManageCohortModal'
import { useAuth } from './contexts/AuthContext'
import LoginNew from './pages/Login'
import DevDispositionModal from './pages/DevDispositionModal'
import EvaluationPage from './pages/EvaluationPage'
import UserMenu from './components/UserMenu'
import UserManagement from './components/UserManagement'
import UnitFormPage from './components/UnitFormPage'
import SchoolFormPage from './components/SchoolFormPage'
import StudentIntakeFormPage from './components/StudentIntakeFormPage'
import InterviewSchedulePage from './components/InterviewSchedulePage'
import ShiftLogPage from './components/ShiftLogPage'
import InterviewersModal from './components/InterviewersModal'
import ActionCenter from './components/ActionCenter'
import CustomOnboardingTour from './components/CustomOnboardingTour'
import { TOUR_VERSION } from './lib/onboardingTours'
import Keith from './components/Keith'
import FeedbackPanel from './components/FeedbackPanel'
import { logEvent, eventExists } from './lib/logEvent'
import { useToast } from './hooks/useToast'
import { ToastContainer } from './components/Toast'
import { logActivity } from './lib/logActivity'
import { safeWrite } from './lib/safeWrite'
import { MessagesSquare } from 'lucide-react'
import ConnectPage from './pages/Connect'
import Tooltip from './components/ui/Tooltip'

/*
  COHORT ISOLATION CONTRACT

  Every data query MUST filter by activeCohortId.
  Every new record MUST include cohort_id: activeCohortId.
  Switching cohorts MUST clear all local state and refetch.
  App rules (constants, logic, validation) are NEVER cohort-specific.
  Public forms use the cohort where accepting_submissions = true.

  To add a new data type: always include cohort_id in the table,
  always filter by activeCohortId in queries,
  always pass activeCohortId when creating records.
*/

function computeMatchSummary(matchList) {
  const total  = matchList.length
  const top    = matchList.filter(m => m.match_quality === 'top_choice').length
  const second = matchList.filter(m => m.match_quality === 'second_choice').length
  return {
    total_matched:            total,
    top_choice_count:         top,
    second_choice_count:      second,
    other_count:              total - top - second,
    top_choice_percentage:    total > 0 ? Math.round((top    / total) * 100) : 0,
    second_choice_percentage: total > 0 ? Math.round((second / total) * 100) : 0,
  }
}

// ── Header helpers (moved from UnifiedNav) ────────────────────────────────────

const COHORT_STATUS_COLORS = {
  Planning:  { bg:'#dbeafe', color:'#1d4ed8' },
  Active:    { bg:'#dcfce7', color:'#166534' },
  Completed: { bg:'#f3f4f6', color:'#6b7280' },
  Archived:  { bg:'#f3f4f6', color:'#9ca3af' },
}

function fmtCohortDate(d) {
  if (!d) return ''
  const s = typeof d === 'string' ? d : ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, day] = s.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }
  const p = new Date(s); return isNaN(p.getTime()) ? s.replace(/,?\s*\d{4}/,'').trim() : p.toLocaleDateString('en-US', { month:'short', day:'numeric' })
}
function fmtCohortRange(a, b) {
  if (!a && !b) return ''; if (!b) return fmtCohortDate(a)
  return `${fmtCohortDate(a)} – ${fmtCohortDate(b)}`
}

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
}
function HeaderSearchIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}

function LastSyncedIndicator() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('Synced just now')
  useEffect(() => {
    function compute() {
      const qs = queryClient.getQueryCache().getAll()
      const ok = qs.filter(q => q.state.status === 'success' && q.state.dataUpdatedAt)
      if (!ok.length) { setLabel('Not yet synced'); return }
      const newest = Math.max(...ok.map(q => q.state.dataUpdatedAt))
      const s = Math.floor((Date.now() - newest) / 1000)
      if (s < 10) setLabel('Synced just now')
      else if (s < 60) setLabel(`Synced ${s}s ago`)
      else if (s < 3600) setLabel(`Synced ${Math.floor(s/60)}m ago`)
      else setLabel(`Synced ${Math.floor(s/3600)}h ago`)
    }
    compute(); const id = setInterval(compute, 5000); return () => clearInterval(id)
  }, [queryClient])
  return (
    <span style={{ flexShrink:0, fontSize:11.5, color:'rgba(255,255,255,0.55)', fontFamily:'DM Sans, sans-serif', display:'flex', alignItems:'center', gap:5 }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#5DD39E', flexShrink:0, boxShadow:'0 0 0 3px rgba(93,211,158,0.18)' }} />
      {label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab ID ↔ URL path mapping (internal IDs never change; URLs are what's new)
const TAB_TO_PATH = {
  overview:   '/aggregate',
  profiles:   '/students',
  interviews: '/interviews',
  rotation:   '/rotation/matrix',
  evaluation: '/evaluation',
}
const PATH_TO_TAB = {
  '/aggregate':  'overview',
  '/students':   'profiles',
  '/interviews': 'interviews',
  '/evaluation': 'evaluation',
  // /rotation/* handled by startsWith in activeTab derivation below
}
// ─────────────────────────────────────────────────────────────────────────────

function MainApp({ onLogout }) {
  const { toasts, removeToast, toast } = useToast()
  const { userProfile: currentUserProfile, canEdit } = useAuth()

  // One-time cleanup of old shared-password auth storage keys
  useEffect(() => {
    ['aspire_auth', 'aspire_password', 'app_authenticated', 'isAuthenticated'].forEach(key => {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    })
    // Migrate old 'matching' tab id saved in localStorage
    if (localStorage.getItem('aspire_active_tab') === 'matching') {
      localStorage.setItem('aspire_active_tab', 'rotation')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const queryClient = useQueryClient()

  // Cohorts list — org-wide, fetched once at startup
  const { data: cohorts = [] } = useQuery({
    queryKey: ['cohorts_all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cohorts').select('*').order('created_at', { ascending: false })
      if (error) {
        setDbError(error.message)
        setLoading(false)
        throw error
      }
      return data || []
    },
    retry: (failureCount, err) =>
      failureCount < 1 && (err?.message?.toLowerCase().includes('lock') || err?.code === 'PGRST301'),
    retryDelay: 1500,
  })

  const [activeCohortId,   setActiveCohortId]   = useState(null)
  const [showNewCohort,    setShowNewCohort]    = useState(false)
  const [showManageCohort, setShowManageCohort] = useState(false)
  const [confirmLogout,    setConfirmLogout]    = useState(false)
  const [showUserManagement, setShowUserManagement] = useState(false)

  // ── Header: cohort picker state ──────────────────────────────────────────────
  const [cohortOpen, setCohortOpen] = useState(false)
  const cohortPickerRef    = useRef(null)
  const bellRef            = useRef(null)
  const prevWorkspacePath  = useRef('/aggregate')

  // ── Header: search state ─────────────────────────────────────────────────────
  const [searchQuery,     setSearchQuery]     = useState('')
  const [searchOpen,      setSearchOpen]      = useState(false)
  const [searchResults,   setSearchResults]   = useState({ students:[], units:[], placements:[] })
  const [searchLoading,   setSearchLoading]   = useState(false)
  const [searchActiveIdx, setSearchActiveIdx] = useState(-1)
  const [searchFocused,   setSearchFocused]   = useState(false)
  const searchAreaRef  = useRef(null)
  const searchInputRef = useRef(null)
  const searchTimer    = useRef(null)

  const [students,  setStudents]  = useState([])
  const [units,     setUnits]     = useState([])
  const [matches,   setMatches]   = useState([])
  const [interviews, setInterviews] = useState([])
  const [ivSessions,    setIvSessions]    = useState([])
  const [ivSlots,       setIvSlots]       = useState([])
  const [communications,setCommunications]= useState([])
  const [showActionCenter, setShowActionCenter] = useState(false)
  const [tourRunning,      setTourRunning]      = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [dbError,   setDbError]   = useState(null)

  const navigate  = useNavigate()
  const location  = useLocation()
  const activeTab = (() => {
    const p = location.pathname
    if (p.startsWith('/rotation')) return 'rotation'
    if (p.startsWith('/connect'))  return 'connect'
    return PATH_TO_TAB[p] || 'overview'
  })()

  // Track the last non-Connect path for the workspace back affordance.
  // Stored in a ref so it never triggers re-renders.
  useEffect(() => {
    if (!location.pathname.startsWith('/connect')) {
      prevWorkspacePath.current = location.pathname
    }
  }, [location.pathname])

  // Derive back-navigation label from the stored path
  const backPath  = prevWorkspacePath.current || '/aggregate'
  const backLabel = backPath.startsWith('/rotation') ? 'Rotation'
    : backPath === '/students'   ? 'Student Profiles'
    : backPath === '/interviews' ? 'Interviews'
    : backPath === '/evaluation' ? 'Evaluation'
    : 'Aggregate'

  // Redirect / to the last visited tab, or /aggregate as default
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (location.pathname === '/') {
      const saved = localStorage.getItem('aspire_active_tab')
      // migrate old 'matching' tab id
      const resolved = saved === 'matching' ? 'rotation' : saved
      navigate(TAB_TO_PATH[resolved] || '/aggregate', { replace: true })
    }
    if (location.pathname === '/rotation') {
      navigate('/rotation/matrix', { replace: true })
    }
  }, [location.pathname])

  const [profilesView, setProfilesView] = useState('records')
  const [accessFocusId, setAccessFocusId] = useState(null)
  const [showAddModal,       setShowAddModal]       = useState(false)
  const [showInterviewersModal, setShowInterviewersModal] = useState(false)
  const [focusStudentId,     setFocusStudentId]     = useState(null)
  const [highlightUnitId,    setHighlightUnitId]    = useState(null)
  const [search,  setSearch]  = useState('')
  const [filters, setFilters] = useState({ school: '', status: '', cohort: '' })

  // Initialize activeCohortId when the cohorts list first loads from useQuery
  useEffect(() => {
    if (activeCohortId) return  // already set
    if (!cohorts.length) { setLoading(false); return }
    const saved    = localStorage.getItem('aspire_active_cohort_id')
    const restored = saved && cohorts.find(c => c.id === saved)
    setActiveCohortId(restored ? restored.id : (cohorts.find(c => c.status === 'Active') || cohorts[0]).id)
  }, [cohorts]) // eslint-disable-line

  useEffect(() => {
    if (!activeCohortId) return
    // Clear stale data from previous cohort immediately so no cross-cohort bleed
    setStudents([]); setUnits([]); setMatches([]); setInterviews([]); setIvSessions([]); setIvSlots([]); setCommunications([])
    setLoading(true); setDbError(null)
    Promise.all([
      fetchStudents(activeCohortId), fetchUnits(activeCohortId),
      fetchMatches(activeCohortId),  fetchInterviews(activeCohortId),
      fetchIvSessions(activeCohortId), fetchIvSlots(activeCohortId),
      fetchCommunications(activeCohortId),
    ]).finally(() => setLoading(false))
  }, [activeCohortId])

  const fetchStudents  = async id => {
    const { data: rows, error } = await supabase
      .from('students')
      .select('*')
      .eq('cohort_id', id).order('school').order('name')
    if (error) { setDbError(error.message); return }

    const { data: dispositions } = await supabase
      .from('student_active_disposition')
      .select('student_id, disposition_type, reason_category, effective_date, decision_origin, recorded_by_name')
      .eq('cohort_id', id)

    const byStudent = new Map((dispositions || []).map(d => [d.student_id, d]))
    setStudents(rows.map(s => ({ ...s, active_disposition: byStudent.get(s.id) || null })))
  }
  const fetchUnits     = async id => {
    const { data } = await supabase.from('units').select('*').eq('cohort_id', id).order('unit_name')
    setUnits(data || [])
  }
  const fetchMatches   = async id => {
    const { data } = await supabase.from('matches').select('*').eq('cohort_id', id)
    setMatches(data || [])
  }
  const fetchInterviews = async id => {
    const { data } = await supabase.from('interview_rubrics').select('*').eq('cohort_id', id)
    setInterviews(data || [])
  }
  const fetchIvSessions = async id => {
    const { data } = await supabase.from('interview_sessions').select('*').eq('cohort_id', id)
    setIvSessions(data || [])
  }
  const fetchIvSlots = async id => {
    const { data } = await supabase.from('interview_slots').select('*').eq('cohort_id', id)
    setIvSlots(data || [])
  }
  const updateIvSession = (studentId, updates) => {
    setIvSessions(prev => {
      const exists = prev.find(s => s.student_id === studentId)
      if (exists) return prev.map(s => s.student_id === studentId ? { ...s, ...updates } : s)
      return [...prev, { student_id: studentId, cohort_id: activeCohortId, ...updates }]
    })
  }
  const fetchCommunications = async id => {
    const { data } = await supabase.from('communications').select('*').eq('cohort_id', id).order('sent_at', { ascending: false })
    setCommunications(data || [])
  }
  const logCommunication = comm => {
    setCommunications(prev => [comm, ...prev])
  }
  const refreshAll = () => {
    if (!activeCohortId) return
    fetchStudents(activeCohortId); fetchUnits(activeCohortId)
    fetchMatches(activeCohortId);  fetchInterviews(activeCohortId)
    fetchIvSessions(activeCohortId); fetchIvSlots(activeCohortId)
    fetchCommunications(activeCohortId)
  }

  // ── Cohort CRUD ──────────────────────────────────────────────
  const createCohort = async d => {
    const { data, error } = await safeWrite(
      () => supabase.from('cohorts').insert(d).select().single(),
      { name: 'create cohort' }
    )
    if (!error && data) {
      queryClient.setQueryData(['cohorts_all'], prev => [data, ...(prev || [])])
      localStorage.setItem('aspire_active_cohort_id', data.id)
      setActiveCohortId(data.id)
      setStudents([]); setUnits([]); setMatches([]); setInterviews([])
      setShowNewCohort(false)
    }
    return error || null
  }
  const updateCohort = async (id, updates) => {
    if (updates.accepting_submissions === true) {
      await safeWrite(
        () => supabase.from('cohorts').update({ accepting_submissions: false }).neq('id', id),
        { name: 'deactivate other cohorts' }
      )
      queryClient.setQueryData(['cohorts_all'], prev =>
        (prev || []).map(c => c.id !== id ? { ...c, accepting_submissions: false } : c))
    }
    const { error } = await safeWrite(
      () => supabase.from('cohorts').update(updates).eq('id', id),
      { name: 'update cohort' }
    )
    if (!error) {
      queryClient.setQueryData(['cohorts_all'], prev =>
        (prev || []).map(c => c.id === id ? { ...c, ...updates } : c))
    }
    return error || null
  }
  const handleCohortSwitch = id => {
    localStorage.setItem('aspire_active_cohort_id', id)
    setActiveCohortId(id); setSearch(''); setFilters({ school: '', status: '', cohort: '' })
    // Invalidate every cohort-scoped query so all tabs refetch with the new cohort
    ;[
      'embed_student_pool', 'embed_unit_pool', 'embed_matches',
      'kpi_stats', 'clinical_placement_availability', 'student_placement_requests',
      'on_campus_today', 'todays_priorities',
      'program_events',
      'availability_blocks', 'interview_sessions', 'interview_slots', 'preference_counts',
      'students_in_cohort', 'interview_calendar', 'todays_interviews',
      'interview_setup_checklist', 'unit_availability',
      // Child-component queries missing from original list (Fix 2)
      'unit_cohort_responses', 'rubric_support_data', 'units_cohort', 'cohort_school_rotation',
    ].forEach(key => queryClient.invalidateQueries({ queryKey: [key] }))
  }

  // Auto-start welcome tour — re-evaluates whenever the key tour fields change in context
  useEffect(() => {
    if (!currentUserProfile?.auth_user_id || !activeCohortId) return

    const completed = currentUserProfile.onboarding_tour_completed === true &&
                      currentUserProfile.onboarding_tour_version === TOUR_VERSION
    const dismissed = currentUserProfile.onboarding_tour_dismissed === true
    const snoozed   = sessionStorage.getItem('onboarding_tour_snoozed') === 'true'

    if (completed || dismissed || snoozed) {
      setTourRunning(false)  // ensure tour is off if user refreshes after completing
      return
    }

    // Only start if migration has run (column exists as false, not undefined)
    if (currentUserProfile.onboarding_tour_completed !== false) return

    switchTab('overview')
    setTimeout(() => setTourRunning(true), 700)
  }, [ // eslint-disable-line
    currentUserProfile?.auth_user_id,
    currentUserProfile?.onboarding_tour_completed,
    currentUserProfile?.onboarding_tour_version,
    currentUserProfile?.onboarding_tour_dismissed,
    activeCohortId,
  ])

  const switchTab = tab => {
    localStorage.setItem('aspire_active_tab', tab)
    navigate(TAB_TO_PATH[tab] || '/aggregate')
  }

  // Refetch students and units whenever the Aggregate tab becomes active
  useEffect(() => {
    if (activeTab === 'overview' && activeCohortId) {
      fetchStudents(activeCohortId)
      fetchUnits(activeCohortId)
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateCohortMatchSummary = (newMatchList) => {
    const summary = computeMatchSummary(newMatchList)
    safeWrite(
      () => supabase.from('cohorts').update({ match_quality_summary: summary }).eq('id', activeCohortId),
      { name: 'update cohort match summary' }
    ).catch(err => console.warn('[App] match summary update failed:', err.message))
    queryClient.setQueryData(['cohorts_all'], prev =>
      (prev || []).map(c => c.id === activeCohortId ? { ...c, match_quality_summary: summary } : c))
  }

  const switchToAccess = (studentId) => {
    switchTab('profiles')
    setProfilesView('access')
    setAccessFocusId(studentId)
    setTimeout(() => {
      document.getElementById(`access-row-${studentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
  }

  // ── Student CRUD ─────────────────────────────────────────────
  // loadedUpdatedAt is the updated_at timestamp the caller had when they loaded the
  // student.  When supplied, the save API enforces OCC: if the row changed since
  // then, it returns a conflict error instead of silently overwriting.
  const updateStudent = useCallback(async (id, updates, loadedUpdatedAt) => {
    try {
      const updatedRow = await proxyUpdateStudent(id, updates, loadedUpdatedAt)
      // Merge the full returned row so updated_at propagates to the student prop
      setStudents(prev => prev.map(s =>
        s.id === id
          ? { ...s, ...updates, ...(updatedRow?.updated_at ? { updated_at: updatedRow.updated_at } : {}) }
          : s
      ))
      return null
    } catch (err) {
      return err  // err.conflict === true when OCC guard fires (HTTP 409)
    }
  }, [])

  const addStudent = async student => {
    if (!activeCohortId) return { message: 'No active cohort.' }
    const { data, error } = await safeWrite(
      () => supabase.from('students').insert({ ...student, cohort_id: activeCohortId }).select().single(),
      { name: 'add student' }
    )
    if (!error && data) {
      setStudents(prev => [...prev, data].sort((a, b) => (a.school + a.name).localeCompare(b.school + b.name)))
      setShowAddModal(false)
    }
    return error || null
  }

  const deleteStudent = async id => {
    await safeWrite(() => supabase.from('students').delete().eq('id', id), { name: 'delete student' })
    // Belt-and-suspenders: explicitly remove related records in case CASCADE is not yet applied
    await safeWrite(() => supabase.from('interviews').delete().eq('student_id', id), { name: 'delete student interviews' })
    await safeWrite(() => supabase.from('interview_rubrics').delete().eq('student_id', id), { name: 'delete student rubrics' })
    await safeWrite(() => supabase.from('matches').delete().eq('student_id', id), { name: 'delete student matches' })
    await safeWrite(() => supabase.from('interview_sessions').delete().eq('student_id', id), { name: 'delete student sessions' })
    // Refetch all affected state so every tab reflects the deletion immediately
    setStudents(prev => prev.filter(s => s.id !== id))
    setInterviews(prev => prev.filter(iv => iv.student_id !== id))
    setMatches(prev => prev.filter(m => m.student_id !== id))
    // Update ivSessions immediately so the I·R tab badge recalculates without a reload
    setIvSessions(prev => prev.filter(s => s.student_id !== id))
  }

  // ── Unit CRUD ────────────────────────────────────────────────
  const deleteUnit = async unit => {
    const matchedIds = students.filter(s => s.matched_unit_id === unit.id).map(s => s.id)
    if (matchedIds.length > 0) {
      await safeWrite(
        () => supabase.from('students').update({ matched_unit_id: null, matched_preceptor: '', shift_assigned: '', interview_outcome: 'Pending Interview' }).in('id', matchedIds),
        { name: 'clear matched students on unit delete' }
      )
      await safeWrite(
        () => supabase.from('matches').delete().eq('unit_id', unit.id),
        { name: 'delete unit matches' }
      )
    }
    await safeWrite(
      () => supabase.from('units').delete().eq('id', unit.id),
      { name: 'delete unit' }
    )
    setStudents(prev => prev.map(s =>
      matchedIds.includes(s.id)
        ? { ...s, matched_unit_id: null, matched_preceptor: '', shift_assigned: '', interview_outcome: 'Pending Interview' }
        : s
    ))
    const newMatchList = matches.filter(m => m.unit_id !== unit.id)
    updateCohortMatchSummary(newMatchList)
    setMatches(prev => prev.filter(m => m.unit_id !== unit.id))
    setUnits(prev => prev.filter(u => u.id !== unit.id))
  }

  // ── Matching ─────────────────────────────────────────────────
  const createMatch = async (student, unit) => {
    if (!activeCohortId) return
    // Guard: only place students who have completed an interview
    if (!['Interviewed', 'Placed'].includes(student.status)) {
      toast.warning('Interview required', `${student.first_name} has not completed an interview yet. Complete the interview before placing.`)
      return
    }
    const match_quality = unit.unit_name === student.unit_preference_1 ? 'top_choice'
      : unit.unit_name === student.unit_preference_2 ? 'second_choice'
      : 'other'
    const { data: m, error } = await safeWrite(
      () => supabase.from('matches').insert({ student_id: student.id, unit_id: unit.id, cohort_id: activeCohortId, match_quality }).select().single(),
      { name: 'create match' }
    )
    if (error) { console.error(error); return }
    // Derive slots_remaining from actual match count so the field self-corrects
    // even if it was previously initialised incorrectly (e.g., stuck at 0).
    const currentMatchCount = matches.filter(m => m.unit_id === unit.id).length  // before new match
    const newRemaining = Math.max(0, unit.total_slots - (currentMatchCount + 1))
    // Phase 2A.1 (May 26, 2026): renamed from 'Accepted' to 'Recommend' as part of
    // interview_outcome vocabulary cleanup. This handler still overwrites whatever
    // the rubric set, which is a design smell flagged for Phase 2B disposition work.
    await safeWrite(
      () => supabase.from('students').update({ matched_unit_id: unit.id, interview_outcome: 'Recommend', match_quality, status: 'Placed' }).eq('id', student.id),
      { name: 'update student on match' }
    )
    await safeWrite(
      () => supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id),
      { name: 'update unit slots on match' }
    )
    updateCohortMatchSummary([...matches, m])
    setMatches(prev => [...prev, m])
    setStudents(prev => prev.map(s =>
      s.id === student.id ? { ...s, matched_unit_id: unit.id, interview_outcome: 'Recommend', match_quality, status: 'Placed' } : s
    ))
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u))
    const alreadyPlaced = await eventExists(supabase, student.id, 'placement')
    if (!alreadyPlaced) {
      await logEvent(supabase, { studentId: student.id, cohortId: activeCohortId, eventType: 'placement', notes: `Placed in ${unit.unit_name}`, auto: true })
    }
    toast.success('Student placed', `${student.first_name} matched to ${unit.unit_name}.`)
    logActivity({ userProfile: currentUserProfile, actionType:'student_matched', entityType:'student', entityId:student.id, cohortId:activeCohortId, description:`${currentUserProfile?.full_name} matched ${student.first_name} ${student.last_name} to ${unit.unit_name}`, metadata:{ unit: unit.unit_name } })
  }

  const unmatch = async (student, unit) => {
    // Check for existing interview rubrics to determine correct revert status
    const { data: rubrics } = await supabase
      .from('interview_rubrics')
      .select('id')
      .eq('student_id', student.id)
      .limit(1)
    const hasInterview = rubrics && rubrics.length > 0
    const revertStatus = hasInterview ? 'Interviewed' : 'Form Received'

    const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
    if (match) await safeWrite(() => supabase.from('matches').delete().eq('id', match.id), { name: 'delete match on unmatch' })
    await safeWrite(
      () => supabase.from('students').update({ matched_unit_id: null, matched_preceptor: '', shift_assigned: '', match_quality: null, interview_outcome: 'Pending Interview', status: revertStatus }).eq('id', student.id),
      { name: 'update student on unmatch' }
    )
    // Derive from actual count so the field self-corrects if it was stale
    const currentMatchCount = matches.filter(m => m.unit_id === unit.id).length  // before removal
    const newRemaining = Math.min(unit.total_slots, unit.total_slots - Math.max(0, currentMatchCount - 1))
    await safeWrite(
      () => supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id),
      { name: 'update unit slots on unmatch' }
    )
    updateCohortMatchSummary(match ? matches.filter(m => m.id !== match.id) : matches)
    if (match) setMatches(prev => prev.filter(m => m.id !== match.id))
    setStudents(prev => prev.map(s =>
      s.id === student.id
        ? { ...s, matched_unit_id: null, matched_preceptor: '', shift_assigned: '', match_quality: null, interview_outcome: 'Pending Interview', status: revertStatus }
        : s
    ))
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u))
    toast.info('Student unmatched', `${student.first_name} moved back to ${revertStatus}.`)
    logActivity({ userProfile: currentUserProfile, actionType:'match_removed', entityType:'student', entityId:student.id, cohortId:activeCohortId, description:`${currentUserProfile?.full_name} removed ${student.first_name} ${student.last_name} from ${unit.unit_name}` })
  }

  const updateMatch = async (matchId, studentId, updates) => {
    const { error } = await safeWrite(
      () => supabase.from('matches').update(updates).eq('id', matchId),
      { name: 'update match' }
    )
    if (!error) {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, ...updates } : m))
      const su = {}
      if (updates.preceptor_assigned !== undefined) su.matched_preceptor = updates.preceptor_assigned
      if (updates.shift_assigned     !== undefined) su.shift_assigned     = updates.shift_assigned
      if (Object.keys(su).length) {
        proxyUpdateStudent(studentId, su).catch(err => console.error('Match student update:', err.message))
        setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...su } : s))
      }
    }
  }

  // ── CSV export ───────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Name','School Email','Personal Email','Phone','School','ASPIRE Cohort',
      'Term Dates','Hours Required','Hours Completed','Unit','Preceptor','ASPIRE Status',
      'NGRP Cohort Target','NGRP Outcome','GPA Verified','BLS Current','Health Cleared',
      'Background Check','Coordinators','Notes',
      'Interview Date','Interviewer Name','CJ Score','PP Score','GA Score',
      'Composite Score','Overall Recommendation','Interviewer Suggested Unit','Summary Comments']
    const rows = students.map(s => [
      displayName(s),s.school_email,s.personal_email,s.phone,s.school,s.aspire_cohort,
      s.term_dates,s.hours_required,s.hours_completed,s.unit,s.preceptor_name,
      s.status,s.ngrp_cohort_target,s.ngrp_outcome,
      s.gpa_verified?'Yes':'No',s.bls_current?'Yes':'No',
      s.health_cleared?'Yes':'No',s.background_check?'Yes':'No',
      s.coordinators,s.notes,
      s.interview_date||'',s.interviewer_name||'',
      s.cj_score||'',s.pp_score||'',s.ga_score||'',
      s.composite_score||'',s.overall_recommendation||'',
      s.interviewer_suggested_unit||'',s.summary_comments||''])
    const csv = [headers,...rows]
      .map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const cohortSlug = (activeCohort?.name || 'cohort').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')
    const dateSlug = new Date().toISOString().slice(0,10)
    a.href=url; a.download=`aspire_students_${cohortSlug}_${dateSlug}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }))
  const filteredStudents = students.filter(s => {
    if (search) {
      const q = search.toLowerCase()
      if (!s.name?.toLowerCase().includes(q) &&
          !s.school_email?.toLowerCase().includes(q) &&
          !s.personal_email?.toLowerCase().includes(q)) return false
    }
    if (filters.school && s.school !== filters.school) return false
    if (filters.status && s.status !== filters.status)  return false
    if (filters.cohort && s.aspire_cohort !== filters.cohort) return false
    return true
  })

  const activeCohort = cohorts.find(c => c.id === activeCohortId)

  // ── Action Center badge count — must be after activeCohort ───
  // ── Header: click-outside for cohort + search ────────────────────────────────
  useEffect(() => {
    const handler = e => {
      if (cohortPickerRef.current && !cohortPickerRef.current.contains(e.target)) setCohortOpen(false)
      if (searchAreaRef.current && !searchAreaRef.current.contains(e.target)) { setSearchOpen(false); setSearchActiveIdx(-1) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Header: derived + search handler ─────────────────────────────────────────
  const sortedCohorts = [...cohorts].sort((a, b) => {
    const da = a.start_date || null, db = b.start_date || null
    if (!da && !db) return (a.created_at||'').localeCompare(b.created_at||'')
    if (!da) return 1; if (!db) return -1
    return da.localeCompare(db)
  })

  const runSearch = useCallback(async q => {
    if (!activeCohortId || q.length < 2) { setSearchResults({ students:[], units:[], placements:[] }); setSearchOpen(false); return }
    setSearchLoading(true); setSearchOpen(true)
    const [stuRes, unitRes] = await Promise.all([
      supabase.from('students').select('id, first_name, last_name, school, school_email, status, headshot_url')
        .eq('cohort_id', activeCohortId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,school_email.ilike.%${q}%,personal_email.ilike.%${q}%,phone.ilike.%${q}%,school.ilike.%${q}%`).limit(6),
      supabase.from('units').select('id, unit_name, division, contact_person, slots_remaining, total_slots')
        .eq('cohort_id', activeCohortId).or(`unit_name.ilike.%${q}%,contact_person.ilike.%${q}%`).limit(6),
    ])
    const ql = q.toLowerCase()
    const placements = students.filter(s => {
      if (!s.matched_unit_id) return false
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name} ${s.first_name}`.toLowerCase().includes(ql) || (u?.unit_name||'').toLowerCase().includes(ql)
    }).map(s => ({ student: s, unit: units.find(u => u.id === s.matched_unit_id) })).slice(0, 5)
    setSearchResults({ students: stuRes.data||[], units: unitRes.data||[], placements })
    setSearchLoading(false); setSearchActiveIdx(-1)
  }, [activeCohortId, students, units]) // eslint-disable-line

  const handleSearchChange = e => {
    const q = e.target.value; setSearchQuery(q)
    clearTimeout(searchTimer.current)
    if (q.length < 2) { setSearchResults({ students:[], units:[], placements:[] }); setSearchOpen(false); return }
    searchTimer.current = setTimeout(() => runSearch(q), 300)
  }

  const searchFlat = [
    ...searchResults.students.map(s => ({ type:'student', data:s })),
    ...searchResults.units.map(u => ({ type:'unit', data:u })),
    ...searchResults.placements.map(p => ({ type:'placement', data:p })),
  ]

  const handleSearchKey = e => {
    if (!searchOpen) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchActiveIdx(i => Math.min(i+1, searchFlat.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchActiveIdx(i => Math.max(i-1, 0)) }
    else if (e.key === 'Enter' && searchActiveIdx >= 0) handleSearchResult(searchFlat[searchActiveIdx])
    else if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); searchInputRef.current?.blur() }
  }

  const handleSearchResult = item => {
    setSearchOpen(false); setSearchQuery(''); setSearchActiveIdx(-1)
    if (item.type === 'student') { switchTab('profiles'); setFocusStudentId(item.data.id) }
    else if (item.type === 'unit') { setHighlightUnitId(item.data.id); switchTab('rotation'); setTimeout(() => setHighlightUnitId(null), 2500) }
    else if (item.type === 'placement') { setHighlightUnitId(item.data.unit?.id); switchTab('rotation'); setTimeout(() => setHighlightUnitId(null), 2500) }
  }

  const actionBadgeCount = (() => {
    if (!students.length) return 0
    const hasSent = (sid, type) => communications.some(c => c.student_id === sid && c.type === type)
    const now = new Date()
    const td  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    const in48 = new Date(now.getTime() + 48*3600*1000)
    const t48 = `${in48.getFullYear()}-${String(in48.getMonth()+1).padStart(2,'0')}-${String(in48.getDate()).padStart(2,'0')}`
    return (
      students.filter(s => s.status==='Pending Outreach').length +
      students.filter(s => s.status==='Form Received' && !s.interview_scheduled_date).length +
      students.filter(s => s.interview_scheduled_date >= td && s.interview_scheduled_date <= t48 && !hasSent(s.id,'interview_reminder')).length +
      matches.filter(m => { const s=students.find(st=>st.id===m.student_id); return s?.status==='Placed'&&!m.notification_sent }).length +
      students.filter(s => s.status==='Placed'&&s.matched_preceptor&&!hasSent(s.id,'preceptor_welcome')).length +
      students.filter(s => ['Form Received','Interview Scheduled','Interviewed','Placed','Active Rotation'].includes(s.status)&&(!s.cs_cedars_status||!s.cs_stage1_submitted)).length +
      (activeCohort&&!activeCohort.orientation_sent_at&&students.some(s=>s.status==='Placed')?1:0) +
      students.filter(s => s.status==='Active Rotation'&&!hasSent(s.id,'midpoint_checkin')).length +
      students.filter(s => s.status==='Active Rotation'&&!hasSent(s.id,'midpoint_eval')).length +
      students.filter(s => s.status==='Completed'&&!hasSent(s.id,'post_survey')).length +
      // Certificate: Completed (any) OR Active Rotation with hours met — unified, no double-count
      students.filter(s => !hasSent(s.id,'certificate')&&(s.status==='Completed'||(s.status==='Active Rotation'&&parseFloat(s.approved_hours||0)>=parseFloat(s.hours_required||0)&&parseFloat(s.hours_required||0)>0))).length +
      students.filter(s => s.status==='Completed'&&!hasSent(s.id,'end_eval')).length +
      // Act 16: badge not created
      students.filter(s => s.status==='Placed'&&!s.badge_created).length +
      // Act 17: placed/active rotation with no preceptor linked
      students.filter(s => ['Placed','Active Rotation'].includes(s.status)&&!s.preceptor_id&&(!s.matched_preceptor||!s.matched_preceptor.trim())).length
    )
  })()

  return (
    <div className="app">
      <div className="top-section">
        {/* ── Application header: brand | spacer | status + actions ── */}
        <header style={{
          background: 'linear-gradient(180deg, #1D2567 0%, #161D52 100%)',
          padding: '0 24px',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'DM Sans, sans-serif',
          flexShrink: 0,
          position: 'relative',
        }}>
          {/* Zone 1: Brand */}
          <div style={{ display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
            <img src="/cs-logo-large.png" alt="Cedars-Sinai" style={{ height:46, width:'auto', objectFit:'contain' }} />
            <div style={{ width:1, height:30, background:'rgba(255,255,255,0.18)', flexShrink:0 }} />
            <Tooltip label="Affiliate Students' Pathway from Internship to Residency Experience" placement="bottom">
              <div style={{ fontSize:20, fontWeight:700, color:'#fff', letterSpacing:'-0.01em', cursor:'default' }}>
                ASPIRE Intelligence
              </div>
            </Tooltip>
          </div>

          <div style={{ flex:1 }} />

          {/* Zone 2: Status — cohort picker + sync */}
          {cohorts.length > 0 && (
            <div ref={cohortPickerRef} style={{ position:'relative', flexShrink:0 }}>
              <Tooltip label="Switch cohort" placement="bottom">
              <button
                data-tour="cohort-switcher"
                aria-label="Switch cohort"
                onClick={() => setCohortOpen(p => !p)}
                style={{
                  display:'flex', alignItems:'center', gap:8,
                  background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.10)',
                  borderRadius:999, padding:'7px 13px',
                  color:'#fff', cursor:'pointer', fontFamily:'DM Sans, sans-serif',
                  transition:'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.07)'}
              >
                <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0, background: activeCohort?.accepting_submissions ? '#5DD39E' : '#9ca3af', boxShadow: activeCohort?.accepting_submissions ? '0 0 0 3px rgba(93,211,158,0.2)' : 'none' }} />
                <span style={{ fontSize:10, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginRight:2 }}>Cohort</span>
                <span style={{ fontSize:12.5, fontWeight:600 }}>{activeCohort?.name || 'Select cohort'}</span>
                <span style={{ opacity:0.5, lineHeight:0, marginLeft:2 }}><HeaderChevron /></span>
              </button>
              </Tooltip>

              {cohortOpen && (
                <div style={{
                  position:'absolute', top:'calc(100% + 6px)', right:0, width:380,
                  background:'var(--pearl)', border:'1px solid #e5e7eb', borderRadius:12,
                  boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:400, overflow:'hidden',
                }}>
                  <div style={{ padding:'10px 14px 6px', fontSize:11, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Select Cohort</div>
                  {sortedCohorts.map(c => {
                    const isSel = c.id === activeCohortId
                    const sc = COHORT_STATUS_COLORS[c.status] || { bg:'#f3f4f6', color:'#6b7280' }
                    return (
                      <div key={c.id}
                        onClick={() => { handleCohortSwitch(c.id); setCohortOpen(false) }}
                        style={{ padding:'14px 16px', cursor:'pointer', background: isSel ? '#e8edf8' : 'transparent', borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent', transition:'background 0.1s' }}
                        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background='var(--sand)' }}
                        onMouseLeave={e => { if (!isSel) e.currentTarget.style.background='transparent' }}>
                        <div style={{ fontSize:15, fontWeight:600, color:'#374151' }}>{c.name}</div>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:3 }}>
                          <span style={{ fontSize:12, color:'#6b7280' }}>{fmtCohortRange(c.start_date, c.end_date) || ' '}</span>
                          <div style={{ display:'flex', gap:4, flexShrink:0, marginLeft:8 }}>
                            {c.status && <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background:sc.bg, color:sc.color }}>{c.status}</span>}
                            {c.accepting_submissions && <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background:'#dbeafe', color:'#1e40af', border:'1px solid #bfdbfe' }}>Accepting</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {canEdit && (
                    <div style={{ display:'flex', gap:8, padding:'10px 14px', borderTop:'1px solid #f3f4f6', background:'var(--sand)' }}>
                      {activeCohort && <button onClick={() => { setShowManageCohort(true); setCohortOpen(false) }} style={{ flex:1, padding:'7px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, fontFamily:'DM Sans', fontSize:12, cursor:'pointer', color:'#374151' }}>✏ Edit Cohort</button>}
                      <button onClick={() => { setShowNewCohort(true); setCohortOpen(false) }} style={{ flex:1, padding:'7px', background:'#1D2567', border:'none', borderRadius:8, fontFamily:'DM Sans', fontSize:12, fontWeight:600, cursor:'pointer', color:'#fff' }}>+ New Cohort</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <LastSyncedIndicator />

          {/* Zone 3: Search */}
          <div ref={searchAreaRef} style={{ position:'relative', flexShrink:0 }}>
            <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
              <span style={{ position:'absolute', left:11, pointerEvents:'none', lineHeight:0, zIndex:1, color:'#fff', opacity: searchFocused ? 1 : 0.95 }}>
                <HeaderSearchIcon />
              </span>
              <input
                ref={searchInputRef}
                data-tour="global-search"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKey}
                onFocus={() => { setSearchFocused(true); if (searchQuery.length >= 2) setSearchOpen(true) }}
                onBlur={() => setSearchFocused(false)}
                className="header-search-input"
                style={{
                  height:34, paddingLeft:32, paddingRight:44,
                  width: searchFocused ? 280 : 220,
                  transition:'width 200ms ease, border-color 150ms ease',
                  background: searchFocused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
                  border:`1px solid ${searchFocused ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.10)'}`,
                  borderRadius:8, color:'#fff', fontSize:12.5, fontFamily:'DM Sans',
                  outline:'none',
                }}
                placeholder="Search students, units…"
              />
              <span style={{ position:'absolute', right:10, pointerEvents:'none', fontSize:10, fontWeight:500, color:'rgba(255,255,255,0.70)', fontFamily:'ui-monospace, monospace', background:'rgba(255,255,255,0.10)', border:'1px solid rgba(255,255,255,0.15)', padding:'1px 5px', borderRadius:3 }}>⌘K</span>
            </div>

            {/* Search dropdown */}
            {searchOpen && (
              <div style={{ position:'absolute', top:'calc(100% + 8px)', right:0, width:360, maxHeight:480, overflowY:'auto', background:'var(--pearl)', border:'1px solid #e5e7eb', borderRadius:12, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:400 }}>
                {searchLoading ? (
                  <div style={{ padding:20, display:'flex', flexDirection:'column', gap:8 }}>
                    {[80,60,70].map((w,i) => <div key={i} style={{ height:12, borderRadius:6, background:'#f3f4f6', width:`${w}%` }} />)}
                  </div>
                ) : searchFlat.length === 0 ? (
                  <div style={{ padding:20, textAlign:'center', fontSize:13, color:'#9ca3af' }}>No results found</div>
                ) : (
                  <>
                    {searchResults.students.length > 0 && (
                      <>
                        <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Students</div>
                        {searchResults.students.map((s, i) => {
                          const isAct = searchActiveIdx === i
                          const cfg = ASPIRE_STATUS_CONFIG[s.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
                          return (
                            <div key={s.id} onClick={() => handleSearchResult({ type:'student', data:s })}
                              style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                              onMouseEnter={() => setSearchActiveIdx(i)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                              <StudentAvatar student={s} size={28} />
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.last_name}{s.last_name&&s.first_name?', ':''}{s.first_name}</div>
                                <div style={{ fontSize:12, color:'#6b7280' }}>{s.school}</div>
                              </div>
                              {s.status && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, flexShrink:0 }}>{s.status}</span>}
                            </div>
                          )
                        })}
                      </>
                    )}
                    {searchResults.units.length > 0 && (
                      <>
                        <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Units</div>
                        {searchResults.units.map((u, i) => {
                          const fi = searchResults.students.length + i
                          const isAct = searchActiveIdx === fi
                          return (
                            <div key={u.id} onClick={() => handleSearchResult({ type:'unit', data:u })}
                              style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                              onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                              <span style={{ color:'#6b7280', fontSize:16, flexShrink:0 }}>🏥</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>{u.unit_name}</div>
                                <div style={{ fontSize:12, color:'#6b7280' }}>{u.division}{u.division?' · ':''}{u.slots_remaining ?? u.total_slots} of {u.total_slots} slots open</div>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                    {searchResults.placements.length > 0 && (
                      <>
                        <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Placements</div>
                        {searchResults.placements.map(({ student: s, unit: u }, i) => {
                          const fi = searchResults.students.length + searchResults.units.length + i
                          const isAct = searchActiveIdx === fi
                          return (
                            <div key={s.id} onClick={() => handleSearchResult({ type:'placement', data:{ student:s, unit:u } })}
                              style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                              onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                              <span style={{ color:'#6b7280', fontSize:14, flexShrink:0 }}>🔗</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>{displayName(s)} → {u?.unit_name||'—'}</div>
                                <div style={{ fontSize:12, color:'#6b7280' }}>{s.status === 'Completed' ? 'Completed' : 'Active Placement'}</div>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Zone 3: Actions — connect + bell + user menu */}
          {cohorts.length > 0 && (
            <Tooltip label="ASPIRE Connect" placement="bottom">
            <button
              data-tour="connect"
              aria-label="ASPIRE Connect"
              onClick={() => navigate('/connect/outreach')}
              style={{
                position: 'relative', flexShrink: 0,
                width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: activeTab === 'connect' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${activeTab === 'connect' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
                borderRadius: 8,
                color: activeTab === 'connect' ? '#fff' : 'rgba(255,255,255,0.75)',
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s',
                overflow: 'visible',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
              onMouseLeave={e => e.currentTarget.style.background = activeTab === 'connect' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'}
            >
              <MessagesSquare size={15} strokeWidth={1.9} />
              {activeTab === 'connect' && (
                <span style={{
                  position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
                  width: 0, height: 0,
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: '5px solid rgba(255,255,255,0.65)',
                  display: 'block',
                }} />
              )}
            </button>
            </Tooltip>
          )}
          {cohorts.length > 0 && (
            <Tooltip label="Action Center" placement="bottom">
            <button
              ref={bellRef}
              id="keith-bell-trigger"
              aria-label="Action Center"
              data-tour="action-center"
              onClick={() => setShowActionCenter(p => !p)}
              style={{
                position:'relative', flexShrink:0,
                width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center',
                background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.10)',
                borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:'pointer',
                transition:'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.06)'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {actionBadgeCount > 0 && (
                <span style={{ position:'absolute', top:-3, right:-3, minWidth:16, height:16, borderRadius:8, background:'#930045', color:'#fff', fontSize:10, fontWeight:700, fontFamily:'DM Sans', display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', lineHeight:1, border:'1.5px solid #1D2567' }}>
                  {actionBadgeCount >= 10 ? '9+' : actionBadgeCount}
                </span>
              )}
            </button>
            </Tooltip>
          )}

          <UserMenu
            onOpenUserManagement={() => setShowUserManagement(true)}
            onRestartTour={() => { switchTab('overview'); setTimeout(() => setTourRunning(true), 400) }}
          />
        </header>

        {cohorts.length > 0 && activeTab !== 'connect' && (
          <UnifiedNav
            cohorts={cohorts}
            activeCohortId={activeCohortId}
            activeCohort={activeCohort}
            activeTab={activeTab}
            ivSessions={ivSessions}
            onSelectCohort={handleCohortSwitch}
            onNewCohort={() => setShowNewCohort(true)}
            onEditCohort={() => setShowManageCohort(true)}
            onSwitchTab={switchTab}
            students={students}
            units={units}
            matches={matches}
            cohortId={activeCohortId}
            onSelectStudent={id => { setFocusStudentId(id); switchTab('profiles') }}
            onSelectUnit={id => {
              setHighlightUnitId(id)
              switchTab('rotation')
              setTimeout(() => setHighlightUnitId(null), 2500)
            }}
          />
        )}
        {cohorts.length > 0 && activeTab === 'connect' && (
          <div style={{
            background: 'var(--bg-card,#FAFAF7)',
            borderBottom: '1px solid var(--border-divider,rgba(29,37,103,0.08))',
            padding: '0 32px', height: 44,
            display: 'flex', alignItems: 'center',
            fontFamily: 'DM Sans, sans-serif', flexShrink: 0,
          }}>
            <button
              onClick={() => navigate(backPath)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#6B7280',
                padding: '4px 0', fontFamily: 'DM Sans, sans-serif',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#1D2567'}
              onMouseLeave={e => e.currentTarget.style.color = '#6B7280'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to {backLabel}
            </button>
          </div>
        )}
      </div>

      <main className="app-main">
        {cohorts.length === 0 && !loading && (
          <div className="state-box" style={{ marginTop: 40 }}>
            <p style={{ marginBottom: 8, fontSize: 16, fontWeight: 600 }}>Welcome to ASPIRE Intelligence</p>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Get started by creating your first cohort.</p>
            <button className="btn btn-primary" onClick={() => setShowNewCohort(true)}>+ Create First Cohort</button>
          </div>
        )}
        {loading && cohorts.length > 0 && <div className="state-box"><div className="spinner" /><p>Loading…</p></div>}
        {dbError && (
          <div className="state-box error-box">
            <p><strong>Unable to load data.</strong></p>
            <p style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>
              {dbError.toLowerCase().includes('jwt') || dbError.toLowerCase().includes('auth')
                ? 'Your session may have expired. Try signing out and back in.'
                : 'Check your connection or contact the ASPIRE team if this persists.'}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={refreshAll}>Retry</button>
          </div>
        )}

        {/* All five tabs mount simultaneously once initial data is ready.
            Tab switching only changes CSS display — no unmount/remount,
            so queries, local state, and scroll position persist instantly. */}
        {!loading && !dbError && cohorts.length > 0 && (
          <>
            <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
              <OverviewTab students={students} units={units} onStudentUpdate={updateStudent} cohortId={activeCohortId} cohort={activeCohort} toast={toast}
                onSelectStudent={id => { setFocusStudentId(id); switchTab('profiles') }} />
            </div>

            <div style={{ display: activeTab === 'profiles' ? 'block' : 'none' }}>
              <StudentProfilesTab
                students={students}
                units={units} cohortId={activeCohortId}
                onUpdate={updateStudent} onDelete={deleteStudent}
                onRefresh={() => fetchStudents(activeCohortId)}
                onSwitchToAccess={switchToAccess}
                view={profilesView} onViewChange={setProfilesView}
                accessFocusId={accessFocusId}
                onExportCSV={exportCSV}
                onAddStudent={() => setShowAddModal(true)}
                focusStudentId={focusStudentId}
                onClearFocusStudent={() => setFocusStudentId(null)}
                toast={toast}
              />
            </div>

            <div style={{ display: activeTab === 'interviews' ? 'block' : 'none' }}>
              <InterviewRubricTab
                students={students}
                rubrics={interviews}
                cohortId={activeCohortId}
                cohort={activeCohort}
                sessions={ivSessions}
                slots={ivSlots}
                onStudentUpdate={updateStudent}
                onRubricsChange={() => fetchInterviews(activeCohortId)}
                onRefreshStudents={() => fetchStudents(activeCohortId)}
                onManageInterviewers={() => setShowInterviewersModal(true)}
                onUpdateSession={updateIvSession}
                onRefreshSlots={() => fetchIvSlots(activeCohortId)}
                toast={toast}
              />
            </div>

            <div style={{ display: activeTab === 'rotation' ? 'block' : 'none' }}>
              <RotationTab
                students={students} units={units} matches={matches}
                cohortId={activeCohortId} cohort={activeCohort}
                onMatch={createMatch} onUnmatch={unmatch} onUpdateMatch={updateMatch}
                onRefreshUnits={() => fetchUnits(activeCohortId)}
                onDeleteUnit={deleteUnit}
                highlightUnitId={highlightUnitId}
                toast={toast}
              />
            </div>

            <div style={{ display: activeTab === 'evaluation' ? 'block' : 'none' }}>
              <EvaluationTab cohortId={activeCohortId} />
            </div>

            {activeTab === 'connect' && (
              <ConnectPage
                cohortId={activeCohortId}
                onNavigateToStudent={id => { setFocusStudentId(id); switchTab('profiles') }}
              />
            )}
          </>
        )}
      </main>

      {showAddModal && <AddStudentModal cohortId={activeCohortId} onAdd={addStudent} onClose={() => setShowAddModal(false)} />}
      {showNewCohort && <NewCohortModal onSave={createCohort} onClose={() => setShowNewCohort(false)} />}
      {showManageCohort && activeCohort && (
        <ManageCohortModal cohort={activeCohort} onSave={updateCohort} onClose={() => setShowManageCohort(false)} />
      )}
      {showInterviewersModal && (
        <InterviewersModal isOpen={showInterviewersModal} onClose={() => setShowInterviewersModal(false)} toast={toast} />
      )}
      {showActionCenter && (
        <ActionCenter
          isOpen={showActionCenter}
          onClose={() => setShowActionCenter(false)}
          anchorEl={bellRef.current}
          students={students}
          units={units}
          matches={matches}
          cohortId={activeCohortId}
          activeCohort={activeCohort}
          communications={communications}
          onLogCommunication={logCommunication}
          onMatchUpdate={updateMatch}
          onStudentUpdate={updateStudent}
          onNavigateToProfiles={id => { setFocusStudentId(id); switchTab('profiles'); setShowActionCenter(false) }}
          toast={toast}
        />
      )}
      <Keith
        activeTab={activeTab}
        setActiveTab={switchTab}
        cohortName={activeCohort?.name}
        cohortId={activeCohortId}
        supabase={supabase}
        isAuthenticated={true}
      />
      <FeedbackPanel
        activeTab={activeTab}
        cohortName={activeCohort?.name}
        isAuthenticated={true}
      />
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <CustomOnboardingTour run={tourRunning} onClose={() => setTourRunning(false)} />
      {showUserManagement && (
        <UserManagement
          isOpen={showUserManagement}
          onClose={() => setShowUserManagement(false)}
        />
      )}
    </div>
  )
}

// Auth shell — rendered for all authenticated paths (everything except the five public forms)
function AuthedShell() {
  const { user, userProfile, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#F4F1EC',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: '#9ca3af' }}>
          Loading ASPIRE Intelligence...
        </div>
      </div>
    )
  }

  // Not signed in → show login page
  if (!user) return <LoginNew />

  // Signed in but profile is inactive
  if (user && userProfile && !userProfile.is_active) {
    return (
      <div style={{
        minHeight: '100vh', background: '#F4F1EC',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'DM Sans, sans-serif',
      }}>
        <div style={{ textAlign: 'center', color: '#991b1b' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Account Deactivated</div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>Contact JesterLloyd.Bautista@cshs.org for access.</div>
        </div>
      </div>
    )
  }

  return <MainApp onLogout={signOut} />
}

export default function App() {
  return (
    <Routes>
      {/* Public routes — no auth required, no app shell */}
      <Route path="/unit-form/*"          element={<div data-theme-lock="light"><UnitFormPage /></div>} />
      <Route path="/school-form/*"        element={<div data-theme-lock="light"><SchoolFormPage /></div>} />
      <Route path="/student-form/*"       element={<div data-theme-lock="light"><StudentIntakeFormPage /></div>} />
      <Route path="/interview-schedule/*" element={<div data-theme-lock="light"><InterviewSchedulePage /></div>} />
      <Route path="/shift-log/*"          element={<div data-theme-lock="light"><ShiftLogPage /></div>} />
      <Route path="/evaluation/readiness/*" element={<div data-theme-lock="light"><EvaluationPage /></div>} />
      {/* Legacy URL redirects */}
      <Route path="/interview-room"        element={<Navigate to="/interviews" replace />} />
      <Route path="/embed"                 element={<Navigate to="/rotation/matrix" replace />} />
      {/* Dev harness routes — excluded from production build */}
      {import.meta.env.DEV && <Route path="/dev/disposition-modal" element={<DevDispositionModal />} />}
      {/* Authenticated app — handles /, /aggregate, /students, /interviews, /rotation/*, /evaluation */}
      <Route path="/*"                    element={<AuthedShell />} />
    </Routes>
  )
}
