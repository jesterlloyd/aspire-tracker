import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import Dashboard from './components/Dashboard'
import StudentList from './components/StudentList'
import AddStudentModal from './components/AddStudentModal'
import MatchingTab from './components/MatchingTab'
import CohortBar from './components/CohortBar'
import NewCohortModal from './components/NewCohortModal'
import ManageCohortModal from './components/ManageCohortModal'
import LoginPage from './components/LoginPage'
import UnitFormPage from './components/UnitFormPage'
import SchoolFormPage from './components/SchoolFormPage'
import PendingStudentSubmissions from './components/PendingStudentSubmissions'

function MainApp({ onLogout }) {
  const [cohorts,           setCohorts]           = useState([])
  const [activeCohortId,    setActiveCohortId]    = useState(null)
  const [showNewCohort,     setShowNewCohort]     = useState(false)
  const [showManageCohort,  setShowManageCohort]  = useState(false)
  const [confirmLogout,     setConfirmLogout]     = useState(false)

  const [students,           setStudents]           = useState([])
  const [units,              setUnits]              = useState([])
  const [matches,            setMatches]            = useState([])
  const [submissions,        setSubmissions]        = useState([])
  const [studentSubmissions, setStudentSubmissions] = useState([])
  const [loading,            setLoading]            = useState(true)
  const [dbError,            setDbError]            = useState(null)

  const [activeTab,    setActiveTab]    = useState('students')
  const [showAddModal, setShowAddModal] = useState(false)
  const [search,       setSearch]       = useState('')
  const [filters,      setFilters]      = useState({ school: '', status: '', cohort: '' })

  useEffect(() => {
    supabase.from('cohorts').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setDbError(error.message); setLoading(false); return }
        if (data?.length > 0) {
          setCohorts(data)
          setActiveCohortId((data.find(c => c.status === 'Active') || data[0]).id)
        } else setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!activeCohortId) return
    setLoading(true); setDbError(null)
    Promise.all([
      fetchStudents(activeCohortId), fetchUnits(activeCohortId),
      fetchMatches(activeCohortId),  fetchSubmissions(activeCohortId),
      fetchStudentSubmissions(activeCohortId),
    ]).finally(() => setLoading(false))
  }, [activeCohortId])

  const fetchStudents = async id => {
    const { data, error } = await supabase.from('students').select('*')
      .eq('cohort_id', id).order('school').order('name')
    if (error) setDbError(error.message); else setStudents(data || [])
  }
  const fetchUnits = async id => {
    const { data } = await supabase.from('units').select('*').eq('cohort_id', id).order('unit_name')
    setUnits(data || [])
  }
  const fetchMatches = async id => {
    const { data } = await supabase.from('matches').select('*').eq('cohort_id', id)
    setMatches(data || [])
  }
  const fetchSubmissions = async id => {
    const { data } = await supabase.from('unit_submissions').select('*')
      .eq('cohort_id', id).order('submitted_at', { ascending: false })
    setSubmissions(data || [])
  }
  const fetchStudentSubmissions = async id => {
    const { data } = await supabase.from('student_submissions').select('*')
      .eq('cohort_id', id).order('submitted_at', { ascending: false })
    setStudentSubmissions(data || [])
  }
  const refreshAll = () => {
    if (!activeCohortId) return
    fetchStudents(activeCohortId); fetchUnits(activeCohortId)
    fetchMatches(activeCohortId);  fetchSubmissions(activeCohortId)
    fetchStudentSubmissions(activeCohortId)
  }

  // ── Cohort CRUD ───────────────────────────────────────────────────
  const createCohort = async d => {
    const { data, error } = await supabase.from('cohorts').insert(d).select().single()
    if (!error && data) {
      setCohorts(prev => [data, ...prev]); setActiveCohortId(data.id)
      setStudents([]); setUnits([]); setMatches([])
      setSubmissions([]); setStudentSubmissions([]); setShowNewCohort(false)
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
    setActiveCohortId(id); setSearch(''); setFilters({ school: '', status: '', cohort: '' })
  }

  // ── Student CRUD ──────────────────────────────────────────────────
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
    setStudents(prev => prev.filter(s => s.id !== id))
  }

  // ── Unit CRUD ─────────────────────────────────────────────────────
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
    setMatches(prev => prev.filter(m => m.unit_id !== unit.id))
    setUnits(prev => prev.filter(u => u.id !== unit.id))
  }

  // ── Matching ──────────────────────────────────────────────────────
  const createMatch = async (student, unit) => {
    if (!activeCohortId) return
    const { data: m, error } = await supabase.from('matches')
      .insert({ student_id: student.id, unit_id: unit.id, cohort_id: activeCohortId })
      .select().single()
    if (error) { console.error(error); return }
    const newRemaining = Math.max(0, unit.slots_remaining - 1)
    await supabase.from('students')
      .update({ matched_unit_id: unit.id, interview_outcome: 'Accepted' }).eq('id', student.id)
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)
    setMatches(prev => [...prev, m])
    setStudents(prev => prev.map(s =>
      s.id === student.id ? { ...s, matched_unit_id: unit.id, interview_outcome: 'Accepted' } : s
    ))
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u))
  }

  const unmatch = async (student, unit) => {
    const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
    if (match) await supabase.from('matches').delete().eq('id', match.id)
    await supabase.from('students')
      .update({ matched_unit_id: null, matched_preceptor: '', shift_assigned: '', interview_outcome: 'Pending Interview' })
      .eq('id', student.id)
    const newRemaining = unit.slots_remaining + 1
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)
    if (match) setMatches(prev => prev.filter(m => m.id !== match.id))
    setStudents(prev => prev.map(s =>
      s.id === student.id
        ? { ...s, matched_unit_id: null, matched_preceptor: '', shift_assigned: '', interview_outcome: 'Pending Interview' }
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

  // ── Submission review ─────────────────────────────────────────────
  const approveSubmission = async sub => {
    // Only create a unit record if the unit is participating
    if (sub.is_participating && sub.total_slots > 0) {
      const { data: unitData, error } = await supabase.from('units').insert({
        unit_name: sub.unit_name, contact_person: sub.contact_person,
        total_slots: sub.total_slots, slots_remaining: sub.total_slots,
        shift_preference: sub.shift_preference, preceptors: sub.preceptors,
        considerations: sub.considerations, is_participating: true,
        cohort_id: activeCohortId,
      }).select().single()
      if (error) { console.error(error); return }
      setUnits(prev => [...prev, unitData].sort((a, b) => a.unit_name.localeCompare(b.unit_name)))
    }
    await supabase.from('unit_submissions').update({ review_status: 'Approved' }).eq('id', sub.id)
    setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, review_status: 'Approved' } : s))
  }

  const rejectSubmission = async sub => {
    await supabase.from('unit_submissions').update({ review_status: 'Rejected' }).eq('id', sub.id)
    setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, review_status: 'Rejected' } : s))
  }

  const approveStudentSubmission = async sub => {
    const activeCohort = cohorts.find(c => c.id === activeCohortId)
    const { data: studentData, error } = await supabase.from('students').insert({
      name: sub.student_name, school_email: sub.student_email,
      phone: sub.student_phone || '', school: sub.school,
      aspire_cohort: activeCohort?.name || '', term_dates: sub.term_dates || '',
      hours_required: sub.hours_required || 0, hours_completed: 0,
      status: 'Form Sent', interview_outcome: 'Pending Interview', ngrp_outcome: 'Pending',
      gpa_verified: false, bls_current: false, health_cleared: false, background_check: false,
      coordinators: sub.coordinator_name ? `${sub.coordinator_name} (${sub.coordinator_email})` : '',
      cohort_id: activeCohortId,
    }).select().single()
    if (error) { console.error(error); return }
    await supabase.from('student_submissions').update({ review_status: 'Approved' }).eq('id', sub.id)
    setStudentSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, review_status: 'Approved' } : s))
    setStudents(prev => [...prev, studentData].sort((a, b) => (a.school + a.name).localeCompare(b.school + b.name)))
  }

  const rejectStudentSubmission = async sub => {
    await supabase.from('student_submissions').update({ review_status: 'Rejected' }).eq('id', sub.id)
    setStudentSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, review_status: 'Rejected' } : s))
  }

  // ── CSV export ────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Name','School Email','Personal Email','Phone','School','ASPIRE Cohort',
      'Term Dates','Hours Required','Hours Completed','Unit','Preceptor','ASPIRE Status',
      'NGRP Cohort Target','NGRP Outcome','GPA Verified','BLS Current','Health Cleared',
      'Background Check','Coordinators','Notes']
    const rows = students.map(s => [
      s.name,s.school_email,s.personal_email,s.phone,s.school,s.aspire_cohort,
      s.term_dates,s.hours_required,s.hours_completed,s.unit,s.preceptor_name,
      s.status,s.ngrp_cohort_target,s.ngrp_outcome,
      s.gpa_verified?'Yes':'No',s.bls_current?'Yes':'No',
      s.health_cleared?'Yes':'No',s.background_check?'Yes':'No',
      s.coordinators,s.notes])
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

  const activeCohort        = cohorts.find(c => c.id === activeCohortId)
  const pendingSubmissions  = submissions.filter(s => s.review_status === 'Pending')
  const pendingStudentSubs  = studentSubmissions.filter(s => s.review_status === 'Pending')

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="32" />
            <div>
              <h1 className="header-title">ASPIRE Placement Tracker</h1>
              <p className="header-sub">Cedars-Sinai Medical Center</p>
            </div>
          </div>
          <div className="header-actions">
            {activeTab === 'students' && cohorts.length > 0 && (
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
          <button className={`tab-btn${activeTab === 'students' ? ' active' : ''}`} onClick={() => setActiveTab('students')}>
            Students
            {pendingStudentSubs.length > 0 && <span className="tab-badge">{pendingStudentSubs.length}</span>}
          </button>
          <button className={`tab-btn${activeTab === 'matching' ? ' active' : ''}`} onClick={() => setActiveTab('matching')}>
            Matching
            {pendingSubmissions.length > 0 && <span className="tab-badge">{pendingSubmissions.length}</span>}
          </button>
        </div>
      )}

      <main className="app-main">
        {cohorts.length === 0 && !loading && (
          <div className="state-box" style={{ marginTop: 40 }}>
            <p style={{ marginBottom: 8, fontSize: 16, fontWeight: 600 }}>Welcome to ASPIRE Placement Tracker</p>
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

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'students' && (
          <>
            {pendingStudentSubs.length > 0 && (
              <PendingStudentSubmissions submissions={pendingStudentSubs}
                onApprove={approveStudentSubmission} onReject={rejectStudentSubmission} />
            )}
            <Dashboard students={students} />
            <StudentList
              students={filteredStudents} allStudents={students}
              units={units} cohortId={activeCohortId}
              search={search} filters={filters}
              onSearch={setSearch} onFilter={setFilter}
              onUpdate={updateStudent} onDelete={deleteStudent}
              onRefresh={() => fetchStudents(activeCohortId)}
            />
          </>
        )}

        {!loading && !dbError && cohorts.length > 0 && activeTab === 'matching' && (
          <MatchingTab
            students={students} units={units} matches={matches}
            cohortId={activeCohortId} pendingSubmissions={pendingSubmissions}
            onMatch={createMatch} onUnmatch={unmatch} onUpdateMatch={updateMatch}
            onRefreshUnits={() => fetchUnits(activeCohortId)}
            onApproveSubmission={approveSubmission} onRejectSubmission={rejectSubmission}
            onDeleteUnit={deleteUnit}
          />
        )}
      </main>

      {showAddModal && <AddStudentModal cohortId={activeCohortId} onAdd={addStudent} onClose={() => setShowAddModal(false)} />}
      {showNewCohort && <NewCohortModal onSave={createCohort} onClose={() => setShowNewCohort(false)} />}
      {showManageCohort && activeCohort && (
        <ManageCohortModal cohort={activeCohort} onSave={updateCohort} onClose={() => setShowManageCohort(false)} />
      )}
    </div>
  )
}

export default function App() {
  const path = window.location.pathname
  // Auth check runs before anything else — MainApp never mounts unless authed
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('aspire_auth') === '1')

  const handleLogout = () => {
    sessionStorage.removeItem('aspire_auth')
    setAuthed(false)
  }

  if (path.startsWith('/unit-form'))   return <UnitFormPage />
  if (path.startsWith('/school-form')) return <SchoolFormPage />
  if (!authed) return <LoginPage onSuccess={() => setAuthed(true)} />
  return <MainApp onLogout={handleLogout} />
}
