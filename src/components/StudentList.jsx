import { useState } from 'react'
import { ASPIRE_STATUSES } from '../lib/constants'
import StudentRow from './StudentRow'
import ImportStudentsCSV from './ImportStudentsCSV'

const ASPIRE_ORDER = ['Pending Outreach','Form Sent','Interviewed','Accepted','Active Rotation','Completed','Declined']
const NGRP_ORDER   = ['Pending','Applied','Interviewed','Offered','Hired','Declined']

function sortStudents(students, sortBy) {
  return [...students].sort((a, b) => {
    const la = (a.last_name  || a.name || '').toLowerCase()
    const lb = (b.last_name  || b.name || '').toLowerCase()
    const fa = (a.first_name || a.name || '').toLowerCase()
    const fb = (b.first_name || b.name || '').toLowerCase()
    switch (sortBy) {
      case 'last_name_desc':  return lb.localeCompare(la)
      case 'first_name_asc':  return fa.localeCompare(fb)
      case 'first_name_desc': return fb.localeCompare(fa)
      case 'school_asc':      return (a.school || '').localeCompare(b.school || '')
      case 'status':          return ASPIRE_ORDER.indexOf(a.status) - ASPIRE_ORDER.indexOf(b.status)
      case 'ngrp':            return NGRP_ORDER.indexOf(a.ngrp_outcome) - NGRP_ORDER.indexOf(b.ngrp_outcome)
      default:                return la.localeCompare(lb)  // last_name_asc
    }
  })
}

export default function StudentList({
  students, allStudents, units = [], cohortId,
  search, filters, onSearch, onFilter, onUpdate, onDelete, onRefresh,
}) {
  const [showImport, setShowImport] = useState(false)
  const [sortBy,     setSortBy]     = useState('last_name_asc')

  const schools = [...new Set(allStudents.map(s => s.school).filter(Boolean))].sort()
  const cohorts = [...new Set(allStudents.map(s => s.aspire_cohort).filter(Boolean))].sort()

  const clearFilters = () => {
    onSearch(''); onFilter('school',''); onFilter('status',''); onFilter('cohort','')
  }
  const hasFilters = search || filters.school || filters.status || filters.cohort

  const sorted = sortStudents(students, sortBy)

  return (
    <div className="student-list">
      <div className="list-controls">
        <div className="search-wrap">
          <input type="text" className="search-input"
            placeholder="Search by name or email…" value={search}
            onChange={e => onSearch(e.target.value)} />
        </div>
        <div className="filters-wrap">
          <select className="filter-select" value={filters.school} onChange={e => onFilter('school', e.target.value)}>
            <option value="">All Schools</option>
            {schools.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filter-select" value={filters.status} onChange={e => onFilter('status', e.target.value)}>
            <option value="">All Statuses</option>
            {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filter-select" value={filters.cohort} onChange={e => onFilter('cohort', e.target.value)}>
            <option value="">All Cohorts</option>
            {cohorts.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {hasFilters && <button className="btn-clear" onClick={clearFilters}>Clear</button>}

          <div className="sort-group">
            <span className="sort-label-text">Sort by</span>
            <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="last_name_asc">Last Name A–Z</option>
              <option value="last_name_desc">Last Name Z–A</option>
              <option value="first_name_asc">First Name A–Z</option>
              <option value="first_name_desc">First Name Z–A</option>
              <option value="school_asc">School A–Z</option>
              <option value="status">ASPIRE Status</option>
              <option value="ngrp">NGRP Outcome</option>
            </select>
          </div>

          <button className="btn-import-students" onClick={() => setShowImport(true)}
            title="Import students from CSV">
            ↑ Import CSV
          </button>
        </div>
      </div>

      <div className="list-meta">
        {hasFilters
          ? `Showing ${students.length} of ${allStudents.length} students`
          : `${allStudents.length} students`}
      </div>

      <div className="student-table">
        <div className="table-header">
          <div className="col-chevron" />
          <div className="col-name">Student</div>
          <div className="col-school">School</div>
          <div className="col-cohort">Cohort</div>
          <div className="col-status">ASPIRE Status</div>
          <div className="col-ngrp">NGRP Outcome</div>
          <div className="col-hours">Hours</div>
        </div>
        {sorted.length === 0 ? (
          <div className="table-empty">No students match your search or filters.</div>
        ) : (
          sorted.map(s => (
            <StudentRow key={s.id} student={s} units={units}
              onUpdate={onUpdate} onDelete={onDelete} />
          ))
        )}
      </div>

      {showImport && (
        <ImportStudentsCSV cohortId={cohortId} onImported={onRefresh}
          onClose={() => setShowImport(false)} />
      )}
    </div>
  )
}
