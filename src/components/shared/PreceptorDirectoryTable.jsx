import { preceptorInitials, sortAssignmentsForDisplay } from '../../lib/preceptorDirectory'

const ROLE_CLASS = {
  Primary: 'primary',
  Secondary: 'secondary',
  Coverage: 'coverage',
  primary: 'primary',
  secondary: 'secondary',
  coverage: 'coverage',
}

function SortHeader({ sortKey, sortBy, sortDir, onSort, children }) {
  const active = sortBy === sortKey
  const next = active && sortDir === 'asc' ? 'descending' : 'ascending'
  return (
    <th scope="col" className="am-th am-sortable" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="preceptor-dir-sort" onClick={() => onSort?.(sortKey)}
        aria-label={`Sort by ${children} ${next}`}>
        <span>{children}</span>
        <span aria-hidden="true">{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  )
}

function StatusPill({ active }) {
  return (
    <span className={`preceptor-dir-status ${active ? 'preceptor-dir-status-active' : 'preceptor-dir-status-inactive'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function AssignmentList({ assignments = [], emptyLabel = '-', onManageAssignment }) {
  const rows = sortAssignmentsForDisplay(assignments)
  if (rows.length === 0) return <span className="preceptor-dir-empty">{emptyLabel}</span>
  return (
    <span className="preceptor-dir-assignments">
      {rows.map(assignment => {
        const role = assignment.role_label || assignment.role
        const roleClass = ROLE_CLASS[role] || ROLE_CLASS[String(role).toLowerCase()] || 'secondary'
        return (
          <span className="preceptor-dir-assignment" key={assignment.id || `${assignment.student_id}:${role}:${assignment.preceptor_id || ''}`}>
            <span className="preceptor-dir-student">{assignment.student_name}</span>
            <span className={`preceptor-dir-role preceptor-dir-role-${roleClass}`}>{role}</span>
            {assignment.student_unit && <span className="preceptor-dir-context">{assignment.student_unit}</span>}
            {onManageAssignment && (
              <button type="button" className="preceptor-dir-manage"
                aria-label={`Manage preceptor assignments for ${assignment.student_name}`}
                onClick={event => onManageAssignment(assignment, event.currentTarget)}>
                Manage preceptor assignments
              </button>
            )}
          </span>
        )
      })}
    </span>
  )
}

export default function PreceptorDirectoryTable({
  rows,
  sortBy,
  sortDir,
  onSort,
  onManageAssignment,
  onEditPreceptor,
  onDeletePreceptor,
  contactAvatarMap = {},
  showContact = true,
  showCohorts = false,
  showLastActive = false,
  showAssignmentCount = false,
  showAssociation = false,
  showAdminActions = false,
  caption = 'Preceptor Directory',
}) {
  return (
    <table className="am-table preceptor-dir-table">
      <caption className="ptl-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <SortHeader sortKey="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Name</SortHeader>
          {showContact && <th scope="col" className="am-th">Contact</th>}
          <SortHeader sortKey="unit" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Unit</SortHeader>
          <th scope="col" className="am-th">Shift</th>
          <th scope="col" className="am-th">Status</th>
          <SortHeader sortKey="current_student" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Current Student</SortHeader>
          {showAssignmentCount && <SortHeader sortKey="count" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Assignments</SortHeader>}
          {showAssociation && <th scope="col" className="am-th">Association</th>}
          {showCohorts && <th scope="col" className="am-th">Cohorts</th>}
          {showLastActive && <th scope="col" className="am-th">Last Active</th>}
          {showAdminActions && <th scope="col" className="am-th"><span className="sr-only">Actions</span></th>}
        </tr>
      </thead>
      <tbody>
        {(rows || []).map(row => {
          const avatarUrl = row.email ? contactAvatarMap[String(row.email).toLowerCase().trim()] || null : null
          return (
            <tr key={row.id} className="am-row">
              <td className="am-td" data-label="Name">
                <div className="preceptor-dir-name">
                  <span className="preceptor-dir-avatar" aria-hidden="true">
                    {avatarUrl && <img src={avatarUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
                    <span>{preceptorInitials(row.full_name)}</span>
                  </span>
                  <strong>{row.full_name}</strong>
                </div>
              </td>
              {showContact && (
                <td className="am-td preceptor-dir-contact" data-label="Contact">
                  {row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : '-'}
                  {row.phone && <span>{row.phone}</span>}
                </td>
              )}
              <td className="am-td" data-label="Unit">{row.home_unit?.name || row.unit_name || '-'}</td>
              <td className="am-td" data-label="Shift">{row.shift || row.shift_type || '-'}</td>
              <td className="am-td" data-label="Status"><StatusPill active={row.is_active !== false} /></td>
              <td className="am-td preceptor-dir-current" data-label="Current Student">
                <AssignmentList assignments={row.assignments} onManageAssignment={onManageAssignment} />
              </td>
              {showAssignmentCount && <td className="am-td" data-label="Assignments">{row.active_assignment_count ?? row.assignments?.length ?? '-'}</td>}
              {showAssociation && (
                <td className="am-td" data-label="Association">
                  {row.cross_unit_association ? <span className="preceptor-dir-association">Cross-unit</span> : <span className="preceptor-dir-empty">Home unit</span>}
                </td>
              )}
              {showCohorts && <td className="am-td" data-label="Cohorts">{row.cohorts_participated ?? '-'}</td>}
              {showLastActive && <td className="am-td" data-label="Last Active">{row.last_active_display || row.last_active_cohort || row.last_active_date || '-'}</td>}
              {showAdminActions && (
                <td className="am-td" data-label="Actions">
                  <div className="preceptor-dir-actions">
                    <button type="button" className="preceptor-dir-action" onClick={() => onEditPreceptor?.(row)}>Edit</button>
                    <button type="button" className="preceptor-dir-action preceptor-dir-action-danger" onClick={() => onDeletePreceptor?.(row)}>Delete</button>
                  </div>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
