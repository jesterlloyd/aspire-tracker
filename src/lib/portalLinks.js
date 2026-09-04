// PORTAL-SWITCHER-1: one list of the portal destinations, and one path-to-portal
// mapping, read by BOTH profile menus and by the portal's staff-preview resolution.
//
// Before this module the list lived only in src/components/UserMenu.jsx, so the staff
// app could reach every portal while a portal menu offered no way across; adding a
// fifth portal meant remembering two places. The path mapping additionally lived in
// src/portal/PortalApp.jsx as staffPreviewRole(). Both now resolve here.
//
// `key` is the same vocabulary as get_my_portal_access().roles and PortalApp's
// `experience`, so one value answers "which portal is this" for a real portal user
// and for an Owner/Admin preview alike.
//
// Pure data: no React and no icon components, so this stays importable from node
// tests and from api/. Each menu maps `key` to its own icon.

export const PORTAL_LINKS = Object.freeze([
  Object.freeze({ key: 'student', label: 'Student Portal', path: '/portal/student' }),
  Object.freeze({ key: 'unit_leader', label: 'Unit Leader Portal', path: '/portal/unit/home' }),
  Object.freeze({ key: 'academic_partner', label: 'Academic Partner Portal', path: '/portal/ap/students' }),
  Object.freeze({ key: 'nursing_academic', label: 'Nursing Education & Leadership Portal', path: '/portal/academics/calendar' }),
])

// Where the portal menus send a staff member who wants back out of the portals.
export const MAIN_APP_PATH = '/aggregate'
export const STAFF_SETTINGS_PATH = '/settings/general'

// The portal a staff-preview path names, or null when the path is not a preview path.
// A real portal user lives at /portal (and /portal/messages, /portal/profile), which is
// deliberately not a preview path: their portal is decided by their grants, not the URL.
export function portalKeyFromPath(pathname) {
  if (typeof pathname !== 'string') return null
  if (pathname === '/portal/student' || pathname.startsWith('/portal/student/')) return 'student'
  if (pathname.startsWith('/portal/unit/')) return 'unit_leader'
  if (pathname.startsWith('/portal/ap/')) return 'academic_partner'
  if (pathname.startsWith('/portal/academics/')) return 'nursing_academic'
  return null
}
