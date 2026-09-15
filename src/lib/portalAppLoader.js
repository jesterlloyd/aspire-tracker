// CHUNK-RELOAD-1: the ONE dynamic import of the portal app. App.jsx builds its
// lazy route from it, and the staff profile menu calls it when the menu opens,
// so the portal chunk is already downloading before the person picks a portal
// (PORTAL-PREFETCH). Both sides referencing the same import() keeps it one chunk.
export const loadPortalApp = () => import('../portal/PortalApp')

let warmed = false
export function preloadPortalApp() {
  if (warmed) return
  warmed = true
  // A failed warm-up is not an error: the click still loads (and, after a
  // deploy, reloads) through lazyReload.
  loadPortalApp().catch(() => { warmed = false })
}
