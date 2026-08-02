// UI-0.5: minimal coordinator for mutually-exclusive floating panels.
//
// The Keith panel (App-level, fixed) and the UserMenu dropdown (header-level,
// absolute) both own their open-state locally and both sit at z:999 with their
// own click-outside backdrops - so without coordination they can be open at the
// same time and visually collide. Their nearest shared parent is App, but lifting
// state there would mean threading props through the whole Header chain; this
// tiny announce/subscribe module is the smaller mechanism.
//
// Contract: a panel calls announceFloatingPanelOpen(<its source id>) when it
// OPENS (not on close), and subscribes with onFloatingPanelOpen to close itself
// when a DIFFERENT source announces. Purely behavioral - no z-index, position,
// or visual involvement.

const listeners = new Set()

export function announceFloatingPanelOpen(source) {
  listeners.forEach(fn => {
    try { fn(source) } catch { /* one bad listener must not break the rest */ }
  })
}

// Returns an unsubscribe function (use as a useEffect cleanup).
export function onFloatingPanelOpen(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// MESSAGES-DOCK-1: the lower-right corner is now an explicit dock shared by
// Keith and the Messages panel, and the Messages launcher RELOCATES while
// Keith is open (so it can never cover Keith's composer). That requires
// knowing when a panel CLOSES too, so the registry gains a symmetric closed
// announcement. Open announcements keep their original close-the-others
// contract unchanged.
const closeListeners = new Set()

export function announceFloatingPanelClosed(source) {
  closeListeners.forEach(fn => {
    try { fn(source) } catch { /* one bad listener must not break the rest */ }
  })
}

// Returns an unsubscribe function (use as a useEffect cleanup).
export function onFloatingPanelClosed(fn) {
  closeListeners.add(fn)
  return () => closeListeners.delete(fn)
}
