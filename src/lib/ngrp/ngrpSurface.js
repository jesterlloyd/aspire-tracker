// RESIDENCY-PORTAL-1: which surface the Residency workspace is mounted in.
//
// The staff app and the Residency Portal render the SAME tab components. What
// differs is where they live and what the surface offers: the base path every
// tab link is built on, and whether the staff-only Send Transition Form action
// is shown (it runs through ASPIRE Connect, which portal users do not have).
// The default is the staff surface, so nothing in the staff app has to opt in.
import { createContext, useContext } from 'react'
import { NGRP_STAFF_BASE, RESIDENCY_PORTAL_BASE } from './ngrpTabs.js'

// canEditEvents: whether the Activity calendar offers Add Event / editing (the staff app
// only; Talent Acquisition does not author ASPIRE events). eventAudience: the portal role
// whose view of events this surface shows (null = the internal team's full view).
export const STAFF_SURFACE = Object.freeze({
  base: NGRP_STAFF_BASE, staffApp: true, canSendForms: true, canEditEvents: true, eventAudience: null,
})
export const RESIDENCY_PORTAL_SURFACE = Object.freeze({
  base: RESIDENCY_PORTAL_BASE, staffApp: false, canSendForms: false, canEditEvents: false, eventAudience: 'talent_acquisition',
})

const NgrpSurfaceContext = createContext(STAFF_SURFACE)

export const NgrpSurfaceProvider = NgrpSurfaceContext.Provider

export function useNgrpSurface() {
  return useContext(NgrpSurfaceContext)
}
