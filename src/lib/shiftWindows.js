export const SHIFT_WINDOWS = {
  Day:      { startHour: 7,  startMinute: 0,  endHour: 19, endMinute: 30, crossesMidnight: false },
  Night:    { startHour: 19, startMinute: 0,  endHour: 7,  endMinute: 30, crossesMidnight: true  },
  Mid:      { startHour: 11, startMinute: 0,  endHour: 23, endMinute: 30, crossesMidnight: false },
  Variable: { startHour: 0,  startMinute: 0,  endHour: 0,  endMinute: 0,  crossesMidnight: true  },
}

/**
 * Compute the on-campus window for a logged shift.
 * Uses local time throughout - ASPIRE operates in a single timezone (Pacific).
 * @param {string} shiftDate - YYYY-MM-DD from student_shift_logs.shift_date
 * @param {string} shiftType - 'Day' | 'Night' | 'Mid' | 'Variable'
 * @returns {{ start: Date, end: Date } | null}
 */
export function getShiftWindow(shiftDate, shiftType) {
  const win = SHIFT_WINDOWS[shiftType]
  if (!win || !shiftDate) return null

  const [year, month, day] = shiftDate.split('-').map(Number)

  const start = new Date(year, month - 1, day, win.startHour, win.startMinute, 0, 0)

  const end = win.crossesMidnight
    ? new Date(year, month - 1, day + 1, win.endHour, win.endMinute, 0, 0)
    : new Date(year, month - 1, day,     win.endHour, win.endMinute, 0, 0)

  return { start, end }
}

/**
 * Check if a logged shift is currently active (student is on campus right now).
 * Returns false for unrecognized shift types, treating them as absent.
 * @param {string} shiftDate
 * @param {string} shiftType
 * @param {Date} [now] - defaults to current time
 * @returns {boolean}
 */
export function isShiftCurrentlyActive(shiftDate, shiftType, now = new Date()) {
  const win = getShiftWindow(shiftDate, shiftType)
  if (!win) return false
  return now >= win.start && now <= win.end
}
