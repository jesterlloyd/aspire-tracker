/* eslint-disable react-refresh/only-export-components */
// This module intentionally exports a provider, a hook, and a nav component together (one cohesive
// refresh primitive), matching the repo's shared-module convention (see accountsShared.jsx). Fast
// refresh is unaffected in practice; the module is small and rarely edited.
//
// Shared portal Refresh: one canonical action in the attached nav row that re-fetches the ACTIVE
// portal surface's data, across the Student, Unit Leader, and Academic Partner portals.
//
// Architecture. PortalShell provides a PortalRefreshProvider. Each portal nav renders a
// <PortalNavRefresh/> at the right end of its .ptl-nav row (the canonical RefreshHint control from
// the main app). The active section registers its own refetch through useRegisterPortalRefresh, so
// the button always drives the surface the user is looking at, and a prepared/empty state that
// registers nothing leaves the button disabled rather than issuing an unsupported call.
//
// This is NOT a browser reload. The main-app top nav falls back to window.location.reload() only
// because it passes no handler; the proven soft-refetch pattern (ASPIRE Connect) is a state-driven
// refetch, which is what each section registers here. Routes, history, filters, selection, and open
// drawers are preserved because the section re-runs its own data load, not a remount.

import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import { RefreshHint } from '../components/UnifiedNav'

const PortalRefreshContext = createContext(null)

export function PortalRefreshProvider({ children }) {
  // The active section's refetch, held in a ref so registering it never re-renders the tree. A
  // separate `canRefresh` flag drives the button's enabled state (a boolean CAN change rendering).
  const handlerRef = useRef(null)
  const inFlightRef = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [canRefresh, setCanRefresh] = useState(false)

  const registerRefresh = useCallback((fn) => {
    handlerRef.current = fn
    setCanRefresh(true)
    return () => {
      // Only clear if this exact registration still owns the slot: when switching sections, the
      // newly-active section may register before the outgoing one's cleanup runs.
      if (handlerRef.current === fn) {
        handlerRef.current = null
        setCanRefresh(false)
      }
    }
  }, [])

  const runRefresh = useCallback(async () => {
    // Guard against a concurrent duplicate run (the button is also disabled while loading).
    if (inFlightRef.current || handlerRef.current == null) return
    inFlightRef.current = true
    setRefreshing(true)
    try {
      await handlerRef.current()
    } catch {
      // The active section renders its own error/retry state; leave the chrome as-is.
    } finally {
      inFlightRef.current = false
      setRefreshing(false)
    }
  }, [])

  return (
    <PortalRefreshContext.Provider value={{ registerRefresh, runRefresh, refreshing, canRefresh }}>
      {children}
    </PortalRefreshContext.Provider>
  )
}

function usePortalRefresh() {
  return useContext(PortalRefreshContext)
}

/**
 * Register the ACTIVE portal surface's refetch for as long as it is the active surface. `fn` may
 * change identity between renders; a ref keeps the registration stable so it does not thrash.
 * `active` gates registration for surfaces that stay mounted while hidden (the Student portal toggles
 * Home and Messages with display:none), so only the visible one owns the button. Outside a
 * PortalRefreshProvider (e.g. a workspace reused in the staff app) this is a no-op.
 */
export function useRegisterPortalRefresh(fn, active = true) {
  const ctx = usePortalRefresh()
  const register = ctx?.registerRefresh
  // Keep the latest fn in a ref (updated in an effect, never during render) so a changing fn
  // identity never re-registers, while the registered wrapper always calls the current one.
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })
  useEffect(() => {
    if (!register || !active) return undefined
    return register(() => fnRef.current?.())
  }, [register, active])
}

/**
 * The canonical Refresh control, right-aligned in the attached nav row. Reuses the main-app
 * RefreshHint (icon, spinner, busy state, tooltip). Disabled (not hidden) when the active surface
 * registered no refetch, so a prepared state never issues an unsupported call. Hidden on phones,
 * where .ptl-nav is the bottom tab bar (see .ptl-nav-refresh in portal.css).
 */
export function PortalNavRefresh({ tooltipLabel = 'Refresh' }) {
  const ctx = usePortalRefresh()
  if (!ctx) return null
  return (
    <span className="ptl-nav-refresh">
      <RefreshHint
        onClick={ctx.runRefresh}
        tooltipLabel={tooltipLabel}
        loading={ctx.refreshing}
        disabled={!ctx.canRefresh}
      />
    </span>
  )
}
