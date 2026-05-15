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
    viewEmbed: false, viewPeopleAccess: false, manageCohorts: false,
    makePlacements: false, deleteRecords: false, viewInterviewRubric: true,
    conductInterviews: true, studentDetailLevel: 'limited',
  },
  viewer: {
    viewEmbed: false, viewPeopleAccess: false, manageCohorts: false,
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

/** Returns which tabs a user can see. */
export function visibleTabs(userProfile) {
  const all = ['overview', 'profiles', 'interviews', 'matching']
  if (!userProfile) return ['overview']
  if (userProfile.is_owner) return all
  return all.filter(tab => {
    if (tab === 'matching') return can(userProfile, 'viewEmbed')
    return true
  })
}
