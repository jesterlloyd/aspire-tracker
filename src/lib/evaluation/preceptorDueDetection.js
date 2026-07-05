// Pure, READ-ONLY due-detection logic for automated preceptor surveys (PS-3a).
//
// This module performs NO I/O. It takes already-loaded rows (students, preceptors,
// preceptor_progress assignments) and classifies each student/period. It never writes,
// sends, mints tokens, schedules, or proposes an action button - PS-3a is evidence only.
//
// Hours sources are READ verbatim from students.approved_hours and students.hours_required
// (the canonical accepted-hours columns maintained by the shift-log check-out / submit-past
// -shift path). This module does NOT sum shift logs or re-derive hours.
//
// Thresholds:
//   midpoint due  when approved_hours >= 0.5 * hours_required
//   end     due   when approved_hours >= hours_required
//   hours_required <= 0  → ineligible_hours (never proposed)
//
// Classifications: not_due | due_sendable | due_unsendable | ineligible_hours | suppressed_existing

// The two auto-detected periods. Other / interim remains manual-only (PS-2b).
export const AUTO_PERIODS = Object.freeze(['midpoint', 'end_of_rotation']);

export const PERIOD_LABELS = Object.freeze({
  midpoint: 'Midpoint',
  end_of_rotation: 'End of Rotation',
  other_interim: 'Other / Interim Check-In',
});

// Maps the stored assignment.timepoint back to the true period (mirrors PS-2b mapping).
const TIMEPOINT_TO_PERIOD = Object.freeze({
  midpoint: 'midpoint',
  post_rotation: 'end_of_rotation',
  custom: 'other_interim',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isSafeEmail(v) {
  return typeof v === 'string' && EMAIL_PATTERN.test(v.trim());
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Resolve the true period for an assignment: prefer the notes marker, fall back to timepoint.
function assignmentPeriod(a) {
  const notes = typeof a?.notes === 'string' ? a.notes : '';
  const m = notes.match(/^preceptor_progress:([a-z_]+)/);
  if (m && (m[1] === 'midpoint' || m[1] === 'end_of_rotation' || m[1] === 'other_interim')) {
    return m[1];
  }
  return TIMEPOINT_TO_PERIOD[a?.timepoint] || null;
}

// Conservative state of an existing assignment for suppression reporting.
//   completed > active > expired > revoked  (precedence for the representative row)
function assignmentState(a, nowMs) {
  if (a?.revoked_at || a?.status === 'revoked') return 'revoked';
  if (a?.completed_at || a?.status === 'completed') return 'completed';
  const live = a?.status === 'sent' || a?.status === 'opened' || a?.status === 'reminder_due';
  const expired = a?.status === 'expired' ||
    (live && a?.expires_at && new Date(a.expires_at).getTime() < nowMs);
  if (expired) return 'expired';
  if (live) return 'active';
  return a?.status || 'unknown';
}

const STATE_PRECEDENCE = { completed: 4, active: 3, expired: 2, revoked: 1, unknown: 0 };

const STATE_REASON = {
  completed: 'Feedback already completed for this period',
  active:    'An active request is already in flight for this period',
  expired:   'An expired request exists, Owner resend decision required',
  revoked:   'A revoked request exists, does not auto re-arm; manual resend decision required',
  unknown:   'An existing request blocks auto-proposal for this period',
};

// Read-only preceptor resolution mirroring resolvePreceptor(): normalized first, free-text
// fallback. Returns { name, email, active, source, reason } where reason explains why a
// resolved preceptor is unsendable (or '' when sendable).
function resolveRecipient(student, preceptorsById) {
  let name = '', email = '', active = true, source = 'free_text';
  if (student?.preceptor_id && preceptorsById.has(student.preceptor_id)) {
    const p = preceptorsById.get(student.preceptor_id);
    name = (p.full_name || '').trim();
    email = (p.email || '').trim();
    active = p.is_active !== false;
    source = 'normalized';
  }
  if (!email) {
    // Free-text fallback (no is_active flag for free-text preceptors).
    name = name || (student?.matched_preceptor || '').trim();
    email = (student?.preceptor_email || '').trim();
    if (!name && !email) source = 'none';
  }

  let reason = '';
  if (!name && !email) reason = 'No preceptor on file';
  else if (!active) reason = 'Preceptor is inactive';
  else if (!isSafeEmail(email)) reason = 'Preceptor email is missing or invalid';

  return { name, email, active, source, sendable: reason === '', reason };
}

// Classify a single cohort.
//
// Inputs (all already loaded; this function does no I/O):
//   students    - [{ id, first_name, last_name, approved_hours, hours_required,
//                    preceptor_id, preceptor_email, matched_preceptor }]
//   preceptors  - [{ id, full_name, email, unit_name, is_active }]
//   assignments - preceptor_progress assignments for the cohort:
//                 [{ id, student_id, timepoint, status, revoked_at, completed_at,
//                    expires_at, notes, sent_at, created_at }]
//   nowMs       - current epoch ms (injected for testability)
//
// Returns { rows, summary } where each row is one (student, period) evaluation
// (ineligible_hours emits a single period-less row per student).
export function classifyCohort({ students = [], preceptors = [], assignments = [], nowMs = 0 }) {
  const preceptorsById = new Map(preceptors.map(p => [p.id, p]));

  // Group preceptor assignments by student → period → representative assignment.
  const byStudentPeriod = new Map(); // studentId -> Map(period -> assignment)
  for (const a of assignments) {
    const period = assignmentPeriod(a);
    if (!period) continue;
    if (!byStudentPeriod.has(a.student_id)) byStudentPeriod.set(a.student_id, new Map());
    const periodMap = byStudentPeriod.get(a.student_id);
    const existing = periodMap.get(period);
    if (!existing) { periodMap.set(period, a); continue; }
    // Keep the representative by state precedence, tie-break most recent.
    const sa = assignmentState(a, nowMs), se = assignmentState(existing, nowMs);
    const pa = STATE_PRECEDENCE[sa] ?? 0, pe = STATE_PRECEDENCE[se] ?? 0;
    if (pa > pe) periodMap.set(period, a);
    else if (pa === pe) {
      const ta = new Date(a.sent_at || a.created_at || 0).getTime();
      const te = new Date(existing.sent_at || existing.created_at || 0).getTime();
      if (ta > te) periodMap.set(period, a);
    }
  }

  const rows = [];
  const summary = { due_sendable: 0, due_unsendable: 0, suppressed_existing: 0, ineligible_hours: 0, not_due: 0 };

  for (const s of students) {
    const approved = num(s.approved_hours);
    const required = num(s.hours_required);
    const studentName = `${s.first_name || ''} ${s.last_name || ''}`.trim() || '(unnamed student)';
    const periodMap = byStudentPeriod.get(s.id) || new Map();

    // ineligible_hours: one row per student, never proposed.
    if (required <= 0) {
      rows.push({
        studentId: s.id, studentName, approvedHours: approved, hoursRequired: required,
        midpointThreshold: null, endThreshold: null,
        period: null, classification: 'ineligible_hours',
        reason: 'hours_required is 0 or less, cannot evaluate thresholds',
        preceptorName: '', preceptorEmail: '', suppressing: null,
      });
      summary.ineligible_hours += 1;
      continue;
    }

    const midpointThreshold = 0.5 * required;
    const endThreshold = required;
    const recipient = resolveRecipient(s, preceptorsById);
    const hasEnd = periodMap.has('end_of_rotation'); // any state

    for (const period of AUTO_PERIODS) {
      const existing = periodMap.get(period) || null;
      const due = period === 'midpoint' ? approved >= midpointThreshold : approved >= endThreshold;

      let classification, reason, suppressing = null;

      if (existing) {
        // Any existing assignment for this period blocks auto-proposal (rules 1–7).
        const state = assignmentState(existing, nowMs);
        classification = 'suppressed_existing';
        reason = STATE_REASON[state] || STATE_REASON.unknown;
        suppressing = {
          assignmentId: existing.id, status: existing.status, state,
          timepoint: existing.timepoint, notes: existing.notes || null,
        };
      } else if (period === 'midpoint' && hasEnd) {
        // Rule 3: an end-of-rotation assignment suppresses a midpoint proposal.
        const endA = periodMap.get('end_of_rotation');
        classification = 'suppressed_existing';
        reason = 'End-of-rotation assignment exists, midpoint not proposed';
        suppressing = {
          assignmentId: endA.id, status: endA.status, state: assignmentState(endA, nowMs),
          timepoint: endA.timepoint, notes: endA.notes || null,
        };
      } else if (period === 'midpoint' && approved >= endThreshold) {
        // End threshold reached: end-of-rotation supersedes midpoint even when no end
        // assignment exists yet, so a single student is never proposed for both periods
        // at once. Conservative non-sendable classification (no assignment to reference).
        classification = 'suppressed_existing';
        reason = 'End threshold reached, midpoint no longer proposed';
      } else if (!due) {
        const thr = period === 'midpoint' ? midpointThreshold : endThreshold;
        classification = 'not_due';
        reason = `approved_hours ${approved} < ${period === 'midpoint' ? '50%' : '100%'} threshold ${thr}`;
      } else if (recipient.sendable) {
        classification = 'due_sendable';
        reason = 'Threshold met; preceptor resolved with a valid email';
      } else {
        classification = 'due_unsendable';
        reason = recipient.reason;
      }

      rows.push({
        studentId: s.id, studentName, approvedHours: approved, hoursRequired: required,
        midpointThreshold, endThreshold, period, classification, reason,
        preceptorName: recipient.name, preceptorEmail: recipient.email,
        suppressing,
      });
      summary[classification] += 1;
    }
  }

  return { rows, summary };
}
