/* eslint-disable react-refresh/only-export-components */
// This module intentionally exports a context alongside the two portal components that consume it
// (one cohesive header-slot primitive), matching the repo's shared-module convention (see
// PortalRefresh.jsx). Fast refresh is unaffected in practice; the module is tiny and rarely edited.
//
// Shared Nightfall-header slots. PortalShell exposes two DOM slots in its header: a role-SCOPE line
// (rendered under the role subtitle) and a right-aligned CONTROLS area (left of the profile menu).
// Each portal fills them with createPortal, so a portal owns its own scope label and header selectors
// without prop-drilling or lifting cross-tree state. The slot nodes reach children as context values
// set by ref callbacks (allowed; not a setState-in-effect), so the first render after mount targets a
// real node. Because the content is portaled OUT of the page body, it stays visible in the header
// even when its owning view is display:none (e.g. the Student portal's hidden Home while on Messages).

import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

export const PortalHeaderSlotsContext = createContext({ scopeSlot: null, controlsSlot: null })

// The role/scope line, e.g. " · California State University, Los Angeles", appended after the role
// subtitle inside .ptl-header-sub.
export function PortalHeaderScope({ children }) {
  const { scopeSlot } = useContext(PortalHeaderSlotsContext)
  return scopeSlot ? createPortal(children, scopeSlot) : null
}

// Right-aligned header controls (authorized-scope selectors / cohort pickers), left of the avatar.
export function PortalHeaderControls({ children }) {
  const { controlsSlot } = useContext(PortalHeaderSlotsContext)
  return controlsSlot ? createPortal(children, controlsSlot) : null
}
