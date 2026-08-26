// PORTAL-ROLE-GUIDE-1: plain-language documentation for scoped portal access.
//
// This file describes the portal grant model. It does not grant access. Portal
// authorization remains enforced by active user_role_grants and the linked
// student, unit, school, or organization-wide scope resolved by the server.

export const PORTAL_ROLE_ORDER = Object.freeze([
  'student',
  'unit_leader',
  'academic_partner',
  'nursing_academic',
])

export const PORTAL_ROLE_SUMMARY = Object.freeze({
  student: {
    label: 'Student',
    tagline: 'Their own ASPIRE experience.',
    detail: 'Uses the portal only for the linked student record, including assigned rotation information, hours, evaluations, and available messages. The student cannot open the staff application or another student record.',
  },
  unit_leader: {
    label: 'Unit Leader',
    tagline: 'Operations for assigned units.',
    detail: 'Works with students, preceptors, evaluations, capacity, placement requests, and messages within assigned unit scope. The Unit Leader cannot open the staff application or data from unassigned units.',
  },
  academic_partner: {
    label: 'Academic Partner',
    tagline: 'School-specific student and placement access.',
    detail: 'Views student status and hours for assigned schools, submits placement requests, and uses portal messaging when enabled. The Academic Partner cannot open the staff application or data from other schools.',
  },
  nursing_academic: {
    label: 'Nursing Education & Leadership',
    tagline: 'ASPIRE-wide reporting with optional contact management.',
    detail: 'Views At A Glance, Community Benefit, and Contacts across ASPIRE. Reporting stays view-only. The optional Contacts Editor permission allows adding, editing, deactivating, and reactivating contacts, but never permanent deletion or changes to school, program, cohort, or rotation data.',
  },
})

// These rows explain the primary scope boundary for each portal role. They are
// intentionally broader than page-by-page feature lists so optional features,
// such as Academic Partner messaging, are not overstated.
export const PORTAL_CAPABILITY_MATRIX = Object.freeze([
  {
    key: 'linkedStudent',
    label: 'Linked student experience',
    note: 'Personal rotation, hours, evaluations, and available messages.',
    levels: {
      student: 'Own record',
      unit_leader: 'No access',
      academic_partner: 'No access',
      nursing_academic: 'No access',
    },
  },
  {
    key: 'assignedUnits',
    label: 'Assigned-unit operations',
    note: 'Students, preceptors, capacity, evaluations, and unit workflows.',
    levels: {
      student: 'No access',
      unit_leader: 'Assigned scope',
      academic_partner: 'No access',
      nursing_academic: 'No access',
    },
  },
  {
    key: 'assignedSchools',
    label: 'Assigned-school roster and placement requests',
    note: 'Student status, hours, and placement work for assigned schools.',
    levels: {
      student: 'No access',
      unit_leader: 'No access',
      academic_partner: 'Assigned scope',
      nursing_academic: 'No access',
    },
  },
  {
    key: 'reporting',
    label: 'Education and community-benefit reporting',
    note: 'ASPIRE-wide calendar, fiscal-year reporting, and aggregate export.',
    levels: {
      student: 'No access',
      unit_leader: 'No access',
      academic_partner: 'No access',
      nursing_academic: 'ASPIRE-wide read',
    },
  },
  {
    key: 'contacts',
    label: 'Contacts directory',
    note: 'Contacts Editor is an optional permission within Nursing Education & Leadership.',
    levels: {
      student: 'No access',
      unit_leader: 'No access',
      academic_partner: 'No access',
      nursing_academic: 'View or edit',
    },
  },
  {
    key: 'staffApplication',
    label: 'Staff application and Settings',
    levels: {
      student: 'No access',
      unit_leader: 'No access',
      academic_partner: 'No access',
      nursing_academic: 'No access',
    },
  },
  {
    key: 'permanentContactDeletion',
    label: 'Permanent contact deletion',
    note: 'No portal role can permanently delete a contact.',
    levels: {
      student: 'No access',
      unit_leader: 'No access',
      academic_partner: 'No access',
      nursing_academic: 'No access',
    },
  },
])

export const PORTAL_LEVELS = Object.freeze([
  'Own record',
  'Assigned scope',
  'ASPIRE-wide read',
  'View or edit',
  'No access',
])

export const PORTAL_MODEL_NOTES = Object.freeze([
  'Portal access is separate from staff application access. A portal grant never creates a staff role.',
  'Student, Unit Leader, and Academic Partner access stays within the linked student, assigned units, or assigned schools.',
  'Nursing Education & Leadership is ASPIRE-wide, but At A Glance and Community Benefit remain view-only.',
  'Contacts Editor is an optional Nursing Education & Leadership permission, not another role. It never allows permanent deletion.',
  'Portal grants can start later, expire, or be revoked without changing the person’s contact record.',
])
