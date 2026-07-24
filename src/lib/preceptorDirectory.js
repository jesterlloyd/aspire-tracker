const ROLE_ORDER = { Primary: 0, Secondary: 1, Coverage: 2, primary: 0, secondary: 1, coverage: 2 }

export function preceptorInitials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase()
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase() || '?'
}

export function preceptorSortValue(row, key) {
  if (key === 'unit' || key === 'unit_name') return String(row.home_unit?.name || row.unit_name || '').toLowerCase()
  if (key === 'shift') return String(row.shift || row.shift_type || '').toLowerCase()
  if (key === 'status') return row.is_active === false ? 1 : 0
  if (key === 'association') return row.cross_unit_association ? 0 : 1
  if (key === 'current_student') {
    const first = sortAssignmentsForDisplay(row.assignments || [])[0]
    return String(first?.student_name || '').toLowerCase()
  }
  if (key === 'count') return Number(row.active_assignment_count || row.assignments?.length || 0)
  return String(row.full_name || '').toLowerCase()
}

export function sortPreceptorDirectoryRows(rows, { sortBy = 'name', sortDir = 'asc' } = {}) {
  return [...(rows || [])].sort((a, b) => {
    const av = preceptorSortValue(a, sortBy)
    const bv = preceptorSortValue(b, sortBy)
    let cmp = typeof av === 'number' || typeof bv === 'number'
      ? Number(av) - Number(bv)
      : String(av).localeCompare(String(bv))
    if (cmp === 0) cmp = String(a.full_name || '').localeCompare(String(b.full_name || ''))
    if (cmp === 0) cmp = String(a.id || '').localeCompare(String(b.id || ''))
    return sortDir === 'desc' ? -cmp : cmp
  })
}

export function sortAssignmentsForDisplay(assignments = []) {
  return [...assignments].sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99) ||
    String(a.student_name || '').localeCompare(String(b.student_name || '')))
}
