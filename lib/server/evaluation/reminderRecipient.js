// lib/server/evaluation/reminderRecipient.js
//
// EVALUATION-REMINDERS-1: the ONE place this automation decides who a reminder
// goes to.
//
// WHY THIS MODULE EXISTS. Student email routing in this codebase is genuinely
// fragmented: some paths prefer school_email, the evaluation paths prefer
// personal_email, the bulk composer honours an operator dropdown, and the
// scheduling flow requires a school address outright. This automation does not
// add a tenth scattered rule inline in a cron - every routing decision it makes
// lives here, is named, and is tested. (Reconciling the OTHER nine call sites is
// a separate, riskier change and is deliberately not attempted here.)
//
// THE RULES, and they fail closed. There is no "try the other address" branch
// anywhere below: a reminder either goes to the address the lifecycle says is
// correct, or it is not sent and the reason is recorded.
//
//   • Preceptor respondent -> the assignment's OWN snapshot (respondent_email /
//     respondent_name). It is never re-resolved from students.preceptor_id or
//     the preceptors table, because the preceptor of record can change after the
//     survey was sent and a reminder must reach the person who was actually
//     asked. This is what prevents preceptor identity drift.
//   • Student, ngrp_outcome = 'Hired' -> ONLY a verified, active, linked portal
//     profile address on @cshs.org. A hired student has left their school
//     account behind; sending their survey link to a school inbox they no longer
//     read, or to a personal one, is not acceptable. If no such address exists we
//     skip and say so - we never silently fall back.
//   • Student currently on rotation ('Active Rotation') -> the school email.
//   • Student otherwise (after rotation) -> the personal email.
//
// A unit leader is NOT a possible respondent. evaluation_assignments constrains
// respondent_type to ('student','preceptor') at the database level, so there is
// no such assignment to find and this module invents no unit-leader audience.

import { isValidEmail } from '../../../src/lib/notifications/studentRecipient.js';
import { normalizeEmailForLookup } from '../../../src/lib/emailUtils.js';

/** The status that means "currently on rotation". The existing house definition. */
export const ACTIVE_ROTATION_STATUS = 'Active Rotation';

/** The outcome that switches a student onto their Cedars-Sinai address. */
export const HIRED_OUTCOME = 'Hired';

/** Required domain for a hired student's reminder. */
export const CEDARS_EMAIL_DOMAIN = '@cshs.org';

/** Sanitized snake_case reasons; these reach the ledger and the run report. */
export const RECIPIENT_REASONS = Object.freeze({
  MISSING_VERIFIED_CEDARS_EMAIL: 'missing_verified_cedars_email',
  MISSING_SCHOOL_EMAIL: 'missing_school_email',
  MISSING_PERSONAL_EMAIL: 'missing_personal_email',
  MISSING_PRECEPTOR_SNAPSHOT_EMAIL: 'missing_preceptor_snapshot_email',
  UNSUPPORTED_RESPONDENT_TYPE: 'unsupported_respondent_type',
  STUDENT_NOT_FOUND: 'student_not_found',
});

const ok = (email, name, route) => ({ ok: true, email: String(email).trim(), name: name || null, route });
const no = (reason) => ({ ok: false, email: null, name: null, route: null, reason });

/** Does this address sit on the Cedars-Sinai domain? Case/whitespace tolerant. */
export function isCedarsEmail(value) {
  return normalizeEmailForLookup(value).endsWith(CEDARS_EMAIL_DOMAIN);
}

/**
 * Is a portal account verified? Verification is NOT a user_profiles column - it
 * lives in Supabase auth. This mirrors api/list-portal-access.js exactly: an
 * account counts as verified once it has confirmed its email or signed in.
 */
export function isVerifiedAuthUser(authUser) {
  return !!(authUser?.email_confirmed_at || authUser?.confirmed_at || authUser?.last_sign_in_at);
}

/**
 * Resolve the Cedars-Sinai address for a hired student, or fail closed.
 * Every step is required; there is no fallback path out of this function.
 */
export async function resolveHiredCedarsRecipient({ db, authAdmin, studentId, studentName }) {
  // 1. Exactly one ACTIVE link. Ambiguity is treated as failure, not as a guess.
  const { data: links, error: linkErr } = await db
    .from('user_student_links')
    .select('user_profile_id')
    .eq('student_id', studentId)
    .is('revoked_at', null)
    .limit(2);
  if (linkErr || !Array.isArray(links) || links.length !== 1) {
    return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);
  }

  // 2. An ACTIVE profile.
  const { data: profile, error: profErr } = await db
    .from('user_profiles')
    .select('id, auth_user_id, email, is_active')
    .eq('id', links[0].user_profile_id)
    .single();
  if (profErr || !profile || profile.is_active === false) {
    return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);
  }

  // 3. A valid Cedars-Sinai address.
  const email = String(profile.email || '').trim();
  if (!isValidEmail(email) || !isCedarsEmail(email)) {
    return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);
  }

  // 4. VERIFIED, per Supabase auth. An invited-but-never-accepted account is not
  //    a deliverable destination for a secure survey link.
  if (!profile.auth_user_id || !authAdmin?.getUserById) {
    return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);
  }
  let authUser;
  try {
    const { data, error } = await authAdmin.getUserById(profile.auth_user_id);
    if (error) return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);
    authUser = data?.user || null;
  } catch {
    return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);
  }
  if (!isVerifiedAuthUser(authUser)) return no(RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL);

  return ok(email, studentName, 'cedars');
}

/**
 * Resolve the reminder recipient for one assignment.
 *
 * @param {object} o
 * @param {object} o.db          service-role Supabase client
 * @param {object} o.authAdmin   supabase.auth.admin (only consulted for hired students)
 * @param {object} o.assignment  evaluation_assignments row (respondent_* included)
 * @param {object} o.student     students row, or null for preceptor respondents
 * @returns {Promise<{ok:true,email,name,route}|{ok:false,reason}>}
 */
export async function resolveReminderRecipient({ db, authAdmin, assignment, student }) {
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
  const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || null;

  if (String(student.ngrp_outcome || '') === HIRED_OUTCOME) {
    return await resolveHiredCedarsRecipient({
      db, authAdmin, studentId: student.id, studentName,
    });
  }

  if (String(student.status || '') === ACTIVE_ROTATION_STATUS) {
    const school = String(student.school_email || '').trim();
    if (!isValidEmail(school)) return no(RECIPIENT_REASONS.MISSING_SCHOOL_EMAIL);
    return ok(school, studentName, 'school');
  }

  const personal = String(student.personal_email || '').trim();
  if (!isValidEmail(personal)) return no(RECIPIENT_REASONS.MISSING_PERSONAL_EMAIL);
  return ok(personal, studentName, 'personal');
}
