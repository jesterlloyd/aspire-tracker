const MAX_SHIFT_HOURS = 14;
const MIN_SHIFT_HOURS = 1;

export const SHIFT_LOG_STATUSES = {
  AUTO_ACCEPTED:  'Auto-Accepted',
  PENDING_REVIEW: 'Pending Review',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
  EDITED:         'Edited',
};

export function validateShiftLog({ shiftLog, student, existingLogs, cohort }) {
  const flags = [];

  // 1. Required fields (real DB columns: shift_date, total_hours, unit_name)
  if (!shiftLog.shift_date || !shiftLog.total_hours || !shiftLog.unit_name) {
    flags.push('Missing required fields');
  }

  // 2. Student must be placed or active
  const validStatuses = ['Placed', 'Active', 'In Progress', 'Active Rotation'];
  if (student && !validStatuses.includes(student.status)) {
    flags.push(`Student status is "${student.status}", not Placed or Active`);
  }

  // 3. Reasonable shift duration (total_hours is the real column)
  const hours = parseFloat(shiftLog.total_hours) || 0;
  if (hours > MAX_SHIFT_HOURS) {
    flags.push(`Shift duration ${hours}h exceeds normal limit (${MAX_SHIFT_HOURS}h)`);
  }
  if (hours < MIN_SHIFT_HOURS) {
    flags.push(`Shift duration ${hours}h below normal minimum (${MIN_SHIFT_HOURS}h)`);
  }

  // 4. Doesn't exceed required hours
  const acceptedHours = (existingLogs || [])
    .filter(l => ['Auto-Accepted', 'Approved'].includes(l.status))
    .reduce((sum, l) => sum + (parseFloat(l.total_hours) || 0), 0);
  const requiredHours = student?.hours_required || 90;
  if (acceptedHours + hours > requiredHours) {
    const overage = (acceptedHours + hours) - requiredHours;
    flags.push(`Would exceed required hours by ${overage.toFixed(1)}h (required: ${requiredHours}h, completed: ${acceptedHours}h, this shift: ${hours}h)`);
  }

  // 5. Same-date duplicate detection (no start/end times — can only check same day)
  const sameDayLogs = (existingLogs || []).filter(
    l => l.shift_date === shiftLog.shift_date && l.status !== 'Rejected'
  );
  if (sameDayLogs.length > 0) {
    flags.push(`Another shift already logged on ${shiftLog.shift_date}`);
  }

  // 6. Within cohort window
  if (shiftLog.shift_date && cohort?.start_date && cohort?.end_date) {
    if (shiftLog.shift_date < cohort.start_date || shiftLog.shift_date > cohort.end_date) {
      flags.push(`Shift date ${shiftLog.shift_date} is outside cohort window (${cohort.start_date} to ${cohort.end_date})`);
    }
  }

  // 7. Unit override (is_assigned_unit is stored in the DB; false means different unit)
  if (shiftLog.is_assigned_unit === false) {
    flags.push('Student logged a unit different from their assigned unit');
  }

  // 8. Preceptor override
  if (shiftLog.is_assigned_preceptor === false) {
    flags.push('Student logged a preceptor different from their assigned preceptor');
  }

  if (flags.length === 0) {
    return {
      status:         SHIFT_LOG_STATUSES.AUTO_ACCEPTED,
      reviewReason:   null,
      exceptionFlags: [],
    };
  }
  return {
    status:         SHIFT_LOG_STATUSES.PENDING_REVIEW,
    reviewReason:   flags.join('; '),
    exceptionFlags: flags,
  };
}
