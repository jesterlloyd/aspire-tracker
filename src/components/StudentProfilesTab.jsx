import Dashboard from './Dashboard'
import StudentList from './StudentList'
import AccessTab from './AccessTab'

export default function StudentProfilesTab({
  students, allStudents, units, cohortId,
  search, filters, onSearch, onFilter, onUpdate, onDelete, onRefresh, onSwitchToAccess,
  view, onViewChange,
  accessFocusId,
}) {
  return (
    <div className="student-profiles-tab">

      {/* Summary cards — always visible */}
      <Dashboard students={students} />

      {/* View toggle */}
      <div className="profiles-view-toggle">
        <button
          className={`profiles-toggle-btn${view === 'records' ? ' active' : ''}`}
          onClick={() => onViewChange('records')}>
          Student Records
        </button>
        <button
          className={`profiles-toggle-btn${view === 'access' ? ' active' : ''}`}
          onClick={() => onViewChange('access')}>
          Access Management
        </button>
      </div>

      {view === 'records' && (
        <StudentList
          students={students} allStudents={allStudents}
          units={units} cohortId={cohortId}
          search={search} filters={filters}
          onSearch={onSearch} onFilter={onFilter}
          onUpdate={onUpdate} onDelete={onDelete}
          onRefresh={onRefresh}
          onSwitchToAccess={onSwitchToAccess}
        />
      )}

      {view === 'access' && (
        <AccessTab
          students={students}
          onUpdate={onUpdate}
          focusStudentId={accessFocusId}
        />
      )}
    </div>
  )
}
