// Reasonable shift duration thresholds
const MAX_SHIFT_HOURS = 14;
const MIN_SHIFT_HOURS = 1;

export const SHIFT_LOG_STATUSES = {
  AUTO_ACCEPTED:  'Auto-Accepted',
  PENDING_REVIEW: 'Pending Review',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
  EDITED:         'Edited',
};

/**
 * Returns { status, reviewReason }
 * - If all checks pass: { status: 'Auto-Accepted', reviewReason: null }
 * - If any check fails: { status: 'Pending Review', reviewReason: '...' }
 */
export function validateShiftLog({ shiftLog, student, existingLogs, cohort }) {
  const reasons = [];

  // 1. Required fields
  if (!shiftLog.shift_date || !shiftLog.start_time || !shiftLog.end_time || !shiftLog.hours) {
    reasons.push('Missing required fields');
  }

  // 2. Student must be placed or active
  const validStatuses = ['Placed', 'Active', 'In Progress', 'Active Rotation'];
  if (student?.status && !validStatuses.includes(student.status)) {
    reasons.push(`Student status is "${student.status}", not Placed or Active`);
  }

  // 3. Shift within reasonable duration
  const h = parseFloat(shiftLog.hours) || parseFloat(shiftLog.total_hours) || 0;
  if (h > MAX_SHIFT_HOURS) {
    reasons.push(`Shift duration ${h}h exceeds normal limit (${MAX_SHIFT_HOURS}h)`);
  }
  if (h > 0 && h < MIN_SHIFT_HOURS) {
    reasons.push(`Shift duration ${h}h below normal minimum (${MIN_SHIFT_HOURS}h)`);
  }

  // 4. Doesn't exceed required hours
  const acceptedHours = (existingLogs || [])
    .filter(l => ['Auto-Accepted', 'Approved'].includes(l.status))
    .reduce((sum, l) => sum + parseFloat(l.hours || l.total_hours || 0), 0);
  const requiredHours = parseFloat(student?.hours_required) || 90;
  if (h > 0 && acceptedHours + h > requiredHours) {
    const overage = (acceptedHours + h - requiredHours).toFixed(1);
    reasons.push(`Would exceed required hours by ${overage}h (required: ${requiredHours}h, completed: ${acceptedHours}h, this shift: ${h}h)`);
  }

  // 5. No duplicate or overlapping shift on same date
  const sameDayLogs = (existingLogs || []).filter(
    l => l.shift_date === shiftLog.shift_date && l.status !== 'Rejected'
  );
  for (const log of sameDayLogs) {
    const newStart = timeToMinutes(shiftLog.start_time);
    const newEnd   = timeToMinutes(shiftLog.end_time);
    const exStart  = timeToMinutes(log.start_time);
    const exEnd    = timeToMinutes(log.end_time);
    if (newStart < exEnd && newEnd > exStart) {
      reasons.push(`Overlaps with existing shift on ${shiftLog.shift_date} (${log.start_time}–${log.end_time})`);
      break;
    }
  }

  // 6. Shift within approved rotation dates
  if (cohort?.start_date && cohort?.end_date) {
    const shiftDate   = new Date(shiftLog.shift_date);
    const cohortStart = new Date(cohort.start_date);
    const cohortEnd   = new Date(cohort.end_date);
    if (shiftDate < cohortStart || shiftDate > cohortEnd) {
      reasons.push(`Shift date ${shiftLog.shift_date} is outside cohort rotation window (${cohort.start_date} to ${cohort.end_date})`);
    }
  }

  // 7. Logged unit differs from assigned unit (only flag if both are known)
  if (student?.matched_unit_id && shiftLog.unit && student?.matched_unit_name &&
      shiftLog.unit !== student.matched_unit_name) {
    reasons.push(`Logged unit "${shiftLog.unit}" differs from assigned unit "${student.matched_unit_name}"`);
  }

  if (reasons.length === 0) {
    return { status: SHIFT_LOG_STATUSES.AUTO_ACCEPTED, reviewReason: null };
  }
  return { status: SHIFT_LOG_STATUSES.PENDING_REVIEW, reviewReason: reasons.join('; ') };
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}
