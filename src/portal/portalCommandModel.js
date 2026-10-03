// PORTAL-COMMAND-1: the portal command bar's small, permission-safe vocabulary.
// Data-backed people are supplied by the active portal when available; these
// actions are navigation only and never grant access by themselves.
const action = (key, title, where, to, words = '') => ({ key, title, where, to, need: 'any', words })

export function portalActionsFor(kind, { budgetEnabled = false, messagesEnabled = true } = {}) {
  if (kind === 'student') return [
    action('shift-log', 'Open Shift Log', 'Student Portal · Rotation', '/portal/shift-log', 'shift shifts hours rotation clinical log'),
    action('placement', 'View Placement', 'Student Portal · Placement', '/portal/placement', 'placement unit rotation assignment'),
    action('profile', 'Open My Profile', 'Student Portal · Profile', '/portal/profile', 'profile information account'),
    ...(messagesEnabled ? [action('messages', 'Open Messages', 'Student Portal · Messages', '/portal/messages', 'message messages inbox')] : []),
  ]
  if (kind === 'unit_leader') return [
    action('students', 'Find a Student', 'Unit Leader Portal · Students', '/portal/unit/students', 'student students roster name'),
    action('message-student', 'Message a Student', 'Unit Leader Portal · Messages', '/portal/messages', 'message student contact'),
    action('primary-preceptor', 'Change Primary Preceptor', 'Unit Leader Portal · Preceptors', '/portal/unit/preceptors', 'change primary preceptor assignment'),
    action('preceptors', 'Manage Preceptors', 'Unit Leader Portal · Preceptors', '/portal/unit/preceptors', 'preceptor preceptors primary'),
    ...(messagesEnabled ? [action('messages', 'Open Messages', 'Unit Leader Portal · Messages', '/portal/messages', 'message messages inbox')] : []),
  ]
  if (kind === 'academic_partner') return [
    action('students', 'Find a Student', 'Academic Partner Portal · Students', '/portal/ap/students', 'student students roster name'),
    action('placement', 'Open Placement Requests', 'Academic Partner Portal · Placement', '/portal/ap/placement', 'placement request requests'),
    ...(messagesEnabled ? [action('messages', 'Open Messages', 'Academic Partner Portal · Messages', '/portal/ap/messages', 'message messages inbox')] : []),
  ]
  if (kind === 'nursing_academic') return [
    ...(budgetEnabled ? [action('expense', 'Search an Expense', 'NE&L Portal · Budget', '/portal/academics/budget', 'expense expenses budget receipt receipts concur')] : []),
    action('community-benefit', 'Open Community Benefit', 'NE&L Portal · Community Benefit', '/portal/academics/community-benefit', 'community benefit grant report'),
    action('contacts', 'Find a Contact', 'NE&L Portal · Contacts', '/portal/academics/contacts', 'contact contacts directory'),
    ...(messagesEnabled ? [action('messages', 'Open Messages', 'NE&L Portal · Messages', '/portal/academics/messages', 'message messages inbox')] : []),
  ]
  if (kind === 'talent_acquisition') return [
    action('overview', 'Open At a Glance', 'Residency Portal · At a Glance', '/portal/residency/overview', 'overview home'),
    action('profiles', 'Find a Resident', 'Residency Portal · Profiles', '/portal/residency/profiles', 'resident applicant profile'),
    action('interviews', 'Open Interviews', 'Residency Portal · Interviews', '/portal/residency/interviews', 'interview schedule'),
  ]
  return []
}
