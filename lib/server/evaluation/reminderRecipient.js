// STUDENT-EMAIL-LIFECYCLE-1: student reminders share automatic correspondence routing.
// Preceptor reminders keep their original assignment snapshot to prevent identity drift.
import { resolveStudentEmail } from '../../../src/lib/notifications/studentEmailLifecycle.js';
import { isValidEmail } from '../../../src/lib/notifications/studentRecipient.js';
import { getStudentPreferredFullName } from '../../../src/lib/studentNameFormatters.js';

export const RECIPIENT_REASONS = Object.freeze({
  MISSING_RESIDENCY_EMAIL: 'missing_cedars_or_personal_email',
  MISSING_SCHOOL_EMAIL: 'missing_school_email',
  MISSING_PERSONAL_EMAIL: 'missing_personal_email',
  MISSING_PRECEPTOR_SNAPSHOT_EMAIL: 'missing_preceptor_snapshot_email',
  UNSUPPORTED_RESPONDENT_TYPE: 'unsupported_respondent_type',
  STUDENT_NOT_FOUND: 'student_not_found',
});
const ok = (email, name, route) => ({ ok: true, email: String(email).trim(), name: name || null, route });
const no = (reason) => ({ ok: false, email: null, name: null, route: null, reason });

export async function resolveReminderRecipient({ assignment, student, now }) {
  const respondentType = assignment?.respondent_type;

  // ── Preceptor: the snapshot, and only the snapshot. ──
  if (respondentType === 'preceptor') {
    const email = String(assignment.respondent_email || '').trim();
    if (!isValidEmail(email)) return no(RECIPIENT_REASONS.MISSING_PRECEPTOR_SNAPSHOT_EMAIL);
    return ok(email, assignment.respondent_name || null, 'preceptor_snapshot');
  }

  if (respondentType !== 'student') return no(RECIPIENT_REASONS.UNSUPPORTED_RESPONDENT_TYPE);

  // ── Student: lifecycle decides the address. ──
  if (!student) return no(RECIPIENT_REASONS.STUDENT_NOT_FOUND);
  const studentName = getStudentPreferredFullName(student) || null;

  const route = resolveStudentEmail(student, undefined, { now });
  if (!route.email && route.preferredType === 'cedars') return no(RECIPIENT_REASONS.MISSING_RESIDENCY_EMAIL);
  if (!route.email) return no(route.preferredType === 'school'
    ? RECIPIENT_REASONS.MISSING_SCHOOL_EMAIL : RECIPIENT_REASONS.MISSING_PERSONAL_EMAIL);
  return { ...ok(route.email, studentName, route.type), warning: route.warning, fallbackUsed: route.fallbackUsed };
}
