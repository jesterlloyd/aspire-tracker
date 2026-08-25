// ROLE-MODEL-1: the canonical server-side access decision.
//
// Before this module the same question - "may this caller do this?" - was
// answered by six mutually incompatible predicates spread across ~60
// endpoints. Whether an Owner passed depended on which file they hit. This is
// now the one table, and every gate reads from it.
//
// THE OWNER RULE. Owner authority derives from the `is_owner` CAPABILITY on
// the profile, never from a role string. The string role 'owner' still exists
// in persisted data; it grants ADMIN-LEVEL operational access and nothing
// more, exactly as the client has always treated it (AuthContext derives
// isOwner from is_owner while isAdmin accepts 'owner'). A profile therefore
// cannot obtain governance authority by holding a role name.
//
// VIEWER IS RETIRED for new assignments (removed from the invite options and
// from the server's invitable list) but remains a valid PERSISTED role: an
// existing Viewer keeps working, at strictly read-only scope, and is never
// deleted or broken. Viewer has no Keith access.
//
// This table is the single source of truth for both enforcement and the
// Settings Role Guide, so the documentation cannot drift from the checks -
// they are the same object.

/** co_lead and co-lead are the same persisted role. */
export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'co_lead' ? 'co-lead' : r;
}

/** The canonical staff vocabulary, strongest first. */
export const STAFF_ROLES = Object.freeze(['owner', 'admin', 'co-lead', 'interviewer', 'viewer']);

/** Roles a new staff member may be invited or changed into. Viewer retired. */
export const ASSIGNABLE_ROLES = Object.freeze(['admin', 'co-lead', 'interviewer']);

/** Roles that still work if already persisted, but are no longer assignable. */
export const LEGACY_ROLES = Object.freeze(['viewer']);

/**
 * Normalize any auth/profile shape into the one caller shape decisions use.
 * `isOwner` is the capability; `role` is the normalized string role.
 */
export function callerFrom(source) {
  if (!source) return { role: '', isOwner: false };
  const isOwner = source.is_owner === true || source.isOwner === true;
  return { role: normalizeRole(source.role), isOwner };
}

// ── The capability table ─────────────────────────────────────────────────────
//
// Each capability lists the NON-OWNER roles that hold it. The Owner capability
// holds everything, so it never appears in a list; a capability with an empty
// list is Owner-only by construction.
//
// Co-Lead scope, resolved 2026-08-09: the UI has always offered Co-Lead
// placement/matching and full student detail (permissions.js ROLE_PERMS +
// canPerformMatching), while the server refused it. The server now honors
// exactly that promise - placement management and student-record management -
// and nothing wider. Deliberately still excluded, because the UI never
// promised them and each is a materially larger grant: student FILE mutation
// and badge generation (Owner/Admin, per the 2026-08-05 decision that reading
// a student's file is access while replacing or deleting it is not), cohort
// management, evaluations, contacts editing, staff management, and every
// governance action.
const CAPABILITIES = Object.freeze({
  // Governance - Owner only, by construction.
  governance:            [],
  enrichment_run:        [],
  // Community-benefit wage rates and manual capstone hours: Owner-only
  // writes (Jester is the only person who may enter or change them).
  // Admin may view the entries read-only in Settings.
  community_benefit_admin: [],
  community_benefit_view:  ['admin'],
  // Admin may inspect the enrichment plan read-only; running/applying is Owner.
  enrichment_preview:    ['admin'],

  // Administration
  staff_manage:          ['admin'],
  cohort_manage:         ['admin'],
  usage_view:            ['admin'],
  knowledge_author:      ['admin'],
  skills_author:         ['admin'],
  evaluations_manage:    ['admin'],
  contacts_manage:       ['admin'],
  templates_author:      ['admin'],

  // Students and placement - the resolved Co-Lead scope.
  student_read:          ['admin', 'co-lead'],
  // Reading students within actively entitled cohorts. Distinct from
  // unrestricted student_read because for an Interviewer it is the ONLY
  // student access there is, scoped by interviewer_cohort_entitlements in
  // api/student-file-access.js. Unrestricted readers satisfy it trivially.
  student_read_entitled: ['admin', 'co-lead', 'interviewer'],
  student_manage:        ['admin', 'co-lead'],
  placement_manage:      ['admin', 'co-lead'],
  // Mutating or generating student FILES stays Owner/Admin.
  student_files_manage:  ['admin'],

  // Interviews
  interview_conduct:     ['admin', 'interviewer'],
  interview_schedule:    ['admin'],

  // Keith
  keith_chat:            ['admin', 'co-lead', 'interviewer'],  // NOT viewer
  keith_tools:           ['admin', 'co-lead', 'interviewer'],
  keith_contacts:        ['admin', 'interviewer'],
  keith_skills:          ['admin', 'co-lead', 'interviewer'],  // per-skill roles still apply
});

export const CAPABILITY_KEYS = Object.freeze(Object.keys(CAPABILITIES));

/**
 * THE access decision. `caller` may be an auth object, a profile row, or an
 * already-normalized caller. Unknown capability → false (deny by default).
 */
export function can(caller, capability) {
  const c = callerFrom(caller);
  const allowed = CAPABILITIES[capability];
  if (!allowed) return false;                 // unknown capability → deny
  if (c.isOwner) return true;                 // the Owner capability holds everything
  if (!c.role || c.role === 'viewer') return false; // Viewer holds nothing here
  return allowed.includes(c.role);
}

/** Every capability this caller holds. Used by tests and the Role Guide. */
export function capabilitiesFor(caller) {
  return CAPABILITY_KEYS.filter(k => can(caller, k));
}

/** Owner capability, canonical. A role string never satisfies this. */
export function isOwnerCaller(caller) {
  return callerFrom(caller).isOwner === true;
}

/**
 * Admin-level: the Owner capability, or a role that operates at admin scope.
 * The persisted string 'owner' lands here - operational access, not
 * governance - which is exactly how the client has always read it.
 */
export function isAdminLevel(caller) {
  const c = callerFrom(caller);
  return c.isOwner || c.role === 'admin' || c.role === 'owner';
}

/** May this caller be assigned this role? (Viewer is retired.) */
export function isAssignableRole(role) {
  return ASSIGNABLE_ROLES.includes(normalizeRole(role));
}

// ── Keith live-context minimization ──────────────────────────────────────────
//
// The audit's security finding: Keith assembled the full LIVE COHORT DATA
// block for ANY signed-in staff account, including Viewer, before any role
// gate. Access is now decided first (keith_chat), and the context itself is
// scoped to what the verified caller is entitled to see.
export const KEITH_CONTEXT_SCOPES = Object.freeze({
  FULL: 'full',                 // Owner/Admin: operational context
  STUDENT_PLACEMENT: 'student', // Co-Lead: student + placement scope
  INTERVIEW: 'interview',       // Interviewer: interview-appropriate only
  NONE: 'none',                 // no Keith access
});

/** Which live-context scope does this caller get inside Keith? */
export function keithContextScope(caller) {
  const c = callerFrom(caller);
  if (!can(c, 'keith_chat')) return KEITH_CONTEXT_SCOPES.NONE;
  if (c.isOwner || c.role === 'admin' || c.role === 'owner') return KEITH_CONTEXT_SCOPES.FULL;
  if (c.role === 'co-lead') return KEITH_CONTEXT_SCOPES.STUDENT_PLACEMENT;
  if (c.role === 'interviewer') return KEITH_CONTEXT_SCOPES.INTERVIEW;
  return KEITH_CONTEXT_SCOPES.NONE;
}

/**
 * Which named live-context sections may a scope receive? The Keith handler
 * consults this before composing the prompt, so a section a caller may not
 * see is never assembled rather than assembled and hidden.
 */
const SCOPE_SECTIONS = Object.freeze({
  [KEITH_CONTEXT_SCOPES.FULL]:              ['status', 'roster', 'oncampus', 'capacity', 'communications', 'unit_leadership', 'interviews'],
  [KEITH_CONTEXT_SCOPES.STUDENT_PLACEMENT]: ['status', 'roster', 'oncampus', 'capacity'],
  [KEITH_CONTEXT_SCOPES.INTERVIEW]:         ['interviews'],
  [KEITH_CONTEXT_SCOPES.NONE]:              [],
});

export function contextSectionsFor(caller) {
  return SCOPE_SECTIONS[keithContextScope(caller)] || [];
}

export function allowsContextSection(caller, section) {
  return contextSectionsFor(caller).includes(section);
}
