import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './lib/supabase'
import { updatePreceptorAssignment, updateContact, updateProfile, updateRequirements, updateCslink, updateNgrp, updateBadge, updateNotes, updateStatus, updateInterviewOutcome } from './lib/studentProxy'
import { displayName } from './lib/utils'
import OverviewTab from './components/OverviewTab'
import StudentProfilesTab from './components/StudentProfilesTab'
import InterviewRubricTab from './components/InterviewRubricTab'
import RotationTab from './components/RotationTab'
import EvaluationTab from './components/EvaluationTab'
import AddStudentModal from './components/AddStudentModal'
import UnifiedNav from './components/UnifiedNav'
import Header from './components/Header/Header'
import SettingsShell from './components/settings/SettingsShell'
import NewCohortModal from './components/NewCohortModal'
import ManageCohortModal from './components/ManageCohortModal'
import { useAuth } from './contexts/AuthContext'
import LoginNew from './pages/Login'
import DevDispositionModal from './pages/DevDispositionModal'
import EvaluationPage from './pages/EvaluationPage'
import PreceptorEvaluationPage from './pages/PreceptorEvaluationPage'
import StudentEvaluationPage from './pages/StudentEvaluationPage'
import UnitFormPage from './components/UnitFormPage'
import SchoolFormPage from './components/SchoolFormPage'
import StudentIntakeFormPage from './components/StudentIntakeFormPage'
import InterviewSchedulePage from './components/InterviewSchedulePage'
import ShiftLogPage from './components/ShiftLogPage'
import ShiftLogLifecycle from './components/shift-log-lifecycle/ShiftLogLifecycle'
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
import ConnectPage from './pages/Connect'
import CatalogPage from './components/catalog/CatalogPage'

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

// WS2.0: header helpers, icons, and LastSyncedIndicator moved to src/components/Header/*

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

// AUTH-UX-1: the last-active-tab is persisted PER AUTHENTICATED USER (by Supabase user.id),
// so a different account logging in on the same browser starts on Aggregate rather than
// inheriting the previous user's tab. The prior global 'aspire_active_tab' key is no longer
// read for restore (left untouched in storage; not wiped).
const lastTabKey = (userId) => `aspire:lastActiveTab:${userId}`
// AUTH-UX-1B: remembers which authenticated user was last active in THIS browser so a
// different account logging in (while the browser is still on a prior route like /connect)
// is reset to Aggregate once, instead of inheriting the previous user's visible route.
const LAST_AUTH_USER_KEY = 'aspire:lastAuthenticatedUserId'
// ─────────────────────────────────────────────────────────────────────────────

function MainApp({ onLogout }) {
  const { toasts, removeToast, toast } = useToast()
  const { user, userProfile: currentUserProfile, canEdit } = useAuth()

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

  // ── Header: cohort picker state ──────────────────────────────────────────────
  const [cohortOpen, setCohortOpen] = useState(false)
  const cohortPickerRef    = useRef(null)
  const bellRef            = useRef(null)
  const prevWorkspacePath  = useRef('/aggregate')

  // ── Header: search state ─────────────────────────────────────────────────────
  const [searchQuery,     setSearchQuery]     = useState('')
  const [searchOpen,      setSearchOpen]      = useState(false)
  const [searchResults,   setSearchResults]   = useState({ students:[], units:[], placements:[], contacts:[], preceptors:[], cohorts:[], catalog:[] })
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
    if (p.startsWith('/catalog'))  return 'catalog'  // CATALOG-1: app-level utility section
    if (p.startsWith('/settings')) return 'settings' // WS2.1: app-level utility section
    return PATH_TO_TAB[p] || 'overview'
  })()

  // Track the last non-Connect path for the workspace back affordance.
  // Stored in a ref so it never triggers re-renders.
  useEffect(() => {
    // WS2.1: Settings (like Connect) is an app-level utility, not a workspace — exclude
    // it so Back-to-workspace returns to the prior operational tab, not /settings.
    if (!location.pathname.startsWith('/connect') && !location.pathname.startsWith('/settings') && !location.pathname.startsWith('/catalog')) {
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
      // AUTH-UX-1: restore THIS user's own saved tab only (MainApp renders only when `user`
      // is present). No saved value (new user / different account) → default to Aggregate.
      const saved = user?.id ? localStorage.getItem(lastTabKey(user.id)) : null
      // migrate old 'matching' tab id
      const resolved = saved === 'matching' ? 'rotation' : saved
      navigate(TAB_TO_PATH[resolved] || '/aggregate', { replace: true })
    }
    if (location.pathname === '/rotation') {
      navigate('/rotation/matrix', { replace: true })
    }
  }, [location.pathname])

  // AUTH-UX-1B: when the AUTHENTICATED IDENTITY changes between sessions in the same browser,
  // force the new user to Aggregate ONCE — fixes the case where logout/login leaves the browser
  // on the prior user's route (e.g. /connect, /catalog) so the `/`-only restore above is bypassed.
  // Same-user refresh: previous id === current id → no redirect (current route preserved).
  // First user in this browser: no previous id → no redirect (just records the id). The `/`
  // restore above and the welcome tour are untouched.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user?.id) return
    const prevAuthId = localStorage.getItem(LAST_AUTH_USER_KEY)
    if (prevAuthId && prevAuthId !== user.id) {
      navigate('/aggregate', { replace: true })
    }
    if (prevAuthId !== user.id) {
      localStorage.setItem(LAST_AUTH_USER_KEY, user.id)
    }
  }, [user?.id])

  const [profilesView, setProfilesView] = useState('records')
  const [accessFocusId, setAccessFocusId] = useState(null)
  const [showAddModal,       setShowAddModal]       = useState(false)
  const [showInterviewersModal, setShowInterviewersModal] = useState(false)
  const [focusStudentId,     setFocusStudentId]     = useState(null)
  // Ref for Connect soft-refresh — ConnectPage registers its handleRefresh here so the
  // toolbar RefreshHint can call it without a full page reload.
  const connectRefreshRef = useRef(null)
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
    // AUTH-UX-1: persist under THIS user's scoped key so it cannot leak to another account.
    if (user?.id) localStorage.setItem(lastTabKey(user.id), tab)
    navigate(TAB_TO_PATH[tab] || '/aggregate')
  }

  // WS2.3/WS2.4: single source of truth for the tour-restart behavior. WS2.4 removed the
  // UserMenu duplicate, so the Settings → Tours & Help panel is now the sole consumer.
  // Behavior is unchanged: jump to the Aggregate/overview workspace, then start the tour.
  const restartTour = () => { switchTab('overview'); setTimeout(() => setTourRunning(true), 400) }

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
  // WS1e-A4: explicit field→action router (replaces the generic update wrapper).
  // Every field maps to one explicit, server-validated action; there is NO generic
  // fallback — an unmapped field throws. The local students-state merge is preserved.
  // (Preceptor/shift/interview_outcome are routed at the component level (A2/A3b);
  // this router covers the remaining staff domains.)
  const updateStudent = useCallback(async (id, updates, _loadedUpdatedAt) => {
    const DOMAINS = [
      { keys: ['personal_email', 'phone'], helper: updateContact },
      { keys: ['first_name', 'last_name', 'date_of_birth', 'gender', 'cumulative_gpa', 'program_type', 'shift_availability', 'prior_healthcare_experience', 'cs_affiliation', 'cs_department', 'cs_role', 'interest_statement', 'resume_url', 'headshot_url'], helper: updateProfile },
      { keys: ['hours_required'], helper: updateRequirements },
      { keys: ['cs_cedars_status', 'cs_stage1_action', 'cs_stage1_submitted', 'cs_stage1_submitted_date', 'cs_stage1_complete', 'cs_stage1_complete_date', 'cs_link_requested', 'cs_link_requested_date', 'cs_link_complete', 'cs_link_complete_date', 'cs_access_notes'], helper: updateCslink },
      { keys: ['ngrp_cohort_target', 'ngrp_outcome'], helper: updateNgrp },
      { keys: ['badge_created'], helper: updateBadge },
      { keys: ['notes'], helper: updateNotes },
      { keys: ['matched_preceptor', 'shift_assigned', 'preceptor_email'], helper: updatePreceptorAssignment },
    ]
    try {
      const keys = Object.keys(updates || {})
      if (keys.length === 0) return null

      // Status (with optional decline_reason) → administrative status action.
      if (keys.every(k => k === 'status' || k === 'decline_reason')) {
        await updateStatus(id, updates.status, updates.decline_reason)
      } else if (keys.length === 1 && keys[0] === 'interview_outcome') {
        await updateInterviewOutcome(id, updates.interview_outcome)
      } else {
        const domain = DOMAINS.find(d => keys.every(k => d.keys.includes(k)))
        if (!domain) throw new Error(`No explicit action for fields: ${keys.join(', ')}`)
        await domain.helper(id, updates)
      }
      setStudents(prev => prev.map(s => (s.id === id ? { ...s, ...updates } : s)))
      return null
    } catch (err) {
      return err
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
    // Phase 2B.2e: disposition is the source of truth for program status.
    // Unmatching releases the unit slot but must NOT undo a documented program
    // decision — preserve 'Not Proceeding' when the student has an active
    // disposition; otherwise revert as before.
    const revertStatus = student.active_disposition?.disposition_type
      ? 'Not Proceeding'
      : (hasInterview ? 'Interviewed' : 'Form Received')

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
        // WS1e-A2: explicit placement action (was generic proxyUpdateStudent).
        updatePreceptorAssignment(studentId, su).catch(err => console.error('Match student update:', err.message))
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
    if (!activeCohortId || q.length < 2) { setSearchResults({ students:[], units:[], placements:[], contacts:[], preceptors:[], cohorts:[], catalog:[] }); setSearchOpen(false); return }
    setSearchLoading(true); setSearchOpen(true)
    // UNIVERSAL-SEARCH-1: every query below is an EXISTING-RLS-backed client read — permissioning is
    // the table's own RLS (students/units cohort-scoped; contacts is_active; preceptors authenticated
    // read; catalog Owner/Admin/Interviewer-tiered). No new endpoint, no schema, read-only.
    const [stuRes, unitRes, contRes, precRes, catRes] = await Promise.all([
      supabase.from('students').select('id, first_name, last_name, school, school_email, status, headshot_url')
        .eq('cohort_id', activeCohortId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,school_email.ilike.%${q}%,personal_email.ilike.%${q}%,phone.ilike.%${q}%,school.ilike.%${q}%`).limit(6),
      supabase.from('units').select('id, unit_name, division, contact_person, slots_remaining, total_slots')
        .eq('cohort_id', activeCohortId).or(`unit_name.ilike.%${q}%,contact_person.ilike.%${q}%`).limit(6),
      supabase.from('contacts').select('id, full_name, preferred_name, email, role, category, avatar_url, organization, school_name, unit_name')
        .eq('is_active', true)
        .or(`full_name.ilike.%${q}%,preferred_name.ilike.%${q}%,email.ilike.%${q}%,role.ilike.%${q}%,school_name.ilike.%${q}%,unit_name.ilike.%${q}%,category.ilike.%${q}%,organization.ilike.%${q}%`).limit(5),
      // Preceptors: operational roster (global, not cohort-scoped). RLS = authenticated_read_preceptors.
      supabase.from('preceptors').select('id, full_name, email, unit_name, shift_type')
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,unit_name.ilike.%${q}%`).limit(5),
      // Catalog: SAFE metadata only — slug (routing), title, description, category, tags. storage_path
      // is NEVER selected. RLS returns only rows this role may see; client-filtered below (text[] tags).
      supabase.from('catalog_resources').select('id, slug, title, description, category, tags')
        .eq('is_active', true).limit(100),
    ])
    const ql = q.toLowerCase()
    const placements = students.filter(s => {
      if (!s.matched_unit_id) return false
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name} ${s.first_name}`.toLowerCase().includes(ql) || (u?.unit_name||'').toLowerCase().includes(ql)
    }).map(s => ({ student: s, unit: units.find(u => u.id === s.matched_unit_id) })).slice(0, 5)
    // Cohorts: filter the already-loaded (RLS-backed) cohort list in-memory; no extra query.
    const cohortMatches = (cohorts || []).filter(c => (c.name||'').toLowerCase().includes(ql)).slice(0, 5)
    // Catalog metadata match across title/description/category/tags (tags is text[] → client filter).
    const catalogMatches = (catRes.data || []).filter(r => {
      const hay = [r.title, r.description, r.category, ...(Array.isArray(r.tags) ? r.tags : [])].join(' ').toLowerCase()
      return hay.includes(ql)
    }).slice(0, 5)
    setSearchResults({
      students: stuRes.data||[], units: unitRes.data||[], placements, contacts: contRes.data||[],
      preceptors: precRes.data||[], cohorts: cohortMatches, catalog: catalogMatches,
    })
    setSearchLoading(false); setSearchActiveIdx(-1)
  }, [activeCohortId, students, units, cohorts]) // eslint-disable-line

  const handleSearchChange = e => {
    const q = e.target.value; setSearchQuery(q)
    clearTimeout(searchTimer.current)
    if (q.length < 2) { setSearchResults({ students:[], units:[], placements:[], contacts:[], preceptors:[], cohorts:[], catalog:[] }); setSearchOpen(false); return }
    searchTimer.current = setTimeout(() => runSearch(q), 300)
  }

  const searchFlat = [
    ...searchResults.students.map(s => ({ type:'student', data:s })),
    ...searchResults.units.map(u => ({ type:'unit', data:u })),
    ...searchResults.placements.map(p => ({ type:'placement', data:p })),
    ...searchResults.contacts.map(c => ({ type:'contact', data:c })),
    ...searchResults.preceptors.map(p => ({ type:'preceptor', data:p })),
    ...searchResults.cohorts.map(c => ({ type:'cohort', data:c })),
    ...searchResults.catalog.map(r => ({ type:'catalog', data:r })),
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
    else if (item.type === 'contact') { navigate(`/connect/contacts?contactId=${item.data.id}`) }
    // UNIVERSAL-SEARCH-1 — existing safe destinations only; no file access, no secure URLs.
    else if (item.type === 'preceptor') { navigate('/rotation/preceptors') }
    else if (item.type === 'cohort') { handleCohortSwitch(item.data.id) }
    else if (item.type === 'catalog') { navigate(`/catalog?resource=${encodeURIComponent(item.data.slug)}`) }
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
        {/* ── Application header (WS2.0: extracted to components/Header) ── */}
        <Header
          cohort={{ cohorts, cohortPickerRef, cohortOpen, setCohortOpen, activeCohort, activeCohortId, sortedCohorts, handleCohortSwitch, canEdit, setShowManageCohort, setShowNewCohort }}
          search={{ searchAreaRef, searchInputRef, searchQuery, searchFocused, searchOpen, searchLoading, searchFlat, searchResults, searchActiveIdx, setSearchActiveIdx, setSearchOpen, setSearchFocused, handleSearchChange, handleSearchKey, handleSearchResult }}
          actions={{ cohorts, navigate, activeTab, bellRef, setShowActionCenter, actionBadgeCount }}
        />

        {cohorts.length > 0 && activeTab !== 'connect' && activeTab !== 'settings' && activeTab !== 'catalog' && (
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
      </div>

      <main className="app-main">
        {/* WS2.1: Settings is an app-level utility section (available regardless of
            cohorts); it renders here while the operational tabs stay mounted+hidden. */}
        {activeTab === 'settings' && (
          <SettingsShell backPath={backPath} backLabel={backLabel} onRestartTour={restartTour} />
        )}
        {cohorts.length === 0 && !loading && activeTab !== 'settings' && (
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
                refreshRef={connectRefreshRef}
                backPath={backPath}
                backLabel={backLabel}
              />
            )}

            {/* CATALOG-1: read-only ASPIRE Catalog (Owner/Admin gated by RLS + endpoint). */}
            {activeTab === 'catalog' && (
              <CatalogPage backPath={backPath} backLabel={backLabel} />
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
      {/* WS2.2: People & Access re-homed to Settings → /settings/accounts.
          The legacy UserManagement modal render (formerly here) was removed; the
          modal wrapper component is retained in its file for direct callers/rollback. */}
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
      <Route path="/shift-log/*"          element={<ShiftLogLifecycle />} />
      <Route path="/evaluation/readiness/*" element={<div data-theme-lock="light"><EvaluationPage /></div>} />
      <Route path="/evaluation/feedback/*"  element={<div data-theme-lock="light"><PreceptorEvaluationPage /></div>} />
      <Route path="/evaluation/experience/*" element={<div data-theme-lock="light"><StudentEvaluationPage /></div>} />
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
