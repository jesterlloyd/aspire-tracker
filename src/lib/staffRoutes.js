// PORTAL-SPLIT Phase 1: the two facts the router and the staff app BOTH need.
//
// They used to live inside App.jsx, which was fine while the staff app was the
// same module as the router. Now that src/staff/StaffApp.jsx is its own lazy
// chunk, a value used on both sides has to live somewhere neither owns, or
// importing it would pull the staff chunk back into the entry.
//
// Pure data: no React, no imports, so it costs the entry almost nothing.

// Tab ID -> URL path (internal IDs never change; the URLs are the public part).
// MainApp routes with it; PortalRoute reads it to send a staff member back to
// the tab they were last on.
export const TAB_TO_PATH = Object.freeze({
  overview:   '/aggregate',
  profiles:   '/students',
  interviews: '/interviews',
  rotation:   '/rotation/matrix',
  evaluation: '/evaluation',
})

// Who belongs in the staff shell. AuthedShell sends everyone else to /portal;
// PortalRoute sends these roles back out of it. UX routing only: RLS (Phase 0B
// Wave E) is the actual security boundary.
export const PORTAL_STAFF_ROLES = Object.freeze(
  ['owner', 'admin', 'co_lead', 'co-lead', 'interviewer', 'viewer'],
)
