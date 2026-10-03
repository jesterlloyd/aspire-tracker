// TOPBAR-PROFILE-1 (2026-10-02): "you have unsaved changes" for a page with one Save button.
//
// The staff app runs on <BrowserRouter>, which has no navigation blocker (useBlocker needs a
// data router), so a page cannot stop every route change by itself. Instead the page marks
// itself dirty here, and the controls that leave it ask first: the Settings rail, list rows,
// breadcrumb and back link, and the profile menu. A reload or a closed tab is covered by the
// page's own beforeunload listener. The workspace tabs above Settings do not ask.
import { confirmDialog } from '../components/shared/confirmDialog'

let dirtyLabel = null

// Pass the page's name while it holds unsaved edits, and null once it does not.
export function setUnsavedChanges(label) {
  dirtyLabel = label || null
}

export function hasUnsavedChanges() {
  return dirtyLabel !== null
}

// Resolves true when it is fine to leave: nothing is unsaved, or the person chose to leave.
export async function confirmLeave() {
  if (dirtyLabel === null) return true
  const ok = await confirmDialog(`Leave without saving? Your changes to ${dirtyLabel} have not been saved.`, {
    confirmLabel: 'Leave without saving',
    cancelLabel: 'Keep editing',
    danger: true,
  })
  if (ok) dirtyLabel = null
  return ok
}
