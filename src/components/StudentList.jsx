import { useState } from 'react'
import { ASPIRE_STATUSES } from '../lib/constants'
import StudentRow from './StudentRow'
import ImportStudentsCSV from './ImportStudentsCSV'

export default function StudentList({
  students, allStudents, units = [], cohortId,
  search, filters, onSearch, onFilter, onUpdate, onRefresh,
}) {
  const [showImport, setShowImport] = useState(false)

  const schools = [...new Set(allStudents.map(s => s.school).filter(Boolean))].sort()
  const cohorts = [...new Set(allStudents.map(s => s.aspire_cohort).filter(Boolean))].sort()

  const clearFilters = () => {
    onSearch('')
    onFilter('school', '')
    onFilter('status', '')
    onFilter('cohort', '')
  }
  const hasFilters = search || filters.school || filters.status || filters.cohort

  return (
    <div className="student-list">
      <div className="list-controls">
        <div className="search-wrap">
          <input
            type="text"
            className="search-input"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
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
          <button
            className="btn-import-students"
            onClick={() => setShowImport(true)}
            title="Import students from CSV"
          >
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
        {students.length === 0 ? (
          <div className="table-empty">No students match your search or filters.</div>
        ) : (
          students.map(s => (
            <StudentRow key={s.id} student={s} units={units} onUpdate={onUpdate} />
          ))
        )}
      </div>

      {showImport && (
        <ImportStudentsCSV
          cohortId={cohortId}
          onImported={onRefresh}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
