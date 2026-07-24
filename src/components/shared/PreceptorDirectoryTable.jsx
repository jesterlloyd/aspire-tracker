import { useState } from 'react'
import { preceptorInitials, sortAssignmentsForDisplay } from '../../lib/preceptorDirectory'
import RowActionsMenu from './RowActionsMenu'

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

function PreceptorAvatar({ row, contactAvatarMap = {} }) {
  const [failedUrl, setFailedUrl] = useState(null)
  const emailKey = row.email ? String(row.email).toLowerCase().trim() : ''
  const avatarUrl = row.avatar_url || row.profile_image_url || (emailKey ? contactAvatarMap[emailKey] : null)
  const failed = avatarUrl && failedUrl === avatarUrl
  const showPhoto = avatarUrl && !failed
  return (
    <span className="preceptor-dir-avatar" role="img" aria-label={`${row.full_name || 'Preceptor'} profile`}>
      {showPhoto && <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />}
      <span>{preceptorInitials(row.full_name)}</span>
    </span>
  )
}

function AssignmentList({ assignments = [], emptyLabel = 'No current student' }) {
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
  onManagePreceptorAssignments,
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
  const [openRowId, setOpenRowId] = useState(null)
  const manage = onManagePreceptorAssignments || onManageAssignment
  const showActions = !!(manage || showAdminActions || onEditPreceptor || onDeletePreceptor)
  return (
    <table className="am-table preceptor-dir-table">
      <caption className="ptl-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <SortHeader sortKey="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Name</SortHeader>
          {showContact && <th scope="col" className="am-th">Contact</th>}
          <SortHeader sortKey="unit" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Unit</SortHeader>
          <SortHeader sortKey="shift" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Shift</SortHeader>
          <SortHeader sortKey="status" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Status</SortHeader>
          <SortHeader sortKey="current_student" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Current Student</SortHeader>
          {showAssignmentCount && <SortHeader sortKey="count" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Assignments</SortHeader>}
          {showAssociation && <SortHeader sortKey="association" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Association</SortHeader>}
          {showCohorts && <th scope="col" className="am-th">Cohorts</th>}
          {showLastActive && <th scope="col" className="am-th">Last Active</th>}
          {showActions && <th scope="col" className="am-th"><span className="sr-only">Actions</span></th>}
        </tr>
      </thead>
      <tbody>
        {(rows || []).map(row => {
          const actions = [
            manage ? {
              key: 'manage',
              label: 'Manage Preceptor Assignments',
              disabled: !row.assignments?.length,
              onSelect: triggerEl => manage(row, triggerEl),
            } : null,
            showAdminActions && onEditPreceptor ? {
              key: 'edit',
              label: 'Edit Preceptor',
              onSelect: () => onEditPreceptor(row),
            } : null,
            showAdminActions && onDeletePreceptor ? {
              key: 'delete',
              label: 'Delete Preceptor',
              danger: true,
              onSelect: () => onDeletePreceptor(row),
            } : null,
          ].filter(Boolean)
          return (
            <tr key={row.id} className="am-row">
              <td className="am-td" data-label="Name">
                <div className="preceptor-dir-name">
                  <PreceptorAvatar row={row} contactAvatarMap={contactAvatarMap} />
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
                <AssignmentList assignments={row.assignments} />
              </td>
              {showAssignmentCount && <td className="am-td" data-label="Assignments">{row.active_assignment_count ?? row.assignments?.length ?? '-'}</td>}
              {showAssociation && (
                <td className="am-td" data-label="Association">
                  {row.cross_unit_association ? <span className="preceptor-dir-association">Cross-unit</span> : <span className="preceptor-dir-empty">Home unit</span>}
                </td>
              )}
              {showCohorts && <td className="am-td" data-label="Cohorts">{row.cohorts_participated ?? '-'}</td>}
              {showLastActive && <td className="am-td" data-label="Last Active">{row.last_active_display || row.last_active_cohort || row.last_active_date || '-'}</td>}
              {showActions && (
                <td className="am-td" data-label="Actions">
                  <RowActionsMenu
                    label={`Open actions for ${row.full_name || 'preceptor'}`}
                    open={openRowId === row.id}
                    onToggle={() => setOpenRowId(current => current === row.id ? null : row.id)}
                    onClose={() => setOpenRowId(null)}
                    items={actions}
                  />
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
