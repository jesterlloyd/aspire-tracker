import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { SEED_STUDENTS } from './lib/seedData'
import Dashboard from './components/Dashboard'
import StudentList from './components/StudentList'
import AddStudentModal from './components/AddStudentModal'

export default function App() {
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ school: '', status: '', cohort: '' })

  useEffect(() => { fetchStudents() }, [])

  const fetchStudents = async () => {
    setLoading(true)
    setDbError(null)
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('school')
      .order('name')
    if (error) {
      setDbError(error.message)
    } else {
      setStudents(data || [])
    }
    setLoading(false)
  }

  const updateStudent = useCallback(async (id, updates) => {
    const { error } = await supabase.from('students').update(updates).eq('id', id)
    if (!error) {
      setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    }
    return error || null
  }, [])

  const addStudent = async student => {
    const { data, error } = await supabase.from('students').insert(student).select().single()
    if (!error && data) {
      setStudents(prev =>
        [...prev, data].sort((a, b) =>
          (a.school + a.name).localeCompare(b.school + b.name)
        )
      )
      setShowAddModal(false)
    }
    return error || null
  }

  const seedDatabase = async () => {
    setSeeding(true)
    const { error } = await supabase.from('students').insert(SEED_STUDENTS)
    if (!error) {
      await fetchStudents()
    } else {
      setDbError(error.message)
    }
    setSeeding(false)
  }

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
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aspire-tracker-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const setFilter = (key, val) => setFilters(prev => ({ ...prev, [key]: val }))

  const filteredStudents = students.filter(s => {
    if (search) {
      const q = search.toLowerCase()
      const hit =
        s.name?.toLowerCase().includes(q) ||
        s.school_email?.toLowerCase().includes(q) ||
        s.personal_email?.toLowerCase().includes(q)
      if (!hit) return false
    }
    if (filters.school && s.school !== filters.school) return false
    if (filters.status && s.status !== filters.status) return false
    if (filters.cohort && s.aspire_cohort !== filters.cohort) return false
    return true
  })

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
            <button className="btn btn-ghost" onClick={exportCSV}>
              ↓ Export CSV
            </button>
            <button className="btn btn-accent" onClick={() => setShowAddModal(true)}>
              + Add Student
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
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
              Run <code>setup.sql</code> in your Supabase SQL Editor, or click below to seed directly from the app.
            </p>
            <button className="btn btn-primary" onClick={seedDatabase} disabled={seeding}>
              {seeding ? 'Seeding…' : 'Seed 29 Students'}
            </button>
          </div>
        ) : (
          <StudentList
            students={filteredStudents}
            allStudents={students}
            search={search}
            filters={filters}
            onSearch={setSearch}
            onFilter={setFilter}
            onUpdate={updateStudent}
          />
        )}
      </main>

      {showAddModal && (
        <AddStudentModal onAdd={addStudent} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}
