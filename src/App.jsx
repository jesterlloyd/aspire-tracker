import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { updateStudent as proxyUpdateStudent } from './lib/studentProxy'
import { displayName } from './lib/utils'
import OverviewTab from './components/OverviewTab'
import StudentProfilesTab from './components/StudentProfilesTab'
import InterviewRubricTab from './components/InterviewRubricTab'
import MatchingTab from './components/MatchingTab'
import AddStudentModal from './components/AddStudentModal'
import UnifiedNav from './components/UnifiedNav'
import NewCohortModal from './components/NewCohortModal'
import ManageCohortModal from './components/ManageCohortModal'
import { useAuth } from './contexts/AuthContext'
import LoginNew from './pages/Login'
import UserMenu from './components/UserMenu'
import UserManagement from './components/UserManagement'
import UnitFormPage from './components/UnitFormPage'
import SchoolFormPage from './components/SchoolFormPage'
import StudentIntakeFormPage from './components/StudentIntakeFormPage'
import InterviewSchedulePage from './components/InterviewSchedulePage'
import ShiftLogPage from './components/ShiftLogPage'
import InterviewersModal from './components/InterviewersModal'
import ActionCenter from './components/ActionCenter'
import OnboardingTour from './components/OnboardingTour'
import { TOUR_VERSION } from './lib/onboardingTours'
import Keith from './components/Keith'
import FeedbackPanel from './components/FeedbackPanel'
import { logEvent, eventExists } from './lib/logEvent'
import { useToast } from './hooks/useToast'
import { ToastContainer } from './components/Toast'
import { logActivity } from './lib/logActivity'

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

function MainApp({ onLogout }) {
  const { toasts, removeToast, toast } = useToast()
  const { userProfile: currentUserProfile } = useAuth()

  // One-time cleanup of old shared-password auth storage keys
  useEffect(() => {
    ['aspire_auth', 'aspire_password', 'app_authenticated', 'isAuthenticated'].forEach(key => {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [cohorts,          setCohorts]          = useState([])
  const [activeCohortId,   setActiveCohortId]   = useState(null)
  const [showNewCohort,    setShowNewCohort]    = useState(false)
  const [showManageCohort, setShowManageCohort] = useState(false)
  const [confirmLogout,    setConfirmLogout]    = useState(false)
  const [showUserManagement, setShowUserManagement] = useState(false)

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

  const [activeTab,    setActiveTab]    = useState(() => {
    const saved = localStorage.getItem('aspire_active_tab')
    return ['overview','profiles','interviews','matching'].includes(saved) ? saved : 'overview'
  })
  const [profilesView, setProfilesView] = useState('records')
  const [accessFocusId, setAccessFocusId] = useState(null)
  const [showAddModal,       setShowAddModal]       = useState(false)
  const [showInterviewersModal, setShowInterviewersModal] = useState(false)
  const [focusStudentId,     setFocusStudentId]     = useState(null)
  const [highlightUnitId,    setHighlightUnitId]    = useState(null)
  const [search,  setSearch]  = useState('')
  const [filters, setFilters] = useState({ school: '', status: '', cohort: '' })

  useEffect(() => {
    const loadCohorts = async () => {
      const { data, error } = await supabase.from('cohorts').select('*').order('created_at', { ascending: false })
      if (error) {
        // Retry once on lock/session errors before showing the error state
        if (error.message?.toLowerCase().includes('lock') || error.code === 'PGRST301') {
          setTimeout(loadCohorts, 1500)
          return
        }
        setDbError(error.message)
        setLoading(false)
        return
      }
      if (data?.length > 0) {
        setCohorts(data)
        const saved    = localStorage.getItem('aspire_active_cohort_id')
        const restored = saved && data.find(c => c.id === saved)
        setActiveCohortId(restored ? restored.id : (data.find(c => c.status === 'Active') || data[0]).id)
      } else setLoading(false)
    }
    loadCohorts()
  }, [])

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
    const { data, error } = await supabase.from('students').select('*')
      .eq('cohort_id', id).order('school').order('name')
    if (error) setDbError(error.message); else setStudents(data || [])
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
    const { data, error } = await supabase.from('cohorts').insert(d).select().single()
    if (!error && data) {
      setCohorts(prev => [data, ...prev])
      localStorage.setItem('aspire_active_cohort_id', data.id)
      setActiveCohortId(data.id)
      setStudents([]); setUnits([]); setMatches([]); setInterviews([])
      setShowNewCohort(false)
    }
    return error || null
  }
  const updateCohort = async (id, updates) => {
    if (updates.accepting_submissions === true) {
      await supabase.from('cohorts').update({ accepting_submissions: false }).neq('id', id)
      setCohorts(prev => prev.map(c => c.id !== id ? { ...c, accepting_submissions: false } : c))
    }
    const { error } = await supabase.from('cohorts').update(updates).eq('id', id)
    if (!error) setCohorts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    return error || null
  }
  const handleCohortSwitch = id => {
    localStorage.setItem('aspire_active_cohort_id', id)
    setActiveCohortId(id); setSearch(''); setFilters({ school: '', status: '', cohort: '' })
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
    setActiveTab(tab)
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
    supabase.from('cohorts').update({ match_quality_summary: summary }).eq('id', activeCohortId)
    setCohorts(prev => prev.map(c => c.id === activeCohortId ? { ...c, match_quality_summary: summary } : c))
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
  const updateStudent = useCallback(async (id, updates) => {
    try {
      await proxyUpdateStudent(id, updates)
      setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
      return null
    } catch (err) {
      return err
    }
  }, [])

  const addStudent = async student => {
    if (!activeCohortId) return { message: 'No active cohort.' }
    const { data, error } = await supabase.from('students')
      .insert({ ...student, cohort_id: activeCohortId }).select().single()
    if (!error && data) {
      setStudents(prev => [...prev, data].sort((a, b) => (a.school + a.name).localeCompare(b.school + b.name)))
      setShowAddModal(false)
    }
    return error || null
  }

  const deleteStudent = async id => {
    await supabase.from('students').delete().eq('id', id)
    // Belt-and-suspenders: explicitly remove related records in case CASCADE is not yet applied
    await supabase.from('interviews').delete().eq('student_id', id)
    await supabase.from('interview_rubrics').delete().eq('student_id', id)
    await supabase.from('matches').delete().eq('student_id', id)
    await supabase.from('interview_sessions').delete().eq('student_id', id)
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
      await supabase.from('students')
        .update({ matched_unit_id: null, matched_preceptor: '', shift_assigned: '', interview_outcome: 'Pending Interview' })
        .in('id', matchedIds)
      await supabase.from('matches').delete().eq('unit_id', unit.id)
    }
    await supabase.from('units').delete().eq('id', unit.id)
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
    const { data: m, error } = await supabase.from('matches')
      .insert({ student_id: student.id, unit_id: unit.id, cohort_id: activeCohortId, match_quality })
      .select().single()
    if (error) { console.error(error); return }
    const newRemaining = Math.max(0, unit.slots_remaining - 1)
    await supabase.from('students')
      .update({ matched_unit_id: unit.id, interview_outcome: 'Accepted', match_quality, status: 'Placed' }).eq('id', student.id)
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)
    updateCohortMatchSummary([...matches, m])
    setMatches(prev => [...prev, m])
    setStudents(prev => prev.map(s =>
      s.id === student.id ? { ...s, matched_unit_id: unit.id, interview_outcome: 'Accepted', match_quality, status: 'Placed' } : s
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
    if (match) await supabase.from('matches').delete().eq('id', match.id)
    await supabase.from('students')
      .update({ matched_unit_id: null, matched_preceptor: '', shift_assigned: '', match_quality: null, interview_outcome: 'Pending Interview', status: revertStatus })
      .eq('id', student.id)
    const newRemaining = unit.slots_remaining + 1
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)
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
    const { error } = await supabase.from('matches').update(updates).eq('id', matchId)
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
      students.filter(s => s.status==='Completed'&&!hasSent(s.id,'certificate')).length +
      students.filter(s => s.status==='Completed'&&!hasSent(s.id,'end_eval')).length +
      // Act 14: completed hours needing certificate
      students.filter(s => ['Active Rotation','Completed'].includes(s.status)&&parseFloat(s.approved_hours||0)>=parseFloat(s.hours_required||0)&&parseFloat(s.hours_required||0)>0&&!hasSent(s.id,'certificate')).length +
      // Act 16: badge not created
      students.filter(s => s.status==='Placed'&&!s.badge_created).length
    )
  })()

  return (
    <div className="app">
      <div className="top-section">
        <header className="app-header">
          <div className="header-inner">
            {/* Left: Logo + divider + title block */}
            <div style={{ display:'flex', alignItems:'center', gap:16, flex:1 }}>
              <img src="/cs-logo-rev.png" alt="Cedars-Sinai" style={{ height:'32px', width:'auto', objectFit:'contain' }} />
              <div style={{ width:1, height:32, background:'rgba(255,255,255,0.2)', flexShrink:0 }} />
              <div style={{ display:'flex', flexDirection:'column', justifyContent:'center' }}>
                <h1 className="header-title">ASPIRE Intelligence</h1>
                <p style={{ margin:0, fontSize:11, color:'rgba(255,255,255,0.6)', fontWeight:400, letterSpacing:'0.01em', lineHeight:1.3 }}>
                  Affiliate Students' Pathway from Internship to Residency Experience
                </p>
              </div>
            </div>
            {/* Right: Bell + UserMenu */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {cohorts.length > 0 && (
                <button id="keith-bell-trigger" data-tour="action-center" onClick={() => setShowActionCenter(true)}
                  title="Open Action Center"
                  style={{ position:'relative', background:'none', border:'none', cursor:'pointer', padding:'4px 6px', lineHeight:1 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  {actionBadgeCount > 0 && (
                    <span style={{ position:'absolute', top:-4, right:-4,
                      minWidth:18, height:18, borderRadius:9, background:'#dc1e34',
                      color:'#fff', fontSize:11, fontWeight:700, fontFamily:'DM Sans',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      padding:'0 3px', lineHeight:1, border:'2px solid var(--nightfall)' }}>
                      {actionBadgeCount >= 10 ? '9+' : actionBadgeCount}
                    </span>
                  )}
                </button>
              )}
              <UserMenu
                onOpenUserManagement={() => setShowUserManagement(true)}
                onRestartTour={() => { switchTab('overview'); setTimeout(() => setTourRunning(true), 400) }}
              />
            </div>
          </div>
        </header>

        {cohorts.length > 0 && (
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
              switchTab('matching')
              setTimeout(() => setHighlightUnitId(null), 2500)
            }}
          />
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

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'overview' && (
          <OverviewTab students={students} units={units} onStudentUpdate={updateStudent} cohortId={activeCohortId} cohort={activeCohort} toast={toast} />
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'profiles' && (
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
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'interviews' && (
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
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'matching' && (
          <MatchingTab
            students={students} units={units} matches={matches}
            cohortId={activeCohortId}
            onMatch={createMatch} onUnmatch={unmatch} onUpdateMatch={updateMatch}
            onRefreshUnits={() => fetchUnits(activeCohortId)}
            onDeleteUnit={deleteUnit}
            highlightUnitId={highlightUnitId}
            toast={toast}
          />
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
      <OnboardingTour run={tourRunning} onClose={() => setTourRunning(false)} />
      <UserManagement
        isOpen={showUserManagement}
        onClose={() => setShowUserManagement(false)}
      />
    </div>
  )
}

export default function App() {
  const path = window.location.pathname
  const { user, userProfile, loading, signOut } = useAuth()

  // Public routes — never require auth
  const publicPaths = ['/unit-form', '/school-form', '/student-form', '/interview-schedule', '/shift-log']
  const isPublicRoute = publicPaths.some(p => path.startsWith(p))

  if (path.startsWith('/unit-form'))           return <UnitFormPage />
  if (path.startsWith('/school-form'))         return <SchoolFormPage />
  if (path.startsWith('/student-form'))        return <StudentIntakeFormPage />
  if (path.startsWith('/interview-schedule'))  return <InterviewSchedulePage />
  if (path.startsWith('/shift-log'))            return <ShiftLogPage />

  // Loading state while Supabase checks session
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

  // Not signed in → show new Supabase login page
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
