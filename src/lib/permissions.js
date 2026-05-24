/**
 * permissions.js
 * Single source of truth for role-based feature access.
 * Use can(userProfile, 'permissionKey') anywhere in the app.
 */

const ROLE_PERMS = {
  owner: {
    viewEmbed: true, viewPeopleAccess: true, manageCohorts: true,
    makePlacements: true, deleteRecords: true, viewInterviewRubric: true,
    conductInterviews: true, studentDetailLevel: 'full',
  },
  admin: {
    viewEmbed: true, viewPeopleAccess: true, manageCohorts: true,
    makePlacements: true, deleteRecords: true, viewInterviewRubric: true,
    conductInterviews: false, studentDetailLevel: 'full',
  },
  'co-lead': {
    viewEmbed: true, viewPeopleAccess: false, manageCohorts: false,
    makePlacements: true, deleteRecords: false, viewInterviewRubric: true,
    conductInterviews: false, studentDetailLevel: 'full',
  },
  interviewer: {
    viewEmbed: true, viewPeopleAccess: false, manageCohorts: false,
    makePlacements: false, deleteRecords: false, viewInterviewRubric: true,
    conductInterviews: true, studentDetailLevel: 'limited',
  },
  viewer: {
    viewEmbed: true, viewPeopleAccess: false, manageCohorts: false,
    makePlacements: false, deleteRecords: false, viewInterviewRubric: true,
    conductInterviews: false, studentDetailLevel: 'readonly',
  },
}

/** Returns true/false for a given permission key. Owners bypass all checks. */
export function can(userProfile, permission) {
  if (!userProfile) return false
  if (userProfile.is_owner) return true
  const perms = ROLE_PERMS[userProfile.role] || ROLE_PERMS.viewer
  return !!perms[permission]
}

/** Returns the student detail level ('full' | 'limited' | 'readonly') for a user. */
export function studentDetailLevel(userProfile) {
  if (!userProfile) return 'readonly'
  if (userProfile.is_owner) return 'full'
  return (ROLE_PERMS[userProfile.role] || ROLE_PERMS.viewer).studentDetailLevel
}

/**
 * All authenticated users can see all tabs.
 * Placement actions are gated separately by canPerformMatching().
 */
export function visibleTabs(userProfile) {
  return ['overview', 'profiles', 'interviews', 'rotation', 'evaluation']
}

/**
 * Returns true if the user can perform matching/placement actions.
 * Owner, Admin, and Co-Lead can match. Interviewer and Viewer cannot.
 */
export function canPerformMatching(userProfile) {
  if (!userProfile) return false
  if (userProfile.is_owner) return true
  return ['admin', 'co-lead', 'co_lead'].includes(userProfile.role)
}
