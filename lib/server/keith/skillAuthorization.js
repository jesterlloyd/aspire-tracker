// KEITH-P1: the single authorization predicate for confidential skill data.
//
// Every confidential skill invocation must clear FOUR independent gates, in this
// order, each failing closed:
//
//   1. SKILL   - the skill exists, is Active, and is enabled.
//   2. ROLE    - the caller's role appears in the skill's allowed_roles.
//   3. STUDENT - the student resolves canonically, by id, within a cohort.
//   4. DATA    - the caller may read the requested data for THAT student,
//                re-derived here from the same rule the file endpoint applies.
//
// Gate 4 is the important one. It does not trust gate 2: being allowed to USE a
// skill is not being allowed to read a given student's protected file. A skill
// grant is a capability; the entitlement is per student per cohort.
//
// CO-LEAD ACCESS, DECIDED 2026-08-05.
// A Co-Lead is near-Owner for student-ACCESS operations: they read student
// resumes across ALL ASPIRE cohorts and may run this skill for any student, with
// no entitlement requirement. api/student-file-access.js was updated in the same
// pass, so the skill and the file endpoint now agree - a Co-Lead who can obtain
// resume-derived questions can also open the resume itself. There is no longer
// any asymmetry between the two surfaces.
//
// What a Co-Lead still cannot do is govern: SQL application, skill activation
// and lifecycle, the enabled kill switch, and system configuration remain
// Owner-only, and file upload/replace/delete plus badge generation remain
// Owner/Admin. Access is not administration.
//
// Interviewers remain cohort-entitlement gated. They are the one role whose
// student scope is genuinely partial.

import { normalizeStaffRole } from '../../../src/lib/permissions.js';
import { activeEntitledCohortIds } from '../interviewerEntitlements.js';

/** Roles that may never reach confidential student data through a skill. */
export const SKILL_DENIED_ROLES = Object.freeze(['viewer']);

/** Roles whose access is cohort-entitlement gated rather than unrestricted. */
export const ENTITLEMENT_GATED_ROLES = Object.freeze(['interviewer']);

/** Roles with unrestricted student scope (still subject to skill role lists). */
export const UNRESTRICTED_ROLES = Object.freeze(['owner', 'admin', 'co-lead']);

export const DENY = Object.freeze({
  SKILL_NOT_FOUND: 'skill_not_found',
  SKILL_NOT_ACTIVE: 'skill_not_active',
  SKILL_DISABLED: 'skill_disabled',
  ROLE_NOT_ALLOWED: 'role_not_allowed',
  DATA_GRANT_NOT_DECLARED: 'data_grant_not_declared',
  STUDENT_NOT_FOUND: 'student_not_found',
  STUDENT_AMBIGUOUS: 'student_ambiguous',
  NOT_ENTITLED: 'not_entitled',
  ENTITLEMENT_LOOKUP_FAILED: 'entitlement_lookup_failed',
});

/**
 * Normalize a caller into the shape every gate below reads. Owner is a flag on
 * the profile, not a role string, so it is folded in here once.
 */
export function normalizeCaller(auth) {
  const role = normalizeStaffRole(String(auth?.role || '').toLowerCase());
  return {
    profileId: auth?.profileId || auth?.userProfileId || null,
    role: auth?.isOwner === true ? 'owner' : role,
    rawRole: role,
    isOwner: auth?.isOwner === true,
  };
}

/** Gate 1 + 2. Returns { ok: true } or { ok: false, reason }. */
export function authorizeSkillForCaller(skill, caller) {
  if (!skill) return { ok: false, reason: DENY.SKILL_NOT_FOUND };
  if (skill.status !== 'active') return { ok: false, reason: DENY.SKILL_NOT_ACTIVE };
  if (skill.enabled !== true) return { ok: false, reason: DENY.SKILL_DISABLED };

  const c = normalizeCaller(caller);
  if (SKILL_DENIED_ROLES.includes(c.role)) return { ok: false, reason: DENY.ROLE_NOT_ALLOWED };

  const allowed = (skill.allowed_roles || []).map(r => normalizeStaffRole(String(r).toLowerCase()));
  // Owner is implied for every skill; every other role must be listed.
  if (!c.isOwner && !allowed.includes(c.role)) return { ok: false, reason: DENY.ROLE_NOT_ALLOWED };
  return { ok: true };
}

/** Gate 4a. A skill may only request data it declared in required_data. */
export function skillDeclaresData(skill, dataGrant) {
  return (skill?.required_data || []).includes(dataGrant);
}

/**
 * Gate 4b. May this caller read this student's resume?
 *
 * Mirrors api/student-file-access.js exactly: Owner/Admin/Co-Lead unrestricted;
 * viewer never; interviewer only within a cohort they hold an active entitlement
 * for. Any lookup failure fails CLOSED.
 *
 * `db` must be a service-role client. `student` must already be the canonically
 * resolved row (id + cohort_id), never a name.
 */
export async function authorizeStudentResumeAccess({ db, caller, student }) {
  const c = normalizeCaller(caller);
  if (SKILL_DENIED_ROLES.includes(c.role)) return { ok: false, reason: DENY.ROLE_NOT_ALLOWED };
  if (!student?.id || !student?.cohort_id) return { ok: false, reason: DENY.STUDENT_NOT_FOUND };

  if (c.isOwner || UNRESTRICTED_ROLES.includes(c.role)) return { ok: true, scope: 'unrestricted' };

  if (!ENTITLEMENT_GATED_ROLES.includes(c.role)) return { ok: false, reason: DENY.ROLE_NOT_ALLOWED };
  if (!c.profileId) return { ok: false, reason: DENY.NOT_ENTITLED };

  let entitled;
  try {
    entitled = await activeEntitledCohortIds(db, c.profileId);
  } catch {
    return { ok: false, reason: DENY.ENTITLEMENT_LOOKUP_FAILED };
  }
  if (!entitled.has(student.cohort_id)) return { ok: false, reason: DENY.NOT_ENTITLED };
  return { ok: true, scope: 'entitled_cohort' };
}

/**
 * Denial copy shown in chat. Never distinguishes "you may not" from "no such
 * student": both read the same, so a denied caller cannot probe for existence.
 */
export function denialMessage(reason) {
  switch (reason) {
    case DENY.STUDENT_AMBIGUOUS:
      return 'More than one student matches that name. Tell me the school or use the full name and I will try again.';
    case DENY.SKILL_NOT_ACTIVE:
    case DENY.SKILL_DISABLED:
    case DENY.SKILL_NOT_FOUND:
      return 'That skill is not available right now. An ASPIRE Owner can enable it in Settings > Keith > Skills.';
    default:
      return 'I cannot open that student\'s resume with your current access. If you are interviewing this student, ask an ASPIRE Owner to confirm your cohort entitlement.';
  }
}
