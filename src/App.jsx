import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import Dashboard from './components/Dashboard'
import StudentList from './components/StudentList'
import AddStudentModal from './components/AddStudentModal'
import MatchingTab from './components/MatchingTab'
import CohortBar from './components/CohortBar'
import NewCohortModal from './components/NewCohortModal'
import ManageCohortModal from './components/ManageCohortModal'

export default function App() {
  // ── Cohort state ─────────────────────────────────────────────────
  const [cohorts,         setCohorts]         = useState([])
  const [activeCohortId,  setActiveCohortId]  = useState(null)
  const [showNewCohort,   setShowNewCohort]   = useState(false)
  const [showManageCohort,setShowManageCohort]= useState(false)

  // ── Core data ─────────────────────────────────────────────────────
  const [students,     setStudents]     = useState([])
  const [units,        setUnits]        = useState([])
  const [matches,      setMatches]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dbError,      setDbError]      = useState(null)

  // ── UI state ──────────────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState('students')
  const [showAddModal, setShowAddModal] = useState(false)
  const [search,       setSearch]       = useState('')
  const [filters,      setFilters]      = useState({ school: '', status: '', cohort: '' })

  // ── Bootstrap: load cohorts first ─────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase
        .from('cohorts')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) { setDbError(error.message); setLoading(false); return }
      if (data && data.length > 0) {
        setCohorts(data)
        const active = data.find(c => c.status === 'Active') || data[0]
        setActiveCohortId(active.id)
      } else {
        setLoading(false) // no cohorts yet — show empty state
      }
    }
    init()
  }, [])

  // ── Reload data whenever activeCohortId changes ───────────────────
  useEffect(() => {
    if (!activeCohortId) return
    setLoading(true)
    setDbError(null)
    Promise.all([
      fetchStudents(activeCohortId),
      fetchUnits(activeCohortId),
      fetchMatches(activeCohortId),
    ]).finally(() => setLoading(false))
  }, [activeCohortId])

  // ── Fetch helpers ─────────────────────────────────────────────────
  const fetchStudents = async id => {
    const { data, error } = await supabase
      .from('students').select('*')
      .eq('cohort_id', id).order('school').order('name')
    if (error) setDbError(error.message)
    else setStudents(data || [])
  }

  const fetchUnits = async id => {
    const { data } = await supabase
      .from('units').select('*')
      .eq('cohort_id', id).order('unit_name')
    setUnits(data || [])
  }

  const fetchMatches = async id => {
    const { data } = await supabase
      .from('matches').select('*').eq('cohort_id', id)
    setMatches(data || [])
  }

  const refreshAll = () => {
    if (activeCohortId) {
      fetchStudents(activeCohortId)
      fetchUnits(activeCohortId)
      fetchMatches(activeCohortId)
    }
  }

  // ── Cohort CRUD ────────────────────────────────────────────────────
  const createCohort = async cohortData => {
    const { data, error } = await supabase
      .from('cohorts').insert(cohortData).select().single()
    if (!error && data) {
      setCohorts(prev => [data, ...prev])
      setActiveCohortId(data.id)
      setStudents([]); setUnits([]); setMatches([])
      setShowNewCohort(false)
    }
    return error || null
  }

  const updateCohort = async (id, updates) => {
    const { error } = await supabase.from('cohorts').update(updates).eq('id', id)
    if (!error) setCohorts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    return error || null
  }

  const handleCohortSwitch = id => {
    setActiveCohortId(id)
    setSearch('')
    setFilters({ school: '', status: '', cohort: '' })
  }

  // ── Student CRUD ──────────────────────────────────────────────────
  const updateStudent = useCallback(async (id, updates) => {
    const { error } = await supabase.from('students').update(updates).eq('id', id)
    if (!error) setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    return error || null
  }, [])

  const addStudent = async student => {
    if (!activeCohortId) return { message: 'No active cohort. Create one first.' }
    const { data, error } = await supabase
      .from('students')
      .insert({ ...student, cohort_id: activeCohortId })
      .select().single()
    if (!error && data) {
      setStudents(prev =>
        [...prev, data].sort((a, b) => (a.school + a.name).localeCompare(b.school + b.name))
      )
      setShowAddModal(false)
    }
    return error || null
  }

  // ── Matching ──────────────────────────────────────────────────────
  const createMatch = async (student, unit) => {
    if (!activeCohortId) return
    const { data: m, error } = await supabase
      .from('matches')
      .insert({ student_id: student.id, unit_id: unit.id, cohort_id: activeCohortId })
      .select().single()
    if (error) { console.error(error); return }

    const newRemaining = Math.max(0, unit.slots_remaining - 1)
    await supabase.from('students')
      .update({ matched_unit_id: unit.id, interview_outcome: 'Accepted' })
      .eq('id', student.id)
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)

    setMatches(prev => [...prev, m])
    setStudents(prev => prev.map(s =>
      s.id === student.id ? { ...s, matched_unit_id: unit.id, interview_outcome: 'Accepted' } : s
    ))
    setUnits(prev => prev.map(u =>
      u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u
    ))
  }

  const unmatch = async (student, unit) => {
    const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
    if (match) await supabase.from('matches').delete().eq('id', match.id)

    // Part 5: clear all three sync fields on the student record
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
    setUnits(prev => prev.map(u =>
      u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u
    ))
  }

  // Part 5: sync preceptor AND shift back to student record
  const updateMatch = async (matchId, studentId, updates) => {
    const { error } = await supabase.from('matches').update(updates).eq('id', matchId)
    if (!error) {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, ...updates } : m))
      const studentUpdates = {}
      if (updates.preceptor_assigned !== undefined) studentUpdates.matched_preceptor = updates.preceptor_assigned
      if (updates.shift_assigned     !== undefined) studentUpdates.shift_assigned     = updates.shift_assigned
      if (Object.keys(studentUpdates).length) {
        await supabase.from('students').update(studentUpdates).eq('id', studentId)
        setStudents(prev => prev.map(s =>
          s.id === studentId ? { ...s, ...studentUpdates } : s
        ))
      }
    }
  }

  // ── CSV export (Students tab) ─────────────────────────────────────
  const exportCSV = () => {
    const headers = [
      'Name', 'School Email', 'Personal Email', 'Phone', 'School', 'ASPIRE Cohort',
      'Term Dates', 'Hours Required', 'Hours Completed', 'Unit', 'Preceptor',
      'ASPIRE Status', 'NGRP Cohort Target', 'NGRP Outcome',
      'GPA Verified', 'BLS Current', 'Health Cleared', 'Background Check',
      'Coordinators', 'Notes',
    ]
    const rows = students.map(s => [
      s.name, s.school_email, s.personal_email, s.phone, s.school, s.aspire_cohort,
      s.term_dates, s.hours_required, s.hours_completed, s.unit, s.preceptor_name,
      s.status, s.ngrp_cohort_target, s.ngrp_outcome,
      s.gpa_verified ? 'Yes' : 'No', s.bls_current ? 'Yes' : 'No',
      s.health_cleared ? 'Yes' : 'No', s.background_check ? 'Yes' : 'No',
      s.coordinators, s.notes,
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `aspire-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const setFilter = (key, val) => setFilters(prev => ({ ...prev, [key]: val }))

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

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Fixed Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="header-logo">A</div>
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
          </div>
        </div>
      </header>

      {/* ── Cohort Bar ── */}
      {cohorts.length > 0 && (
        <CohortBar
          cohorts={cohorts}
          activeCohortId={activeCohortId}
          onSelect={handleCohortSwitch}
          onNew={() => setShowNewCohort(true)}
          onManage={() => setShowManageCohort(true)}
        />
      )}

      {/* ── Tab Bar ── */}
      {cohorts.length > 0 && (
        <div className="tab-bar">
          <button className={`tab-btn${activeTab === 'students' ? ' active' : ''}`} onClick={() => setActiveTab('students')}>
            Students
          </button>
          <button className={`tab-btn${activeTab === 'matching' ? ' active' : ''}`} onClick={() => setActiveTab('matching')}>
            Matching
          </button>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="app-main">

        {/* No cohorts yet */}
        {cohorts.length === 0 && !loading && (
          <div className="state-box" style={{ marginTop: 40 }}>
            <p style={{ marginBottom: 8, fontSize: 16, fontWeight: 600 }}>Welcome to ASPIRE Placement Tracker</p>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Get started by creating your first cohort. Each cohort tracks its own students, units, and matches.
            </p>
            <button className="btn btn-primary" onClick={() => setShowNewCohort(true)}>
              + Create First Cohort
            </button>
          </div>
        )}

        {loading && cohorts.length > 0 && (
          <div className="state-box"><div className="spinner" /><p>Loading…</p></div>
        )}

        {dbError && (
          <div className="state-box error-box">
            <p><strong>Database error:</strong> {dbError}</p>
            <p style={{ marginTop: 8, fontSize: 13, color: '#64748b' }}>
              Make sure you have run <code>setup.sql</code> and <code>migration_matching.sql</code> and <code>migration_cohorts.sql</code> in the Supabase SQL Editor.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={refreshAll}>Retry</button>
          </div>
        )}

        {/* ── Students Tab ── */}
        {!loading && !dbError && cohorts.length > 0 && activeTab === 'students' && (
          <>
            <Dashboard students={students} />
            <StudentList
              students={filteredStudents}
              allStudents={students}
              units={units}
              cohortId={activeCohortId}
              search={search}
              filters={filters}
              onSearch={setSearch}
              onFilter={setFilter}
              onUpdate={updateStudent}
              onRefresh={() => fetchStudents(activeCohortId)}
            />
          </>
        )}

        {/* ── Matching Tab ── */}
        {!loading && !dbError && cohorts.length > 0 && activeTab === 'matching' && (
          <MatchingTab
            students={students}
            units={units}
            matches={matches}
            cohortId={activeCohortId}
            onMatch={createMatch}
            onUnmatch={unmatch}
            onUpdateMatch={updateMatch}
            onRefreshUnits={() => fetchUnits(activeCohortId)}
          />
        )}
      </main>

      {/* ── Modals ── */}
      {showAddModal && (
        <AddStudentModal
          cohortId={activeCohortId}
          onAdd={addStudent}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {showNewCohort && (
        <NewCohortModal onSave={createCohort} onClose={() => setShowNewCohort(false)} />
      )}
      {showManageCohort && activeCohort && (
        <ManageCohortModal
          cohort={activeCohort}
          onSave={updateCohort}
          onClose={() => setShowManageCohort(false)}
        />
      )}
    </div>
  )
}
