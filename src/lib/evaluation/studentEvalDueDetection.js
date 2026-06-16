// Pure, READ-ONLY due-detection for the Student Evaluation of Preceptor/Unit Experience
// survey (slug: student_preceptor_eval). SR-2b-1.
//
// Parallel to preceptorDueDetection.js (PS-3a), which is NOT modified. Key differences:
//   - Single post-rotation trigger: approved_hours >= hours_required (no midpoint).
//   - The recipient is the STUDENT's own email (personal_email first, school_email fallback).
//     due_unsendable therefore means a missing STUDENT email — never a missing preceptor.
//   - The preceptor/unit is the evaluated_target (context only); a missing target never
//     blocks classification.
//   - Suppression is scoped to student_preceptor_eval assignments only (the caller must pass
//     only those), so it never collides with preceptor_progress or Casey-Fink.
//
// This module performs NO I/O and NEVER sends, mints tokens, creates assignments, or writes.
// Classifications: not_due | due_sendable | due_unsendable | ineligible_hours | suppressed_existing

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isSafeEmail(v) {
  return typeof v === 'string' && EMAIL_PATTERN.test(v.trim());
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Conservative state of an existing assignment (for suppression reporting).
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
  completed: 'Survey already completed',
  active:    'A survey request is already in flight',
  expired:   'An expired survey request exists — Owner decision required',
  revoked:   'A revoked survey request exists — does not auto re-arm',
  unknown:   'An existing survey request blocks auto-proposal',
};

// Resolve the STUDENT recipient: personal_email first, school_email fallback.
function resolveStudentEmail(student) {
  const personal = (student?.personal_email || '').trim();
  const school   = (student?.school_email || '').trim();
  const email = personal || school;
  return {
    email,
    sendable: isSafeEmail(email),
    reason: isSafeEmail(email) ? '' : 'No valid student email on file (personal or school)',
  };
}

// Resolve the evaluated_target (preceptor/unit) for display context ONLY. Never blocks.
function resolveEvaluatedTarget(student, preceptorsById) {
  let preceptor = null;
  if (student?.preceptor_id && preceptorsById.has(student.preceptor_id)) {
    preceptor = preceptorsById.get(student.preceptor_id);
  }
  const preceptor_name = (preceptor?.full_name || student?.matched_preceptor || '').trim();
  const unit = (preceptor?.unit_name || '').trim();
  const preceptor_id = preceptor?.id || null;
  return {
    preceptor_name,
    preceptor_id,
    unit,
    available: Boolean(preceptor_name || unit),
  };
}

// Classify a single cohort for the student survey.
//
// Inputs (all already loaded; this function does no I/O):
//   students    — [{ id, first_name, last_name, school, program_type, approved_hours,
//                    hours_required, personal_email, school_email, preceptor_id, matched_preceptor }]
//   preceptors  — [{ id, full_name, unit_name }]
//   assignments — student_preceptor_eval assignments for the cohort ONLY:
//                 [{ id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at }]
//   nowMs       — current epoch ms (injected for testability)
//
// Returns { rows, summary }; one row per student.
export function classifyStudentEvalCohort({ students = [], preceptors = [], assignments = [], nowMs = 0 }) {
  const preceptorsById = new Map(preceptors.map(p => [p.id, p]));

  // Representative student_preceptor_eval assignment per student (state precedence, then recency).
  const bySTudent = new Map();
  for (const a of assignments) {
    const existing = bySTudent.get(a.student_id);
    if (!existing) { bySTudent.set(a.student_id, a); continue; }
    const pa = STATE_PRECEDENCE[assignmentState(a, nowMs)] ?? 0;
    const pe = STATE_PRECEDENCE[assignmentState(existing, nowMs)] ?? 0;
    if (pa > pe) bySTudent.set(a.student_id, a);
    else if (pa === pe) {
      const ta = new Date(a.sent_at || a.created_at || 0).getTime();
      const te = new Date(existing.sent_at || existing.created_at || 0).getTime();
      if (ta > te) bySTudent.set(a.student_id, a);
    }
  }

  const rows = [];
  const summary = { due_sendable: 0, due_unsendable: 0, suppressed_existing: 0, ineligible_hours: 0, not_due: 0 };

  for (const s of students) {
    const approved = num(s.approved_hours);
    const required = num(s.hours_required);
    const studentName = `${s.first_name || ''} ${s.last_name || ''}`.trim() || '(unnamed student)';
    const recipient = resolveStudentEmail(s);
    const evaluatedTarget = resolveEvaluatedTarget(s, preceptorsById);
    const existing = bySTudent.get(s.id) || null;

    let classification, reason, suppressing = null;

    if (required <= 0) {
      classification = 'ineligible_hours';
      reason = 'hours_required is 0 or less — cannot evaluate the post-rotation threshold';
    } else if (existing) {
      // Any existing student_preceptor_eval assignment (revoked/expired/active/completed)
      // suppresses re-proposal (instrument-scoped — no collision with preceptor/Casey).
      const state = assignmentState(existing, nowMs);
      classification = 'suppressed_existing';
      reason = STATE_REASON[state] || STATE_REASON.unknown;
      suppressing = { assignmentId: existing.id, status: existing.status, state };
    } else if (approved < required) {
      classification = 'not_due';
      reason = `approved_hours ${approved} < required ${required} (post-rotation threshold not reached)`;
    } else if (recipient.sendable) {
      classification = 'due_sendable';
      reason = 'Post-rotation threshold reached; student email resolved';
    } else {
      classification = 'due_unsendable';
      reason = recipient.reason; // missing STUDENT email (never about the preceptor)
    }

    rows.push({
      studentId: s.id,
      studentName,
      school: s.school || '',
      programType: s.program_type || '',
      approvedHours: approved,
      hoursRequired: required,
      classification,
      reason,
      studentEmail: recipient.email,
      evaluatedTarget,           // { preceptor_name, preceptor_id, unit, available }
      suppressing,
    });
    summary[classification] += 1;
  }

  return { rows, summary };
}
