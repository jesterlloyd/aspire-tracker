import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { SEED_STUDENTS } from './lib/seedData'
import Dashboard from './components/Dashboard'
import StudentList from './components/StudentList'
import AddStudentModal from './components/AddStudentModal'
import MatchingTab from './components/MatchingTab'

export default function App() {
  const [activeTab,    setActiveTab]    = useState('students')
  const [students,     setStudents]     = useState([])
  const [units,        setUnits]        = useState([])
  const [matches,      setMatches]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dbError,      setDbError]      = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [seeding,      setSeeding]      = useState(false)
  const [search,       setSearch]       = useState('')
  const [filters,      setFilters]      = useState({ school: '', status: '', cohort: '' })

  useEffect(() => {
    fetchStudents()
    fetchUnits()
    fetchMatches()
  }, [])

  const fetchStudents = async () => {
    setLoading(true)
    setDbError(null)
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('school')
      .order('name')
    if (error) setDbError(error.message)
    else setStudents(data || [])
    setLoading(false)
  }

  const fetchUnits = async () => {
    const { data } = await supabase.from('units').select('*').order('unit_name')
    if (data) setUnits(data)
  }

  const fetchMatches = async () => {
    const { data } = await supabase.from('matches').select('*')
    if (data) setMatches(data)
  }

  // ── Student CRUD ─────────────────────────────────────────────────

  const updateStudent = useCallback(async (id, updates) => {
    const { error } = await supabase.from('students').update(updates).eq('id', id)
    if (!error) setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    return error || null
  }, [])

  const addStudent = async student => {
    const { data, error } = await supabase.from('students').insert(student).select().single()
    if (!error && data) {
      setStudents(prev =>
        [...prev, data].sort((a, b) => (a.school + a.name).localeCompare(b.school + b.name))
      )
      setShowAddModal(false)
    }
    return error || null
  }

  const seedDatabase = async () => {
    setSeeding(true)
    const { error } = await supabase.from('students').insert(SEED_STUDENTS)
    if (!error) await fetchStudents()
    else setDbError(error.message)
    setSeeding(false)
  }

  // ── Matching ──────────────────────────────────────────────────────

  const createMatch = async (student, unit) => {
    const { data: matchData, error } = await supabase
      .from('matches')
      .insert({ student_id: student.id, unit_id: unit.id })
      .select()
      .single()
    if (error) { console.error('createMatch:', error); return }

    const newRemaining = Math.max(0, unit.slots_remaining - 1)
    await supabase.from('students').update({ matched_unit_id: unit.id }).eq('id', student.id)
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)

    setMatches(prev => [...prev, matchData])
    setStudents(prev => prev.map(s => s.id === student.id ? { ...s, matched_unit_id: unit.id } : s))
    setUnits(prev => prev.map(u => u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u))
  }

  const unmatch = async (student, unit) => {
    const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
    if (match) await supabase.from('matches').delete().eq('id', match.id)

    await supabase.from('students')
      .update({ matched_unit_id: null, matched_preceptor: '' })
      .eq('id', student.id)

    const newRemaining = unit.slots_remaining + 1
    await supabase.from('units').update({ slots_remaining: newRemaining }).eq('id', unit.id)

    if (match) setMatches(prev => prev.filter(m => m.id !== match.id))
    setStudents(prev => prev.map(s =>
      s.id === student.id ? { ...s, matched_unit_id: null, matched_preceptor: '' } : s
    ))
    setUnits(prev => prev.map(u =>
      u.id === unit.id ? { ...u, slots_remaining: newRemaining } : u
    ))
  }

  const updateMatch = async (matchId, studentId, updates) => {
    const { error } = await supabase.from('matches').update(updates).eq('id', matchId)
    if (!error) {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, ...updates } : m))
      if (updates.preceptor_assigned !== undefined) {
        await supabase.from('students')
          .update({ matched_preceptor: updates.preceptor_assigned })
          .eq('id', studentId)
        setStudents(prev => prev.map(s =>
          s.id === studentId ? { ...s, matched_preceptor: updates.preceptor_assigned } : s
        ))
      }
    }
  }

  // ── CSV export (Students tab) ──────────────────────────────────────

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
    a.href     = url
    a.download = `aspire-tracker-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Filtering ─────────────────────────────────────────────────────

  const setFilter = (key, val) => setFilters(prev => ({ ...prev, [key]: val }))

  const filteredStudents = students.filter(s => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !s.name?.toLowerCase().includes(q) &&
        !s.school_email?.toLowerCase().includes(q) &&
        !s.personal_email?.toLowerCase().includes(q)
      ) return false
    }
    if (filters.school && s.school !== filters.school) return false
    if (filters.status && s.status !== filters.status)  return false
    if (filters.cohort && s.aspire_cohort !== filters.cohort) return false
    return true
  })

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="app">
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
            {activeTab === 'students' && (
              <>
                <button className="btn btn-ghost" onClick={exportCSV}>↓ Export CSV</button>
                <button className="btn btn-accent" onClick={() => setShowAddModal(true)}>+ Add Student</button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Tab navigation */}
      <div className="tab-bar">
        <button
          className={`tab-btn${activeTab === 'students' ? ' active' : ''}`}
          onClick={() => setActiveTab('students')}
        >
          Students
        </button>
        <button
          className={`tab-btn${activeTab === 'matching' ? ' active' : ''}`}
          onClick={() => setActiveTab('matching')}
        >
          Matching
        </button>
      </div>

      <main className="app-main">
        {/* ── Students tab ── */}
        {activeTab === 'students' && (
          <>
            <Dashboard students={students} />

            {loading ? (
              <div className="state-box">
                <div className="spinner" />
                <p>Loading students…</p>
              </div>
            ) : dbError ? (
              <div className="state-box error-box">
                <p><strong>Database error:</strong> {dbError}</p>
                <p style={{ marginTop: 8, fontSize: 13, color: '#64748b' }}>
                  Make sure you have run <code>setup.sql</code> in your Supabase SQL Editor.
                </p>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={fetchStudents}>
                  Retry
                </button>
              </div>
            ) : students.length === 0 ? (
              <div className="state-box">
                <p style={{ marginBottom: 8 }}>No students found in the database.</p>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                  Run <code>setup.sql</code> in your Supabase SQL Editor, or seed directly from the app.
                </p>
                <button className="btn btn-primary" onClick={seedDatabase} disabled={seeding}>
                  {seeding ? 'Seeding…' : 'Seed 29 Students'}
                </button>
              </div>
            ) : (
              <StudentList
                students={filteredStudents}
                allStudents={students}
                units={units}
                search={search}
                filters={filters}
                onSearch={setSearch}
                onFilter={setFilter}
                onUpdate={updateStudent}
              />
            )}
          </>
        )}

        {/* ── Matching tab ── */}
        {activeTab === 'matching' && (
          <MatchingTab
            students={students}
            units={units}
            matches={matches}
            onMatch={createMatch}
            onUnmatch={unmatch}
            onUpdateMatch={updateMatch}
          />
        )}
      </main>

      {showAddModal && (
        <AddStudentModal onAdd={addStudent} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}
