// PORTAL-SPLIT Phase 1: the ONE dynamic import of the staff app.
//
// App.jsx builds its lazy route from it. Anything that wants to warm the staff
// chunk (a sign-in page that knows the account is staff, say) calls
// preloadStaffApp, and because both reference the same import() it stays one
// chunk. Mirrors src/lib/portalAppLoader.js.
export const loadStaffApp = () => import('../staff/StaffApp')

let warmed = false
export function preloadStaffApp() {
  if (warmed) return
  warmed = true
  // A failed warm-up is not an error: the route still loads (and, after a
  // deploy, reloads once) through lazyReload.
  loadStaffApp().catch(() => { warmed = false })
}
