import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { displayName } from './lib/utils'
import OverviewTab from './components/OverviewTab'
import StudentProfilesTab from './components/StudentProfilesTab'
import InterviewRubricTab from './components/InterviewRubricTab'
import MatchingTab from './components/MatchingTab'
import AddStudentModal from './components/AddStudentModal'
import CohortBar from './components/CohortBar'
import NewCohortModal from './components/NewCohortModal'
import ManageCohortModal from './components/ManageCohortModal'
import LoginPage from './components/LoginPage'
import UnitFormPage from './components/UnitFormPage'
import SchoolFormPage from './components/SchoolFormPage'
import StudentIntakeFormPage from './components/StudentIntakeFormPage'
import InterviewersModal from './components/InterviewersModal'

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
  const [cohorts,          setCohorts]          = useState([])
  const [activeCohortId,   setActiveCohortId]   = useState(null)
  const [showNewCohort,    setShowNewCohort]    = useState(false)
  const [showManageCohort, setShowManageCohort] = useState(false)
  const [confirmLogout,    setConfirmLogout]    = useState(false)

  const [students,  setStudents]  = useState([])
  const [units,     setUnits]     = useState([])
  const [matches,   setMatches]   = useState([])
  const [interviews, setInterviews] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [dbError,   setDbError]   = useState(null)

  const [activeTab,    setActiveTab]    = useState('overview')
  const [profilesView, setProfilesView] = useState('records')
  const [accessFocusId, setAccessFocusId] = useState(null)
  const [showAddModal,  setShowAddModal] = useState(false)
  const [showInterviewersModal, setShowInterviewersModal] = useState(false)
  const [search,  setSearch]  = useState('')
  const [filters, setFilters] = useState({ school: '', status: '', cohort: '' })

  useEffect(() => {
    supabase.from('cohorts').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setDbError(error.message); setLoading(false); return }
        if (data?.length > 0) {
          setCohorts(data)
          const saved    = localStorage.getItem('aspire_active_cohort_id')
          const restored = saved && data.find(c => c.id === saved)
          setActiveCohortId(restored ? restored.id : (data.find(c => c.status === 'Active') || data[0]).id)
        } else setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!activeCohortId) return
    // Clear stale data from previous cohort immediately so no cross-cohort bleed
    setStudents([]); setUnits([]); setMatches([]); setInterviews([])
    setLoading(true); setDbError(null)
    Promise.all([
      fetchStudents(activeCohortId), fetchUnits(activeCohortId),
      fetchMatches(activeCohortId),  fetchInterviews(activeCohortId),
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
  const refreshAll = () => {
    if (!activeCohortId) return
    fetchStudents(activeCohortId); fetchUnits(activeCohortId)
    fetchMatches(activeCohortId);  fetchInterviews(activeCohortId)
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

  const updateCohortMatchSummary = (newMatchList) => {
    const summary = computeMatchSummary(newMatchList)
    supabase.from('cohorts').update({ match_quality_summary: summary }).eq('id', activeCohortId)
    setCohorts(prev => prev.map(c => c.id === activeCohortId ? { ...c, match_quality_summary: summary } : c))
  }

  const switchToAccess = (studentId) => {
    setActiveTab('profiles')
    setProfilesView('access')
    setAccessFocusId(studentId)
    setTimeout(() => {
      document.getElementById(`access-row-${studentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
  }

  // ── Student CRUD ─────────────────────────────────────────────
  const updateStudent = useCallback(async (id, updates) => {
    const { error } = await supabase.from('students').update(updates).eq('id', id)
    if (!error) setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    return error || null
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
    // Refetch all affected state so every tab reflects the deletion immediately
    setStudents(prev => prev.filter(s => s.id !== id))
    setInterviews(prev => prev.filter(iv => iv.student_id !== id))
    setMatches(prev => prev.filter(m => m.student_id !== id))
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
    const match_quality = unit.unit_name === student.unit_preference_1 ? 'top_choice'
      : unit.unit_name === student.unit_preference_2 ? 'second_choice'
      : 'other'
    const { data: m, error } = await supabase.from('matches')
      .insert({ student_id: student.id, unit_id: unit.id, cohort_id: activeCohortId, match_quality })
      .select().single()
    if (error) { console.error(error); return }
    const newRemaining = Math.max(0, unit.slots_remaining - 1)
    await supabase.from('students')
      .update({ matched_unit_id: unit.id, interview_outcome: 'Accepted', match_quality }).eq('id', student.id)
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)
    updateCohortMatchSummary([...matches, m])
    setMatches(prev => [...prev, m])
    setStudents(prev => prev.map(s =>
      s.id === student.id ? { ...s, matched_unit_id: unit.id, interview_outcome: 'Accepted', match_quality } : s
    ))
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u))
  }

  const unmatch = async (student, unit) => {
    const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
    if (match) await supabase.from('matches').delete().eq('id', match.id)
    await supabase.from('students')
      .update({ matched_unit_id: null, matched_preceptor: '', shift_assigned: '', match_quality: null })
      .eq('id', student.id)
    const newRemaining = unit.slots_remaining + 1
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)
    updateCohortMatchSummary(match ? matches.filter(m => m.id !== match.id) : matches)
    if (match) setMatches(prev => prev.filter(m => m.id !== match.id))
    setStudents(prev => prev.map(s =>
      s.id === student.id
        ? { ...s, matched_unit_id: null, matched_preceptor: '', shift_assigned: '', match_quality: null }
        : s
    ))
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u))
  }

  const updateMatch = async (matchId, studentId, updates) => {
    const { error } = await supabase.from('matches').update(updates).eq('id', matchId)
    if (!error) {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, ...updates } : m))
      const su = {}
      if (updates.preceptor_assigned !== undefined) su.matched_preceptor = updates.preceptor_assigned
      if (updates.shift_assigned     !== undefined) su.shift_assigned     = updates.shift_assigned
      if (Object.keys(su).length) {
        await supabase.from('students').update(su).eq('id', studentId)
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
    a.href=url; a.download=`aspire-${new Date().toISOString().slice(0,10)}.csv`; a.click()
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

  return (
    <div className="app">
      <div className="top-section">
        <header className="app-header">
          <div className="header-inner">
            <div className="header-brand">
              <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="32" />
              <div>
                <h1 className="header-title">ASPIRE Program Tracker</h1>
              </div>
            </div>
            <div className="header-actions">
              {activeTab === 'interviews' && cohorts.length > 0 && (
                <button className="btn btn-outline-modal"
                  style={{ fontSize: 13, fontWeight: 600 }}
                  onClick={() => setShowInterviewersModal(true)}>
                  Manage Interviewers
                </button>
              )}
              {activeTab === 'profiles' && profilesView === 'records' && cohorts.length > 0 && (
                <>
                  <button className="btn btn-ghost" onClick={exportCSV}>↓ Export CSV</button>
                  <button className="btn btn-accent" onClick={() => setShowAddModal(true)}>+ Add Student</button>
                </>
              )}
              {!confirmLogout ? (
                <button className="btn-logout" onClick={() => setConfirmLogout(true)}>Log out</button>
              ) : (
                <div className="logout-confirm-inline">
                  <span className="logout-confirm-text">Are you sure?</span>
                  <button className="btn-logout-yes" onClick={onLogout}>Log out</button>
                  <button className="btn-logout-no"  onClick={() => setConfirmLogout(false)}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {cohorts.length > 0 && (
          <CohortBar cohorts={cohorts} activeCohortId={activeCohortId}
            onSelect={handleCohortSwitch} onNew={() => setShowNewCohort(true)}
            onManage={() => setShowManageCohort(true)} />
        )}

        {cohorts.length > 0 && (
          <div className="tab-bar">
            <button className={`tab-btn${activeTab === 'overview'   ? ' active' : ''}`} onClick={() => setActiveTab('overview')} aria-label="Aggregate tab">
              <span>Aggregate</span>
              <span className="tab-aspire-hint">A</span>
            </button>
            <button className={`tab-btn${activeTab === 'profiles'   ? ' active' : ''}`} onClick={() => setActiveTab('profiles')} aria-label="Student Profiles tab">
              <span>Student Profiles</span>
              <span className="tab-aspire-hint">S · P</span>
            </button>
            <button className={`tab-btn${activeTab === 'interviews' ? ' active' : ''}`} onClick={() => setActiveTab('interviews')} aria-label="Interview Rubric tab">
              <span>Interview Rubric</span>
              <span className="tab-aspire-hint">I · R</span>
            </button>
            <button className={`tab-btn${activeTab === 'matching'   ? ' active' : ''}`} onClick={() => setActiveTab('matching')} aria-label="Embed tab">
              <span>Embed</span>
              <span className="tab-aspire-hint">E</span>
            </button>
          </div>
        )}
      </div>

      <main className="app-main">
        {cohorts.length === 0 && !loading && (
          <div className="state-box" style={{ marginTop: 40 }}>
            <p style={{ marginBottom: 8, fontSize: 16, fontWeight: 600 }}>Welcome to ASPIRE Program Tracker</p>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Get started by creating your first cohort.</p>
            <button className="btn btn-primary" onClick={() => setShowNewCohort(true)}>+ Create First Cohort</button>
          </div>
        )}
        {loading && cohorts.length > 0 && <div className="state-box"><div className="spinner" /><p>Loading…</p></div>}
        {dbError && (
          <div className="state-box error-box">
            <p><strong>Database error:</strong> {dbError}</p>
            <p style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>Make sure you have run all SQL migrations in the Supabase SQL Editor.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={refreshAll}>Retry</button>
          </div>
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'overview' && (
          <OverviewTab students={students} units={units} onStudentUpdate={updateStudent} />
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'profiles' && (
          <StudentProfilesTab
            students={filteredStudents} allStudents={students}
            units={units} cohortId={activeCohortId}
            search={search} filters={filters}
            onSearch={setSearch} onFilter={setFilter}
            onUpdate={updateStudent} onDelete={deleteStudent}
            onRefresh={() => fetchStudents(activeCohortId)}
            onSwitchToAccess={switchToAccess}
            view={profilesView} onViewChange={setProfilesView}
            accessFocusId={accessFocusId}
          />
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'interviews' && (
          <InterviewRubricTab
            students={students}
            rubrics={interviews}
            cohortId={activeCohortId}
            onStudentUpdate={updateStudent}
            onRubricsChange={() => fetchInterviews(activeCohortId)}
          />
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'matching' && (
          <MatchingTab
            students={students} units={units} matches={matches}
            cohortId={activeCohortId}
            onMatch={createMatch} onUnmatch={unmatch} onUpdateMatch={updateMatch}
            onRefreshUnits={() => fetchUnits(activeCohortId)}
            onDeleteUnit={deleteUnit}
          />
        )}
      </main>

      {showAddModal && <AddStudentModal cohortId={activeCohortId} onAdd={addStudent} onClose={() => setShowAddModal(false)} />}
      {showNewCohort && <NewCohortModal onSave={createCohort} onClose={() => setShowNewCohort(false)} />}
      {showManageCohort && activeCohort && (
        <ManageCohortModal cohort={activeCohort} onSave={updateCohort} onClose={() => setShowManageCohort(false)} />
      )}
      {showInterviewersModal && (
        <InterviewersModal onClose={() => setShowInterviewersModal(false)} />
      )}
    </div>
  )
}

export default function App() {
  const path = window.location.pathname
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('aspire_auth') === '1')

  const handleLogout = () => {
    sessionStorage.removeItem('aspire_auth')
    setAuthed(false)
  }

  if (path.startsWith('/unit-form'))    return <UnitFormPage />
  if (path.startsWith('/school-form'))  return <SchoolFormPage />
  if (path.startsWith('/student-form')) return <StudentIntakeFormPage />
  if (!authed) return <LoginPage onSuccess={() => setAuthed(true)} />
  return <MainApp onLogout={handleLogout} />
}
