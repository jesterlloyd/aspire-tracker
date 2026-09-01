export const ACTIVE_LOG_LIFECYCLES = new Set(['completed', 'in_progress'])

export function isVisibleShiftLog(log) {
  const lifecycle = log?.lifecycle_state || 'completed'
  return ACTIVE_LOG_LIFECYCLES.has(lifecycle)
}

// One actual shift wins over one plan on the same date. Plans remain stored so
// a correction that moves the actual log to another date can reveal the plan
// again instead of silently losing the student's intent.
export function reconcileStudentRotationActivity(logs = [], plans = []) {
  const visibleLogs = logs.filter(isVisibleShiftLog)
  const loggedDates = new Set(visibleLogs.map(log => log.shift_date).filter(Boolean))
  return [
    ...visibleLogs.map(log => ({ ...log, kind: 'logged' })),
    ...plans
      .filter(plan => plan?.shift_date && !loggedDates.has(plan.shift_date))
      .map(plan => ({ ...plan, kind: 'planned' })),
  ].sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
}

export function groupStudentActivityByDate(activity = []) {
  const grouped = new Map()
  for (const item of activity) {
    if (!item?.shift_date) continue
    const list = grouped.get(item.shift_date) || []
    list.push(item)
    grouped.set(item.shift_date, list)
  }
  return grouped
}
