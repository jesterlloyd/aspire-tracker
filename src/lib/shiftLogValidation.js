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
 *
 * NOTE: The student_shift_logs table stores shift duration as total_hours.
 * There are no start_time/end_time columns. Overlap detection is therefore
 * based on daily total rather than time-range intersection.
 */
export function validateShiftLog({ shiftLog, student, existingLogs, cohort }) {
  const reasons = [];

  // Normalize: accept both 'hours' and 'total_hours' (the actual DB column)
  const h = parseFloat(shiftLog.total_hours ?? shiftLog.hours) || 0;

  // 1. Required fields (only fields that actually exist in the DB)
  if (!shiftLog.shift_date || h <= 0) {
    reasons.push('Missing required fields (shift date or hours)');
  }

  // 2. Student must be placed or active
  const validStatuses = ['Placed', 'Active', 'In Progress', 'Active Rotation'];
  if (student?.status && !validStatuses.includes(student.status)) {
    reasons.push(`Student status is "${student.status}", not Placed or Active`);
  }

  // 3. Shift within reasonable duration
  if (h > MAX_SHIFT_HOURS) {
    reasons.push(`Shift duration ${h}h exceeds normal limit (${MAX_SHIFT_HOURS}h)`);
  }
  if (h > 0 && h < MIN_SHIFT_HOURS) {
    reasons.push(`Shift duration ${h}h is below normal minimum (${MIN_SHIFT_HOURS}h)`);
  }

  // 4. Doesn't exceed required hours
  const acceptedHours = (existingLogs || [])
    .filter(l => ['Auto-Accepted', 'Approved'].includes(l.status))
    .reduce((sum, l) => sum + parseFloat(l.total_hours ?? l.hours ?? 0), 0);
  const requiredHours = parseFloat(student?.hours_required) || 90;
  if (h > 0 && acceptedHours + h > requiredHours) {
    const overage = (acceptedHours + h - requiredHours).toFixed(1);
    reasons.push(`Would exceed required hours by ${overage}h (required: ${requiredHours}h, completed: ${acceptedHours}h, this shift: ${h}h)`);
  }

  // 5. Daily total would exceed 24h (using total_hours — no start/end time columns exist)
  const dailyAccepted = (existingLogs || [])
    .filter(l => l.shift_date === shiftLog.shift_date &&
                 !['Rejected'].includes(l.status))
    .reduce((sum, l) => sum + parseFloat(l.total_hours ?? l.hours ?? 0), 0);
  if (dailyAccepted + h > 24) {
    reasons.push(`Daily total would exceed 24h (already logged: ${dailyAccepted}h + this shift: ${h}h)`);
  }

  // 6. Shift date is in the future
  const todayLocal = new Date().toLocaleDateString('en-CA');
  if (shiftLog.shift_date > todayLocal) {
    reasons.push(`Shift date ${shiftLog.shift_date} is in the future`);
  }

  // 7. Outside cohort rotation window
  if (cohort?.start_date && cohort?.end_date) {
    const shiftDate   = new Date(shiftLog.shift_date);
    const cohortStart = new Date(cohort.start_date);
    const cohortEnd   = new Date(cohort.end_date);
    if (shiftDate < cohortStart || shiftDate > cohortEnd) {
      reasons.push(`Shift date ${shiftLog.shift_date} is outside cohort rotation window (${cohort.start_date} to ${cohort.end_date})`);
    }
  }

  // 8. Logged unit differs from assigned unit (only flag if both are known)
  // Field is unit_name in the DB, not unit
  const loggedUnit   = shiftLog.unit_name ?? shiftLog.unit;
  const assignedUnit = student?.matched_unit_name;
  if (student?.matched_unit_id && loggedUnit && assignedUnit && loggedUnit !== assignedUnit) {
    reasons.push(`Logged unit "${loggedUnit}" differs from assigned unit "${assignedUnit}"`);
  }

  if (reasons.length === 0) {
    return { status: SHIFT_LOG_STATUSES.AUTO_ACCEPTED, reviewReason: null };
  }
  return { status: SHIFT_LOG_STATUSES.PENDING_REVIEW, reviewReason: reasons.join('; ') };
}
