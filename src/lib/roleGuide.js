// ROLE-GUIDE-1 / ROLE-MODEL-1: the resolved role model, for display.
//
// THIS IS DOCUMENTATION, NOT A PERMISSION SYSTEM. Nothing here grants or
// denies anything: every cell records what the REAL authorization sources
// already decide, and test/roleGuide.test.mjs asserts each claim against
// those sources (the client permission module, the pure server authorization
// modules, and the inline predicates in the api/ handlers). If a role check
// materially drifts, that test fails and this file must be corrected - which
// is the whole point of writing it down.
//
// Audited and RESOLVED 2026-08-09. The divergences the audit found (Co-Lead
// controls that failed server-side, an ungated Keith, six competing owner
// predicates) were fixed rather than documented: this describes the model as
// it now behaves. Capability names below are the real keys from
// lib/server/access.js, which is the one table the server enforces.
//
// THE OWNER SIGNAL. `is_owner` is a BOOLEAN CAPABILITY on user_profiles, not
// an assignable staff role: no invite may grant it and no role change may
// reach it. Owner authority now derives from that capability everywhere,
// through lib/server/access.js, rather than from whichever string a given
// endpoint happened to compare.

export const ROLE_ORDER = Object.freeze(['owner', 'admin', 'co-lead', 'interviewer', 'viewer']);

export const ROLE_SUMMARY = Object.freeze({
  owner: {
    label: 'Owner',
    assignable: false,
    tagline: 'Platform governance, plus everything Admin can do.',
    detail: 'A capability on the account rather than a role you assign. Owner alone activates, applies, restores, or retires governed content (Knowledge Center entries, Keith Skills, email templates), runs Knowledge Vault enrichment, invites an Admin, and promotes an account to Admin.',
  },
  admin: {
    label: 'Admin',
    assignable: true,
    tagline: 'The highest assignable role: full day-to-day administration.',
    detail: 'Students, placements, interviews, evaluations, contacts, messages, cohorts, portal access, and staff management for the roles below Admin. Admin authors governed drafts and can preview an enrichment plan, but activating governed content and running enrichment remain with the Owner.',
  },
  'co-lead': {
    label: 'Co-Lead',
    assignable: true,
    tagline: 'Student and placement management.',
    detail: 'Manages placements and preceptor assignments, and edits student records including contact details, requirements, CS-Link, NGRP, notes, and availability. Reads student files across cohorts. Not included: badge generation, student file replacement or deletion, interview scheduling, administrative status overrides, evaluations, contacts, cohort settings, staff management, and governance.',
  },
  interviewer: {
    label: 'Interviewer',
    assignable: true,
    tagline: 'Interview and rubric work, scoped to entitled cohorts.',
    detail: 'Records interview outcomes and rubric scores, uses Keith with interview-appropriate context and its live-data tools, and looks up Contacts. Student files are readable only for cohorts the Interviewer is actively entitled to. No placement, evaluation, settings, or governance access.',
  },
  viewer: {
    label: 'Viewer',
    assignable: false,
    tagline: 'Retired. Existing accounts keep limited read-only access.',
    detail: 'Viewer is no longer offered when inviting staff. Accounts that already hold it continue to work unchanged, with read-only access and student headshots only. Viewer has no Keith access and cannot be granted a Keith Skill.',
  },
});

// Capability rows. `levels` is what each role effectively gets; `capability`
// is the REAL key in lib/server/access.js, and the drift test resolves every
// cell against can() there - so the matrix cannot describe a permission the
// server does not actually grant.
export const CAPABILITY_MATRIX = Object.freeze([
  {
    key: 'students', capability: 'student_manage', readCapabilities: ['student_read', 'student_read_entitled'],
    label: 'Student profiles and records',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'Manage', interviewer: 'Limited', viewer: 'Limited' },
    note: 'Interviewer sees students in entitled cohorts; existing Viewer accounts see headshots only.',
  },
  {
    key: 'placement', capability: 'placement_manage',
    label: 'Rotation and placement management',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'Manage', interviewer: 'No access', viewer: 'No access' },
  },
  {
    key: 'studentFiles', capability: 'student_files_manage',
    label: 'Student file uploads and badges',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
    note: 'Reading a student file is access; replacing, deleting, or generating a badge is not.',
  },
  {
    key: 'interviews', capability: 'interview_conduct',
    label: 'Interviews and rubric',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'No access', interviewer: 'Manage', viewer: 'No access' },
    note: 'Scheduling and rescheduling interviews stays with Owner and Admin.',
  },
  {
    key: 'evaluations', capability: 'evaluations_manage',
    label: 'Evaluations and surveys',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
  },
  {
    key: 'contacts', capability: 'contacts_manage', readCapabilities: ['keith_contacts'],
    label: 'Contacts',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'No access', interviewer: 'Read', viewer: 'No access' },
    note: 'Interviewer may look contacts up through Keith; editing them is Owner and Admin.',
  },
  {
    key: 'keithChat', capability: 'keith_chat',
    label: 'Keith AI',
    levels: { owner: 'Full', admin: 'Full', 'co-lead': 'Full', interviewer: 'Full', viewer: 'No access' },
    note: 'Keith shows each role only the live context that role is entitled to.',
  },
  {
    key: 'keithSkills', capability: 'keith_skills',
    label: 'Keith Skills',
    levels: { owner: 'Full', admin: 'Per skill', 'co-lead': 'Per skill', interviewer: 'Per skill', viewer: 'No access' },
    note: 'Owner may invoke any Skill. Everyone else must be listed in that Skill’s allowed roles.',
  },
  {
    key: 'knowledge', capability: 'knowledge_author',
    label: 'Knowledge Center',
    levels: { owner: 'Full', admin: 'Manage', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
    note: 'Admin authors drafts and revisions; activating an entry is Owner-only.',
  },
  {
    key: 'skillsAdmin', capability: 'skills_author',
    label: 'Keith Skills administration',
    levels: { owner: 'Full', admin: 'Manage', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
  },
  {
    key: 'enrichment', capability: 'enrichment_preview',
    label: 'Knowledge Vault enrichment',
    levels: { owner: 'Full', admin: 'Read', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
    note: 'Admin may review a proposed plan; running enrichment and applying revisions are Owner-only.',
  },
  {
    key: 'usage', capability: 'usage_view',
    label: 'Keith Usage & Cost',
    levels: { owner: 'Full', admin: 'Read', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
  },
  {
    key: 'settings', capability: 'staff_manage',
    label: 'Settings and staff management',
    levels: { owner: 'Full', admin: 'Manage', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
    note: 'Admin invites and manages Co-Lead and Interviewer accounts. Inviting or promoting an Admin is Owner-only.',
  },
  {
    key: 'communityBenefit', capability: 'community_benefit_admin', readCapabilities: ['community_benefit_view'],
    label: 'Community-benefit rates and capstone hours',
    levels: { owner: 'Full', admin: 'Read', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
    note: 'Admin may view the entries in Settings; entering or changing rates and capstone hours is Owner-only.',
  },
  {
    key: 'governance', capability: 'governance',
    label: 'Governance actions',
    levels: { owner: 'Full', admin: 'No access', 'co-lead': 'No access', interviewer: 'No access', viewer: 'No access' },
    note: 'Activating, applying, restoring, or retiring governed content.',
  },
]);

// Levels, ordered strongest to weakest, for consistent display treatment.
export const LEVELS = Object.freeze(['Full', 'Manage', 'Per skill', 'Read', 'Limited', 'No access']);

// What a reader should know about the model itself. These are properties of
// the resolved design, not outstanding problems - the audit's divergences were
// fixed. Nothing here exposes implementation or security detail.
export const MODEL_NOTES = Object.freeze([
  'Owner is a governance capability on an account, not a role you can invite or assign.',
  'Admin is the highest assignable role and covers day-to-day administration.',
  'Viewer is retired for new invitations. Existing Viewer accounts keep working with read-only access.',
]);
